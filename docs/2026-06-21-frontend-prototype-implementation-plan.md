# AAC Eye-Gaze Frontend Prototype — Implementation Plan

- **Date:** 2026-06-21
- **Status:** Ready for implementation
- **Stack:** React 18 · Vite · TypeScript · browser-only (mocked backend)
- **Source specs:** `docs/frontend-setup.md`, `docs/2026-06-20-aac-symbol-translator-design.md`
- **Reference:** existing AAC board screenshot (Yasmin's device home page)

## Overview

Build a browser prototype of Yasmin's eye-gaze AAC board that (a) faithfully
reproduces a representative slice of her **existing card-selection flow**
(dwell-to-select, sonar loader, category drill-down, spoken utterance tiles) and
(b) adds the **new record → suggestions flow**: a record tile on the home page
that announces recording, navigates to a dedicated page, "streams" audio over a
(mocked) WebSocket, and renders static + dynamic suggestion tiles she can dwell
to speak.

The backend does not exist yet, so everything backend-facing is **mocked behind
interfaces that match the already-approved API contract** in
`docs/2026-06-20-aac-symbol-translator-design.md` §7 — so the real FastAPI
backend and a real eye-tracker can later drop in without a UI rewrite.

## Current State Analysis

- **Greenfield.** The repo contains only `docs/` (two specs) and `LICENSE`. No
  `package.json`, no frontend, no build tooling.
- **Two specs, one contract.** `frontend-setup.md` describes *this* task (the
  frontend prototype). `2026-06-20-aac-symbol-translator-design.md` describes the
  eventual full system and, critically, the **API shapes our mocks must mimic**:
  - `POST /expressive/options` → `{ interaction_id, options: [ { option_id, text, symbols: [ { id, label, image_url, confidence } ] } ] }`
  - `POST /expressive/select` → `{ text, lang }` (browser speaks via `SpeechSynthesis`)
  - HTTP/WebSocket (JSON) transport; abstracted `SelectionInput` so dwell now /
    eye-tracker later.
- **The existing board (from the screenshot):** a color-coded grid of ARASAAC
  pictograph tiles, Dutch labels. Two tile behaviors are visible:
  - **Category tiles** (`eten`, `personen`, `kleding`, `dagbesteding`, …) → drill
    into a sub-page.
  - **Utterance tiles** (`JA`, `NEE`, *"Ik ben nu aan de beurt. Wil je even
    wachten?"*, *"Kan ik een spelletje spelen?"*) → spoken aloud for her listener.
  - System/status tiles (`Accu percentage ⚡83`, `afstellen oogbediening`,
    `Oogbesturing rust`) — cosmetic in this prototype.
  - Home page has **no back button**; deeper levels show one.
- **Resolved decisions** (asked & answered at planning time):
  - Stack: **React + Vite + TypeScript**.
  - Symbols: **live ARASAAC API + bundled/emoji fallback**.
  - Board scope: **representative subset** (faithful home page + 1–2 drill-down
    categories), with build effort concentrated on the new record→suggestions flow.

## Desired End State

A `npm run dev` kiosk-style web app where:

1. The **home page** renders a board visually close to the screenshot
   (color-coded tiles, ARASAAC pictographs, large targets, no back button).
2. **Dwelling** any tile shows a sonar/echo loader filling over ~2s; if the
   pointer stays, the tile fires. Category tiles navigate; utterance tiles speak
   (Dutch TTS). Deeper pages show a back button.
3. A **record tile** on the home page, on dwell, speaks "Opname gestart"
   (recording started) and navigates to `/record` — her normal board is untouched.
4. The **recording page** shows a recording animation + **stop** + **back**
   buttons (both stop recording and return home), captures mic audio, and
   "streams" it through a mock transport that emits suggestion options in the
   exact design-doc shape. **Static** suggestions appear immediately; **dynamic**
   ones stream in (optionally driven by `SpeechRecognition` of the listener's
   voice). Dwelling a suggestion speaks it.
5. Swapping the mock for the real backend is a one-line transport/config change;
   swapping dwell for eye-tracking is a new `SelectionInput`/dwell driver.

### Key Discoveries / Constraints to work within

- **She cannot read** — UI carries meaning through **symbols + spoken audio**,
  never through text she must read. Labels exist for caregivers/devs only.
- **Eye-gaze ⇒ few, large, well-separated targets**; dwell is the only input we
  build (mouse/click also works for dev). Dwell duration must be a setting
  (default 2000 ms per `frontend-setup.md`).
- **Mocks must match the contract** in design-doc §7 so the real backend drops in.
- **Dutch-first** (`nl-NL` TTS), English supported via one `lang` setting
  (design-doc §6: `settings.lang` is the single source of truth).
- TTS = browser `SpeechSynthesis`; voices load **asynchronously**
  (`onvoiceschanged`) — must be handled or the first utterance is silent.

## What We're NOT Doing

- Real eye-tracking / webcam gaze (only the dwell abstraction; eye-tracker is a
  future `SelectionInput` driver).
- Real backend: FastAPI, embeddings, ARASAAC import/enrich pipeline, SQLite,
  Claude option generation. We mock the **responses**, not the brains.
- The **full** board from the screenshot (every tile + every sub-page). We build
  a faithful home page + 1–2 representative sub-pages.
- Functional system tiles (battery, eye-control calibration, "villa nieuwtjes").
  Rendered for fidelity; non-interactive.
- Auth, multi-user, persistence to a server, deployment.
- A receptive "read incoming speech as symbols" view (she can hear).

## Implementation Approach

Build bottom-up: interaction primitives (dwell + TTS) → symbol rendering →
existing board → the new record flow → mock streaming suggestions → polish.
Every external dependency (symbols, audio transport, selection input, speech)
sits behind a small typed module so the prototype is honest about where the real
system plugs in. DTOs mirror design-doc §7 verbatim.

### Proposed file structure

```
package.json · vite.config.ts · tsconfig.json · index.html
src/
  main.tsx · App.tsx                      # router + providers
  routes/  HomePage.tsx · CategoryPage.tsx · RecordingPage.tsx
  components/
    DwellTile.tsx · SonarLoader.tsx
    CategoryTile.tsx · UtteranceTile.tsx · RecordTile.tsx · SuggestionTile.tsx
    Symbol.tsx · BackButton.tsx · RecordingIndicator.tsx
  hooks/   useDwell.ts · useSpeech.ts
  services/
    speech.ts                             # SpeechSynthesis wrapper
    arasaac.ts                            # symbol keyword -> image url (cache/bundle/api/emoji)
    audio.ts                              # getUserMedia + MediaRecorder
    transport/
      types.ts                            # DTOs (design-doc §7) + RecordingTransport iface
      MockRecordingTransport.ts
      WebSocketRecordingTransport.ts      # real-backend stub
  data/    board.ts · mockSuggestions.ts
  context/ SettingsContext.tsx            # lang, dwellMs
  styles/  tokens.css · global.css
  types.ts                                # Tile, Category, Lang, …
  assets/symbols/                         # bundled fallback ARASAAC PNGs
src/__tests__/                            # vitest
```

---

## Phase 1: Project scaffold

### Overview
Stand up the Vite + React + TS app, routing, providers, kiosk styling, and the
Fitzgerald-style color tokens read off the screenshot.

### Changes Required

**`package.json` / tooling** — `npm create vite@latest . -- --template react-ts`,
add `react-router-dom`, `vitest` + `@testing-library/react` (for Phase-level
unit tests), and eslint/prettier (Vite defaults are fine).

**`src/App.tsx`** — `BrowserRouter` with routes:
```tsx
<Routes>
  <Route path="/" element={<HomePage />} />
  <Route path="/c/:categoryId" element={<CategoryPage />} />
  <Route path="/record" element={<RecordingPage />} />
</Routes>
```
Wrap in `<SettingsProvider>`.

**`src/styles/tokens.css`** — CSS variables for the board: tile size, grid gap,
and the per-category colors eyeballed from the screenshot (white, `NEE`-red,
salmon/pink, yellow/gold, green, brown, blue, dark-blue, teal, gray, red).
Document that exact hex values are approximate and refined in Phase 7.

**`src/styles/global.css`** — fullscreen, no scroll, large hit targets,
high-contrast, `cursor` visible in dev (toggle to hidden for kiosk later).

**`src/context/SettingsContext.tsx`** — `{ lang: 'nl' | 'en', dwellMs: number }`,
defaults `{ lang: 'nl', dwellMs: 2000 }`.

### Success Criteria

#### Automated Verification
- [x] Dev server boots: `npm run dev`
- [x] Production build succeeds: `npm run build`
- [x] Type check passes: `npx tsc --noEmit`
- [x] Lint passes: `npm run lint`

#### Manual Verification
- [ ] App loads fullscreen with no scrollbars; the three routes render placeholder content.

---

## Phase 2: Core interaction primitives (dwell + TTS)

### Overview
The two primitives every screen depends on: dwell-to-select with a sonar loader,
and Dutch text-to-speech.

### Changes Required

**`src/hooks/useDwell.ts`** — returns handlers + progress for a tile.
- On `pointerenter` (and `focus`): start a timer for `settings.dwellMs`, drive a
  `progress` value 0→1 (via `requestAnimationFrame`).
- On `pointerleave`/`blur`: cancel + reset progress.
- On completion: call `onSelect()` once.
- Also fire `onSelect()` on `click` (dev/touch convenience).
- This is the **selection-input abstraction**: an eye-tracker driver later feeds
  the same enter/leave/complete lifecycle.

**`src/components/SonarLoader.tsx`** — overlay rendered while `progress > 0`:
expanding semi-transparent concentric rings + a radial fill that completes at
`progress === 1`. Pure CSS `@keyframes` (sonar "ping"), opacity scaled by progress.

**`src/components/DwellTile.tsx`** — wraps any tile content with `useDwell` +
`SonarLoader`; props `{ onSelect, label, color, children }`. ARIA: `role="button"`,
`aria-label={label}`.

**`src/services/speech.ts`** — `speak(text, lang)` over `window.speechSynthesis`:
- Wait for `onvoiceschanged`; pick best `nl-NL` (or `en`) voice; cache it.
- `cancel()` any in-flight utterance before speaking a new one.
- No-op + console warn if `speechSynthesis` is unavailable.

**`src/hooks/useSpeech.ts`** — thin hook exposing `speak()` bound to current `lang`.

### Success Criteria

#### Automated Verification
- [x] Type check passes: `npx tsc --noEmit`
- [x] Unit test: dwell timer fires `onSelect` after `dwellMs`, cancels on leave (fake timers): `npm run test`
- [x] Build succeeds: `npm run build`

#### Manual Verification
- [ ] Hovering a demo tile shows the sonar loader filling over ~2s; leaving early cancels it; staying fires once.
- [ ] Firing an utterance demo tile speaks Dutch text aloud (voice present, not silent on first try).

---

## Phase 3: Symbol resolution (ARASAAC)

### Overview
Render real ARASAAC pictographs from a keyword, with graceful fallback so the
demo works offline / when the API is down.

### Changes Required

**`src/services/arasaac.ts`** — `resolveSymbol(keyword, lang): Promise<string>`
resolving an image URL through a fallback chain:
1. **localStorage cache** (`keyword|lang → arasaac id`).
2. **Bundled map** for the fixed board keywords (`src/assets/symbols/*` +
   `bundledIds.ts`), so the seeded board renders instantly and offline.
3. **Live API** — search, take first match's id:
   - `GET https://api.arasaac.org/api/pictograms/{lang}/search/{keyword}`
   - image: `https://static.arasaac.org/pictograms/{id}/{id}_500.png`
   - cache the resolved id.
   *(Verify exact base path against `arasaac.org` docs during implementation; the
   public API path has changed historically.)*
4. **Emoji / placeholder** fallback if all else fails.

**`src/components/Symbol.tsx`** — `{ keyword, alt }` → renders the resolved image
with a loading shimmer and the fallback box; `alt` for caregivers only.

**Pre-seed bundled symbols** — download pictographs for the home-page keywords
(eten, drinken, kleding, personen, gevoelens, …) into `src/assets/symbols/`.

### Success Criteria

#### Automated Verification
- [x] Type check passes: `npx tsc --noEmit`
- [x] Unit test: `resolveSymbol` returns the bundled/cached URL without a network call when cached; falls through to emoji when search returns empty (mocked fetch): `npm run test`
- [x] Build succeeds: `npm run build`

#### Manual Verification
- [ ] Board tiles display real ARASAAC pictographs.
- [ ] With network disabled, bundled symbols still render (no broken images).
- [ ] An unknown keyword falls back to an emoji/placeholder, not a broken image.

---

## Phase 4: Existing board flow

### Overview
Reproduce a representative slice of her current board: home page + 1–2 drill-down
categories, category navigation, spoken utterance tiles, conditional back button.

### Changes Required

**`src/types.ts`** — board model:
```ts
type Lang = 'nl' | 'en';
type TileKind = 'category' | 'utterance' | 'record' | 'system';
interface Tile {
  id: string;
  kind: TileKind;
  label: string;           // caregiver/dev label (1–2 words for categories)
  symbolKeyword?: string;  // ARASAAC lookup
  color?: string;          // token name from tokens.css
  utterance?: string;      // spoken text for kind==='utterance'
  children?: Tile[];       // sub-page for kind==='category'
}
```

**`src/data/board.ts`** — seed the **home page** tiles from the screenshot
(`algemeen`, `NEE`, `dagbesteding`, `Villa`, `JA`, `eten`, `personen`,
`drinken - snacks`, `kleding`, `Waar ben ik`, `Ik ben Yasmin`, `verzorging`,
`Kan ik een spelletje spelen?`, `tijd`, *"Ik ben nu aan de beurt…"*, `gesprek`,
`lichaam`, `weer`, `activiteiten`, `gevoelens`, `Communicatie`, `spel`, +
cosmetic system tiles), with correct kind/color/keyword. Flesh out **1–2
sub-pages** as real category children (e.g. `eten` → food items, `gevoelens` →
emotion utterances).

**`src/routes/HomePage.tsx`** — grid of `CategoryTile`/`UtteranceTile`/`RecordTile`
from `board.ts`. **No back button.**

**`src/routes/CategoryPage.tsx`** — reads `:categoryId`, renders that category's
children; **shows `<BackButton>`** (deeper than home).

**`src/components/CategoryTile.tsx`** — `DwellTile` → `navigate('/c/'+id)`.
**`src/components/UtteranceTile.tsx`** — `DwellTile` → `speak(utterance)`; brief
"speaking" highlight.
**`src/components/BackButton.tsx`** — `DwellTile` styled as the sidebar back
button → `navigate(-1)`.

### Success Criteria

#### Automated Verification
- [x] Type check passes: `npx tsc --noEmit`
- [~] Unit/render test: skipped per direction (hackathon — no new tests added for Phase 4).
- [x] Build succeeds: `npm run build`

#### Manual Verification
- [ ] Home page visually resembles the screenshot (layout, color coding, symbols, large tiles).
- [ ] Dwelling a category tile navigates to its sub-page; the sub-page shows a back button; back returns home.
- [ ] Dwelling an utterance tile (`JA`, *"Ik ben nu aan de beurt…"*) speaks Dutch aloud.

---

## Phase 5: Record button + recording page

### Overview
The new entry point and its dedicated page (without suggestions yet): announce,
navigate, animate, capture mic, stop/back both end recording and return home.

### Changes Required

**`src/components/RecordTile.tsx`** — a distinct record-styled `DwellTile` on the
home page. On select: `speak('Opname gestart')` (recording started), then
`navigate('/record')`. (Keeps her main board flow untouched — a separate route.)

**`src/services/audio.ts`** — `startCapture()` → `getUserMedia({audio:true})` +
`MediaRecorder`, emitting chunks via callback; `stopCapture()` stops tracks and
releases the mic. Graceful error if permission denied / unsupported.

**`src/components/RecordingIndicator.tsx`** — pulsing recording animation
(mic/“listening” motif consistent with the sonar style).

**`src/routes/RecordingPage.tsx`** — on mount: start capture + transport (Phase 6).
Renders `RecordingIndicator`, a **Stop** `DwellTile`, and a **Back** `DwellTile`;
**both** call `stopCapture()` + transport stop and `navigate('/')`. Clean up on
unmount (release mic, abort transport).

### Success Criteria

#### Automated Verification
- [x] Type check passes: `npx tsc --noEmit`
- [x] Build succeeds: `npm run build`

#### Manual Verification
- [ ] Dwelling the record tile says "Opname gestart" and routes to `/record`.
- [ ] The recording animation runs; the browser prompts for / uses the mic.
- [ ] Both Stop and Back end recording (mic indicator off) and return to the home board.
- [ ] Navigating away mid-recording releases the mic (no lingering recording indicator in the browser tab).

---

## Phase 6: Mock transport + streaming suggestions

### Overview
Mimic the WebSocket + `/expressive/options` contract: stream captured audio into
a mock that emits static suggestions immediately and dynamic ones over time;
render them as dwell-to-speak suggestion tiles.

### Changes Required

**`src/services/transport/types.ts`** — DTOs verbatim from design-doc §7 + the
transport interface:
```ts
interface SymbolDTO  { id: number; label: string; image_url: string; confidence: number }
interface OptionDTO  { option_id: number; text: string; symbols: SymbolDTO[] }
interface OptionsResponse { interaction_id: number; options: OptionDTO[] }

interface RecordingTransport {
  start(opts: { lang: Lang }): Promise<void>;
  sendChunk(chunk: Blob): void;             // streamed audio bytes
  onOptions(cb: (r: OptionsResponse) => void): void;
  onError(cb: (e: Error) => void): void;
  stop(): Promise<void>;
}
```

**`src/data/mockSuggestions.ts`** — a pool of canned `OptionDTO`s in Dutch
(static "most-used": `JA`, `NEE`, *"Ik heb honger"*, *"Ik wil rusten"*, …) and
context-flavored dynamic ones.

**`src/services/transport/MockRecordingTransport.ts`** — implements
`RecordingTransport`:
- `start`: immediately emit the **static** options.
- As chunks arrive (or on a timer), emit **dynamic** options in the §7 shape with
  incrementing `interaction_id`/`option_id`.
- *Optional realism (flag `useSpeechRecognition`):* run `webkitSpeechRecognition`
  on the listener's voice and pick dynamic suggestions keyed off transcript
  keywords — satisfying "mimic socket logic … with listening voice" and "dynamic
  based on conversation input". Fallback to timed static rotation where SR is
  unsupported (e.g. Firefox).

**`src/services/transport/WebSocketRecordingTransport.ts`** — real-backend stub
implementing the same interface against a WS URL from env
(`VITE_BACKEND_WS_URL`); unused at runtime but proves the seam. A factory picks
mock vs ws from env.

**`src/components/SuggestionTile.tsx`** — renders an `OptionDTO` (its symbol
sequence + caregiver label); on dwell, `speak(option.text)`. (This mirrors
`POST /expressive/select` → `{ text, lang }` spoken in the browser; the mock can
log the "select" for parity.)

**`src/routes/RecordingPage.tsx`** (wire-up) — subscribe to `onOptions`; render
static suggestions first, append dynamic ones as they stream; feed mic chunks to
`transport.sendChunk`.

### Success Criteria

#### Automated Verification
- [x] Type check passes: `npx tsc --noEmit`
- [x] Unit test: `MockRecordingTransport.start()` emits static options synchronously and at least one dynamic `OptionsResponse` over fake time, all matching the DTO shape: `npm run test`
- [x] Build succeeds: `npm run build`

#### Manual Verification
- [ ] On entering `/record`, static suggestion tiles appear immediately.
- [ ] Dynamic suggestion tiles stream in afterward (and reflect spoken context if `SpeechRecognition` is enabled and supported).
- [ ] Dwelling any suggestion tile speaks its Dutch text aloud.
- [ ] Suggestion tiles show ARASAAC symbols (with the Phase-3 fallback for unknown words).

---

## Phase 7: Polish, fidelity & handoff

### Overview
Make it demo-ready and document the mock→real seam.

### Changes Required
- Refine `tokens.css` colors/sizes against the screenshot; tune grid layout.
- Kiosk niceties: optional hidden cursor, prevent text selection, lock scroll,
  fullscreen helper.
- Tune dwell timing & sonar feel; ensure targets are large and well-separated.
- `README.md`: how to run, how to switch mock↔real backend
  (`VITE_BACKEND_WS_URL`) and dwell↔eye-tracker (new `SelectionInput` driver),
  ARASAAC attribution/license note.

### Success Criteria

#### Automated Verification
- [ ] Full build + type check + lint + tests pass: `npm run build && npx tsc --noEmit && npm run lint && npm run test`

#### Manual Verification
- [ ] End-to-end demo: home → category → speak; home → record tile → announce → `/record` → static + dynamic suggestions → dwell-to-speak → back/stop → home.
- [ ] Looks and behaves close to her real device for a hackathon demo.

---

## Testing Strategy

### Unit Tests (vitest)
- `useDwell`: fires once after `dwellMs`; cancels on leave; click fires immediately (fake timers).
- `speech.ts`: picks an `nl-NL` voice when available; cancels in-flight; no-throw when unsupported (mock `speechSynthesis`).
- `arasaac.resolveSymbol`: cache hit avoids fetch; empty search → emoji fallback (mock `fetch`).
- `MockRecordingTransport`: emits static options on `start`; emits dynamic `OptionsResponse`(s) over fake time; payloads match the §7 DTO shape.

### Integration / Render Tests
- HomePage renders seeded tiles, **no** back button; CategoryPage renders a back button.
- RecordingPage: mount starts capture+transport; static suggestions render; Stop/Back stop recording and navigate home (mock `audio`/transport).

### Manual Testing Steps
1. Home board resembles the screenshot; dwell loader fills over ~2s.
2. Category drill-down + back; utterance tiles speak Dutch.
3. Record tile announces and routes; mic engages; animation runs.
4. Static then dynamic suggestions; dwell-to-speak each.
5. Stop and Back both end recording and return home; mic released.
6. Offline: bundled symbols still render.

## Performance Considerations
- Cache resolved ARASAAC ids in localStorage; bundle home-page symbols to avoid
  per-load network fan-out.
- Drive the sonar loader with `requestAnimationFrame` / CSS, not React re-renders
  per frame.
- Release `MediaRecorder` + media tracks on unmount to free the mic.

## Migration / Real-Backend Notes
- DTOs in `transport/types.ts` mirror design-doc §7 exactly; switching to
  `WebSocketRecordingTransport` (real) is an env/factory change, not a UI change.
- Dwell is a `SelectionInput` driver; a future eye-tracker driver reuses the same
  enter/leave/complete lifecycle (`useDwell`).
- `settings.lang` threads through TTS voice, ARASAAC locale, and (future) backend
  language, matching design-doc §6.

## References
- Task spec: `docs/frontend-setup.md`
- System design / API contract: `docs/2026-06-20-aac-symbol-translator-design.md` (§6 data model, §7 endpoints, §13 stack)
- Existing board: device home-page screenshot (2026-06-21)
- ARASAAC API: `https://arasaac.org/developers/api` (verify exact paths at implementation time)
