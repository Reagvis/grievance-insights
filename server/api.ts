import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createExpandedDataset, createSampleDataset } from '../src/data/demoGrievances';
import { normalizeStatus, type GrievanceRecord } from '../src/domain/grievance';
import type { SummaryOptions } from '../src/domain/summary';
import { buildConsolidatedSummary } from '../src/services/localDemoSummaryService';
import { answerQuestion } from '../src/services/recordAssistant';
import { handleMockBackend } from './mockBackend';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}

export function validateRecords(value: unknown): GrievanceRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10000) {
    throw new ApiError(400, 'Provide between 1 and 10,000 records.');
  }
  const ids = new Set<string>();
  return value.map((item) => {
    const record = object(item);
    if (typeof record.id !== 'string' || !record.id.trim() || typeof record.complaintText !== 'string' || !record.complaintText.trim()) {
      throw new ApiError(400, 'Each record requires a nonempty id and complaintText.');
    }
    if (ids.has(record.id)) throw new ApiError(400, `Duplicate record ID: ${record.id}`);
    ids.add(record.id);
    const text = (key: string) => {
      if (record[key] == null) return null;
      if (typeof record[key] !== 'string') throw new ApiError(400, `${key} must be text or null.`);
      return record[key] as string;
    };
    return {
      id: record.id, complaintText: record.complaintText, responseText: text('responseText'),
      category: text('category'), issueType: text('issueType'), department: text('department'), district: text('district'),
      submittedAt: text('submittedAt'), respondedAt: text('respondedAt'),
      status: normalizeStatus(record.status).status,
      language: record.language === 'te' || record.language === 'en' || record.language === 'mixed' ? record.language : 'unknown',
      sourceType: 'json', isSyntheticDemo: record.isSyntheticDemo === true,
    };
  });
}

export function validateOptions(value: unknown, records: GrievanceRecord[]): SummaryOptions {
  const options = object(value);
  if (options.reportLanguage !== 'en') throw new ApiError(400, 'Local report generation supports English only.');
  if (options.scope !== 'all' && options.scope !== 'filtered') throw new ApiError(400, 'Scope must be all or filtered.');
  if (typeof options.datasetName !== 'string' || !options.datasetName.trim()) throw new ApiError(400, 'datasetName is required.');
  if (options.datasetNotes !== undefined && (!Array.isArray(options.datasetNotes) || !options.datasetNotes.every((note) => typeof note === 'string'))) {
    throw new ApiError(400, 'datasetNotes must be an array of strings.');
  }
  return {
    scope: options.scope, scopeDescription: typeof options.scopeDescription === 'string' ? options.scopeDescription : 'no filters',
    reportLanguage: 'en', datasetName: options.datasetName,
    isSyntheticData: records.every((record) => record.isSyntheticDemo),
    datasetNotes: options.datasetNotes as string[] | undefined,
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'Request exceeds the 32 MB limit.');
    chunks.push(buffer);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Request body must be valid JSON.');
  }
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export async function apiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return next();
  try {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      throw new ApiError(403, 'Only same-origin API requests are accepted.');
    }
    if (url.pathname.startsWith('/api/v1/')) return await handleMockBackend(req, res, url.pathname, url);
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', processingMode: 'server-local', aiConfigured: false });
    }
    if (url.pathname === '/api/records' && req.method === 'GET') {
      const dataset = url.searchParams.get('dataset') === 'expanded' ? createExpandedDataset() : createSampleDataset();
      return json(res, 200, dataset);
    }
    if (!['/api/summary', '/api/assistant'].includes(url.pathname)) throw new ApiError(404, 'API endpoint not found.');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new ApiError(405, 'Use POST for this endpoint.'); }
    if (!req.headers['content-type']?.includes('application/json')) throw new ApiError(415, 'Use Content-Type: application/json.');
    const body = await readBody(req);
    const records = validateRecords(body.records);
    if (url.pathname === '/api/summary') {
      const summary = buildConsolidatedSummary(records, validateOptions(body.options, records));
      summary.processingMode = 'server-local';
      return json(res, 200, summary);
    }
    if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) {
      throw new ApiError(400, 'Provide a question between 1 and 2,000 characters.');
    }
    return json(res, 200, answerQuestion(records, body.question));
  } catch (error) {
    json(res, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'The local API could not process this request.' });
  }
}

export function localApiPlugin(): Plugin {
  return {
    name: 'grievance-local-api',
    configureServer(server) { server.middlewares.use(apiMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware); },
  };
}
