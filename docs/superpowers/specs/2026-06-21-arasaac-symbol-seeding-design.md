# ARASAAC Symbol Seeding Pipeline — Design Spec

- **Date:** 2026-06-21
- **Status:** Approved design, ready for implementation planning
- **Parent design:** `docs/2026-06-20-aac-symbol-translator-design.md` (§10 Offline indexing pipeline)
- **Stack:** Python 3.11 · SQLite · OpenRouter embeddings

## 1. Problem

The AAC translator needs a seeded symbol dictionary before any semantic search
can run. This spec covers the **offline seeding pipeline**: pull a curated subset
of ARASAAC pictographs, download their images, compose a text description per
language, embed each description, and store everything in SQLite. It is §10 of
the parent design, narrowed to a first, deterministic run (no LLM enrichment yet)
over a curated core-vocabulary subset rather than the full ~13k set.

This is the only data the live retrieval path reads. Get it right once, offline.

## 2. Scope

### In scope

- Two SQLite tables: `symbols` (language-neutral) and `symbol_terms`
  (per-language label, description, vector).
- A curated seed list of **communicative units** (core words *and* short
  phrases/sentences) resolved to ARASAAC pictographs via search.
- Image download to `media/` for every seeded pictograph.
- A shared `Embedder` backed by OpenRouter `intfloat/multilingual-e5-large`.
- A resumable, idempotent seed script and a tested module layout.

### Out of scope (deferred, unchanged from parent design)

- **Project scaffolding** — `pyproject.toml`, dependency install, `media/`
  creation, and the SQLite file are done by a separate setup pass. This spec
  assumes that skeleton exists and depends on it (see §11).
- **LLM enrichment** (§10 step 2). The schema reserves a nullable
  `enriched_description` column so enrichment drops in later with no migration.
- **The full ~13k ARASAAC set.** Subset first; full run is a later, identical
  invocation against a larger list.
- **The `sqlite-vec` virtual table / vector index.** That belongs to the live
  search module. Seeding writes raw vector blobs only.
- All live-path concerns: option generation, the API, the front-end.

## 3. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Description source | ARASAAC raw text (keywords + meaning) | Deterministic, free, no LLM in the seed path |
| Enrichment | Deferred; nullable column reserved | Cheap first run; §10 upgrade needs no migration |
| Images | Download all seeded pictographs to `media/` | One self-contained offline dataset |
| Coverage | Curated core subset first | Fast retrieval-quality iteration before the full run |
| Subset definition | Hand-authored seed list → ARASAAC search | Exactly the vocabulary the picker needs; resolve step is real signal |
| Seed unit | Words **and** short phrases/sentences | A pictograph can carry a phrase-level meaning, helping retrieve one symbol for an elaborate utterance |
| Embedder | OpenRouter `intfloat/multilingual-e5-large`, 1024-d | Multilingual (nl+en), OpenAI-compatible `/embeddings`, cheap ($0.01/M tok) |
| Vector store | Raw `float32` BLOB in `symbol_terms` | Vector index is the search module's concern, not seeding |

## 4. Architecture and data flow

```
indexing/core_words.txt   (curated nl communicative units, ~200–300)
        │  for each entry
        ▼
ARASAAC search (nl)  ──►  pictogram id + nl keywords + meaning
        │                          │
        │                          └─►  fetch en keywords + meaning for same id
        │
        ├─►  symbols row  (source='arasaac', external_id=id, is_core=1)
        │         └─►  download {id}_300.png → media/{id}.png
        │
        ▼
compose description  (keywords + meaning per lang; degrade to keywords-only)
        │
        ▼
embed  "passage: <description>"  →  1024-d float32 vector   (OpenRouter)
        │
        ▼
symbol_terms rows  (lang ∈ {nl, en})  with label, description, vector, model
```

No search miss aborts the run. Unresolved entries are logged to
`unresolved.txt` for curation and the run continues.

