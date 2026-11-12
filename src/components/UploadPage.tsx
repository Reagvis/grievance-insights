import { CircleAlert, CircleCheck, FileUp, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { SOURCE_FORMATS } from '../domain/sourceFormats';
import { uploadDataset } from '../services/datasetApi';

type Item = { key: number; name: string; state: 'waiting' | 'working' | 'done' | 'failed'; step: string; records?: number };
export type BatchResult = { files: number; records: number; failed: number };
const MAX_FILES = 25;

/** The one upload screen: pick or drop files; each is uploaded, extracted and validated; then the app goes to All Complaints. */
export function UploadPage({ onBatchDone, onViewAll }: { onBatchDone: (result: BatchResult) => void; onViewAll: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState('');
  const counter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(files: File[]) {
    if (busy || files.length === 0) return;
    setNotice('');
    const chosen = files.slice(0, MAX_FILES);
    if (files.length > MAX_FILES) setNotice('Only the first ' + MAX_FILES + ' files were taken. Upload the rest afterwards.');
    const batch: Item[] = chosen.map((f) => ({ key: ++counter.current, name: f.name, state: 'waiting', step: 'Waiting…' }));
    setItems(batch);
    setBusy(true);
    const patch = (key: number, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
    let records = 0, failed = 0, done = 0;
    for (let n = 0; n < chosen.length; n++) {
      const { key } = batch[n];
      patch(key, { state: 'working', step: 'Starting…' });
      try {
        const dataset = await uploadDataset(chosen[n], (step) => patch(key, { step }));
        records += dataset.recordCount;
        done++;
        patch(key, { state: 'done', step: dataset.recordCount + (dataset.recordCount === 1 ? ' complaint added' : ' complaints added'), records: dataset.recordCount });
      } catch (error) {
        failed++;
        patch(key, { state: 'failed', step: error instanceof Error ? error.message : 'Upload failed.' });
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    onBatchDone({ files: done, records, failed });
  }

  const finished = !busy && items.length > 0;
  return (
    <main className="main" id="main">
      <div className="main-inner upload-page">
        <div className="intro">
          <h1>Upload complaints</h1>
          <p>Add files and they are read, checked and added to <strong>All Complaints</strong> automatically.</p>
        </div>

        <label
          className={'upload-drop' + (over ? ' is-over' : '') + (busy ? ' is-busy' : '')}
          htmlFor="remote-dataset-file"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void run(Array.from(e.dataTransfer.files)); }}
        >
          <FileUp size={36} aria-hidden />
          <strong>{busy ? 'Working…' : 'Drop files here, or click to choose'}</strong>
          <span>You can select many files at once.</span>
        </label>
        <input
          id="remote-dataset-file"
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept={SOURCE_FORMATS.map((f) => '.' + f).join(',')}
          aria-label="Upload private grievance files"
          disabled={busy}
          onChange={(e) => void run(Array.from(e.target.files ?? []))}
        />

        <p className="upload-formats">
          <strong>One complaint per file:</strong> TXT, MD, DOCX, PDF (scanned PDFs are read by OCR). <strong>Many per file:</strong> CSV, JSON, JSONL, up to 2,000 complaints.
          Limits: PDF 10 MiB and 50 pages, DOCX 5 MiB, TXT/MD 1 MiB, CSV/JSON/JSONL 20 MiB. Files are stored privately in AWS.
        </p>
        {notice && <p role="status" className="datasets-progress">{notice}</p>}

        {items.length > 0 && (
          <ul className="upload-results" aria-label="Upload progress">
            {items.map((item) => (
              <li key={item.key} className={'upload-result upload-result--' + item.state}>
                <span className="upload-result-icon" aria-hidden>
                  {item.state === 'done' ? <CircleCheck size={18} /> : item.state === 'failed' ? <CircleAlert size={18} /> : item.state === 'working' ? <LoaderCircle size={18} className="spin" /> : null}
                </span>
                <span className="upload-result-name">{item.name}</span>
                <span className="upload-result-step" role={item.state === 'failed' ? 'alert' : 'status'}>{item.step}</span>
              </li>
            ))}
          </ul>
        )}
        {finished && (
          <p className="upload-after">
            <button type="button" className="btn btn-primary" onClick={onViewAll}>View all complaints</button>
          </p>
        )}
      </div>
    </main>
  );
}
