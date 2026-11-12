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
    const report = { jobId: 'job', stats: { grievances: 4 }, categories: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(success({ job }))
      .mockResolvedValueOnce(success({ job, report }));
    vi.stubGlobal('fetch', fetcher);
    expect((await readAnalysis('job')).status).toBe('completed');
    expect((await readAnalysisResults('job')).report.stats.grievances).toBe(4);
    expect(fetcher.mock.calls[1][0]).toBe('/api/analyses/job/results');
  });
  it('rejects unauthorized access with no fabricated fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(readAnalysisResults('unowned')).rejects.toThrow('Forbidden');
  });
});