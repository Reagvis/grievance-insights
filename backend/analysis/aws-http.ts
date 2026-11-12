import { createHash, createHmac } from 'node:crypto';

function sha(input: string | Uint8Array): string { return createHash('sha256').update(input).digest('hex'); }
function hmac(key: Buffer | string, input: string): Buffer { return createHmac('sha256', key).update(input).digest(); }
const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function canonicalAwsPath(path: string, service: 's3' | 'sqs' | 'bedrock'): string {
  // SigV4 double-encodes already escaped path labels for Bedrock/SQS. S3 is
  // the documented exception and signs its encoded object path as received.
  return service === 's3' ? path : path.split('/').map(uriEncode).join('/');
}
export class AwsServiceError extends Error {
  constructor(readonly status: number, name: string) { super('AWS service request failed'); this.name = name.replace(/^.*[#/]/, '') || 'ServiceError'; }
}
/** Small credential-free-in-source SigV4 transport, using Lambda's rotating role credentials. */
export async function signedAwsRequest(service: 's3' | 'sqs' | 'bedrock', region: string, method: string, url: string,
  body?: Uint8Array, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const access = process.env.AWS_ACCESS_KEY_ID, secret = process.env.AWS_SECRET_ACCESS_KEY;
  const token = process.env.AWS_SESSION_TOKEN;
  if (!access || !secret || !token) throw new Error('AWS role credentials unavailable');
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('AWS requests must use TLS');
  const hash = sha(body ?? new Uint8Array());
  const headers: Record<string, string> = {
    host: target.host, 'x-amz-date': timestamp, 'x-amz-security-token': token, 'x-amz-content-sha256': hash,
  };
  for (const [key, value] of Object.entries(extraHeaders)) headers[key.toLowerCase()] = value;
  const keys = Object.keys(headers).sort();
  const signed = keys.join(';');
  const canonicalHeaders = keys.map(key => key + ':' + headers[key].trim().replace(/\s+/g, ' ') + '\n').join('');
  const query = Array.from(target.searchParams.entries()).sort(([a],[b]) => a.localeCompare(b))
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
  const canonical = [method, canonicalAwsPath(target.pathname, service), query, canonicalHeaders, signed, hash].join('\n');
  const scope = day + '/' + region + '/' + service + '/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + access + '/' + scope + ', SignedHeaders=' + signed +
    ', Signature=' + createHmac('sha256', key).update(toSign).digest('hex');
  delete headers.host;
  const response = await fetch(url, {
    method, headers, ...(body ? { body: Buffer.from(body) } : {}),
    signal: AbortSignal.timeout(service === 'bedrock' ? 75000 : 20000),
  });
  // Only S3 GET missing-key and conditional PUT conflicts are meaningful non-2xx
  // results to callers. SQS SendMessage and Bedrock Converse must never accept them.
  const expectedS3Status = service === 's3' &&
    ((method === 'GET' && response.status === 404) || (method === 'PUT' && response.status === 412));
  if (!response.ok && !expectedS3Status) {
    // Extract only the AWS exception class, never log response bodies or messages.
    const fallback = response.status === 429 ? 'ThrottlingException' :
      response.status === 503 ? 'ServiceUnavailableException' :
      response.status >= 500 ? 'InternalServerException' :
      response.status === 404 ? 'ResourceNotFoundException' : 'ServiceError';
    let raw = response.headers.get('x-amzn-errortype') ?? fallback;
    if (raw === fallback) {
      try {
        const error = await response.json() as { __type?: string; code?: string; Code?: string };
        raw = error.__type ?? error.code ?? error.Code ?? fallback;
      } catch { /* Return a generic exception type, never the response text. */ }
    }
    const name = raw.replace(/^.*[#/]/, '').split(':')[0].replace(/[^A-Za-z0-9_.]/g, '').slice(0, 80) || fallback;
    throw new AwsServiceError(response.status, name);
  }
  return response;
}
export function objectUrl(bucket: string, region: string, key: string): string {
  if (!/^[a-z0-9-]+$/.test(bucket) || key.includes('..') || key.startsWith('/')) throw new Error('Invalid private S3 object key');
  return 'https://' + bucket + '.s3.' + region + '.amazonaws.com/' + key.split('/').map(encodeURIComponent).join('/');
}
