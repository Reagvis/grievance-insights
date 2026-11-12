import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, it, expect, vi } from 'vitest';
import { ApiError, createDatasetHandler, validateDataset, type DatasetStore, type Metadata, type PrivateObjects } from './core';

const id = '01234567-89ab-4cde-8fab-0123456789ab';
const cookie = 'A'.repeat(43);
const hash = createHash('sha256').update(cookie).digest('hex');
const origin = 'https://telangana-gov-pilot.reagvis.com';
const now = 1800000000000;
const utf8 = (s: string) => new TextEncoder().encode(s);
const csv = 'id,complaintText,responseText,status\nGRV-1,మా గ్రామంలో నీరు లేదు,పరిశీలనలో ఉంది,pending\n';
function event(method: string, path: string, authenticated = true, data?: object): APIGatewayProxyEventV2 {
  return { headers: { origin, 'content-type': 'application/json' }, cookies: authenticated ? ['__Host-grievance_session=' + cookie] : [], body: data === undefined ? undefined : JSON.stringify(data), requestContext: { http: { method, path } }, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}
function fixture() {
  const items = new Map<string, Metadata>();
  const file = utf8(csv);
  let stored: Uint8Array | null = file;
  const indexed = new Map<string, Uint8Array>();
  const store: DatasetStore = {
    session: vi.fn(async (value) => value === hash ? { userId: 'admin-1', expiresAt: now / 1000 + 100 } : undefined),
    create: vi.fn(async (item) => { items.set(item.id, item); }),
    get: vi.fn(async (key) => items.get(key)),
    list: vi.fn(async () => Array.from(items.values())),
    transition: vi.fn(async (key, from, to, patch) => {
      const item = items.get(key);
      if (!item || item.status !== from) return false;
      items.set(key, { ...item, ...patch, status: to });
      return true;
    }),
    delete: vi.fn(async (key) => { items.delete(key); }),
  };
  const objects: PrivateObjects = {
    presign: vi.fn(async () => ({ url: 'https://s3.example.invalid/presigned', headers: { 'if-none-match': '*' } })),
    size: vi.fn(async () => stored?.byteLength ?? null),
    read: vi.fn(async (key) => {
      if (key.endsWith('/source.csv')) { if (!stored) throw new Error('missing'); return stored; }
      const chunk = indexed.get(key);
      if (!chunk) throw new Error('missing index');
      return chunk;
    }),
    write: vi.fn(async (key, bytes) => { if (indexed.has(key)) throw new Error('immutable'); indexed.set(key, bytes); }),
    remove: vi.fn(async (key) => { if (key.endsWith('/source.csv')) stored = null; else indexed.delete(key); }),
  };
  const handler = createDatasetHandler(store, objects, origin, () => now, () => id);
  return { items, store, objects, handler, setFile: (next: Uint8Array | null) => { stored = next; } };
}
const data = (res: { body?: string }) => JSON.parse(res.body ?? '{}') as Record<string, any>;
describe('private dataset validation', () => {
  it('preserves Telugu Unicode in CSV and JSON', () => {
    const row = validateDataset('data.csv', 'csv', utf8(csv))[0];
    expect(row.complaintText).toBe('మా గ్రామంలో నీరు లేదు');
    expect(row.responseText).toBe('పరిశీలనలో ఉంది');
    expect(validateDataset('data.json', 'json', utf8(JSON.stringify([{ id: 'GRV-1', complaintText: row.complaintText }])))[0].complaintText).toBe(row.complaintText);
  });
  it('rejects missing IDs, duplicates, malformed UTF-8 and large files', () => {
    for (const content of ['id,complaintText\n,missing', 'id,complaintText\n1,a\n1,b', '{invalid']) {
      expect(() => validateDataset('data.' + (content[0] === '{' ? 'json' : 'csv'), content[0] === '{' ? 'json' : 'csv', utf8(content))).toThrow(ApiError);
    }
    expect(() => validateDataset('x.csv', 'csv', new Uint8Array([255, 254]))).toThrow(ApiError);
    expect(() => validateDataset('x.csv', 'csv', new Uint8Array(20 * 1024 * 1024 + 1))).toThrow(ApiError);
    expect(() => validateDataset('x.csv', 'csv', utf8('id,complaintText\n' + Array.from({ length: 2001 }, (_, i) => i + ',test').join('\n')))).toThrow(ApiError);
    const huge = utf8('id,complaintText\nGR-1,' + 'అ'.repeat(2_600_000));
    expect(huge.length).toBeGreaterThan(6 * 1024 * 1024);
    expect(() => validateDataset('x.csv', 'csv', huge)).toThrow(/12 KiB AI-input limit/);
    expect(() => validateDataset('x.json', 'json', utf8(JSON.stringify([{ id: 'GR-1', complaintText: 'అ'.repeat(6000) }])))).toThrow(/12 KiB AI-input limit/);
  });
});
describe('authenticated dataset lifecycle', () => {
  it('requires server-side session on every route', async () => {
    const { handler, store } = fixture();
    for (const [method, path] of [['GET','/api/datasets'],['POST','/api/datasets/uploads'],['GET','/api/datasets/' + id],['DELETE','/api/datasets/' + id],['POST','/api/datasets/' + id + '/finalize']]) {
      expect((await handler(event(method, path, false))).statusCode).toBe(401);
    }
    expect(store.list).not.toHaveBeenCalled();
  });
  it('creates, finalizes, lists, retrieves and deletes', async () => {
    const { handler, objects } = fixture();
    const create = await handler(event('POST', '/api/datasets/uploads', true, { name: 'pilot.csv', bytes: utf8(csv).length }));
    expect(create.statusCode).toBe(201);
    expect(data(create).dataset.status).toBe('pending_upload');
    expect(data(create).upload.headers['if-none-match']).toBe('*');
    expect((await handler(event('GET','/api/datasets'))).statusCode).toBe(200);
    expect((await handler(event('GET','/api/datasets/' + id))).statusCode).toBe(200);
    const finalize = await handler(event('POST', '/api/datasets/' + id + '/finalize'));
    expect(data(finalize).dataset.status).toBe('ready');
    expect(data(await handler(event('GET', '/api/datasets/' + id))).records[0].id).toBe('GRV-1');
    expect(data(await handler(event('GET', '/api/datasets'))).datasets[0].recordCount).toBe(1);
    expect((await handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(204);
    expect(objects.remove).toHaveBeenCalled();
    expect((await handler(event('GET', '/api/datasets/' + id))).statusCode).toBe(404);
  });
  it('rejects mismatched upload sizes and persists failed validation state', async () => {
    const f = fixture();
    await f.handler(event('POST','/api/datasets/uploads',true,{ name:'pilot.csv', bytes:1 }));
    const response = await f.handler(event('POST', '/api/datasets/' + id + '/finalize'));
    expect(response.statusCode).toBe(422);
    expect(data(await f.handler(event('GET', '/api/datasets'))).datasets[0].status).toBe('failed');
  });
  it('does not delete metadata when object deletion fails', async () => {
    const f = fixture();
    await f.handler(event('POST','/api/datasets/uploads',true,{ name:'pilot.csv', bytes:utf8(csv).length }));
    vi.mocked(f.objects.remove).mockRejectedValueOnce(new Error('storage down'));
    expect((await f.handler(event('DELETE', '/api/datasets/' + id))).statusCode).toBe(500);
    expect(f.items.has(id)).toBe(true);
  });
  it('prevents wrong owner from reading records', async () => {
    const f = fixture();
    await f.handler(event('POST','/api/datasets/uploads',true,{ name:'pilot.csv', bytes:utf8(csv).length }));
    f.items.get(id)!.ownerId = 'different-admin';
    expect((await f.handler(event('GET','/api/datasets/' + id))).statusCode).toBe(404);
    expect(data(await f.handler(event('GET','/api/datasets'))).datasets).toEqual([]);
  });
  it('requires the production origin for mutations and enforces file limits', async () => {
    const f = fixture();
    const foreign = event('POST','/api/datasets/uploads',true,{ name:'pilot.csv', bytes:10 });
    foreign.headers.origin = 'https://evil.example';
    expect((await f.handler(foreign)).statusCode).toBe(403);
    expect((await f.handler(event('POST','/api/datasets/uploads',true,{ name:'pilot.csv', bytes:20 * 1048576 + 1 }))).statusCode).toBe(413);
  });
});
