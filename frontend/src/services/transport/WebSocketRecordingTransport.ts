import type { Lang } from '../../types';
import type { OptionsResponse, RecordingTransport, SelectResponse } from './types';

/**
 * Real backend: the `RecordingTransport` over the contract's WebSocket + REST.
 *
 *   - WS `/expressive/listen`: stream binary PCM16 frames up; the server pushes
 *     `{ type: "utterance", interaction_id, transcript, options }` once per
 *     detected segment. `mute`/`unmute` are sent as text frames for the echo
 *     guard while TTS plays the chosen reply.
 *   - `selectOption` → WS `{ type: "select", interaction_id, option_id }`; server
 *     replies with `{ type: "speak", text, lang }` and releases the next queued batch.
 *
 * Switching to this is an env change (`VITE_TRANSPORT=ws`), not a UI rewrite.
 */
export class WebSocketRecordingTransport implements RecordingTransport {
  private socket: WebSocket | null = null;
  private optionsCb: ((r: OptionsResponse) => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;
  private pendingSelect: ((r: SelectResponse) => void) | null = null;
  /** Set once stop() is called so late open/error events are ignored quietly. */
  private stopped = false;

  constructor(private readonly wsUrl: string) {}

  onOptions(cb: (r: OptionsResponse) => void): void {
    this.optionsCb = cb;
  }

  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  async start({ lang }: { lang: Lang }): Promise<void> {
    this.stopped = false;
    await new Promise<void>((resolve, reject) => {
      try {
        // lang is configured server-side; pass it as a hint, harmless if ignored.
        const url = `${this.wsUrl}?lang=${encodeURIComponent(lang)}`;
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        let opened = false;
        socket.onopen = () => {
          opened = true;
          // If stop() ran during connect (React StrictMode remount), close now
          // that it is OPEN — closing a CONNECTING socket logs a browser warning.
          if (this.stopped) socket.close();
          resolve();
        };
        socket.onmessage = (event: MessageEvent) => this.handleMessage(event);
        // A failed connect fires error/close before open. Reject so the caller
        // sees it, instead of silently dropping frames against a dead socket.
        socket.onerror = () => {
          const err = new Error(`WebSocket failed to connect to ${this.wsUrl}`);
          if (opened) { if (!this.stopped) this.errorCb?.(err); }
          else reject(err);
        };
        socket.onclose = () => {
          if (!opened) reject(new Error(`WebSocket closed before opening (${this.wsUrl})`));
        };
        this.socket = socket;
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return; // server only sends JSON text
    try {
      const msg = JSON.parse(event.data) as Partial<OptionsResponse> & {
        type?: string;
        text?: string;
        lang?: string;
      };
      if (msg.type === 'utterance' && Array.isArray(msg.options)) {
        this.optionsCb?.({
          interaction_id: msg.interaction_id ?? 0,
          transcript: msg.transcript,
          options: msg.options,
        });
      } else if (msg.type === 'speak') {
        const resolve = this.pendingSelect;
        this.pendingSelect = null;
        resolve?.({ text: msg.text ?? '', lang: (msg.lang ?? 'nl') as SelectResponse['lang'] });
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
    return new Promise((resolve) => {
      this.pendingSelect = resolve;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({ type: 'select', interaction_id: interactionId, option_id: optionId }),
        );
      }
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pendingSelect) {
      const resolve = this.pendingSelect;
      this.pendingSelect = null;
      resolve({ text: '', lang: 'nl' });
    }
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    // Only close an already-open socket here; a CONNECTING one is closed in
    // onopen (above) to avoid the "closed before established" console warning.
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        // Already closing/closed.
      }
    }
  }
}
