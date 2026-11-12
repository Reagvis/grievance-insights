import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadDataset } from '../../src/services/datasetApi';
import { ingestDocument } from '../ingest';
import { SqsExtractionQueue } from './aws';
import { createDatasetHandler, EXTRACTION_DEADLINE_SECONDS, type DatasetStore, type ExtractionQueue, type Metadata, type PrivateObjects } from './core';
import { createExtractionWorker } from './extractor';

/** Regression tests for the three findings of the independent review of PR #28. */

// ---- minimal in-memory service (FIFO-style queue injected per test) ----
const id = '01234567-89ab-4cde-8fab-0123456789ab';
const cookie = 'A'.repeat(43);
const hash = createHash('sha256').update(cookie).digest('hex');
const origin = 'https://telangana-gov-pilot.reagvis.com';
const T0 = 1800000000000;
const enc = (s: string) => new TextEncoder().encode(s);
const pdf = new Uint8Array(readFileSync(new URL('../ingest/fixtures/searchable-english-3page.pdf', import.meta.url)));

function ev(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return { headers: { origin, 'content-type': 'application/json' }, cookies: ['__Host-grievance_session=' + cookie], body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), requestContext: { http: { method, path } }, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}
function service(queue: ExtractionQueue) {
  let now = T0;
  const items = new Map<string, Metadata>();
  const objects = new Map<string, Uint8Array>();
  const store: DatasetStore = {
    session: async (h) => (h === hash ? { userId: 'admin-1', expiresAt: T0 / 1000 + 1e6 } : undefined),
    create: async (i) => { items.set(i.id, i); },
    get: async (k) => (items.has(k) ? { ...items.get(k)! } : undefined),
    list: async () => [...items.values()].map((i) => ({ ...i })),
    transition: async (k, from, to, patch) => { const it = items.get(k); if (!it || it.status !== from) return false; items.set(k, { ...it, ...patch, status: to }); return true; },
    delete: async (k) => { items.delete(k); },
  };
  const files: PrivateObjects = {
    presign: async () => ({ url: 'https://private-s3.invalid/put', headers: {} }),
    size: async (k) => objects.get(k)?.byteLength ?? null,
    read: async (k) => { const v = objects.get(k); if (!v) throw new Error('missing'); return v; },
    remove: async (k) => { objects.delete(k); },
    write: async (k, b) => { if (objects.has(k)) throw new Error('Immutable dataset index already exists'); objects.set(k, b); },
  };
  const handler = createDatasetHandler(store, files, origin, () => now, () => id, queue);
  const worker = createExtractionWorker(store, files, async () => { throw new Error('no OCR needed'); }, () => now);
  return { items, objects, handler, worker, advance: (s: number) => { now += s * 1000; } };
}
const okQueue: ExtractionQueue = { send: async () => {} };

