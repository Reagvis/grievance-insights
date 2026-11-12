import { createApiClient, type TokenProvider } from './http';

/**
 * Runtime configuration.
 *
 *  VITE_API_BASE_URL     e.g. https://helpline.example.gov/api/v1  → LIVE mode (real data, real assistant)
 *  VITE_API_CREDENTIALS  "include" to send session cookies cross-origin
 *  (not set)             DEMO mode: bundled synthetic records, deterministic in-browser processing
 *
 * `npm run dev:mock-api` runs LIVE mode against the bundled development mock backend (/api/v1).
 */
const env = import.meta.env as Record<string, string | undefined>;

export const API_BASE_URL = (env.VITE_API_BASE_URL ?? (env.MODE === 'mockapi' ? '/api/v1' : '')).replace(/\/+$/, '');
export const IS_LIVE = API_BASE_URL !== '';

let tokenProvider: TokenProvider | null = null;
/** Hook for the host app / SSO integration: return the current bearer token (or null). */
export function setAuthTokenProvider(provider: TokenProvider | null) {
  tokenProvider = provider;
}

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => (tokenProvider ? tokenProvider() : null),
  credentials: env.VITE_API_CREDENTIALS === 'include' ? 'include' : 'same-origin',
});
