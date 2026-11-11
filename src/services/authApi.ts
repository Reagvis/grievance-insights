/** Same-origin cookie-session client; credentials and tokens are never stored. */
export interface AuthUser { username: string }
export class AuthApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'AuthApiError'; }
}
type Session = { authenticated: true; user: AuthUser };
const listeners = new Set<() => void>();
export function onAuthExpired(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function validSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return object.authenticated === true && !!object.user && typeof object.user === 'object' &&
    typeof (object.user as Record<string, unknown>).username === 'string' &&
    (object.user as AuthUser).username.length > 0;
}
export async function authRequest<T>(
  path: '/api/auth/login' | '/api/auth/session' | '/api/auth/logout',
  method: 'GET' | 'POST', credentials?: { username: string; password: string },
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: credentials ? { 'Content-Type': 'application/json' } : undefined,
      body: credentials ? JSON.stringify(credentials) : undefined,
    });
  } catch { throw new AuthApiError(0, 'Authentication service unavailable. Check your connection and retry.'); }
  let payload: unknown = null;
  if (response.status !== 204) {
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new AuthApiError(0, 'Authentication service returned an invalid response.');
    try { payload = await response.json(); }
    catch { throw new AuthApiError(0, 'Authentication service returned invalid JSON.'); }
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') listeners.forEach(listener => listener());
    const error = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as { error: string }).error : 'Authentication request failed.';
    throw new AuthApiError(response.status, error);
  }
  if (path !== '/api/auth/logout' && !validSession(payload))
    throw new AuthApiError(0, 'Authentication service returned invalid session details.');
  return payload as T;
}
export const authApi = {
  session: () => authRequest<Session>('/api/auth/session', 'GET'),
  login: (username: string, password: string) => authRequest<Session>('/api/auth/login', 'POST', { username, password }),
  logout: () => authRequest<void>('/api/auth/logout', 'POST'),
};
