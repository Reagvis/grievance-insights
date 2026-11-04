import { Bot, FileText, LoaderCircle, Lock, Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useDialog } from '../app/useDialog';
import type { GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import type { AssistantAnswer } from '../services/localApiService';
import { askAssistant, DATA_PRIVACY_HINT, PROCESSOR_LABEL } from '../services/runtimeServices';

type Props = {
  records: GrievanceRecord[];
  onOpenRecord: (id: string) => void;
  onClose: () => void;
  onGoToSummary: () => void;
};

export function AssistantDrawer({ records, onOpenRecord, onClose, onGoToSummary }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialog(true, onClose, ref);
  useEffect(() => () => request.current?.abort(), []);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || busy || !records.length) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setAsked(question.trim());
    try {
      const result = await askAssistant(records, question.trim(), controller.signal);
      if (!controller.signal.aborted) setAnswer(result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The local assistant is unavailable.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="drawer drawer--narrow" role="dialog" aria-modal="true" aria-labelledby="assistant-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2 id="assistant-title">{t('assistant')} · {PROCESSOR_LABEL}</h2>
            <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose} data-autofocus><X size={18} aria-hidden /></button>
          </div>
          <p className="muted">Search all {records.length.toLocaleString('en')} loaded records and inspect their source text.</p>
        </div>
        <div className="drawer-body">
          <div className="assistant-thread">
            <div className="assistant-bubble">
              <strong><Bot size={15} aria-hidden /> Record search and counts</strong>
              <span>This assistant uses deterministic lookup, not AI. Enter a case ID, category, or Telugu / English search text. It also supports category counts and missing-response or status queries.</span>
            </div>
            {asked && <div className="assistant-bubble"><strong>You</strong><span>{asked}</span></div>}
            <div aria-live="polite" aria-busy={busy}>
              {busy && <p><LoaderCircle size={15} className="spin" aria-hidden /> Searching records…</p>}
              {error && <p className="notice notice--error" role="alert">{error}</p>}
              {answer && <div className="assistant-bubble">
                <strong>Local assistant</strong><span>{answer.answer}</span>
                {answer.sources.length > 0 && <span>Source records{answer.totalMatches > answer.sources.length ? ` (first ${answer.sources.length} of ${answer.totalMatches})` : ''}:</span>}
                {answer.sources.map((source) => <div key={source.id}>
                  <button className="case-link" type="button" onClick={() => { onClose(); onOpenRecord(source.id); }}>{source.id}</button>
                  <p className="assistant-source">{source.complaintText}</p>
                </div>)}
              </div>}
            </div>
          </div>
          <div>
            <p className="field-label">Try a question</p>
            {['What are the most common categories?', 'Which water supply complaints have no response?', 'Show pending complaints'].map((example) => (
              <button key={example} type="button" className="btn btn-ghost btn-sm" onClick={() => setQuestion(example)} disabled={busy}>{example}</button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={onGoToSummary}><FileText size={15} aria-hidden />Go to the consolidated summary</button>
        </div>
        <div className="drawer-foot" style={{ display: 'grid' }}>
          <form onSubmit={(event) => void ask(event)}>
            <label htmlFor="assistant-input" className="sr-only">Question or search text</label>
            <div className="composer" style={{ display: 'flex', gap: 8 }}>
              <input id="assistant-input" className="input" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} placeholder="Case ID, category, or question" disabled={busy} />
              <button className="btn btn-primary" type="submit" disabled={busy || !question.trim() || !records.length} aria-label="Ask assistant"><Send size={16} aria-hidden /></button>
            </div>
          </form>
          <span className="privacy-line"><Lock size={12} aria-hidden /> {DATA_PRIVACY_HINT}</span>
        </div>
      </div>
    </>
  );
}

export function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="fab" onClick={onOpen} aria-label={t('openAssistant')} id="assistant-launcher">
      <span className="fab-icon" aria-hidden><Bot size={15} /></span><span className="fab-label">{t('assistant')}</span>
    </button>
  );
}
