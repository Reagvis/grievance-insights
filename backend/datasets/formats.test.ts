import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { canonicalKey, createDatasetHandler, loadRecords, type DatasetStore, type Metadata, type PrivateObjects } from './core';
import { LIMITS } from '../ingest';

const id = '01234567-89ab-4cde-8fab-0123456789ab';
const cookie = 'A'.repeat(43);
const hash = createHash('sha256').update(cookie).digest('hex');
const origin = 'https://telangana-gov-pilot.reagvis.com';
const now = 1800000000000;
const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (name: string) => new Uint8Array(readFileSync(new URL('../ingest/fixtures/' + name, import.meta.url)));

const TE = 'మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.';
const TE_RESP = 'సంబంధిత విభాగానికి సమస్యను పంపించాము.';

function docx(): Uint8Array {
  const p = (t: string) => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + p('Case ID: DOCX-1') + p('Complaint:') + p(TE) + p('Response:') + p(TE_RESP) + '</w:body></w:document>'),
  });
}

/** One sample upload per supported format, and the record ID it must produce. */
const SAMPLES: Array<{ name: string; bytes: Uint8Array; ids: string[] }> = [
  { name: 'note.txt', bytes: enc('Case ID: TXT-1\nComplaint:\n' + TE + '\nResponse:\n' + TE_RESP), ids: ['TXT-1'] },
  { name: 'note.md', bytes: enc('**Case ID:** MD-1\n\n## Complaint\n\n' + TE + '\n\n## Response\n\n' + TE_RESP), ids: ['MD-1'] },
  { name: 'note.docx', bytes: docx(), ids: ['DOCX-1'] },
  { name: 'set.csv', bytes: enc('id,complaintText,responseText\nCSV-1,' + TE + ',' + TE_RESP + '\nCSV-2,second complaint text,\n'), ids: ['CSV-1', 'CSV-2'] },
  { name: 'set.json', bytes: enc(JSON.stringify([{ id: 'JSON-1', complaintText: TE, responseText: TE_RESP }, { id: 'JSON-2', complaintText: 'second complaint text' }])), ids: ['JSON-1', 'JSON-2'] },
  { name: 'set.jsonl', bytes: enc('{"id":"JL-1","complaintText":"' + TE + '","responseText":"' + TE_RESP + '"}\n{"id":"JL-2","complaintText":"second complaint text"}\n'), ids: ['JL-1', 'JL-2'] },
  { name: 'TE-PDF-001.pdf', bytes: pdf('searchable-telugu-2page.pdf'), ids: ['TE-PDF-001'] },
];

