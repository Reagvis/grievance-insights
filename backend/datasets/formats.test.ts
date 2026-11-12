import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { createAnalysisApi, createAnalysisWorker, type Job, type JobStore, type ResultObjects, type Inference } from '../analysis/core';
import { validateModelOutput, type RecordOutcome, type Report } from '../analysis/schema';
import { LIMITS } from '../ingest';
import { createTesseractEngine, type OcrEngine } from '../ingest/ocr';
import { provenanceKey } from './commit';
import { createDatasetHandler, EXTRACTION_DEADLINE_SECONDS, type DatasetStore, type ExtractionQueue, type Metadata, type PrivateObjects } from './core';
import { createExtractionWorker } from './extractor';
import { INDEX_CHUNK_RECORDS, indexChunkKey, readIndexedRange } from './index';

const id = '01234567-89ab-4cde-8fab-0123456789ab';
const cookie = 'A'.repeat(43);
const hash = createHash('sha256').update(cookie).digest('hex');
const origin = 'https://telangana-gov-pilot.reagvis.com';
const T0 = 1800000000000;
const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (name: string) => new Uint8Array(readFileSync(new URL('../ingest/fixtures/' + name, import.meta.url)));
const tessdata = fileURLToPath(new URL('../ingest/tessdata', import.meta.url));

const TE = 'మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.';
const TE_RESP = 'సంబంధిత విభాగానికి సమస్యను పంపించాము.';

function docx(): Uint8Array {
  const p = (t: string) => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>';
  const row = (a: string, b: string) => '<w:tr><w:tc>' + p(a) + '</w:tc><w:tc>' + p(b) + '</w:tc></w:tr>';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>' + row('Case ID', 'DOCX-1') + row('Category', 'Water supply') + '</w:tbl>' + p('Complaint:') + p(TE) + p('Response:') + p(TE_RESP) + '</w:body></w:document>'),
  });
}

/** One upload per supported format: file, expected record IDs, and whether extraction is asynchronous (PDF). */
const SAMPLES: Array<{ name: string; bytes: Uint8Array; ids: string[]; async?: boolean; text: string }> = [
  { name: 'note.txt', bytes: enc('Case ID: TXT-1\nComplaint:\n' + TE + '\nResponse:\n' + TE_RESP), ids: ['TXT-1'], text: TE },
  { name: 'note.md', bytes: enc('**Case ID:** MD-1\n\n## Complaint\n\n' + TE + '\n\n## Response\n\n' + TE_RESP), ids: ['MD-1'], text: TE },
  { name: 'note.docx', bytes: docx(), ids: ['DOCX-1'], text: TE },
  { name: 'set.csv', bytes: enc('id,complaintText,responseText\nCSV-1,' + TE + ',' + TE_RESP + '\nCSV-2,second complaint text,\n'), ids: ['CSV-1', 'CSV-2'], text: TE },
  { name: 'set.json', bytes: enc(JSON.stringify([{ id: 'JSON-1', complaintText: TE, responseText: TE_RESP }, { id: 'JSON-2', complaintText: 'second complaint text' }])), ids: ['JSON-1', 'JSON-2'], text: TE },
  { name: 'set.jsonl', bytes: enc('{"id":"JL-1","complaintText":"' + TE + '","responseText":"' + TE_RESP + '"}\n{"id":"JL-2","complaintText":"second complaint text"}\n'), ids: ['JL-1', 'JL-2'], text: TE },
  { name: 'TE-PDF-001.pdf', bytes: pdf('searchable-telugu-2page.pdf'), ids: ['TE-PDF-001'], async: true, text: 'మా వీధిలో' },
];

