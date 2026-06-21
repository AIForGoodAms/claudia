import type { Lang } from '../types';

/**
 * Backend configuration + the single mock↔real switch.
 *
 * Everything the app needs to talk to the AAC Translator backend (api-contract.md)
 * is derived from build-time env here, so swapping the in-browser mock for the
 * real FastAPI backend is an env change, not a code change:
 *
 *   VITE_TRANSPORT=ws            # 'mock' (default) | 'ws'
 *   VITE_BACKEND_HTTP_URL=...    # default http://127.0.0.1:8000
 *   VITE_BACKEND_WS_URL=...      # default ws://127.0.0.1:8000
 *
 * Dev defaults match the contract's "Base URL (dev)" so a local backend works
 * with just `VITE_TRANSPORT=ws`.
 */

export type TransportMode = 'mock' | 'ws';

export const TRANSPORT_MODE: TransportMode =
  import.meta.env.VITE_TRANSPORT === 'ws' ? 'ws' : 'mock';

/** True when pointed at the real backend (WebSocket + REST), false for the mock. */
export const USE_REAL_BACKEND = TRANSPORT_MODE === 'ws';

export const HTTP_BASE: string =
  import.meta.env.VITE_BACKEND_HTTP_URL ?? 'http://127.0.0.1:8000';

export const WS_BASE: string =
  import.meta.env.VITE_BACKEND_WS_URL ?? 'ws://127.0.0.1:8000';

/** WebSocket conversation loop — `ws://<host>/expressive/listen`. */
export const WS_LISTEN_URL = `${WS_BASE}/expressive/listen`;

/**
 * Resolve a `SymbolCard.image_url` (`"/media/<file>.png"`, server-relative)
 * against the backend HTTP base. Passes absolute URLs and `data:` URLs through
 * unchanged, and returns null for the `as_text` case (no image).
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${HTTP_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Map an app `Lang` to a BCP-47 voice locale (contract: nl→nl-NL, en→en-US). */
export function voiceLocale(lang: Lang): string {
  return lang === 'nl' ? 'nl-NL' : 'en-US';
}
