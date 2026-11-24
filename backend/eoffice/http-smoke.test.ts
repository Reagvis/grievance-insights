import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createConnection } from 'node:net';
import https from 'node:https';
import {
  assertLocalOnly, LOCAL_HOST, startLocalEofficeServer,
} from './testing/local-http';
import {
  ACTOR_HEADER, FAULT_HEADER, ALPHA_REF, BETA_REF, SUPPORT_REF,
  HISTORY_ALPHA, HISTORY_BETA, SHARED_SESSION,
} from './testing/local-fixtures';

const id = (n: number) => '11111111-2222-4333-8444-' + String(n).padStart(12, '0');
type Reply = { status: number; headers: Record<string, string | string[] | undefined>;
  body: string; json: Record<string, unknown> };
const ctx = { documents: [ALPHA_REF] };
const extraction_schema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    letter_date: { type: ['string', 'null'] },
    approved: { type: ['boolean', 'null'] },
  },
  required: ['subject'],
};
const chat = (n: number, context: Record<string, unknown> | undefined = ctx) => ({
  request_id: id(n), session_id: SHARED_SESSION,
  user_id: 'synthetic-officer-alpha',
  user_input: 'What does the policy say?',
  ...(context ? { context } : {}),
});
let server: Server;
let port: number;

async function wire(
  path: string, payload: unknown, options: {
    actor?: string; fault?: string; method?: string;
    contentType?: string; headers?: Record<string, string>; raw?: string;
  } = {},
): Promise<Reply> {
  const body = options.raw ?? JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: LOCAL_HOST, port, path, method: options.method ?? 'POST', agent: false,
      headers: {
        'content-type': options.contentType ?? 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        ...(options.actor === undefined ? {} : { [ACTOR_HEADER]: options.actor }),
        ...(options.fault === undefined ? {} : { [FAULT_HEADER]: options.fault }),
        ...options.headers,
      },
    }, res => {
      const bytes: Buffer[] = [];
      res.on('data', chunk => bytes.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(bytes).toString('utf8');
        try {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
            json: JSON.parse(text) as Record<string, unknown>,
          });
        } catch (error) { reject(error); }
      });
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
const post = (task: string, payload: unknown, options: Parameters<typeof wire>[2] = {}) =>
  wire('/api/v1/ai/' + task, payload, { actor: 'alpha', ...options });
function requireSafe(r: Reply, expected: number, requestId?: string) {
  expect(r.status).toBe(expected);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['content-type']).toMatch(/^application\/json/);
  expect(r.headers).not.toHaveProperty('access-control-allow-origin');
  if (requestId) expect(r.json.request_id).toBe(requestId);
  expect(r.body).not.toContain('private-alpha-secret');
  expect(r.body).not.toContain('private-beta-secret');
  expect(r.body).not.toContain('private-support-secret');
  expect(r.body).not.toContain('PRIVATE_SYNTHETIC_');
}
function errorShape(reply: Reply, status: number, requestId: string) {
  requireSafe(reply, status, requestId);
  expect(Object.keys(reply.json).sort()).toEqual([
    'request_id', 'system_error_message', 'user_error_message',
  ]);
  expect(reply.json.system_error_message).toEqual(expect.any(String));
  expect(reply.json.user_error_message).toEqual(expect.any(String));
}

