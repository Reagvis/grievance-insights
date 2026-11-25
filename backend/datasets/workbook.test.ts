import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createDatasetHandler, type DatasetStore, type Metadata, type PrivateObjects } from './core';
import { createDocumentChatApi } from '../analysis/chat';
import { worksheetKey } from './workbook';
import { mixedWorkbook, row, sheetXml, simple, textCell, workbookParts, zipParts } from '../ingest/xlsx-fixtures';

const origin = 'https://pilot.invalid';
const now = 1800000000000;
const ids = ['12345678-abcd-4f12-9abc-123456789abc', 'abcdef12-abcd-4f12-9abc-123456789abc'] as const;
const tokens = ['A'.repeat(43), 'B'.repeat(43)];
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const user = (i: number) => 'synthetic-user-' + i;
function event(method: string, path: string, i = 0, body?: unknown, query?: Record<string, string>, requestOrigin = origin): APIGatewayProxyEventV2 {
  return { headers: { origin: requestOrigin, 'content-type': 'application/json' }, cookies: ['__Host-grievance_session=' + tokens[i]],
    requestContext: { http: { method, path } }, body: body === undefined ? undefined : JSON.stringify(body), queryStringParameters: query, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}
const json = (r: { body?: string }) => JSON.parse(r.body ?? '{}');
const path = (i: number) => '/api/datasets/' + ids[i];
const ask = (i: number, sheetIndex: number, row?: number, actor = i) => event('POST', path(i) + '/chat', actor, { sheetIndex, row, messages: [{ role: 'user', content: 'Summarise the selected worksheet.' }] });
function fixture() {
  const metadata = new Map<string, Metadata>(), storage = new Map<string, Uint8Array>();
  let next = 0;
  const store: DatasetStore = {
    session: vi.fn(async h => { const i = tokens.findIndex(t => hash(t) === h); return i < 0 ? undefined : { userId: user(i), expiresAt: now / 1000 + 600 }; }),
    get: vi.fn(async id => metadata.get(id)),
    list: async () => [...metadata.values()],
    create: async item => { metadata.set(item.id, item); },
    transition: async (id, from, to, patch) => { const m = metadata.get(id); if (!m || m.status !== from) return false; metadata.set(id, { ...m, ...patch, status: to }); return true; },
    delete: async id => { metadata.delete(id); },
  };
  const objects: PrivateObjects = {
    presign: vi.fn(async () => ({ url: 'https://private.invalid/upload', headers: { 'if-none-match': '*' } })),
    size: async key => storage.get(key)?.length ?? null,
    read: vi.fn(async key => { const bytes = storage.get(key); if (!bytes) throw new Error('Missing object'); return bytes; }),
    write: vi.fn(async (key, bytes) => { if (storage.has(key)) throw new Error('Immutable'); storage.set(key, bytes); }),
    remove: async key => { storage.delete(key); },
  };
  const api = createDatasetHandler(store, objects, origin, () => now, () => {
    const id = ids[next++];
    if (!id) throw new Error('Synthetic UUID fixtures exhausted');
    return id;
  });
  const model = vi.fn(async (_system: string, _prompt: string, _timeout: number) => 'Synthetic model answer');
  const chat = createDocumentChatApi(store, objects, model, origin, () => now);
  async function upload(i: number, bytes: Uint8Array, name = 'synthetic.xlsx') {
    const start = await api(event('POST', '/api/datasets/uploads', i, { name, bytes: bytes.length }));
    expect(start.statusCode).toBe(201);
    storage.set(metadata.get(ids[i])!.key, bytes);
    return api(event('POST', path(i) + '/finalize', i, {}));
  }
  return { store, objects, storage, metadata, api, chat, model, upload };
}

describe('private workbook upload, worksheet API and model chat', () => {
  it('finalizes mixed XLSX, returns only genuine grievances, and retrieves typed worksheets', async () => {
    const f = fixture(), bytes = mixedWorkbook();
    const final = await f.upload(0, bytes);
    expect(final.statusCode).toBe(200);
    expect(json(final).dataset).toMatchObject({ format: 'xlsx', status: 'ready', recordCount: 1 });
    const file = f.metadata.get(ids[0])!;
    expect(file.sheets).toHaveLength(2);
    expect(f.storage.get(file.key)).toBe(bytes);
    expect(f.storage.has(worksheetKey(file.key, 0))).toBe(true);
    expect(f.storage.has(worksheetKey(file.key, 1))).toBe(true);
    expect(json(await f.api(event('GET', path(0)))).records).toMatchObject([{ id: 'SYN-1', worksheetSource: { sheetIndex: 1, row: 2 } }]);
    const data = await f.api(event('GET', path(0), 0, undefined, { sheet: '0' }));
    expect(data.statusCode).toBe(200);
    expect(json(data).worksheet.data[0].cells[1].value).toBe('9007199254740993.10');
    expect((await f.api(event('GET', path(0), 0, undefined, { sheet: '2' }))).statusCode).toBe(404);
    expect((await f.api(event('GET', path(0), 0, undefined, { sheet: '0' }, 'https://evil.invalid'))).statusCode).toBe(403);
    expect((await f.api(event('DELETE', path(0)))).statusCode).toBe(204);
    expect(f.storage.size).toBe(0);
    expect(f.metadata.size).toBe(0);
  });
  it('keeps general tables discoverable with zero complaints, and prevents cross-owner reads and inference', async () => {
    const f = fixture();
    expect((await f.upload(0, mixedWorkbook())).statusCode).toBe(200);
    const secret = sheetXml(row(1, textCell('A1', 'Private metric')) + row(2, textCell('A2', 'PRIVATE-B-ONLY')));
    expect((await f.upload(1, zipParts(workbookParts([{ name: 'Private B', xml: secret }])))).statusCode).toBe(200);
    expect(json(await f.api(event('GET', path(1), 1))).records).toEqual([]);
    const list = json(await f.api(event('GET', '/api/datasets', 1))).datasets;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: ids[1], recordCount: 0, sheets: [{ kind: 'table' }] });
    vi.mocked(f.objects.read).mockClear();
    expect((await f.api(event('GET', path(1), 0, undefined, { sheet: '0' }))).statusCode).toBe(404);
    expect((await f.chat(ask(1, 0, 2, 0))).statusCode).toBe(404);
    expect((await f.chat(ask(0, 1, 2, 1))).statusCode).toBe(404);
    expect((await f.api(event('DELETE', path(1), 0))).statusCode).toBe(404);
    expect(f.objects.read).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
    expect((await f.chat(ask(0, 0))).statusCode).toBe(200);
    const [system, prompt] = f.model.mock.calls[0];
    expect(system).toContain('not necessarily grievances');
    expect(prompt).toContain('9007199254740993');
    expect(prompt).not.toContain('నీటి సరఫరా సమస్య');
    expect(prompt).not.toContain('PRIVATE-B-ONLY');
    expect((await f.chat(ask(0, 1, 2))).statusCode).toBe(200);
    expect(f.model.mock.calls[1][1]).toContain('నీటి సరఫరా సమస్య');
    expect(f.model.mock.calls[1][1]).not.toContain('9007199254740993');
    expect((await f.chat(ask(1, 0, 2))).statusCode).toBe(200);
    expect(f.model.mock.calls[2][1]).toContain('PRIVATE-B-ONLY');
  });
  it('rejects forged scope combinations, invalid rows and sheets, missing selection and expired sessions', async () => {
    const f = fixture();
    await f.upload(0, mixedWorkbook());
    expect((await f.chat(ask(0, 7))).statusCode).toBe(404);
    expect((await f.chat(ask(0, 0, 99))).statusCode).toBe(404);
    expect((await f.chat(ask(0, -1))).statusCode).toBe(400);
    expect((await f.chat(ask(0, 0, 1))).statusCode).toBe(400);
    const messages = [{ role: 'user', content: 'Question' }];
    expect((await f.chat(event('POST', path(0) + '/chat', 0, { messages }))).statusCode).toBe(422);
    expect((await f.chat(event('POST', path(0) + '/chat', 0, { messages, sheetIndex: 0, recordId: 'SYN-1' }))).statusCode).toBe(400);
    vi.mocked(f.store.session).mockResolvedValueOnce({ userId: user(0), expiresAt: now / 1000 });
    expect((await f.chat(ask(0, 0))).statusCode).toBe(401);
    expect(f.model).not.toHaveBeenCalled();
    // The old complaint selector still works and carries source coordinates.
    expect((await f.chat(event('POST', path(0) + '/chat', 0, { messages, recordId: 'SYN-1', recordIndex: 0 }))).statusCode).toBe(200);
    expect(f.model.mock.calls[0][1]).toContain('worksheetSource');
  });
  it('revalidates ownership/session after reads and rejects source/prompt overflow without calling model', async () => {
    const f = fixture();
    const cells = Array.from({ length: 8 }, (_, i) => textCell(String.fromCharCode(65 + i) + '2', 'x'.repeat(3900))).join('');
    const header = Array.from({ length: 8 }, (_, i) => textCell(String.fromCharCode(65 + i) + '1', 'H' + i)).join('');
    expect((await f.upload(0, zipParts(workbookParts([{ name: 'Large row', xml: sheetXml(row(1, header) + row(2, cells)) }])))).statusCode).toBe(200);
    expect((await f.chat(ask(0, 0, 2))).statusCode).toBe(422);
    expect((await f.chat(event('POST', path(0) + '/chat', 0, { sheetIndex: 0, messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(4000) })) }))).statusCode).toBe(413);
    expect(f.model).not.toHaveBeenCalled();
    const m = f.metadata.get(ids[0])!;
    vi.mocked(f.store.get).mockResolvedValueOnce(m).mockResolvedValueOnce({ ...m, ownerId: user(1) });
    expect((await f.chat(ask(0, 0))).statusCode).toBe(409);
    expect(f.model).not.toHaveBeenCalled();
    vi.mocked(f.store.session).mockResolvedValueOnce({ userId: user(0), expiresAt: now / 1000 + 60 }).mockResolvedValueOnce(undefined);
    expect((await f.chat(ask(0, 0))).statusCode).toBe(401);
    expect(f.model).not.toHaveBeenCalled();
  });
  it('rolls back partial workbook writes and preserves CSV upload/finalize', async () => {
    const f = fixture();
    vi.mocked(f.objects.write!).mockRejectedValueOnce(new Error('S3 unavailable'));
    expect((await f.upload(0, mixedWorkbook())).statusCode).toBe(422);
    expect(f.metadata.get(ids[0])?.status).toBe('failed');
    expect([...f.storage.keys()]).toEqual(['raw/' + ids[0] + '/source.xlsx']);
    expect((await f.api(event('DELETE', path(0)))).statusCode).toBe(204);
    expect(f.storage.size).toBe(0);
    expect((await f.upload(1, new TextEncoder().encode('id,complaintText\nCSV-1,Original CSV complaint\n'), 'legacy.csv')).statusCode).toBe(200);
    expect(json(await f.api(event('GET', path(1), 1))).records).toMatchObject([{ id: 'CSV-1', complaintText: 'Original CSV complaint' }]);
  });
  it('rejects invalid uploaded .xlsx rather than marking it ready', async () => {
    const f = fixture();
    expect((await f.upload(0, new TextEncoder().encode('not a workbook'))).statusCode).toBe(422);
    expect(f.metadata.get(ids[0])?.status).toBe('failed');
    expect((await f.upload(1, zipParts(workbookParts([{ name: 'Simple', xml: simple }])))).statusCode).toBe(200);
    expect(json(await f.api(event('GET', path(1), 1))).records).toEqual([]);
  });
});
