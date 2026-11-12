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

describe('asynchronous PDF extraction in the upload client', () => {
  const ds = (status: string, extra: object = {}) => ({ id: 'd', name: 'a.pdf', format: 'pdf', status, bytes: 3, recordCount: 0, createdAt: '', error: null, ...extra });
  const script = (...lists: unknown[][]) => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd' }, upload: { url: 'https://private-s3.invalid/put', headers: {} } }, 201))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(jsonResponse({ dataset: ds('extracting') }, 202));
    for (const l of lists) f.mockResolvedValueOnce(jsonResponse({ datasets: l }));
    return f;
  };
  it('polls the list until the dataset is ready and reports progress; ready is returned only afterwards', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://x' } });
    const f = script([ds('extracting')], [ds('extracting')], [ds('ready', { recordCount: 1 })]);
    vi.stubGlobal('fetch', f);
    const steps: string[] = [];
    const done = await uploadDataset(new File(['xyz'], 'a.pdf'), s => steps.push(s), { pollMs: 1 });
    expect(done.status).toBe('ready');
    expect(f.mock.calls.filter(c => c[0] === '/api/datasets').length).toBe(3);
    expect(steps.filter(s => s.startsWith('Extracting text from the PDF')).length).toBe(3);
  });
  it('surfaces the server’s reason when extraction fails, and never returns a dataset', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://x' } });
    vi.stubGlobal('fetch', script([ds('failed', { error: 'The PDF is password-protected. Remove the password and upload it again.' })]));
    await expect(uploadDataset(new File(['xyz'], 'a.pdf'), () => {}, { pollMs: 1 })).rejects.toThrow('password-protected');
  });
  it('stops waiting after the maximum wait and says extraction continues in the background', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://x' } });
    vi.stubGlobal('fetch', script([ds('extracting')], [ds('extracting')], [ds('extracting')]));
    await expect(uploadDataset(new File(['xyz'], 'a.pdf'), () => {}, { pollMs: 5, maxWaitMs: 8 })).rejects.toThrow(/continues in the background/);
  });
  it('reports a dataset deleted during extraction', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://x' } });
    vi.stubGlobal('fetch', script([]));
    await expect(uploadDataset(new File(['xyz'], 'a.pdf'), () => {}, { pollMs: 1 })).rejects.toThrow(/removed during extraction/);
  });
  it('non-PDF formats never poll', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://x' } });
    const f = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ dataset: { id: 'd' }, upload: { url: 'https://private-s3.invalid/put', headers: {} } }, 201))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(jsonResponse({ dataset: ds('ready', { format: 'docx' }) }));
    vi.stubGlobal('fetch', f);
    expect((await uploadDataset(new File(['xyz'], 'a.docx'), () => {})).status).toBe('ready');
    expect(f).toHaveBeenCalledTimes(3);
  });
});
