import { useEffect, useRef, useState } from 'react';
import type { Dataset } from '../domain/grievance';
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
  return <section className="notice notice--info dataset-notice" aria-label="Persisted datasets">
    <div style={{ width: '100%' }}>
      <strong>Private uploaded datasets</strong>
      <p>CSV/JSON · maximum 1 MiB and 200 records · stored privately in AWS. Uploads are available after refresh.</p>
      <input id="remote-dataset-file" ref={fileRef} type="file" accept=".csv,.json" aria-label="Upload private grievance dataset" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert" className="notice--error">{error}</p>}
      <ul className="details-list" aria-label="Saved datasets">
        {items.map(item => <li key={item.id}>
          <span>{item.name} — {item.status}{item.status === 'ready' ? ' (' + item.recordCount + ' records)' : ''}{item.error ? ': ' + item.error : ''}</span>{' '}
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || item.status !== 'ready'} onClick={() => void select(item)}>{activeId === item.id ? 'Selected' : 'Open'}</button>{' '}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove(item)}>Delete</button>
        </li>)}
      </ul>
    </div>
  </section>;
}
