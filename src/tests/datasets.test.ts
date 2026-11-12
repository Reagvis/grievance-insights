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
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd1', recordCount: 1 }, records: [{ id: 'one', complaintText: 'విద్యుత్ లేదు' }], nextCursor: null }));
    vi.stubGlobal('fetch', fetcher);
    expect((await listDatasets())[0].id).toBe('d1');
    expect((await openDataset('d1')).records?.[0].complaintText).toBe('విద్యుత్ లేదు');
    expect(fetcher.mock.calls[1][1].credentials).toBe('same-origin');
    expect(fetcher.mock.calls[1][0]).toBe('/api/datasets/d1?cursor=0');
  });
  it('reassembles 2,000 authenticated source records over multiple HTTP pages', async () => {
    const records = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), complaintText: 'మంచినీరు లేదు' }));
    const fetcher = vi.fn().mockImplementation(async (path: string) => {
      const cursor = Number(new URL(path, 'https://example.invalid').searchParams.get('cursor') ?? 0);
      return jsonResponse({ dataset: { id: 'd1', recordCount: 2000 },
        records: records.slice(cursor, cursor + 50), nextCursor: cursor + 50 < 2000 ? cursor + 50 : null });
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await openDataset('d1');
    expect(response.records).toHaveLength(2000);
    expect(response.records?.[1999]).toEqual(records[1999]);
    expect(fetcher).toHaveBeenCalledTimes(40);
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