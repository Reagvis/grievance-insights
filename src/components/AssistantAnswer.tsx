import { Copy, Download } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { canExport, parseAssistantDocument, requestedOrientation, type ExportFormat, type ExportTurn, type Orientation, type Run } from '../utils/assistantDocument';

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <Fragment key={i}>{r.bold ? <strong>{r.text}</strong> : r.italic ? <em>{r.text}</em> : r.text}</Fragment>)}</>;
}

export function AssistantAnswer({ text }: { text: string }) {
  return <>{parseAssistantDocument(text).map((b, i) => {
    if (b.kind === 'heading') {
      const H = (['h1','h2','h3','h4','h5','h6'] as const)[b.level - 1];
      return <H key={i} className="assistant-answer-heading"><Runs runs={b.runs}/></H>;
    }
    if (b.kind === 'paragraph') return <p key={i}>{b.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br/>}<Runs runs={line}/></Fragment>)}</p>;
    if (b.kind === 'list') {
      const List = b.ordered ? 'ol' : 'ul';
      return <List key={i}>{b.items.map((item, j) => <li key={j} value={b.ordered ? Number.parseInt(item.marker, 10) : undefined}><Runs runs={item.runs}/></li>)}</List>;
    }
    return <div key={i} className="assistant-answer-table"><table><thead><tr>{b.rows[0].map((cell, j) => <th key={j} scope="col"><Runs runs={cell}/></th>)}</tr></thead><tbody>
      {b.rows.slice(1).map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}><Runs runs={cell}/></td>)}</tr>)}
    </tbody></table></div>;
  })}</>;
}

export function AssistantAnswerActions({ turn, question, disabled = false }: { turn: ExportTurn; question: string; disabled?: boolean }) {
  const [orientation, setOrientation] = useState<Orientation>(() => requestedOrientation(question));
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  // Keyed by conversation and turn in ChatPanel. Also invalidate if the visible
  // answer or availability changes while a browser font/page is being prepared.
  useLayoutEffect(() => {
    setBusy(null); setError('');
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [turn.id, turn.content, turn.status, disabled]);
  if (!canExport(turn)) return null;

  const download = async (format: ExportFormat) => {
    if (pending.current || disabled) return;
    const ac = new AbortController();
    pending.current = ac;
    setError(''); setBusy(format);
    try {
      const { downloadAssistantAnswer } = await import('../utils/assistantExport');
      await downloadAssistantAnswer(turn.content, turn.id, format, orientation, ac.signal);
    } catch {
      if (!ac.signal.aborted) setError('Could not prepare the ' + (format === 'pdf' ? 'PDF' : 'Word') + ' download. Check browser download permissions, try another layout or the other format.');
    } finally {
      if (pending.current === ac) { pending.current = null; setBusy(null); }
    }
  };
  return <div className="assistant-answer-actions">
    <div className="assistant-answer-action-row">
      <button type="button" className="chat-copy" onClick={() => void navigator.clipboard?.writeText(turn.content)} aria-label="Copy answer"><Copy size={12} aria-hidden/> Copy</button>
      {!disabled && <>
        <button type="button" className="chat-copy" disabled={!!busy} onClick={() => void download('pdf')} aria-label="Download PDF"><Download size={12} aria-hidden/> Download PDF</button>
        <button type="button" className="chat-copy" disabled={!!busy} onClick={() => void download('docx')} aria-label="Download Word (.docx)"><Download size={12} aria-hidden/> Download Word (.docx)</button>
        <label className="assistant-export-layout">Page layout <select value={orientation} disabled={!!busy} onChange={e => setOrientation(e.target.value === 'landscape' ? 'landscape' : 'portrait')} aria-label="Export page layout">
          <option value="portrait">A4 portrait</option><option value="landscape">A4 landscape</option>
        </select></label>
      </>}
    </div>
    {busy && <p className="chat-note" role="status">Preparing {busy === 'pdf' ? 'PDF' : 'Word'}…</p>}
    {error && <p className="chat-error" role="alert">{error}</p>}
  </div>;
}
