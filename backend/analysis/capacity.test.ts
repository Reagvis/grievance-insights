import { describe, expect, it, vi } from 'vitest';
import type { DatasetStore, Metadata, PrivateObjects } from '../datasets/core';
import { validateDataset } from '../datasets/core';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { createAnalysisWorker, type Inference, type Job, type JobQueue, type JobStore, type ResultObjects } from './core';
import { aggregate, validateModelOutput, type RecordOutcome, type Report } from './schema';

const timestamp = '2026-11-12T00:00:00.000Z';
const makeId = (i: number) => 'GR-' + String(i).padStart(5, '0');
const csv = 'id,complaintText,responseText\n' +
  Array.from({ length: 2000 }, (_, i) => makeId(i) + ',మా గ్రామంలో నీటి సరఫరా లేదు,పరిశీలిస్తున్నాము').join('\n');
const bytes = new TextEncoder().encode(csv);
const id = '12345678-abcd-4f12-9abc-123456789abc';

function fixture(datasetId = id) {
  const dataset: Metadata = {
    id: datasetId, key: 'raw/' + datasetId + '/source.csv', name: 'capacity.csv', format: 'csv',
    status: 'ready', ownerId: 'admin', createdAt: timestamp, bytes: bytes.byteLength,
    recordCount: 2000, uploadExpiresAt: 0,
  };
  const objects: PrivateObjects = {
    read: vi.fn(async () => bytes), size: vi.fn(async () => bytes.length),
    presign: vi.fn(), remove: vi.fn(),
  };
  const datasets: DatasetStore = {
    get: vi.fn(async () => dataset), session: vi.fn(), create: vi.fn(),
    list: vi.fn(), transition: vi.fn(), delete: vi.fn(),
  };
  let current: Job = {
    id: datasetId, datasetId, ownerId: 'admin', status: 'queued', expiresAt: 1900000000,
    createdAt: timestamp, startedAt: null, finishedAt: null, cursor: 0, total: 2000,
    failureCount: 0, attempt: 0, resultsKey: null, error: null,
    modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1', promptVersion: 'te-grievance-response-v1',
  };
  const jobs: JobStore = {
    get: vi.fn(async () => ({ ...current })), create: vi.fn(),
    start: vi.fn(async () => { if (current.status === 'queued') current.status = 'running'; }),
    checkpoint: vi.fn(async (_id, expected, failed) => {
      if (current.cursor !== expected || current.status !== 'running') return false;
      current.cursor++; current.failureCount += Number(failed);
      return true;
    }),
    complete: vi.fn(async (_id, key) => {
      if (current.cursor !== current.total) throw new Error('Premature completion');
      current.status = 'completed'; current.resultsKey = key;
    }),
    fail: vi.fn(async (_id, code) => { current.status = 'failed'; current.error = code; }),
    retry: vi.fn(async () => { if (current.status !== 'failed') return false; current.status = 'queued'; current.attempt++; current.error = null; return true; }),
  };
  const queue: JobQueue = { send: vi.fn(async () => {}) };
  const stored = new Map<number, RecordOutcome>();
  let report: Report | null = null;
  const results: ResultObjects = {
    readRecord: vi.fn(async (_id, index) => stored.get(index) ?? null),
    writeRecord: vi.fn(async (_id, index, outcome) => { if (!stored.has(index)) stored.set(index, outcome); }),
    writeReport: vi.fn(async (_id, value) => { report = value; return 'analyses/' + datasetId + '/report.json'; }),
    readReport: vi.fn(async () => { if (!report) throw new Error('Report missing'); return report; }),
  };
  let requests = 0;
  const model: Inference = {
    analyze: vi.fn(async (record: GrievanceRecord) => {
      requests++;
      return validateModelOutput({
        id: record.id, complaintSummary: 'నీటి సరఫరా లేదు.', category: 'water',
        issueClassification: null, requestedAction: null, potentiallyUrgent: false, urgencyReason: null,
        complaintEvidence: 'నీటి సరఫరా లేదు', responseSummary: 'పరిశీలిస్తున్నారు.',
        departmentClaim: null, responseRelevance: 'inconclusive',
        responseAssessment: 'ఫలితం ధృవీకరించబడలేదు.', responseEvidence: 'పరిశీలిస్తున్నాము',
        verifiedOutcome: null, verificationStatus: 'not_verified',
      }, record);
    }),
  };
  const worker = createAnalysisWorker(datasets, objects, jobs, queue, results, model);
  return { dataset, objects, datasets, jobs, queue, results, stored, model, worker,
    current: () => current, requests: () => requests, report: () => report };
}
describe('2,000-record mocked Bedrock capacity and recovery', () => {
  it('accepts 2,000 exact-source Telugu grievances and rejects 2,001', () => {
    const records = validateDataset('capacity.csv', 'csv', bytes);
    expect(records).toHaveLength(2000);
    expect(records[1999].id).toBe(makeId(1999));
    const extra = new TextEncoder().encode(csv + '\nGR-2000,అదనపు ఫిర్యాదు,');
    expect(() => validateDataset('capacity.csv', 'csv', extra)).toThrow();
  });
  it('completes all 2,000 mocked inferences with durable checkpoints and faithful evidence', async () => {
    const f = fixture();
    let messages = 0;
    while (f.current().status !== 'completed' && messages < 700) {
      await f.worker(id, false, 0);
      messages++;
    }
    const report = f.report();
    expect(f.current()).toMatchObject({ status: 'completed', cursor: 2000, failureCount: 0 });
    expect(f.requests()).toBe(2000);
    expect(messages).toBe(Math.ceil(2000 / 3));
    expect(f.stored.size).toBe(2000);
    expect(report?.stats).toMatchObject({ grievances: 2000, analyzed: 2000, failed: 0, withResponses: 2000 });
    expect(report?.outcomes).toHaveLength(2000);
    expect(report?.outcomes[1999].id).toBe(makeId(1999));
    expect(report?.outcomes[0].analysis?.complaintEvidence).toBe('నీటి సరఫరా లేదు');
    expect(report?.outcomes[0].analysis?.verificationStatus).toBe('not_verified');
    await f.worker(id, false, 0);
    expect(f.requests()).toBe(2000);
    expect(aggregate(id, id, validateDataset('capacity.csv', 'csv', bytes), report!.outcomes, timestamp).stats.analyzed).toBe(2000);
  }, 120000);
  it('restarts from persisted checkpoint after queue delivery failure without duplicate model calls', async () => {
    const f = fixture();
    vi.mocked(f.queue.send).mockRejectedValueOnce(new Error('SQS unavailable'));
    await expect(f.worker(id, false, 0)).rejects.toThrow('SQS unavailable');
    expect(f.current().cursor).toBe(3);
    expect(f.requests()).toBe(3);
    await f.worker(id, false, 0);
    expect(f.current().cursor).toBe(6);
    expect(f.requests()).toBe(6);
  });
  it('fences stale dead-letter attempts after retry', async () => {
    const f = fixture();
    await f.worker(id, true, 0);
    expect(f.current().error).toBe('retries_exhausted');
    expect(await f.jobs.retry(id)).toBe(true);
    await f.worker(id, true, 0);
    expect(f.current().status).toBe('queued');
    await f.worker(id, false, 1);
    expect(f.current().cursor).toBe(3);
    expect(f.requests()).toBe(3);
  });
  it('permits concurrent independent jobs while serializing each job cursor', async () => {
    const one = fixture(id);
    const twoId = '22345678-abcd-4f12-9abc-123456789abc';
    const two = fixture(twoId);
    await Promise.all([one.worker(id, false, 0), two.worker(twoId, false, 0)]);
    expect(one.current().cursor).toBe(3);
    expect(two.current().cursor).toBe(3);
    expect(one.requests() + two.requests()).toBe(6);
  });
});
