import type { Lang } from '../../types';
import { DYNAMIC_BATCHES, STATIC_OPTIONS } from '../../data/mockSuggestions';
import type { OptionsResponse, RecordingTransport, SelectResponse } from './types';

/** Minimal shape of the Web Speech API we touch (avoids a DOM-lib dependency). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface MockTransportOptions {
  /**
   * Drive dynamic suggestions off the listener's actual speech via
   * `webkitSpeechRecognition` (Chrome). When off, batches only advance when the
   * UI calls `requestNext()` (e.g. on a spacebar press).
   */
  useSpeechRecognition?: boolean;
}

/**
 * In-browser fake of the audio→suggestions backend (design-doc §7).
 *
 * `start()` emits the static "most-used" options immediately. Dynamic context
 * options then advance on demand — never on a timer:
 *   - default: each `requestNext()` call (wired to a spacebar press) emits the
 *     next batch from `DYNAMIC_BATCHES`.
 *   - speech-recognition (opt-in): transcribe the listener's voice and emit the
 *     batch whose keywords match — "dynamic based on conversation input".
 *
 * Each emission carries an incrementing `interaction_id`. Swapping this for
 * `WebSocketRecordingTransport` is an env/factory change, not a UI change.
 */
export class MockRecordingTransport implements RecordingTransport {
  private optionsCb: ((r: OptionsResponse) => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;

  private interactionId = 0;
  private rotateIndex = 0;
  private recognition: SpeechRecognitionLike | null = null;
  private stopped = false;
  private muted = false;
  private lang: Lang = 'nl';
  /** Remember each emitted option so selectOption can echo its text. */
  private readonly optionsById = new Map<number, OptionsResponse['options'][number]>();

  private readonly useSpeechRecognition: boolean;

  constructor(opts: MockTransportOptions = {}) {
    this.useSpeechRecognition = opts.useSpeechRecognition ?? false;
  }

  onOptions(cb: (r: OptionsResponse) => void): void {
    this.optionsCb = cb;
  }

  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  async start({ lang }: { lang: Lang }): Promise<void> {
    this.stopped = false;
    this.muted = false;
    this.lang = lang;

    // Static options are available immediately (synchronously) on start.
    this.emit(STATIC_OPTIONS);

    // Optional speech-driven mode; otherwise batches advance via requestNext().
    if (this.useSpeechRecognition) this.startRecognition(lang);
  }

  /** Emit the next dynamic batch on demand (UI calls this on a spacebar press). */
  requestNext(): void {
    this.emitNextDynamic();
  }

  // Audio frames are accepted but unused by the mock — the real transport
  // forwards them upstream. Kept so the recording page wiring matches the seam.
  sendFrame(_frame: ArrayBuffer): void {
    void _frame;
  }

  /** Echo guard no-ops for the mock — there is no segmenter to gate. */
  mute(): void {
    this.muted = true;
  }

  unmute(): void {
    this.muted = false;
  }

  /** Mock select: echo the chosen option's own text in the active language. */
  async selectOption(_interactionId: number, optionId: number): Promise<SelectResponse> {
    void _interactionId;
    const option = this.optionsById.get(optionId);
    return { text: option?.text ?? '', lang: this.lang };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Already stopped.
      }
      this.recognition = null;
    }
  }

  /** Emit one contract-shaped `OptionsResponse` with a fresh interaction id. */
  private emit(options: OptionsResponse['options']): void {
    if (this.stopped || this.muted) return;
    this.interactionId += 1;
    for (const option of options) this.optionsById.set(option.option_id, option);
    this.optionsCb?.({ interaction_id: this.interactionId, options });
  }

  private emitNextDynamic(): void {
    const batch = DYNAMIC_BATCHES[this.rotateIndex % DYNAMIC_BATCHES.length];
    this.rotateIndex += 1;
    this.emit(batch.options);
  }

  /** Match a transcript to a dynamic batch by keyword and emit it. */
  private emitForTranscript(transcript: string): void {
    const text = transcript.toLowerCase();
    const batch = DYNAMIC_BATCHES.find((b) => b.keywords.some((k) => text.includes(k)));
    if (batch) this.emit(batch.options);
  }

  /** Start SpeechRecognition; returns false if unavailable. */
  private startRecognition(lang: Lang): boolean {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return false;
    try {
      const rec = new Ctor();
      rec.lang = lang === 'nl' ? 'nl-NL' : 'en-US';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (event) => {
        const results = event.results;
        const last = results[results.length - 1];
        const transcript = last?.[0]?.transcript ?? '';
        if (transcript) this.emitForTranscript(transcript);
      };
      rec.start();
      this.recognition = rec;
      return true;
    } catch (err) {
      this.errorCb?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }
}