describe('Task 22E — actual loopback HTTP → createEofficeApi', () => {
  beforeAll(async () => {
    server = await startLocalEofficeServer({ testOnly: true, port: 0 });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP test listener.');
    port = address.port;
    expect(address.address).toBe(LOCAL_HOST);
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  });

  it('refuses non-loopback binding, missing opt-in and production/Lambda settings', async () => {
    for (const host of ['0.0.0.0', '::', 'localhost', '192.168.1.100']) {
      expect(() => assertLocalOnly({ testOnly: true, host })).toThrow(/non-loopback/);
      await expect(startLocalEofficeServer({ testOnly: true, host, port: 0 }))
        .rejects.toThrow(/non-loopback/);
    }
    expect(() => assertLocalOnly({ testOnly: false as true })).toThrow(/opt-in/);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertLocalOnly({ testOnly: true })).toThrow(/production/);
    vi.unstubAllEnvs();
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'unsafe-lambda');
    expect(() => assertLocalOnly({ testOnly: true })).toThrow(/production/);
    vi.unstubAllEnvs();
  });

  it('returns exact 200 public envelopes for all four routes, with grounded page and nullable fields', async () => {
    const cases = [
      {
        task: 'chat', payload: chat(1),
        expected: { request_id: id(1), answer: 'The Procurement allocation cap is 1.2 million.',
          references: [{ document_id: ALPHA_REF.document_id,
            title: 'Synthetic Alpha Policy.pdf', page_number: 2 }] },
      },
      {
        task: 'summarize',
        payload: { request_id: id(2), user_id: 'synthetic-officer-alpha',
          user_input: 'Summarize the attached policy.', context: ctx },
        expected: { request_id: id(2), summary: 'The Procurement memorandum records a cap of 1.2 million.' },
      },
      {
        task: 'extract',
        payload: { request_id: id(3), user_id: 'synthetic-officer-alpha',
          context: ctx, extraction_schema },
        expected: { request_id: id(3),
          extracted_data: { subject: 'Procurement', letter_date: null, approved: null },
          references: [{ document_id: ALPHA_REF.document_id,
            title: 'Synthetic Alpha Policy.pdf', page_number: 2 }] },
      },
      {
        task: 'draft-reply',
        payload: { request_id: id(4), user_id: 'synthetic-officer-alpha',
          user_input: 'Draft a request for Procurement supporting documents.', context: ctx },
        expected: { request_id: id(4),
          draft_text: 'Draft: Please provide the Procurement supporting documents for officer review.',
          references: [{ document_id: ALPHA_REF.document_id,
            title: 'Synthetic Alpha Policy.pdf', page_number: 2 }] },
      },
    ] as const;
    for (const item of cases) {
      const reply = await post(item.task, item.payload);
      requireSafe(reply, 200, item.payload.request_id);
      expect(reply.json).toEqual(item.expected);
      expect(reply.body).not.toContain('download_url');
      expect(reply.body).not.toContain('generated_file_url');
    }
  });

  it('accepts two distinct synthetic documents without fabricating source references', async () => {
    const reply = await post('chat', chat(5, { documents: [ALPHA_REF, SUPPORT_REF] }));
    requireSafe(reply, 200, id(5));
    expect(reply.json.references).toEqual([
      { document_id: ALPHA_REF.document_id, title: 'Synthetic Alpha Policy.pdf', page_number: 2 },
      { document_id: SUPPORT_REF.document_id, title: 'Synthetic Alpha Support.txt' },
    ]);
  });

  it('passes genuine HTTP/1.1 socket bytes into the real eOffice handler', async () => {
    const body = JSON.stringify(chat(6));
    const raw = [
      'POST /api/v1/ai/chat HTTP/1.1',
      'Host: 127.0.0.1',
      'Connection: close',
      'Content-Type: application/json',
      ACTOR_HEADER + ': alpha',
      'Content-Length: ' + Buffer.byteLength(body),
      '', body,
    ].join('\r\n');
    const received = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: LOCAL_HOST, port }, () => socket.write(raw));
      let content = '';
      socket.setTimeout(5000, () => socket.destroy(new Error('Raw localhost socket timed out')));
      socket.on('data', data => { content += data.toString('utf8'); });
      socket.once('end', () => resolve(content));
      socket.once('error', reject);
    });
    expect(received).toMatch(/^HTTP\/1\.1 200 OK/);
    expect(received.toLowerCase()).toContain('cache-control: no-store');
    expect(received).toContain('"request_id":"' + id(6) + '"');
    expect(received).toContain('"page_number":2');
  });

  it('denies missing/invalid synthetic actors and ignores forged real Authorization headers', async () => {
    for (const actor of [undefined, 'unknown-fixture']) {
      const reply = await wire('/api/v1/ai/chat', chat(10), {
        actor, headers: { authorization: 'Bearer fabricated-not-a-credential' },
      });
      errorShape(reply, 403, id(10));
      expect(reply.body).not.toContain('fabricated-not-a-credential');
    }
    errorShape(await post('chat', chat(11), { fault: 'auth-denied' }), 403, id(11));
    errorShape(await post('chat', { ...chat(12), user_id: 'synthetic-officer-beta' }), 403, id(12));
    errorShape(await post('chat', chat(13), { fault: 'auth-unavailable' }), 503, id(13));
  });

  it('separates synthetic departments even with identical document_id and reused session_id', async () => {
    const alpha = await post('chat', chat(20));
    const betaPayload = { ...chat(21, { documents: [BETA_REF] }),
      user_id: 'synthetic-officer-beta' };
    const beta = await post('chat', betaPayload, { actor: 'beta' });
    requireSafe(alpha, 200, id(20));
    requireSafe(beta, 200, id(21));
    expect(alpha.json.answer).toContain('1.2 million');
    expect(beta.json.answer).toContain('2.4 million');
    expect(beta.body).not.toContain('1.2 million');
    expect(beta.json.references).toEqual([
      { document_id: BETA_REF.document_id, title: 'Synthetic Beta Policy.pdf', page_number: 1 },
    ]);
    errorShape(await post('chat', chat(22, { documents: [BETA_REF] })), 422, id(22));
    errorShape(await post('chat', {
      ...chat(23, { documents: [ALPHA_REF] }), user_id: 'synthetic-officer-beta',
    }, { actor: 'beta' }), 422, id(23));
    const noContext = await post('chat', chat(24, undefined));
    requireSafe(noContext, 200, id(24));
    expect(noContext.json).toEqual({
      request_id: id(24), answer: 'No previous conversation context was supplied.', references: [],
    });
  });

  it('checks protected history by actor and session; never persists prior turns', async () => {
    const allowed = await post('chat', chat(30, { previous_context: HISTORY_ALPHA }));
    requireSafe(allowed, 200, id(30));
    expect(allowed.json.answer).toBe('Authorized synthetic previous context was supplied.');
    const later = await post('chat', chat(31, undefined));
    requireSafe(later, 200, id(31));
    expect(later.json.answer).toBe('No previous conversation context was supplied.');
    errorShape(await post('chat', chat(32, { previous_context: HISTORY_BETA })), 422, id(32));
    errorShape(await post('chat', { ...chat(33, { previous_context: HISTORY_ALPHA }),
      session_id: 'wrong-session' }), 422, id(33));
    errorShape(await post('chat', chat(34, { previous_context: HISTORY_ALPHA }),
      { fault: 'history-unavailable' }), 422, id(34));
  });

  it('rejects disabled state token, malformed input, unsupported route/method/media', async () => {
    errorShape(await post('chat', chat(40, {
      documents: [ALPHA_REF], provider_context_token: 'mock-state-token',
    })), 422, id(40));
    errorShape(await post('chat', { request_id: id(41), user_input: 'Hi' }), 400, id(41));
    errorShape(await post('draft-reply', { request_id: id(42), user_input: ' ' }), 400, id(42));
    errorShape(await post('chat', { request_id: id(43), session_id: SHARED_SESSION,
      user_input: 123 }), 400, id(43));
    errorShape(await wire('/api/v1/ai/does-not-exist', chat(44), { actor: 'alpha' }), 404, id(44));
    const method = await post('chat', chat(45), { method: 'GET' });
    errorShape(method, 405, id(45));
    expect(method.headers.allow).toBe('POST');
    errorShape(await post('chat', chat(46), { contentType: 'text/plain' }), 415, id(46));
  });

  it('rejects oversized streamed bodies with a bounded 400 and no falsely echoed UUID', async () => {
    const big = JSON.stringify({ ...chat(50), user_input: 'x'.repeat(65_000) });
    const reply = await post('chat', chat(50), { raw: big });
    requireSafe(reply, 400);
    expect(reply.json).not.toHaveProperty('request_id');
    expect(reply.body.length).toBeLessThan(2000);
  });

  it('blocks fabricated references, numeric fabrication and confidential URL disclosure', async () => {
    for (const [fault, n] of [
      ['bad-model-json', 60],
      ['fabricated-reference', 61],
      ['unsupported-number', 62],
      ['protected-url-leak', 63],
    ] as const) {
      const reply = await post('chat', { ...chat(n),
        user_input: 'Is the cap 9.7 million?' }, { fault });
      errorShape(reply, 502, id(n));
      expect(reply.body).not.toContain('9.7 million');
    }
    errorShape(await post('chat', chat(64), { fault: 'model-denied' }), 500, id(64));
    errorShape(await post('chat', chat(65), { fault: 'model-unavailable' }), 503, id(65));
    errorShape(await post('chat', chat(66, { documents: [ALPHA_REF] }),
      { fault: 'document-unavailable' }), 422, id(66));
  });

  it('performs no HTTPS, DNS or fetch calls from the local synthetic adapters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const httpsSpy = vi.spyOn(https, 'request');
    try {
      const response = await post('chat', chat(70));
      requireSafe(response, 200, id(70));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      httpsSpy.mockRestore();
    }
  });

  it('returns a real deadline-driven HTTP 503 for synthetic non-settling model work', async () => {
    const response = await post('chat', chat(80), { fault: 'model-timeout' });
    errorShape(response, 503, id(80));
    expect(response.json.user_error_message).toBe('AI service timed out.');
  }, 35_000);
});
