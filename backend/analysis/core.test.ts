import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { DatasetStore, Metadata, PrivateObjects, Session } from '../datasets/core';
import { createAnalysisApi, createAnalysisWorker, inferWithRetry, type Job, type JobQueue, type JobStore, type ResultObjects, type Inference } from './core';
import { InvalidModelOutput, validateModelOutput, type RecordOutcome, type Report } from './schema';
import { DynamoJobs } from './aws';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { GrievanceRecord } from '../../src/domain/grievance';

const id = '12345678-abcd-4f12-9abc-123456789abc';
const origin = 'https://telangana-gov-pilot.reagvis.com';
const token = 'A'.repeat(43);
const hash = createHash('sha256').update(token).digest('hex');
const timestamp = new Date('2026-11-12T00:00:00Z');
const csv = 'id,complaintText,responseText\n' + Array.from({ length: 4 }, (_, i) => `GR-${i},మాకు నీరు రావడం లేదు,పరిశీలిస్తున్నాము`).join('\n');
const bytes = new TextEncoder().encode(csv);
const safeResponse = (res: { body?: string }) => JSON.parse(res.body ?? '{}') as Record<string, any>;
function event(method: string, path: string, authenticated = true): APIGatewayProxyEventV2 {
  return {
    headers: { origin }, cookies: authenticated ? ['__Host-grievance_session=' + token] : [],
    requestContext: { http: { method, path } }, isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}
function fixture() {
  const dataset: Metadata = {
    id, key: 'raw/' + id + '/source.csv', name: 'synthetic.csv', format: 'csv', status: 'ready',
    ownerId: 'admin', bytes: bytes.length, recordCount: 4, createdAt: timestamp.toISOString(), uploadExpiresAt: 0,
  };
  const datasets: DatasetStore = {
    session: vi.fn(async (value: string): Promise<Session | undefined> => value === hash ? { userId: 'admin', expiresAt: timestamp.getTime() / 1000 + 100 } : undefined),
    get: vi.fn(async (key: string) => key === id ? dataset : undefined),
    create: vi.fn(), list: vi.fn(async () => []), transition: vi.fn(async () => true), delete: vi.fn(),
  };
  const files: PrivateObjects = {
    read: vi.fn(async () => bytes), size: vi.fn(async () => bytes.length),
    presign: vi.fn(async () => ({ url: '', headers: {} })), remove: vi.fn(),
  };
  let current: Job | undefined;
  const jobs: JobStore = {
    get: vi.fn(async () => current),
    create: vi.fn(async (item: Job) => { if (current) return false; current = item; return true; }),
    start: vi.fn(async (_id: string, at: string) => { if (current && current.status === 'queued') current = { ...current, status: 'running', startedAt: at }; }),
    checkpoint: vi.fn(async (_id: string, expected: number, failed: boolean) => {
      if (!current || current.cursor !== expected || current.status !== 'running') return false;
      current = { ...current, cursor: expected + 1, failureCount: current.failureCount + Number(failed) };
      return true;
    }),
    complete: vi.fn(async (_id: string, key: string, at: string) => {
      if (!current || current.cursor !== current.total) throw new Error('Incorrect finalization');
      current = { ...current, status: 'completed', resultsKey: key, finishedAt: at };
    }),
    fail: vi.fn(async (_id: string, code: string, at: string) => {
      if (current && (current.status === 'queued' || current.status === 'running')) current = { ...current, status: 'failed', error: code, finishedAt: at };
    }),
  };
  const queue: JobQueue = { send: vi.fn(async () => {}) };
  const stored = new Map<number, RecordOutcome>();
  let report: Report | undefined;
  const results: ResultObjects = {
    readRecord: vi.fn(async (_id, index) => stored.get(index) ?? null),
    writeRecord: vi.fn(async (_id, index, value) => { if (!stored.has(index)) stored.set(index, value); }),
    writeReport: vi.fn(async () => { report = reportValue(); return 'analyses/' + id + '/report.json'; }),
    readReport: vi.fn(async () => report ?? reportValue()),
  };
  function reportValue(): Report {
    return { jobId: id, datasetId: id, modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1',
      promptVersion: 'te-grievance-response-v1', generatedAt: timestamp.toISOString(),
      stats: { grievances: 4, analyzed: 4, failed: 0, categoryCounts: { water: 4, pension: 0, roads: 0,
        electricity: 0, sanitation: 0, healthcare: 0, ration: 0, land: 0, education: 0,
        public_safety: 0, other: 0 }, potentiallyUrgent: 0, withResponses: 4,
        responsesRelevant: 0, responsesInsufficient: 0, responsesInconclusive: 4 },
      categories: [], outcomes: [...stored.values()] };
  }
  const model: Inference = { analyze: vi.fn(async (record: GrievanceRecord) => validateModelOutput({
    id: record.id, complaintSummary: 'నీటి సరఫరా లేదు.', category: 'water',
    issueClassification: null, requestedAction: null, potentiallyUrgent: false, urgencyReason: null,
    complaintEvidence: 'నీరు రావడం లేదు', responseSummary: 'పరిశీలనలో ఉందని చెప్పారు.',
    departmentClaim: null, responseRelevance: 'inconclusive',
    responseAssessment: 'ఆధారాలు సరిపోవడం లేదు.', responseEvidence: 'పరిశీలిస్తున్నాము',
    verifiedOutcome: null, verificationStatus: 'not_verified',
  }, record)) };
  const api = createAnalysisApi(datasets, files, jobs, queue, results, origin, () => timestamp);
  const worker = createAnalysisWorker(datasets, files, jobs, queue, results, model, () => timestamp);
  return { dataset, datasets, files, jobs, queue, results, model, api, worker, stored, current: () => current };
}
describe('authenticated asynchronous job API', () => {
  it('checks current session on all four routes and hides other owners', async () => {
    const f = fixture();
    const paths = [['POST','/api/datasets/' + id + '/analyze'],['GET','/api/datasets/' + id + '/analyses'],
      ['GET','/api/analyses/' + id],['GET','/api/analyses/' + id + '/results']];
    for (const [method, path] of paths) expect((await f.api(event(method, path, false))).statusCode).toBe(401);
    expect(f.jobs.get).not.toHaveBeenCalled();
    f.dataset.ownerId = 'another-user';
    for (const [method, path] of paths) expect((await f.api(event(method, path))).statusCode).toBe(404);
  });
  it('enqueues one job and returns existing job for duplicate submission', async () => {
    const f = fixture();
    expect((await f.api(event('POST','/api/datasets/' + id + '/analyze'))).statusCode).toBe(202);
    const duplicate = await f.api(event('POST','/api/datasets/' + id + '/analyze'));
    expect(duplicate.statusCode).toBe(200);
    expect(safeResponse(duplicate).alreadyExists).toBe(true);
    expect(f.queue.send).toHaveBeenCalledTimes(1);
    expect(safeResponse(await f.api(event('GET','/api/datasets/' + id + '/analyses'))).jobs[0].status).toBe('queued');
    expect((await f.api(event('GET','/api/analyses/' + id + '/results'))).statusCode).toBe(409);
  });
  it('rejects non-ready and oversized datasets', async () => {
    const f = fixture();
    f.dataset.status = 'failed';
    expect((await f.api(event('POST','/api/datasets/' + id + '/analyze'))).statusCode).toBe(409);
  });
  it('fails job if queue handoff fails', async () => {
    const f = fixture();
    vi.mocked(f.queue.send).mockRejectedValueOnce(new Error('temporary SQS failure'));
    expect((await f.api(event('POST','/api/datasets/' + id + '/analyze'))).statusCode).toBe(503);
    expect(f.current()?.status).toBe('failed');
  });
});
describe('checkpointed worker and bounded retries', () => {
  it('processes multiple FIFO chunks, checkpoints and returns persisted report', async () => {
    const f = fixture();
    await f.api(event('POST','/api/datasets/' + id + '/analyze'));
    await f.worker(id);
    expect(f.current()?.status).toBe('running');
    expect(f.current()?.cursor).toBe(3);
    expect(f.queue.send).toHaveBeenCalledTimes(2);
    await f.worker(id);
    expect(f.current()?.status).toBe('completed');
    expect(f.current()?.cursor).toBe(4);
    expect(f.model.analyze).toHaveBeenCalledTimes(4);
    const payload = await f.api(event('GET','/api/analyses/' + id + '/results'));
    expect(payload.statusCode).toBe(200);
    expect(safeResponse(payload).job.status).toBe('completed');
    await f.worker(id);
    expect(f.model.analyze).toHaveBeenCalledTimes(4);
  });
  it('aborts processing when the dataset disappears and can mark DLQ exhaustion', async () => {
    const f = fixture();
    await f.api(event('POST','/api/datasets/' + id + '/analyze'));
    f.dataset.status = 'failed';
    await f.worker(id);
    expect(f.current()?.error).toBe('dataset_unavailable');
    expect(f.model.analyze).not.toHaveBeenCalled();
    const second = fixture();
    await second.api(event('POST','/api/datasets/' + id + '/analyze'));
    await second.worker(id, true);
    expect(second.current()?.error).toBe('retries_exhausted');
  });
  it('retries throttling twice and then lets SQS redrive without checkpointing', async () => {
    const f = fixture();
    await f.api(event('POST','/api/datasets/' + id + '/analyze'));
    vi.mocked(f.model.analyze).mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    await expect(f.worker(id)).rejects.toThrow('throttled');
    expect(f.current()?.cursor).toBe(0);
    expect(f.model.analyze).toHaveBeenCalledTimes(2);
  });
  it('records a per-record failure for repeated invalid output rather than inventing an answer', async () => {
    const f = fixture();
    await f.api(event('POST','/api/datasets/' + id + '/analyze'));
    vi.mocked(f.model.analyze).mockRejectedValueOnce(new Error('bad JSON')).mockRejectedValueOnce(new Error('bad JSON'));
    await f.worker(id);
    expect(f.current()?.failureCount).toBe(1);
    expect(f.stored.get(0)?.failure).toBe('model_request_failed');
  });
  it('limits retry attempts without actual Bedrock calls', async () => {
    const model: Inference = { analyze: vi.fn().mockRejectedValue(new Error('invalid')) };
    const sleep = vi.fn(async () => {});
    expect(await inferWithRetry(model, { id: 'abc' } as GrievanceRecord, sleep)).toEqual({ id: 'abc', failure: 'model_request_failed' });
    expect(model.analyze).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
describe('terminal failures, idempotent checkpoints and dead letters', () => {
  it('marks a job failed if all four model outputs are invalid, retaining exact failure counts', async () => {
    const f = fixture();
    await f.api(event('POST', '/api/datasets/' + id + '/analyze'));
    vi.mocked(f.model.analyze).mockRejectedValue(new InvalidModelOutput('malformed synthetic output'));
    await f.worker(id);
    expect(f.current()?.cursor).toBe(3);
    expect(f.current()?.failureCount).toBe(3);
    await f.worker(id);
    expect(f.current()).toMatchObject({ status: 'failed', error: 'all_records_failed', cursor: 4, failureCount: 4 });
    expect(f.stored.size).toBe(4);
    expect([...f.stored.values()].every(v => v.failure === 'invalid_model_output')).toBe(true);
    expect(f.results.writeReport).not.toHaveBeenCalled();
    expect((await f.api(event('GET', '/api/analyses/' + id + '/results'))).statusCode).toBe(409);
  });
  it('retries after conditional DynamoDB checkpoint rejection without duplicating model inference', async () => {
    const f = fixture();
    await f.api(event('POST', '/api/datasets/' + id + '/analyze'));
    vi.mocked(f.jobs.checkpoint).mockResolvedValueOnce(false);
    await f.worker(id);
    expect(f.current()?.cursor).toBe(0);
    expect(f.stored.has(0)).toBe(true);
    await f.worker(id);
    expect(f.current()?.cursor).toBe(3);
    await f.worker(id);
    expect(f.current()?.status).toBe('completed');
    expect(f.model.analyze).toHaveBeenCalledTimes(4);
  });
  it('uses the immutable S3 outcome after a conditional-write conflict when counting failures', async () => {
    const f = fixture();
    await f.api(event('POST', '/api/datasets/' + id + '/analyze'));
    f.stored.set(0, { id: 'GR-0', failure: 'invalid_model_output' });
    vi.mocked(f.results.readRecord).mockResolvedValueOnce(null); // checkpoint appears between GET and PUT
    await f.worker(id);
    expect(f.current()?.failureCount).toBe(1);
    expect(f.stored.get(0)?.failure).toBe('invalid_model_output');
    await f.worker(id);
    expect(f.current()).toMatchObject({ status: 'completed', cursor: 4, failureCount: 1 });
  });
  it('ignores late duplicate FIFO and DLQ messages after terminal completion or failure', async () => {
    const f = fixture();
    await f.api(event('POST', '/api/datasets/' + id + '/analyze'));
    await f.worker(id); await f.worker(id);
    await f.worker(id); await f.worker(id, true);
    expect(f.current()?.status).toBe('completed');
    expect(f.model.analyze).toHaveBeenCalledTimes(4);
    const failed = fixture();
    await failed.api(event('POST', '/api/datasets/' + id + '/analyze'));
    failed.dataset.status = 'failed';
    await failed.worker(id);
    await failed.worker(id, true);
    expect(failed.current()?.error).toBe('dataset_unavailable');
  });
  it('DynamoDB fail transition is conditional on active states, protecting terminal jobs from late DLQ writes', async () => {
    const send = vi.fn().mockResolvedValue({});
    const fakeClient = { send } as unknown as DynamoDBDocumentClient;
    await new DynamoJobs(fakeClient, 'jobs').fail(id, 'retries_exhausted', timestamp.toISOString());
    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toBe('attribute_exists(id) AND (#s = :queued OR #s = :running)');
    expect(command.input.ExpressionAttributeValues).toMatchObject({ ':failed': 'failed', ':queued': 'queued', ':running': 'running' });
  });
});
