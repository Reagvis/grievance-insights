import { createHash, createHmac } from 'node:crypto';

function sha(input: string | Uint8Array): string { return createHash('sha256').update(input).digest('hex'); }
function hmac(key: Buffer | string, input: string): Buffer { return createHmac('sha256', key).update(input).digest(); }
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
  const canonical = [method, target.pathname, query, canonicalHeaders, signed, hash].join('\n');
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
  if (!response.ok && response.status !== 404 && response.status !== 412) {
    // Only the AWS exception name is safe for logs; never surface service bodies.
    let name = 'ServiceError';
    try {
      const error = await response.json() as { __type?: string; code?: string };
      name = error.__type ?? error.code ?? name;
    } catch { /* safe generic fallback */ }
    throw new AwsServiceError(response.status, name);
  }
  return response;
}
export function objectUrl(bucket: string, region: string, key: string): string {
  if (!/^[a-z0-9-]+$/.test(bucket) || key.includes('..') || key.startsWith('/')) throw new Error('Invalid private S3 object key');
  return 'https://' + bucket + '.s3.' + region + '.amazonaws.com/' + key.split('/').map(encodeURIComponent).join('/');
}
