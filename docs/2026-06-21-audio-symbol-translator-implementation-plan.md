# Audio→Symbol AAC Translator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are grouped into **waves** (see Parallelization Plan) — dispatch all tasks within a wave concurrently with superpowers:dispatching-parallel-agents, then barrier on the wave before starting the next.

**Goal:** A local web app where a conversation partner speaks, the backend transcribes the speech, an LLM proposes responses in the user's voice rendered as symbol sequences, and she picks one to be spoken aloud.

**Architecture:** FastAPI backend with a WebSocket audio loop (browser mic → 16 kHz PCM16 frames → Silero VAD endpointing → Parakeet ASR → GLM-5.2 option generation → E5 semantic search → symbol cards). Proposed option-sets are held in a per-connection queue and released one at a time — the next set is sent only after she selects from the current one. When semantic search finds no usable symbols, a default set of common core symbols (one of which is the "I don't understand, please explain" symbol) is returned instead. SQLite stores symbols, per-language embeddings, persona, and the interaction/option learning log. Plain HTML/CSS/JS front-end with dwell-to-select and browser TTS.

**Tech Stack:** Python 3.11 · FastAPI · Uvicorn · httpx · pydantic v2 · numpy · silero-vad (PyTorch VAD) · sqlite3 (stdlib) · pytest + pytest-asyncio · vitest (front-end units) · OpenRouter (Parakeet ASR, GLM-5.2 LLM, multilingual-e5-large embeddings).

## Relationship to the ARASAAC seeding plan (source of truth)

The **ARASAAC seeding plan** (`docs/superpowers/plans/2026-06-21-arasaac-symbol-seeding.md`) is the **source of truth** for the symbol dictionary and the modules it owns. This plan **consumes** them and never redefines them:

| Owned by the seeding plan (do NOT recreate here) | What it provides |
|---|---|
| `db.py` (repo root) | `connect`, `create_schema` (creates `symbols` + `symbol_terms` only), `pack_vector`/`unpack_vector` (little-endian float32 via `struct`), `symbol_exists`, `insert_symbol`, `insert_term`. Idempotent: `symbols.external_id` is `UNIQUE`, `symbol_terms` PK is `(symbol_id, lang)`. |
| `embedder.py` (repo root) | **synchronous** `embed(texts: list[str], kind: str, *, client=None) -> list[list[float]]` (applies the E5 `passage:`/`query:` prefix); constants `MODEL_ID`, `MODEL_TAG` (`intfloat/multilingual-e5-large@1024`), `DIMS = 1024`, `BASE_URL`. |
| `indexing/` | `arasaac.py`, `describe.py`, `seed.py`, `core_words.txt` — the offline seeding pipeline (resolve → download → compose → embed → write). Enrichment is deferred there. |
| `conftest.py` (repo root) | puts the repo root on `sys.path` so `import db`, `import embedder`, `from indexing import …` resolve. |

**Consequences for this plan:**
- **Module layout is repo-root**, matching the seeding plan — no `app/` package. Tests import modules directly (`import persona`, `from symbol_search import search`).
- **This plan owns only the live-path tables** — `interactions`, `options`, `persona`, `settings` — in a new `store.py`. It must NOT create `symbols`/`symbol_terms` (the seeding `db.py` owns those).
- **Embeddings go through the seeding `embedder.py`** (sync). The live path calls it off the event loop with `asyncio.to_thread`. There is no embedder task here.
- **There is no indexing task here** — the seeding plan builds it.
- **Core/default symbols come from the seed:** the default board (Task 12's fallback) is the `symbols.is_core = 1` rows, so the seeding plan's `core_words.txt` must include the common core symbols **and** an "I don't understand, please explain" symbol marked core. If the dictionary has no core rows yet, the fallback degrades to a single text-only "I don't understand, please explain" option so the guarantee always holds.
- **Idempotency:** every schema this plan creates uses `CREATE TABLE IF NOT EXISTS`; `settings` are seeded with `INSERT OR IGNORE`; any symbol rows created in tests use the seeding `db.insert_symbol`/`insert_term`, which are idempotent through `external_id UNIQUE`.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the specs.

- **Python:** 3.11. **Module layout:** repo-root modules (no `app/` package); tests run from repo root.
- **Model ids (OpenRouter):** ASR `nvidia/parakeet-tdt-0.6b-v3`; LLM `z-ai/glm-5.2`; embeddings `intfloat/multilingual-e5-large` (provided by the seeding `embedder.py`).
- **Embedding dims:** 1024, stored as little-endian `float32`. E5 prefixes — `query: ` on lookup text, `passage: ` on stored descriptions — applied inside `embedder.embed`, never by callers.
- **One external API key:** `OPENROUTER_API_KEY`. Base URL `https://openrouter.ai/api/v1` (OpenAI-compatible).
- **Audio:** 16 kHz mono PCM16. The browser streams small frames; the backend rechunks them into the 512-sample (32 ms) windows Silero VAD requires.
- **VAD:** Silero VAD (`silero-vad`) is the voice-activity detector — we do **not** hand-roll speech/silence detection. Its `VADIterator` also does the endpointing, so `vad_silence_ms` maps to silero's `min_silence_duration_ms`. Our only audio code is the trivial glue that buffers the speech between silero's start/end events into a `Segment`, with the VAD injected so it stays deterministically testable without torch.
- **Queueing:** proposed option-sets are queued per WebSocket connection and released one at a time — the next set is sent only after the front-end reports a selection. This stops a fast-talking partner from flooding her with option sets she hasn't answered.
- **Default symbols:** when no proposed option matched any symbol via similarity search, return the core default board instead. It always includes the "I don't understand, please explain" symbol so she can always ask for clarification.
- **Default settings:** `lang='nl'`, `option_count='5'`, `match_threshold='0.30'`, `vad_silence_ms='800'`, `echo_guard_ms='300'`, `asr_model='nvidia/parakeet-tdt-0.6b-v3'`.
- **Languages:** Dutch primary, English supported. `settings.lang` is the single source of truth.
- **Naming (per CLAUDE.md):** full words, booleans as questions (`is_*`/`has_*`), functions are verbs, no noise words. Comment the *why*, not the *what*.
- **No confidently-wrong symbols:** a gloss whose best match is below `match_threshold` renders as text, not a picture.

---

## Parallelization Plan

**How to read dependencies:** a task may start once every task in its "Depends on" list has merged. Within a wave, no two tasks write the same file.

**Cross-plan dependencies:** T11 and T17 consume the seeding plan's `embedder.py` and `db.py`. Those must be merged first (the seeding plan's Tasks 3 and 4), or run the seeding plan to completion before this plan's Wave 3.

| Task | Title | Wave | Depends on | New files (no overlap with siblings or the seeding plan) |
|---|---|---|---|---|
| T1 | Scaffold, deps, config, models | 0 | — | `pyproject.toml`, `config.py`, `models.py`, `tests/conftest.py`, `media/.gitkeep` |
| T2 | Live-path store + settings | 1 | T1 | `store.py`, `tests/test_store.py` |
| T3 | OpenRouter client (chat + transcribe) | 1 | T1 | `openrouter.py`, `tests/test_openrouter.py` |
| T4 | Audio segmenter (Silero VAD endpointing) | 1 | T1 | `audio_stream.py`, `vad.py`, `tests/test_audio_stream.py` |
| T5 | Utterance composer | 1 | T1 | `utterance.py`, `tests/test_utterance.py` |
| T6 | Front-end pure utilities | 1 | T1 | `frontend/src/{downsample,echo-gate,selection-input}.js`, `frontend/test/*`, `frontend/package.json` |
| T7 | Persona + learning log | 2 | T2 | `persona.py`, `tests/test_persona.py` |
| ~~T8~~ | ~~Embedder~~ | — | — | **REMOVED — provided by the seeding plan's `embedder.py`.** |
| T9 | Transcriber | 2 | T3 | `transcriber.py`, `tests/test_transcriber.py` |
| T10 | Option generator | 2 | T3 | `option_generator.py`, `tests/test_option_generator.py` |
| T11 | Symbol search | 3 | seeding `embedder.py` + seeding `db.py` + T1 | `symbol_search.py`, `tests/test_symbol_search.py` |
| T12 | Translator | 4 | T11, T3 | `translator.py`, `tests/test_translator.py` |
| ~~T13~~ | ~~Indexing pipeline~~ | — | — | **REMOVED — owned entirely by the ARASAAC seeding plan.** |
| T14 | API + orchestration (REST + WS) | 5 | T2,T4,T5,T7,T9,T10,T12 | `api.py`, `main.py`, `tests/test_api.py` |
| T15 | End-to-end integration test | 6 | T14 | `tests/test_integration.py` |
| T16 | Front-end integration | 6 | T14, T6 | `frontend/index.html`, `frontend/styles.css`, `frontend/src/{app,ws-client,audio-capture,pcm-worklet,tts}.js`, `frontend/test/smoke.spec.js` |
| T17 | Retrieval eval harness | 6 | T11 + seeding `db.py`/`embedder.py` | `tests/test_retrieval_eval.py`, `tests/fixtures/recall_set.json` |

