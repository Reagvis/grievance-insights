import { afterEach, describe, expect, it, vi } from 'vitest';
import { listDatasets, openDataset, removeDataset, uploadDataset } from '../services/datasetApi';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const jsonResponse = (body: unknown, status = 200) => ({ status, ok: status < 400, json: async () => body });
describe('AWS authenticated dataset frontend client', () => {
  it('uploads through the presigned private S3 URL then finalizes, preserving Telugu', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://telangana-gov-pilot.reagvis.com' } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'server-id' }, upload: { url: 'https://private-s3.invalid/put', headers: { 'content-type': 'text/csv', 'if-none-match': '*' } } }, 201))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'server-id', status: 'ready' } }));
    vi.stubGlobal('fetch', fetcher);
    const file = new File(['id,complaintText\n1,మంచినీరు లేదు'], 'test.csv', { type: 'text/csv' });
    const steps: string[] = [];
    const uploaded = await uploadDataset(file, step => steps.push(step));
    expect(uploaded.status).toBe('ready');
    expect(fetcher.mock.calls.map(x => x[0])).toEqual(['/api/datasets/uploads', 'https://private-s3.invalid/put', '/api/datasets/server-id/finalize']);
    expect(fetcher.mock.calls[1][1].credentials).toBe('omit');
    expect(fetcher.mock.calls[1][1].body).toBe(file);
    expect(steps).toHaveLength(3);
  });
  it('lists and loads server-validated records for selection', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ datasets: [{ id: 'd1', status: 'ready' }] }))
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd1' }, records: [{ id: 'one', complaintText: 'విద్యుత్ లేదు' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect((await listDatasets())[0].id).toBe('d1');
    expect((await openDataset('d1')).records?.[0].complaintText).toBe('విద్యుత్ లేదు');
    expect(fetcher.mock.calls[1][1].credentials).toBe('same-origin');
  });
  it('requires confirmation at UI layer, then issues the authenticated DELETE', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://telangana-gov-pilot.reagvis.com' } });
    const fetcher = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', fetcher);
    await removeDataset('d1');
    expect(fetcher).toHaveBeenCalledWith('/api/datasets/d1', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }));
  });
  it('does not expose an unauthenticated fallback if the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required.' }, 401)));
    await expect(listDatasets()).rejects.toThrow('session has expired');
  });
});
describe('seven-format upload client', () => {
  const origin = { location: { origin: 'https://telangana-gov-pilot.reagvis.com' } };
  const ok = () => vi.fn()
    .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd' }, upload: { url: 'https://private-s3.invalid/put', headers: { 'if-none-match': '*' } } }, 201))
    .mockResolvedValueOnce({ ok: true, status: 200 })
    .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd', status: 'ready' } }));
  it.each(['a.txt', 'a.md', 'a.docx', 'a.csv', 'a.json', 'a.jsonl', 'a.pdf', 'UPPER.PDF'])('accepts %s and sends its real byte size', async (name) => {
    vi.stubGlobal('window', origin);
    const fetcher = ok();
    vi.stubGlobal('fetch', fetcher);
    await uploadDataset(new File(['xyz'], name), () => {});
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ name, bytes: 3 });
  });
  it('rejects unsupported types, empty files and per-format oversize before any network call', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(uploadDataset(new File(['x'], 'a.xlsx'), () => {})).rejects.toThrow(/Unsupported file type/);
    await expect(uploadDataset(new File([], 'a.txt'), () => {})).rejects.toThrow(/empty/);
    await expect(uploadDataset(new File([new Uint8Array(1024 * 1024 + 1)], 'a.txt'), () => {})).rejects.toThrow(/at most 1 MiB/);
    await expect(uploadDataset(new File([new Uint8Array(6 * 1024 * 1024)], 'a.docx'), () => {})).rejects.toThrow(/at most 5 MiB/);
    await expect(uploadDataset(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.pdf'), () => {})).rejects.toThrow(/at most 10 MiB/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('announces extraction for documents that need it', async () => {
    vi.stubGlobal('window', origin);
    vi.stubGlobal('fetch', ok());
    const steps: string[] = [];
    await uploadDataset(new File(['x'], 'a.pdf'), (s) => steps.push(s));
    expect(steps.at(-1)).toBe('Extracting text and validating…');
  });
});
