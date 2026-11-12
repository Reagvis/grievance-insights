import { randomUUID, createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { decodeUtf8, parseCsvImport, parseJsonImport } from '../../src/utils/importer';
import { formatFromName, ingestDocument, IngestError, LIMITS as INGEST_LIMITS, SOURCE_FORMATS, type CanonicalDataset, type SourceFormat } from '../ingest';

export const MAX_DATASET_BYTES = 1024 * 1024;
export const MAX_DATASET_RECORDS = 200;
export const UPLOAD_TTL_SECONDS = 300;
const COOKIE = '__Host-grievance_session';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Status = 'pending_upload' | 'validating' | 'ready' | 'failed';
export type Metadata = { id: string; key: string; name: string; format: SourceFormat; status: Status; createdAt: string; bytes: number; recordCount: number; error?: string; ownerId: string; uploadExpiresAt: number };
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
  /** Server-side write of derived data (the canonical extraction). Never used for the original upload. */
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
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
/** Legacy CSV/JSON validator: still used to read datasets stored before canonical extraction existed. */
export function validateDataset(name: string, format: 'csv' | 'json', bytes: Uint8Array): GrievanceRecord[] {
  if (!bytes.length || bytes.length > MAX_DATASET_BYTES) throw new ApiError(422, 'File must be between 1 byte and 1 MiB.');
  let parsed;
  try {
    const text = decodeUtf8(Uint8Array.from(bytes).buffer);
    parsed = format === 'csv' ? parseCsvImport(name, text) : parseJsonImport(name, text);
  } catch (error) {
    throw new ApiError(422, error instanceof Error ? error.message : 'Invalid dataset.');
  }
  if (parsed.totalRows > MAX_DATASET_RECORDS || parsed.records.length > MAX_DATASET_RECORDS) throw new ApiError(422, 'Dataset exceeds the 200-record limit.');
  if (parsed.rejectedRows.length || parsed.duplicates.length || parsed.emptyRows || !parsed.records.length) throw new ApiError(422, 'Every row requires a unique ID and complaintText; empty, missing, or duplicate rows are not accepted.');
  return parsed.records;
}
export const canonicalKey = (id: string) => 'raw/' + id + '/records.json';

/** Structural check of a stored canonical extraction; the object is written by this service but read defensively. */
function parseCanonical(bytes: Uint8Array): CanonicalDataset {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CanonicalDataset>;
  if (value?.schemaVersion !== 1 || !Array.isArray(value.records) || !value.records.length || !Array.isArray(value.provenance)) throw new Error('Stored dataset is invalid.');
  if (new Set(value.records.map(r => r.id)).size !== value.records.length) throw new Error('Stored dataset is invalid.');
  return value as CanonicalDataset;
}

/**
 * The records of a ready dataset. New uploads (every format) read the canonical extraction written at finalize;
 * datasets stored before that existed are re-parsed from the original CSV/JSON as before.
 */
export async function loadRecords(item: Metadata, objects: PrivateObjects): Promise<GrievanceRecord[]> {
  if (await objects.size(canonicalKey(item.id)) !== null) return parseCanonical(await objects.read(canonicalKey(item.id))).records;
  if (item.format !== 'csv' && item.format !== 'json') throw new Error('Canonical extraction is missing.');
  return validateDataset(item.name, item.format, await objects.read(item.key));
}

export function createDatasetHandler(store: DatasetStore, objects: PrivateObjects, allowedOrigin: string, now = () => Date.now(), uuid = randomUUID) {
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
        const key = 'raw/' + id + '/source.' + format; // the original: written once by the browser, never modified
        const item: Metadata = { id, key, name, format, status: 'pending_upload', createdAt: new Date(now()).toISOString(), bytes: size, recordCount: 0, ownerId: session.userId, uploadExpiresAt: Math.floor(now() / 1000) + UPLOAD_TTL_SECONDS };
        await store.create(item);
        const upload = await objects.presign(key, format, UPLOAD_TTL_SECONDS);
        return result(201, { dataset: publicMetadata(item), upload });
      }
      if (method === 'GET' && path === '/api/datasets') {
        const items = await store.list();
        return result(200, { datasets: items.filter(x => x.ownerId === session.userId).map(publicMetadata) });
      }
      const match = /^\/api\/datasets\/([0-9a-f-]+)(\/finalize)?$/.exec(path);
      if (!match || !UUID.test(match[1])) throw new ApiError(404, 'Dataset not found.');
      const id = match[1];
      const item = await store.get(id);
      if (!item || item.ownerId !== session.userId) throw new ApiError(404, 'Dataset not found.');
      if (method === 'POST' && match[2] === '/finalize') {
        if (item.status !== 'pending_upload') throw new ApiError(409, 'Upload already finalized.');
        if (item.uploadExpiresAt < Math.floor(now() / 1000)) throw new ApiError(409, 'Upload request expired. Delete this dataset and retry.');
        if (!await store.transition(id, 'pending_upload', 'validating')) throw new ApiError(409, 'Upload is already being validated.');
        try {
          const bytes = await objects.size(item.key);
          if (bytes === null) throw new ApiError(422, 'Upload is incomplete or missing.');
          if (bytes !== item.bytes || bytes > INGEST_LIMITS.bytes[item.format]) throw new ApiError(422, 'Uploaded size differs from the requested size.');
          const outcome = await ingestDocument({ name: item.name, bytes: await objects.read(item.key) });
          if (outcome.kind === 'needs_ocr') {
            // OCR is a separate, explicitly enabled stage. Without it a scan or damaged text layer is never imported as if it were text.
            throw new ApiError(422, 'This PDF has ' + outcome.ocrPages.length + ' scanned or unreadable-text page(s) and OCR is not enabled in this environment. Upload a searchable PDF, or a TXT/DOCX version.');
          }
          const canonical: CanonicalDataset = { ...outcome.canonical, extractedAt: new Date(now()).toISOString() };
          await objects.write(canonicalKey(id), new TextEncoder().encode(JSON.stringify(canonical)), 'application/json');
          await store.transition(id, 'validating', 'ready', { recordCount: canonical.records.length });
          return result(200, { dataset: publicMetadata({ ...item, status: 'ready', recordCount: canonical.records.length }) });
        } catch (error) {
          const safe = error instanceof ApiError && error.status === 422 ? error.message : error instanceof IngestError ? error.message : null;
          const message = safe ?? 'Validation or storage failed.';
          await store.transition(id, 'validating', 'failed', { error: message });
          return result(422, { error: message });
        }
      }
      if (method === 'GET' && !match[2]) {
        if (item.status !== 'ready') return result(200, { dataset: publicMetadata(item), records: null });
        const records = await loadRecords(item, objects);
        return result(200, { dataset: publicMetadata(item), records });
      }
      if (method === 'DELETE' && !match[2]) {
        // Delete raw object first: metadata remains retriable if S3 deletion fails.
        await objects.remove(canonicalKey(id));
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