function event(method: string, path: string, data?: object, authenticated = true, query?: Record<string, string>): APIGatewayProxyEventV2 {
  return { headers: { origin, 'content-type': 'application/json' }, cookies: authenticated ? ['__Host-grievance_session=' + cookie] : [], body: data === undefined ? undefined : JSON.stringify(data), queryStringParameters: query, requestContext: { http: { method, path } }, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}

function service(opts: { engine?: () => Promise<OcrEngine>; queue?: boolean } = {}) {
  let now = T0;
  const items = new Map<string, Metadata>();
  const objects = new Map<string, Uint8Array>();
  const sent: string[] = [];
  const store: DatasetStore = {
    session: async (h) => (h === hash ? { userId: 'admin-1', expiresAt: T0 / 1000 + 100000 } : undefined),
    create: async (item) => { items.set(item.id, item); },
    get: async (key) => (items.has(key) ? { ...items.get(key)! } : undefined),
    list: async () => [...items.values()],
    transition: async (key, from, to, patch) => { const it = items.get(key); if (!it || it.status !== from) return false; items.set(key, { ...it, ...patch, status: to }); return true; },
    delete: async (key) => { items.delete(key); },
  };
  const files: PrivateObjects = {
    presign: vi.fn(async (_key, format) => ({ url: 'https://s3.example.invalid/x', headers: { 'if-none-match': '*', 'content-type': 'x/' + format } })),
    size: async (key) => objects.get(key)?.byteLength ?? null,
    read: async (key) => { const v = objects.get(key); if (!v) throw new Error('missing'); return v; },
    remove: async (key) => { objects.delete(key); },
    // Like the real S3 writer: index and provenance objects are immutable (If-None-Match: *).
    write: vi.fn(async (key, bytes) => { if (objects.has(key)) throw new Error('Immutable dataset index already exists'); objects.set(key, bytes); }),
  };
  const queue: ExtractionQueue | undefined = opts.queue === false ? undefined : { send: vi.fn(async (d: string) => { sent.push(d); }) };
  const handler = createDatasetHandler(store, files, origin, () => now, () => id, queue);
  const worker = createExtractionWorker(store, files, opts.engine ?? (async () => { throw new Error('no OCR engine in this test'); }), () => now);
  const json = (r: { body?: string }) => JSON.parse(r.body ?? '{}') as Record<string, any>;
  const upload = async (name: string, bytes: Uint8Array, declared = bytes.length) => {
    const created = await handler(event('POST', '/api/datasets/uploads', { name, bytes: declared }));
    if (created.statusCode === 201) objects.set('raw/' + id + '/source.' + name.split('.').pop()!.toLowerCase(), bytes); // the browser's direct PUT
    return created;
  };
  const finalize = () => handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
  /** What the browser does: page through GET until nextCursor is null. */
  const allRecords = async () => {
    const out: GrievanceRecord[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page: Record<string, any> = json(await handler(event('GET', '/api/datasets/' + id, undefined, true, { cursor: String(cursor) })));
      if (page.records === null) return null;
      out.push(...page.records);
      cursor = page.nextCursor;
    }
    return out;
  };
  return { items, objects, files, store, handler, worker, sent, upload, finalize, allRecords, json, advance: (s: number) => { now += s * 1000; } };
}

describe('every supported format: upload → finalize → (extract) → retrieve → delete', () => {
  for (const sample of SAMPLES) {
    it(sample.name, async () => {
      const s = service();
      expect((await s.upload(sample.name, sample.bytes)).statusCode).toBe(201);
      const fin = await s.finalize();
      if (sample.async) {
        // PDFs are processed in the queue worker; the dataset is NOT ready yet.
        expect(fin.statusCode).toBe(202);
        expect(s.json(fin).dataset.status).toBe('extracting');
        expect(s.sent).toEqual([id]);
        expect(await s.allRecords()).toBeNull();
        expect(await s.worker(id)).toBe('ready');
      } else {
        expect(fin.statusCode).toBe(200);
        expect(s.json(fin).dataset).toMatchObject({ status: 'ready', recordCount: sample.ids.length });
        expect(s.sent).toEqual([]);
      }
      expect(s.items.get(id)).toMatchObject({ status: 'ready', indexVersion: 1, recordCount: sample.ids.length });

      // Task 19's immutable index chunks hold the records; the original and its provenance sit beside them, untouched.
      const ext = sample.name.split('.').pop()!;
      expect(s.objects.get('raw/' + id + '/source.' + ext)).toBe(sample.bytes);
      expect(s.objects.has(indexChunkKey('raw/' + id + '/source.' + ext, 0))).toBe(true);
      const prov = JSON.parse(new TextDecoder().decode(s.objects.get(provenanceKey('raw/' + id + '/source.' + ext))!));
      expect(prov).toMatchObject({ schemaVersion: 1, format: ext, sourceFile: sample.name });
      expect(prov.sourceSha256).toBe(createHash('sha256').update(sample.bytes).digest('hex'));

      // "Refresh": a fresh paged retrieval returns the same persisted records; Telugu is intact.
      const first = (await s.allRecords())!;
      expect(first.map((r) => r.id)).toEqual(sample.ids);
      expect(await s.allRecords()).toEqual(first);
      expect(JSON.stringify(first)).toContain(sample.text);
      for (const r of first) expect(['resolved', 'in_progress', 'pending', 'unknown']).toContain(r.status);
      expect(first).toEqual(await readIndexedRange(s.items.get(id)!, s.files, 0, first.length));

      expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
      expect(s.objects.size).toBe(0); // index chunks, provenance and the original are all removed
      expect(s.items.has(id)).toBe(false);
    });
  }
});

describe('scanned Telugu PDF through the asynchronous worker (real Tesseract)', () => {
  it('extracts every page by OCR, becomes ready only afterwards, and records per-page provenance', { timeout: 120_000 }, async () => {
    const s = service({ engine: () => createTesseractEngine(tessdata) });
    await s.upload('TE-SCAN-001.pdf', pdf('scanned-telugu-2page.pdf'));
    expect(s.json(await s.finalize()).dataset.status).toBe('extracting');
    expect(s.items.get(id)?.status).toBe('extracting');
    expect(await s.worker(id)).toBe('ready');
    const [rec] = (await s.allRecords())!;
    expect(rec).toMatchObject({ id: 'TE-SCAN-001', category: 'Water supply', language: 'te', status: 'unknown' });
    expect(rec.complaintText.replace(/\s+/g, ' ')).toBe('మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు. ప్రభుత్వ అధికారులు వెంటనే చర్యలు తీసుకోవాలి.');
    expect(rec.responseText).toBe('సంబంధిత విభాగానికి సమస్యను పంపించాము. పరిశీలన కొనసాగుతోంది.');
    const prov = JSON.parse(new TextDecoder().decode(s.objects.get('raw/' + id + '/provenance.json')!));
    expect(prov.provenance[0].method).toBe('ocr');
    expect(prov.provenance[0].pages.map((p: { page: number; method: string }) => [p.page, p.method])).toEqual([[1, 'ocr'], [2, 'ocr']]);
  });
});

describe('extraction failure, retry and recovery', () => {
  const failing = async (name: string, bytes: Uint8Array, engine?: () => Promise<OcrEngine>) => {
    const s = service({ engine });
    await s.upload(name, bytes);
    await s.finalize();
    return { s, outcome: await s.worker(id) };
  };
  it('marks corrupt, encrypted and over-long PDFs failed with a clear message; nothing is indexed', async () => {
    for (const [name, bytes, msg] of [
      ['bad.pdf', enc('%PDF-1.4 nonsense'), 'corrupt'],
      ['enc.pdf', pdf('encrypted.pdf'), 'password-protected'],
    ] as const) {
      const { s, outcome } = await failing(name, bytes);
      expect(outcome).toBe('failed');
      expect(s.items.get(id)).toMatchObject({ status: 'failed' });
      expect(s.items.get(id)!.error!.toLowerCase()).toContain(msg);
      expect([...s.objects.keys()].filter((k) => k.includes('index-v1') || k.endsWith('provenance.json'))).toEqual([]);
    }
  });
  it('a scan the OCR cannot read confidently fails the whole document; no text is invented', async () => {
    const engine: OcrEngine = { recognize: async () => ({ text: 'గిజిబిజి', confidence: 12 }), terminate: async () => {} };
    const { s, outcome } = await failing('s.pdf', pdf('scanned-telugu-2page.pdf'), async () => engine);
    expect(outcome).toBe('failed');
    expect(s.items.get(id)!.error).toContain('page(s) 1, 2');
    expect(await s.allRecords()).toBeNull();
  });
  it('OCR running out of time fails cleanly instead of importing a partial document', async () => {
    const engine: OcrEngine = { recognize: async () => ({ text: 'x', confidence: 99 }), terminate: async () => {} };
    const s = service({ engine: async () => engine });
    await s.upload('s.pdf', pdf('scanned-telugu-2page.pdf'));
    await s.finalize();
    expect(await s.worker(id, { deadlineMs: Date.now() - 1 })).toBe('failed');
    expect(s.items.get(id)!.error).toContain('ran out of time');
  });
  it('is idempotent: duplicate delivery after success, or for a deleted/unknown dataset, does nothing', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    expect(await s.worker(id)).toBe('ready');
    const writes = vi.mocked(s.files.write!).mock.calls.length;
    expect(await s.worker(id)).toBe('skipped');
    expect(vi.mocked(s.files.write!).mock.calls.length).toBe(writes);
    expect(await s.worker('ffffffff-ffff-4fff-8fff-ffffffffffff')).toBe('skipped');
  });
  it('recovers from an interrupted attempt: leftover immutable objects are cleared and the retry succeeds', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    // A previous Lambda was killed after writing chunk 0 and provenance.
    s.objects.set(indexChunkKey('raw/' + id + '/source.pdf', 0), enc('[]'));
    s.objects.set('raw/' + id + '/provenance.json', enc('{}'));
    expect(await s.worker(id)).toBe('ready');
    expect((await s.allRecords())![0].id).toBe('EN-PDF-003');
  });
  it('re-throws transient errors so SQS redelivers; the dataset stays extracting and the retry succeeds', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    const read = s.files.read;
    s.files.read = vi.fn().mockRejectedValueOnce(new Error('S3 down')).mockImplementation(read);
    await expect(s.worker(id)).rejects.toThrow('S3 down');
    expect(s.items.get(id)?.status).toBe('extracting');
    expect(await s.worker(id)).toBe('ready');
  });
  it('a failure while writing the index removes what was written and leaves the dataset retryable, never ready', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    const write = s.files.write!;
    s.files.write = vi.fn().mockImplementationOnce(write).mockRejectedValueOnce(new Error('S3 down')).mockImplementation(write);
    await expect(s.worker(id)).rejects.toThrow('S3 down');
    expect(s.items.get(id)?.status).toBe('extracting');
    expect([...s.objects.keys()].filter((k) => k.includes('index-v1') || k.endsWith('provenance.json'))).toEqual([]);
    expect(await s.worker(id)).toBe('ready');
  });
  it('a dead-letter message (retries exhausted) marks the dataset failed so it never stays extracting', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    expect(await s.worker(id, { deadLetter: true })).toBe('failed');
    expect(s.items.get(id)).toMatchObject({ status: 'failed' });
    expect(s.items.get(id)!.error).toContain('upload it again');
  });
  it('a stuck extraction is failed lazily once its deadline passes', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    s.advance(EXTRACTION_DEADLINE_SECONDS + 5);
    const res = s.json(await s.handler(event('GET', '/api/datasets/' + id)));
    expect(res.dataset).toMatchObject({ status: 'failed' });
    expect(res.dataset.error).toContain('did not finish in time');
  });
  it('if the job cannot be queued the upload returns to pending_upload and finalize can be retried', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    vi.mocked((s as any).handler); // handler created with the service queue; replace its send to fail once
    const queue = { send: vi.fn().mockRejectedValueOnce(new Error('SQS down')).mockResolvedValue(undefined) };
    const handler = createDatasetHandler(s.store, s.files, origin, () => T0, () => id, queue);
    const first = await handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
    expect(first.statusCode).toBe(503);
    expect(s.items.get(id)?.status).toBe('pending_upload');
    expect((await handler(event('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(202);
  });
  it('PDF upload is refused when no extraction queue is configured, and nothing changes state', async () => {
    const s = service({ queue: false });
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    expect((await s.finalize()).statusCode).toBe(503);
    expect(s.items.get(id)?.status).toBe('pending_upload');
  });
  it('cannot be deleted while extracting; can be deleted once failed', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(409);
    await s.worker(id, { deadLetter: true });
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
    expect(s.objects.size).toBe(0);
  });
});

