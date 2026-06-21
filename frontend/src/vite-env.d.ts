/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default, in-browser) or 'ws' (real backend). */
  readonly VITE_TRANSPORT?: 'mock' | 'ws';
  /** Backend REST base, e.g. http://127.0.0.1:8000 (defaults to that). */
  readonly VITE_BACKEND_HTTP_URL?: string;
  /** Backend WebSocket base, e.g. ws://127.0.0.1:8000 (defaults to that). */
  readonly VITE_BACKEND_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
