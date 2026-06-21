We are participating on hackaton for disabled person. She can't speak and read and using whealchair. But she can understand till some point what her parent or people from daycare are telling her.

She is using special device where with eye gaze technology she can select some ARASAAC symbols and sometimes pictures on her screen which can be added by her parents and specialist.

Current logic:
Multiple pages with different categories. When you hover it, we show loader with semi transparent loader (similar to the sign when you scan some echo sounds in the sea) for 2 seconds, and if hover remains we go to the next page. We have 2 types of tiles - 1 as category (ARASAAC symbol or image and short title (1-2 words)) and second type is real symbol which will be pronounced for her listener.
On home page you don't have sidebar with back button. But if you go on second level we show back button (Check screenshots)

New logic:
We will have a tile on a homepage with record Icon after click on which speaker will say that recording has been started (ideally some voice)
We will go to separate page in order not to break her current flow. Where we will generate some tiles. Some of them will be static like most commonly used tiles and some of them are dynamic based on conversation input.
We will continue sending bytes of rectording to backend (probably some websocket connection)
We will show recording animation and stop button and go back button (both will stop recording)
If you hover suggested tile, it should have the same logic, if we hover the device will pronounce it.

In scope:
Build prototype similar to exiting flow with selecting cards
Adding record button on main screen which will redirect to new page
Create mocks until backend is ready that we return some default tiles with text and symbol and we will use native TTS (like SpeechSynthesis) for voice. We need to mimic socket logic as well with listening voice

Not in scope:
Working with eye gaze tehcnology
Working with that device

Stack:
It can be React or any other frontend framework which fits the best

## Backend integration (api-contract.md)

The app talks to the AAC Translator backend through one seam: `RecordingTransport`
(`src/services/transport/`). Two implementations exist and screens depend only on
the interface, so swapping between them is an env change, not a code change.

- **Mock (default)** — `MockRecordingTransport` fakes the audio→suggestions loop
  in-browser. No backend required.
- **Real** — `WebSocketRecordingTransport` connects to `ws://<host>/expressive/listen`,
  streams 16 kHz/mono/PCM16 frames (320 samples · 640 bytes) captured by
  `services/audio.ts` + `services/downsample.ts`, and renders the server's
  `utterance` batches. Selecting a tile calls `POST /expressive/select` (via
  `services/rest.ts`) and speaks the returned `{ text, lang }`. The mic is muted
  (`{"type":"mute"}`) during TTS playback and unmuted after a ~300 ms guard tail
  (echo guard). Other REST endpoints (`/expressive/options`, `/translate`) live in
  `services/rest.ts` for manual/dev use.

### Switching to a local backend

Copy `.env.example` → `.env.local` and set:

```
VITE_TRANSPORT=ws
# defaults below already match the contract's dev URLs — override only if different
VITE_BACKEND_HTTP_URL=http://127.0.0.1:8000
VITE_BACKEND_WS_URL=ws://127.0.0.1:8000
```

Then `npm run dev`. The whole mock↔real switch lives in `services/config.ts` +
the transport factory.
