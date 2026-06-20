# Eye-Gaze AAC Symbol Translator — Design Spec

- **Date:** 2026-06-20
- **Status:** Approved design, ready for implementation planning
- **Stack:** Python 3.11 · FastAPI · SQLite · browser front-end

## 1. Problem

We are building an Augmentative and Alternative Communication (AAC) system for
a person who cannot speak or move, but who **can hear** and can point with her
eyes at symbols on a screen. She communicates by selecting from a symbolic
(pictographic) language.

Composing an utterance symbol-by-symbol with eye-gaze is slow and exhausting.
Instead, the system **proposes a small set of likely responses** — phrased in
her voice and rendered as symbol sequences — and she **selects one**. This turns
expression from authoring into picking, which is far less effort for an
eye-gaze user.

Because she can hear, the system never needs to show her incoming speech as
symbols. Text→symbol translation is therefore **internal plumbing** (it renders
proposed responses as symbols), not a reading channel for her.

## 2. Goals and non-goals

### Goals (prototype scope)

- Given a context (typed/dictated text, or a photo shown to her), generate N
  candidate responses in her voice and render each as a symbol sequence.
- Let her select one option; speak the result aloud (Dutch / English).
- A semantic-search core that maps natural-language concepts → best symbols.
- A dictionary seeded from ARASAAC (open-licensed) plus room for custom symbols.
- Dutch-first, English-supported, via one active-language setting.
- An abstracted selection-input layer so mouse/dwell works now and real
  eye-tracking drops in later.
- Personalization: a persona profile and a log of past picks that bias future
  options.

### Non-goals (explicitly deferred)

