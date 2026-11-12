/**
 * Real-browser regression for the upload screen (seven formats, many files at once, asynchronous PDF/OCR path).
 * Served by Vite and run in headless Chromium by scripts/test-dashboard-browser.mjs.
 * The network is faked in-page; all data is synthetic. No AWS endpoint is contacted.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { UploadPage, type BatchResult } from '../components/UploadPage';
import type { RemoteDataset } from '../services/datasetApi';

const mount = document.getElementById('upload-root')!;
const statusNode = document.getElementById('upload-browser-result')!;
let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions++;
  if (!condition) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
async function until(condition: () => unknown, message: string, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (condition()) return; await sleep(50); }
  throw new Error('Timed out: ' + message);
}

// ---- fake backend -------------------------------------------------------------------------------------------
const sets = new Map<string, RemoteDataset & { polls: number; outcome: 'ready' | 'failed' }>();
const requests: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const pub = (d: RemoteDataset) => ({ id: d.id, name: d.name, format: d.format, status: d.status, bytes: d.bytes, recordCount: d.recordCount, createdAt: d.createdAt, error: d.error });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  if (url.startsWith('https://private-s3.invalid')) { requests.push('PUT s3'); return new Response(null, { status: 200 }); }
  if (!url.startsWith('/api/')) return realFetch(input, init);
  requests.push(method + ' ' + url);
  if (method === 'GET' && url === '/api/datasets') {
    // Every list call while a dataset is "extracting" moves it one step closer to its final state.
    for (const d of sets.values()) if (d.status === 'extracting' && ++d.polls >= 2) { d.status = d.outcome; if (d.outcome === 'failed') d.error = 'OCR could not read page(s) 2 reliably (low confidence or no text). The document was not imported.'; else d.recordCount = 1; }
    return json({ datasets: [...sets.values()].map(pub) });
  }
  if (method === 'POST' && url === '/api/datasets/uploads') {
    const body = JSON.parse(String(init?.body)) as { name: string; bytes: number };
    const id = 'd' + (sets.size + 1);
    sets.set(id, { id, name: body.name, format: body.name.split('.').pop() as RemoteDataset['format'], status: 'pending_upload', bytes: body.bytes, recordCount: 0, createdAt: '2026-01-01T00:00:00Z', error: null, polls: 0, outcome: body.name.startsWith('bad') ? 'failed' : 'ready' });
    return json({ dataset: pub(sets.get(id)!), upload: { url: 'https://private-s3.invalid/put', headers: {} } }, 201);
  }
  const finalize = /^\/api\/datasets\/(d\d+)\/finalize$/.exec(url);
  if (method === 'POST' && finalize) {
    const d = sets.get(finalize[1])!;
    if (d.format === 'pdf') { d.status = 'extracting'; return json({ dataset: pub(d) }, 202); }
    d.status = 'ready'; d.recordCount = 1;
    return json({ dataset: pub(d) });
  }
  const open = /^\/api\/datasets\/(d\d+)\?cursor=0$/.exec(url);
  if (method === 'GET' && open) {
    const d = sets.get(open[1])!;
    return json({ dataset: pub(d), records: [{ id: 'T-1', complaintText: 'పరీక్ష ఫిర్యాదు', responseText: null, language: 'te', category: null, issueType: null, department: null, district: null, submittedAt: null, respondedAt: null, status: 'unknown', originalFileName: d.name, sourceType: 'document', isSyntheticDemo: true }], nextCursor: null });
  }
  return json({ error: 'unexpected request ' + method + ' ' + url }, 404);
};

function chooseFiles(names: string[]) {
  const input = document.getElementById('remote-dataset-file') as HTMLInputElement;
  const transfer = new DataTransfer();
  for (const name of names) transfer.items.add(new File(['x'], name));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const text = () => mount.textContent ?? '';

async function run() {
  const batches: BatchResult[] = [];
  let viewAll = 0;
  const root = createRoot(mount);
  flushSync(() => root.render(<UploadPage onBatchDone={(r) => batches.push(r)} onViewAll={() => { viewAll++; }} />));
  await sleep(100);

  const input = document.getElementById('remote-dataset-file') as HTMLInputElement;
  check(input && input.multiple, 'the file input accepts several files at once');
  for (const ext of ['.txt', '.md', '.docx', '.csv', '.json', '.jsonl', '.pdf']) check(input.accept.split(',').includes(ext), 'input accepts ' + ext);
  check(/2,000 complaints/.test(text()) && /OCR/.test(text()), 'limits and OCR are explained to the user');
  check(!mount.querySelector('.dataset-row, .dataset-list'), 'no dataset list on the upload screen');

  // 1. Several files at once, including a PDF that is extracted asynchronously.
  chooseFiles(['note.txt', 'set.csv', 'scan.pdf']);
  await until(() => /Extracting text from the PDF/.test(text()), 'PDF extraction progress is shown');
  check(/OCR/.test(text()), 'progress mentions OCR');
  check(batches.length === 0, 'the batch is not reported finished while the PDF is still extracting');
  await until(() => batches.length === 1, 'batch finishes after the PDF is ready', 40000);
  check(batches[0].files === 3 && batches[0].failed === 0 && batches[0].records === 3, 'all three files were added: ' + JSON.stringify(batches[0]));
  check(mount.querySelectorAll('.upload-result--done').length === 3, 'each file shows as done');
  check(/scan\.pdf/.test(text()) && /1 complaint added/.test(text()), 'per-file result text is shown');
  check(requests.filter(r => r === 'PUT s3').length === 3, 'each file was sent once, directly to private storage');

  // 2. A PDF whose extraction fails shows the server's reason and the batch reports the failure.
  chooseFiles(['bad-scan.pdf']);
  await until(() => batches.length === 2, 'failed batch reported', 40000);
  check(batches[1].failed === 1 && batches[1].files === 0, 'the failure is counted');
  const alert = mount.querySelector('.upload-result--failed [role="alert"]');
  check(alert && /OCR could not read page\(s\) 2/.test(alert.textContent ?? ''), 'the failure reason is shown on the file');
  const before = viewAll;
  const viewButton = [...mount.querySelectorAll('button')].find(b => /View all complaints/.test(b.textContent ?? ''));
  check(viewButton, '"View all complaints" is offered after a batch');
  (viewButton as HTMLButtonElement).click();
  check(viewAll === before + 1, 'View all complaints navigates');

  // 3. Client-side validation: unsupported types never reach the network.
  const writes = () => requests.filter(r => r.startsWith('POST') || r === 'PUT s3').length;
  const w0 = writes();
  chooseFiles(['sheet.xlsx']);
  await until(() => batches.length === 3, 'unsupported file batch reported');
  check(/Unsupported file type/.test(text()), 'unsupported type is explained');
  check(writes() === w0, 'an unsupported file creates no upload and sends no data');
  root.unmount();
}

try {
  await run();
  statusNode.dataset.status = 'passed';
  statusNode.textContent = 'PASS ' + assertions + ' real-browser upload assertions';
} catch (error) {
  statusNode.dataset.status = 'failed';
  statusNode.textContent = error instanceof Error ? error.message : String(error);
}
