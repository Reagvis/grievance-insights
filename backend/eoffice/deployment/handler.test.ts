import { describe, expect, it } from 'vitest';
import { handler, toCoreEvent } from './handler';

const event = (body: string) => ({
  version: '2.0' as const, routeKey: 'POST /api/v1/ai/chat', rawPath: '/api/v1/ai/chat',
  rawQueryString: '', cookies: [], headers: { authorization: 'Bearer signed.token',
    'content-type': 'application/json' },
  requestContext: { accountId: '1', apiId: 'api', domainName: 'example.test',
    domainPrefix: 'api', http: { method: 'POST', path: '/api/v1/ai/chat',
      protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
    requestId: 'request', routeKey: 'route', stage: '$default', time: '', timeEpoch: 0,
    authorizer: { jwt: { claims: { client_id: 'client-1' } as Record<string, string | number | boolean | string[]>,
      scopes: ['eoffice-api/chat'] } } },
  body, isBase64Encoded: false,
});

describe('Task 22G API Gateway v2 adapter', () => {
  it('preserves method, path, authorization, UTF-8 body and base64 rejection signal', () => {
    const source = event('eyJyZXF1ZXN0X2lkIjoiYmFzZTY0In0=');
    const converted = toCoreEvent({ ...source, isBase64Encoded: true });
    expect(converted).toMatchObject({ rawPath: '/api/v1/ai/chat', body: expect.any(String),
      isBase64Encoded: true, headers: { authorization: 'Bearer signed.token' },
      requestContext: { http: { method: 'POST' }, authorizer: { jwt: {
        claims: { client_id: 'client-1' }, scopes: ['eoffice-api/chat'],
      } } } });
  });
  it('returns a safe UUID/no-store 503 and retries after initialization failure', async () => {
    const id = '11111111-2222-4333-8444-000000000001';
    const request = event(JSON.stringify({ request_id: id, session_id: 'session',
      user_id: 'officer', user_input: 'question' }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler(request);
      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(response.body)).toEqual({ request_id: id,
        system_error_message: 'Service initialization unavailable.',
        user_error_message: 'AI service could not complete the request.' });
    }
  });
});
