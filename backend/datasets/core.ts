import { randomUUID, createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { decodeUtf8, parseCsvImport, parseJsonImport } from '../../src/utils/importer';
import { validateRecordBounds } from './bounds';
import { readIndexedRange, removeDatasetIndex, INDEX_CHUNK_RECORDS } from './index';
import { commitDataset, provenanceKey } from './commit';
import { formatFromName, ingestDocument, IngestError, LIMITS as INGEST_LIMITS, SOURCE_FORMATS, type SourceFormat } from '../ingest';

export const MAX_DATASET_BYTES = 20 * 1024 * 1024;
export const MAX_DATASET_RECORDS = 2000;
export const UPLOAD_TTL_SECONDS = 300;
const COOKIE = '__Host-grievance_session';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Status = 'pending_upload' | 'validating' | 'extracting' | 'ready' | 'failed';
/** How long a PDF may stay `extracting` (seconds). Lambda timeout is 300 s and the queue retries 3 times; this is the lazy safety net. */
export const EXTRACTION_DEADLINE_SECONDS = 3600;
export type Metadata = { id: string; key: string; name: string; format: SourceFormat; status: Status; createdAt: string; bytes: number; recordCount: number; indexVersion?: number; extractionDeadline?: number; error?: string; ownerId: string; uploadExpiresAt: number };
export type Session = { userId: string; expiresAt: number };
export interface DatasetStore {
  session(hash: string): Promise<Session | undefined>;
  create(item: Metadata): Promise<void>;
  get(id: string): Promise<Metadata | undefined>;
  list(): Promise<Metadata[]>;
  transition(id: string, from: Status, to: Status, patch?: Partial<Metadata>): Promise<boolean>;
  delete(id: string): Promise<void>;
}
export interface PrivateObjects {
  presign(key: string, format: SourceFormat, expires: number): Promise<{ url: string; headers: Record<string, string> }>;
  size(key: string): Promise<number | null>;
  read(key: string): Promise<Uint8Array>;
  write?(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}
/** Starts asynchronous (PDF/OCR) extraction. At-least-once; the worker is idempotent. */
export interface ExtractionQueue {
  send(datasetId: string): Promise<void>;
}
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function result(statusCode: number, data: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
}
function token(event: APIGatewayProxyEventV2): string | null {
  const values = (event.cookies ?? []).flatMap(c => c.split(';')).map(c => c.trim()).filter(c => c.startsWith(COOKIE + '='));
  const value = values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
  return TOKEN.test(value) ? value : null;
}
function body(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!(event.headers['content-type'] ?? event.headers['Content-Type'] ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Expected JSON.');
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
  if (Buffer.byteLength(raw) > 4096) throw new ApiError(413, 'Request too large.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected JSON object.');
  return value as Record<string, unknown>;
}
export function validateDataset(name: string, format: 'csv' | 'json', bytes: Uint8Array,
  enforceAiBounds = true): GrievanceRecord[] {
  if (!bytes.length || bytes.length > MAX_DATASET_BYTES) throw new ApiError(422, 'File must be between 1 byte and 20 MiB.');
  let parsed;
  try {
    const text = decodeUtf8(bytes);
    parsed = format === 'csv' ? parseCsvImport(name, text) : parseJsonImport(name, text);
  } catch (error) {
    // Parser error messages may embed arbitrarily long source column values. Never echo citizen data.
    void error;
    throw new ApiError(422, 'Invalid UTF-8 CSV/JSON structure. Check the required id and complaintText fields.');
  }
  if (parsed.totalRows > MAX_DATASET_RECORDS || parsed.records.length > MAX_DATASET_RECORDS) throw new ApiError(422, 'Dataset exceeds the 2,000-record limit.');
  if (parsed.rejectedRows.length || parsed.duplicates.length || parsed.emptyRows || !parsed.records.length) throw new ApiError(422, 'Every row requires a unique ID and complaintText; empty, missing, or duplicate rows are not accepted.');
  for (let i = 0; enforceAiBounds && i < parsed.records.length; i++) {
    try { validateRecordBounds(parsed.records[i]); }
    catch (error) { throw new ApiError(422, 'Record ' + (i + 1) + ': ' + (error instanceof Error ? error.message : 'Input size exceeds safety limit.')); }
  }
  return parsed.records;
}
const EXTRACTION_TIMEOUT_MESSAGE = 'Extraction did not finish in time. Delete this dataset and upload it again.';
/** A dataset stuck in `extracting` past its deadline (queue/worker delivery lost) becomes `failed`, wherever it is observed. */
async function expireIfStuck(store: DatasetStore, item: Metadata, nowSeconds: number): Promise<Metadata> {
  if (item.status === 'extracting' && item.extractionDeadline !== undefined && item.extractionDeadline < nowSeconds
    && await store.transition(item.id, 'extracting', 'failed', { error: EXTRACTION_TIMEOUT_MESSAGE })) {
    return { ...item, status: 'failed', error: EXTRACTION_TIMEOUT_MESSAGE };
  }
  return item;
}

export function createDatasetHandler(store: DatasetStore, objects: PrivateObjects, allowedOrigin: string, now = () => Date.now(), uuid = randomUUID, queue?: ExtractionQueue) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;
    try {
      // Authorization precedes all dataset operations, including list and lookups.
      const credential = token(event);
      if (!credential) throw new ApiError(401, 'Authentication required.');
      const session = await store.session(createHash('sha256').update(credential).digest('hex'));
      if (!session || session.expiresAt <= Math.floor(now() / 1000)) throw new ApiError(401, 'Authentication required.');
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(method) && (event.headers.origin ?? event.headers.Origin) !== allowedOrigin) throw new ApiError(403, 'Invalid request origin.');
      if (method === 'POST' && path === '/api/datasets/uploads') {
        const request = body(event);
        const name = request.name;
        const format = typeof name === 'string' && name.length <= 120 ? formatFromName(name) : null;
        if (typeof name !== 'string' || !format || /[\\/]/.test(name) || [...name].some(c => c.charCodeAt(0) < 32)) throw new ApiError(400, 'Provide a ' + SOURCE_FORMATS.map(f => '.' + f).join(', ') + ' filename (maximum 120 characters).');
        const size = request.bytes;
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > INGEST_LIMITS.bytes[format]) throw new ApiError(413, 'File exceeds the ' + Math.round(INGEST_LIMITS.bytes[format] / 1048576) + ' MiB limit for .' + format + ' files, or is empty.');
        const id = uuid();
        const key = 'raw/' + id + '/source.' + format;
        const item: Metadata = { id, key, name, format, status: 'pending_upload', createdAt: new Date(now()).toISOString(), bytes: size, recordCount: 0, ownerId: session.userId, uploadExpiresAt: Math.floor(now() / 1000) + UPLOAD_TTL_SECONDS };
        await store.create(item);
        const upload = await objects.presign(key, format, UPLOAD_TTL_SECONDS);
        return result(201, { dataset: publicMetadata(item), upload });
      }
      if (method === 'GET' && path === '/api/datasets') {
        const items = await store.list();
        const nowSeconds = Math.floor(now() / 1000);
        const mine = await Promise.all(items.filter(x => x.ownerId === session.userId).map(x => expireIfStuck(store, x, nowSeconds)));
        return result(200, { datasets: mine.map(publicMetadata) });
      }
      const match = /^\/api\/datasets\/([0-9a-f-]+)(\/finalize)?$/.exec(path);
      if (!match || !UUID.test(match[1])) throw new ApiError(404, 'Dataset not found.');
      const id = match[1];
      const item = await store.get(id);
      if (!item || item.ownerId !== session.userId) throw new ApiError(404, 'Dataset not found.');
      if (method === 'POST' && match[2] === '/finalize') {
        if (item.status !== 'pending_upload') throw new ApiError(409, 'Upload already finalized.');
        if (item.uploadExpiresAt < Math.floor(now() / 1000)) throw new ApiError(409, 'Upload request expired. Delete this dataset and retry.');
        const pdf = item.format === 'pdf';
        if (pdf && !queue) throw new ApiError(503, 'PDF processing is not available in this environment.');
        const next = pdf ? 'extracting' : 'validating';
        if (!await store.transition(id, 'pending_upload', next, pdf ? { extractionDeadline: Math.floor(now() / 1000) + EXTRACTION_DEADLINE_SECONDS } : {})) throw new ApiError(409, 'Upload is already being validated.');
        try {
          const bytes = await objects.size(item.key);
          if (bytes === null) throw new ApiError(422, 'Upload is incomplete or missing.');
          if (bytes !== item.bytes || bytes > INGEST_LIMITS.bytes[item.format]) throw new ApiError(422, 'Uploaded size differs from the requested size.');
          if (pdf) {
            // Extraction (text layer and, where needed, OCR) runs in the queue worker. The dataset is NOT ready until it succeeds.
            try { await queue!.send(id); }
            catch {
              // Not queued: return to pending_upload so finalize can simply be retried.
              await store.transition(id, 'extracting', 'pending_upload');
              throw new ApiError(503, 'Could not start extraction. Try again.');
            }
            return result(202, { dataset: publicMetadata({ ...item, status: 'extracting' }) });
          }
          const outcome = await ingestDocument({ name: item.name, bytes: await objects.read(item.key) });
          if (outcome.kind !== 'complete') throw new ApiError(422, 'This file cannot be processed synchronously.');
          const { records, ...rest } = outcome.canonical;
          await commitDataset(item, records, { ...rest, extractedAt: new Date(now()).toISOString() }, 'validating', store, objects);
          return result(200, { dataset: publicMetadata({ ...item, status: 'ready', recordCount: records.length }) });
        } catch (error) {
          if (error instanceof ApiError && error.status === 503) throw error;
          const safe = error instanceof ApiError && error.status === 422 ? error.message : error instanceof IngestError ? error.message : null;
          const message = safe ?? 'Validation or private indexing failed.';
          await store.transition(id, next, 'failed', { error: message });
          return result(422, { error: message });
        }
      }
      if (method === 'GET' && !match[2]) {
        const current = await expireIfStuck(store, item, Math.floor(now() / 1000));
        if (current.status === 'failed' && item.status === 'extracting') return result(200, { dataset: publicMetadata(current), records: null });
        if (item.status !== 'ready') return result(200, { dataset: publicMetadata(item), records: null });
        const cursorText = event.queryStringParameters?.cursor ?? '0';
        if (!/^(0|[1-9][0-9]{0,3})$/.test(cursorText)) throw new ApiError(400, 'Invalid record cursor.');
        const cursor = Number(cursorText);
        if (cursor > item.recordCount) throw new ApiError(400, 'Record cursor out of range.');
        const end = Math.min(item.recordCount, cursor + INDEX_CHUNK_RECORDS);
        const records = item.indexVersion === 1
          ? await readIndexedRange(item, objects, cursor, end)
          : validateDataset(item.name, item.format as 'csv' | 'json', await objects.read(item.key), false).slice(cursor, end);
        return result(200, { dataset: publicMetadata(item), records,
          nextCursor: end < item.recordCount ? end : null });
      }
      if (method === 'DELETE' && !match[2]) {
        const live = await expireIfStuck(store, item, Math.floor(now() / 1000));
        if (live.status === 'extracting') throw new ApiError(409, 'Extraction is in progress. Try again when it finishes.');
        // Keep metadata until all private objects are removed; a failed delete remains retriable.
        if (item.recordCount > 0) await removeDatasetIndex(item.key, item.recordCount, objects);
        await objects.remove(provenanceKey(item.key));
        await objects.remove(item.key);
        await store.delete(id);
        return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
      }
      throw new ApiError(404, 'Dataset endpoint not found.');
    } catch (error) {
      if (error instanceof ApiError) return result(error.status, { error: error.message });
      console.error('Dataset request failed', { method, path, errorType: error instanceof Error ? error.name : 'Unknown' });
      return result(500, { error: 'Dataset service unavailable. Retry later.' });
    }
  };
}
export function publicMetadata(item: Metadata) {
  return { id: item.id, name: item.name, format: item.format, status: item.status, createdAt: item.createdAt, bytes: item.bytes, recordCount: item.recordCount, error: item.error ?? null };
}
