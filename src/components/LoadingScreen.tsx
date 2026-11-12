import { LoaderCircle, RotateCcw, ServerCrash } from 'lucide-react';
import { formatCount } from '../utils/format';

type Props = {
  status: 'loading' | 'error';
  progress: { loaded: number; total: number | null } | null;
  error: string | null;
  onRetry: () => void;
};

/** Shown only until the first load of real data finishes (or fails). */
export function LoadingScreen({ status, progress, error, onRetry }: Props) {
  if (status === 'error') {
    return (
      <main className="main" id="main">
        <div className="load-card" role="alert">
          <ServerCrash size={30} aria-hidden />
          <h1>The complaints could not be loaded</h1>
          <p>{error ?? 'Something went wrong while contacting the server.'}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <RotateCcw size={15} aria-hidden />
            Try again
          </button>
        </div>
      </main>
    );
  }
  return (
    <main className="main" id="main">
      <div className="load-card" role="status" aria-live="polite">
        <LoaderCircle size={30} className="spin" aria-hidden />
        <h1>Loading complaints…</h1>
        <p>
          {progress
            ? progress.total
              ? `${formatCount(progress.loaded)} of ${formatCount(progress.total)} loaded`
              : `${formatCount(progress.loaded)} loaded`
            : 'Contacting the server'}
        </p>
        {progress?.total ? (
          <div className="load-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%` }} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
