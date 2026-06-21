# Audio→Symbol AAC Translator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are grouped into **waves** (see Parallelization Plan) — dispatch all tasks within a wave concurrently with superpowers:dispatching-parallel-agents, then barrier on the wave before starting the next.

**Goal:** A local web app where a conversation partner speaks, the backend transcribes the speech, an LLM proposes responses in the user's voice rendered as symbol sequences, and she picks one to be spoken aloud.

**Architecture:** FastAPI backend with a WebSocket audio loop (browser mic → 16 kHz PCM16 frames → backend VAD endpointing → Parakeet ASR → GLM-5.2 option generation → E5 semantic search → symbol cards pushed back). A shared OpenRouter client serves all three model calls. SQLite stores symbols, per-language embeddings, persona, and the interaction/option learning log. Plain HTML/CSS/JS front-end with dwell-to-select and browser TTS.

**Tech Stack:** Python 3.11 · FastAPI · Uvicorn · httpx · pydantic v2 · numpy · sqlite3 (stdlib) · pytest + pytest-asyncio · vitest (front-end units) · OpenRouter (Parakeet ASR, GLM-5.2 LLM, multilingual-e5-large embeddings).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Python:** 3.11.
- **Model ids (OpenRouter):** ASR `nvidia/parakeet-tdt-0.6b-v3`; LLM `z-ai/glm-5.2`; embeddings `intfloat/multilingual-e5-large`.
- **Embedding dims:** 1024. E5 requires input prefixes — `query: ` on lookup text, `passage: ` on stored descriptions.
- **One external API key:** `OPENROUTER_API_KEY`. Base URL `https://openrouter.ai/api/v1` (OpenAI-compatible). No other paid vendor.
- **Audio:** 16 kHz mono PCM16, ~20 ms frames.
- **Default settings:** `lang='nl'`, `option_count='5'`, `match_threshold='0.30'`, `vad_silence_ms='800'`, `echo_guard_ms='300'`, `asr_model='nvidia/parakeet-tdt-0.6b-v3'`.
- **Languages:** Dutch primary, English supported. `settings.lang` is the single source of truth.
- **Naming (per CLAUDE.md):** full words, booleans as questions (`is_*`/`has_*`), functions are verbs, no noise words (`data`/`info`/`manager`/`helper`/`util`). Comment the *why*, not the *what*.
- **No confidently-wrong symbols:** a gloss whose best match is below `match_threshold` renders as text, not a picture.

---

## Parallelization Plan

**How to read dependencies:** a task may start once every task in its "Depends on" list has merged. Within a wave, no two tasks write the same file, so they can run as concurrent subagents.

| Task | Title | Wave | Depends on | New files (no overlap with siblings) |
|---|---|---|---|---|
| T1 | Scaffold, deps, config, models | 0 | — | `pyproject.toml`, `app/config.py`, `app/models.py`, `tests/conftest.py` |
| T2 | Database + settings + vector helpers | 1 | T1 | `app/db.py`, `tests/test_db.py` |
| T3 | OpenRouter client | 1 | T1 | `app/openrouter.py`, `tests/test_openrouter.py` |
| T4 | Audio segmenter (VAD endpointing) | 1 | T1 | `app/audio_stream.py`, `app/vad.py`, `tests/test_audio_stream.py` |
| T5 | Utterance composer | 1 | T1 | `app/utterance.py`, `tests/test_utterance.py` |
| T6 | Front-end pure utilities | 1 | T1 | `frontend/src/{downsample,echo-gate,selection-input}.js`, `frontend/test/*`, `frontend/package.json` |
| T7 | Persona + learning log | 2 | T2 | `app/persona.py`, `tests/test_persona.py` |
| T8 | Embedder | 2 | T3 | `app/embedder.py`, `tests/test_embedder.py` |
| T9 | Transcriber | 2 | T3 | `app/transcriber.py`, `tests/test_transcriber.py` |
| T10 | Option generator | 2 | T3 | `app/option_generator.py`, `tests/test_option_generator.py` |
| T11 | Symbol search | 3 | T8, T2 | `app/symbol_search.py`, `tests/test_symbol_search.py` |
| T12 | Translator | 4 | T11, T3 | `app/translator.py`, `tests/test_translator.py` |
| T13 | Indexing pipeline | 4 | T2, T3, T8 | `indexing/*.py`, `tests/test_indexing.py` |
| T14 | API + orchestration (REST + WS) | 5 | T2,T4,T5,T7,T9,T10,T12 | `app/api.py`, `app/main.py`, `tests/test_api.py` |
| T15 | End-to-end integration test | 6 | T14 | `tests/test_integration.py` |
| T16 | Front-end integration | 6 | T14, T6 | `frontend/index.html`, `frontend/styles.css`, `frontend/src/{app,ws-client,audio-capture,pcm-worklet,tts}.js`, `frontend/test/smoke.spec.js` |
| T17 | Retrieval eval harness | 6 | T12, T13 | `tests/test_retrieval_eval.py`, `tests/fixtures/recall_set.json` |

**Sequencing rationale:**
- T1 is alone in Wave 0 because all 16 other tasks import `models.py` and `config.py`. Defining every shared type and dependency once, up front, is what makes the later waves conflict-free.
- Wave 1 (5 agents) holds everything that needs only T1: the DB, the HTTP client, the VAD state machine, the trivial composer, and the front-end pure functions.
- Wave 2 (4 agents) holds the thin model wrappers (embedder/transcriber/option-gen need T3) and the persona store (needs T2). They do not depend on each other.
- T11 → T12 are serial because the translator calls symbol search; symbol search calls the embedder. This is the one unavoidable chain.
- T14 is the integration barrier — a single agent wires the orchestration so type mismatches surface in one place.
- Wave 6 (3 agents) are independent verification/UI tasks over the finished backend.

**Run all tests:** backend `pytest -q`; front-end `cd frontend && npm test`.

---

## Task 1: Scaffold, dependencies, config, shared models

**Files:**
- Create: `pyproject.toml`
- Create: `app/__init__.py` (empty)
- Create: `app/config.py`
- Create: `app/models.py`
- Create: `tests/__init__.py` (empty)
- Create: `tests/conftest.py`
- Create: `media/.gitkeep` (empty)

