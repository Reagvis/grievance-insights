/**
 * Minimal typed HTTP client for the CM Helpline backend.
 *
 * - Base URL comes from VITE_API_BASE_URL (see config.ts). Nothing is hard-coded.
 * - Authentication is injected through `getToken`; no secret is ever bundled into the frontend.
 * - Every failure becomes an `ApiError` with a message that is safe to show to an operator.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type TokenProvider = () => string | null | Promise<string | null>;

export type ApiClientOptions = {
  baseUrl: string;
  getToken?: TokenProvider;
  /** `include` sends cookies (session auth) to a different origin. */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
};

export type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Return the raw Response (used for streaming). Errors are still mapped. */
  raw?: boolean;
};

function messageFor(status: number, serverMessage?: string): string {
  if (status === 401) return 'Your session has expired or you are not signed in. Sign in again and retry.';
  if (status === 403) return 'You do not have permission to view this data.';
  if (status === 404) return serverMessage ?? 'The requested item was not found on the server.';
  if (status === 408 || status === 504) return 'The server took too long to respond. Try again.';
  if (status === 413) return serverMessage ?? 'The request was too large for the server.';
  if (status === 429) return 'Too many requests right now. Wait a moment and try again.';
  if (status >= 500) return serverMessage ?? 'The server had a problem handling this request. Try again shortly.';
  return serverMessage ?? `The request failed (${status}).`;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions) {
  const { baseUrl, getToken, credentials, defaultTimeoutMs = 30_000 } = options;
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${baseUrl}${path}`, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

    const headers: Record<string, string> = { Accept: opts.raw ? 'text/event-stream, application/json' : 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const timeout = AbortSignal.timeout(opts.timeoutMs ?? defaultTimeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials,
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e; // caller cancelled: let AbortError propagate
      if (timeout.aborted) throw new ApiError(408, 'The server took too long to respond. Try again.');
      throw new ApiError(0, 'Cannot reach the server. Check your connection or ask an administrator whether the service is running.');
    }

    if (!response.ok) {
      let serverMessage: string | undefined;
      let code: string | undefined;
      try {
        const data = (await response.json()) as { error?: unknown; message?: unknown; code?: unknown };
        const m = data.error ?? data.message;
        if (typeof m === 'string') serverMessage = m;
        if (typeof data.code === 'string') code = data.code;
      } catch {
        /* body was not JSON */
      }
      throw new ApiError(response.status, messageFor(response.status, serverMessage), code);
    }
    return response;
  }

  async function json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const response = await request(path, opts);
    if (!response.headers.get('content-type')?.includes('json')) {
      throw new ApiError(502, 'The server returned an unexpected response (not JSON). Check the API address configuration.');
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(502, 'The server returned a response that could not be read.');
    }
  }

  return { request, json };
}
