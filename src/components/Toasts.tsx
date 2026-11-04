import { CircleCheck, TriangleAlert, X } from 'lucide-react';

export type Toast = { id: number; kind: 'success' | 'error'; message: string };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast--error' : ''}`}>
          {t.kind === 'error' ? <TriangleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
          <span>{t.message}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => onDismiss(t.id)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
