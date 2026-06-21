import type { Lang } from '../../types';

/**
 * Recording transport DTOs — mirror api-contract.md verbatim so the real
 * FastAPI backend (REST) and WebSocket drop in without a UI rewrite.
 *
 * Live loop: open WS `/expressive/listen` → stream PCM16 frames → server emits
 * one `utterance` per detected segment (`{ interaction_id, transcript, options }`)
 * → user dwells a tile → `POST /expressive/select { interaction_id, option_id }`
 * → speak the returned `{ text, lang }` while the mic is muted (echo guard).
 */

/** One symbol card inside an option. */
export interface SymbolCard {
  /** Symbol id; -1 when no match existed at all. */
  id: number;
  /** The word/gloss. Doubles as the ARASAAC lookup keyword when no image_url. */
  label: string;
  /** "/media/<file>.png" (server-relative); null when `as_text` is true. */
  image_url: string | null;
  /** 0..1 cosine score. */
  confidence: number;
  /** true → below match threshold: render `label` as TEXT, not an image. */
  as_text: boolean;
}

/** Back-compat alias for the older name used around the codebase. */
export type SymbolDTO = SymbolCard;

/** One proposed reply the user can pick. */
export interface OptionDTO {
  option_id: number;
  /** The full natural-language reply (what gets spoken). */
  text: string;
  /** Render left-to-right as the card row. */
  symbols: SymbolCard[];
}

/**
 * A batch of options for one interaction. Mirrors the WS `utterance` frame
 * (`transcript` present) and the `POST /expressive/options` response
 * (`transcript` absent).
 */
export interface OptionsResponse {
  interaction_id: number;
  /** Recognized speech that produced these options (WS `utterance` only). */
  transcript?: string;
  options: OptionDTO[];
}

/** `POST /expressive/select` response → feed to SpeechSynthesis. */
export interface SelectResponse {
  text: string;
  lang: Lang;
}

/**
 * Abstraction over the audio→suggestions backend. `MockRecordingTransport`
 * fakes it in-browser; `WebSocketRecordingTransport` is the real backend (WS +
 * REST). Screens depend only on this interface — the mock↔real switch lives in
 * the factory (`createRecordingTransport`) and `services/config.ts`.
 */
export interface RecordingTransport {
  /** Open the session (WS connect, or for the mock emit the static options). */
  start(opts: { lang: Lang }): Promise<void>;
  /**
   * Feed one PCM16 audio frame (16 kHz, mono, 320 samples / 640 bytes), as the
   * raw `Int16Array.buffer`. The mock ignores it.
   */
  sendFrame(frame: ArrayBuffer): void;
  /** Subscribe to option batches as they stream in (WS `utterance`). */
  onOptions(cb: (r: OptionsResponse) => void): void;
  /**
   * Ask for a fresh batch of options on demand. The mock emits its next dynamic
   * batch; the real backend streams on its own schedule, so this is a no-op.
   */
  requestNext(): void;
  /** Subscribe to transport errors. */
  onError(cb: (e: Error) => void): void;
  /**
   * Mark an option chosen and get the text to speak. Real backend calls
   * `POST /expressive/select`; the mock echoes the option's own text.
   */
  selectOption(interactionId: number, optionId: number): Promise<SelectResponse>;
  /** Echo guard: stop processing + reset the segmenter during TTS playback. */
  mute(): void;
  /** Echo guard: resume processing after the playback guard tail. */
  unmute(): void;
  /** Close the session and release any resources. */
  stop(): Promise<void>;
}