describe('validation, limits and security across formats', () => {
  it('rejects unsupported types and per-format oversize at upload time', async () => {
    const s = service();
    expect((await s.upload('x.xlsx', enc('x'))).statusCode).toBe(400);
    expect((await s.upload('x.exe', enc('x'))).statusCode).toBe(400);
    expect((await s.upload('x.txt', enc('x'), LIMITS.bytes.txt + 1)).statusCode).toBe(413);
    expect((await s.upload('x.docx', enc('x'), LIMITS.bytes.docx + 1)).statusCode).toBe(413);
    expect((await s.upload('x.pdf', enc('x'), LIMITS.bytes.pdf + 1)).statusCode).toBe(413);
    expect((await s.upload('x.jsonl', enc('x'), LIMITS.bytes.jsonl + 1)).statusCode).toBe(413);
    expect((await s.upload('x.jsonl', enc('x'), LIMITS.bytes.jsonl)).statusCode).toBe(201);
  });
  it('synchronous formats persist a failed state with a clear message for bad content and never become ready', async () => {
    for (const [name, bytes, expected] of [
      ['bad.docx', enc('not a zip'), 'not a .docx'],
      ['bad.txt', pdf('encrypted.pdf'), 'not the text format'],
      ['bad.jsonl', enc('{"id":"a","complaintText":"x y z"}\n{broken\n'), 'Line 2'],
      ['dup.csv', enc('id,complaintText\nX,one one\nX,two two\n'), 'unique ID'],
    ] as const) {
      const s = service();
      await s.upload(name, bytes);
      const fin = await s.finalize();
      expect(fin.statusCode).toBe(422);
      expect(s.json(fin).error.toLowerCase()).toContain(expected.toLowerCase());
      expect(s.items.get(id)?.status).toBe('failed');
      expect([...s.objects.keys()].filter((k) => k.includes('index-v1'))).toEqual([]);
    }
  });
  it('accepts a 2,000-record CSV into 40 immutable chunks and rejects 2,001 and over-long records (Task 19 bounds)', async () => {
    const rows = (n: number) => 'id,complaintText\n' + Array.from({ length: n }, (_, i) => 'R' + i + ',complaint number ' + i).join('\n');
    const s = service();
    await s.upload('big.csv', enc(rows(2000)));
    expect((await s.finalize()).statusCode).toBe(200);
    expect((await s.allRecords())!.length).toBe(2000);
    expect([...s.objects.keys()].filter((k) => k.includes('index-v1')).length).toBe(2000 / INDEX_CHUNK_RECORDS);
    const t = service();
    await t.upload('big.csv', enc(rows(2001)));
    expect((await t.finalize()).statusCode).toBe(422);
    const u = service();
    await u.upload('long.txt', enc('Complaint:\n' + 'ఫ'.repeat(5000)));
    const res = await u.finalize();
    expect(res.statusCode).toBe(422);
    expect(u.json(res).error).toContain('12 KiB');
    expect(u.json(res).error).not.toContain('ఫ');
  });
  it('error messages and logs never contain document text', async () => {
    const secret = 'గోప్యమైన వ్యక్తిగత సమాచారం';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = service();
    await s.upload('x.csv', enc('id,complaintText\n,' + secret + '\n'));
    const fin = await s.finalize();
    expect(fin.body).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    spy.mockRestore();
  });
  it('finalize is idempotent: a second call is refused and changes nothing', async () => {
    const s = service();
    await s.upload('note.txt', SAMPLES[0].bytes);
    expect((await s.finalize()).statusCode).toBe(200);
    const writes = vi.mocked(s.files.write!).mock.calls.length;
    expect((await s.finalize()).statusCode).toBe(409);
    expect(vi.mocked(s.files.write!).mock.calls.length).toBe(writes);
  });
  it('a failed finalize is recovered by deleting and re-uploading', async () => {
    const s = service();
    await s.upload('bad.docx', enc('nope'));
    expect((await s.finalize()).statusCode).toBe(422);
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
    await s.upload('good.txt', SAMPLES[0].bytes);
    expect((await s.finalize()).statusCode).toBe(200);
  });
  it('requires authentication and ownership for every format, and never exposes another owner’s extraction', async () => {
    const s = service();
    await s.upload('a.pdf', pdf('searchable-english-3page.pdf'));
    await s.finalize();
    expect((await s.handler(event('GET', '/api/datasets/' + id, undefined, false))).statusCode).toBe(401);
    expect((await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}, false))).statusCode).toBe(401);
    s.items.get(id)!.ownerId = 'other-admin';
    expect((await s.handler(event('GET', '/api/datasets/' + id))).statusCode).toBe(404);
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(404);
  });
});

