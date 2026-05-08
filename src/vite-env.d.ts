/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REPLAY_CORS_PROXY_URL?: string;
  readonly VITE_REPLAY_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