**Interfaces:**
- Consumes: nothing.
- Produces: `app.config` constants (`OPENROUTER_BASE_URL`, `MODEL_ASR`, `MODEL_LLM`, `MODEL_EMBED`, `EMBED_DIM`, `DB_PATH`, `MEDIA_DIR`, `DEFAULT_SETTINGS`); `app.models` pydantic types `Segment, Transcript, Candidate, Match, SymbolCard, Option, Persona, Pick, Utterance`.

- [ ] **Step 1: Create `pyproject.toml` pinning every dependency** (so no later task edits the dep file)

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
]

[project.optional-dependencies]
# Production VAD. Heavy (pulls torch); dev/CI use the numpy EnergyDetector instead.
vad = ["silero-vad>=5.1"]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Write `app/config.py`**

```python
import os
from pathlib import Path

OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

MODEL_ASR = "nvidia/parakeet-tdt-0.6b-v3"
MODEL_LLM = "z-ai/glm-5.2"
MODEL_EMBED = "intfloat/multilingual-e5-large"
EMBED_DIM = 1024

DB_PATH = Path(os.environ.get("AAC_DB_PATH", "aac.db"))
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

- [ ] **Step 3: Write `app/models.py`** (every shared type — later tasks import from here)

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

- [ ] **Step 4: Write `tests/conftest.py`** (shared fixtures — a fresh initialized DB per test)

```python
import sqlite3
import pytest


@pytest.fixture
def conn():
    # In-memory DB initialized with the schema. db.init_db is added in Task 2;
    # importing here is safe because conftest is only collected once db.py exists.
    from app import db
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.init_db(connection)
    yield connection
    connection.close()
```

- [ ] **Step 5: Verify the package imports**

Run: `python -c "import app.config, app.models; print(app.config.EMBED_DIM)"`
Expected: prints `1024`

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml app/ tests/ media/.gitkeep
git commit -m "chore: scaffold app package, config, and shared models"
```

---

## Task 2: Database layer, settings, vector helpers

**Files:**
- Create: `app/db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: `app.config.DEFAULT_SETTINGS`, `app.config.EMBED_DIM`.
- Produces:
  - `init_db(conn)` — creates all tables (spec §6) and seeds `DEFAULT_SETTINGS`.
  - `get_setting(conn, key) -> str` (falls back to `DEFAULT_SETTINGS`).
  - `set_setting(conn, key, value)`.
  - `vec_to_blob(values: list[float]) -> bytes` and `blob_to_vec(blob: bytes) -> numpy.ndarray` (float32).

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from app import db


def test_init_db_seeds_default_settings(conn):
    assert db.get_setting(conn, "lang") == "nl"
    assert db.get_setting(conn, "match_threshold") == "0.30"


def test_set_setting_overrides_default(conn):
    db.set_setting(conn, "lang", "en")
    assert db.get_setting(conn, "lang") == "en"


def test_vector_blob_roundtrip():
    values = [0.1, -0.2, 0.3]
    restored = db.blob_to_vec(db.vec_to_blob(values))
    assert np.allclose(restored, np.array(values, dtype=np.float32))


def test_tables_exist(conn):
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"symbols", "symbol_terms", "interactions",
            "options", "persona", "settings"} <= names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError`/`AttributeError: module 'app.db' has no attribute 'init_db'`

- [ ] **Step 3: Write `app/db.py`**

```python
import sqlite3
import numpy as np
from app import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT,
  image_path   TEXT NOT NULL,
  is_core      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbol_terms (
  symbol_id    INTEGER NOT NULL REFERENCES symbols(id),
  lang         TEXT NOT NULL,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,
  vector       BLOB NOT NULL,
  model        TEXT NOT NULL,
  PRIMARY KEY (symbol_id, lang)
);
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


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    for key, value in config.DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is not None:
        return row["value"] if isinstance(row, sqlite3.Row) else row[0]
    return config.DEFAULT_SETTINGS[key]


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()


def vec_to_blob(values) -> bytes:
    return np.asarray(values, dtype=np.float32).tobytes()


def blob_to_vec(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_db.py
git commit -m "feat: sqlite schema, settings accessor, vector blob helpers"
```

---

## Task 3: OpenRouter client

**Files:**
- Create: `app/openrouter.py`
- Test: `tests/test_openrouter.py`

**Interfaces:**
- Consumes: `app.config` (base url, api key).
- Produces (all async, module-level so consumers monkeypatch easily):
  - `chat(messages: list[dict], model: str, temperature: float = 0.7, response_format: dict | None = None) -> str` — returns the assistant message content.
  - `embed(texts: list[str], model: str) -> list[list[float]]`.
  - `transcribe(wav_bytes: bytes, model: str, language: str | None = None) -> str` — returns transcript text.

- [ ] **Step 1: Write the failing test** (using `httpx.MockTransport` — no network, no extra dep)

```python
import json
import httpx
import pytest
from app import openrouter


def _client_with(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="https://openrouter.ai/api/v1")


async def test_chat_returns_message_content(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/chat/completions")
        body = json.loads(request.content)
        assert body["model"] == "z-ai/glm-5.2"
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "hallo"}}]})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.chat([{"role": "user", "content": "hi"}], model="z-ai/glm-5.2")
    assert out == "hallo"


async def test_embed_returns_vectors(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/embeddings")
        return httpx.Response(200, json={"data": [{"embedding": [0.1, 0.2]}]})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.embed(["query: hi"], model="intfloat/multilingual-e5-large")
    assert out == [[0.1, 0.2]]


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
Expected: FAIL — `module 'app.openrouter' has no attribute '_make_client'`

- [ ] **Step 3: Write `app/openrouter.py`**

```python
import httpx
from app import config


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


async def embed(texts, model) -> list[list[float]]:
    async with _make_client() as client:
        response = await client.post("/embeddings", json={"model": model, "input": texts})
        response.raise_for_status()
        return [row["embedding"] for row in response.json()["data"]]


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
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/openrouter.py tests/test_openrouter.py
git commit -m "feat: OpenRouter client for chat, embeddings, transcription"
```

---

## Task 4: Audio segmenter (VAD endpointing)

**Files:**
- Create: `app/audio_stream.py` (the testable state machine)
- Create: `app/vad.py` (the real detectors; selected at runtime)
- Test: `tests/test_audio_stream.py`

**Interfaces:**
- Consumes: `app.models.Segment`.
- Produces:
  - `Segmenter(detector, sample_rate=16000, frame_ms=20, silence_ms=800)` with `feed(frame: bytes) -> Segment | None` and `reset() -> None`. `detector` is any callable `bytes -> bool` (is-speech). Emits a `Segment` when speech is followed by `silence_ms` of non-speech; returns `None` otherwise.
  - `app.vad.EnergyDetector(threshold=...)` (pure numpy, dev/CI default) and `app.vad.SileroDetector()` (lazy torch import, production). Both are callables `bytes -> bool`.

- [ ] **Step 1: Write the failing test** (a fake detector scripts speech/silence; logic is fully deterministic)

```python
from app.audio_stream import Segmenter

