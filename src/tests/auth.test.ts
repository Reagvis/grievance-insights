import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthApiError, authRequest, onAuthExpired } from '../services/authApi';
import { AuthScreen, canRenderProtectedApp } from '../app/AuthGate';

const mock = vi.fn<typeof fetch>();
const payload = { authenticated: true, user: { username: 'admin' } };
function response(status: number, body?: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  });
}
afterEach(() => mock.mockReset());
describe('same-origin authentication API', () => {
  it('restores the session with cookies, no cache and same-origin URL', async () => {
    mock.mockResolvedValue(response(200, payload));
    expect(await authRequest('/api/auth/session', 'GET', undefined, mock)).toEqual(payload);
    expect(mock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    }));
  });
  it('logs in without local token storage', async () => {
    mock.mockResolvedValue(response(200, payload));
    expect(await authRequest('/api/auth/login', 'POST', { username: 'admin', password: 'secret' }, mock)).toEqual(payload);
    expect(mock.mock.calls[0][1]).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":"admin","password":"secret"}',
    });
  });
  it('handles 204 logout and session expiration on 401', async () => {
    mock.mockResolvedValueOnce(response(204)).mockResolvedValueOnce(response(401, { error: 'Authentication required.' }));
    expect(await authRequest('/api/auth/logout', 'POST', undefined, mock)).toBeNull();
    const expired = vi.fn(); const unsubscribe = onAuthExpired(expired);
    await expect(authRequest('/api/auth/session', 'GET', undefined, mock)).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce(); unsubscribe();
  });
  it('shows invalid credentials without treating login 401 as session expiration', async () => {
    const expired = vi.fn(); const unsubscribe = onAuthExpired(expired);
    mock.mockResolvedValue(response(401, { error: 'Invalid username or password.' }));
    await expect(authRequest('/api/auth/login', 'POST', { username: 'u', password: 'p' }, mock))
      .rejects.toMatchObject({ status: 401, message: 'Invalid username or password.' });
    expect(expired).not.toHaveBeenCalled(); unsubscribe();
  });
  it('rejects network errors, HTML fallback, malformed JSON and malformed session payloads', async () => {
    mock.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('{bad', { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(response(200, { authenticated: true }));
    for (let i = 0; i < 4; i++)
      await expect(authRequest('/api/auth/session', 'GET', undefined, mock)).rejects.toBeInstanceOf(AuthApiError);
  });
});
describe('protected UI', () => {
  it('only admits a validated session', () => {
    expect(canRenderProtectedApp({ kind: 'checking' })).toBe(false);
    expect(canRenderProtectedApp({ kind: 'signed-out' })).toBe(false);
    expect(canRenderProtectedApp({ kind: 'error', message: 'offline' })).toBe(false);
    expect(canRenderProtectedApp({ kind: 'authenticated', user: { username: 'admin' } })).toBe(true);
  });
  it('renders labelled login inputs, a loading state, and a retry screen', () => {
    const props = { onLogin: async () => {}, onRetry: () => {} };
    const html = renderToStaticMarkup(createElement(AuthScreen, { ...props, state: { kind: 'signed-out' } }));
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('id="auth-password"');
    expect(html).not.toContain('record-list');
    const loading = renderToStaticMarkup(createElement(AuthScreen, { ...props, state: { kind: 'checking' } }));
    expect(loading).toContain('Checking your session');
    expect(loading).not.toContain('type="password"');
    const failed = renderToStaticMarkup(createElement(AuthScreen, { ...props, state: { kind: 'error', message: 'offline' } }));
    expect(failed).toContain('Retry session check');
    expect(failed).toContain('role="alert"');
  });
});
