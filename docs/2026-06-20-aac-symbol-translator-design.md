# Eye-Gaze AAC Symbol Translator — Design Spec

- **Date:** 2026-06-21
- **Status:** Revised design (audio-driven input), ready for implementation planning
- **Stack:** Python 3.11 · FastAPI (WebSocket) · SQLite · browser front-end

## 1. Problem

We are building an Augmentative and Alternative Communication (AAC) system for
a person who cannot speak or move, but who **can hear** and can point with her
eyes at symbols on a screen. She communicates by selecting from a symbolic
(pictographic) language.

A conversation partner speaks to her. The front-end captures that speech as a
**live audio stream** and sends it to the backend, which transcribes it. From
the transcript, the system **proposes a small set of likely responses** —
phrased in her voice and rendered as symbol sequences — and she **selects one**.
This turns expression from authoring into picking, which is far less effort for
an eye-gaze user, and removes the typing/dictation step entirely: the partner
just talks.

Because she can hear, the system never needs to show her incoming speech as
symbols. Text→symbol translation is therefore **internal plumbing** (it renders
proposed responses as symbols), not a reading channel for her.

## 2. Goals and non-goals

### Goals (prototype scope)

- Receive a live audio stream of a conversation partner's speech over a
  WebSocket and transcribe it on the backend.
- Detect utterance boundaries (the speaker pausing) on the backend, so each
  finished utterance triggers a fresh set of options — hands-free.
- From the transcript, generate N candidate responses in her voice and render
  each as a symbol sequence.
- Let her select one option; speak the result aloud (Dutch / English).
- A semantic-search core that maps natural-language concepts → best symbols.
- A dictionary seeded from ARASAAC (open-licensed) plus room for custom symbols.
- Dutch-first, English-supported, via one active-language setting.
- An abstracted selection-input layer so mouse/dwell works now and real
  eye-tracking drops in later.
- An abstracted transcriber so cloud Parakeet (OpenRouter) works now and a
  self-hosted Parakeet drops in later.
- Personalization: a persona profile and a log of past picks that bias future
  options.

### Non-goals (explicitly deferred)

- Real eye-tracker or webcam-gaze drivers (only the abstraction is built now).
- A receptive "read incoming speech as symbols" view (she can hear).
- Photo/image context and any LLM vision (the input is audio only now).
- Speaker diarization / separating multiple simultaneous speakers (assume one
  partner speaks at a time).
- Live partial-transcript option streaming (we generate options once per
  finished utterance, not continuously as words arrive).