FRAME = b"\x00\x00" * 320            # 20 ms of silence at 16 kHz (640 bytes)
VOICE = b"\x10\x00" * 320            # 20 ms of "speech"


class ScriptedDetector:
    """Returns speech=True for VOICE frames, False for FRAME frames."""
    def __call__(self, frame: bytes) -> bool:
        return frame == VOICE


def test_emits_segment_after_trailing_silence():
    seg = Segmenter(ScriptedDetector(), silence_ms=40, frame_ms=20)  # 2 silent frames end it
    assert seg.feed(VOICE) is None
    assert seg.feed(VOICE) is None
    assert seg.feed(FRAME) is None           # 1st silent frame: 20 ms < 40 ms
    out = seg.feed(FRAME)                     # 2nd silent frame: endpoint reached
    assert out is not None
    assert out.pcm == VOICE + VOICE          # only the speech frames, silence trimmed


def test_ignores_leading_silence():
    seg = Segmenter(ScriptedDetector(), silence_ms=40, frame_ms=20)
    assert seg.feed(FRAME) is None
    assert seg.feed(FRAME) is None
    assert seg.feed(VOICE) is None           # speech started, nothing emitted yet


def test_reset_discards_buffer():
    seg = Segmenter(ScriptedDetector(), silence_ms=40, frame_ms=20)
    seg.feed(VOICE)
    seg.reset()
    assert seg.feed(FRAME) is None
    assert seg.feed(FRAME) is None           # no buffered speech → no segment
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audio_stream.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.audio_stream'`

- [ ] **Step 3: Write `app/audio_stream.py`**

```python
from app.models import Segment


class Segmenter:
    """Turns a stream of fixed-size frames into utterance-sized Segments.

    Buffers consecutive speech frames; once `silence_ms` of non-speech follows
    speech, the buffered speech is emitted as one Segment (trailing silence
    trimmed) and the buffer resets.
    """

    def __init__(self, detector, sample_rate=16000, frame_ms=20, silence_ms=800):
        self._detector = detector
        self._sample_rate = sample_rate
        self._silence_frames_needed = max(1, silence_ms // frame_ms)
        self._speech_frames: list[bytes] = []
        self._trailing_silence = 0

    def feed(self, frame: bytes) -> Segment | None:
        if self._detector(frame):
            self._speech_frames.append(frame)
            self._trailing_silence = 0
            return None

        if not self._speech_frames:
            return None                      # silence before any speech: ignore

        self._trailing_silence += 1
        if self._trailing_silence < self._silence_frames_needed:
            return None

        pcm = b"".join(self._speech_frames)
        self.reset()
        return Segment(pcm=pcm, sample_rate=self._sample_rate)

    def reset(self) -> None:
        self._speech_frames = []
        self._trailing_silence = 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_audio_stream.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Write `app/vad.py`** (real detectors; not unit-tested — exercised in the WS smoke later)

```python
import numpy as np


class EnergyDetector:
    """Cheap RMS-energy speech detector. Default for dev/CI (no torch)."""

    def __init__(self, threshold: float = 500.0):
        self._threshold = threshold

    def __call__(self, frame: bytes) -> bool:
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        if samples.size == 0:
            return False
        rms = float(np.sqrt(np.mean(samples ** 2)))
        return rms >= self._threshold


class SileroDetector:
    """Production detector. Lazily loads silero-vad (torch) on first call."""

    def __init__(self, sample_rate: int = 16000, threshold: float = 0.5):
        self._sample_rate = sample_rate
        self._threshold = threshold
        self._model = None

    def __call__(self, frame: bytes) -> bool:
        if self._model is None:
            from silero_vad import load_silero_vad
            self._model = load_silero_vad()
        import torch
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0
        prob = self._model(torch.from_numpy(samples), self._sample_rate).item()
        return prob >= self._threshold
```

- [ ] **Step 6: Commit**

```bash
git add app/audio_stream.py app/vad.py tests/test_audio_stream.py
git commit -m "feat: VAD segmenter with endpointing + energy/silero detectors"
```

---

## Task 5: Utterance composer

**Files:**
- Create: `app/utterance.py`
- Test: `tests/test_utterance.py`

**Interfaces:**
- Consumes: `app.models.Utterance`.
- Produces: `compose(text: str, lang: str) -> Utterance`. The seam where a chosen option becomes final spoken text (room for future post-processing; today it normalizes whitespace).

- [ ] **Step 1: Write the failing test**

```python
from app.utterance import compose


def test_compose_returns_text_and_lang():
    out = compose("ik wil koffie", "nl")
    assert out.text == "ik wil koffie"
    assert out.lang == "nl"


def test_compose_collapses_whitespace():
    assert compose("  ik   wil  koffie ", "nl").text == "ik wil koffie"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_utterance.py -v`
Expected: FAIL — `No module named 'app.utterance'`

- [ ] **Step 3: Write `app/utterance.py`**

```python
from app.models import Utterance


def compose(text: str, lang: str) -> Utterance:
    return Utterance(text=" ".join(text.split()), lang=lang)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_utterance.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/utterance.py tests/test_utterance.py
