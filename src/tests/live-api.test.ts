import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiMiddleware } from '../../server/api';
import { createSampleDataset } from '../data/demoGrievances';
import { fetchAllComplaints, fetchHealth, HttpChatService, HttpSummaryService, readSse } from '../services/api/backend';
import { ApiError, createApiClient } from '../services/api/http';
import { mapComplaint } from '../services/api/wire';
import { LookupChatService } from '../services/chat';
import { AI_CAVEAT, reportCaveat } from '../utils/summaryExport';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake fetch that records every request and answers from a handler. */
function fakeClient(handler: (url: URL, init: RequestInit) => Response | Promise<Response>, getToken?: () => string | null) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: '/api/v1',
    getToken,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    }) as typeof fetch,
  });
  return { client, calls };
}

describe('wire mapping', () => {
  it('keeps Telugu text verbatim and normalises status', () => {
    const { record } = mapComplaint({ id: 'C-1', complaintText: 'మా గ్రామంలో నీరు లేదు', status: 'Resolved', responseText: '   ' });
    expect(record?.complaintText).toBe('మా గ్రామంలో నీరు లేదు');
    expect(record?.language).toBe('te');
    expect(record?.status).toBe('resolved');
    expect(record?.responseText).toBeNull(); // blank response is "no response", never an empty string
    expect(record?.isSyntheticDemo).toBe(false);
  });
  it('never turns an unrecognised status into resolved', () => {
    expect(mapComplaint({ id: 'C-2', complaintText: 'x', status: 'closed' }).record?.status).toBe('unknown');
    expect(mapComplaint({ id: 'C-3', complaintText: 'x' }).record?.status).toBe('unknown');
  });
  it('reports rows it cannot use instead of inventing them', () => {
    expect(mapComplaint({ complaintText: 'x' }).problem).toMatch(/missing id/);
    expect(mapComplaint({ id: 'C-4', complaintText: '  ' }).problem).toMatch(/C-4/);
    expect(mapComplaint(null).record).toBeNull();
  });
});