- A full grammar engine, multi-user support, auth, or cloud deployment.
- Model fine-tuning (we personalize via prompt context only).
- Commercial symbol sets (PCS / Widgit / Bliss).
- Self-hosted ASR and an offline fallback embedder (the interfaces allow both;
  we don't build them now).

## 3. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Primary interaction | Expressive option-picker | Picking ≪ authoring effort for eye-gaze |
| Input modality | Live audio stream of the partner's speech | The partner talks; she picks a reply — hands-free context |
| ASR | NVIDIA Parakeet TDT 0.6b v3 via OpenRouter | Multilingual (EU incl. Dutch), fast, open-weight (self-host later); $0.0015/min |
| Endpointing | Backend VAD (silero-vad) | Cloud ASR is one-shot; we segment utterances ourselves |
| Audio transport | WebSocket; 16 kHz mono PCM16 frames | Low-latency push of audio in and options out, one connection |
| Translation core | Embedding similarity search | Maps meaning → symbols robustly |
| Embedder | `intfloat/multilingual-e5-large` via OpenRouter | 1024-dim, 90+ languages incl. Dutch; same OpenRouter key as ASR + LLM |
| Option generation | GLM-5.2 (`z-ai/glm-5.2`) via OpenRouter | Strong multilingual reasoning; text-only; shares the OpenRouter key with ASR |
| Symbol set | ARASAAC (open) + custom | Free, ~13k pictographs, multilingual keywords |
| Vector store | SQLite (`sqlite-vec`; numpy-blob fallback) | ~13k symbols is trivial; stays in our stack |
| Language | Dutch primary, English supported | One `lang` setting threads through the stack |
| Selection input | Abstracted interface, mouse/dwell driver | Hardware-independent prototype |
| TTS | Browser `SpeechSynthesis` | Zero backend dependency; has `nl-NL` voices |
| Platform | Local web app | Symbol grids + large gaze targets render well in HTML/CSS |

## 4. Architecture

One shared semantic-search core serves the expressive loop. All heavy work
(import, enrich, embed) happens **offline, once**; the live path is fast. The
live path is now driven by audio: the browser streams the partner's speech in,
and the backend pushes symbol options back over the same WebSocket.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  BROWSER  (her screen + room mic)                                              │
│   ┌────────────────────────────────────────────────────────────────────────┐  │
│   │  Mic capture (getUserMedia → AudioWorklet → 16 kHz mono PCM16 frames)   │  │
│   └───────────────────────────────────┬────────────────────────────────────┘  │
│   ┌───────────────────────────────────┴────────────────────────────────────┐  │
│   │  Expressive view: N response options, each a row of large symbol cards  │  │
│   └────────────────────────────────────────────────────────────────────────┘  │
│                                   ▲ selects one                                 │
│   ┌───────────────────────────────┴────────────────────────────────────────┐  │
│   │  SelectionInput (JS)  → onSelect(targetId)                              │  │
│   │  driver now: mouse / dwell    later: eye-tracker, webcam gaze           │  │
│   └────────────────────────────────────────────────────────────────────────┘  │
└───────────────┬───────────────────────────────────────────────▲────────────────┘
        audio frames (WS)                               options push (WS)
┌───────────────┴───────────────────────────────────────────────┴────────────────┐
│  PYTHON BACKEND (FastAPI)                                                        │
│   WS /expressive/listen     POST /expressive/select     POST /translate (dev)    │
│   POST /expressive/options (dev, audio-free)                                     │
│         │                                                                        │
│         ▼                                                                        │
│  ┌───────────────┐  utterance  ┌──────────────┐  text  ┌─────────────────┐      │
│  │ AudioSegmenter│────audio───►│  Transcriber │───────►│ OptionGenerator  │     │
│  │ (VAD endpoint)│             │  (Parakeet)  │        │   (GLM-5.2 LLM)  │     │
│  └───────────────┘             └──────────────┘        └────────┬─────────┘     │
│                                              N × {text, glosses[]}│              │
│                                                                   ▼              │
│  ┌──────────────────────────────────────────────────────────────────────┐      │
│  │  Translator.to_symbols(glosses, lang)   — each gloss → best symbol     │      │
│  └───────────────────────────────┬──────────────────────────────────────┘      │
│                                   ▼                                              │
│                          ┌────────────────┐      ┌────────────────┐             │
│                          │  SymbolSearch  │─────►│   Embedder     │             │
│                          │ cosine top-k   │ uses │  text → vector │             │
│                          └────────────────┘      └────────────────┘             │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  DATA (SQLite + files)                                                          │
│   symbols · symbol_terms(label,description,vector,lang) · persona ·            │
│   interactions · options · settings   media/ (symbol PNGs, utterance audio)    │
└──────────────────────────────────────────────────────────────────────────────┘
   External: OpenRouter (Parakeet ASR + GLM-5.2 LLM + E5 embeddings) · browser TTS · ARASAAC (import only)

┌──────────────────────────────────────────────────────────────────────────────┐
│  OFFLINE INDEXING PIPELINE (run once / on vocab change — NOT in the live path)  │
│   import ARASAAC (nl+en) → enrich descriptions (LLM) → Embedder → write terms   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 5. Modules

Each module has one job and a small interface, so it can be understood and
tested on its own.

| Module | Responsibility | Interface |
|---|---|---|
| `audio_stream.py` | buffer streamed frames; VAD-detect the end of an utterance | `feed(frame) -> Segment?` (emits one utterance's audio on a silence endpoint) |
| `transcriber.py` | utterance audio → text (cloud now, local later) | `transcribe(audio, lang) -> Transcript` |
| `embedder.py` | text → vector (shared by index and query) | `embed(text, kind) -> vec` (`kind`: `query` \| `passage`) |
| `symbol_search.py` | cosine top-k over `symbol_terms` for a language | `search(text, k, lang) -> [Match]` |
| `translator.py` | glosses → symbol sequence; text → glosses | `to_symbols(glosses, lang)`, `glossify(text, lang)` |
| `option_generator.py` | LLM candidate responses from context + persona | `generate(context, persona, history, n, lang) -> [Candidate]` |
| `utterance.py` | chosen option → final text (TTS done in browser) | `compose(option) -> Utterance` |
| `persona.py` | load persona; load recent history; log interactions | `load()`, `recent(n)`, `log(...)` |
| `api.py` | FastAPI routes (incl. the WS), orchestration | the routes in §7 |
| `indexing/` | import ARASAAC · enrich · build embeddings | offline scripts |

A `Candidate` is `{ text: str, glosses: [str] }`. The LLM emits both the natural
sentence **and** its telegraphic content words in one call, so we never need a
separate NLP decomposition step — the model already knows AAC-style core words.

A `Transcript` is `{ text: str, lang: str }` — the recognized words plus the
language (pinned from `settings.lang`, or auto-detected). `audio_stream` and
`transcriber` split deliberately: one decides *where an utterance ends*, the
other *what was said*. Either can be swapped (a different VAD, a self-hosted
Parakeet) without touching the other or the option pipeline.

`embed(text, kind)` carries a `kind` because the E5 embedder expects an
asymmetric prefix — `query:` on a lookup gloss, `passage:` on a stored symbol
description. `symbol_search` embeds with `query`; the offline index embeds with
`passage`. Getting this right materially affects recall.

## 6. Data model (SQLite)

```sql
-- Language-neutral symbol facts
CREATE TABLE symbols (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,            -- 'arasaac' | 'custom'
  external_id  TEXT,                     -- ARASAAC id, nullable
  image_path   TEXT NOT NULL,            -- local file under media/
  is_core      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- Per-language label, description, and the embedding of that description
CREATE TABLE symbol_terms (
  symbol_id    INTEGER NOT NULL REFERENCES symbols(id),
  lang         TEXT NOT NULL,            -- 'nl' | 'en'
  label        TEXT NOT NULL,            -- canonical word, e.g. "meer"
  description  TEXT NOT NULL,            -- enriched gloss; this is what we embed
  vector       BLOB NOT NULL,            -- embedding (sqlite-vec or numpy blob)
  model        TEXT NOT NULL,            -- embedding model id + dims
  PRIMARY KEY (symbol_id, lang)
);

-- The learning log: one row per context (utterance) presented to her
CREATE TABLE interactions (
  id                 INTEGER PRIMARY KEY,
  ts                 TEXT NOT NULL,
  lang               TEXT NOT NULL,
  context_type       TEXT NOT NULL,      -- 'audio' (product) | 'text' (dev)
  context_text       TEXT NOT NULL,      -- the transcript (or dev-supplied text)
  context_audio_path TEXT,               -- utterance clip under media/, nullable
  asr_model          TEXT                -- ASR provenance; null for dev 'text'
);

-- Candidate options generated for an interaction; her pick is the signal
CREATE TABLE options (
  id              INTEGER PRIMARY KEY,
  interaction_id  INTEGER NOT NULL REFERENCES interactions(id),
  rank            INTEGER NOT NULL,
  text            TEXT NOT NULL,
  glosses         TEXT NOT NULL,         -- json array of gloss strings
  symbol_sequence TEXT NOT NULL,         -- json array of symbol ids
  was_selected    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE persona (
  id           INTEGER PRIMARY KEY,
  profile      TEXT NOT NULL,            -- personality, tone, relationships, preferences
  reading_level TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- lang='nl', option_count='5',
                                         -- match_threshold='0.30',
                                         -- vad_silence_ms='800',
                                         -- asr_model='nvidia/parakeet-tdt-0.6b-v3'
);
```

The same embedding model must produce both the dictionary vectors and the query
vectors. `symbol_terms.model` records which model was used; changing the model
means re-indexing. Per-language rows let a Dutch query match Dutch descriptions
directly (strictly more accurate than cross-lingual matching, at negligible
cost). `settings.lang` is the single source of truth for the active language;
it selects the ARASAAC locale, which `symbol_terms` rows to search, the language
Parakeet transcribes in, the language GLM-5.2 writes in, and the TTS voice.
`vad_silence_ms` is how long a pause counts as the end of an utterance; it is the
main knob for turn-taking feel.

## 7. API endpoints

One user-facing WebSocket (the live audio loop) and one user-facing POST (commit
and speak), plus two dev/curation endpoints. Text→symbol translation is
otherwise an internal service.

### `WS /expressive/listen` — listen and propose (the centerpiece)

- **Client → server:** binary audio frames (16 kHz mono PCM16, ~20 ms each).
- **Per connection, the server:** feeds frames to `AudioSegmenter`; on a silence
  endpoint it takes the buffered utterance audio → `Transcriber.transcribe` →
  if the transcript is non-empty, load persona + recent picks →
  `OptionGenerator.generate` (GLM-5.2) → for each candidate
  `Translator.to_symbols(glosses)` → persist one `interactions` row
  (`context_type='audio'`) + N `options` rows → push the result.
- **Server → client (JSON events):**
  - `{ type: 'utterance', interaction_id, transcript,
      options: [ { option_id, text,
        symbols: [ { id, label, image_url, confidence } ] } ] }`
  - `{ type: 'error', code, message }`
- Selection is a separate call (`POST /expressive/select`); the socket is for
  the audio-in / options-out loop.

### `POST /expressive/select` — commit and speak

- **In:** `{ interaction_id, option_id }`.
- **Does:** set `options.was_selected = 1` (learning signal) →
  `UtteranceComposer.compose`.
- **Out:** `{ text, lang }` — the browser speaks it via `SpeechSynthesis`.

### `POST /expressive/options` — dev / test (audio-free)

- **In:** `{ text, lang }` — a transcript supplied directly, no audio.
- **Does:** the same post-ASR pipeline (`OptionGenerator.generate` →
  `Translator.to_symbols`); persist `interactions` (`context_type='text'`) + N
  `options` rows.
- **Out:** `{ interaction_id, options: [ … ] }` (same shape as the WS event).
- **Use:** deterministic testing of option generation + symbol mapping without
  exercising the mic, VAD, or ASR.

### `POST /translate` — dev / caregiver curation (not her UI)

- **In:** `{ text, lang }`.
- **Does:** `Translator.glossify(text)` → `Translator.to_symbols(glosses)`.
- **Out:** `{ glosses, symbols: [ { id, label, image_url, confidence } ] }`.
- **Use:** tuning the semantic search (recall@k eval) and letting a caregiver
  see/fix how phrases map to symbols while building vocabulary.

## 8. Data flow

**Expressive turn (the centerpiece):**

1. A conversation partner speaks near her device.
2. The browser captures the mic and streams 16 kHz mono PCM16 frames over
   `WS /expressive/listen`.
3. `AudioSegmenter` runs VAD; when the speaker pauses (silence ≥
   `vad_silence_ms`), it closes the utterance and emits its audio.
4. `Transcriber` sends the utterance audio to Parakeet (OpenRouter) → transcript
   (Dutch/English per `settings.lang`).
5. The transcript becomes the context: `OptionGenerator` asks GLM-5.2 for N
   responses in her voice, grounded in persona + recent picks. Each response
   carries `{ text, glosses }`.
6. Each gloss is embedded and matched to its best symbol (top-1 above the
   confidence threshold). The option becomes a symbol sequence. One
   `interactions` row + N `options` rows are persisted.
7. The backend pushes `{ transcript, options }` over the WS; the browser shows N
   rows of large symbol cards.
8. She selects one via `SelectionInput` → `POST /expressive/select` records the
   pick and returns the final text; the browser speaks it in the active language.
9. The pick is logged and feeds the next turn's persona context.

**Internal translation** (used inside step 6, and exposed via `/translate` for
dev/curation) is the only use of text→symbol mapping.

## 9. External services

- **OpenRouter — Parakeet TDT 0.6b v3** — speech→text on each utterance, behind
  the `Transcriber` interface. OpenAI-compatible `POST /v1/audio/transcriptions`
  (audio clip in → text + segment timestamps out), EU-language coverage incl.
  Dutch, $0.0015/min. A self-hosted Parakeet (NeMo) can replace it later behind
  the same interface.
- **GLM-5.2 (`z-ai/glm-5.2`)** — text-only option generation, and the offline
  ARASAAC enrichment pass. 1M-token context; $1.20 / $4.10 per 1M tokens;
  OpenAI-compatible chat completions. Shares the OpenRouter key with Parakeet.
- **`intfloat/multilingual-e5-large` (via OpenRouter)** — embeddings, 1024 dims,
  90+ languages, $0.01/M tokens, behind the `Embedder` interface. Expects E5's
  `query:` / `passage:` input prefixes (see §5).
- **Browser `SpeechSynthesis`** — TTS (`nl-NL` / `en` voices).
- **ARASAAC** — pictograph images + multilingual keywords, at import time only.

One external API key: OpenRouter serves ASR, the LLM, and embeddings. The only
other externals — browser TTS and the one-time ARASAAC import — need no key.

## 10. Offline indexing pipeline

Run once, and again whenever the vocabulary changes. Not in the live path.

1. `import_arasaac` — fetch pictographs + `nl` and `en` keywords; store images
   under `media/`; insert `symbols` rows.
2. `enrich` — one GLM-5.2 pass per symbol per language: expand the keyword into a
   richer description ("meer, nog een, extra, ik wil nog") for better recall.
3. `build_index` — embed each `symbol_terms.description` (E5 `passage:` prefix);
   write `vector` + `model`.

## 11. Error handling and edge cases

- **Silence / no speech:** VAD never endpoints; nothing is sent. Correct
  behavior — no utterance, no options.
- **ASR failure or timeout:** push `{ type: 'error' }`; the UI shows "couldn't
  hear that" and keeps listening. No options is better than wrong options.
- **Empty or garbled transcript:** if the transcript is empty or below a minimum
  length, skip option generation (optionally signal "didn't catch that").
- **Mis-cut turn (VAD too eager/lax):** tune `vad_silence_ms`; if the partner
  keeps talking, the next segment simply produces the next set of options.
  Acceptable for a prototype.
- **WebSocket drop:** the browser reconnects; any in-flight utterance is
  discarded. No partial options are shown.
- **Low-confidence match:** if a gloss's best symbol is below
  `settings.match_threshold`, the card shows the gloss **as text** instead of a
  wrong picture, and is flagged for curation. Never show a confidently-wrong
  symbol.
- **Option-generation (LLM) failure:** push an error; the UI keeps listening for
  the next utterance.
- **Embedding API failure:** the search cannot run; push an error. (A local
  fallback embedder is a future option behind the same interface.)
- **Stale/unknown selection:** reject `select` for an unknown `interaction_id`
  or `option_id`.

## 12. Testing strategy

- **Unit:** `audio_stream` (VAD boundaries on fixture audio with known
  silences — speech segmented at the right points), `transcriber` (mocked
  OpenRouter → `Transcript`), `embedder` (shape/determinism, mocked API),
  `symbol_search` (expected top-k on a tiny fixture dictionary), `translator`
  (glosses → sequence; threshold behavior), `option_generator` (mocked LLM →
  valid `{text, glosses}`), `utterance` (compose).
- **Integration:** fake audio frames → `AudioSegmenter` → fake `Transcriber` →
  real option pipeline → options. The `POST /expressive/options` dev endpoint
  drives the same pipeline audio-free for a deterministic check: text → options
  → select → text.
- **Retrieval eval (the riskiest piece):** a curated set of
  `query → expected symbol` pairs in `nl` and `en`; measure **recall@k**. This
  is the primary signal for tuning descriptions, the threshold, and `k`. The
  `/translate` endpoint drives this harness.

## 13. Tech stack

- Python 3.11, FastAPI + Uvicorn, with FastAPI's native WebSocket support for
  `/expressive/listen`.
- Backend VAD via `silero-vad` (accurate endpointing; `webrtcvad` is a lighter,
  torch-free fallback if the dependency weight matters).
- OpenRouter HTTP client for Parakeet transcription (OpenAI-compatible
  `/v1/audio/transcriptions`); utterance PCM is wrapped as a WAV per request.
- SQLite with `sqlite-vec` (numpy brute-force cosine as fallback — ~13k symbols
  is <10 ms either way).
- `intfloat/multilingual-e5-large` via OpenRouter (embeddings, 1024 dims);
  GLM-5.2 via OpenRouter (`z-ai/glm-5.2`, text-only option generation + offline
  enrichment). One OpenRouter client serves ASR, LLM, and embeddings.
- Front-end: plain HTML/CSS/JS — a grid of large targets, dwell-to-select,
  browser `SpeechSynthesis` for speech, and `getUserMedia` + an `AudioWorklet`
  to capture the mic, downsample to 16 kHz mono PCM16, and stream frames over the
  WebSocket. (Browser `SpeechRecognition` is no longer used; transcription is on
  the backend.)

## 14. Open questions and future work

- **VAD library:** `silero-vad` (accurate, pulls torch) vs. `webrtcvad`
  (lighter, cruder). Default to silero; revisit if the dependency or latency
  hurts.
- **Language: pin vs. auto-detect:** Parakeet can auto-detect, but pinning to
  `settings.lang` is more predictable for a Dutch-first user. Default to pinned;
  expose auto-detect later if she switches languages mid-conversation.
- **Persisting utterance audio:** `context_audio_path` lets us replay mis-hears
  and re-run ASR offline; weigh against storage and privacy before enabling by
  default.
- **Option count:** default 5; expose in `settings`. Eye-gaze favours few, large
  targets — tune with the user.
- **Privacy:** the partner's speech (audio + transcript) and her words are sent
  to OpenRouter (ASR, LLM, and embeddings). Acceptable for a prototype; a real
  deployment needs a conscious data-handling decision — and is the strongest
  argument for self-hosting Parakeet and a local fallback embedder.
- **Multi-symbol per gloss:** v1 maps one gloss → one symbol. Some concepts need
  a small phrase of symbols; revisit if recall@k shows misses.
- **Real eye-tracking:** add a `SelectionInput` driver (Tobii SDK or webcam/
  MediaPipe) without touching the rest of the stack.
- **Self-hosted ASR:** swap cloud Parakeet for a local NeMo Parakeet behind the
  `Transcriber` interface — for privacy, offline use, and cost.
- **Learning beyond prompt context:** today picks bias the LLM prompt; later we
  could re-rank options or symbols from her history.