## 5. Schema

Reuses the parent design's two tables (§6) with the refinements noted.

```sql
CREATE TABLE symbols (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,                  -- 'arasaac' | 'custom'
  external_id  TEXT UNIQUE,                    -- ARASAAC id; UNIQUE makes re-runs idempotent
  image_path   TEXT NOT NULL,                  -- local file under media/
  is_core      INTEGER NOT NULL DEFAULT 0,     -- 1 for every seeded core entry
  created_at   TEXT NOT NULL
);

CREATE TABLE symbol_terms (
  symbol_id            INTEGER NOT NULL REFERENCES symbols(id),
  lang                 TEXT NOT NULL,          -- 'nl' | 'en'
  label                TEXT NOT NULL,          -- primary ARASAAC keyword
  description          TEXT NOT NULL,          -- composed raw text; this is what we embed now
  enriched_description TEXT,                   -- nullable; §10 LLM pass fills later
  vector               BLOB NOT NULL,          -- 1024 float32 (4096 bytes)
  model                TEXT NOT NULL,          -- 'intfloat/multilingual-e5-large@1024'
  PRIMARY KEY (symbol_id, lang)
);
```

Refinements vs the parent design:

- `vector` holds **1024** float32, not 1536 — this model is lower-dim than the
  OpenAI choice in the parent doc.
- `model` records the model id + dims; changing it forces a re-index.
- `enriched_description` is new and nullable. Today the embed source is
  `description`; once enrichment lands it becomes
  `COALESCE(enriched_description, description)` — no schema change.
- `symbols.external_id` is `UNIQUE` and `symbol_terms` keeps its composite PK so
  the pipeline is idempotent (§8).

## 6. Modules

`embedder.py` sits at the top level because the live search path shares it — it
is the parent design's `Embedder` interface, now backed by OpenRouter. Everything
else lives under `indexing/`.

| File | Job | Interface |
|---|---|---|
| `indexing/core_words.txt` | curated nl communicative units, one per line | data file |
| `indexing/arasaac.py` | ARASAAC REST client: search, fetch-by-id, image download | `search(text, lang)`, `pictogram(id, lang)`, `download_image(id, dest)` |
| `indexing/describe.py` | compose `description` from keywords (+ meaning); degrade | `compose(keywords, meaning) -> str` |
| `embedder.py` | OpenRouter `/embeddings` wrapper; batched; applies E5 prefix | `embed(texts, kind) -> list[vec]` |
| `indexing/seed.py` | orchestrate resolve → download → compose → embed → write; CLI | `python -m indexing.seed [--limit N]` |

Each module does one job behind a small interface, testable in isolation.

## 7. The Embedder and the E5 prefix rule

`intfloat/multilingual-e5-large` is **asymmetric**: stored documents must be
prefixed `"passage: "` and search queries `"query: "`. Omitting or mixing the
prefixes silently degrades recall — there is no error, only worse matches. So:

- `embed(texts, kind)` takes `kind="passage"` (seeding) or `kind="query"` (live
  search) and prepends the correct prefix internally. Callers cannot get it wrong.
- Requests go to `https://openrouter.ai/api/v1/embeddings`, OpenAI-compatible,
  with `OPENROUTER_API_KEY` from the environment.
- Inputs are sent in batches; each vector returned is asserted to be length 1024
  and stored as little-endian `float32` bytes.
- The model id string `intfloat/multilingual-e5-large@1024` is written to
  `symbol_terms.model`.

## 8. Idempotency and resilience

The run is safe to interrupt and re-run; a second run over the same list does no
new work.

- **Skip** a seed entry whose resolved `external_id` already has a `symbols` row.
- **Skip** an image already present under `media/`.
- **Skip** a `symbol_terms` row already embedded with the current `model`.
- **ARASAAC search miss** for an entry → append to `indexing/unresolved.txt`,
  continue. Misses are a curation signal, not a failure. Phrase/sentence entries
  that have no single-pictograph match are expected here.
