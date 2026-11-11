import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from '../components/AppHeader';
import { AuthApiError, authApi, onAuthExpired, type AuthUser } from '../services/authApi';

export type AuthState = { kind: 'checking' } | { kind: 'signed-out'; message?: string } |
  { kind: 'error'; message: string } | { kind: 'authenticated'; user: AuthUser };
export const canRenderProtectedApp = (state: AuthState): state is Extract<AuthState, { kind: 'authenticated' }> =>
  state.kind === 'authenticated';

export function AuthScreen({ state, onLogin, onRetry }: {
  state: Exclude<AuthState, { kind: 'authenticated' }>;
  onLogin: (username: string, password: string) => Promise<void>; onRetry: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await onLogin(username.trim(), password); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  return <main id="main" className="auth-shell">
    <section className="auth-panel" aria-labelledby="auth-title" aria-busy={busy || state.kind === 'checking'}>
      <div className="auth-brand"><BrandMark /><span>Grievance Insights</span></div>
      <h1 id="auth-title">Administrator sign in</h1>
      <p className="auth-description">Enter your pilot administrator credentials to access the workspace.</p>
      {state.kind === 'checking' ? <p role="status">Checking your session…</p> :
       state.kind === 'error' ? <div><p className="auth-error" role="alert">{state.message}</p>
         <button type="button" className="btn btn-primary" onClick={onRetry}>Retry session check</button></div> :
       <form className="auth-form" onSubmit={(event) => { void submit(event); }}>
         {state.message && <p role="alert" className="auth-error">{state.message}</p>}
         <label htmlFor="auth-username">Username</label>
         <input className="input" id="auth-username" autoComplete="username" required maxLength={128}
           value={username} disabled={busy} onChange={event => setUsername(event.target.value)} />
         <label htmlFor="auth-password">Password</label>
         <input className="input" id="auth-password" type="password" autoComplete="current-password"
           required maxLength={256} value={password} disabled={busy}
           onChange={event => setPassword(event.target.value)} />
         {error && <p role="alert" className="auth-error">{error}</p>}
         <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
       </form>}
    </section>
  </main>;
}
export default function AuthGate({ children }: { children: (user: AuthUser, logout: () => void) => ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'checking' });
  const version = useRef(0);
  const check = useCallback(async () => {
    const current = ++version.current;
    setState({ kind: 'checking' });
    try {
      const result = await authApi.session();
      if (current === version.current) setState({ kind: 'authenticated', user: result.user });
    } catch (error) {
      if (current !== version.current) return;
      setState(error instanceof AuthApiError && error.status === 401
        ? { kind: 'signed-out' }
        : { kind: 'error', message: error instanceof Error ? error.message : 'Session check failed.' });
    }
  }, []);
  useEffect(() => {
    void check();
    const off = onAuthExpired(() => {
      ++version.current;
      setState({ kind: 'signed-out', message: 'Session expired. Please sign in again.' });
    });
    const refresh = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      ++version.current; off(); document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [check]);
  const login = async (username: string, password: string) => {
    const current = ++version.current;
    const result = await authApi.login(username, password);
    if (current === version.current) setState({ kind: 'authenticated', user: result.user });
  };
  const logout = async () => {
    ++version.current;
    setState({ kind: 'checking' }); // discard the entire workspace and imported in-memory dataset
    try { await authApi.logout(); setState({ kind: 'signed-out' }); }
    catch (error) {
      setState({ kind: 'signed-out', message: `Sign-out could not be confirmed: ${error instanceof Error ? error.message : 'Unknown error'}. Your server session may still be active.` });
    }
  };
  return canRenderProtectedApp(state)
    ? <>{children(state.user, () => { void logout(); })}</>
    : <AuthScreen state={state} onLogin={login} onRetry={() => { void check(); }} />;
}