function event(method: string, path: string, data?: object, authenticated = true): APIGatewayProxyEventV2 {
  return { headers: { origin, 'content-type': 'application/json' }, cookies: authenticated ? ['__Host-grievance_session=' + cookie] : [], body: data === undefined ? undefined : JSON.stringify(data), requestContext: { http: { method, path } }, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}
function service() {
  const items = new Map<string, Metadata>();
  const objects = new Map<string, Uint8Array>();
  const store: DatasetStore = {
    session: async (h) => (h === hash ? { userId: 'admin-1', expiresAt: now / 1000 + 100 } : undefined),
    create: async (item) => { items.set(item.id, item); },
    get: async (key) => items.get(key),
    list: async () => [...items.values()],
    transition: async (key, from, to, patch) => { const it = items.get(key); if (!it || it.status !== from) return false; items.set(key, { ...it, ...patch, status: to }); return true; },
    delete: async (key) => { items.delete(key); },
  };
  const files: PrivateObjects = {
    presign: vi.fn(async (_key, format) => ({ url: 'https://s3.example.invalid/x', headers: { 'if-none-match': '*', 'content-type': 'x/' + format } })),
    size: async (key) => objects.get(key)?.byteLength ?? null,
    read: async (key) => { const v = objects.get(key); if (!v) throw new Error('missing'); return v; },
    remove: async (key) => { objects.delete(key); },
    write: vi.fn(async (key, bytes) => { objects.set(key, bytes); }),
  };
  const handler = createDatasetHandler(store, files, origin, () => now, () => id);
  /** Simulates the browser's direct PUT to the presigned URL. */
  const upload = async (name: string, bytes: Uint8Array, declared = bytes.length) => {
    const created = await handler(event('POST', '/api/datasets/uploads', { name, bytes: declared }));
    if (created.statusCode === 201) objects.set('raw/' + id + '/source.' + name.split('.').pop()!.toLowerCase(), bytes);
    return created;
  };
  const json = (r: { body?: string }) => JSON.parse(r.body ?? '{}') as Record<string, any>;
  return { items, objects, files, handler, upload, json };
}

describe('every supported format through upload → finalize → retrieve → delete', () => {
  for (const sample of SAMPLES) {
    it(sample.name, async () => {
      const s = service();
      const created = await s.upload(sample.name, sample.bytes);
      expect(created.statusCode).toBe(201);
      expect(s.json(created).dataset.status).toBe('pending_upload');

      const fin = await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
      expect(fin.statusCode).toBe(200);
      expect(s.json(fin).dataset).toMatchObject({ status: 'ready', recordCount: sample.ids.length, format: sample.name.split('.').pop() });

      // The canonical extraction is stored privately next to the untouched original.
      expect(s.objects.has(canonicalKey(id))).toBe(true);
      expect(s.objects.get('raw/' + id + '/source.' + sample.name.split('.').pop())).toBe(sample.bytes);

      // "Refresh": a fresh GET returns the same persisted records; Telugu is intact.
      const first = s.json(await s.handler(event('GET', '/api/datasets/' + id)));
      const again = s.json(await s.handler(event('GET', '/api/datasets/' + id)));
      expect(first.records.map((r: { id: string }) => r.id)).toEqual(sample.ids);
      expect(again.records).toEqual(first.records);
      expect(JSON.stringify(first.records)).toContain(sample.name.endsWith('.pdf') ? 'మా వీధిలో' : TE);

      // The analysis worker reads through the same loader and gets identical records.
      const meta = s.items.get(id)!;
      expect(await loadRecords(meta, s.files)).toEqual(first.records);
      // No verified-resolution claim is ever produced at ingestion.
      for (const r of first.records) expect(['resolved', 'in_progress', 'pending', 'unknown']).toContain(r.status);

      expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
      expect(s.objects.size).toBe(0); // original AND derived data removed
    });
  }
});

describe('failure paths', () => {
  it('rejects unsupported types and per-format oversize at upload time', async () => {
    const s = service();
    expect((await s.upload('x.xlsx', enc('x'))).statusCode).toBe(400);
    expect((await s.upload('x.exe', enc('x'))).statusCode).toBe(400);
    expect((await s.upload('x.txt', enc('x'), LIMITS.bytes.txt + 1)).statusCode).toBe(413);
    expect((await s.upload('x.pdf', enc('x'), LIMITS.bytes.pdf + 1)).statusCode).toBe(413);
    expect((await s.upload('x.pdf', enc('x'), LIMITS.bytes.pdf)).statusCode).toBe(201); // limits differ per format
  });
  it('persists a failed state with a clear message for corrupt files and mislabeled content, never ready', async () => {
    for (const [name, bytes, expected] of [
      ['bad.pdf', enc('%PDF-1.4 nonsense'), 'corrupt'],
      ['bad.docx', enc('not a zip'), 'not a .docx'],
      ['bad.txt', pdf('encrypted.pdf'), 'not the text format'],
      ['enc.pdf', pdf('encrypted.pdf'), 'password-protected'],
      ['bad.jsonl', enc('{"id":"a","complaintText":"x y z"}\n{broken\n'), 'Line 2'],
    ] as const) {
      const s = service();
      await s.upload(name, bytes);
      const fin = await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
      expect(fin.statusCode).toBe(422);
      expect(s.json(fin).error.toLowerCase()).toContain(expected.toLowerCase());
      expect(s.items.get(id)?.status).toBe('failed');
      expect(s.objects.has(canonicalKey(id))).toBe(false);
    }
  });
  it('scanned and damaged-text PDFs are refused with an OCR message while OCR is disabled, never imported blank', async () => {
    for (const f of ['scanned-telugu-2page.pdf', 'damaged-conjunct-telugu-1page.pdf']) {
      const s = service();
      await s.upload(f, pdf(f));
      const fin = await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
      expect(fin.statusCode).toBe(422);
      expect(s.json(fin).error).toContain('OCR is not enabled');
      expect(s.items.get(id)?.status).toBe('failed');
      expect(s.objects.has(canonicalKey(id))).toBe(false);
    }
  });
  it('error messages and logs never contain document text', async () => {
    const secret = 'గోప్యమైన వ్యక్తిగత సమాచారం';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = service();
    await s.upload('x.csv', enc('id,complaintText\n,' + secret + '\n'));
    const fin = await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
    expect(fin.body).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    spy.mockRestore();
  });
  it('finalize is idempotent: a second call is refused and changes nothing', async () => {
    const s = service();
    await s.upload('note.txt', SAMPLES[0].bytes);
    expect((await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(200);
    const writes = vi.mocked(s.files.write).mock.calls.length;
    expect((await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(409);
    expect(vi.mocked(s.files.write).mock.calls.length).toBe(writes);
  });
  it('a failed finalize can be retried by deleting and re-uploading', async () => {
    const s = service();
    await s.upload('bad.pdf', enc('%PDF-1.4 nonsense'));
    expect((await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(422);
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
    await s.upload('good.txt', SAMPLES[0].bytes);
    expect((await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}))).statusCode).toBe(200);
  });
  it('requires authentication and ownership for every format', async () => {
    const s = service();
    await s.upload('note.docx', docx());
    await s.handler(event('POST', '/api/datasets/' + id + '/finalize', {}));
    expect((await s.handler(event('GET', '/api/datasets/' + id, undefined, false))).statusCode).toBe(401);
    s.items.get(id)!.ownerId = 'other-admin';
    expect((await s.handler(event('GET', '/api/datasets/' + id))).statusCode).toBe(404);
    expect((await s.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(404);
    expect(s.objects.size).toBeGreaterThan(0);
  });
  it('legacy datasets stored before canonical extraction still load from the original CSV', async () => {
    const s = service();
    await s.upload('old.csv', enc('id,complaintText\nOLD-1,legacy complaint text\n'));
    s.items.set(id, { ...s.items.get(id)!, status: 'ready', recordCount: 1 });
    expect(s.objects.has(canonicalKey(id))).toBe(false);
    expect(s.json(await s.handler(event('GET', '/api/datasets/' + id))).records[0].id).toBe('OLD-1');
  });
});
