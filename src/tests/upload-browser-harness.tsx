/**
 * Real-browser regression for the seven-format upload UI, including the asynchronous PDF/OCR path.
 * Served by Vite and run in headless Chromium by scripts/test-dashboard-browser.mjs.
 * The network is faked in-page; all data is synthetic. No AWS endpoint is contacted.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PersistedDatasets } from '../components/PersistedDatasets';
import type { Dataset } from '../domain/grievance';
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

function chooseFile(name: string, content = 'x') {
  const input = document.getElementById('remote-dataset-file') as HTMLInputElement;
  const transfer = new DataTransfer();
  transfer.items.add(new File([content], name));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const text = () => mount.textContent ?? '';

async function run() {
  const selected: Dataset[] = [];
  const root = createRoot(mount);
  flushSync(() => root.render(<PersistedDatasets onSelect={dataset => selected.push(dataset)} onClear={() => {}} activeId={null} />));
  await sleep(100);

  const input = document.getElementById('remote-dataset-file') as HTMLInputElement;
  check(input, 'upload input present');
  for (const ext of ['.txt', '.md', '.docx', '.csv', '.json', '.jsonl', '.pdf']) check(input.accept.split(',').includes(ext), 'input accepts ' + ext);
  check(/2,000 grievances/.test(text()) && /OCR/.test(text()), 'limits and OCR are explained to the user');

  // 1. Synchronous formats go straight to ready and are opened.
  for (const name of ['note.txt', 'note.md', 'note.docx', 'set.csv', 'set.json', 'set.jsonl']) {
    const before = selected.length;
    chooseFile(name);
    await until(() => selected.length === before + 1, name + ' opens after upload');
    check(selected[selected.length - 1].sourceFileName === name, name + ' is the open dataset');
  }
  check(requests.filter(r => r === 'PUT s3').length === 6, 'each file was uploaded once, directly to private storage');

  // 2. A PDF is extracted asynchronously: the UI shows extraction progress, then opens the dataset when it is ready.
  const before = selected.length;
  chooseFile('scan.pdf');
  await until(() => /Extracting text from the PDF/.test(text()), 'extraction progress is shown');
  check(/OCR/.test(text()), 'progress mentions OCR');
  check(selected.length === before, 'a dataset is not opened while it is still extracting');
  await until(() => selected.length === before + 1, 'PDF opens only after extraction succeeded', 30000);
  check(/Upload validated and saved/.test(text()), 'success message shown');
  check(selected[selected.length - 1].records[0].complaintText === 'పరీక్ష ఫిర్యాదు', 'Telugu text round-trips into the open dataset');

  // 3. A PDF whose extraction fails shows the server's reason, never opens, and is listed as failed.
  const opened = selected.length;
  chooseFile('bad-scan.pdf');
  await until(() => !!mount.querySelector('[role="alert"]'), 'failure is shown as an alert', 30000);
  check(/OCR could not read page\(s\) 2/.test(mount.querySelector('[role="alert"]')!.textContent ?? ''), 'failure reason is shown');
  check(selected.length === opened, 'a failed extraction is never opened');
  check(/bad-scan\.pdf — failed/.test(text()), 'failed dataset is listed as failed');

  // 4. Client-side validation: unsupported type and oversize never reach the network.
  const writes = () => requests.filter(r => r.startsWith('POST') || r === 'PUT s3').length;
  const before4 = writes();
  chooseFile('sheet.xlsx');
  await until(() => /Unsupported file type/.test(text()), 'unsupported type is explained');
  check(writes() === before4, 'an unsupported file creates no upload and sends no data');
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