- **HTTP failures** (ARASAAC or OpenRouter) → retry with backoff; a persistent
  batch failure is logged and the run remains re-runnable from where it stopped.
- Writes are committed per resolved symbol so partial progress survives a crash.

## 9. The seed list (`core_words.txt`)

A curated list of Dutch communicative units drawn from standard AAC core- and
fringe-vocabulary sets, authored during implementation. It mixes:

- **Single core words** — `ik`, `jij`, `willen`, `meer`, `niet`, `stop`, `gaan`,
  `leuk`, `pijn`, `eten`, `drinken`, `ja`, `nee`, `helpen`, `moe`, `blij`, …
- **Short social phrases / sentences** — because a pictograph can carry a
  phrase-level meaning, these let the search retrieve one symbol for an elaborate
  utterance. Include a handful of more elaborate ones, e.g. the
  **self-introduction** scenario:
  - `hallo` / `goedemorgen`
  - `hoe gaat het met je?`
  - `mijn naam is`
  - `ik ben blij je te ontmoeten`
  - `ik woon in`
  - `dank je wel`

Each entry is resolved by searching ARASAAC in Dutch, taking the best-matching
pictograph, and seeding both its `nl` and `en` terms. Entries with no good single
match land in `unresolved.txt`. The resolve step doubles as a retrieval sanity
check: if a common word resolves to a wrong pictograph, that surfaces immediately.

## 10. Description composition (`describe.py`)

Per language, the embedded `description` is keywords plus the ARASAAC
meaning/definition when present, degrading to keywords-only when it is not:

- `label` = the primary (first) ARASAAC keyword.
- With meaning: `"meer, nog, extra — een grotere hoeveelheid van iets"`.
- Without meaning: `"meer, nog, extra"`.

This is the richest *raw* signal available without an LLM, and is the closest
deterministic approximation to what §10 enrichment will later produce.

## 11. Dependencies and configuration

- **Depends on** a project skeleton created separately (this spec does not
  scaffold): Python project + deps (an HTTP client; SQLite via stdlib `sqlite3`),
  the `media/` directory, and the SQLite database file.
- `OPENROUTER_API_KEY` — required, from environment.
- `DB_PATH` — SQLite file path (sensible default).
- ARASAAC base URL `https://api.arasaac.org/v1`; image URL pattern
  `https://static.arasaac.org/pictograms/{id}/{id}_300.png`.

## 12. Testing strategy

- **Unit**
  - `describe.compose` — keywords+meaning → string; keywords-only degrade path.
  - `embedder` — mocked HTTP: asserts the `passage:`/`query:` prefix is applied,
    the 1024-d vector shape, batching, and float32 round-trip.
  - `arasaac` client — mocked JSON for search / fetch-by-id / image download.
  - idempotency — a second `seed` run over the same fixtures inserts nothing new.
- **Integration** — a 3-entry list against a **mocked** ARASAAC and **mocked**
  embedder: asserts `symbols` + `symbol_terms` rows, `vector` length 1024, image
  files written under `media/`, and that a re-run is a no-op.
- **Live smoke test** (opt-in, env-gated on `OPENROUTER_API_KEY`) — resolve and
  embed ~3 real entries against the real ARASAAC + OpenRouter to confirm wiring.

## 13. Open questions / future work

- **Full-set run.** Same pipeline, larger list (or ARASAAC `pictograms/all/{lang}`
  in place of the curated list). The subset proves the pipeline first.
- **Enrichment (§10).** Fill `enriched_description` with a Claude pass and switch
  the embed source to `COALESCE(enriched_description, description)`.
- **Re-index on model change.** Changing `model` invalidates every vector;
  detect a mismatch and re-embed.
- **Multi-pictograph phrases.** Some phrase entries genuinely need several
  symbols; today they resolve to one or land in `unresolved.txt`. Revisit if
  recall@k shows misses.