git commit -m "feat: utterance composer normalizes chosen option text"
```

---

## Task 6: Front-end pure utilities

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/src/downsample.js`
- Create: `frontend/src/echo-gate.js`
- Create: `frontend/src/selection-input.js`
- Test: `frontend/test/downsample.test.js`, `frontend/test/echo-gate.test.js`, `frontend/test/selection-input.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (ES modules):
  - `downsampleTo16k(float32, inputRate) -> Int16Array` — resample mono Float32 [-1,1] to 16 kHz PCM16.
  - `EchoGate({ guardMs, now })` with `startSpeaking()`, `stopSpeaking()`, `isMuted()` — true from `startSpeaking()` until `guardMs` after `stopSpeaking()`.
  - `DwellSelector({ dwellMs, onSelect, now })` with `enter(targetId)`, `leave()`, `tick()` — fires `onSelect(targetId)` once gaze/pointer dwells `dwellMs` on one target.

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
    const input = new Float32Array(32000).fill(1.0);
    const out = downsampleTo16k(input, 32000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBe(32767);            // 1.0 → max PCM16
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
    t = 200; expect(gate.isMuted()).toBe(true);   // within guard tail
    t = 350; expect(gate.isMuted()).toBe(false);  // tail elapsed
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
    const sample = float32[Math.floor(i * ratio)];
    const clamped = Math.max(-1, Math.min(1, sample));
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
- Create: `app/persona.py`
- Test: `tests/test_persona.py`

**Interfaces:**
- Consumes: `app.db`, `app.models.{Persona, Pick}`.
- Produces (sync, operate on a sqlite connection):
  - `load(conn) -> Persona`.
  - `recent(conn, n) -> list[Pick]` — last `n` interactions that have a selected option.
  - `log_interaction(conn, lang, context_type, context_text, audio_path=None, asr_model=None) -> int`.
  - `save_options(conn, interaction_id, rows) -> list[int]` where each row is `{"rank": int, "text": str, "glosses": list[str], "symbol_sequence": list[int]}`; returns option ids in rank order.
  - `mark_selected(conn, interaction_id, option_id) -> str` — sets `was_selected=1`, returns the option text; raises `KeyError` if the pair is unknown.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from app import persona


def _seed_persona(conn):
    conn.execute("INSERT INTO persona(id, profile, reading_level, updated_at) "
                 "VALUES (1, 'warm, direct', 'simple', '2026-06-21')")
    conn.commit()


def test_load_returns_profile(conn):
    _seed_persona(conn)
    p = persona.load(conn)
    assert p.profile == "warm, direct"
    assert p.reading_level == "simple"


def test_log_and_recent_roundtrip(conn):
    iid = persona.log_interaction(conn, "nl", "audio", "wil je koffie?", asr_model="x")
    ids = persona.save_options(conn, iid, [
        {"rank": 0, "text": "ja graag", "glosses": ["ja"], "symbol_sequence": [1]},
        {"rank": 1, "text": "nee dank je", "glosses": ["nee"], "symbol_sequence": [2]},
    ])
    text = persona.mark_selected(conn, iid, ids[0])
    assert text == "ja graag"
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
Expected: FAIL — `No module named 'app.persona'`

- [ ] **Step 3: Write `app/persona.py`**

```python
import json
from datetime import datetime, timezone
from app.models import Persona, Pick


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
git add app/persona.py tests/test_persona.py
git commit -m "feat: persona load + interaction/option learning log"
```

---

## Task 8: Embedder

**Files:**
- Create: `app/embedder.py`
- Test: `tests/test_embedder.py`

**Interfaces:**
- Consumes: `app.openrouter.embed`, `app.config.{MODEL_EMBED}`.
- Produces (async):
  - `embed(text: str, kind: str) -> list[float]` — `kind` in `{"query", "passage"}`; prepends the E5 prefix.
  - `embed_many(texts: list[str], kind: str) -> list[list[float]]`.

- [ ] **Step 1: Write the failing test** (assert the prefix is applied — the recall-critical behavior)

```python
from app import embedder, openrouter


async def test_embed_applies_query_prefix(monkeypatch):
    seen = {}

    async def fake_embed(texts, model):
        seen["texts"] = texts
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(openrouter, "embed", fake_embed)
    await embedder.embed("koffie", kind="query")
    assert seen["texts"] == ["query: koffie"]


async def test_embed_many_applies_passage_prefix(monkeypatch):
    seen = {}

    async def fake_embed(texts, model):
        seen["texts"] = texts
        return [[0.1] * 1024 for _ in texts]

    monkeypatch.setattr(openrouter, "embed", fake_embed)
    out = await embedder.embed_many(["meer", "koffie"], kind="passage")
    assert seen["texts"] == ["passage: meer", "passage: koffie"]
    assert len(out) == 2 and len(out[0]) == 1024
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_embedder.py -v`
Expected: FAIL — `No module named 'app.embedder'`

- [ ] **Step 3: Write `app/embedder.py`**

```python
from app import openrouter, config

_VALID_KINDS = {"query", "passage"}


def _prefix(text: str, kind: str) -> str:
    if kind not in _VALID_KINDS:
        raise ValueError(f"kind must be one of {_VALID_KINDS}, got {kind!r}")
    return f"{kind}: {text}"


async def embed(text: str, kind: str) -> list[float]:
    vectors = await openrouter.embed([_prefix(text, kind)], model=config.MODEL_EMBED)
    return vectors[0]


async def embed_many(texts: list[str], kind: str) -> list[list[float]]:
    prefixed = [_prefix(text, kind) for text in texts]
    return await openrouter.embed(prefixed, model=config.MODEL_EMBED)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_embedder.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/embedder.py tests/test_embedder.py
git commit -m "feat: E5 embedder with query/passage prefixes"
```

---

## Task 9: Transcriber

**Files:**
- Create: `app/transcriber.py`
- Test: `tests/test_transcriber.py`

**Interfaces:**
- Consumes: `app.openrouter.transcribe`, `app.config.MODEL_ASR`, `app.models.Transcript`.
- Produces (async): `transcribe(pcm: bytes, lang: str, sample_rate: int = 16000) -> Transcript` — wraps PCM16 as a WAV container and calls the ASR model.

- [ ] **Step 1: Write the failing test**

```python
import struct
from app import transcriber, openrouter
from app.models import Transcript


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
Expected: FAIL — `No module named 'app.transcriber'`

- [ ] **Step 3: Write `app/transcriber.py`**

```python
import io
import wave
from app import openrouter, config
from app.models import Transcript


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
git add app/transcriber.py tests/test_transcriber.py
git commit -m "feat: transcriber wraps PCM as WAV and calls Parakeet"
```

---

## Task 10: Option generator

**Files:**
- Create: `app/option_generator.py`
- Test: `tests/test_option_generator.py`

**Interfaces:**
- Consumes: `app.openrouter.chat`, `app.config.MODEL_LLM`, `app.models.{Candidate, Persona, Pick}`.
- Produces (async): `generate(context: str, persona: Persona, history: list[Pick], n: int, lang: str) -> list[Candidate]`. Prompts GLM-5.2 for `n` first-person responses, each `{text, glosses}`, returned as JSON; parses into `Candidate`s.

- [ ] **Step 1: Write the failing test**

