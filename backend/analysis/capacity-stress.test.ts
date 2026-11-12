import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createDatasetHandler, type DatasetStore, type Metadata, type PrivateObjects } from '../datasets/core';
import { INDEX_CHUNK_RECORDS } from '../datasets/index';
import { MAX_RECORD_PROMPT_BYTES } from '../datasets/bounds';
import { recordPrompt, validateModelOutput, type RecordOutcome, type Report } from './schema';
import { createAnalysisWorker, type Inference, type Job, type JobStore, type JobQueue, type ResultObjects } from './core';

const id = '52345678-abcd-4f12-9abc-123456789abc';
const now = 1800000000000;
const token = 'B'.repeat(43);
const origin = 'https://telangana-gov-pilot.reagvis.com';
const hash = createHash('sha256').update(token).digest('hex');
const utf8 = (value: string) => new TextEncoder().encode(value);
const content = 'id,complaintText,responseText\n' + Array.from({ length: 2000 }, (_, i) =>
  'GR-' + i + ',నీరు లేదు ' + 'అ'.repeat(3375 + i % 4) + ',పరిశీలిస్తున్నాము').join('\n');
const source = utf8(content);
const event = (method: string, path: string, requestBody?: object, cursor?: number): APIGatewayProxyEventV2 => ({
  headers: { origin, 'content-type': 'application/json' },
  cookies: ['__Host-grievance_session=' + token],
  body: requestBody ? JSON.stringify(requestBody) : undefined,
  requestContext: { http: { method, path } }, isBase64Encoded: false,
  ...(cursor === undefined ? {} : { queryStringParameters: { cursor: String(cursor) } }),
} as unknown as APIGatewayProxyEventV2);
const output = (response: { body?: string }) => JSON.parse(response.body ?? '{}') as {
  dataset: Metadata; records: { id: string; complaintText: string }[] | null; nextCursor: number | null;
};

/**
 * Near-20 MiB source benchmark. All reads/writes use real UTF-8 byte buffers
 * and the production validation, indexing, pagination and worker functions.
 * Only S3 transport, DynamoDB and inference are mocked; no paid API calls.
 */
