import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GrievanceRecord } from '../domain/grievance';
import { loadAllComplaints, mergeComplaints } from '../services/allComplaints';
import type { RemoteDataset } from '../services/datasetApi';

const rec = (id: string, text = 'complaint ' + id): GrievanceRecord => ({
  id, complaintText: text, responseText: null, language: 'en', category: null, issueType: null, department: null, district: null,
  submittedAt: null, respondedAt: null, status: 'unknown', sourceType: 'csv', isSyntheticDemo: false,
});
const file = (id: string, name: string, createdAt: string, status: RemoteDataset['status'] = 'ready', n = 1): RemoteDataset =>
  ({ id, name, format: 'csv', status, bytes: 10, recordCount: n, createdAt, error: null });

describe('merging every uploaded file into one complaints list', () => {
  it('keeps every complaint, files in the order given, and remembers each complaint’s source file', () => {
    const a = file('a', 'new.csv', '2026-02-01'), b = file('b', 'old.csv', '2026-01-01');
    const m = mergeComplaints([{ dataset: a, records: [rec('N-1'), rec('N-2')] }, { dataset: b, records: [rec('O-1')] }]);
    expect(m.records.map((r) => r.id)).toEqual(['N-1', 'N-2', 'O-1']);
    expect(m.sourceOf.get('N-2')).toEqual({ datasetId: 'a', fileName: 'new.csv', fileRecordCount: 2, addedAt: '2026-02-01' });
    expect(m.sourceOf.get('O-1')).toEqual({ datasetId: 'b', fileName: 'old.csv', fileRecordCount: 1, addedAt: '2026-01-01' });
    expect(m.recordsByDataset.get('a')!.map((r) => r.id)).toEqual(['N-1', 'N-2']);
  });
  it('never drops or overwrites a repeated ID: the later file’s copy is renamed with its file name', () => {
    const a = file('a', 'jan.csv', '2026-02-01'), b = file('b', 'feb.csv', '2026-01-01'), c = file('c', 'feb.csv', '2025-12-01');
    const m = mergeComplaints([{ dataset: a, records: [rec('X', 'from jan')] }, { dataset: b, records: [rec('X', 'from feb')] }, { dataset: c, records: [rec('X', 'from feb again')] }]);
    expect(m.records.map((r) => r.id)).toEqual(['X', 'X (feb.csv)', 'X (feb.csv #2)']);
    expect(m.records.map((r) => r.complaintText)).toEqual(['from jan', 'from feb', 'from feb again']);
    expect(new Set(m.records.map((r) => r.id)).size).toBe(3);
    expect(m.sourceOf.get('X (feb.csv)')!.datasetId).toBe('b');
    // The original, unrenamed records stay available for per-file AI analysis (whose report is keyed by the stored IDs).
    expect(m.recordsByDataset.get('b')![0].id).toBe('X');
  });
  it('merging nothing gives an empty list', () => {
    expect(mergeComplaints([]).records).toEqual([]);
  });
});

describe('loading all complaints from the API', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const json = (body: unknown, status = 200) => ({ status, ok: status < 400, json: async () => body });
  it('lists files newest first, opens only ready ones, and reports files it could not open', async () => {
    const list = [file('o', 'old.csv', '2026-01-01'), file('n', 'new.csv', '2026-03-01'), file('p', 'scan.pdf', '2026-02-01', 'extracting', 0), file('bad', 'bad.csv', '2026-02-15')];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/datasets') return json({ datasets: list });
      const id = /\/api\/datasets\/([a-z]+)\?cursor=0/.exec(url)?.[1];
      if (id === 'bad') return json({ error: 'boom' }, 500);
      return json({ dataset: list.find((f) => f.id === id), records: [rec(id!.toUpperCase() + '-1')], nextCursor: null });
    }));
    const all = await loadAllComplaints();
    expect(all.files.map((f) => f.id)).toEqual(['n', 'bad', 'p', 'o']);
    expect(all.records.map((r) => r.id)).toEqual(['N-1', 'O-1']);
    expect(all.unreadable).toEqual(['bad.csv']);
    expect(all.files.find((f) => f.id === 'p')!.status).toBe('extracting');
    expect(fetch).not.toHaveBeenCalledWith('/api/datasets/p?cursor=0', expect.anything());
  });
  it('no files at all gives an empty list without error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ datasets: [] })));
    const all = await loadAllComplaints();
    expect(all.records).toEqual([]);
    expect(all.files).toEqual([]);
  });
});
