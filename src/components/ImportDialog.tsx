import { CircleAlert, FolderOpen, Info, LoaderCircle, TriangleAlert, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useDialog } from '../app/useDialog';
import { formatCount } from '../utils/format';
import { ImportError, readImportFiles, type ImportResult } from '../utils/importer';
import { StatusBadge } from './StatusBadge';

type Props = {
  onClose: () => void;
  onUse: (result: ImportResult) => void;
};

const ACCEPT = '.csv,.json,.txt,.pdf,text/csv,application/json,text/plain,application/pdf';

/** Folder drops arrive as directory entries; read them recursively so a whole folder of notes can be dropped. */
async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const items = Array.from(e.dataTransfer.items ?? []);
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
  if (entries.length === 0 || entries.some((en) => en === null)) return Array.from(e.dataTransfer.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const en of entries) if (en) await walk(en);
  return out;
}

export function ImportDialog({ onClose, onUse }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useDialog(true, onClose, ref);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    // Not a standard attribute in React's typings, but required to pick a whole folder.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const handleFiles = async (list: File[]) => {
    if (list.length === 0) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const r = await readImportFiles(list, { signal: ac.signal, loadPdf: async () => (await import('../utils/pdfLoader')).loadPdfJs(), onProgress: (done, total) => setProgress({ done, total }) });
      if (!ac.signal.aborted) setResult(r);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof ImportError ? e.message : 'The files could not be read.');
    } finally {
      if (abort.current === ac) abort.current = null;
      setBusy(false);
      setProgress(null);
      if (filesInput.current) filesInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    try {
      await handleFiles(await filesFromDrop(e));
    } catch {
      setError('The dropped items could not be read. Use “Choose files” instead.');
    }
  };

  const docs = result?.format === 'documents';
  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = result?.issues.filter((i) => i.level === 'warning') ?? [];
  const setAside = result ? result.duplicates.reduce((a, d) => a + d.skippedRows.length, 0) : 0;

  return (
    <div className="modal-wrap">
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2 id="import-title">Import grievance records</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-autofocus>
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <div
            className={`dropzone ${over ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            {busy ? <LoaderCircle size={26} className="spin" aria-hidden /> : <Upload size={26} aria-hidden />}
            <strong>
              {busy
                ? progress
                  ? 'Reading file ' + formatCount(progress.done) + ' of ' + formatCount(progress.total) + '…'
                  : 'Reading…'
                : 'Choose TXT or PDF notes, or a CSV / JSON file'}
            </strong>
            <p>
              Select any number of .txt / .pdf notes (one record per file), or drop a whole folder. Or use one .csv / .json file with the columns below.
            </p>
            <div className="dropzone-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => filesInput.current?.click()} disabled={busy}>
                Choose files
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => folderInput.current?.click()} disabled={busy}>
                <FolderOpen size={14} aria-hidden />
                Choose folder
              </button>
              {busy && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => abort.current?.abort()}>
                  Cancel reading
                </button>
              )}
            </div>
            {busy && progress && (
              <div className="load-bar" aria-hidden>
                <span style={{ width: Math.min(100, (progress.done / progress.total) * 100) + '%' }} />
              </div>
            )}
            <input
              ref={filesInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose TXT, PDF, CSV or JSON files"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a folder of notes"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          {error && (
            <div className="notice notice--error" role="alert">
              <CircleAlert size={16} aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <>
              <div className="import-stats" aria-label="Import results">
                <div>
                  <strong>{formatCount(result.records.length)}</strong>
                  <span>{docs ? 'notes ready' : 'valid records ready'}</span>
                </div>
                <div>
                  <strong>{formatCount(result.rejectedRows.length)}</strong>
                  <span>{docs ? 'files rejected' : 'rows rejected'}</span>
                </div>
                <div>
                  <strong>{formatCount(setAside)}</strong>
                  <span>{docs ? 'duplicate IDs set aside' : 'duplicate rows set aside'}</span>
                </div>
                <div>
                  <strong>{docs && result.documents ? formatCount(result.documents.split) : formatCount(result.emptyRows)}</strong>
                  <span>{docs ? 'split into complaint + response' : 'empty rows skipped'}</span>
                </div>
              </div>
              {docs && result.documents && (
                <p className="muted">
                  Read {formatCount(result.documents.txt)} TXT and {formatCount(result.documents.pdf)} PDF file{result.totalRows === 1 ? '' : 's'}.
                </p>
              )}

              {(errors.length > 0 || warnings.length > 0) && (
                <ul className="issue-list">
                  {[...errors, ...warnings].map((i) => (
                    <li key={i.message} className={'notice ' + (i.level === 'error' ? 'notice--error' : 'notice--warn')}>
                      {i.level === 'error' ? <CircleAlert size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {result.rejectedRows.length > 0 && (
                <ul className="details-list" aria-label={docs ? 'Rejected files' : 'Rejected rows'}>
                  {result.rejectedRows.slice(0, 200).map((r) => (
                    <li key={r.row}>{docs ? r.reason : 'Row ' + r.row + ': ' + r.reason}</li>
                  ))}
                </ul>
              )}
              {result.duplicates.length > 0 && (
                <ul className="details-list" aria-label="Duplicate IDs">
                  {result.duplicates.slice(0, 200).map((d) => (
                    <li key={d.id}>
                      {d.id}: kept {docs ? 'file' : 'row'} {d.keptRow}, set aside {docs ? 'file' : 'row'}
                      {d.skippedRows.length > 1 ? 's' : ''} {d.skippedRows.join(', ')}
                      {d.identical ? ' (identical)' : ' (content differs — review the source)'}
                    </li>
                  ))}
                </ul>
              )}

              {result.records.length > 0 && (
                <div>
                  <p className="field-label">Preview of the first records — check the text reads correctly</p>
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>{docs ? 'ID (from file)' : 'Case ID'}</th>
                        <th style={{ width: '18%' }}>Status</th>
                        <th style={{ width: '14%' }}>Response</th>
                        <th>Complaint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.records.slice(0, 3).map((r) => (
                        <tr key={r.id}>
                          <td className="case-id">{r.id}</td>
                          <td>
                            <StatusBadge status={r.status} />
                          </td>
                          <td>{r.responseText ? 'Found' : <span className="not-recorded">None</span>}</td>
                          <td className="te" lang={r.language === 'en' ? 'en' : 'te'}>
                            {r.complaintText.length > 220 ? r.complaintText.slice(0, 220) + '…' : r.complaintText}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!result && !error && !busy && (
            <div className="notice notice--info">
              <Info size={16} aria-hidden />
              <span>
                TXT is the most reliable format (UTF-8 or UTF-16). PDFs must contain selectable text: scans need OCR, which is not available yet, and PDFs
                whose Telugu letters cannot be decoded are rejected rather than imported with missing letters. Notes exported from this app import back as they
                were; other files need “Complaint:” / “Response:” headings to be split into complaint and response.
              </span>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!result || result.records.length === 0 || busy}
            onClick={() => result && onUse(result)}
          >
            Use imported dataset{result && result.records.length > 0 ? ' (' + formatCount(result.records.length) + ')' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