describe('extracted records reach the Qwen analysis pipeline (mocked model, no Bedrock)', () => {
  it('a DOCX, a PDF and a CSV dataset can each be analysed end to end; evidence must be exact source substrings', async () => {
    for (const sample of [SAMPLES[2], SAMPLES[6], SAMPLES[3]]) {
      const s = service();
      await s.upload(sample.name, sample.bytes);
      await s.finalize();
      if (sample.async) await s.worker(id);
      const dataset = s.items.get(id)!;
      expect(dataset.status).toBe('ready');

      const jobs = new Map<string, Job>();
      const jobStore: JobStore = {
        get: async () => [...jobs.values()][0],
        create: async (item: Job) => { if (jobs.size) return false; jobs.set(item.id, item); return true; },
        start: async (jid: string, at: string) => { const j = jobs.get(jid)!; jobs.set(jid, { ...j, status: 'running', startedAt: at }); },
        checkpoint: async (jid: string, expected: number, failed: boolean) => { const j = jobs.get(jid)!; if (j.cursor !== expected) return false; jobs.set(jid, { ...j, cursor: expected + 1, failureCount: j.failureCount + Number(failed) }); return true; },
        complete: async (jid: string, key: string, at: string) => { jobs.set(jid, { ...jobs.get(jid)!, status: 'completed', resultsKey: key, finishedAt: at }); },
        retry: async () => false,
        fail: async () => {},
      } as unknown as JobStore;
      const stored = new Map<number, RecordOutcome>();
      let report: Report | undefined;
      const results: ResultObjects = {
        readRecord: async (_scope: string, index: number) => stored.get(index) ?? null,
        writeRecord: async (_scope: string, index: number, value: RecordOutcome) => { stored.set(index, value); },
        writeReport: async (_scope: string, value: Report) => { report = value; return 'analyses/x/report.json'; },
        readReport: async () => report!,
      } as unknown as ResultObjects;
      const model: Inference = { analyze: vi.fn(async (record: GrievanceRecord) => validateModelOutput({
        id: record.id, complaintSummary: 'నీటి సరఫరా లేదు.', category: 'water', issueClassification: null, requestedAction: null, potentiallyUrgent: false, urgencyReason: null,
        // Exact quotes of the extracted text. A paraphrase here would be rejected by the evidence check.
        complaintEvidence: record.complaintText.slice(0, 20), responseSummary: record.responseText ? 'పరిశీలనలో ఉంది.' : null,
        departmentClaim: null, responseRelevance: record.responseText ? 'inconclusive' : 'not_applicable', responseAssessment: record.responseText ? 'ఆధారాలు సరిపోవడం లేదు.' : null,
        responseEvidence: record.responseText ? record.responseText.slice(0, 15) : null, verifiedOutcome: null, verificationStatus: 'not_verified',
      }, record)) };
      const queue = { send: vi.fn(async () => {}) };
      const api = createAnalysisApi(s.store, s.files, jobStore, queue as never, results, origin, () => new Date(T0));
      const worker = createAnalysisWorker(s.store, s.files, jobStore, queue as never, results, model, () => new Date(T0));
      const start = await api(event('POST', '/api/datasets/' + id + '/analyze'));
      expect(start.statusCode).toBe(202);
      const jobId = s.json(start).job.id as string;
      for (let i = 0; i < 10 && jobs.get(jobId)?.status !== 'completed'; i++) await worker(jobId, false, 0);
      expect(jobs.get(jobId)?.status).toBe('completed');
      expect(model.analyze).toHaveBeenCalledTimes(dataset.recordCount);
      for (const outcome of stored.values()) {
        expect(outcome.analysis?.verifiedOutcome).toBeNull();
        expect(outcome.analysis?.verificationStatus).toBe('not_verified');
      }
      const source = (await s.allRecords())!;
      for (const [index, outcome] of stored) expect(source[index].complaintText).toContain(outcome.analysis!.complaintEvidence);
      expect(report?.stats.grievances).toBe(dataset.recordCount);
    }
  });
});
