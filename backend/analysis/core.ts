import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { DatasetStore, Metadata, PrivateObjects } from '../datasets/core';
import { validateDataset } from '../datasets/core';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { aggregate, MAX_ANALYSIS_RECORDS, MODEL_ID, MODEL_REGION, PROMPT_VERSION, RECORDS_PER_INVOCATION, type RecordOutcome, type Report, type RecordAnalysis, InvalidModelOutput } from './schema';

const COOKIE = '__Host-grievance_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Job = {
  id: string; datasetId: string; ownerId: string; status: JobStatus;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  cursor: number; total: number; failureCount: number; resultsKey: string | null;
  modelId: typeof MODEL_ID; region: typeof MODEL_REGION; promptVersion: typeof PROMPT_VERSION;
  error: string | null;
};
export interface JobStore {
  get(id: string): Promise<Job | undefined>;
  create(job: Job): Promise<boolean>;
  start(id: string, startedAt: string): Promise<void>;
  checkpoint(id: string, expected: number, failed: boolean): Promise<boolean>;
  complete(id: string, key: string, timestamp: string): Promise<void>;
  fail(id: string, code: string, timestamp: string): Promise<void>;
}
export interface JobQueue {
  send(id: string, cursor: number): Promise<void>;
}
export interface ResultObjects {
  readRecord(id: string, index: number): Promise<RecordOutcome | null>;
  writeRecord(id: string, index: number, value: RecordOutcome): Promise<void>;
  writeReport(id: string, report: Report): Promise<string>;
  readReport(key: string): Promise<Report>;
}
export interface Inference {
  analyze(record: GrievanceRecord): Promise<RecordAnalysis>;
}
function json(statusCode: number, value: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(value) };
}
function bearer(event: APIGatewayProxyEventV2): string | null {
  const values = (event.cookies ?? []).flatMap(s => s.split(';')).map(s => s.trim())
    .filter(s => s.startsWith(COOKIE + '='));
  const value = values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
  return TOKEN_PATTERN.test(value) ? value : null;
}
function publicJob(job: Job) {
  const { id, datasetId, status, createdAt, startedAt, finishedAt, cursor, total, failureCount, modelId, region, promptVersion, error } = job;
  return { id, datasetId, status, createdAt, startedAt, finishedAt, processed: cursor, total, failureCount, modelId, region, promptVersion, error };
}
class HttpError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
/** All four job endpoints independently resolve the current hashed server-side session AND dataset ownership. */
export function createAnalysisApi(datasets: DatasetStore, files: PrivateObjects, jobs: JobStore, queue: JobQueue, results: ResultObjects, allowedOrigin: string, now = () => new Date()) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const method = event.requestContext.http.method, path = event.requestContext.http.path;
    try {
      const token = bearer(event);
      if (!token) throw new HttpError(401, 'Authentication required.');
      const session = await datasets.session(createHash('sha256').update(token).digest('hex'));
      if (!session || session.expiresAt <= Math.floor(now().getTime() / 1000)) throw new HttpError(401, 'Authentication required.');
      if (method === 'POST' && (event.headers.origin ?? event.headers.Origin) !== allowedOrigin) throw new HttpError(403, 'Origin not allowed.');
      const datasetRoute = /^\/api\/datasets\/([0-9a-f-]+)\/(analyze|analyses)$/.exec(path);
      const jobRoute = /^\/api\/analyses\/([0-9a-f-]+)(\/results)?$/.exec(path);
      const id = datasetRoute?.[1] ?? jobRoute?.[1];
      if (!id || !ID_PATTERN.test(id)) throw new HttpError(404, 'Analysis not found.');
      const dataset = await datasets.get(id);
      if (!dataset || dataset.ownerId !== session.userId) throw new HttpError(404, 'Analysis not found.');
      if (datasetRoute?.[2] === 'analyze' && method === 'POST') {
        if (dataset.status !== 'ready') throw new HttpError(409, 'Dataset must be ready.');
        const records = await readDataset(dataset, files);
        if (!records.length || records.length > MAX_ANALYSIS_RECORDS) throw new HttpError(422, 'AI pilot supports 1–30 records per dataset.');
        const job: Job = {
          id: dataset.id, datasetId: dataset.id, ownerId: session.userId, status: 'queued',
          createdAt: now().toISOString(), startedAt: null, finishedAt: null, cursor: 0, total: records.length,
          failureCount: 0, resultsKey: null, modelId: MODEL_ID, region: MODEL_REGION,
          promptVersion: PROMPT_VERSION, error: null,
        };
        if (!await jobs.create(job)) {
          const existing = await jobs.get(id);
          if (!existing) throw new HttpError(409, 'An analysis has already been requested.');
          return json(200, { job: publicJob(existing), alreadyExists: true });
        }
        try { await queue.send(job.id, 0); }
        catch {
          await jobs.fail(job.id, 'queue_unavailable', now().toISOString());
          return json(503, { error: 'Analysis queue unavailable; the job is marked failed.' });
        }
        return json(202, { job: publicJob(job), alreadyExists: false });
      }
      if (datasetRoute?.[2] === 'analyses' && method === 'GET') {
        const job = await jobs.get(id);
        return json(200, { jobs: job ? [publicJob(job)] : [] });
      }
      if (jobRoute && method === 'GET') {
        const job = await jobs.get(id);
        if (!job || job.ownerId !== session.userId) throw new HttpError(404, 'Analysis not found.');
        if (!jobRoute[2]) return json(200, { job: publicJob(job) });
        if (job.status !== 'completed' || !job.resultsKey) throw new HttpError(409, 'Analysis results are not ready.');
        return json(200, { job: publicJob(job), report: await results.readReport(job.resultsKey) });
      }
      throw new HttpError(404, 'Analysis endpoint not found.');
    } catch (error) {
      if (error instanceof HttpError) return json(error.code, { error: error.message });
      console.error('Analysis API operation failed', { method, path, code: error instanceof Error ? error.name : 'Unknown' });
      return json(500, { error: 'Analysis service unavailable.' });
    }
  };
}
async function readDataset(dataset: Metadata, files: PrivateObjects): Promise<GrievanceRecord[]> {
  return validateDataset(dataset.name, dataset.format, await files.read(dataset.key));
}
const transient = new Set(['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException', 'ModelNotReadyException', 'InternalServerException', 'TimeoutError', 'AbortError']);
function failureCode(error: unknown): string {
  if (error instanceof InvalidModelOutput) return 'invalid_model_output';
  return 'model_request_failed';
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function inferWithRetry(model: Inference, record: GrievanceRecord, sleep = delay): Promise<RecordOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { id: record.id, analysis: await model.analyze(record) }; }
    catch (error) {
      if (transient.has(error instanceof Error ? error.name : '') && attempt === 1) throw error;
      if (attempt === 1) return { id: record.id, failure: failureCode(error) };
      await sleep(200 + 400 * attempt);
    }
  }
  throw new Error('Unreachable retry state');
}
/** FIFO SQS: one dataset per message; state checkpoints every record, next message queued after each small chunk. */
export function createAnalysisWorker(datasets: DatasetStore, files: PrivateObjects, jobs: JobStore, queue: JobQueue,
  results: ResultObjects, model: Inference, now = () => new Date()) {
  return async (jobId: string, deadLetter = false): Promise<void> => {
    if (!ID_PATTERN.test(jobId)) return;
    const job = await jobs.get(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    if (deadLetter) { await jobs.fail(jobId, 'retries_exhausted', now().toISOString()); return; }
    const dataset = await datasets.get(job.datasetId);
    if (!dataset || dataset.status !== 'ready' || dataset.ownerId !== job.ownerId) {
      await jobs.fail(jobId, 'dataset_unavailable', now().toISOString());
      return;
    }
    if (job.status === 'queued') await jobs.start(jobId, now().toISOString());
    const records = await readDataset(dataset, files);
    if (records.length !== job.total || records.length > MAX_ANALYSIS_RECORDS) {
      await jobs.fail(jobId, 'dataset_changed', now().toISOString());
      return;
    }
    let next = job.cursor;
    const end = Math.min(job.total, next + RECORDS_PER_INVOCATION);
    while (next < end) {
      // Deleted or changed datasets must not trigger additional model calls.
      const currentDataset = await datasets.get(job.datasetId);
      if (!currentDataset || currentDataset.status !== 'ready' || currentDataset.ownerId !== job.ownerId) {
        await jobs.fail(jobId, 'dataset_unavailable', now().toISOString());
        return;
      }
      let outcome = await results.readRecord(job.id, next);
      if (!outcome) {
        outcome = await inferWithRetry(model, records[next]);
        await results.writeRecord(job.id, next, outcome);
      }
      if (outcome.id !== records[next].id) throw new Error('Stored record ID mismatch');
      if (!await jobs.checkpoint(jobId, next, !!outcome.failure)) return;
      next++;
    }
    if (next < job.total) { await queue.send(jobId, next); return; }
    const completed: RecordOutcome[] = [];
    for (let index = 0; index < job.total; index++) {
      const item = await results.readRecord(jobId, index);
      if (!item) throw new Error('Missing persisted record outcome');
      completed.push(item);
    }
    const report = aggregate(jobId, job.datasetId, records, completed, now().toISOString());
    const key = await results.writeReport(jobId, report);
    // A deletion between inference and persistence must never expose a completed report.
    const fresh = await datasets.get(job.datasetId);
    if (!fresh || fresh.status !== 'ready' || fresh.ownerId !== job.ownerId) {
      await jobs.fail(jobId, 'dataset_unavailable', now().toISOString());
      return;
    }
    await jobs.complete(jobId, key, now().toISOString());
  };
}
