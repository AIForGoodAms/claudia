# ARASAAC Symbol Seeding Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a curated core-vocabulary subset of ARASAAC into SQLite — images on disk, a raw text description per language, and a 1024-d embedding per description — via a resumable, idempotent offline pipeline.

**Architecture:** Small single-purpose modules behind narrow interfaces: a `db` helper (schema + writes + vector packing), a pure `describe` composer, an `embedder` wrapping OpenRouter's OpenAI-compatible `/embeddings`, an `arasaac` REST client, and a `seed` orchestrator that resolves each curated word to a pictograph, downloads its image, composes and embeds descriptions, and writes rows. Tasks 2–6 share no files and are built in parallel; Task 7 composes them.

**Tech Stack:** Python 3.11 · stdlib `sqlite3` · `httpx` (HTTP + `MockTransport` for tests) · `pytest` · OpenRouter `intfloat/multilingual-e5-large`.

## Global Constraints

- **No project scaffolding in this plan.** `pyproject.toml`, dependency install, and the runtime `media/`/DB files are created by a separate setup pass. This plan writes only feature code, tests, and package markers (`indexing/__init__.py`, root `conftest.py`).
- **Required dependencies** (the separate setup pass must provide them): `httpx`, `pytest`. Everything else is stdlib.
- **Import root:** tests and the CLI run from the repo root. The root `conftest.py` (Task 1) puts the repo root on `sys.path`, so `import db`, `import embedder`, and `from indexing import arasaac, describe` resolve.
- **Embedding model id:** `intfloat/multilingual-e5-large`; stored model tag `intfloat/multilingual-e5-large@1024`; vector dim **1024**, stored as little-endian `float32`.
- **E5 prefix rule:** stored descriptions are embedded with the `"passage: "` prefix; live queries (future) use `"query: "`. The prefix is applied inside `embedder.embed`, never by callers.
- **OpenRouter:** base URL `https://openrouter.ai/api/v1`; bearer auth from `OPENROUTER_API_KEY`.
- **ARASAAC:** base URL `https://api.arasaac.org/v1`; image URL `https://static.arasaac.org/pictograms/{id}/{id}_300.png`; pictogram id field is `_id`; keyword objects carry `keyword` and optional `meaning`.
- **TDD throughout:** every behavior gets a failing test first, then minimal code, then a commit. Commit messages use Conventional Commits.

---

## File Structure

| File | Responsibility |
|---|---|
| `conftest.py` (root) | put repo root on `sys.path` for tests |
| `indexing/__init__.py` | package marker (empty) |
| `db.py` | SQLite connect, schema, idempotent writes, vector pack/unpack |
| `embedder.py` | OpenRouter `/embeddings` wrapper; applies E5 prefix; shared with the future live path |
| `indexing/describe.py` | compose embedded description from keywords + meaning |
| `indexing/arasaac.py` | ARASAAC REST client: search, fetch-by-id, extract terms, download image |
| `indexing/core_words.txt` | curated Dutch communicative units (words + phrases) |
| `indexing/seed.py` | orchestrator + CLI: resolve → download → compose → embed → write |
| `tests/test_*.py` | one test module per source module |

## Parallelization

- **Task 1** runs first (creates the package markers every other task imports through).
- **Tasks 2–6** (`describe`, `embedder`, `db`, `arasaac`, `core_words`) touch disjoint files and have no inter-dependencies — **dispatch them concurrently** (separate subagents / git worktrees).
- **Task 7** (`seed`) consumes all of 2–6 and must run after they land.
- **Task 8** (live smoke test) runs last.

---

### Task 1: Package markers and test import root

**Files:**
- Create: `indexing/__init__.py` (empty)
- Create: `conftest.py`
- Test: `tests/test_import_root.py`

**Interfaces:**
- Consumes: nothing.
- Produces: an import environment where `import db`, `import embedder`, and `from indexing import ...` resolve when pytest/CLI run from the repo root.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_import_root.py
import sys
from pathlib import Path


def test_repo_root_on_syspath():
    root = str(Path(__file__).resolve().parent.parent)
    assert root in sys.path


def test_indexing_is_a_package():
    import indexing  # noqa: F401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_import_root.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'indexing'` (and/or root not on path).

