import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalysis, listAnalyses, readAnalysis, readAnalysisResults } from '../services/analysisApi';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const success = (value: unknown, status = 200) => ({ ok: true, status, json: async () => value });
describe('authenticated AWS analysis client', () => {
  it('submits only the server-owned dataset ID and retains a durable queued job', async () => {
    const job = { id: 'job', datasetId: 'dataset', status: 'queued', processed: 0, total: 4 };
    const fetcher = vi.fn().mockResolvedValueOnce(success({ job, alreadyExists: false }, 202))
      .mockResolvedValueOnce(success({ jobs: [job] }));
    vi.stubGlobal('fetch', fetcher);
    expect((await createAnalysis('dataset')).job.status).toBe('queued');
    expect((await listAnalyses('dataset'))[0].id).toBe('job');
    expect(fetcher.mock.calls[0]).toEqual(['/api/datasets/dataset/analyze',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })]);
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  });
  it('fetches live processing status then server-persisted completed results', async () => {
    const job = { id: 'job', datasetId: 'dataset', status: 'completed' };
    const report = { jobId: 'job', datasetId: 'dataset', stats: { grievances: 4 },
      generatedAt: '2026-11-12T00:00:00Z', categories: [],
      outcomes: Array.from({ length: 4 }, (_, i) => ({ id: 'GR-' + i, failure: 'invalid_model_output' })) };
    const fetcher = vi.fn().mockResolvedValueOnce(success({ job }))
      .mockResolvedValueOnce(success({ job, report, nextCursor: null }));
    vi.stubGlobal('fetch', fetcher);
    expect((await readAnalysis('job')).status).toBe('completed');
    expect((await readAnalysisResults('job')).report.stats.grievances).toBe(4);
    expect(fetcher.mock.calls[1][0]).toBe('/api/analyses/job/results?cursor=0');
  });
  it('reassembles ordered pages without silently truncating large results', async () => {
    const job = { id: 'job', datasetId: 'dataset', status: 'completed' };
    const base = { jobId: 'job', datasetId: 'dataset', generatedAt: '2026-11-12',
      stats: { grievances: 101 }, categories: [] };
    const records = Array.from({ length: 101 }, (_, i) => ({ id: String(i), failure: 'invalid_model_output' }));
    const fetcher = vi.fn().mockResolvedValueOnce(success({ job,
      report: { ...base, outcomes: records.slice(0, 100) }, nextCursor: 100 }))
      .mockResolvedValueOnce(success({ job, report: { ...base, outcomes: records.slice(100) }, nextCursor: null }));
    vi.stubGlobal('fetch', fetcher);
    const full = await readAnalysisResults('job');
    expect(full.report.outcomes).toEqual(records);
    expect(fetcher.mock.calls.map(c => c[0])).toEqual(['/api/analyses/job/results?cursor=0',
      '/api/analyses/job/results?cursor=100']);
  });
  it('reassembles all 2,000 long category source IDs without truncation, preserving export metadata', async () => {
    const job = { id: 'job', datasetId: 'dataset', status: 'completed', generation: 0 };
    const ids = Array.from({ length: 2000 }, (_, i) => 'GR-' + String(i).padStart(4, '0') + '-' + 'A'.repeat(1490));
    const outcomes = ids.map(id => ({ id, analysis: { id, category: 'water' } }));
    const category = { category: 'water', count: 2000, summaryTe: 'నీటి సమస్య' };
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const cursor = Number(new URL(url, 'https://example.invalid').searchParams.get('cursor') ?? 0);
      const slice = outcomes.slice(cursor, cursor + 37);
      return success({
        job,
        report: { jobId: job.id, datasetId: job.datasetId, generation: 0, generatedAt: '2026-11-12',
          stats: { grievances: 2000 }, categories: [{ ...category, sourceIds: slice.map(o => o.id) }],
          outcomes: slice },
        nextCursor: cursor + slice.length === 2000 ? null : cursor + slice.length,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const full = await readAnalysisResults('job');
    expect(full.report.outcomes.map(o => o.id)).toEqual(ids);
    expect(full.report.categories).toEqual([{ ...category, sourceIds: ids }]);
    expect(JSON.stringify(full.report).includes(ids[1999])).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(Math.ceil(2000 / 37));
  });
  it('rejects category source IDs leaked from another page', async () => {
    const job = { id: 'job', datasetId: 'dataset', status: 'completed', generation: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success({ job, nextCursor: null,
      report: { jobId: 'job', datasetId: 'dataset', generation: 0, generatedAt: '2026-11-12',
        stats: { grievances: 1 }, outcomes: [{ id: 'A', analysis: { id: 'A', category: 'water' } }],
        categories: [{ category: 'water', count: 1, summaryTe: 'సమస్య', sourceIds: ['B'] }] } })));
    await expect(readAnalysisResults('job')).rejects.toThrow('AI category evidence');
  });
  it('rejects unauthorized access with no fabricated fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(readAnalysisResults('unowned')).rejects.toThrow('Forbidden');
  });
});