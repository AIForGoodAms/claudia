# AAC Translator — Front-End API Contract

> Derived from the implementation plan (`docs/2026-06-21-audio-symbol-translator-implementation-plan.md`, Task 14 + shared models in Task 1). These are the only surfaces the front-end touches.

**Base URL (dev):** `http://127.0.0.1:8000` · WebSocket `ws://127.0.0.1:8000`
**Content type:** JSON for all REST bodies/responses. `lang` is `"nl"` (default) or `"en"`; omit it and the server uses its configured default.

## Shared object shapes

```ts
// One symbol card inside an option
SymbolCard {
  id: number,             // symbol id; -1 when no match existed at all
  label: string,          // the word/gloss
  image_url: string|null, // "/media/<file>.png"; null when as_text is true
  confidence: number,     // 0..1 cosine score
  as_text: boolean        // true → below match threshold: render label as TEXT, not an image
}

// One proposed reply the user can pick
Option {
  option_id: number,
  text: string,           // the full natural-language reply (what gets spoken)
  symbols: SymbolCard[]   // render left-to-right as the card row
}
```

> **Render rule:** if `as_text` is true, show `label` as text (no image — `image_url` is null). Otherwise show the image at `image_url` with `label` as caption.

---

## REST endpoints

### `POST /expressive/options`  *(dev/manual entry; the live path uses the WebSocket)*
Generate reply options from typed text.

```jsonc
// Request
{ "text": "wil je koffie?", "lang": "nl" }   // lang optional

// 200 Response
{
  "interaction_id": 42,
  "options": [ Option, Option, ... ]
}
```

### `POST /expressive/select`
Mark an option as chosen; returns the text to speak.

```jsonc
// Request
{ "interaction_id": 42, "option_id": 7 }

// 200 Response  → feed text+lang to SpeechSynthesis
{ "text": "ja graag", "lang": "nl" }

// 404 if the interaction_id/option_id pair is unknown
```

### `POST /translate`
Decompose arbitrary text into glosses + symbol cards (no option generation).

```jsonc
// Request
{ "text": "ik wil graag koffie", "lang": "nl" }   // lang optional

// 200 Response
{
  "glosses": ["ik", "wil", "koffie"],
  "symbols": [ SymbolCard, ... ]
}
```

### `GET /media/*`
Static symbol images. `SymbolCard.image_url` values resolve here.

---

## WebSocket — `ws://<host>/expressive/listen`

This is the live conversation loop. Connect, stream mic audio, receive option sets.

**Client → server**

| Message | Format | Meaning |
|---|---|---|
| Audio frame | **Binary** `ArrayBuffer` | One PCM frame (see audio format below) |
| Mute | **Text** `{"type":"mute"}` | Stop processing + reset the segmenter (use during TTS playback) |
| Unmute | **Text** `{"type":"unmute"}` | Resume processing |

**Audio format (required):** 16 kHz, mono, PCM16, ~20 ms frames → **320 samples / 640 bytes per frame**, sent as the raw `Int16Array.buffer`. (The provided `downsampleTo16k` util produces exactly this.)

**Server → client** — emitted once per detected utterance (after speech followed by the configured trailing silence):

```jsonc
{
  "type": "utterance",
  "interaction_id": 42,
  "transcript": "wil je koffie?",
  "options": [ Option, ... ]
}
```

Then the pick flow is the same `POST /expressive/select` as above.

**Echo-guard contract:** while TTS is speaking the chosen reply, the client must (a) stop sending audio frames and (b) send `{"type":"mute"}`, then `{"type":"unmute"}` after a short guard tail once playback ends — otherwise the spoken reply gets transcribed back as a new turn. The `EchoGate` util (Task 6) implements the timing; `vad_silence_ms` and `echo_guard_ms` are server-side defaults (800 ms / 300 ms).

---

## Notes for the front-end dev

- **Typical flow:** open WS → stream frames → on `utterance`, render `options` as card rows → user dwells/clicks → `POST /expressive/select` → speak the returned `text` with `lang` mapped to a voice (`nl`→`nl-NL`, `en`→`en-US`) → mute mic during playback.
- **Defaults you may want to surface/respect:** dwell select, 5 options, `match_threshold` 0.30 (drives `as_text`). These live server-side; the client just renders what it gets.
- The repo already ships matching JS utilities in `frontend/src/` (`downsample.js`, `echo-gate.js`, `selection-input.js`) and a reference `ws-client.js` / `app.js` in Task 16 — point at those for a working integration example.
- `POST /expressive/options` is **dev-only**; the production path is the WebSocket. The REST `options` route is handy for testing without a mic.