- [ ] **Step 3: Create the package marker and conftest**

```python
# indexing/__init__.py
# (empty — package marker)
```

```python
# conftest.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_import_root.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add indexing/__init__.py conftest.py tests/test_import_root.py
git commit -m "chore: add package marker and test import root"
```

---

### Task 2: `describe.py` — compose the embedded description

**Files:**
- Create: `indexing/describe.py`
- Test: `tests/test_describe.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `compose(keywords: list[str], meaning: str | None) -> str` — joins keywords with `", "`; appends `" — {meaning}"` when meaning is non-empty; degrades to keywords-only otherwise. Drops blank keywords.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_describe.py
from indexing.describe import compose


def test_keywords_and_meaning():
    assert compose(["meer", "nog", "extra"], "een grotere hoeveelheid") == \
        "meer, nog, extra — een grotere hoeveelheid"


def test_keywords_only_when_no_meaning():
    assert compose(["meer", "nog"], None) == "meer, nog"


def test_blank_meaning_degrades_to_keywords_only():
    assert compose(["meer"], "   ") == "meer"


def test_blank_keywords_are_dropped():
    assert compose(["meer", "", "  ", "extra"], None) == "meer, extra"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_describe.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'indexing.describe'`.

- [ ] **Step 3: Write minimal implementation**

```python
# indexing/describe.py
def compose(keywords, meaning):
    joined = ", ".join(k.strip() for k in keywords if k and k.strip())
    if meaning and meaning.strip():
        return f"{joined} — {meaning.strip()}"
    return joined
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_describe.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add indexing/describe.py tests/test_describe.py
git commit -m "feat: compose ARASAAC description from keywords and meaning"
```

---

### Task 3: `embedder.py` — OpenRouter embeddings with the E5 prefix

**Files:**
- Create: `embedder.py`
- Test: `tests/test_embedder.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MODEL_ID = "intfloat/multilingual-e5-large"`, `MODEL_TAG = "intfloat/multilingual-e5-large@1024"`, `DIMS = 1024`, `BASE_URL = "https://openrouter.ai/api/v1"`.
  - `embed(texts: list[str], kind: str, *, client: httpx.Client | None = None) -> list[list[float]]` — prepends `"passage: "` or `"query: "` per `kind`, POSTs `{"model": MODEL_ID, "input": [...]}` to `/embeddings`, returns one 1024-float vector per input. Raises `ValueError` on a bad `kind` or a wrong-length vector. When `client` is omitted it builds one from `OPENROUTER_API_KEY`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_embedder.py
import json
import httpx
import pytest
from embedder import embed, DIMS, MODEL_ID


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")


def test_embed_applies_passage_prefix_and_sends_model():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"embedding": [0.1] * DIMS}]})

    out = embed(["meer"], "passage", client=_client(handler))
    assert captured["body"]["input"] == ["passage: meer"]
    assert captured["body"]["model"] == MODEL_ID
    assert len(out) == 1 and len(out[0]) == DIMS


def test_embed_applies_query_prefix():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"embedding": [0.0] * DIMS}]})

    embed(["water"], "query", client=_client(handler))
    assert captured["body"]["input"] == ["query: water"]


def test_embed_preserves_input_order_for_batches():
    def handler(request):
        body = json.loads(request.content)
        data = [{"embedding": [float(i)] * DIMS} for i, _ in enumerate(body["input"])]
        return httpx.Response(200, json={"data": data})

    out = embed(["a", "b", "c"], "passage", client=_client(handler))
    assert [v[0] for v in out] == [0.0, 1.0, 2.0]


def test_embed_rejects_bad_kind():
    with pytest.raises(ValueError):
        embed(["x"], "document", client=_client(lambda r: httpx.Response(200, json={"data": []})))


def test_embed_rejects_wrong_dimension():
    def handler(request):
        return httpx.Response(200, json={"data": [{"embedding": [0.0] * 5}]})

    with pytest.raises(ValueError):
        embed(["x"], "passage", client=_client(handler))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_embedder.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'embedder'`.

- [ ] **Step 3: Write minimal implementation**

```python
# embedder.py
import os
import httpx

