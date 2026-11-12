import { useCallback, useEffect, useState } from 'react';

/**
 * Tiny hash router (no dependency). Hash URLs also work on static hosting such as GitHub Pages.
 *   #/upload (signed-in build)   #/dashboard (demo)   #/complaints   #/summary      — optional  ?id=GRV-000123  opens that note.
 */
export type Page = 'upload' | 'dashboard' | 'complaints' | 'summary';
export type Route = { page: Page; noteId: string | null };

export const PAGES: readonly Page[] = ['upload', 'dashboard', 'complaints', 'summary'];
export const DEFAULT_ROUTE: Route = { page: 'dashboard', noteId: null };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const page = PAGES.find((p) => p === path.toLowerCase()) ?? DEFAULT_ROUTE.page;
  const id = new URLSearchParams(query).get('id');
  return { page, noteId: id && id.trim() ? id.trim() : null };
}

export function buildHash(route: Route): string {
  const q = route.noteId ? `?id=${encodeURIComponent(route.noteId)}` : '';
  return `#/${route.page}${q}`;
}

export function useRoute(): [Route, (next: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    const hash = buildHash(next);
    if (opts?.replace) window.history.replaceState(null, '', hash);
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setRoute(next);
  }, []);
  return [route, navigate];
}