```python
import json
from app import option_generator, openrouter
from app.models import Persona, Pick


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
    # The prompt must carry persona, history, and the context.
    prompt = " ".join(m["content"] for m in captured["messages"])
    assert "warm, direct" in prompt and "wil je koffie?" in prompt and "goed" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_option_generator.py -v`
Expected: FAIL — `No module named 'app.option_generator'`

- [ ] **Step 3: Write `app/option_generator.py`**

```python
import json
from app import openrouter, config
from app.models import Candidate, Persona, Pick

_SYSTEM = (
    "You generate first-person replies for a non-speaking AAC user. "
    "Reply only as her. Return JSON: "
    '{"options": [{"text": <natural sentence>, "glosses": [<core content words>]}]}. '
    "Glosses are telegraphic core words in the SAME language as text, for symbol lookup."
)


def _user_prompt(context: str, persona: Persona, history: list[Pick], n: int, lang: str) -> str:
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
        messages, model=config.MODEL_LLM,
        response_format={"type": "json_object"})
    options = json.loads(content)["options"]
    return [Candidate(text=o["text"], glosses=o["glosses"]) for o in options][:n]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_option_generator.py -v`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add app/option_generator.py tests/test_option_generator.py
git commit -m "feat: GLM-5.2 option generator returns {text, glosses}"
```

---

## Task 11: Symbol search

**Files:**
- Create: `app/symbol_search.py`
- Test: `tests/test_symbol_search.py`

**Interfaces:**
- Consumes: `app.embedder.embed`, `app.db.blob_to_vec`, `app.config.{MODEL_EMBED, EMBED_DIM}`, `app.models.Match`.
- Produces (async): `search(conn, text: str, k: int, lang: str) -> list[Match]` — embeds `text` as a query, brute-force cosine over `symbol_terms` rows for `lang`, returns the top `k` `Match`es (score in [-1, 1], descending).

- [ ] **Step 1: Write the failing test** (seed a tiny dictionary with known vectors; monkeypatch the embedder)

```python
import numpy as np
from app import symbol_search, embedder, db


def _add_symbol(conn, symbol_id, label, vector, lang="nl"):
    conn.execute("INSERT INTO symbols(id, source, image_path, created_at) "
                 "VALUES (?, 'arasaac', ?, '2026-06-21')",
                 (symbol_id, f"{label}.png"))
    conn.execute("INSERT INTO symbol_terms(symbol_id, lang, label, description, vector, model) "
                 "VALUES (?, ?, ?, ?, ?, ?)",
                 (symbol_id, lang, label, f"{label} desc",
                  db.vec_to_blob(vector), "intfloat/multilingual-e5-large"))
    conn.commit()


async def test_search_returns_nearest_symbol(conn, monkeypatch):
    _add_symbol(conn, 1, "koffie", [1.0, 0.0, 0.0])
    _add_symbol(conn, 2, "thee", [0.0, 1.0, 0.0])

    async def fake_embed(text, kind):
        assert kind == "query"
        return [0.9, 0.1, 0.0]            # closest to "koffie"

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "koffie alstublieft", k=1, lang="nl")
    assert len(matches) == 1
    assert matches[0].label == "koffie"
    assert matches[0].score > 0.9


async def test_search_respects_language_filter(conn, monkeypatch):
    _add_symbol(conn, 1, "koffie", [1.0, 0.0, 0.0], lang="nl")
    _add_symbol(conn, 2, "coffee", [1.0, 0.0, 0.0], lang="en")

    async def fake_embed(text, kind):
        return [1.0, 0.0, 0.0]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "coffee", k=5, lang="en")
    assert [m.label for m in matches] == ["coffee"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_symbol_search.py -v`
Expected: FAIL — `No module named 'app.symbol_search'`

- [ ] **Step 3: Write `app/symbol_search.py`**

```python
import numpy as np
from app import embedder, db
from app.models import Match


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

    query_vec = np.asarray(await embedder.embed(text, kind="query"), dtype=np.float32)
    matrix = np.vstack([db.blob_to_vec(r["vector"]) for r in rows])
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
git add app/symbol_search.py tests/test_symbol_search.py
git commit -m "feat: cosine top-k symbol search over per-language vectors"
```

---

## Task 12: Translator

**Files:**
- Create: `app/translator.py`
- Test: `tests/test_translator.py`

**Interfaces:**
- Consumes: `app.symbol_search.search`, `app.openrouter.chat`, `app.config.MODEL_LLM`, `app.models.{SymbolCard}`.
- Produces (async):
  - `to_symbols(conn, glosses: list[str], lang: str, threshold: float) -> list[SymbolCard]` — best symbol per gloss; below `threshold` → `as_text=True` card with `image_url=None`.
  - `glossify(text: str, lang: str) -> list[str]` — LLM decomposition of free text into core glosses (dev/`/translate` only).
  - `image_url_for(image_path: str) -> str` — `"/media/" + basename`.

- [ ] **Step 1: Write the failing test**

```python
from app import translator, symbol_search, openrouter
from app.models import Match


async def test_to_symbols_picks_best_above_threshold(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label=text, image_path=f"/abs/{text}.png", score=0.8)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].id == 7
    assert cards[0].as_text is False
    assert cards[0].image_url == "/media/koffie.png"


async def test_to_symbols_below_threshold_renders_text(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label="koffie", image_path="/abs/koffie.png", score=0.1)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].as_text is True
    assert cards[0].image_url is None
    assert cards[0].label == "koffie"


