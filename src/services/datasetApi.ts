import { signalAuthExpired } from './authApi';
import type { GrievanceRecord } from '../domain/grievance';
import { formatFromName, LIMITS, SOURCE_FORMATS, type SourceFormat } from '../domain/sourceFormats';

export type RemoteDataset = { id: string; name: string; format: SourceFormat; status: 'pending_upload' | 'validating' | 'extracting' | 'ready' | 'failed'; bytes: number; recordCount: number; createdAt: string; error: string | null };
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 401) { signalAuthExpired(); throw new Error('Your session has expired. Sign in again.'); }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? 'Dataset request failed.');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export async function listDatasets() { return (await api<{ datasets: RemoteDataset[] }>('/api/datasets')).datasets; }
export async function openDataset(id: string) {
  const path = '/api/datasets/' + encodeURIComponent(id);
  let cursor: number | null = 0;
  let dataset: RemoteDataset | null = null;
  const records: GrievanceRecord[] = [];
  while (cursor !== null) {
    const page: { dataset: RemoteDataset; records: GrievanceRecord[] | null; nextCursor?: number | null } =
      await api(path + '?cursor=' + cursor);
    if (page.dataset.id !== id || dataset && page.dataset.recordCount !== dataset.recordCount) {
      throw new Error('Dataset changed during retrieval.');
    }
    dataset = page.dataset;
    if (page.records === null) return { dataset, records: null };
    if (page.records.length > 50 || page.nextCursor != null &&
        (page.nextCursor !== cursor + page.records.length || page.nextCursor > 2000)) {
      throw new Error('Invalid dataset pagination.');
    }
    records.push(...page.records);
    cursor = page.nextCursor ?? null;
  }
  if (!dataset || records.length !== dataset.recordCount) throw new Error('Incomplete dataset retrieval.');
  return { dataset, records };
}
export async function removeDataset(id: string) { await api('/api/datasets/' + encodeURIComponent(id), { method: 'DELETE', headers: { Origin: window.location.origin } }); }
/** PDFs are extracted asynchronously (text layer + OCR). The browser polls until the dataset is ready or failed. */
export type UploadOptions = { pollMs?: number; maxWaitMs?: number };
async function waitForExtraction(id: string, first: RemoteDataset, onStep: (step: string) => void, { pollMs = 3000, maxWaitMs = 20 * 60 * 1000 }: UploadOptions): Promise<RemoteDataset> {
  const started = Date.now();
  let dataset = first;
  while (dataset.status === 'extracting') {
    if (Date.now() - started > maxWaitMs) throw new Error('Extraction is taking longer than expected. It continues in the background; refresh the list in a few minutes.');
    onStep('Extracting text from the PDF (scanned pages are read by OCR and can take a few minutes)… ' + Math.round((Date.now() - started) / 1000) + ' s');
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const found = (await listDatasets()).find(item => item.id === id);
    if (!found) throw new Error('The dataset was removed during extraction.');
    dataset = found;
  }
  if (dataset.status === 'failed') throw new Error(dataset.error ?? 'Extraction failed.');
  return dataset;
}
export async function uploadDataset(file: File, onStep: (step: string) => void, options: UploadOptions = {}): Promise<RemoteDataset> {
  const format = formatFromName(file.name);
  if (!format) throw new Error('Unsupported file type. Choose ' + SOURCE_FORMATS.map(f => '.' + f).join(', ') + '.');
  if (!file.size) throw new Error('The selected file is empty.');
  if (file.size > LIMITS.bytes[format]) throw new Error('A .' + format + ' file can be at most ' + Math.round(LIMITS.bytes[format] / 1048576) + ' MiB.');
  onStep('Requesting secure upload…');
  const response = await api<{ dataset: RemoteDataset; upload: { url: string; headers: Record<string, string> } }>('/api/datasets/uploads', {
    method: 'POST', body: JSON.stringify({ name: file.name, bytes: file.size }), headers: { Origin: window.location.origin },
  });
  onStep('Uploading to private storage…');
  const put = await fetch(response.upload.url, { method: 'PUT', headers: response.upload.headers, body: file, credentials: 'omit' });
  if (!put.ok) throw new Error('Private storage upload failed (' + put.status + '). Delete the pending dataset and retry.');
  onStep(format === 'pdf' || format === 'docx' ? 'Extracting text and validating…' : 'Validating uploaded records…');
  const finalized = (await api<{ dataset: RemoteDataset }>('/api/datasets/' + response.dataset.id + '/finalize', {
    method: 'POST', body: '{}', headers: { Origin: window.location.origin },
  })).dataset;
  return finalized.status === 'extracting' ? waitForExtraction(response.dataset.id, finalized, onStep, options) : finalized;
}
