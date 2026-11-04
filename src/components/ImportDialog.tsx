import { CircleAlert, FileJson, FileSpreadsheet, Info, LoaderCircle, Lock, TriangleAlert, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useDialog } from '../app/useDialog';
import { IS_STATIC_BUILD } from '../services/runtimeServices';
import { formatCount } from '../utils/format';
import { buildCsvTemplate, buildJsonTemplate, ImportError, readImportFile, type ImportResult } from '../utils/importer';
import { StatusBadge } from './StatusBadge';

type Props = {
  onClose: () => void;
  onUse: (result: ImportResult) => void;
  onDownloadTemplate: (content: string, fileName: string, type: string) => void;
};

export function ImportDialog({ onClose, onUse, onDownloadTemplate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialog(true, onClose, ref);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await readImportFile(file));
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handleFile(e.dataTransfer.files[0]);
  };

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
          <p className="privacy-line">
            <Lock size={12} aria-hidden /> {IS_STATIC_BUILD ? 'Files are processed entirely in your browser. Records are not uploaded or saved after you close the page.' : 'Files are parsed in your browser. Generating a summary or asking the assistant sends records to the local API. Records are not saved after you close the page.'}
          </p>
        </div>

        <div className="drawer-body">
          <div
            className={`dropzone ${over ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {busy ? <LoaderCircle size={26} className="spin" aria-hidden /> : <Upload size={26} aria-hidden />}
            <strong>{busy ? 'Reading file…' : 'Choose a UTF-8 CSV or JSON file'}</strong>
            <p>or drop it here. Required fields: id and complaintText. Missing statuses are kept as “not recorded”.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              Browse files
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a CSV or JSON file"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </div>

          <div className="templates">
            <span>Templates:</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onDownloadTemplate(buildCsvTemplate(), 'grievance-import-template.csv', 'text/csv')}
            >
              <FileSpreadsheet size={14} aria-hidden /> CSV
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onDownloadTemplate(buildJsonTemplate(), 'grievance-import-template.json', 'application/json')}
            >
              <FileJson size={14} aria-hidden /> JSON
            </button>
            <span className="muted">
              Columns: id, complaintText, responseText, language, category, issueType, department, district, submittedAt, respondedAt, status
            </span>
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
                  <span>valid records ready</span>
                </div>
                <div>
                  <strong>{formatCount(result.rejectedRows.length)}</strong>
                  <span>rows rejected</span>
                </div>
                <div>
                  <strong>{formatCount(setAside)}</strong>
                  <span>duplicate rows set aside</span>
                </div>
                <div>
                  <strong>{formatCount(result.emptyRows)}</strong>
                  <span>empty rows skipped</span>
                </div>
              </div>

              {(errors.length > 0 || warnings.length > 0) && (
                <ul className="issue-list">
                  {[...errors, ...warnings].map((i) => (
                    <li key={i.message} className={`notice ${i.level === 'error' ? 'notice--error' : 'notice--warn'}`}>
                      {i.level === 'error' ? <CircleAlert size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {result.rejectedRows.length > 0 && (
                <ul className="details-list" aria-label="Rejected rows">
                  {result.rejectedRows.slice(0, 200).map((r) => (
                    <li key={r.row}>
                      Row {r.row}: {r.reason}
                    </li>
                  ))}
                </ul>
              )}
              {result.duplicates.length > 0 && (
                <ul className="details-list" aria-label="Duplicate IDs">
                  {result.duplicates.slice(0, 200).map((d) => (
                    <li key={d.id}>
                      {d.id}: kept row {d.keptRow}, set aside row{d.skippedRows.length > 1 ? 's' : ''} {d.skippedRows.join(', ')}
                      {d.identical ? ' (identical)' : ' (content differs — review the source)'}
                    </li>
                  ))}
                </ul>
              )}

              {result.records.length > 0 && (
                <div>
                  <p className="field-label">Preview of the first records</p>
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: '24%' }}>Case ID</th>
                        <th style={{ width: '22%' }}>Category</th>
                        <th style={{ width: '20%' }}>Status</th>
                        <th>Complaint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.records.slice(0, 3).map((r) => (
                        <tr key={r.id}>
                          <td className="case-id">{r.id}</td>
                          <td>{r.category ?? <span className="not-recorded">Not recorded</span>}</td>
                          <td>
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="te" lang={r.language === 'en' ? 'en' : 'te'}>
                            {r.complaintText}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!result && !error && (
            <div className="notice notice--info">
              <Info size={16} aria-hidden />
              <span>PDF or scanned documents are not supported yet; Telugu OCR is a planned backend capability.</span>
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
            disabled={!result || result.records.length === 0}
            onClick={() => result && onUse(result)}
          >
            Use imported dataset{result && result.records.length > 0 ? ` (${formatCount(result.records.length)})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