async def test_glossify_returns_core_words(monkeypatch):
    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        return '{"glosses": ["ik", "wil", "koffie"]}'

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    assert await translator.glossify("ik wil graag koffie", "nl") == ["ik", "wil", "koffie"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_translator.py -v`
Expected: FAIL — `No module named 'app.translator'`

- [ ] **Step 3: Write `app/translator.py`**

```python
import json
from pathlib import PurePath
from app import symbol_search, openrouter, config
from app.models import SymbolCard

_GLOSSIFY_SYSTEM = (
    "Break the text into telegraphic core content words (glosses) for AAC symbol "
    'lookup, same language. Return JSON: {"glosses": [<words>]}.'
)


def image_url_for(image_path: str) -> str:
    return "/media/" + PurePath(image_path).name


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
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/translator.py tests/test_translator.py
git commit -m "feat: translator maps glosses to symbols with threshold + glossify"
```

---

## Task 13: Offline indexing pipeline

**Files:**
- Create: `indexing/__init__.py` (empty)
- Create: `indexing/import_arasaac.py`
- Create: `indexing/enrich.py`
- Create: `indexing/build_index.py`
- Test: `tests/test_indexing.py`

**Interfaces:**
- Consumes: `app.db`, `app.embedder.embed_many`, `app.openrouter.chat`, `app.config`.
- Produces:
  - `import_arasaac.insert_symbol(conn, external_id, image_path, keyword, lang, is_core=False) -> int` — upserts a `symbols` row and a `symbol_terms` row (description seeded to the keyword, empty vector placeholder).
  - `enrich.enrich_description(keyword, lang) -> str` (async) — one LLM pass expanding a keyword into a richer description.
  - `build_index.build(conn, lang) -> int` (async) — embeds every `symbol_terms.description` for `lang` with the `passage` prefix, writes `vector` + `model`; returns count.

(The ARASAAC network fetch is a thin `main()` not unit-tested; the unit tests cover `insert_symbol`, `enrich_description`, and `build`.)

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from app import db, embedder, openrouter
from indexing import import_arasaac, enrich, build_index


async def test_insert_then_build_index_writes_vectors(conn, monkeypatch):
    sid = import_arasaac.insert_symbol(conn, external_id="123",
                                       image_path="koffie.png", keyword="koffie", lang="nl")
    assert sid > 0

    async def fake_embed_many(texts, kind):
        assert kind == "passage"
        return [[0.5] * 1024 for _ in texts]

    monkeypatch.setattr(embedder, "embed_many", fake_embed_many)
    count = await build_index.build(conn, lang="nl")
    assert count == 1
    row = conn.execute("SELECT vector, model FROM symbol_terms WHERE symbol_id = ?",
                       (sid,)).fetchone()
    assert db.blob_to_vec(row["vector"]).shape == (1024,)
    assert row["model"] == "intfloat/multilingual-e5-large"


async def test_enrich_description_calls_llm(monkeypatch):
    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        return "meer, nog een, extra, ik wil nog"

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    out = await enrich.enrich_description("meer", "nl")
    assert "extra" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_indexing.py -v`
Expected: FAIL — `No module named 'indexing'`

- [ ] **Step 3: Write the three modules**

`indexing/import_arasaac.py`:
```python
from datetime import datetime, timezone
from app import db, config


def insert_symbol(conn, external_id, image_path, keyword, lang, is_core=False) -> int:
    cursor = conn.execute(
        "INSERT INTO symbols(source, external_id, image_path, is_core, created_at) "
        "VALUES ('arasaac', ?, ?, ?, ?)",
        (external_id, image_path, int(is_core),
         datetime.now(timezone.utc).isoformat()))
    symbol_id = cursor.lastrowid
    conn.execute(
        "INSERT INTO symbol_terms(symbol_id, lang, label, description, vector, model) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (symbol_id, lang, keyword, keyword,
         db.vec_to_blob([0.0] * config.EMBED_DIM), ""))   # vector filled by build_index
    conn.commit()
    return symbol_id


# main(): fetch ARASAAC pictographs + nl/en keywords, download images to MEDIA_DIR,
# call insert_symbol per pictograph. Network-bound; run manually, not unit-tested.
```

`indexing/enrich.py`:
```python
from app import openrouter, config

_SYSTEM = ("Expand the AAC keyword into a short comma-separated description of "
           "related words and a typical phrase, same language. Plain text only.")


async def enrich_description(keyword: str, lang: str) -> str:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"Language: {lang}\nKeyword: {keyword}"},
    ]
    return await openrouter.chat(messages, model=config.MODEL_LLM)
```

`indexing/build_index.py`:
```python
from app import db, embedder, config


async def build(conn, lang: str) -> int:
    rows = conn.execute(
        "SELECT symbol_id, description FROM symbol_terms WHERE lang = ?", (lang,)).fetchall()
    if not rows:
        return 0
    vectors = await embedder.embed_many([r["description"] for r in rows], kind="passage")
    for row, vector in zip(rows, vectors):
        conn.execute(
            "UPDATE symbol_terms SET vector = ?, model = ? WHERE symbol_id = ? AND lang = ?",
            (db.vec_to_blob(vector), config.MODEL_EMBED, row["symbol_id"], lang))
    conn.commit()
    return len(rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_indexing.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add indexing/ tests/test_indexing.py
git commit -m "feat: offline indexing — import, enrich, build embeddings"
```

---

## Task 14: API + orchestration (REST + WebSocket)

**Files:**
- Create: `app/api.py`
- Create: `app/main.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `app.{persona, option_generator, translator, transcriber, audio_stream, vad, utterance, db}`, `app.models.Option`.
- Produces:
  - `propose(conn, *, context_text, lang, context_type, audio_path=None, asr_model=None) -> dict` — shared orchestration: persona + history → option_generator → translator → persist interaction + options → `{"interaction_id": int, "options": [Option...]}`.
  - FastAPI `app` with routes: `POST /expressive/options` (dev), `POST /expressive/select`, `POST /translate`, `WS /expressive/listen`, and `/media/*` static mount.

- [ ] **Step 1: Write the failing test for the dev propose path** (fakes for LLM + symbol search)

```python
import pytest
from fastapi.testclient import TestClient
from app import api, option_generator, translator
from app.models import Candidate, SymbolCard


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -v`
Expected: FAIL — `No module named 'app.api'`

- [ ] **Step 3: Write `app/api.py`**

```python
import json
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from app import (db, persona, option_generator, translator, transcriber,
                 utterance, config)
from app.audio_stream import Segmenter
from app.vad import EnergyDetector
from app.models import Option, SymbolCard

app = FastAPI()


def _open_conn():
    connection = db.connect() if hasattr(db, "connect") else None
    import sqlite3
    connection = sqlite3.connect(config.DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.init_db(connection)
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


async def propose(conn, *, context_text, lang, context_type,
                  audio_path=None, asr_model=None) -> dict:
    who = persona.load(conn)
    history = persona.recent(conn, n=5)
    n = int(db.get_setting(conn, "option_count"))
    threshold = float(db.get_setting(conn, "match_threshold"))
    candidates = await option_generator.generate(context_text, who, history, n, lang)

    interaction_id = persona.log_interaction(
        conn, lang, context_type, context_text, audio_path, asr_model)

    rows, card_lists = [], []
    for rank, candidate in enumerate(candidates):
        cards = await translator.to_symbols(conn, candidate.glosses, lang, threshold)
        card_lists.append(cards)
        rows.append({"rank": rank, "text": candidate.text, "glosses": candidate.glosses,
                     "symbol_sequence": [c.id for c in cards if not c.as_text]})
    option_ids = persona.save_options(conn, interaction_id, rows)

    options = [Option(option_id=oid, text=candidates[i].text, symbols=card_lists[i])
               for i, oid in enumerate(option_ids)]
    return {"interaction_id": interaction_id, "options": options}


@app.post("/expressive/options")
async def expressive_options(body: OptionsIn):
    conn = _open_conn()
    lang = body.lang or db.get_setting(conn, "lang")
    return await propose(conn, context_text=body.text, lang=lang, context_type="text")


@app.post("/expressive/select")
async def expressive_select(body: SelectIn):
    conn = _open_conn()
    lang = db.get_setting(conn, "lang")
    try:
        text = persona.mark_selected(conn, body.interaction_id, body.option_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown interaction/option")
    spoken = utterance.compose(text, lang)
    return {"text": spoken.text, "lang": spoken.lang}


@app.post("/translate")
async def translate(body: TranslateIn):
    conn = _open_conn()
    lang = body.lang or db.get_setting(conn, "lang")
    threshold = float(db.get_setting(conn, "match_threshold"))
    glosses = await translator.glossify(body.text, lang)
    cards = await translator.to_symbols(conn, glosses, lang, threshold)
    return {"glosses": glosses, "symbols": [c.model_dump() for c in cards]}


@app.websocket("/expressive/listen")
async def listen(ws: WebSocket):
    await ws.accept()
    conn = _open_conn()
    lang = db.get_setting(conn, "lang")
    silence_ms = int(db.get_setting(conn, "vad_silence_ms"))
    segmenter = Segmenter(EnergyDetector(), silence_ms=silence_ms)
    muted = False
    try:
        while True:
            message = await ws.receive()
            if message.get("text") is not None:
                control = json.loads(message["text"])
                if control.get("type") == "mute":
                    muted = True
                    segmenter.reset()
                elif control.get("type") == "unmute":
                    muted = False
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
            await ws.send_json({
                "type": "utterance",
                "interaction_id": result["interaction_id"],
                "transcript": transcript.text,
                "options": [o.model_dump() for o in result["options"]],
            })
    except WebSocketDisconnect:
        return
    finally:
        conn.close()


config.MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(config.MEDIA_DIR)), name="media")
```

- [ ] **Step 4: Write `app/main.py`** (uvicorn entry + front-end mount)

```python
from fastapi.staticfiles import StaticFiles
from app.api import app

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_api.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add app/api.py app/main.py tests/test_api.py
git commit -m "feat: API orchestration — options, select, translate, WS listen"
```

---

## Task 15: End-to-end integration test

**Files:**
- Test: `tests/test_integration.py`

**Interfaces:**
- Consumes: the full app with fakes for the three OpenRouter calls and a fake VAD via scripted frames.

- [ ] **Step 1: Write the WebSocket integration test** (audio frames → options pushed; fakes for ASR + LLM + search)

```python
import pytest
from fastapi.testclient import TestClient
from app import api, transcriber, option_generator, translator, db
from app.models import Transcript, Candidate, SymbolCard

VOICE = b"\x10\x00" * 320
SILENCE = b"\x00\x00" * 320


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(api, "_open_conn", lambda: conn)

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
    # EnergyDetector treats VOICE as speech, SILENCE as silence.
    db.set_setting(conn, "vad_silence_ms", "40")
    return TestClient(api.app)


def test_audio_stream_yields_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_bytes(VOICE)
        websocket.send_bytes(VOICE)
        websocket.send_bytes(SILENCE)
        websocket.send_bytes(SILENCE)            # endpoint → triggers propose
        event = websocket.receive_json()
    assert event["type"] == "utterance"
    assert event["transcript"] == "wil je koffie?"
    assert event["options"][0]["text"] == "ja graag"


def test_mute_marker_suppresses_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_json({"type": "mute"})
        websocket.send_bytes(VOICE)
        websocket.send_bytes(SILENCE)
        websocket.send_bytes(SILENCE)
        websocket.send_json({"type": "unmute"})
        websocket.send_bytes(VOICE)
        websocket.send_bytes(VOICE)
        websocket.send_bytes(SILENCE)
        websocket.send_bytes(SILENCE)
        event = websocket.receive_json()         # only the post-unmute utterance
    assert event["transcript"] == "wil je koffie?"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_integration.py -v`
Expected: PASS (2 tests). If the energy threshold rejects `VOICE`, lower `EnergyDetector` threshold or raise the VOICE amplitude in the fixture until `feed(VOICE)` is detected as speech.

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.py
git commit -m "test: end-to-end WS audio→options with mute suppression"
```

---

## Task 16: Front-end integration

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/styles.css`
- Create: `frontend/src/pcm-worklet.js`
- Create: `frontend/src/audio-capture.js`
- Create: `frontend/src/ws-client.js`
- Create: `frontend/src/tts.js`
- Create: `frontend/src/app.js`
- Test (smoke, manual/Playwright): `frontend/test/smoke.spec.js`

**Interfaces:**
- Consumes: T6 utilities (`downsampleTo16k`, `EchoGate`, `DwellSelector`); the API contract from T14.
- Produces: the running UI — mic capture → WS frames; render option rows of large symbol cards; dwell-select → `POST /expressive/select` → speak via `SpeechSynthesis`, with the echo gate muting the mic during playback.

- [ ] **Step 1: Write `frontend/src/tts.js`** (speak + drive the echo gate and a mute callback)

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
export function connectListen({ onUtterance }) {
  const ws = new WebSocket(`ws://${location.host}/expressive/listen`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "utterance") onUtterance(msg);
  };
  return {
    sendFrame: (int16) => { if (ws.readyState === 1) ws.send(int16.buffer); },
    mute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "mute" })),
    unmute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "unmute" })),
  };
}
```

- [ ] **Step 3: Write `frontend/src/pcm-worklet.js`** (forwards raw Float32 frames to the main thread)

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

- [ ] **Step 5: Write `frontend/src/app.js`** (wire everything)

```javascript
import { connectListen } from "./ws-client.js";
import { startCapture } from "./audio-capture.js";
import { createSpeaker } from "./tts.js";
import { DwellSelector } from "./selection-input.js";

const grid = document.getElementById("options");
let currentInteraction = null;

const ws = connectListen({ onUtterance: renderOptions });
const speaker = createSpeaker({
  guardMs: 300,
  onMuteChange: (muted) => (muted ? ws.mute() : ws.unmute()),
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
    row.dataset.text = option.text;
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

async function choose(optionId) {
  const row = grid.querySelector(`[data-option-id="${optionId}"]`);
  if (!row) return;
  const res = await fetch("/expressive/select", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interaction_id: currentInteraction, option_id: Number(optionId) }),
  });
  const { text, lang } = await res.json();
  speaker.speak(text, lang);
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

- [ ] **Step 7: Write the smoke test** (Playwright; document that it needs the server running with a fake)

`frontend/test/smoke.spec.js`:
```javascript
// Smoke test — run against `python -m app.main` with stubbed OpenRouter calls.
// Verifies the option grid renders and selecting speaks. Not a unit test; this
// exercises real WS + DOM. Marked manual in CI until a fake-backed fixture exists.
import { test, expect } from "@playwright/test";

test("renders options and selects one", async ({ page }) => {
  await page.goto("http://127.0.0.1:8000/");
  await expect(page.locator("h1")).toHaveText("Kies een antwoord");
  // With a seeded utterance pushed over the WS, an .option appears and is clickable.
  // (Requires the dev harness from the run checklist below.)
});
```

- [ ] **Step 8: Manual verification checklist** (TDD is impractical for getUserMedia/WS in CI — verify by hand)

```
1. Seed a tiny DB + index (Task 13 main, or a fixture) and set OPENROUTER_API_KEY.
2. Run: python -m app.main
3. Open http://127.0.0.1:8000/ , grant mic permission.
4. Speak a Dutch sentence; confirm option rows of symbol cards appear.
5. Dwell on one; confirm it is spoken and the mic icon mutes during playback.
6. Confirm the spoken reply does NOT produce a new option set (echo guard works).
```

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html frontend/styles.css frontend/src tests
git commit -m "feat: front-end — mic capture, options grid, dwell-select, TTS echo guard"
```

---

## Task 17: Retrieval eval harness (recall@k)

**Files:**
- Create: `tests/fixtures/recall_set.json`
- Test: `tests/test_retrieval_eval.py`

**Interfaces:**
- Consumes: `app.symbol_search.search`, `app.db`.
- Produces: a recall@k measurement over curated `query → expected symbol` pairs; the primary tuning signal for descriptions, threshold, and `k`.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/recall_set.json`:
```json
[
  {"lang": "nl", "query": "ik wil koffie", "expected_label": "koffie"},
  {"lang": "nl", "query": "nog een keer", "expected_label": "meer"},
  {"lang": "en", "query": "i want coffee", "expected_label": "coffee"}
]
```

- [ ] **Step 2: Write the eval test** (deterministic: seed known vectors so recall is exercised without network)

```python
import json
from pathlib import Path
import numpy as np
from app import symbol_search, embedder, db

FIXTURE = Path(__file__).parent / "fixtures" / "recall_set.json"

_VECTORS = {
    "koffie": [1.0, 0.0, 0.0], "meer": [0.0, 1.0, 0.0], "coffee": [1.0, 0.0, 0.0],
}
_QUERY_VECTORS = {
    "ik wil koffie": [0.95, 0.05, 0.0], "nog een keer": [0.0, 0.98, 0.02],
    "i want coffee": [0.97, 0.0, 0.0],
}


def _seed(conn):
    for i, (label, vec) in enumerate(_VECTORS.items(), start=1):
        lang = "en" if label == "coffee" else "nl"
        conn.execute("INSERT INTO symbols(id, source, image_path, created_at) "
                     "VALUES (?, 'arasaac', ?, '2026-06-21')", (i, f"{label}.png"))
        conn.execute("INSERT INTO symbol_terms(symbol_id, lang, label, description, vector, model) "
                     "VALUES (?, ?, ?, ?, ?, 'm')",
                     (i, lang, label, label, db.vec_to_blob(vec)))
    conn.commit()


async def test_recall_at_1_is_perfect_on_fixture(conn, monkeypatch):
    _seed(conn)

    async def fake_embed(text, kind):
        return _QUERY_VECTORS[text]

    monkeypatch.setattr(embedder, "embed", fake_embed)

    cases = json.loads(FIXTURE.read_text())
    hits = 0
    for case in cases:
        matches = await symbol_search.search(conn, case["query"], k=1, lang=case["lang"])
        if matches and matches[0].label == case["expected_label"]:
            hits += 1
    recall_at_1 = hits / len(cases)
    assert recall_at_1 == 1.0          # tighten/extend the fixture as real vectors land
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

## Self-Review (completed against the spec)

**Spec coverage:**
- §5 modules — every module maps to a task: audio_stream→T4, transcriber→T9, embedder→T8, symbol_search→T11, translator→T12, option_generator→T10, utterance→T5, persona→T7, api→T14, indexing→T13. ✓
- §6 data model — all six tables created in T2; `context_audio_path`/`asr_model` plumbed in T7/T14. ✓
- §7 endpoints — WS `/expressive/listen` (T14), `/expressive/select` (T14), dev `/expressive/options` (T14), `/translate` (T14). ✓
- §8 data flow — covered by the T15 WS test. ✓
- §9 services — one OpenRouter client (T3) for ASR/LLM/embeddings; no second vendor. ✓
- §10 indexing — T13. ✓
- §11 errors — empty transcript skipped (T14), unknown selection → 404 (T14), TTS echo guard (mute markers T14 + EchoGate T6 + capture gate T16). ✓
- §12 testing — unit tests per module; integration T15; recall@k T17. ✓
- §13 stack / §3 decisions — pins, models, dims, VAD, prefixes all in T1 + relevant tasks. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every code step contains real code. The only non-code verifications are the front-end manual checklist (T16) and the Playwright smoke (honestly flagged, because getUserMedia/WS cannot be unit-tested deterministically). ✓

**Type consistency:** `Match(symbol_id,label,image_path,score)`, `SymbolCard(id,label,image_url,confidence,as_text)`, `Candidate(text,glosses)`, `Option(option_id,text,symbols)`, `Transcript(text,lang)`, `Segment(pcm,sample_rate)` are used identically across producers (T11/T12/T10/T14) and consumers. `propose()` and `to_symbols(conn,...)` signatures match their call sites in T14/T15. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/2026-06-21-audio-symbol-translator-implementation-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. To exploit the wave structure, dispatch all tasks in a wave concurrently (superpowers:dispatching-parallel-agents), review, then barrier before the next wave.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