- Real eye-tracker or webcam-gaze drivers (only the abstraction is built now).
- A receptive "read incoming speech as symbols" view (she can hear).
- A full grammar engine, multi-user support, auth, or cloud deployment.
- Model fine-tuning (we personalize via prompt context only).
- Commercial symbol sets (PCS / Widgit / Bliss).
- An offline fallback embedder (the interface allows it; we don't build it).

## 3. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Primary interaction | Expressive option-picker | Picking ≪ authoring effort for eye-gaze |
| Translation core | Embedding similarity search | Maps meaning → symbols robustly |
| Embedder | OpenAI `text-embedding-3-small` | Best accuracy for short-phrase nuance; cheap; multilingual |
| Option generation | Claude (multimodal) | Fluent Dutch; reads photos directly |
| Image handling | Photo → LLM proposes responses directly | Sidesteps photo-vs-pictograph gap; abstract core words have no photographic form |
| Symbol set | ARASAAC (open) + custom | Free, ~13k pictographs, multilingual keywords |
| Vector store | SQLite (`sqlite-vec`; numpy-blob fallback) | ~13k symbols is trivial; stays in our stack |
| Language | Dutch primary, English supported | One `lang` setting threads through the stack |
| Selection input | Abstracted interface, mouse/dwell driver | Hardware-independent prototype |
| TTS | Browser `SpeechSynthesis` | Zero backend dependency; has `nl-NL` voices |
| Platform | Local web app | Symbol grids + large gaze targets render well in HTML/CSS |

## 4. Architecture

One shared semantic-search core serves the expressive loop. All heavy work
(import, enrich, embed) happens **offline, once**; the live path is fast.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  BROWSER  (her screen)                                                          │
│   ┌────────────────────────────────────────────────────────────────────────┐  │
│   │  Expressive view: N response options, each a row of large symbol cards   │  │
│   └────────────────────────────────────────────────────────────────────────┘  │
│                                   ▲ selects one                                 │
│   ┌───────────────────────────────┴────────────────────────────────────────┐  │
│   │  SelectionInput (JS)  → onSelect(targetId)                               │  │
│   │  driver now: mouse / dwell    later: eye-tracker, webcam gaze            │  │
│   └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │ HTTP / WebSocket (JSON)
┌────────────────────────────────────┴───────────────────────────────────────────┐
│  PYTHON BACKEND (FastAPI)                                                        │
│   POST /expressive/options      POST /expressive/select      POST /translate(dev)│
│         │                              │                            │            │
│         ▼                              ▼                            ▼            │
│  ┌──────────────┐            ┌─────────────────┐           ┌──────────────┐      │
│  │OptionGenerator│           │UtteranceComposer │          │  (glossify)  │      │
│  │ (Claude,vision)│          │ pick → text → TTS│          │ text→glosses │      │
│  └──────┬────────┘           └────────┬─────────┘          └──────┬───────┘      │
│         │ N × {text, glosses[]}        │                          │              │
│         ▼                              │                          ▼              │
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
│   interactions · options · settings        media/ (symbol PNGs, input photos)  │
└──────────────────────────────────────────────────────────────────────────────┘
   External: Claude API (LLM + vision) · OpenAI embeddings · browser TTS · ARASAAC (import only)

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
| `embedder.py` | text → vector (shared by index and query) | `embed(text) -> vec` |
| `symbol_search.py` | cosine top-k over `symbol_terms` for a language | `search(text, k, lang) -> [Match]` |
| `translator.py` | glosses → symbol sequence; text → glosses | `to_symbols(glosses, lang)`, `glossify(text, lang)` |
| `option_generator.py` | LLM candidate responses from context + persona | `generate(context, persona, history, n, lang) -> [Candidate]` |
| `utterance.py` | chosen option → final text (TTS done in browser) | `compose(option) -> Utterance` |
| `persona.py` | load persona; load recent history; log interactions | `load()`, `recent(n)`, `log(...)` |
| `api.py` | FastAPI routes, orchestration | the routes in §7 |
| `indexing/` | import ARASAAC · enrich · build embeddings | offline scripts |

A `Candidate` is `{ text: str, glosses: [str] }`. The LLM emits both the natural
sentence **and** its telegraphic content words in one call, so we never need a
separate NLP decomposition step — the model already knows AAC-style core words.

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

-- The learning log: one row per context presented to her
CREATE TABLE interactions (
  id                INTEGER PRIMARY KEY,
  ts                TEXT NOT NULL,
  lang              TEXT NOT NULL,
  context_type      TEXT NOT NULL,       -- 'text' | 'image'
  context_text      TEXT,
  context_image_path TEXT
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
  value TEXT NOT NULL                    -- e.g. lang='nl', option_count='5', match_threshold='0.30'
);
```

The same embedding model must produce both the dictionary vectors and the query
vectors. `symbol_terms.model` records which model was used; changing the model
means re-indexing. Per-language rows let a Dutch query match Dutch descriptions
directly (strictly more accurate than cross-lingual matching, at negligible
cost). `settings.lang` is the single source of truth for the active language;
it selects the ARASAAC locale, which `symbol_terms` rows to search, the language
Claude writes in, and the TTS voice.

## 7. API endpoints

Two user-facing endpoints, plus one dev/curation endpoint. Text→symbol
translation is otherwise an internal service.

### `POST /expressive/options` — propose

- **In:** `{ text?, image?, lang }` — context as text or uploaded photo.
- **Does:** load persona + recent picks → `OptionGenerator.generate` (Claude;
  multimodal if image) → for each candidate, `Translator.to_symbols(glosses)` →
  persist one `interactions` row + N `options` rows.
- **Out:** `{ interaction_id, options: [ { option_id, text,
  symbols: [ { id, label, image_url, confidence } ] } ] }`.

### `POST /expressive/select` — commit and speak

- **In:** `{ interaction_id, option_id }`.
- **Does:** set `options.was_selected = 1` (learning signal) →
  `UtteranceComposer.compose`.
- **Out:** `{ text, lang }` — the browser speaks it via `SpeechSynthesis`.

### `POST /translate` — dev / caregiver curation (not her UI)

- **In:** `{ text, lang }`.
- **Does:** `Translator.glossify(text)` → `Translator.to_symbols(glosses)`.
- **Out:** `{ glosses, symbols: [ { id, label, image_url, confidence } ] }`.
- **Use:** tuning the semantic search (recall@k eval) and letting a caregiver
  see/fix how phrases map to symbols while building vocabulary.

## 8. Data flow

**Expressive turn (the centerpiece):**

1. A context appears (a photo shown to her, or something said, typed/dictated).
2. `/expressive/options` asks Claude for N responses in her voice, grounded in
   persona + recent picks. Each response carries `{ text, glosses }`.
3. Each gloss is embedded and matched to its best symbol (top-1 above the
   confidence threshold). The option becomes a symbol sequence.
4. The browser shows N rows of large symbol cards.
5. She selects one via `SelectionInput`.
6. `/expressive/select` records the pick and returns the final text; the browser
   speaks it in the active language.
7. The pick is logged and feeds the next turn's persona context.

**Internal translation** (used inside step 3, and exposed via `/translate` for
dev/curation) is the only use of text→symbol mapping.

## 9. External services

- **Claude (multimodal)** — option generation and reading photos. Also used
  once, offline, to enrich ARASAAC descriptions.
- **OpenAI `text-embedding-3-small`** — embeddings, 1536 dims, behind the
  `Embedder` interface. Two vendors total (Claude + OpenAI); two API keys.
- **Browser `SpeechSynthesis`** — TTS (`nl-NL` / `en` voices).
- **ARASAAC** — pictograph images + multilingual keywords, at import time only.

## 10. Offline indexing pipeline

Run once, and again whenever the vocabulary changes. Not in the live path.

1. `import_arasaac` — fetch pictographs + `nl` and `en` keywords; store images
   under `media/`; insert `symbols` rows.
2. `enrich` — one Claude pass per symbol per language: expand the keyword into a
   richer description ("meer, nog een, extra, ik wil nog") for better recall.
3. `build_index` — embed each `symbol_terms.description`; write `vector` +
   `model`.

## 11. Error handling and edge cases

- **Low-confidence match:** if a gloss's best symbol is below
  `settings.match_threshold`, the card shows the gloss **as text** instead of a
  wrong picture, and is flagged for curation. Never show a confidently-wrong
  symbol.
- **LLM failure (`/expressive/options`):** return a clear error; the UI offers
  retry. No options is better than bad options.
- **Embedding API failure:** the search cannot run; return an error. (A local
  fallback embedder is a future option behind the same interface.)
- **Image upload:** validate type/size; store under `media/`; on decode failure,
  return a clear error.
- **Stale/unknown selection:** reject `select` for an unknown `interaction_id`
  or `option_id`.
- **Empty option set:** if the LLM returns nothing usable, surface "no
  suggestions — try rephrasing the context."

## 12. Testing strategy

- **Unit:** `embedder` (shape/determinism, mocked API), `symbol_search`
  (expected top-k on a tiny fixture dictionary), `translator` (glosses →
  sequence; threshold behavior), `option_generator` (mocked Claude → valid
  `{text, glosses}`), `utterance` (compose).
- **Integration:** full expressive pipeline with a fake LLM + small symbol DB:
  context → options → select → text.
- **Retrieval eval (the riskiest piece):** a curated set of
  `query → expected symbol` pairs in `nl` and `en`; measure **recall@k**. This
  is the primary signal for tuning descriptions, the threshold, and `k`. The
  `/translate` endpoint drives this harness.

## 13. Tech stack

- Python 3.11, FastAPI + Uvicorn.
- SQLite with `sqlite-vec` (numpy brute-force cosine as fallback — ~13k symbols
  is <10 ms either way).
- OpenAI `text-embedding-3-small` (embeddings); Claude (option generation +
  vision + offline enrichment).
- Front-end: plain HTML/CSS/JS — a grid of large targets, dwell-to-select,
  browser `SpeechSynthesis` for speech and optional `SpeechRecognition` for
  dictating the context.

## 14. Open questions and future work

- **Option count:** default 5; expose in `settings`. Eye-gaze favours few, large
  targets — tune with the user.
- **Privacy:** her photos and words are sent to LLM/embedding APIs. Acceptable
  for a prototype; a real deployment needs a conscious data-handling decision
  (and is an argument for the local fallback embedder).
- **Multi-symbol per gloss:** v1 maps one gloss → one symbol. Some concepts need
  a small phrase of symbols; revisit if recall@k shows misses.
- **Real eye-tracking:** add a `SelectionInput` driver (Tobii SDK or webcam/
  MediaPipe) without touching the rest of the stack.
- **Learning beyond prompt context:** today picks bias the LLM prompt; later we
  could re-rank options or symbols from her history.