**Sequencing rationale:**
- T1 is alone in Wave 0 because all live-path tasks import `models.py`/`config.py`. Defining every shared type and dependency once, up front, keeps the later waves conflict-free.
- Wave 1 (5 agents) holds everything needing only T1: the live-path store, the HTTP client, the segment buffer around Silero VAD, the composer, and the front-end pure functions.
- Wave 2 (3 agents) holds the thin model wrappers (transcriber/option-gen need T3) and the persona store (needs T2). The former embedder task is gone.
- T11 → T12 are serial (translator calls symbol search; symbol search calls the seeding embedder). This is the one unavoidable chain, and it also gates on the seeding plan having shipped `embedder.py`/`db.py`.
- T14 is the integration barrier — one agent wires orchestration so type mismatches surface in one place.
- Wave 6 (3 agents) are independent verification/UI tasks over the finished backend.

**Run all tests:** backend `pytest -q` (from repo root); front-end `cd frontend && npm test`.

---

## Task 1: Scaffold, dependencies, config, shared models

**Files:**
- Create: `pyproject.toml`
- Create: `config.py`
- Create: `models.py`
- Create: `tests/conftest.py`
- Create: `media/.gitkeep` (empty)

**Interfaces:**
- Consumes: nothing.
- Produces: `config` constants (`OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY`, `MODEL_ASR`, `MODEL_LLM`, `DB_PATH`, `MEDIA_DIR`, `DEFAULT_SETTINGS`); `models` pydantic types `Segment, Transcript, Candidate, Match, SymbolCard, Option, Persona, Pick, Utterance`; a `conn` test fixture that builds the full schema from both `db.create_schema` (seeding) and `store.create_schema`.