describe('near-20-MiB full-capacity regression', () => {
  it('indexes, pages and processes a realistic-size 2,000-record dataset without full-file re-reads', async () => {
    expect(source.byteLength).toBeGreaterThan(19 * 1024 * 1024);
    expect(source.byteLength).toBeLessThanOrEqual(20 * 1024 * 1024);
    const blobs = new Map<string, Uint8Array>();
    let rawReads = 0;
    let indexReads = 0;
    let indexedBytesRead = 0;
    let indexWrites = 0;
    const files: PrivateObjects = {
      presign: vi.fn(async () => ({ url: 'https://private.invalid/upload', headers: {} })),
      size: vi.fn(async (key) => blobs.get(key)?.length ?? null),
      read: vi.fn(async (key) => {
        const bytes = blobs.get(key);
        if (!bytes) throw new Error('Missing private object');
        if (key.includes('/index-v1/')) { indexReads++; indexedBytesRead += bytes.length; }
        else rawReads++;
        return bytes;
      }),
      write: vi.fn(async (key, bytes) => {
        if (blobs.has(key)) throw new Error('Immutable conflict');
        indexWrites++;
        blobs.set(key, bytes);
      }),
      remove: vi.fn(async (key) => { blobs.delete(key); }),
    };
    const meta = new Map<string, Metadata>();
    const datasets: DatasetStore = {
      session: vi.fn(async (value) => value === hash ? { userId: 'admin', expiresAt: now / 1000 + 100 } : undefined),
      create: vi.fn(async (item) => { meta.set(item.id, item); }),
      get: vi.fn(async (key) => meta.get(key)),
      list: vi.fn(async () => [...meta.values()]),
      transition: vi.fn(async (key, from, to, patch) => {
        const item = meta.get(key);
        if (!item || item.status !== from) return false;
        meta.set(key, { ...item, ...patch, status: to });
        return true;
      }),
      delete: vi.fn(async (key) => { meta.delete(key); }),
    };
    const handler = createDatasetHandler(datasets, files, origin, () => now, () => id);
    expect((await handler(event('POST', '/api/datasets/uploads', { name: 'stress.csv', bytes: source.byteLength }))).statusCode).toBe(201);
    blobs.set('raw/' + id + '/source.csv', source);

    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    const started = performance.now();
    const finalized = await handler(event('POST', '/api/datasets/' + id + '/finalize'));
    expect(finalized.statusCode).toBe(200);
    expect(output(finalized).dataset.recordCount).toBe(2000);
    expect(meta.get(id)?.indexVersion).toBe(1);
    expect(indexWrites).toBe(40);
    expect(rawReads).toBe(1);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);

    const opened: string[] = [];
    for (let cursor = 0; cursor < 2000; cursor += INDEX_CHUNK_RECORDS) {
      const response = await handler(event('GET', '/api/datasets/' + id, undefined, cursor));
      expect(response.statusCode).toBe(200);
      expect(Buffer.byteLength(response.body ?? '')).toBeLessThan(2 * 1024 * 1024);
      const page = output(response);
      expect(page.records).toHaveLength(50);
      opened.push(...page.records!.map(r => r.id));
      expect(page.nextCursor).toBe(cursor + 50 === 2000 ? null : cursor + 50);
    }
    expect(opened).toHaveLength(2000);
    expect(new Set(opened).size).toBe(2000);
    expect(rawReads).toBe(1);
    expect(indexReads).toBe(40);

    let job: Job = {
      id, datasetId: id, ownerId: 'admin', status: 'queued', expiresAt: 1900000000,
      createdAt: new Date(now).toISOString(), startedAt: null, finishedAt: null,
      cursor: 0, total: 2000, failureCount: 0, attempt: 0, generation: 0, resultsKey: null,
      modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1', promptVersion: 'te-grievance-response-v1', error: null,
    };
    const jobs: JobStore = {
      get: vi.fn(async () => ({ ...job })), create: vi.fn(),
      start: vi.fn(async () => { if (job.status === 'queued') job.status = 'running'; }),
      checkpoint: vi.fn(async (_id, expected, failed) => {
        if (job.status !== 'running' || job.cursor !== expected) return false;
        job.cursor++; job.failureCount += Number(failed);
        return true;
      }),
      complete: vi.fn(async (_id, key) => {
        if (job.cursor !== 2000) throw new Error('Premature completion');
        job = { ...job, status: 'completed', resultsKey: key };
      }),
      fail: vi.fn(async (_id, code) => { job = { ...job, status: 'failed', error: code }; }),
      retry: vi.fn(async () => false),
    };
    const queue: JobQueue = { send: vi.fn(async () => {}) };
    const stored = new Map<number, RecordOutcome>();
    let report: Report | null = null;
    const results: ResultObjects = {
      readRecord: vi.fn(async (_key, index) => stored.get(index) ?? null),
      writeRecord: vi.fn(async (_key, index, value) => { if (!stored.has(index)) stored.set(index, value); }),
      writeReport: vi.fn(async (_key, value) => { report = value; return 'analyses/' + id + '/report.json'; }),
      readReport: vi.fn(async () => { if (!report) throw new Error('Missing report'); return report; }),
    };
    let inferences = 0;
    const model: Inference = {
      analyze: vi.fn(async (record) => {
        inferences++;
        expect(Buffer.byteLength(recordPrompt(record))).toBeLessThanOrEqual(MAX_RECORD_PROMPT_BYTES);
        return validateModelOutput({
          id: record.id, category: 'water', complaintSummary: 'నీరు లేదు',
          issueClassification: null, requestedAction: null, potentiallyUrgent: false,
          urgencyReason: null, complaintEvidence: 'నీరు లేదు',
          responseSummary: 'పరిశీలిస్తున్నాము', departmentClaim: null,
          responseRelevance: 'inconclusive', responseAssessment: 'ఫలితం నిర్ధారణ కాలేదు',
          responseEvidence: 'పరిశీలిస్తున్నాము', verifiedOutcome: null, verificationStatus: 'not_verified',
        }, record);
      }),
    };
    const worker = createAnalysisWorker(datasets, files, jobs, queue, results, model);
    const beforeWorker = performance.now();
    for (let i = 0; job.status !== 'completed' && i < 670; i++) {
      await worker(id, false, 0);
      if (i % 30 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    const workerMs = Math.round(performance.now() - beforeWorker);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    expect(job).toMatchObject({ status: 'completed', cursor: 2000, failureCount: 0 });
    expect(report!.stats).toMatchObject({ grievances: 2000, analyzed: 2000, failed: 0 });
    expect(inferences).toBe(2000);
    expect(rawReads).toBe(1); // Initial validation only: no further 20 MiB GET.
    expect(indexedBytesRead).toBeLessThan(source.byteLength * 30);
    // The Vitest worker also holds the full mock S3 store and raw source bytes.
    // Measure incremental workload RSS; this process is not an isolated Lambda.
    expect(peakRss - baselineRss).toBeLessThan(512 * 1024 * 1024);
    console.info('capacity_index_benchmark', JSON.stringify({
      sourceMiB: +(source.byteLength / 1024 ** 2).toFixed(2), processed: inferences,
      sourceReads: rawReads, indexReads, indexWrites,
      indexReadMiB: +(indexedBytesRead / 1024 ** 2).toFixed(2),
      readAmplification: +(indexedBytesRead / source.byteLength).toFixed(2),
      rssBaselineMiB: +(baselineRss / 1024 ** 2).toFixed(1),
      rssPeakMiB: +(peakRss / 1024 ** 2).toFixed(1),
      rssDeltaMiB: +((peakRss - baselineRss) / 1024 ** 2).toFixed(1),
      finalizeAndReadMs: Math.round(beforeWorker - started), processingMs: workerMs,
    }));
  }, 120000);
});
