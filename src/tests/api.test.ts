import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { apiMiddleware } from '../../server/api';
import { createSampleDataset } from '../data/demoGrievances';

const dataset = createSampleDataset();
let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => { void apiMiddleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const options = { scope: 'all', scopeDescription: 'no filters', reportLanguage: 'en', datasetName: dataset.name };

describe('local HTTP API', () => {
  it('reports health and returns the sample dataset', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ status: 'ok', aiConfigured: false });
    expect((await (await fetch(`${base}/api/records`)).json()).records).toHaveLength(30);
  });
  it('generates a source-grounded summary and supports filtered scopes', async () => {
    const records = dataset.records.slice(0, 4);
    const response = await post('/api/summary', { records, options: { ...options, scope: 'filtered' } });
    expect(response.status).toBe(200);
    const summary = await response.json();
    expect(summary).toMatchObject({ totalRecords: 4, scope: 'filtered', processingMode: 'server-local', isSyntheticData: true });
    expect(summary.includedRecordIds).toEqual(records.map((record) => record.id));
    expect(summary.resolvedCount).toBe(records.filter((record) => record.status === 'resolved').length);
  });
  it('looks up a case and preserves Telugu source text', async () => {
    const record = dataset.records[0];
    const response = await post('/api/assistant', { records: dataset.records, question: `Summarise ${record.id}` });
    const answer = await response.json();
    expect(answer.totalMatches).toBe(1);
    expect(answer.sources[0].complaintText).toBe(record.complaintText);
  });
  it('filters missing-response questions without treating responses as resolution', async () => {
    const response = await post('/api/assistant', { records: dataset.records, question: 'Which water supply complaints have no response?' });
    const answer = await response.json();
    expect(answer.totalMatches).toBe(dataset.records.filter((record) => record.category === 'Water supply' && !record.responseText?.trim()).length);
    expect(answer.sources.every((record: { responseText: string | null }) => !record.responseText?.trim())).toBe(true);
  });
  it('rejects invalid JSON, missing records, duplicates, and unsupported languages', async () => {
    expect((await post('/api/summary', { records: [], options })).status).toBe(400);
    expect((await post('/api/summary', { records: [dataset.records[0], dataset.records[0]], options })).status).toBe(400);
    expect((await post('/api/summary', { records: dataset.records, options: { ...options, reportLanguage: 'te' } })).status).toBe(400);
    expect((await fetch(`${base}/api/summary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status).toBe(400);
  });
  it('rejects cross-origin requests, unsupported methods, and unknown endpoints', async () => {
    expect((await fetch(`${base}/api/health`, { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    expect((await fetch(`${base}/api/summary`)).status).toBe(405);
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });
});
