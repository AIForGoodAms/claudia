import { USE_REAL_BACKEND, WS_LISTEN_URL } from '../config';
import { MockRecordingTransport, type MockTransportOptions } from './MockRecordingTransport';
import { WebSocketRecordingTransport } from './WebSocketRecordingTransport';
import type { RecordingTransport } from './types';

export type {
  OptionDTO,
  OptionsResponse,
  RecordingTransport,
  SelectResponse,
  SymbolCard,
  SymbolDTO,
} from './types';
export { MockRecordingTransport } from './MockRecordingTransport';
export { WebSocketRecordingTransport } from './WebSocketRecordingTransport';

/**
 * Pick the transport from build-time env (see services/config.ts). Defaults to
 * the in-browser mock; set `VITE_TRANSPORT=ws` to talk to the real backend at
 * `VITE_BACKEND_WS_URL`/`VITE_BACKEND_HTTP_URL`. This factory + config are the
 * entire mock↔real switch — no UI changes required.
 */
export function createRecordingTransport(mockOpts?: MockTransportOptions): RecordingTransport {
  if (USE_REAL_BACKEND) {
    return new WebSocketRecordingTransport(WS_LISTEN_URL);
  }
  return new MockRecordingTransport(mockOpts);
}
