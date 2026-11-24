import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TextDecoder } from 'node:util';
import type { AddressInfo } from 'node:net';
import type { Event } from '../core';
import { ACTOR_HEADER, FAULT_HEADER, createLocalSyntheticApi } from './local-fixtures';

export const LOCAL_HOST = '127.0.0.1';
export const LOCAL_PORT = 8765;
const MAX_BODY_BYTES = 64_000; // Match the actual eOffice core input budget.
const TOO_LARGE_BODY = ' '.repeat(MAX_BODY_BYTES + 1);

export type LocalHttpOptions = {
  /** Must be explicitly true. This process is never an authentication service. */
  testOnly: true;
  /** Only the literal IPv4 loopback address is allowed. */
  host?: string;
  /** 0 is allowed for isolated automated tests; the CLI always uses 8765. */
  port?: number;
};

export function assertLocalOnly(options: LocalHttpOptions): void {
  if (!options.testOnly) throw new Error('Synthetic eOffice smoke process requires explicit test-only opt-in.');
  if (options.host !== undefined && options.host !== LOCAL_HOST)
    throw new Error('Refusing non-loopback HTTP listener.');
  if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV || process.env.LAMBDA_TASK_ROOT)
    throw new Error('Local synthetic eOffice harness refuses production/AWS Lambda environments.');
  if (options.port !== undefined &&
      (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535))
    throw new Error('Invalid localhost port.');
}

/** Bounded streaming decoder. On overflow discard remaining bytes rather than
 * buffering private request data. Pass an over-limit sentinel to the actual
 * core so its own 400/error-envelope behavior remains authoritative.
 */
async function readBoundedBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0, done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        done = true;
        resolve(TOO_LARGE_BODY);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
      } catch {
        // Invalid UTF-8 is deliberately presented as malformed JSON to core.
        resolve('');
      }
    });
    req.on('error', error => { if (!done) { done = true; reject(error); } });
    req.on('aborted', () => { if (!done) { done = true; reject(new Error('Request aborted')); } });
  });
}

function headersFromNode(req: IncomingMessage): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers))
    result[key] = Array.isArray(value) ? value.join(',') : value;
  return result;
}

/** No duplicate routing or validation logic: the path/method/body/headers are
 * passed to createEofficeApi as a real API Gateway-style Event.
 */
async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.socket.remoteAddress !== LOCAL_HOST) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', connection: 'close' });
    res.end(JSON.stringify({ system_error_message: 'Non-loopback request rejected.',
      user_error_message: 'Access denied.' }));
    return;
  }
  try {
    const headers = headersFromNode(req);
    const body = await readBoundedBody(req);
    const event: Event = {
      rawPath: (req.url ?? '').split('?', 1)[0],
      requestContext: { http: { method: req.method } },
      headers,
      body,
    };
    const api = createLocalSyntheticApi(headers[ACTOR_HEADER], headers[FAULT_HEADER]);
    const result = await api(event);
    res.writeHead(result.statusCode, {
      ...result.headers,
      // The test listener never provides cross-origin access or caches a result.
      'cache-control': 'no-store',
      connection: 'close',
    });
    res.end(result.body);
  } catch {
    // Never log or return raw input, model output, exception messages or URLs.
    if (!res.headersSent) res.writeHead(500, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', connection: 'close',
    });
    res.end(JSON.stringify({
      system_error_message: 'Local test request failed.',
      user_error_message: 'AI service could not complete the request.',
    }));
  }
}

export async function startLocalEofficeServer(options: LocalHttpOptions): Promise<Server> {
  assertLocalOnly(options);
  const server = createServer((req, res) => { void respond(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxRequestsPerSocket = 64;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: LOCAL_HOST, port: options.port ?? LOCAL_PORT, exclusive: true }, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    if ((server.address() as AddressInfo | null)?.address !== LOCAL_HOST)
      throw new Error('Refusing a non-loopback server binding.');
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