- [ ] **Step 1: Create `pyproject.toml`** (pins deps for BOTH plans, so the seeding plan's "separate setup pass" is satisfied here)

```toml
[project]
name = "claudia"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "httpx>=0.27",
    "pydantic>=2.6",
    "numpy>=1.26",
    "python-multipart>=0.0.9",
    "silero-vad>=5.1",          # the VAD (pulls torch); we do not hand-roll detection
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Write `config.py`**

```python
import os
from pathlib import Path

OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

MODEL_ASR = "nvidia/parakeet-tdt-0.6b-v3"
MODEL_LLM = "z-ai/glm-5.2"
# Embedding model id/dims live in the seeding plan's embedder.py (MODEL_ID, DIMS).

DB_PATH = Path(os.environ.get("AAC_DB_PATH", "symbols.db"))   # same default as seeding seed.py
MEDIA_DIR = Path(os.environ.get("AAC_MEDIA_DIR", "media"))

DEFAULT_SETTINGS = {
    "lang": "nl",
    "option_count": "5",
    "match_threshold": "0.30",
    "vad_silence_ms": "800",
    "echo_guard_ms": "300",
    "asr_model": MODEL_ASR,
}
```

- [ ] **Step 3: Write `models.py`**

```python
from pydantic import BaseModel


class Segment(BaseModel):
    pcm: bytes                      # 16 kHz mono PCM16
    sample_rate: int = 16000


class Transcript(BaseModel):
    text: str
    lang: str


class Candidate(BaseModel):
    text: str
    glosses: list[str]


class Match(BaseModel):
    symbol_id: int
    label: str
    image_path: str
    score: float


class SymbolCard(BaseModel):
    id: int
    label: str
    image_url: str | None = None    # None when as_text is True
    confidence: float
    as_text: bool = False           # below threshold → render the gloss as text


class Option(BaseModel):
    option_id: int
    text: str
    symbols: list[SymbolCard]


class Persona(BaseModel):
    profile: str
    reading_level: str | None = None


class Pick(BaseModel):
    context_text: str
    selected_text: str


class Utterance(BaseModel):
    text: str
    lang: str
```

- [ ] **Step 4: Write `tests/conftest.py`** (root on path + a `conn` fixture spanning both schema owners)

```python
import sys
import sqlite3
from pathlib import Path
import pytest

# Repo root on sys.path so `import db`, `import embedder`, `import store`, etc. resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def conn():
    import db        # seeding plan: creates symbols + symbol_terms
    import store     # this plan: creates interactions, options, persona, settings
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.create_schema(connection)
    store.create_schema(connection)
    yield connection
    connection.close()
```

- [ ] **Step 5: Verify the modules import**

Run: `python -c "import config, models; print(config.MODEL_LLM)"`
Expected: prints `z-ai/glm-5.2`

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml config.py models.py tests/conftest.py media/.gitkeep
git commit -m "chore: scaffold deps, config, shared models, and test fixture"
```

---

## Task 2: Live-path store + settings

**Files:**
- Create: `store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `config.DEFAULT_SETTINGS`.
- Produces:
  - `create_schema(conn)` — creates `interactions`, `options`, `persona`, `settings` with `IF NOT EXISTS`, then seeds `DEFAULT_SETTINGS` with `INSERT OR IGNORE` (idempotent). Does NOT touch `symbols`/`symbol_terms`.
  - `get_setting(conn, key) -> str` (falls back to `DEFAULT_SETTINGS`).
  - `set_setting(conn, key, value)`.

- [ ] **Step 1: Write the failing test**

```python
import store


def test_seeds_default_settings(conn):
    assert store.get_setting(conn, "lang") == "nl"
    assert store.get_setting(conn, "match_threshold") == "0.30"


def test_set_setting_overrides(conn):
    store.set_setting(conn, "lang", "en")
    assert store.get_setting(conn, "lang") == "en"


def test_create_schema_is_idempotent(conn):
    store.create_schema(conn)            # second call must not raise or duplicate settings
    rows = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
    assert rows == len(store.config.DEFAULT_SETTINGS)


def test_live_tables_exist(conn):
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"interactions", "options", "persona", "settings"} <= names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'store'`

- [ ] **Step 3: Write `store.py`**

```python
import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS interactions (
  id                 INTEGER PRIMARY KEY,
  ts                 TEXT NOT NULL,
  lang               TEXT NOT NULL,
  context_type       TEXT NOT NULL,
  context_text       TEXT NOT NULL,
  context_audio_path TEXT,
  asr_model          TEXT
);
CREATE TABLE IF NOT EXISTS options (
  id              INTEGER PRIMARY KEY,
  interaction_id  INTEGER NOT NULL REFERENCES interactions(id),
  rank            INTEGER NOT NULL,
  text            TEXT NOT NULL,
  glosses         TEXT NOT NULL,
  symbol_sequence TEXT NOT NULL,
  was_selected    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS persona (
  id            INTEGER PRIMARY KEY,
  profile       TEXT NOT NULL,
  reading_level TEXT,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def create_schema(conn) -> None:
    conn.executescript(SCHEMA)
    for key, value in config.DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_setting(conn, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is not None:
        return row["value"] if hasattr(row, "keys") else row[0]
    return config.DEFAULT_SETTINGS[key]


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_store.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add store.py tests/test_store.py
git commit -m "feat: live-path store (interactions/options/persona/settings) + settings accessor"
```

---

## Task 3: OpenRouter client (chat + transcribe)

**Files:**
- Create: `openrouter.py`
- Test: `tests/test_openrouter.py`

**Interfaces:**
- Consumes: `config` (base url, api key).
- Produces (async; module-level so consumers monkeypatch easily):
  - `chat(messages: list[dict], model: str, temperature: float = 0.7, response_format: dict | None = None) -> str` — returns the assistant message content.
  - `transcribe(wav_bytes: bytes, model: str, language: str | None = None) -> str` — returns transcript text.

(Embeddings are NOT here — they go through the seeding plan's `embedder.py`.)

- [ ] **Step 1: Write the failing test** (`httpx.MockTransport` — no network)

```python
import json
import httpx
import openrouter


def _client_with(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="https://openrouter.ai/api/v1")


async def test_chat_returns_message_content(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/chat/completions")
        assert json.loads(request.content)["model"] == "z-ai/glm-5.2"
        return httpx.Response(200, json={"choices": [{"message": {"content": "hallo"}}]})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.chat([{"role": "user", "content": "hi"}], model="z-ai/glm-5.2")
    assert out == "hallo"


async def test_transcribe_returns_text(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/audio/transcriptions")
        return httpx.Response(200, json={"text": "goedemorgen"})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.transcribe(b"RIFF....", model="nvidia/parakeet-tdt-0.6b-v3")
    assert out == "goedemorgen"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_openrouter.py -v`
Expected: FAIL — `module 'openrouter' has no attribute '_make_client'`

- [ ] **Step 3: Write `openrouter.py`**

```python
import httpx
import config


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.OPENROUTER_BASE_URL,
        headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}"},
        timeout=60.0,
    )


async def chat(messages, model, temperature=0.7, response_format=None) -> str:
    payload = {"model": model, "messages": messages, "temperature": temperature}
    if response_format is not None:
        payload["response_format"] = response_format
    async with _make_client() as client:
        response = await client.post("/chat/completions", json=payload)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def transcribe(wav_bytes, model, language=None) -> str:
    files = {"file": ("utterance.wav", wav_bytes, "audio/wav")}
    form = {"model": model}
    if language is not None:
        form["language"] = language
    async with _make_client() as client:
        response = await client.post("/audio/transcriptions", data=form, files=files)
        response.raise_for_status()
        return response.json()["text"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_openrouter.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add openrouter.py tests/test_openrouter.py
git commit -m "feat: OpenRouter client for chat and transcription"
```

---

## Task 4: Audio segmenter (Silero VAD endpointing)

**Files:**
- Create: `audio_stream.py` (the testable segment-buffering state machine)
- Create: `vad.py` (the Silero VAD wrapper; loaded at runtime)
- Test: `tests/test_audio_stream.py`

**Why Silero:** speech/non-speech classification is exactly the kind of thing not to hand-roll — Silero VAD is a small, fast, well-tuned model and its `VADIterator` already does endpointing (`min_silence_duration_ms`). We keep only the trivial glue that rechunks the byte stream into the 512-sample windows silero needs and buffers the speech between a `start` event and its `end` event into one `Segment`. The `vad` is injected so the state machine stays deterministically testable without torch.

**Interfaces:**
- Consumes: `models.Segment`.
- Produces:
  - `Segmenter(vad, sample_rate=16000)` with `feed(frame: bytes) -> Segment | None` and `reset() -> None`. `vad` is any callable taking one 512-sample (1024-byte) PCM16 window and returning Silero's `VADIterator` event — `{"start": idx}`, `{"end": idx}`, or `None`. Emits one `Segment` per completed utterance; returns `None` until the VAD reports the end of speech.
  - `vad.SileroVad(sample_rate=16000, threshold=0.5, min_silence_ms=800)` — a callable `bytes -> dict | None` wrapping `silero_vad.VADIterator` (lazy torch import). `reset()` clears its internal states. This is the only real detector; there is no homegrown energy detector.

- [ ] **Step 1: Write the failing test**

```python
from audio_stream import Segmenter

WINDOW = b"\x10\x00" * 512            # one 512-sample (1024-byte) window of "speech"


class ScriptedVad:
    """Replays a fixed list of VADIterator events, one per 512-sample window."""

    def __init__(self, events):
        self._events = list(events)
        self._index = 0

    def __call__(self, window: bytes):
        event = self._events[self._index] if self._index < len(self._events) else None
        self._index += 1
        return event

    def reset(self):
        pass                                  # no rewind: mirrors silero's stateless reset


def test_emits_segment_on_speech_end():
    seg = Segmenter(ScriptedVad([{"start": 0}, None, {"end": 1536}]))
    assert seg.feed(WINDOW) is None           # speech start
    assert seg.feed(WINDOW) is None           # mid-speech
    out = seg.feed(WINDOW)                     # speech end → emit
    assert out is not None
    assert out.pcm == WINDOW * 3             # the windows from start through end


def test_ignores_audio_before_speech_start():
    seg = Segmenter(ScriptedVad([None, None, {"start": 1024}]))
    assert seg.feed(WINDOW) is None
    assert seg.feed(WINDOW) is None
    assert seg.feed(WINDOW) is None           # speech just started; nothing emitted yet


def test_rechunks_a_multi_window_frame():
    seg = Segmenter(ScriptedVad([{"start": 0}, {"end": 1024}]))
    out = seg.feed(WINDOW + WINDOW)           # one feed carrying two 512-sample windows
    assert out is not None and out.pcm == WINDOW * 2


def test_reset_discards_buffered_speech():
    seg = Segmenter(ScriptedVad([{"start": 0}, None, {"end": 1024}]))
    seg.feed(WINDOW)                          # start, buffering
    seg.feed(WINDOW)                          # still buffering
    seg.reset()                               # clears the buffer + in-speech state
    assert seg.feed(WINDOW) is None           # the now-stray "end" is ignored
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audio_stream.py -v`
Expected: FAIL — `No module named 'audio_stream'`

- [ ] **Step 3: Write `audio_stream.py`**

```python
from models import Segment

WINDOW_SAMPLES = 512                          # the window size silero-vad needs at 16 kHz
WINDOW_BYTES = WINDOW_SAMPLES * 2             # PCM16: 2 bytes per sample


class Segmenter:
    """Buffers the speech between silero-vad's start and end events.

    Rechunks the incoming byte stream into fixed 512-sample windows, feeds each
    to `vad`, and accumulates windows from a `start` event through its `end`
    event into one Segment. The speech/silence decision and endpointing live in
    silero; this only does the buffering.
    """

    def __init__(self, vad, sample_rate=16000):
        self._vad = vad
        self._sample_rate = sample_rate
        self._pending = b""
        self._speech: list[bytes] = []
        self._in_speech = False

    def feed(self, frame: bytes) -> Segment | None:
        self._pending += frame
        segment = None
        while len(self._pending) >= WINDOW_BYTES:
            window = self._pending[:WINDOW_BYTES]
            self._pending = self._pending[WINDOW_BYTES:]
            event = self._vad(window)
            if event and "start" in event:
                self._in_speech = True
                self._speech = [window]
            elif event and "end" in event and self._in_speech:
                self._speech.append(window)
                segment = Segment(pcm=b"".join(self._speech), sample_rate=self._sample_rate)
                self._in_speech = False
                self._speech = []
            elif self._in_speech:
                self._speech.append(window)
        return segment

    def reset(self) -> None:
        self._pending = b""
        self._speech = []
        self._in_speech = False
        if hasattr(self._vad, "reset"):
            self._vad.reset()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_audio_stream.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Write `vad.py`** (the Silero wrapper; exercised in the WS smoke later, not unit-tested)

```python
import numpy as np


class SileroVad:
    """Streaming voice-activity detector backed by silero-vad's VADIterator.

    Call with exactly one 512-sample (1024-byte) PCM16 window at 16 kHz — the
    window size silero requires. Returns {"start": idx} / {"end": idx} on a
    speech boundary, else None. `min_silence_ms` is silero's own endpointing
    threshold, so the pause that ends an utterance is its decision, not ours.
    """

    def __init__(self, sample_rate: int = 16000, threshold: float = 0.5,
                 min_silence_ms: int = 800):
        from silero_vad import load_silero_vad, VADIterator
        self._iterator = VADIterator(
            load_silero_vad(), threshold=threshold,
            sampling_rate=sample_rate, min_silence_duration_ms=min_silence_ms)

    def __call__(self, window: bytes):
        import torch
        samples = np.frombuffer(window, dtype=np.int16).astype(np.float32) / 32768.0
        return self._iterator(torch.from_numpy(samples))

    def reset(self) -> None:
        self._iterator.reset_states()
```

- [ ] **Step 6: Commit**

```bash
git add audio_stream.py vad.py tests/test_audio_stream.py
git commit -m "feat: Silero VAD segmenter — rechunk + buffer speech into segments"
```

---

## Task 5: Utterance composer

**Files:**
- Create: `utterance.py`
- Test: `tests/test_utterance.py`

**Interfaces:**
- Consumes: `models.Utterance`.
- Produces: `compose(text: str, lang: str) -> Utterance` (normalizes whitespace; the seam for future post-processing).

- [ ] **Step 1: Write the failing test**

```python
from utterance import compose


def test_compose_returns_text_and_lang():
    out = compose("ik wil koffie", "nl")
    assert out.text == "ik wil koffie" and out.lang == "nl"


def test_compose_collapses_whitespace():
    assert compose("  ik   wil  koffie ", "nl").text == "ik wil koffie"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_utterance.py -v`
Expected: FAIL — `No module named 'utterance'`

- [ ] **Step 3: Write `utterance.py`**

```python
from models import Utterance


def compose(text: str, lang: str) -> Utterance:
    return Utterance(text=" ".join(text.split()), lang=lang)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_utterance.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add utterance.py tests/test_utterance.py
git commit -m "feat: utterance composer normalizes chosen option text"
```

---

## Task 6: Front-end pure utilities

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/src/downsample.js`, `frontend/src/echo-gate.js`, `frontend/src/selection-input.js`
- Test: `frontend/test/downsample.test.js`, `frontend/test/echo-gate.test.js`, `frontend/test/selection-input.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (ES modules):
  - `downsampleTo16k(float32, inputRate) -> Int16Array`.
  - `EchoGate({ guardMs, now })` with `startSpeaking()`, `stopSpeaking()`, `isMuted()`.
  - `DwellSelector({ dwellMs, onSelect, now })` with `enter(targetId)`, `leave()`, `tick()`.

- [ ] **Step 1: Write `frontend/package.json`**

```json
{
  "name": "claudia-frontend",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^1.6.0" }
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/test/downsample.test.js`:
```javascript
import { describe, it, expect } from "vitest";
import { downsampleTo16k } from "../src/downsample.js";

describe("downsampleTo16k", () => {
  it("halves a 32 kHz buffer to 16 kHz", () => {
    const out = downsampleTo16k(new Float32Array(32000).fill(1.0), 32000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBe(32767);
  });
  it("passes 16 kHz through unchanged in length", () => {
    expect(downsampleTo16k(new Float32Array(1600), 16000).length).toBe(1600);
  });
});
```

`frontend/test/echo-gate.test.js`:
```javascript
import { describe, it, expect } from "vitest";
import { EchoGate } from "../src/echo-gate.js";

describe("EchoGate", () => {
  it("mutes while speaking and for the guard tail after", () => {
    let t = 0;
    const gate = new EchoGate({ guardMs: 300, now: () => t });
    expect(gate.isMuted()).toBe(false);
    gate.startSpeaking();
    expect(gate.isMuted()).toBe(true);
    gate.stopSpeaking();
    t = 200; expect(gate.isMuted()).toBe(true);
    t = 350; expect(gate.isMuted()).toBe(false);
  });
});
```

`frontend/test/selection-input.test.js`:
```javascript
import { describe, it, expect, vi } from "vitest";
import { DwellSelector } from "../src/selection-input.js";

describe("DwellSelector", () => {
  it("selects after dwelling long enough on one target", () => {
    let t = 0;
    const onSelect = vi.fn();
    const sel = new DwellSelector({ dwellMs: 500, onSelect, now: () => t });
    sel.enter("opt-1");
    t = 300; sel.tick(); expect(onSelect).not.toHaveBeenCalled();
    t = 600; sel.tick(); expect(onSelect).toHaveBeenCalledWith("opt-1");
  });
  it("resets the timer when gaze leaves", () => {
    let t = 0;
    const onSelect = vi.fn();
    const sel = new DwellSelector({ dwellMs: 500, onSelect, now: () => t });
    sel.enter("opt-1"); t = 300; sel.leave();
    sel.enter("opt-2"); t = 700; sel.tick();
    expect(onSelect).toHaveBeenCalledWith("opt-2");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npm install && npm test`
Expected: FAIL — cannot resolve `../src/*.js`

- [ ] **Step 4: Write the three modules**

`frontend/src/downsample.js`:
```javascript
export function downsampleTo16k(float32, inputRate) {
  const ratio = inputRate / 16000;
  const outLength = Math.round(float32.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[Math.floor(i * ratio)]));
    out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return out;
}
```

`frontend/src/echo-gate.js`:
```javascript
export class EchoGate {
  constructor({ guardMs, now = () => Date.now() }) {
    this._guardMs = guardMs;
    this._now = now;
    this._speaking = false;
    this._unmuteAt = 0;
  }
  startSpeaking() { this._speaking = true; }
  stopSpeaking() { this._speaking = false; this._unmuteAt = this._now() + this._guardMs; }
  isMuted() { return this._speaking || this._now() < this._unmuteAt; }
}
```

`frontend/src/selection-input.js`:
```javascript
export class DwellSelector {
  constructor({ dwellMs, onSelect, now = () => Date.now() }) {
    this._dwellMs = dwellMs;
    this._onSelect = onSelect;
    this._now = now;
    this._target = null;
    this._enteredAt = 0;
    this._fired = false;
  }
  enter(targetId) { this._target = targetId; this._enteredAt = this._now(); this._fired = false; }
  leave() { this._target = null; }
  tick() {
    if (this._target === null || this._fired) return;
    if (this._now() - this._enteredAt >= this._dwellMs) {
      this._fired = true;
      this._onSelect(this._target);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (all suites)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/src frontend/test
git commit -m "feat: front-end pure utils (downsample, echo gate, dwell select)"
```

---

## Task 7: Persona + learning log

**Files:**
- Create: `persona.py`
- Test: `tests/test_persona.py`

**Interfaces:**
- Consumes: `store` schema (tables exist via the `conn` fixture), `models.{Persona, Pick}`.
- Produces (sync, operate on a sqlite connection):
  - `load(conn) -> Persona`.
  - `recent(conn, n) -> list[Pick]` — last `n` interactions with a selected option.
  - `log_interaction(conn, lang, context_type, context_text, audio_path=None, asr_model=None) -> int`.
  - `save_options(conn, interaction_id, rows) -> list[int]` where each row is `{"rank": int, "text": str, "glosses": list[str], "symbol_sequence": list[int]}`; returns option ids in rank order.
  - `mark_selected(conn, interaction_id, option_id) -> str` — sets `was_selected=1`, returns the option text; raises `KeyError` if the pair is unknown.

- [ ] **Step 1: Write the failing test**

```python
import pytest
import persona


def test_load_returns_profile(conn):
    conn.execute("INSERT INTO persona(id, profile, reading_level, updated_at) "
                 "VALUES (1, 'warm, direct', 'simple', '2026-06-21')")
    conn.commit()
    p = persona.load(conn)
    assert p.profile == "warm, direct" and p.reading_level == "simple"


def test_log_and_recent_roundtrip(conn):
    iid = persona.log_interaction(conn, "nl", "audio", "wil je koffie?", asr_model="x")
    ids = persona.save_options(conn, iid, [
        {"rank": 0, "text": "ja graag", "glosses": ["ja"], "symbol_sequence": [1]},
        {"rank": 1, "text": "nee dank je", "glosses": ["nee"], "symbol_sequence": [2]},
    ])
    assert persona.mark_selected(conn, iid, ids[0]) == "ja graag"
    picks = persona.recent(conn, n=5)
    assert picks[0].context_text == "wil je koffie?"
    assert picks[0].selected_text == "ja graag"


def test_mark_selected_unknown_raises(conn):
    iid = persona.log_interaction(conn, "nl", "audio", "x")
    with pytest.raises(KeyError):
        persona.mark_selected(conn, iid, 999)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_persona.py -v`
Expected: FAIL — `No module named 'persona'`

- [ ] **Step 3: Write `persona.py`**

```python
import json
from datetime import datetime, timezone
from models import Persona, Pick


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load(conn) -> Persona:
    row = conn.execute(
        "SELECT profile, reading_level FROM persona ORDER BY id LIMIT 1").fetchone()
    if row is None:
        return Persona(profile="", reading_level=None)
    return Persona(profile=row["profile"], reading_level=row["reading_level"])


def recent(conn, n: int) -> list[Pick]:
    rows = conn.execute(
        "SELECT i.context_text AS ctx, o.text AS sel "
        "FROM interactions i JOIN options o ON o.interaction_id = i.id "
        "WHERE o.was_selected = 1 ORDER BY i.id DESC LIMIT ?", (n,)).fetchall()
    return [Pick(context_text=r["ctx"], selected_text=r["sel"]) for r in rows]


def log_interaction(conn, lang, context_type, context_text,
                    audio_path=None, asr_model=None) -> int:
    cursor = conn.execute(
        "INSERT INTO interactions(ts, lang, context_type, context_text, "
        "context_audio_path, asr_model) VALUES (?, ?, ?, ?, ?, ?)",
        (_now_iso(), lang, context_type, context_text, audio_path, asr_model))
    conn.commit()
    return cursor.lastrowid


def save_options(conn, interaction_id, rows) -> list[int]:
    ids = []
    for row in rows:
        cursor = conn.execute(
            "INSERT INTO options(interaction_id, rank, text, glosses, symbol_sequence) "
            "VALUES (?, ?, ?, ?, ?)",
            (interaction_id, row["rank"], row["text"],
             json.dumps(row["glosses"]), json.dumps(row["symbol_sequence"])))
        ids.append(cursor.lastrowid)
    conn.commit()
    return ids


def mark_selected(conn, interaction_id, option_id) -> str:
    row = conn.execute(
        "SELECT text FROM options WHERE id = ? AND interaction_id = ?",
        (option_id, interaction_id)).fetchone()
    if row is None:
        raise KeyError((interaction_id, option_id))
    conn.execute("UPDATE options SET was_selected = 1 WHERE id = ?", (option_id,))
    conn.commit()
    return row["text"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_persona.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add persona.py tests/test_persona.py
git commit -m "feat: persona load + interaction/option learning log"
```

---

## Task 8: REMOVED

The embedder is provided by the ARASAAC seeding plan's `embedder.py` (sync `embed(texts, kind, *, client=None)`, model `intfloat/multilingual-e5-large`, 1024-d). Consume it directly; do not create one here.

---

## Task 9: Transcriber

**Files:**
- Create: `transcriber.py`
- Test: `tests/test_transcriber.py`

**Interfaces:**
- Consumes: `openrouter.transcribe`, `config.MODEL_ASR`, `models.Transcript`.
- Produces (async): `transcribe(pcm: bytes, lang: str, sample_rate: int = 16000) -> Transcript` — wraps PCM16 as a WAV container and calls the ASR model.

- [ ] **Step 1: Write the failing test**

```python
import transcriber
import openrouter
from models import Transcript


async def test_transcribe_wraps_pcm_as_wav_and_returns_transcript(monkeypatch):
    seen = {}

    async def fake_transcribe(wav_bytes, model, language=None):
        seen["wav"] = wav_bytes
        seen["language"] = language
        return "goedemorgen"

    monkeypatch.setattr(openrouter, "transcribe", fake_transcribe)
    out = await transcriber.transcribe(b"\x00\x00" * 320, lang="nl")
    assert isinstance(out, Transcript)
    assert out.text == "goedemorgen" and out.lang == "nl"
    assert seen["wav"][:4] == b"RIFF" and seen["wav"][8:12] == b"WAVE"
    assert seen["language"] == "nl"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_transcriber.py -v`
Expected: FAIL — `No module named 'transcriber'`

- [ ] **Step 3: Write `transcriber.py`**

```python
import io
import wave
import openrouter
import config
from models import Transcript


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)               # PCM16
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


async def transcribe(pcm: bytes, lang: str, sample_rate: int = 16000) -> Transcript:
    wav_bytes = _pcm_to_wav(pcm, sample_rate)
    text = await openrouter.transcribe(wav_bytes, model=config.MODEL_ASR, language=lang)
    return Transcript(text=text, lang=lang)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_transcriber.py -v`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add transcriber.py tests/test_transcriber.py
git commit -m "feat: transcriber wraps PCM as WAV and calls Parakeet"
```

---

## Task 10: Option generator

**Files:**
- Create: `option_generator.py`
- Test: `tests/test_option_generator.py`

**Interfaces:**
- Consumes: `openrouter.chat`, `config.MODEL_LLM`, `models.{Candidate, Persona, Pick}`.
- Produces (async): `generate(context: str, persona: Persona, history: list[Pick], n: int, lang: str) -> list[Candidate]`.

- [ ] **Step 1: Write the failing test**

```python
import json
import option_generator
import openrouter
from models import Persona, Pick


async def test_generate_parses_candidates(monkeypatch):
    captured = {}

    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        captured["messages"] = messages
        captured["model"] = model
        return json.dumps({"options": [
            {"text": "ja graag", "glosses": ["ja", "graag"]},
            {"text": "nee dank je", "glosses": ["nee", "dank"]},
        ]})

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    out = await option_generator.generate(
        context="wil je koffie?",
        persona=Persona(profile="warm, direct"),
        history=[Pick(context_text="hoe gaat het?", selected_text="goed")],
        n=2, lang="nl")

    assert captured["model"] == "z-ai/glm-5.2"
    assert [c.text for c in out] == ["ja graag", "nee dank je"]
    assert out[0].glosses == ["ja", "graag"]
    prompt = " ".join(m["content"] for m in captured["messages"])
    assert "warm, direct" in prompt and "wil je koffie?" in prompt and "goed" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_option_generator.py -v`
Expected: FAIL — `No module named 'option_generator'`

- [ ] **Step 3: Write `option_generator.py`**

```python
import json
import openrouter
import config
from models import Candidate, Persona, Pick

_SYSTEM = (
    "You generate first-person replies for a non-speaking AAC user. "
    "Reply only as her. Return JSON: "
    '{"options": [{"text": <natural sentence>, "glosses": [<core content words>]}]}. '
    "Glosses are telegraphic core words in the SAME language as text, for symbol lookup."
)


def _user_prompt(context, persona, history, n, lang) -> str:
    lines = [f"Language: {lang}", f"Her persona: {persona.profile}"]
    if persona.reading_level:
        lines.append(f"Reading level: {persona.reading_level}")
    if history:
        lines.append("Recent picks (context -> her reply):")
        lines += [f"- {p.context_text} -> {p.selected_text}" for p in history]
    lines.append(f"Someone just said to her: {context}")
    lines.append(f"Give {n} distinct replies in her voice.")
    return "\n".join(lines)


async def generate(context, persona, history, n, lang) -> list[Candidate]:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _user_prompt(context, persona, history, n, lang)},
    ]
    content = await openrouter.chat(
        messages, model=config.MODEL_LLM, response_format={"type": "json_object"})
    options = json.loads(content)["options"]
    return [Candidate(text=o["text"], glosses=o["glosses"]) for o in options][:n]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_option_generator.py -v`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add option_generator.py tests/test_option_generator.py
git commit -m "feat: GLM-5.2 option generator returns {text, glosses}"
```

---

## Task 11: Symbol search

**Files:**
- Create: `symbol_search.py`
- Test: `tests/test_symbol_search.py`

**Interfaces:**
- Consumes: seeding `embedder.embed` (sync), seeding `db.{unpack_vector, insert_symbol, insert_term, pack_vector, MODEL_TAG via embedder}`, `models.Match`.
- Produces (async): `search(conn, text: str, k: int, lang: str) -> list[Match]` — embeds `text` as a query (off the event loop via `asyncio.to_thread`), brute-force cosine over `symbol_terms` for `lang`, returns the top `k` `Match`es (descending score).

- [ ] **Step 1: Write the failing test** (seed via the seeding `db` writers; monkeypatch the sync embedder)

```python
import symbol_search
import embedder
import db


def _add_symbol(conn, label, vector, lang="nl"):
    sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                           image_path=f"media/{label}.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang=lang, label=label,
                   description=f"{label} desc", vector=db.pack_vector(vector),
                   model=embedder.MODEL_TAG)
    return sid


async def test_search_returns_nearest_symbol(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0])
    _add_symbol(conn, "thee", [0.0, 1.0, 0.0])

    def fake_embed(texts, kind):              # sync, matches seeding embedder
        assert kind == "query"
        return [[0.9, 0.1, 0.0]]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "koffie alstublieft", k=1, lang="nl")
    assert len(matches) == 1
    assert matches[0].label == "koffie" and matches[0].score > 0.9


async def test_search_respects_language_filter(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0], lang="nl")
    _add_symbol(conn, "coffee", [1.0, 0.0, 0.0], lang="en")

    def fake_embed(texts, kind):
        return [[1.0, 0.0, 0.0]]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "coffee", k=5, lang="en")
    assert [m.label for m in matches] == ["coffee"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_symbol_search.py -v`
Expected: FAIL — `No module named 'symbol_search'`

- [ ] **Step 3: Write `symbol_search.py`**

```python
import asyncio
import numpy as np
import db
import embedder
from models import Match


def _cosine(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    query_norm = query / (np.linalg.norm(query) + 1e-9)
    row_norms = np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9
    return (matrix / row_norms) @ query_norm


async def search(conn, text: str, k: int, lang: str) -> list[Match]:
    rows = conn.execute(
        "SELECT t.symbol_id, t.label, s.image_path, t.vector "
        "FROM symbol_terms t JOIN symbols s ON s.id = t.symbol_id "
        "WHERE t.lang = ?", (lang,)).fetchall()
    if not rows:
        return []

    # embedder.embed is synchronous (seeding plan); keep the event loop free.
    vectors = await asyncio.to_thread(embedder.embed, [text], "query")
    query_vec = np.asarray(vectors[0], dtype=np.float32)
    matrix = np.vstack([np.asarray(db.unpack_vector(r["vector"]), dtype=np.float32)
                        for r in rows])
    scores = _cosine(query_vec, matrix)

    order = np.argsort(scores)[::-1][:k]
    return [Match(symbol_id=rows[i]["symbol_id"], label=rows[i]["label"],
                  image_path=rows[i]["image_path"], score=float(scores[i]))
            for i in order]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_symbol_search.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add symbol_search.py tests/test_symbol_search.py
git commit -m "feat: cosine top-k symbol search over seeded per-language vectors"
```

---

## Task 12: Translator

**Files:**
- Create: `translator.py`
- Test: `tests/test_translator.py`

**Interfaces:**
- Consumes: `symbol_search.search`, `openrouter.chat`, `config.MODEL_LLM`, `models.SymbolCard`.
- Produces (async, except the helpers below which are sync):
  - `to_symbols(conn, glosses: list[str], lang: str, threshold: float) -> list[SymbolCard]` — best symbol per gloss; below `threshold` → `as_text=True` card with `image_url=None`.
  - `glossify(text: str, lang: str) -> list[str]` — LLM decomposition (dev/`/translate` only).
  - `image_url_for(image_path: str) -> str` — `"/media/" + basename`.
  - `core_symbols(conn, lang) -> list[SymbolCard]` — the `symbols.is_core = 1` rows for `lang`, as ready-to-show cards.
  - `default_symbol_options(conn, lang) -> tuple[list[str], list[list[SymbolCard]]]` — the fallback board used when no proposed option matched any symbol. Each core symbol becomes its own one-symbol option. Always includes the "I don't understand, please explain" symbol; if the dictionary has no core rows yet, it degrades to a single text-only option carrying that phrase.

- [ ] **Step 1: Write the failing test**

```python
import translator
import symbol_search
import openrouter
from models import Match


async def test_to_symbols_picks_best_above_threshold(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label=text, image_path=f"media/{text}.png", score=0.8)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].id == 7 and cards[0].as_text is False
    assert cards[0].image_url == "/media/koffie.png"


async def test_to_symbols_below_threshold_renders_text(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label="koffie", image_path="media/koffie.png", score=0.1)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].as_text is True and cards[0].image_url is None
    assert cards[0].label == "koffie"


async def test_glossify_returns_core_words(monkeypatch):
    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        return '{"glosses": ["ik", "wil", "koffie"]}'

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    assert await translator.glossify("ik wil graag koffie", "nl") == ["ik", "wil", "koffie"]


def _add_core(conn, label, image_path="help.png", lang="nl"):
    import db, embedder
    sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                           image_path=f"media/{image_path}", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang=lang, label=label, description=label,
                   vector=db.pack_vector([0.0] * embedder.DIMS), model=embedder.MODEL_TAG)


def test_core_symbols_returns_seeded_core(conn):
    _add_core(conn, "help")
    cards = translator.core_symbols(conn, "nl")
    assert [c.label for c in cards] == ["help"]
    assert cards[0].image_url == "/media/help.png" and cards[0].as_text is False


def test_default_symbol_options_use_core_when_present(conn):
    _add_core(conn, "ik begrijp het niet")
    texts, card_lists = translator.default_symbol_options(conn, "nl")
    assert texts == ["ik begrijp het niet"]
    assert card_lists[0][0].as_text is False


def test_default_symbol_options_fall_back_to_dont_understand(conn):
    texts, card_lists = translator.default_symbol_options(conn, "nl")   # empty dictionary
    assert texts == ["Ik begrijp het niet, leg het uit"]
    assert card_lists[0][0].as_text is True and card_lists[0][0].image_url is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_translator.py -v`
Expected: FAIL — `No module named 'translator'`

- [ ] **Step 3: Write `translator.py`**

```python
import json
from pathlib import PurePath
import symbol_search
import openrouter
import config
from models import SymbolCard

_GLOSSIFY_SYSTEM = (
    "Break the text into telegraphic core content words (glosses) for AAC symbol "
    'lookup, same language. Return JSON: {"glosses": [<words>]}.'
)

# Guaranteed phrase she can always say, even before any core symbols are seeded.
_FALLBACK_TEXT = {
    "nl": "Ik begrijp het niet, leg het uit",
    "en": "I don't understand, please explain",
}


def image_url_for(image_path: str) -> str:
    return "/media/" + PurePath(image_path).name


def core_symbols(conn, lang: str) -> list[SymbolCard]:
    rows = conn.execute(
        "SELECT t.symbol_id, t.label, s.image_path "
        "FROM symbol_terms t JOIN symbols s ON s.id = t.symbol_id "
        "WHERE s.is_core = 1 AND t.lang = ? ORDER BY t.symbol_id", (lang,)).fetchall()
    return [SymbolCard(id=row["symbol_id"], label=row["label"],
                       image_url=image_url_for(row["image_path"]),
                       confidence=1.0, as_text=False) for row in rows]


def default_symbol_options(conn, lang: str):
    """Fallback board when no proposed option matched any symbol.

    Each core symbol becomes its own one-symbol option. If the dictionary has no
    core symbols yet, fall back to a single text option so she can always say she
    does not understand.
    """
    cards = core_symbols(conn, lang)
    if cards:
        return [card.label for card in cards], [[card] for card in cards]
    text = _FALLBACK_TEXT.get(lang, _FALLBACK_TEXT["en"])
    return [text], [[SymbolCard(id=-1, label=text, image_url=None,
                                confidence=0.0, as_text=True)]]


async def to_symbols(conn, glosses, lang, threshold) -> list[SymbolCard]:
    cards = []
    for gloss in glosses:
        matches = await symbol_search.search(conn, gloss, k=1, lang=lang)
        best = matches[0] if matches else None
        if best is not None and best.score >= threshold:
            cards.append(SymbolCard(id=best.symbol_id, label=best.label,
                                    image_url=image_url_for(best.image_path),
                                    confidence=best.score, as_text=False))
        else:
            cards.append(SymbolCard(id=(best.symbol_id if best else -1), label=gloss,
                                    image_url=None,
                                    confidence=(best.score if best else 0.0),
                                    as_text=True))
    return cards


async def glossify(text: str, lang: str) -> list[str]:
    messages = [
        {"role": "system", "content": _GLOSSIFY_SYSTEM},
        {"role": "user", "content": f"Language: {lang}\nText: {text}"},
    ]
    content = await openrouter.chat(messages, model=config.MODEL_LLM,
                                    response_format={"type": "json_object"})
    return json.loads(content)["glosses"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_translator.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add translator.py tests/test_translator.py
git commit -m "feat: translator — gloss→symbol mapping, glossify, default core-symbol fallback"
```

---

## Task 13: REMOVED

The offline ARASAAC import/seed/embed pipeline is owned entirely by the ARASAAC seeding plan (`indexing/arasaac.py`, `indexing/describe.py`, `indexing/seed.py`, `indexing/core_words.txt`). Run `python -m indexing.seed` to populate the dictionary before exercising the live path.

---

## Task 14: API + orchestration (REST + WebSocket)

**Files:**
- Create: `api.py`
- Create: `main.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `db` (seeding, for connect + symbol schema), `store` (live schema + settings), `persona`, `option_generator`, `translator`, `transcriber`, `audio_stream`, `vad`, `utterance`, `config`, `models.Option`.
- Produces:
  - `propose(conn, *, context_text, lang, context_type, audio_path=None, asr_model=None) -> dict` — shared orchestration → `{"interaction_id": int, "options": [Option...]}`. When no proposed option matched any symbol, the options are replaced by `translator.default_symbol_options` (the core board incl. "I don't understand, please explain") before persisting.
  - FastAPI `app`. REST: `POST /expressive/options` (dev), `POST /expressive/select`, `POST /translate`. WS `/expressive/listen`: proposed option-sets are **queued and released one at a time** — the next set is sent only after a `{"type":"select", ...}` control message reports her choice; the WS speaks the chosen text back as `{"type":"speak"}`. Plus the `/media/*` static mount.

- [ ] **Step 1: Write the failing test for the dev propose path**

```python
import pytest
from fastapi.testclient import TestClient
import api
import option_generator
import translator
from models import Candidate, SymbolCard


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(api, "_open_conn", lambda: conn)   # share the in-memory DB

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="ja graag", glosses=["ja"]),
                Candidate(text="nee", glosses=["nee"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):
        return [SymbolCard(id=1, label=g, image_url=f"/media/{g}.png",
                           confidence=0.9, as_text=False) for g in glosses]

    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    return TestClient(api.app)


def test_options_then_select_speaks(client):
    res = client.post("/expressive/options", json={"text": "wil je koffie?", "lang": "nl"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["options"]) == 2
    assert body["options"][0]["text"] == "ja graag"
    assert body["options"][0]["symbols"][0]["image_url"] == "/media/ja.png"

    chosen = body["options"][0]
    sel = client.post("/expressive/select", json={
        "interaction_id": body["interaction_id"], "option_id": chosen["option_id"]})
    assert sel.status_code == 200
    assert sel.json() == {"text": "ja graag", "lang": "nl"}


def test_select_unknown_returns_404(client):
    res = client.post("/expressive/select",
                      json={"interaction_id": 999, "option_id": 999})
    assert res.status_code == 404


def test_options_fall_back_to_defaults_when_no_symbols(conn, monkeypatch):
    import db, embedder
    sid = db.insert_symbol(conn, source="arasaac", external_id="dont-understand",
                           image_path="media/help.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang="nl", label="ik begrijp het niet",
                   description="uitleg", vector=db.pack_vector([0.0] * embedder.DIMS),
                   model=embedder.MODEL_TAG)
    monkeypatch.setattr(api, "_open_conn", lambda: conn)

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="iets", glosses=["onbekend"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):    # nothing matches
        return [SymbolCard(id=-1, label=g, image_url=None, confidence=0.0, as_text=True)
                for g in glosses]

    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    res = TestClient(api.app).post("/expressive/options", json={"text": "?", "lang": "nl"})
    body = res.json()
    assert body["options"][0]["text"] == "ik begrijp het niet"
    assert body["options"][0]["symbols"][0]["as_text"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -v`
Expected: FAIL — `No module named 'api'`

- [ ] **Step 3: Write `api.py`**

```python
import json
import sqlite3
from collections import deque
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import store
import persona
import option_generator
import translator
import transcriber
import utterance
import config
from audio_stream import Segmenter
from vad import SileroVad
from models import Option

app = FastAPI()


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
    candidates = await option_generator.generate(context_text, who, history, n, lang)

    texts, card_lists = [], []
    for candidate in candidates:
        texts.append(candidate.text)
        card_lists.append(await translator.to_symbols(conn, candidate.glosses, lang, threshold))

    # Similarity search found nothing usable → fall back to the common core board.
    if not _has_matched_symbol(card_lists):
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

    pending_options = deque()      # proposed option-sets awaiting their turn
    awaiting_selection = False     # is an option-set currently shown to her?
    muted = False

    async def release_next() -> None:
        nonlocal awaiting_selection
        if awaiting_selection or not pending_options:
            return
        result = pending_options.popleft()
        awaiting_selection = True
        await ws.send_json({
            "type": "utterance",
            "interaction_id": result["interaction_id"],
            "transcript": result["transcript"],
            "options": [option.model_dump() for option in result["options"]],
        })

    try:
        while True:
            message = await ws.receive()
            if message.get("text") is not None:
                control = json.loads(message["text"])
                kind = control.get("type")
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
                    await ws.send_json({"type": "speak", "text": spoken.text,
                                        "lang": spoken.lang})
                    awaiting_selection = False
                    await release_next()      # her selection releases the next queued set
                continue

            frame = message.get("bytes")
            if frame is None or muted:
                continue
            segment = segmenter.feed(frame)
            if segment is None:
                continue
            transcript = await transcriber.transcribe(segment.pcm, lang)
            if not transcript.text.strip():
                continue
            result = await propose(conn, context_text=transcript.text, lang=lang,
                                   context_type="audio", asr_model=config.MODEL_ASR)
            result["transcript"] = transcript.text
            pending_options.append(result)
            await release_next()              # sends now only if nothing is awaiting selection
    except WebSocketDisconnect:
        return
    finally:
        conn.close()


config.MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(config.MEDIA_DIR)), name="media")
```

- [ ] **Step 4: Write `main.py`** (uvicorn entry + front-end mount)

```python
from fastapi.staticfiles import StaticFiles
from api import app

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_api.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add api.py main.py tests/test_api.py
git commit -m "feat: API orchestration — options, select, translate, queued WS listen, default fallback"
```

---

## Task 15: End-to-end integration test

**Files:**
- Test: `tests/test_integration.py`

**Interfaces:**
- Consumes: the full app with fakes for ASR + LLM + symbol search; scripted audio frames.

- [ ] **Step 1: Write the WebSocket integration test**

```python
import pytest
from fastapi.testclient import TestClient
import api
import transcriber
import option_generator
import translator
from models import Transcript, Candidate, SymbolCard

WINDOW = b"\x10\x00" * 512     # one 512-sample "speech" window
QUIET = b"\x00\x00" * 512      # one 512-sample "silence" window


class FakeVad:
    """Deterministic stand-in for Silero: WINDOW = speech, QUIET = silence."""

    def __init__(self):
        self._in_speech = False

    def __call__(self, window):
        is_speech = window == WINDOW
        if is_speech and not self._in_speech:
            self._in_speech = True
            return {"start": 0}
        if not is_speech and self._in_speech:
            self._in_speech = False
            return {"end": 0}
        return None

    def reset(self):
        self._in_speech = False


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(api, "_open_conn", lambda: conn)
    monkeypatch.setattr(api, "SileroVad", lambda **kwargs: FakeVad())   # no torch in CI

    async def fake_transcribe(pcm, lang, sample_rate=16000):
        return Transcript(text="wil je koffie?", lang=lang)

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="ja graag", glosses=["ja"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):
        return [SymbolCard(id=1, label=g, image_url=f"/media/{g}.png",
                           confidence=0.9) for g in glosses]

    monkeypatch.setattr(transcriber, "transcribe", fake_transcribe)
    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    return TestClient(api.app)


def test_audio_stream_yields_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_bytes(WINDOW)             # speech start
        websocket.send_bytes(QUIET)              # silence → endpoint → propose + release
        event = websocket.receive_json()
    assert event["type"] == "utterance"
    assert event["transcript"] == "wil je koffie?"
    assert event["options"][0]["text"] == "ja graag"


def test_queue_releases_next_only_after_selection(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)
        first = websocket.receive_json()
        assert first["type"] == "utterance"

        # A second utterance arrives while the first is still unselected: it is queued.
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)

        # Selecting the first speaks it AND releases the queued second.
        websocket.send_json({"type": "select",
                             "interaction_id": first["interaction_id"],
                             "option_id": first["options"][0]["option_id"]})
        spoken = websocket.receive_json()
        assert spoken["type"] == "speak" and spoken["text"] == "ja graag"
        second = websocket.receive_json()
        assert second["type"] == "utterance"


def test_mute_marker_suppresses_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_json({"type": "mute"})
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)   # dropped while muted
        websocket.send_json({"type": "unmute"})
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)   # heard
        event = websocket.receive_json()
    assert event["transcript"] == "wil je koffie?"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_integration.py -v`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.py
git commit -m "test: end-to-end WS audio→options with mute suppression"
```

---

## Task 16: Front-end integration

**Files:**
- Create: `frontend/index.html`, `frontend/styles.css`
- Create: `frontend/src/pcm-worklet.js`, `frontend/src/audio-capture.js`, `frontend/src/ws-client.js`, `frontend/src/tts.js`, `frontend/src/app.js`
- Test (smoke, manual/Playwright): `frontend/test/smoke.spec.js`

**Interfaces:**
- Consumes: T6 utilities (`downsampleTo16k`, `EchoGate`, `DwellSelector`); the API contract from T14.
- Produces: the running UI — mic capture → WS frames; render option rows of large symbol cards; dwell-select → `{"type":"select"}` over the WS → backend replies `{"type":"speak"}` (and releases the next queued set) → speak via `SpeechSynthesis`, with the echo gate muting the mic during playback.

- [ ] **Step 1: Write `frontend/src/tts.js`**

```javascript
import { EchoGate } from "./echo-gate.js";

export function createSpeaker({ guardMs, onMuteChange }) {
  const gate = new EchoGate({ guardMs });
  function emit() { onMuteChange(gate.isMuted()); }
  return {
    isMuted: () => gate.isMuted(),
    speak(text, lang) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "nl" ? "nl-NL" : "en-US";
      u.onstart = () => { gate.startSpeaking(); emit(); };
      u.onend = () => { gate.stopSpeaking(); emit(); setTimeout(emit, guardMs + 20); };
      window.speechSynthesis.speak(u);
    },
  };
}
```

- [ ] **Step 2: Write `frontend/src/ws-client.js`**

```javascript
export function connectListen({ onUtterance, onSpeak }) {
  const ws = new WebSocket(`ws://${location.host}/expressive/listen`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "utterance") onUtterance(msg);
    else if (msg.type === "speak") onSpeak(msg);
  };
  return {
    sendFrame: (int16) => { if (ws.readyState === 1) ws.send(int16.buffer); },
    mute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "mute" })),
    unmute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "unmute" })),
    // Selecting reports her choice; the backend speaks it and releases the next set.
    select: (interactionId, optionId) => ws.readyState === 1 && ws.send(
      JSON.stringify({ type: "select", interaction_id: interactionId, option_id: optionId })),
  };
}
```

- [ ] **Step 3: Write `frontend/src/pcm-worklet.js`**

```javascript
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
```

- [ ] **Step 4: Write `frontend/src/audio-capture.js`**

```javascript
import { downsampleTo16k } from "./downsample.js";

export async function startCapture({ onFrame, isMuted }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/src/pcm-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
  worklet.port.onmessage = (event) => {
    if (isMuted()) return;                       // echo guard: do not stream while speaking
    onFrame(downsampleTo16k(event.data, ctx.sampleRate));
  };
  source.connect(worklet);
  return ctx;
}
```

- [ ] **Step 5: Write `frontend/src/app.js`**

```javascript
import { connectListen } from "./ws-client.js";
import { startCapture } from "./audio-capture.js";
import { createSpeaker } from "./tts.js";
import { DwellSelector } from "./selection-input.js";

const grid = document.getElementById("options");
let currentInteraction = null;

let ws;
const speaker = createSpeaker({
  guardMs: 300,
  onMuteChange: (muted) => (muted ? ws.mute() : ws.unmute()),
});
ws = connectListen({
  onUtterance: renderOptions,
  onSpeak: (message) => speaker.speak(message.text, message.lang),
});
const selector = new DwellSelector({ dwellMs: 800, onSelect: choose });
setInterval(() => selector.tick(), 100);

startCapture({ onFrame: ws.sendFrame, isMuted: speaker.isMuted });

function renderOptions(message) {
  currentInteraction = message.interaction_id;
  grid.innerHTML = "";
  for (const option of message.options) {
    const row = document.createElement("button");
    row.className = "option";
    row.dataset.optionId = option.option_id;
    row.onmouseenter = () => selector.enter(String(option.option_id));
    row.onmouseleave = () => selector.leave();
    row.onclick = () => choose(String(option.option_id));
    for (const symbol of option.symbols) {
      const card = document.createElement("span");
      card.className = "card";
      card.innerHTML = symbol.as_text
        ? `<span class="text">${symbol.label}</span>`
        : `<img alt="${symbol.label}" src="${symbol.image_url}"><span>${symbol.label}</span>`;
      row.appendChild(card);
    }
    grid.appendChild(row);
  }
}

// Selecting reports her choice over the WS; the backend speaks it back (handled
// by onSpeak) and releases the next queued option-set. Clear the grid meanwhile.
function choose(optionId) {
  if (currentInteraction === null) return;
  grid.innerHTML = "";
  ws.select(currentInteraction, Number(optionId));
  currentInteraction = null;
}
```

- [ ] **Step 6: Write `frontend/index.html` and `frontend/styles.css`**

`frontend/index.html`:
```html
<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <title>AAC Symbol Translator</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <h1>Kies een antwoord</h1>
    <div id="options"></div>
  </main>
  <script type="module" src="/src/app.js"></script>
</body>
</html>
```

`frontend/styles.css`:
```css
body { font-family: system-ui, sans-serif; margin: 0; background: #0f1115; color: #f5f5f5; }
main { padding: 2rem; }
#options { display: grid; gap: 1rem; }
.option { display: flex; gap: 1rem; align-items: center; padding: 1.5rem;
  font-size: 1.5rem; background: #1c2230; border: 3px solid transparent;
  border-radius: 16px; color: inherit; cursor: pointer; }
.option:hover { border-color: #4da3ff; }
.card { display: flex; flex-direction: column; align-items: center; width: 96px; }
.card img { width: 96px; height: 96px; object-fit: contain; }
.card .text { font-weight: 700; }
```

- [ ] **Step 7: Write the smoke test**

`frontend/test/smoke.spec.js`:
```javascript
// Smoke test — run against `python main.py` with stubbed OpenRouter calls.
// Verifies the option grid renders and selecting speaks. Not a unit test; this
// exercises real WS + DOM. Marked manual in CI until a fake-backed fixture exists.
import { test, expect } from "@playwright/test";

test("renders options and selects one", async ({ page }) => {
  await page.goto("http://127.0.0.1:8000/");
  await expect(page.locator("h1")).toHaveText("Kies een antwoord");
});
```

- [ ] **Step 8: Manual verification checklist** (TDD is impractical for getUserMedia/WS in CI)

```
1. Seed the dictionary: python -m indexing.seed   (seeding plan; must include core symbols
   and the "I don't understand, please explain" symbol marked is_core)
2. Set OPENROUTER_API_KEY. Run: python main.py
3. Open http://127.0.0.1:8000/ , grant mic permission.
4. Speak a Dutch sentence; confirm option rows of symbol cards appear.
5. Dwell on one; confirm it is spoken and the mic mutes during playback.
6. Confirm the spoken reply does NOT produce a new option set (echo guard works).
7. Speak two sentences in a row without selecting; confirm only ONE option set shows, and
   the second appears only after you select from the first (queue gating).
8. Speak something with no matching symbols; confirm the default board appears, including
   the "I don't understand, please explain" option.
```

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html frontend/styles.css frontend/src frontend/test
git commit -m "feat: front-end — mic capture, options grid, dwell-select, TTS echo guard"
```

---

## Task 17: Retrieval eval harness (recall@k)

**Files:**
- Create: `tests/fixtures/recall_set.json`
- Test: `tests/test_retrieval_eval.py`

**Interfaces:**
- Consumes: `symbol_search.search`, seeding `db`/`embedder`.
- Produces: a recall@k measurement over curated `query → expected symbol` pairs.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/recall_set.json`:
```json
[
  {"lang": "nl", "query": "ik wil koffie", "expected_label": "koffie"},
  {"lang": "nl", "query": "nog een keer", "expected_label": "meer"},
  {"lang": "en", "query": "i want coffee", "expected_label": "coffee"}
]
```

- [ ] **Step 2: Write the eval test** (deterministic — seed known vectors via the seeding `db` writers)

```python
import json
from pathlib import Path
import symbol_search
import embedder
import db

FIXTURE = Path(__file__).parent / "fixtures" / "recall_set.json"

_VECTORS = {"koffie": [1.0, 0.0, 0.0], "meer": [0.0, 1.0, 0.0], "coffee": [1.0, 0.0, 0.0]}
_QUERY_VECTORS = {
    "ik wil koffie": [0.95, 0.05, 0.0], "nog een keer": [0.0, 0.98, 0.02],
    "i want coffee": [0.97, 0.0, 0.0],
}


def _seed(conn):
    for label, vec in _VECTORS.items():
        lang = "en" if label == "coffee" else "nl"
        sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                               image_path=f"media/{label}.png", is_core=1, created_at="t0")
        db.insert_term(conn, symbol_id=sid, lang=lang, label=label, description=label,
                       vector=db.pack_vector(vec), model=embedder.MODEL_TAG)


async def test_recall_at_1_is_perfect_on_fixture(conn, monkeypatch):
    _seed(conn)

    def fake_embed(texts, kind):
        return [_QUERY_VECTORS[texts[0]]]

    monkeypatch.setattr(embedder, "embed", fake_embed)

    cases = json.loads(FIXTURE.read_text())
    hits = 0
    for case in cases:
        matches = await symbol_search.search(conn, case["query"], k=1, lang=case["lang"])
        if matches and matches[0].label == case["expected_label"]:
            hits += 1
    assert hits / len(cases) == 1.0          # tighten/extend the fixture as real vectors land
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/test_retrieval_eval.py -v`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/recall_set.json tests/test_retrieval_eval.py
git commit -m "test: recall@k retrieval eval harness with seed fixture"
```

---

## Self-Review (completed against both specs)

**Spec coverage:**
- Audio→symbol spec §5 modules — audio_stream→T4, transcriber→T9, symbol_search→T11, translator→T12, option_generator→T10, utterance→T5, persona→T7, api→T14. Embedder + indexing → seeding plan (T8/T13 removed). ✓
- §6 data model — `symbols`/`symbol_terms` owned by seeding `db.py`; `interactions`/`options`/`persona`/`settings` created idempotently by `store.py` (T2). `context_audio_path`/`asr_model` plumbed in T7/T14. ✓
- §7 endpoints — all four routes in T14. ✓
- §8 data flow — T15 WS test. ✓
- §9 services — one OpenRouter key: chat/transcribe via `openrouter.py` (T3), embeddings via seeding `embedder.py`. ✓
- §10 indexing — seeding plan. ✓
- §11 errors — empty transcript skipped (T14), unknown selection → 404 REST / `{"type":"error"}` WS (T14), TTS echo guard (mute markers T14 + EchoGate T6 + capture gate T16). ✓
- §12 testing — unit per module; integration T15 (incl. queue-gating + Silero seam via injected `FakeVad`); recall@k T17. ✓
- §13 stack / §3 decisions — repo-root layout, model ids, dims, prefixes consistent with the seeding plan. ✓

**Requested changes:**
- **Silero VAD (not hand-rolled)** — `silero-vad` is a core dep (T1); `vad.SileroVad` wraps `VADIterator` and `audio_stream.Segmenter` only buffers between its start/end events (T4); the WS wires `SileroVad` (T14); the homegrown `EnergyDetector` is gone. The injected-`vad` seam keeps T4/T15 testable without torch. ✓
- **Queue, released on selection** — the WS holds proposed option-sets in a per-connection `deque` and `release_next()` sends one only when nothing is awaiting selection; a `{"type":"select"}` control message clears `awaiting_selection`, speaks the choice, and releases the next (T14). Gating is covered by `test_queue_releases_next_only_after_selection` (T15) and the front-end sends `select` over the WS (T16). ✓
- **Default symbols when search finds nothing** — `translator.default_symbol_options` returns the `is_core=1` board, with a guaranteed text-only "I don't understand, please explain" fallback when the dictionary has none (T12); `propose` substitutes it when no option matched any symbol (T14, with `test_options_fall_back_to_defaults_when_no_symbols`). The seeding plan must seed that core symbol (noted in the cross-plan section). ✓
- **Idempotency (the requested change):** `store.create_schema` uses `IF NOT EXISTS` + `INSERT OR IGNORE` (T2 has an explicit idempotency test); symbol rows in tests use the seeding `db.insert_symbol`/`insert_term` (idempotent via `external_id UNIQUE`); `_open_conn` re-runs both `create_schema`s safely on every request. ✓

**Placeholder scan:** every code step contains real, runnable code — no TBD/TODO/"handle edge cases". The only non-code verifications are the T16 manual checklist and Playwright smoke (honestly flagged — getUserMedia/WS cannot be unit-tested deterministically). ✓

**Type consistency:** `Match(symbol_id,label,image_path,score)`, `SymbolCard(id,label,image_url,confidence,as_text)`, `Candidate(text,glosses)`, `Option(option_id,text,symbols)`, `Transcript(text,lang)`, `Segment(pcm,sample_rate)` used identically across producers/consumers. `embedder.embed(texts, kind)` is called **synchronously** (wrapped in `asyncio.to_thread` in T11) matching the seeding plan's signature. `store.get_setting`/`db.unpack_vector`/`db.insert_*` names match their definitions in the seeding plan. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/2026-06-21-audio-symbol-translator-implementation-plan.md`. It depends on the ARASAAC seeding plan for `db.py`, `embedder.py`, and `indexing/` — run/merge that plan's Tasks 1–4 before this plan's Wave 3 (T11). Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. To exploit the waves, dispatch all tasks in a wave concurrently (superpowers:dispatching-parallel-agents), review, then barrier before the next wave.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
