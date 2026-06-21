import type { Lang } from '../../types';
import { selectOption as selectOptionRest } from '../rest';
import type { OptionsResponse, RecordingTransport, SelectResponse } from './types';

/**
 * Real backend: the `RecordingTransport` over the contract's WebSocket + REST.
 *
 *   - WS `/expressive/listen`: stream binary PCM16 frames up; the server pushes
 *     `{ type: "utterance", interaction_id, transcript, options }` once per
 *     detected segment. `mute`/`unmute` are sent as text frames for the echo
 *     guard while TTS plays the chosen reply.
 *   - `selectOption` → `POST /expressive/select { interaction_id, option_id }`
 *     returning `{ text, lang }` to speak.
 *
 * Switching to this is an env change (`VITE_TRANSPORT=ws`), not a UI rewrite.
 */
export class WebSocketRecordingTransport implements RecordingTransport {
  private socket: WebSocket | null = null;
  private optionsCb: ((r: OptionsResponse) => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;

  constructor(private readonly wsUrl: string) {}

  onOptions(cb: (r: OptionsResponse) => void): void {
    this.optionsCb = cb;
  }

  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  async start({ lang }: { lang: Lang }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        // lang is configured server-side; pass it as a hint, harmless if ignored.
        const url = `${this.wsUrl}?lang=${encodeURIComponent(lang)}`;
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => resolve();
        socket.onmessage = (event: MessageEvent) => this.handleMessage(event);
        socket.onerror = () => this.errorCb?.(new Error('WebSocket transport error'));
        this.socket = socket;
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return; // server only sends JSON text
    try {
      const msg = JSON.parse(event.data) as Partial<OptionsResponse> & { type?: string };
      if (msg.type === 'utterance' && Array.isArray(msg.options)) {
        this.optionsCb?.({
          interaction_id: msg.interaction_id ?? 0,
          transcript: msg.transcript,
          options: msg.options,
        });
      }
    } catch (err) {
      this.errorCb?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  sendFrame(frame: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame);
  }

  /** No-op: the real backend streams `utterance` batches on its own schedule. */
  requestNext(): void {}

  mute(): void {
    this.sendControl('mute');
  }

  unmute(): void {
    this.sendControl('unmute');
  }

  private sendControl(type: 'mute' | 'unmute'): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type }));
    }
  }

  selectOption(interactionId: number, optionId: number): Promise<SelectResponse> {
    return selectOptionRest(interactionId, optionId);
  }

  async stop(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Already closing/closed.
      }
      this.socket = null;
    }
  }
}
