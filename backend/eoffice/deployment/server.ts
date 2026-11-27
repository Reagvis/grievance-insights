import { createServer } from 'node:http';
import { createProvisionalBedrockEofficeService } from '../provisional/bedrock';
import { unixClamdScanner } from '../provisional/protected-documents';
import type { Event } from '../core';
import { createDeploymentAdapters } from './aws-adapters';

const host = process.env.EOFFICE_BIND_HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? '8080');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid service port.');
const dependencies = createDeploymentAdapters();
const service = createProvisionalBedrockEofficeService({
  ...dependencies,
  scanner: unixClamdScanner(process.env.EOFFICE_CLAMD_SOCKET ?? '/run/clamav/clamd.sock'),
});
const allowed = new Set(['/api/v1/ai/chat', '/api/v1/ai/summarize',
  '/api/v1/ai/extract', '/api/v1/ai/draft-reply']);

const server = createServer((request, response) => {
  void (async () => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"status":"ok"}');
      return;
    }
    const path = request.url?.split('?', 1)[0] ?? '';
    if (!allowed.has(path)) {
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"system_error_message":"Route not found.","user_error_message":"The requested endpoint is unavailable."}');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk);
      if (size > 64_000) { chunks.length = 0; chunks.push(Buffer.alloc(64_001)); break; }
      chunks.push(Buffer.from(chunk));
    }
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers))
      headers[name] = Array.isArray(value) ? value.join(',') : value;
    const event: Event = {
      rawPath: path, headers, body: Buffer.concat(chunks).toString('utf8'),
      requestContext: { http: { method: request.method ?? '' } },
    };
    const result = await service(event);
    response.writeHead(result.statusCode, result.headers);
    response.end(result.body);
  })().catch(() => {
    if (!response.headersSent)
      response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end('{"system_error_message":"Service unavailable.","user_error_message":"AI service could not complete the request."}');
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, host);
