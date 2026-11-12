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
  it('rejects unauthorized access with no fabricated fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(readAnalysisResults('unowned')).rejects.toThrow('Forbidden');
  });
});