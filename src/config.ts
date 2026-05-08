export const DEFAULT_REPLAY_CORS_PROXY_URL = "https://replay-cors-proxy.murtagy.workers.dev";
export const LEGACY_REPLAY_CORS_PROXY_URL = "https://replay-cors-proxy.murtagy-arma.workers.dev";

export function normalizeReplayCorsProxyUrl(url: string | null | undefined): string {
  const value = (url || "").trim();
  if (!value) return "";
  if (value === LEGACY_REPLAY_CORS_PROXY_URL) return DEFAULT_REPLAY_CORS_PROXY_URL;
  return value;
}

export const REPLAY_CORS_PROXY_URL = normalizeReplayCorsProxyUrl(
  import.meta.env.VITE_REPLAY_CORS_PROXY_URL ||
    import.meta.env.VITE_REPLAY_PROXY_URL ||
    DEFAULT_REPLAY_CORS_PROXY_URL,
);

export const APP_CONFIG = {
  replayCorsProxyUrl: REPLAY_CORS_PROXY_URL,
} as const;
