import { createHash, createHmac } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CONTENT_TYPE, type SourceFormat } from '../ingest/limits';
import type { DatasetStore, Metadata, PrivateObjects, Session, Status } from './core';

const enc = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
function awsCredentials() {
  const access = process.env.AWS_ACCESS_KEY_ID, secret = process.env.AWS_SECRET_ACCESS_KEY, token = process.env.AWS_SESSION_TOKEN;
  if (!access || !secret || !token) throw new Error('Lambda role credentials are missing');
  return { access, secret, token };
}
export class SignedS3 implements PrivateObjects {
  constructor(private readonly bucket: string, private readonly region: string) {}
  private sign(method: string, key: string, expiry?: number, format?: SourceFormat, body?: { bytes: Uint8Array; contentType: string }) {
    const credentials = awsCredentials();
    const date = new Date();
    const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = timestamp.slice(0, 8);
    const host = this.bucket + '.s3.' + this.region + '.amazonaws.com';
    const path = '/' + key.split('/').map(enc).join('/');
    const scope = day + '/' + this.region + '/s3/aws4_request';
    const headers: Record<string, string> = { host };
    if (expiry) {
      headers['content-type'] = CONTENT_TYPE[format ?? 'json'];
      headers['if-none-match'] = '*';
    } else {
      headers['x-amz-date'] = timestamp;
      headers['x-amz-security-token'] = credentials.token;
      headers['x-amz-content-sha256'] = sha(body?.bytes ?? '');
      if (body) headers['content-type'] = body.contentType;
    }
    const names = Object.keys(headers).sort();
    const signedHeaders = names.join(';');
    const canonicalHeaders = names.map(k => k + ':' + headers[k].trim() + '\n').join('');
    const queryEntries = expiry ? [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'], ['X-Amz-Credential', credentials.access + '/' + scope],
      ['X-Amz-Date', timestamp], ['X-Amz-Expires', String(expiry)],
      ['X-Amz-Security-Token', credentials.token], ['X-Amz-SignedHeaders', signedHeaders],
    ] : [];
    const query = queryEntries.map(([k,v]) => [enc(k), enc(v)]).sort((a,b) => a[0].localeCompare(b[0])).map(([k,v]) => k + '=' + v).join('&');
    const payloadHash = expiry ? 'UNSIGNED-PAYLOAD' : sha(body?.bytes ?? '');
    const canonical = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + credentials.secret, day), this.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const url = 'https://' + host + path + (query ? '?' + query + '&X-Amz-Signature=' + signature : '');
    if (!expiry) headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + credentials.access + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    delete headers.host;
    return { url, headers };
  }
  async presign(key: string, format: SourceFormat, expires: number) { return this.sign('PUT', key, expires, format); }
  private async request(method: string, key: string) {
    const signed = this.sign(method, key);
    const response = await fetch(signed.url, { method, headers: signed.headers });
    if (response.status === 404 && method === 'HEAD') return null;
    if (!response.ok) throw new Error('S3 ' + method + ' failed with ' + response.status);
    return response;
  }
  async size(key: string) { const response = await this.request('HEAD', key); return response ? Number(response.headers.get('content-length')) : null; }
  async read(key: string) { const response = await this.request('GET', key); if (!response) throw new Error('S3 object missing'); return new Uint8Array(await response.arrayBuffer()); }
  async remove(key: string) { await this.request('DELETE', key); }
  async write(key: string, bytes: Uint8Array, contentType: string) {
    const signed = this.sign('PUT', key, undefined, undefined, { bytes, contentType });
    const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: new Blob([Uint8Array.from(bytes)]) });
    if (!response.ok) throw new Error('S3 PUT failed with ' + response.status);
  }
}
export class DynamoDatasets implements DatasetStore {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly table: string, private readonly sessions: string) {}
  async session(hash: string): Promise<Session | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.sessions, Key: { tokenHash: hash }, ConsistentRead: true }));
    return response.Item as Session | undefined;
  }
  async create(item: Metadata) { await this.client.send(new PutCommand({ TableName: this.table, Item: item, ConditionExpression: 'attribute_not_exists(id)' })); }
  async get(id: string): Promise<Metadata | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.table, Key: { id }, ConsistentRead: true }));
    return response.Item as Metadata | undefined;
  }
  async list(): Promise<Metadata[]> {
    const found: Metadata[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const response = await this.client.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: cursor, Limit: 100 }));
      found.push(...(response.Items ?? []) as Metadata[]);
      cursor = response.LastEvaluatedKey;
    } while (cursor);
    return found.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async transition(id: string, from: Status, to: Status, patch: Partial<Metadata> = {}): Promise<boolean> {
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = { ':from': from, ':to': to };
    let expression = 'SET #status = :to';
    for (const [key, value] of Object.entries(patch)) {
      if (!['recordCount', 'error'].includes(key)) throw new Error('Invalid metadata patch');
      names['#' + key] = key;
      values[':' + key] = value;
      expression += ', #' + key + ' = :' + key;
    }
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id }, UpdateExpression: expression, ConditionExpression: '#status = :from', ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
      return true;
    } catch (e) { if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return false; throw e; }
  }
  async delete(id: string) { await this.client.send(new DeleteCommand({ TableName: this.table, Key: { id } })); }
}
export function createAwsDatasetDependencies() {
  const bucket = process.env.DATASETS_BUCKET_NAME, table = process.env.DATASETS_TABLE_NAME, sessions = process.env.SESSIONS_TABLE_NAME, origin = process.env.ALLOWED_ORIGIN, region = process.env.AWS_REGION;
  if (!bucket || !table || !sessions || !origin || !region) throw new Error('Dataset Lambda configuration incomplete');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return { store: new DynamoDatasets(client, table, sessions), objects: new SignedS3(bucket, region), origin };
}