// ---- 1. stuck extraction is observed by the real frontend polling path ----
describe('review finding 1: stuck extraction is failed and removable through the list/poll path', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  it('the list endpoint fails an expired extraction, and it can then be deleted', async () => {
    const s = service(okQueue);
    await s.handler(ev('POST', '/api/datasets/uploads', { name: 'a.pdf', bytes: pdf.length }));
    s.objects.set('raw/' + id + '/source.pdf', pdf);
    await s.handler(ev('POST', '/api/datasets/' + id + '/finalize', {}));
    expect(JSON.parse((await s.handler(ev('GET', '/api/datasets'))).body!).datasets[0].status).toBe('extracting');
    expect((await s.handler(ev('DELETE', '/api/datasets/' + id))).statusCode).toBe(409); // still within its deadline
    s.advance(EXTRACTION_DEADLINE_SECONDS + 1);
    const list = JSON.parse((await s.handler(ev('GET', '/api/datasets'))).body!).datasets[0];
    expect(list).toMatchObject({ status: 'failed' });
    expect(list.error).toContain('did not finish in time');
    expect((await s.handler(ev('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
    expect(s.objects.size).toBe(0);
  });
  it('delete itself expires a stuck extraction (no list call needed first)', async () => {
    const s = service(okQueue);
    await s.handler(ev('POST', '/api/datasets/uploads', { name: 'a.pdf', bytes: pdf.length }));
    s.objects.set('raw/' + id + '/source.pdf', pdf);
    await s.handler(ev('POST', '/api/datasets/' + id + '/finalize', {}));
    s.advance(EXTRACTION_DEADLINE_SECONDS + 1);
    expect((await s.handler(ev('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
  });
  it('the exact frontend path (uploadDataset polling GET /api/datasets) ends in a failure message, not an endless wait', async () => {
    const s = service(okQueue);
    vi.stubGlobal('window', { location: { origin } });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://private-s3.invalid')) { s.objects.set('raw/' + id + '/source.pdf', pdf); return { ok: true, status: 200 }; }
      const [path, query] = url.split('?');
      const r = await s.handler(ev(init?.method ?? 'GET', path, init?.body as string | undefined));
      void query;
      return { ok: (r.statusCode ?? 500) < 400, status: r.statusCode, json: async () => JSON.parse(r.body ?? '{}') };
    });
    let advanced = false;
    const attempt = uploadDataset(new File([pdf as BlobPart], 'a.pdf'), (step) => {
      if (step.startsWith('Extracting text from the PDF') && !advanced) { advanced = true; s.advance(EXTRACTION_DEADLINE_SECONDS + 1); } // the worker never delivers
    }, { pollMs: 1, maxWaitMs: 5000 });
    await expect(attempt).rejects.toThrow('did not finish in time');
    expect(s.items.get(id)?.status).toBe('failed');
    expect((await s.handler(ev('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
  });
});

// ---- 2. ambiguous SQS acknowledgement must not lose the retried extraction ----
vi.mock('../analysis/aws-http', async (original) => {
  const real = await original<typeof import('../analysis/aws-http')>();
  return { ...real, signedAwsRequest: vi.fn() };
});
describe('review finding 2: ambiguous SQS acknowledgement and FIFO deduplication', () => {
  it('uses a distinct deduplication ID for every enqueue attempt (same group)', async () => {
    const { signedAwsRequest } = await import('../analysis/aws-http');
    const sent: Array<{ MessageGroupId: string; MessageDeduplicationId: string }> = [];
    vi.mocked(signedAwsRequest).mockImplementation(async (_s, _r, _m, _u, body) => {
      sent.push(JSON.parse(new TextDecoder().decode(body as Uint8Array)));
      return { json: async () => ({ MessageId: 'm' + sent.length }) } as unknown as Response;
    });
    const queue = new SqsExtractionQueue('https://sqs.ap-south-1.amazonaws.com/1/q.fifo', 'ap-south-1');
    await queue.send(id);
    await queue.send(id);
    expect(sent[0].MessageGroupId).toBe(id);
    expect(sent[1].MessageGroupId).toBe(id);
    expect(sent[0].MessageDeduplicationId).not.toBe(sent[1].MessageDeduplicationId);
  });
  it('ack lost after SQS accepted the first message: the retry is still delivered and the dataset reaches ready', async () => {
    const { signedAwsRequest } = await import('../analysis/aws-http');
    // Emulates FIFO: a message whose deduplication ID was already seen (5-minute window) is acknowledged but NOT delivered.
    const seen = new Set<string>();
    const delivered: string[] = [];
    let calls = 0;
    vi.mocked(signedAwsRequest).mockImplementation(async (_s, _r, _m, _u, body) => {
      const msg = JSON.parse(new TextDecoder().decode(body as Uint8Array)) as { MessageBody: string; MessageDeduplicationId: string };
      calls++;
      if (!seen.has(msg.MessageDeduplicationId)) { seen.add(msg.MessageDeduplicationId); delivered.push((JSON.parse(msg.MessageBody) as { datasetId: string }).datasetId); }
      if (calls === 1) throw new Error('network timeout after SQS accepted the message'); // ambiguous: caller cannot know
      return { json: async () => ({ MessageId: 'ok' }) } as unknown as Response;
    });
    const s = service(new SqsExtractionQueue('https://sqs.ap-south-1.amazonaws.com/1/q.fifo', 'ap-south-1'));
    await s.handler(ev('POST', '/api/datasets/uploads', { name: 'a.pdf', bytes: pdf.length }));
    s.objects.set('raw/' + id + '/source.pdf', pdf);
    const first = await s.handler(ev('POST', '/api/datasets/' + id + '/finalize', {}));
    expect(first.statusCode).toBe(503);
    expect(s.items.get(id)?.status).toBe('pending_upload');
    // The message SQS did accept is consumed while the dataset is pending: it must be a harmless no-op.
    expect(await s.worker(delivered[0])).toBe('skipped');
    // The administrator retries finalize. Its message must not be swallowed by deduplication.
    expect((await s.handler(ev('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(202);
    expect(delivered).toHaveLength(2);
    expect(await s.worker(delivered[1])).toBe('ready');
    expect(s.items.get(id)?.status).toBe('ready');
  });
});

// ---- 3. malformed CSV/JSON/JSONL never echo source text ----
describe('review finding 3: parser errors never contain grievance text', () => {
  const SECRET = 'SECRET-CITIZEN-123';
  const bad: Array<[string, string]> = [
    ['a.json', SECRET],
    ['a.json', '{"id":"x","complaintText":"' + SECRET + '"'],
    ['a.json', '[' + SECRET + ']'],
    ['a.csv', SECRET + ',' + SECRET + '\n1,2'],
    ['a.csv', 'id,complaintText\n"' + SECRET],
    ['a.csv', 'name,' + SECRET + '\nv,v'],
    ['a.jsonl', '{"id":"a","complaintText":"ok ok ok"}\n' + SECRET],
    ['a.jsonl', SECRET],
  ];
  it.each(bad)('%s with sentinel text', async (name, content) => {
    const error = await ingestDocument({ name, bytes: enc(content) }).then(() => null, (e: Error) => e);
    expect(error).not.toBeNull();
    expect(error!.message).not.toContain(SECRET);
    expect(error!.message.length).toBeLessThan(260);
  });
  it('the HTTP response and logs for a malformed upload contain neither the sentinel nor parser detail', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = service(okQueue);
    for (const [name, content] of bad) {
      const s2 = service(okQueue);
      await s2.handler(ev('POST', '/api/datasets/uploads', { name, bytes: enc(content).length }));
      s2.objects.set('raw/' + id + '/source.' + name.split('.').pop(), enc(content));
      const res = await s2.handler(ev('POST', '/api/datasets/' + id + '/finalize', {}));
      expect(res.statusCode).toBe(422);
      expect(res.body).not.toContain(SECRET);
      expect(JSON.stringify(s2.items.get(id))).not.toContain(SECRET);
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    spy.mockRestore();
    void s;
  });
  it('legitimate users still get a useful, fixed message and JSONL keeps its (text-free) line number', async () => {
    const csv = await ingestDocument({ name: 'a.csv', bytes: enc('colA,colB\n1,2') }).then(() => null, (e: Error) => e);
    expect(csv!.message).toContain('id and complaintText');
    const jl = await ingestDocument({ name: 'a.jsonl', bytes: enc('{"id":"a","complaintText":"ok ok ok"}\n{oops') }).then(() => null, (e: Error) => e);
    expect(jl!.message).toBe('Line 2 is not valid JSON.');
  });
});
