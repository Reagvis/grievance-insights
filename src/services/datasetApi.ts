import { signalAuthExpired } from './authApi';
import type { GrievanceRecord } from '../domain/grievance';
import { formatFromName, LIMITS, SOURCE_FORMATS, type SourceFormat } from '../domain/sourceFormats';

export type RemoteDataset = { id: string; name: string; format: SourceFormat; status: 'pending_upload' | 'validating' | 'ready' | 'failed'; bytes: number; recordCount: number; createdAt: string; error: string | null };
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
export async function openDataset(id: string) { return api<{ dataset: RemoteDataset; records: GrievanceRecord[] | null }>('/api/datasets/' + encodeURIComponent(id)); }
export async function removeDataset(id: string) { await api('/api/datasets/' + encodeURIComponent(id), { method: 'DELETE', headers: { Origin: window.location.origin } }); }
export async function uploadDataset(file: File, onStep: (step: string) => void): Promise<RemoteDataset> {
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
  return (await api<{ dataset: RemoteDataset }>('/api/datasets/' + response.dataset.id + '/finalize', {
    method: 'POST', body: '{}', headers: { Origin: window.location.origin },
  })).dataset;
}
