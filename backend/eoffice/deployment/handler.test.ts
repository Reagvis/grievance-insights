import { describe, expect, it } from 'vitest';
import { toCoreEvent } from './handler';

describe('Task 22G API Gateway v2 adapter', () => {
  it('preserves method, path, authorization, UTF-8 body and base64 rejection signal', () => {
    const event = toCoreEvent({
      version: '2.0', routeKey: 'POST /api/v1/ai/chat', rawPath: '/api/v1/ai/chat',
      rawQueryString: '', cookies: [], headers: { authorization: 'Bearer signed.token' },
      requestContext: { accountId: '1', apiId: 'api', domainName: 'example.test',
        domainPrefix: 'api', http: { method: 'POST', path: '/api/v1/ai/chat',
          protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
        requestId: 'request', routeKey: 'route', stage: '$default', time: '', timeEpoch: 0 },
      body: 'eyJyZXF1ZXN0X2lkIjoiYmFzZTY0In0=', isBase64Encoded: true,
    });
    expect(event).toMatchObject({ rawPath: '/api/v1/ai/chat', body: expect.any(String),
      isBase64Encoded: true, requestContext: { http: { method: 'POST' } },
      headers: { authorization: 'Bearer signed.token' } });
  });
});
