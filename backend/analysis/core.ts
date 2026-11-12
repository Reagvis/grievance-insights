import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { DatasetStore, Metadata, PrivateObjects } from '../datasets/core';
import { ApiError, validateDataset } from '../datasets/core';
import { readIndexedRange } from '../datasets/index';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { aggregate, MAX_ANALYSIS_RECORDS, MODEL_ID, MODEL_REGION, PROMPT_VERSION, RECORDS_PER_INVOCATION, type RecordOutcome, type Report, type RecordAnalysis, InvalidModelOutput } from './schema';

const COOKIE = '__Host-grievance_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Job = {
  id: string; datasetId: string; ownerId: string; status: JobStatus; expiresAt: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  cursor: number; total: number; failureCount: number; attempt: number; generation?: number; resultsKey: string | null;
  modelId: typeof MODEL_ID; region: typeof MODEL_REGION; promptVersion: typeof PROMPT_VERSION;
  error: string | null;
};
export interface JobStore {
  get(id: string): Promise<Job | undefined>;
  create(job: Job): Promise<boolean>;
  start(id: string, startedAt: string, attempt?: number): Promise<void>;
  checkpoint(id: string, expected: number, failed: boolean, attempt?: number): Promise<boolean>;
  complete(id: string, key: string, timestamp: string, attempt?: number): Promise<void>;
  fail(id: string, code: string, timestamp: string, attempt?: number): Promise<void>;
  retry(id: string, mode?: 'resume' | 'fresh'): Promise<boolean>;
}
export interface JobQueue {
  send(id: string, cursor: number, attempt?: number): Promise<void>;
}
export interface ResultObjects {
  readRecord(id: string, index: number): Promise<RecordOutcome | null>;
  writeRecord(id: string, index: number, value: RecordOutcome): Promise<void>;
  writeReport(id: string, report: Report): Promise<string>;
  readReport(key: string): Promise<Report>;
}
export interface Inference {
  analyze(record: GrievanceRecord, context?: { jobId: string; attempt: number; generation: number; recordIndex: number }): Promise<RecordAnalysis>;
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
  const { id, datasetId, status, createdAt, startedAt, finishedAt, cursor, total, failureCount, attempt, generation, modelId, region, promptVersion, error } = job;
  return { id, datasetId, status, createdAt, startedAt, finishedAt, processed: cursor, total, failureCount, attempt: attempt ?? 0, generation: generation ?? 0, modelId, region, promptVersion, error };
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
      const jobRoute = /^\/api\/analyses\/([0-9a-f-]+)(\/results|\/retry)?$/.exec(path);
      const id = datasetRoute?.[1] ?? jobRoute?.[1];
      if (!id || !ID_PATTERN.test(id)) throw new HttpError(404, 'Analysis not found.');
      const dataset = await datasets.get(id);
      if (!dataset || dataset.ownerId !== session.userId) throw new HttpError(404, 'Analysis not found.');
      if (datasetRoute?.[2] === 'analyze' && method === 'POST') {
        if (dataset.status !== 'ready') throw new HttpError(409, 'Dataset must be ready.');
        let total: number;
        try { total = dataset.indexVersion === 1 ? dataset.recordCount : (await readDataset(dataset, files)).length; }
        catch (error) { if (error instanceof ApiError) throw new HttpError(422, error.message); throw error; }
        if (!total || total > MAX_ANALYSIS_RECORDS) throw new HttpError(422, 'AI analysis supports 1–2,000 records per dataset.');
        const job: Job = {
          id: dataset.id, datasetId: dataset.id, ownerId: session.userId, status: 'queued',
          createdAt: now().toISOString(), startedAt: null, finishedAt: null, cursor: 0, total,
          expiresAt: Math.floor(now().getTime() / 1000) + 89 * 86400,
          failureCount: 0, attempt: 0, generation: 0, resultsKey: null, modelId: MODEL_ID, region: MODEL_REGION,
          promptVersion: PROMPT_VERSION, error: null,
        };
        if (!await jobs.create(job)) {
          const existing = await jobs.get(id);
          if (!existing) throw new HttpError(409, 'An analysis has already been requested.');
          return json(200, { job: publicJob(existing), alreadyExists: true });
        }
        try { await queue.send(job.id, 0, job.attempt); }
        catch {
          await jobs.fail(job.id, 'queue_unavailable', now().toISOString(), job.attempt);
          return json(503, { error: 'Analysis queue unavailable; the job is marked failed.' });
        }
        return json(202, { job: publicJob(job), alreadyExists: false });
      }
      if (datasetRoute?.[2] === 'analyses' && method === 'GET') {
        const job = await jobs.get(id);
        return json(200, { jobs: job ? [publicJob(job)] : [] });
      }
      if (jobRoute?.[2] === '/retry' && method === 'POST') {
        const previous = await jobs.get(id);
        if (!previous || previous.ownerId !== session.userId) throw new HttpError(404, 'Analysis not found.');
        if (dataset.status !== 'ready') throw new HttpError(409, 'Dataset must be ready.');
        let mode: 'resume' | 'fresh' = 'resume';
        if (event.body) {
          if (Buffer.byteLength(event.body) > 256) throw new HttpError(413, 'Retry request is too large.');
          let value: unknown;
          try { value = JSON.parse(event.body); } catch { throw new HttpError(400, 'Invalid retry JSON.'); }
          if (!value || typeof value !== 'object' || Array.isArray(value) ||
              !('mode' in value) || !['resume', 'fresh'].includes(String(value.mode))) {
            throw new HttpError(400, 'Retry mode must be resume or fresh.');
          }
          mode = String(value.mode) as 'resume' | 'fresh';
        }
        const safeReasons = mode === 'fresh'
          ? ['all_records_failed', 'queue_unavailable', 'retries_exhausted']
          : ['queue_unavailable', 'retries_exhausted'];
        if (previous.status !== 'failed' || !safeReasons.includes(previous.error ?? '') ||
            previous.total !== dataset.recordCount) {
          throw new HttpError(409, 'This failed job cannot be restarted safely.');
        }
        if (!await jobs.retry(id, mode)) throw new HttpError(409, 'Job retry state changed; refresh before retrying.');
        const retried = await jobs.get(id);
        if (!retried || retried.status !== 'queued') throw new HttpError(409, 'Job retry state changed.');
        try { await queue.send(id, retried.cursor, retried.attempt); }
        catch {
          await jobs.fail(id, 'queue_unavailable', now().toISOString(), retried.attempt);
          return json(503, { error: 'Retry queue unavailable; job remains recoverable.' });
        }
        console.info(JSON.stringify({ event: 'analysis_restart', jobId: id, attempt: retried.attempt,
          generation: retried.generation ?? 0, mode, resumedAt: retried.cursor }));
        return json(202, { job: publicJob(retried) });
      }
      if (jobRoute && method === 'GET') {
        const job = await jobs.get(id);
        if (!job || job.ownerId !== session.userId) throw new HttpError(404, 'Analysis not found.');
        if (!jobRoute[2]) return json(200, { job: publicJob(job) });
        if (job.status !== 'completed' || !job.resultsKey) throw new HttpError(409, 'Analysis results are not ready.');
        const cursorText = event.queryStringParameters?.cursor ?? '0';
        if (!/^(0|[1-9][0-9]{0,3})$/.test(cursorText)) throw new HttpError(400, 'Invalid result cursor.');
        const cursor = Number(cursorText);
        const report = await results.readReport(job.resultsKey);
        if (cursor > report.outcomes.length) throw new HttpError(400, 'Result cursor out of range.');
        if ((report.generation ?? 0) !== (job.generation ?? 0)) throw new Error('Report generation mismatch');
        let end = Math.min(report.outcomes.length, cursor + 100);
        let payload = { job: publicJob(job), report: { ...report, outcomes: report.outcomes.slice(cursor, end) },
          nextCursor: end < report.outcomes.length ? end : null };
        // Byte-budget responses, not just record counts; never truncate an outcome.
        while (end > cursor + 1 && Buffer.byteLength(JSON.stringify(payload)) > 2 * 1024 * 1024) {
          end--;
          payload = { job: publicJob(job), report: { ...report, outcomes: report.outcomes.slice(cursor, end) },
            nextCursor: end < report.outcomes.length ? end : null };
        }
        if (Buffer.byteLength(JSON.stringify(payload)) > 2 * 1024 * 1024) throw new Error('AI result page exceeds safety budget');
        return json(200, payload);
      }
      throw new HttpError(404, 'Analysis endpoint not found.');
    } catch (error) {
      if (error instanceof HttpError) return json(error.code, { error: error.message });
      console.error('Analysis API operation failed', { method, path, code: error instanceof Error ? error.name : 'Unknown' });
      return json(500, { error: 'Analysis service unavailable.' });
    }
  };
}
async function readDataset(dataset: Metadata, files: PrivateObjects, start = 0, end = dataset.recordCount): Promise<GrievanceRecord[]> {
  if (dataset.indexVersion === 1) return readIndexedRange(dataset, files, start, end);
  return validateDataset(dataset.name, dataset.format, await files.read(dataset.key)).slice(start, end);
}
function resultScope(job: Job): string {
  return (job.generation ?? 0) === 0 ? job.id : job.id + '/generations/' + job.generation;
}
const transient = new Set(['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException', 'ModelNotReadyException', 'InternalServerException', 'TimeoutError', 'AbortError']);
function failureCode(error: unknown): string {
  if (error instanceof InvalidModelOutput) return 'invalid_model_output';
  return 'model_request_failed';
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function inferWithRetry(model: Inference, record: GrievanceRecord, sleep = delay,
  context?: { jobId: string; attempt: number; generation: number; recordIndex: number }): Promise<RecordOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { id: record.id, analysis: await model.analyze(record, context) }; }
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
  return async (jobId: string, deadLetter = false, messageAttempt?: number): Promise<void> => {
    if (!ID_PATTERN.test(jobId)) return;
    const job = await jobs.get(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed' ||
        (messageAttempt !== undefined && messageAttempt !== (job.attempt ?? 0))) return;
    if (deadLetter) { await jobs.fail(jobId, 'retries_exhausted', now().toISOString(), job.attempt ?? 0); return; }
    const dataset = await datasets.get(job.datasetId);
    if (!dataset || dataset.status !== 'ready' || dataset.ownerId !== job.ownerId) {
      await jobs.fail(jobId, 'dataset_unavailable', now().toISOString(), job.attempt ?? 0);
      return;
    }
    if (job.status === 'queued') await jobs.start(jobId, now().toISOString(), job.attempt ?? 0);
    const nextStart = job.cursor;
    const end = Math.min(job.total, nextStart + RECORDS_PER_INVOCATION);
    const records = await readDataset(dataset, files, nextStart, end);
    if (dataset.recordCount !== job.total || records.length !== end - nextStart || job.total > MAX_ANALYSIS_RECORDS) {
      await jobs.fail(jobId, 'dataset_changed', now().toISOString(), job.attempt ?? 0);
      return;
    }
    let next = nextStart;
    const scope = resultScope(job);
    const batchStarted = Date.now();
    while (next < end) {
      // Deleted or changed datasets must not trigger additional model calls.
      const currentDataset = await datasets.get(job.datasetId);
      if (!currentDataset || currentDataset.status !== 'ready' || currentDataset.ownerId !== job.ownerId) {
        await jobs.fail(jobId, 'dataset_unavailable', now().toISOString(), job.attempt ?? 0);
        return;
      }
      let outcome = await results.readRecord(scope, next);
      if (!outcome) {
        outcome = await inferWithRetry(model, records[next - nextStart], delay, {
          jobId, attempt: job.attempt ?? 0, generation: job.generation ?? 0, recordIndex: next,
        });
        await results.writeRecord(scope, next, outcome);
        // If S3 rejected our write with 412, use the immutable stored result
        // rather than the losing inference for failure counts and checkpoints.
        const persisted = await results.readRecord(scope, next);
        if (!persisted) throw new Error('Persisted record outcome missing after write');
        outcome = persisted;
      }
      if (outcome.id !== records[next - nextStart].id) throw new Error('Stored record ID mismatch');
      if (!await jobs.checkpoint(jobId, next, !!outcome.failure, job.attempt ?? 0)) return;
      next++;
    }
    console.info(JSON.stringify({
      event: 'analysis_batch_progress', jobId, attempt: job.attempt ?? 0,
      generation: job.generation ?? 0, processed: next, total: job.total,
      chunkRecords: end - job.cursor, elapsedMs: Date.now() - batchStarted,
    }));
    if (next < job.total) { await queue.send(jobId, next, job.attempt ?? 0); return; }
    const completed: RecordOutcome[] = [];
    for (let index = 0; index < job.total; index++) {
      const item = await results.readRecord(scope, index);
      if (!item) throw new Error('Missing persisted record outcome');
      completed.push(item);
    }
    const allRecords = await readDataset(dataset, files);
    if (allRecords.length !== job.total) throw new Error('Dataset changed during final aggregation');
    const report = { ...aggregate(jobId, job.datasetId, allRecords, completed, now().toISOString()),
      generation: job.generation ?? 0 };
    // Zero validated analyses are unusable, not a completed AI report.
    // Per-record failures and the accurate failureCount remain in private storage/job metadata.
    if (report.stats.analyzed === 0) {
      await jobs.fail(jobId, 'all_records_failed', now().toISOString(), job.attempt ?? 0);
      return;
    }
    const key = await results.writeReport(scope, report);
    // A deletion between inference and persistence must never expose a completed report.
    const fresh = await datasets.get(job.datasetId);
    if (!fresh || fresh.status !== 'ready' || fresh.ownerId !== job.ownerId) {
      await jobs.fail(jobId, 'dataset_unavailable', now().toISOString(), job.attempt ?? 0);
      return;
    }
    await jobs.complete(jobId, key, now().toISOString(), job.attempt ?? 0);
    console.info(JSON.stringify({
      event: 'analysis_job_completed', jobId, attempt: job.attempt ?? 0,
      generation: job.generation ?? 0, total: job.total, analyzed: report.stats.analyzed, failed: report.stats.failed,
    }));
  };
}