MODEL_ID = "intfloat/multilingual-e5-large"
DIMS = 1024
MODEL_TAG = f"{MODEL_ID}@{DIMS}"
BASE_URL = "https://openrouter.ai/api/v1"


def _prefix(kind):
    if kind not in ("passage", "query"):
        raise ValueError(f"kind must be 'passage' or 'query', got {kind!r}")
    return f"{kind}: "


def embed(texts, kind, *, client=None):
    inputs = [_prefix(kind) + t for t in texts]
    owns_client = client is None
    if owns_client:
        key = os.environ["OPENROUTER_API_KEY"]
        client = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {key}"},
            timeout=60,
        )
    try:
        response = client.post("/embeddings", json={"model": MODEL_ID, "input": inputs})
        response.raise_for_status()
        vectors = [row["embedding"] for row in response.json()["data"]]
    finally:
        if owns_client:
            client.close()
    for vector in vectors:
        if len(vector) != DIMS:
            raise ValueError(f"expected {DIMS}-d vector, got {len(vector)}")
    return vectors
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_embedder.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add embedder.py tests/test_embedder.py
git commit -m "feat: embed text via OpenRouter multilingual-e5-large with E5 prefix"
```

---

### Task 4: `db.py` — schema, idempotent writes, vector packing

**Files:**
- Create: `db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `connect(db_path) -> sqlite3.Connection`
  - `create_schema(conn) -> None` — creates `symbols` and `symbol_terms` per the spec (idempotent: `IF NOT EXISTS`).
  - `pack_vector(vec: list[float]) -> bytes` / `unpack_vector(blob: bytes) -> list[float]` — little-endian `float32`.
  - `symbol_exists(conn, external_id: str) -> bool`
  - `insert_symbol(conn, *, source, external_id, image_path, is_core, created_at) -> int` (returns new symbol id)
  - `insert_term(conn, *, symbol_id, lang, label, description, vector: bytes, model) -> None`

This task has several small behaviors; do one red→green→commit cycle per group.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_db.py
import math
import db


def fresh():
    conn = db.connect(":memory:")
    db.create_schema(conn)
    return conn


def test_schema_creates_both_tables():
    conn = fresh()
    names = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"symbols", "symbol_terms"} <= names


def test_create_schema_is_idempotent():
    conn = fresh()
    db.create_schema(conn)  # second call must not raise


def test_vector_roundtrip_is_float32_stable():
    vec = [0.0, 1.5, -2.25, 3.125]
    blob = db.pack_vector(vec)
    assert len(blob) == len(vec) * 4
    out = db.unpack_vector(blob)
    assert all(math.isclose(a, b, rel_tol=1e-6) for a, b in zip(vec, out))


def test_insert_symbol_then_exists():
    conn = fresh()
    sid = db.insert_symbol(conn, source="arasaac", external_id="2349",
                           image_path="media/2349.png", is_core=1, created_at="t0")
    assert isinstance(sid, int)
    assert db.symbol_exists(conn, "2349") is True
    assert db.symbol_exists(conn, "9999") is False


def test_duplicate_external_id_is_rejected():
    conn = fresh()
    db.insert_symbol(conn, source="arasaac", external_id="2349",
                     image_path="media/2349.png", is_core=1, created_at="t0")
    import sqlite3
    try:
        db.insert_symbol(conn, source="arasaac", external_id="2349",
                         image_path="media/2349.png", is_core=1, created_at="t0")
        assert False, "expected IntegrityError"
    except sqlite3.IntegrityError:
        pass


def test_insert_term_persists_row():
    conn = fresh()
    sid = db.insert_symbol(conn, source="arasaac", external_id="2349",
                           image_path="media/2349.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang="nl", label="meer",
                   description="meer, nog", vector=db.pack_vector([0.0] * 4),
                   model="intfloat/multilingual-e5-large@1024")
    row = conn.execute(
        "SELECT label, description, model FROM symbol_terms "
        "WHERE symbol_id=? AND lang='nl'", (sid,)).fetchone()
    assert row == ("meer", "meer, nog", "intfloat/multilingual-e5-large@1024")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'db'`.

- [ ] **Step 3: Write minimal implementation**

```python
# db.py
import sqlite3
import struct

SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT UNIQUE,
  image_path   TEXT NOT NULL,
  is_core      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbol_terms (
  symbol_id            INTEGER NOT NULL REFERENCES symbols(id),
  lang                 TEXT NOT NULL,
  label                TEXT NOT NULL,
  description          TEXT NOT NULL,
  enriched_description TEXT,
  vector               BLOB NOT NULL,
  model                TEXT NOT NULL,
  PRIMARY KEY (symbol_id, lang)
);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def pack_vector(vec):
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob):
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def symbol_exists(conn, external_id):
    row = conn.execute(
        "SELECT 1 FROM symbols WHERE external_id = ?", (external_id,)).fetchone()
    return row is not None


def insert_symbol(conn, *, source, external_id, image_path, is_core, created_at):
    cursor = conn.execute(
        "INSERT INTO symbols (source, external_id, image_path, is_core, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (source, external_id, image_path, is_core, created_at),
    )
    return cursor.lastrowid


def insert_term(conn, *, symbol_id, lang, label, description, vector, model):
    conn.execute(
        "INSERT INTO symbol_terms "
        "(symbol_id, lang, label, description, vector, model) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (symbol_id, lang, label, description, vector, model),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat: SQLite schema, idempotent writes, float32 vector packing"
```

---

### Task 5: `arasaac.py` — ARASAAC REST client

**Files:**
- Create: `indexing/arasaac.py`
- Test: `tests/test_arasaac.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BASE_URL`, `IMAGE_URL` (`"https://static.arasaac.org/pictograms/{id}/{id}_300.png"`).
  - `search(text: str, lang: str, *, client: httpx.Client) -> list[dict]`
  - `pictogram(picto_id: int, lang: str, *, client: httpx.Client) -> dict`
  - `extract_terms(picto: dict) -> tuple[list[str], str | None]` — keyword strings + first non-empty `meaning`.
  - `download_image(picto_id: int, dest, *, client: httpx.Client) -> None` — GET the 300px PNG, write bytes to `dest`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_arasaac.py
import httpx
from indexing import arasaac


def client_for(routes):
    def handler(request):
        body, status = routes[request.url.path]
        if isinstance(body, bytes):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_search_returns_pictogram_list():
    routes = {"/v1/pictograms/nl/search/meer": ([{"_id": 2349, "keywords": [
        {"keyword": "meer", "meaning": "een grotere hoeveelheid"}]}], 200)}
    results = arasaac.search("meer", "nl", client=client_for(routes))
    assert results[0]["_id"] == 2349


def test_pictogram_fetches_by_id():
    routes = {"/v1/pictograms/en/2349": ({"_id": 2349, "keywords": [
        {"keyword": "more"}]}, 200)}
    picto = arasaac.pictogram(2349, "en", client=client_for(routes))
    assert picto["keywords"][0]["keyword"] == "more"


def test_extract_terms_pulls_keywords_and_first_meaning():
    picto = {"keywords": [
        {"keyword": "meer"},
        {"keyword": "nog", "meaning": "een grotere hoeveelheid"},
    ]}
    keywords, meaning = arasaac.extract_terms(picto)
    assert keywords == ["meer", "nog"]
    assert meaning == "een grotere hoeveelheid"


def test_extract_terms_meaning_is_none_when_absent():
    keywords, meaning = arasaac.extract_terms({"keywords": [{"keyword": "meer"}]})
    assert keywords == ["meer"] and meaning is None


def test_download_image_writes_bytes(tmp_path):
    routes = {"/pictograms/2349/2349_300.png": (b"\x89PNGdata", 200)}
    dest = tmp_path / "2349.png"
    arasaac.download_image(2349, dest, client=client_for(routes))
    assert dest.read_bytes() == b"\x89PNGdata"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_arasaac.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'indexing.arasaac'`.

- [ ] **Step 3: Write minimal implementation**

```python
# indexing/arasaac.py
from pathlib import Path

BASE_URL = "https://api.arasaac.org/v1"
IMAGE_URL = "https://static.arasaac.org/pictograms/{id}/{id}_300.png"


def search(text, lang, *, client):
    response = client.get(f"{BASE_URL}/pictograms/{lang}/search/{text}")
    response.raise_for_status()
    return response.json()


def pictogram(picto_id, lang, *, client):
    response = client.get(f"{BASE_URL}/pictograms/{lang}/{picto_id}")
    response.raise_for_status()
    return response.json()


def extract_terms(picto):
    keywords = [k["keyword"] for k in picto.get("keywords", []) if k.get("keyword")]
    meaning = next(
        (k["meaning"] for k in picto.get("keywords", []) if k.get("meaning")), None)
    return keywords, meaning


def download_image(picto_id, dest, *, client):
    response = client.get(IMAGE_URL.format(id=picto_id))
    response.raise_for_status()
    Path(dest).write_bytes(response.content)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_arasaac.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add indexing/arasaac.py tests/test_arasaac.py
git commit -m "feat: ARASAAC REST client (search, fetch, extract, image download)"
```

---

### Task 6: `core_words.txt` — curated communicative units

**Files:**
- Create: `indexing/core_words.txt`
- Test: `tests/test_core_words.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `indexing/core_words.txt` — one communicative unit per line; `#` lines and blank lines are comments/ignored. Mixes single core words with short social phrases/sentences, including the self-introduction set.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_core_words.py
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent / "indexing" / "core_words.txt"


def entries():
    lines = CORE.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def test_has_a_substantial_list():
    assert len(entries()) >= 50


def test_no_duplicate_entries():
    items = entries()
    assert len(items) == len(set(items))


def test_includes_single_core_words():
    items = set(entries())
    assert {"ik", "willen", "meer", "niet", "stop"} <= items


def test_includes_self_introduction_phrases():
    items = set(entries())
    assert {"mijn naam is", "ik ben blij je te ontmoeten", "ik woon in"} <= items
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_core_words.py -v`
Expected: FAIL — `FileNotFoundError` for `core_words.txt`.

- [ ] **Step 3: Create the curated list**

Author `indexing/core_words.txt`. Start from the entries the tests require, then expand toward ~200–300 total using standard AAC core- and fringe-vocabulary sets. Keep one entry per line; group with `#` comments. Minimum content (extend, do not shrink):

```text
# --- pronouns & people ---
ik
jij
wij
mama
papa

# --- core verbs ---
willen
hebben
gaan
komen
maken
eten
drinken
helpen
stoppen
kijken
voelen
zeggen

# --- requests & polite ---
meer
klaar
alsjeblieft
dank je wel
ja
nee
stop

# --- feelings & states ---
blij
verdrietig
boos
moe
pijn
ziek
honger
dorst

# --- describing ---
groot
klein
warm
koud
mooi
leuk
niet

# --- time & place ---
nu
straks
hier
thuis
buiten

# --- social phrases ---
hallo
goedemorgen
tot ziens
hoe gaat het met je?

# --- self-introduction (elaborate units) ---
mijn naam is
ik ben blij je te ontmoeten
ik woon in
ik hou van muziek
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_core_words.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add indexing/core_words.txt tests/test_core_words.py
git commit -m "feat: curated Dutch core-vocabulary seed list with phrase units"
```

---

### Task 7: `seed.py` — orchestrator and CLI

**Files:**
- Create: `indexing/seed.py`
- Test: `tests/test_seed.py`

**Interfaces:**
- Consumes: `db` (Task 4), `embedder` (Task 3, for `MODEL_TAG`), `indexing.arasaac` (Task 5), `indexing.describe` (Task 2), `indexing/core_words.txt` (Task 6).
- Produces:
  - `load_words(path) -> list[str]` — non-blank, non-`#` lines, stripped.
  - `resolve(word, *, client) -> dict | None` — `{"id": int, "nl": (keywords, meaning), "en": (keywords, meaning)}`, or `None` on no match / HTTP 404 / empty nl keywords.
  - `seed_one(conn, word, media_dir, *, client, embed_fn, now) -> str` — returns `"seeded" | "skipped" | "unresolved"`; commits per word (atomic).
  - `main(argv=None) -> None` — CLI wiring; writes `unresolved.txt`; prints a status count.

**Resolution flow:** search `nl` → take the first result's `_id` and nl terms → fetch the same id in `en` for en terms. A symbol that already exists (by `external_id`) is `"skipped"` (idempotent re-run). Each language's description is `describe.compose(...)`, embedded with `embed_fn([description], "passage")[0]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_seed.py
import httpx
import db
from indexing import seed


def fake_embed(texts, kind):
    assert kind == "passage"
    return [[float(len(texts[0]))] * 1024]


def arasaac_client():
    routes = {
        "/v1/pictograms/nl/search/meer": [{"_id": 2349, "keywords": [
            {"keyword": "meer", "meaning": "een grotere hoeveelheid"}]}],
        "/v1/pictograms/en/2349": {"_id": 2349, "keywords": [{"keyword": "more"}]},
    }

    def handler(request):
        path = request.url.path
        if path.endswith("_300.png"):
            return httpx.Response(200, content=b"PNG")
        if path == "/v1/pictograms/nl/search/onbekendwoord":
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=routes[path])

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_load_words_ignores_comments_and_blanks(tmp_path):
    f = tmp_path / "words.txt"
    f.write_text("# header\n\nik\n  meer  \n", encoding="utf-8")
    assert seed.load_words(f) == ["ik", "meer"]


def test_resolve_returns_none_on_404():
    assert seed.resolve("onbekendwoord", client=arasaac_client()) is None


def test_seed_one_seeds_symbol_image_and_terms(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    status = seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                           embed_fn=fake_embed, now="t0")
    assert status == "seeded"
    assert db.symbol_exists(conn, "2349")
    langs = [r[0] for r in conn.execute(
        "SELECT lang FROM symbol_terms ORDER BY lang")]
    assert langs == ["en", "nl"]
    vlen = conn.execute(
        "SELECT length(vector) FROM symbol_terms LIMIT 1").fetchone()[0]
    assert vlen == 1024 * 4
    assert (tmp_path / "2349.png").read_bytes() == b"PNG"


def test_seed_one_is_idempotent(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                  embed_fn=fake_embed, now="t0")
    status = seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                           embed_fn=fake_embed, now="t0")
    assert status == "skipped"
    count = conn.execute("SELECT COUNT(*) FROM symbol_terms").fetchone()[0]
    assert count == 2  # not 4
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_seed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'indexing.seed'`.

- [ ] **Step 3: Write minimal implementation**

```python
# indexing/seed.py
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

import db
import embedder
from indexing import arasaac, describe


def load_words(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def resolve(word, *, client):
    try:
        results = arasaac.search(word, "nl", client=client)
    except httpx.HTTPStatusError:
        return None
    if not results:
        return None
    picto = results[0]
    picto_id = picto["_id"]
    nl_keywords, nl_meaning = arasaac.extract_terms(picto)
    if not nl_keywords:
        return None
    english = arasaac.pictogram(picto_id, "en", client=client)
    en_keywords, en_meaning = arasaac.extract_terms(english)
    return {"id": picto_id, "nl": (nl_keywords, nl_meaning),
            "en": (en_keywords, en_meaning)}


def seed_one(conn, word, media_dir, *, client, embed_fn, now):
    resolved = resolve(word, client=client)
    if resolved is None:
        return "unresolved"
    external_id = str(resolved["id"])
    if db.symbol_exists(conn, external_id):
        return "skipped"
    image_path = str(Path(media_dir) / f"{external_id}.png")
    arasaac.download_image(resolved["id"], image_path, client=client)
    symbol_id = db.insert_symbol(
        conn, source="arasaac", external_id=external_id,
        image_path=image_path, is_core=1, created_at=now)
    for lang in ("nl", "en"):
        keywords, meaning = resolved[lang]
        if not keywords:
            continue
        description = describe.compose(keywords, meaning)
        vector = embed_fn([description], "passage")[0]
        db.insert_term(
            conn, symbol_id=symbol_id, lang=lang, label=keywords[0],
            description=description, vector=db.pack_vector(vector),
            model=embedder.MODEL_TAG)
    conn.commit()
    return "seeded"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Seed ARASAAC symbols into SQLite.")
    parser.add_argument("--db-path", default=os.environ.get("DB_PATH", "symbols.db"))
    parser.add_argument("--media-dir", default="media")
    parser.add_argument("--words-path", default="indexing/core_words.txt")
    parser.add_argument("--unresolved-path", default="indexing/unresolved.txt")
    args = parser.parse_args(argv)

    conn = db.connect(args.db_path)
    db.create_schema(conn)
    Path(args.media_dir).mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    counts = {"seeded": 0, "skipped": 0, "unresolved": 0}
    unresolved = []
    with httpx.Client(timeout=60) as client:
        for word in load_words(args.words_path):
            status = seed_one(conn, word, args.media_dir, client=client,
                              embed_fn=embedder.embed, now=now)
            counts[status] += 1
            if status == "unresolved":
                unresolved.append(word)

    if unresolved:
        Path(args.unresolved_path).write_text(
            "\n".join(unresolved) + "\n", encoding="utf-8")
    print(counts)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_seed.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite**

Run: `pytest -v`
Expected: PASS — every test from Tasks 1–7.

- [ ] **Step 6: Commit**

```bash
git add indexing/seed.py tests/test_seed.py
git commit -m "feat: seed orchestrator resolving ARASAAC words to embedded symbols"
```

---

### Task 8: Live smoke test (opt-in, env-gated)

**Files:**
- Create: `tests/test_smoke.py`

**Interfaces:**
- Consumes: `indexing.seed` (Task 7), the real ARASAAC + OpenRouter APIs.
- Produces: a `@pytest.mark.skipif`-gated test that seeds ~2 real words end-to-end. Skipped unless `OPENROUTER_API_KEY` is set, so the default suite stays hermetic.

- [ ] **Step 1: Write the test**

```python
# tests/test_smoke.py
import os
import httpx
import pytest
import db
import embedder
from indexing import seed

LIVE = os.environ.get("OPENROUTER_API_KEY")


@pytest.mark.skipif(not LIVE, reason="set OPENROUTER_API_KEY to run the live smoke test")
def test_live_seed_two_words(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    with httpx.Client(timeout=60) as client:
        for word in ("water", "eten"):
            status = seed.seed_one(conn, word, tmp_path, client=client,
                                   embed_fn=embedder.embed, now="t0")
            assert status == "seeded"
    rows = conn.execute(
        "SELECT length(vector) FROM symbol_terms").fetchall()
    assert rows and all(length == embedder.DIMS * 4 for (length,) in rows)
```

- [ ] **Step 2: Run the gated test two ways**

Run (hermetic — must skip): `pytest tests/test_smoke.py -v`
Expected: SKIPPED.

Run (live — requires a real key and network): `OPENROUTER_API_KEY=… pytest tests/test_smoke.py -v`
Expected: PASS (downloads 2 images, writes 4 term rows with 1024-d vectors).

- [ ] **Step 3: Commit**

```bash
git add tests/test_smoke.py
git commit -m "test: opt-in live smoke test for the seeding pipeline"
```

---

## Self-Review

**Spec coverage** (against `2026-06-21-arasaac-symbol-seeding-design.md`):

- §5 schema (`symbols`, `symbol_terms`, `UNIQUE(external_id)`, nullable `enriched_description`, 1024-d vector, `model` tag) → Task 4.
- §6 modules (`arasaac`, `describe`, `embedder`, `seed`, `core_words.txt`) → Tasks 2,3,5,6,7.
- §7 embedder + E5 prefix rule → Task 3.
- §8 idempotency (skip existing symbol/image), unresolved logging, atomic per-word commit → Tasks 4 & 7.
- §9 seed list with phrase/self-introduction units → Task 6.
- §10 description composition (keywords + meaning, degrade) → Task 2.
- §11 deps/config (`OPENROUTER_API_KEY`, `DB_PATH`, ARASAAC URLs; no scaffolding) → Global Constraints, Tasks 3 & 7.
- §12 testing (unit per module, integration with mocks, gated live smoke) → Tasks 2–8.

No gaps.

**Placeholder scan:** every code/test step contains complete, runnable content; no TBD/TODO; `core_words.txt` ships a concrete minimum the tests enforce, with explicit instruction to extend.

**Type consistency:** `MODEL_TAG`/`DIMS`/`embed(texts, kind, *, client)` are used identically in Tasks 3, 7, 8; `db` write/exists signatures match between Tasks 4 and 7; `arasaac` function names and the `resolve` dict shape (`{"id", "nl", "en"}`) are consistent between Tasks 5 and 7; `embed_fn([description], "passage")[0]` matches `embedder.embed`'s contract.