describe('http client', () => {
  it('sends the bearer token from the provider and builds the query string', async () => {
    const { client, calls } = fakeClient(() => json({ ok: 1 }), () => 'tok-123');
    await client.json('/x', { query: { limit: 5, cursor: null } });
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok-123');
    expect(calls[0].url.pathname).toBe('/api/v1/x');
    expect(calls[0].url.searchParams.get('limit')).toBe('5');
    expect(calls[0].url.searchParams.has('cursor')).toBe(false);
  });
  it('maps failures to operator-safe messages', async () => {
    const e401 = await fakeClient(() => json({ error: 'secret stack trace' }, 401)).client.json('/x').catch((e: ApiError) => e) as ApiError;
    expect(e401).toBeInstanceOf(ApiError);
    expect(e401.status).toBe(401);
    expect(e401.message).toMatch(/sign/i);
    expect(e401.message).not.toMatch(/stack/);
    const e500 = await fakeClient(() => json({}, 503)).client.json('/x').catch((e: ApiError) => e) as ApiError;
    expect(e500.message).toMatch(/server/i);
    const net = await fakeClient(() => {
      throw new TypeError('fetch failed');
    }).client.json('/x').catch((e: ApiError) => e) as ApiError;
    expect(net.status).toBe(0);
    expect(net.message).toMatch(/cannot reach/i);
  });
  it('rejects an HTML page served where JSON was expected (wrong API address)', async () => {
    const { client } = fakeClient(() => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(client.json('/x')).rejects.toMatchObject({ status: 502 });
  });
});

describe('loading the real collection', () => {
  const item = (n: number) => ({ id: `C-${n}`, complaintText: `ఫిర్యాదు ${n}`, category: 'Roads' });

  it('follows the cursor across pages and reports progress', async () => {
    const progress: number[] = [];
    const { client, calls } = fakeClient((url) => {
      const c = url.searchParams.get('cursor');
      if (!c) return json({ total: 5, nextCursor: 'a', items: [item(1), item(2)] });
      if (c === 'a') return json({ total: 5, nextCursor: 'b', items: [item(3), item(4)] });
      return json({ total: 5, nextCursor: null, items: [item(5)] });
    });
    const { dataset, skipped } = await fetchAllComplaints(client, { onProgress: (p) => progress.push(p.loaded) });
    expect(dataset.records.map((r) => r.id)).toEqual(['C-1', 'C-2', 'C-3', 'C-4', 'C-5']);
    expect(dataset.kind).toBe('live');
    expect(skipped).toEqual([]);
    expect(progress).toEqual([2, 4, 5]);
    expect(calls).toHaveLength(3);
  });

  it('skips incomplete and duplicate rows but says so', async () => {
    const { client } = fakeClient(() => json({ nextCursor: null, items: [item(1), { id: 'C-9' }, item(1), 42] }));
    const { dataset, skipped } = await fetchAllComplaints(client);
    expect(dataset.records).toHaveLength(1);
    expect(skipped).toHaveLength(3);
    expect(skipped.some((s) => s.includes('duplicate'))).toBe(true);
  });

  it('stops a server that never ends its cursor chain', async () => {
    const { client } = fakeClient(() => json({ nextCursor: 'again', items: [] }));
    await expect(fetchAllComplaints(client)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a malformed page', async () => {
    const { client } = fakeClient(() => json({ nope: true }));
    await expect(fetchAllComplaints(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('summary service (scope only, coverage verified)', () => {
  const sample = createSampleDataset().records;
  const options = { scope: 'filtered' as const, scopeDescription: 'category: Roads', reportLanguage: 'en' as const, datasetName: 'X', isSyntheticData: false };
  const report = (ids: string[], extra: object = {}) => ({
    totalRecords: ids.length,
    includedRecordIds: ids,
    categories: [],
    generatedAt: '2026-11-10T00:00:00Z',
    processingMode: 'server-ai',
    ...extra,
  });

  it('sends only the scope, never record text', async () => {
    const ids = sample.slice(0, 3).map((r) => r.id);
    const { client, calls } = fakeClient(() => json(report(ids)));
    const result = await new HttpSummaryService(client).generate(sample.slice(0, 3), options);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toEqual({ scope: { kind: 'filtered', recordIds: ids }, language: 'en' });
    expect(JSON.stringify(sent)).not.toContain('complaintText');
    expect(result.processingMode).toBe('server-ai');
    expect(result.scopeDescription).toBe('category: Roads');
  });

  it('sends kind "all" without a list of IDs', async () => {
    const ids = sample.map((r) => r.id);
    const { client, calls } = fakeClient(() => json(report(ids)));
    await new HttpSummaryService(client).generate(sample, { ...options, scope: 'all' });
    expect(JSON.parse(String(calls[0].init.body)).scope).toEqual({ kind: 'all' });
  });

  it('discards a report whose coverage does not match the request', async () => {
    const ids = sample.slice(0, 3).map((r) => r.id);
    const { client } = fakeClient(() => json(report(ids.slice(0, 2))));
    await expect(new HttpSummaryService(client).generate(sample.slice(0, 3), options)).rejects.toThrow(/discarded/);
  });

  it('discards a report that includes records outside the scope', async () => {
    const asked = sample.slice(0, 2);
    const { client } = fakeClient(() => json(report([asked[0].id, sample[5].id])));
    await expect(new HttpSummaryService(client).generate(asked, options)).rejects.toThrow(/outside the selected scope/);
  });

  it('refuses an incomplete report', async () => {
    const { client } = fakeClient(() => json({ totalRecords: 3 }));
    await expect(new HttpSummaryService(client).generate(sample.slice(0, 3), options)).rejects.toMatchObject({ status: 502 });
  });

  it('labels AI output as AI, and non-AI output as not AI', () => {
    const base = { isSyntheticData: false } as Parameters<typeof reportCaveat>[0];
    expect(reportCaveat({ ...base, processingMode: 'server-ai' })).toBe(AI_CAVEAT);
    expect(reportCaveat({ ...base, processingMode: 'server-local' })).toMatch(/not an AI/i);
  });
});

describe('streaming assistant', () => {
  const sse = (events: unknown[], chunkSize = 7) => {
    const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize)); // splits multi-byte characters
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  it('reassembles Telugu split across network chunks', async () => {
    const text = 'నీటి సరఫరా సమస్యలు';
    const got: string[] = [];
    await readSse(sse([{ type: 'delta', text }]).body!, (d) => got.push(JSON.parse(d).text));
    expect(got).toEqual([text]);
  });

  it('streams deltas and returns citations', async () => {
    const { client } = fakeClient(() =>
      sse([{ type: 'delta', text: 'ఆరోగ్యం ' }, { type: 'delta', text: 'సమస్య' }, { type: 'done', citations: [{ caseId: 'C-1', quote: 'q' }, { nope: true }] }]),
    );
    const seen: string[] = [];
    const result = await new HttpChatService(client).ask({
      messages: [{ role: 'user', content: 'hi' }],
      scope: { kind: 'all' },
      onDelta: (t) => seen.push(t),
    });
    expect(seen).toEqual(['ఆరోగ్యం ', 'సమస్య']);
    expect(result.answer).toBe('ఆరోగ్యం సమస్య');
    expect(result.citations).toEqual([{ caseId: 'C-1', quote: 'q' }]);
  });

  it('also accepts a plain JSON answer', async () => {
    const { client } = fakeClient(() => json({ answer: 'Two complaints.', citations: [{ caseId: 'C-2' }] }));
    const result = await new HttpChatService(client).ask({ messages: [{ role: 'user', content: 'how many' }], scope: { kind: 'all' } });
    expect(result).toEqual({ answer: 'Two complaints.', citations: [{ caseId: 'C-2', quote: undefined }] });
  });

  it('surfaces a stream error instead of showing a half answer as complete', async () => {
    const { client } = fakeClient(() => sse([{ type: 'delta', text: 'part' }, { type: 'error', message: 'Model overloaded' }]));
    await expect(new HttpChatService(client).ask({ messages: [{ role: 'user', content: 'q' }], scope: { kind: 'all' } })).rejects.toThrow('Model overloaded');
  });

  it('sends the conversation and the explicit scope', async () => {
    const { client, calls } = fakeClient(() => json({ answer: 'ok' }));
    await new HttpChatService(client).ask({ messages: [{ role: 'user', content: 'q' }], scope: { kind: 'records', recordIds: ['C-1'] } });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ scope: { kind: 'records', recordIds: ['C-1'] }, messages: [{ role: 'user', content: 'q' }] });
  });

  it('demo lookup assistant respects the chosen scope and is labelled not AI', async () => {
    const records = createSampleDataset().records;
    const svc = new LookupChatService(() => records);
    expect(svc.kind).toBe('lookup');
    expect(svc.label).toMatch(/not AI/);
    const r = await svc.ask({ messages: [{ role: 'user', content: 'show all' }], scope: { kind: 'records', recordIds: [records[0].id] } });
    expect(r.citations.map((c) => c.caseId)).toEqual([records[0].id]);
  });
});

describe('development mock backend over real HTTP (contract check)', () => {
  let server: Server;
  let client: ReturnType<typeof createApiClient>;
  beforeAll(async () => {
    server = createServer((req, res) => {
      void apiMiddleware(req, res, () => {
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    client = createApiClient({ baseUrl: `http://127.0.0.1:${addr.port}/api/v1` });
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('announces itself as a mock with chat available', async () => {
    const h = await fetchHealth(client);
    expect(h.mode).toBe('mock');
    expect(h.capabilities.chat).toBe(true);
  });

  it('serves 2,000 records across several pages', async () => {
    const { dataset, skipped } = await fetchAllComplaints(client);
    expect(dataset.records).toHaveLength(2000);
    expect(skipped).toEqual([]);
    expect(new Set(dataset.records.map((r) => r.id)).size).toBe(2000);
  });

  it('summarises exactly the requested scope', async () => {
    const { dataset } = await fetchAllComplaints(client);
    const subset = dataset.records.slice(100, 140);
    const opts = { scope: 'filtered' as const, scopeDescription: 'test', reportLanguage: 'en' as const, datasetName: 'm', isSyntheticData: true };
    const s = await new HttpSummaryService(client, 'deterministic').generate(subset, opts);
    expect(s.totalRecords).toBe(40);
    expect(s.includedRecordIds.sort()).toEqual(subset.map((r) => r.id).sort());
    const all = await new HttpSummaryService(client, 'deterministic').generate(dataset.records, { ...opts, scope: 'all' });
    expect(all.totalRecords).toBe(2000);
  });

  it('streams an assistant answer with citations that exist in the data', async () => {
    const { dataset } = await fetchAllComplaints(client);
    const deltas: string[] = [];
    const result = await new HttpChatService(client).ask({
      messages: [{ role: 'user', content: 'Which complaints have no response?' }],
      scope: { kind: 'all' },
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(result.answer);
    const ids = new Set(dataset.records.map((r) => r.id));
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every((c) => ids.has(c.caseId))).toBe(true);
  });

  it('rejects bad requests with a readable error', async () => {
    await expect(client.json('/summary', { body: { scope: { kind: 'nonsense' } } })).rejects.toMatchObject({ status: 400 });
    await expect(client.json('/nope')).rejects.toMatchObject({ status: 404 });
  });
});
