import json
import logging
import sqlite3
from collections import deque
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from claudia import db
from claudia import store
from claudia import persona
from claudia import option_generator
from claudia import translator
from claudia import transcriber
from claudia import utterance
from claudia import config
from claudia.audio_stream import Segmenter
from claudia.vad import SileroVad
from claudia.models import Option

app = FastAPI()

log = logging.getLogger("claudia.api")

# Allow the local Vite dev server (different origin) to call the REST endpoints.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _open_conn():
    connection = sqlite3.connect(config.DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.create_schema(connection)        # symbols + symbol_terms (seeding plan)
    store.create_schema(connection)     # interactions/options/persona/settings
    return connection


class OptionsIn(BaseModel):
    text: str
    lang: str | None = None


class SelectIn(BaseModel):
    interaction_id: int
    option_id: int


class TranslateIn(BaseModel):
    text: str
    lang: str | None = None


def _has_matched_symbol(card_lists) -> bool:
    return any(not card.as_text for cards in card_lists for card in cards)


async def propose(conn, *, context_text, lang, context_type,
                  audio_path=None, asr_model=None) -> dict:
    who = persona.load(conn)
    history = persona.recent(conn, n=5)
    n = int(store.get_setting(conn, "option_count"))
    threshold = float(store.get_setting(conn, "match_threshold"))
    log.info("propose: generating %d options (LLM=%s)", n, config.MODEL_LLM)
    candidates = await option_generator.generate(context_text, who, history, n, lang)
    log.info("propose: %d candidates generated, matching symbols", len(candidates))

    texts = [candidate.text for candidate in candidates]
    card_lists = await translator.to_symbols_batch(
        conn, [candidate.glosses for candidate in candidates], lang, threshold)
    log.info("propose: symbols matched for %d options", len(card_lists))

    # Similarity search found nothing usable → fall back to the common core board.
    if not _has_matched_symbol(card_lists):
        log.info("propose: no symbol matched, falling back to core board")
        texts, card_lists = translator.default_symbol_options(conn, lang)

    interaction_id = persona.log_interaction(
        conn, lang, context_type, context_text, audio_path, asr_model)
    rows = [{"rank": rank, "text": texts[rank],
             "glosses": [card.label for card in card_lists[rank]],
             "symbol_sequence": [card.id for card in card_lists[rank] if not card.as_text]}
            for rank in range(len(texts))]
    option_ids = persona.save_options(conn, interaction_id, rows)

    options = [Option(option_id=oid, text=texts[i], symbols=card_lists[i])
               for i, oid in enumerate(option_ids)]
    return {"interaction_id": interaction_id, "options": options}


@app.post("/expressive/options")
async def expressive_options(body: OptionsIn):
    conn = _open_conn()
    lang = body.lang or store.get_setting(conn, "lang")
    return await propose(conn, context_text=body.text, lang=lang, context_type="text")


@app.post("/expressive/select")
async def expressive_select(body: SelectIn):
    conn = _open_conn()
    lang = store.get_setting(conn, "lang")
    try:
        text = persona.mark_selected(conn, body.interaction_id, body.option_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown interaction/option")
    spoken = utterance.compose(text, lang)
    return {"text": spoken.text, "lang": spoken.lang}


@app.post("/translate")
async def translate(body: TranslateIn):
    conn = _open_conn()
    lang = body.lang or store.get_setting(conn, "lang")
    threshold = float(store.get_setting(conn, "match_threshold"))
    glosses = await translator.glossify(body.text, lang)
    cards = await translator.to_symbols(conn, glosses, lang, threshold)
    return {"glosses": glosses, "symbols": [c.model_dump() for c in cards]}


@app.websocket("/expressive/listen")
async def listen(ws: WebSocket):
    await ws.accept()
    conn = _open_conn()
    lang = store.get_setting(conn, "lang")
    silence_ms = int(store.get_setting(conn, "vad_silence_ms"))
    segmenter = Segmenter(SileroVad(min_silence_ms=silence_ms))
    log.info("listen: connected (lang=%s, vad_silence_ms=%s)", lang, silence_ms)

    pending_options = deque()      # proposed option-sets awaiting their turn
    awaiting_selection = False     # is an option-set currently shown to her?
    audio_paused = False           # True while user views options; no new frames processed
    muted = False
    frames = 0                     # audio frames received this connection
    received_bytes = 0

    async def release_next() -> None:
        nonlocal awaiting_selection, audio_paused
        if awaiting_selection or not pending_options:
            return
        result = pending_options.popleft()
        awaiting_selection = True
        audio_paused = True
        segmenter.reset()
        log.info("listen: → utterance interaction_id=%s (%d options)",
                 result["interaction_id"], len(result["options"]))
        await ws.send_json({
            "type": "utterance",
            "interaction_id": result["interaction_id"],
            "transcript": result["transcript"],
            "options": [option.model_dump() for option in result["options"]],
        })

    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text") is not None:
                control = json.loads(message["text"])
                kind = control.get("type")
                log.info("listen: control %r", kind)
                if kind == "mute":
                    muted = True
                    segmenter.reset()
                elif kind == "unmute":
                    muted = False
                elif kind == "select":
                    try:
                        text = persona.mark_selected(
                            conn, control["interaction_id"], control["option_id"])
                    except KeyError:
                        await ws.send_json({"type": "error", "detail": "unknown selection"})
                        continue
                    spoken = utterance.compose(text, lang)
                    # Unblock audio before releasing next (release_next may re-pause it).
                    audio_paused = False
                    awaiting_selection = False
                    await ws.send_json({"type": "speak", "text": spoken.text,
                                        "lang": spoken.lang})
                    await release_next()      # pops oldest queued set; re-pauses if one exists
                continue

            frame = message.get("bytes")
            if frame is None:
                # Neither text nor bytes — a stray/keepalive frame. Surface it so a
                # client sending the wrong shape (e.g. base64 text) is visible.
                log.warning("listen: message with no text or bytes: keys=%s", list(message))
                continue
            frames += 1
            received_bytes += len(frame)
            if frames == 1:
                log.info("listen: first audio frame (%d bytes)", len(frame))
            elif frames % 100 == 0:
                log.info("listen: %d frames / %d bytes received", frames, received_bytes)
            if muted or audio_paused:
                continue
            segment = segmenter.feed(frame)
            if segment is None:
                continue
            seconds = len(segment.pcm) / 2 / segment.sample_rate
            log.info("listen: segment %d bytes (%.2fs) → transcribing", len(segment.pcm), seconds)
            transcript = await transcriber.transcribe(segment.pcm, lang)
            if not transcript.text.strip():
                log.info("listen: empty transcript, skipping")
                continue
            log.info("listen: transcript %r", transcript.text)
            result = await propose(conn, context_text=transcript.text, lang=lang,
                                   context_type="audio", asr_model=config.MODEL_ASR)
            result["transcript"] = transcript.text
            pending_options.append(result)
            log.info("listen: proposed %d options (interaction_id=%s), %d queued",
                     len(result["options"]), result["interaction_id"], len(pending_options))
            await release_next()              # sends now only if nothing is awaiting selection
    except WebSocketDisconnect:
        pass
    except Exception:
        # Without this, a failure in transcribe/propose closes the socket with no
        # trace — the "backend stopped receiving" symptom. Log it loudly.
        log.exception("listen: error in receive loop")
    finally:
        conn.close()
        log.info("listen: closed (%d frames, %d bytes received)", frames, received_bytes)


config.MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(config.MEDIA_DIR)), name="media")
