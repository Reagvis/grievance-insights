import { useEffect, useRef, useState } from 'react';
import type { Dataset } from '../domain/grievance';
import { SOURCE_FORMATS } from '../domain/sourceFormats';
import { formatDateTime } from '../utils/format';
import { listDatasets, openDataset, removeDataset, uploadDataset, type RemoteDataset } from '../services/datasetApi';

const SELECTION = 'grievance-insights.remoteDatasetId';
type Props = { onSelect: (dataset: Dataset) => void; onClear: () => void; activeId: string | null };
export function PersistedDatasets({ onSelect, onClear, activeId }: Props) {
  const [items, setItems] = useState<RemoteDataset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  async function refresh() {
    try { setItems(await listDatasets()); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to list datasets.'); }
  }
  async function select(item: RemoteDataset) {
    if (item.status !== 'ready') return;
    setBusy(true); setError('');
    try {
      const loaded = await openDataset(item.id);
      if (!loaded.records) throw new Error('Dataset is not ready.');
      onSelect({ id: item.id, name: 'Uploaded · ' + item.name, kind: 'imported', records: loaded.records, isSynthetic: loaded.records.every(r => r.isSyntheticDemo), sourceFileName: item.name });
      sessionStorage.setItem(SELECTION, item.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open dataset.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!items.some(item => item.status === 'extracting')) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
    // refresh only reads state setters; the interval is keyed to whether anything is extracting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await listDatasets();
        if (cancelled) return;
        setItems(data);
        const selected = sessionStorage.getItem(SELECTION);
        const item = data.find(d => d.id === selected && d.status === 'ready');
        if (item) {
          const loaded = await openDataset(item.id);
          if (!cancelled && loaded.records) onSelect({ id: item.id, name: 'Uploaded · ' + item.name, kind: 'imported', records: loaded.records, isSynthetic: loaded.records.every(r => r.isSyntheticDemo), sourceFileName: item.name });
        } else if (selected) sessionStorage.removeItem(SELECTION);
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load datasets.'); }
    })();
    return () => { cancelled = true; };
  // Mount-only restoration. App's onSelect is intentionally not a reactive dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const created = await uploadDataset(file, setProgress);
      await refresh();
      await select(created);
      setProgress('Upload validated and saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); await refresh(); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function remove(item: RemoteDataset) {
    if (!window.confirm('Permanently delete "' + item.name + '" and its private uploaded file?')) return;
    setBusy(true); setError('');
    try {
      await removeDataset(item.id);
      if (activeId === item.id) { sessionStorage.removeItem(SELECTION); onClear(); }
      await refresh();
      setProgress('Dataset deleted.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed; retry.'); }
    finally { setBusy(false); }
  }
  const STATUS: Record<RemoteDataset['status'], string> = { ready: 'Ready', extracting: 'Extracting…', validating: 'Validating…', pending_upload: 'Upload pending', failed: 'Failed' };
  return <section className="datasets-panel dataset-notice" aria-label="Persisted datasets">
    <div className="datasets-head">
      <div>
        <h2>Your datasets</h2>
        <p className="datasets-hint">Stored privately in AWS and still here after a refresh. Open one to see its dashboard.</p>
      </div>
      <label className={'btn btn-primary datasets-upload' + (busy ? ' is-disabled' : '')} htmlFor="remote-dataset-file">Upload file</label>
      <input id="remote-dataset-file" ref={fileRef} className="sr-only" type="file" accept={SOURCE_FORMATS.map(f => '.' + f).join(',')} aria-label="Upload private grievance dataset" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
    </div>
    <p className="datasets-formats">
      <strong>One grievance per file:</strong> TXT, MD, DOCX, PDF (scanned PDFs are read by OCR). <strong>Many per file:</strong> CSV, JSON, JSONL, up to 2,000 grievances.
      Size limits: PDF 10 MiB and 50 pages, DOCX 5 MiB, TXT/MD 1 MiB, CSV/JSON/JSONL 20 MiB.
    </p>
    {progress && <p role="status" className="datasets-progress">{progress}</p>}
    {error && <p role="alert" className="datasets-error">{error}</p>}
    {items.length === 0
      ? <p className="datasets-empty">No datasets yet. Upload your first file.</p>
      : <ul className="dataset-list" aria-label="Saved datasets">
        {items.map(item => <li key={item.id} className={'dataset-row' + (activeId === item.id ? ' is-active' : '')}>
          <div className="dataset-main">
            <span className="dataset-name" title={item.name}>{item.name}</span>
            <span className="dataset-meta">
              <span className={'dataset-status dataset-status--' + item.status}>{STATUS[item.status]}</span>
              {item.status === 'ready' && <span>{item.recordCount} {item.recordCount === 1 ? 'record' : 'records'}</span>}
              <span>{formatDateTime(item.createdAt)}</span>
            </span>
            {item.error && <span className="dataset-row-error">{item.error}</span>}
          </div>
          <div className="dataset-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || item.status !== 'ready'} onClick={() => void select(item)}>{activeId === item.id ? 'Selected' : 'Open'}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove(item)}>Delete</button>
          </div>
        </li>)}
      </ul>}
  </section>;
}
