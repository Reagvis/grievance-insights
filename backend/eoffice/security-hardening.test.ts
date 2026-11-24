import { describe, expect, it, vi } from 'vitest';
import { createEofficeApi, type Event, type Model, type Principal } from './core';
import { HttpsDocuments, safeUrl } from './documents';
import { EofficeError } from './schema';
import { createMockEofficeHarness } from './testing/mock-harness';

const id = '10000000-0000-4000-8000-000000000022';
const principal: Principal = {
  department: 'finance-A', officer: 'officer-1', permissions: ['chat'],
};
const ref = {
  document_id: 'finance-policy',
  download_url: 'https://files.example.gov/secure/finance-policy',
};
const material = {
  document_id: ref.document_id,
  title: 'Finance policy',
  text: 'The finance policy includes a capital allocation.',
};
const answer: Model = async () => JSON.stringify({
  text: 'The request was received.', used_document_ids: [], evidence: [],
});
const documents = { fetch: async () => material };
const authorized = async () => principal;
function request(context?: Record<string, unknown>): Event {
  return {
    rawPath: '/api/v1/ai/chat',
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request_id: id, session_id: 'session-1', user_id: principal.officer,
      user_input: 'Continue.', ...(context ? { context } : {}),
    }),
  };
}
function assertRedacted(body: string): void {
  expect(body).not.toContain('PRIVATE_DIAGNOSTIC');
  expect(body).not.toContain('PRIVATE_PUBLIC_MESSAGE');
}

describe('Task 22D — isolated dependency boundaries', () => {
  it.each(['authorization', 'history'] as const)(
    'bounds a non-settling %s adapter and never invokes inference', async kind => {
      vi.useFakeTimers();
      try {
        const model = vi.fn(answer);
        const handler = createEofficeApi({
          authorize: kind === 'authorization'
            ? async () => new Promise<Principal | null>(() => {})
            : authorized,
          documents,
          model,
          ...(kind === 'history'
            ? { history: async () => new Promise<string>(() => {}) }
            : {}),
        });
        const pending = handler(request(kind === 'history'
          ? { previous_context: 'opaque-authorized-history-reference' }
          : undefined));
        await vi.advanceTimersByTimeAsync(25001);
        const result = await pending;
        expect(result.statusCode).toBe(503);
        expect(JSON.parse(result.body).request_id).toBe(id);
        expect(model).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['document', 'history'] as const)(
    'does not start an already-expired %s adapter or later model inference', async kind => {
      const start = 100_000;
      let now = start;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const fetch = vi.fn(async () => {
          if (kind === 'history') now = start + 25_000;
          return material;
        });
        const history = vi.fn(async () => 'Authorized prior conversation.');
        const model = vi.fn(answer);
        const handler = createEofficeApi({
          authorize: async () => {
            if (kind === 'document') now = start + 25_000;
            return principal;
          },
          documents: { fetch }, history, model,
        });
        const response = await handler(request(kind === 'document'
          ? { documents: [ref] }
          : { documents: [ref], previous_context: 'opaque-authorized-history-reference' }));
        expect(response.statusCode).toBe(503);
        expect(JSON.parse(response.body)).toEqual({
          request_id: id,
          system_error_message: expect.any(String),
          user_error_message: 'AI service timed out.',
        });
        if (kind === 'document') expect(fetch).not.toHaveBeenCalled();
        else expect(fetch).toHaveBeenCalledOnce();
        expect(history).not.toHaveBeenCalled();
        expect(model).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    },
  );

  it('rechecks the deadline inside the queued microtask before starting document retrieval', async () => {
    const start = 200_000;
    let now = start;
    let readsAfterAuth = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fetch = vi.fn(async () => material);
      const model = vi.fn(answer);
      const handler = createEofficeApi({
        authorize: async () => {
          // The initial document deadline check observes valid time,
          // but advances the clock before the queued callback executes.
          // The callback must refuse to call fetch() after expiry.
          clock.mockImplementation(() => {
            readsAfterAuth++;
            if (readsAfterAuth === 1) {
              now = start + 25_000;
              return start;
            }
            return now;
          });
          return principal;
        },
        documents: { fetch }, model,
      });
      const response = await handler(request({ documents: [ref] }));
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({
        request_id: id,
        user_error_message: 'AI service timed out.',
      });
      expect(readsAfterAuth).toBeGreaterThanOrEqual(2);
      expect(fetch).not.toHaveBeenCalled();
      expect(model).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('never exposes diagnostics or public messages supplied by adapters', async () => {
    const secretError = (status: number) =>
      new EofficeError(status, 'PRIVATE_DIAGNOSTIC', 'PRIVATE_PUBLIC_MESSAGE');

    const cases = [
      {
        name: 'authorization', status: 403, context: undefined,
        deps: { authorize: async () => { throw secretError(403); }, documents, model: answer },
      },
      {
        name: 'document', status: 422, context: { documents: [ref] },
        deps: { authorize: authorized,
          documents: { fetch: async () => { throw secretError(422); } }, model: answer },
      },
      {
        name: 'history', status: 422,
        context: { previous_context: 'opaque-authorized-history-reference' },
        deps: { authorize: authorized, documents, model: answer,
          history: async () => { throw secretError(422); } },
      },
      {
        name: 'model', status: 503, context: undefined,
        deps: { authorize: authorized, documents,
          model: async () => { throw secretError(503); } },
      },
      {
        name: 'malformed provider response', status: 502, context: undefined,
        deps: { authorize: authorized, documents,
          model: async () => { throw secretError(502); } },
      },
    ];
    for (const scenario of cases) {
      const result = await createEofficeApi(scenario.deps)(
        request(scenario.context),
      );
      expect(result.statusCode, scenario.name).toBe(scenario.status);
      assertRedacted(result.body);
    }
  });

  it('distinguishes genuine auth denial from unexpected identity-service exceptions', async () => {
    const secretError = (status: number) =>
      new EofficeError(status, 'PRIVATE_DIAGNOSTIC auth credentials',
        'PRIVATE_PUBLIC_MESSAGE auth credentials');
    const scenarios = [
      { name: 'null principal', authorize: async () => null, expected: 403 },
      { name: 'explicit trusted denial', authorize: async () => { throw secretError(403); }, expected: 403 },
      { name: 'unexpected identity outage', authorize: async () => {
        throw new Error('PRIVATE_DIAGNOSTIC identity provider unavailable');
      }, expected: 500 },
      { name: 'upstream authorization fault', authorize: async () => {
        throw secretError(500);
      }, expected: 500 },
      { name: 'unexpected authorization input error', authorize: async () => {
        throw secretError(422);
      }, expected: 500 },
      { name: 'reported authorization unavailability', authorize: async () => {
        throw secretError(503);
      }, expected: 503 },
    ];
    for (const scenario of scenarios) {
      const fetch = vi.fn(async () => material);
      const model = vi.fn(answer);
      const handler = createEofficeApi({
        authorize: scenario.authorize,
        documents: { fetch }, model,
      });
      const response = await handler(request({ documents: [ref] }));
      expect(response.statusCode, scenario.name).toBe(scenario.expected);
      expect(JSON.parse(response.body), scenario.name).toEqual({
        request_id: id,
        system_error_message: expect.any(String),
        user_error_message: expect.any(String),
      });
      assertRedacted(response.body);
      expect(response.body).not.toContain('auth credentials');
      expect(response.body).not.toContain('identity provider');
      expect(fetch, scenario.name).not.toHaveBeenCalled();
      expect(model, scenario.name).not.toHaveBeenCalled();
    }
  });

  it('classifies protected document and history access denial as 422, not caller 403', async () => {
    for (const kind of ['document', 'history'] as const) {
      for (const status of [403, 422]) {
        const secret = new EofficeError(status, 'PRIVATE_DIAGNOSTIC restricted URL',
          'PRIVATE_PUBLIC_MESSAGE protected token');
        const fetch = vi.fn(async () => {
          if (kind === 'document') throw secret;
          return material;
        });
        const history = vi.fn(async () => {
          if (kind === 'history') throw secret;
          return 'Authorized history placeholder.';
        });
        const model = vi.fn(answer);
        const handler = createEofficeApi({
          authorize: authorized, documents: { fetch }, model, history,
        });
        const response = await handler(request(kind === 'document'
          ? { documents: [ref] }
          : { previous_context: 'opaque-authorized-history-reference' }));
        expect(response.statusCode, kind + ' ' + status).toBe(422);
        expect(JSON.parse(response.body)).toEqual({
          request_id: id,
          system_error_message: kind === 'document'
            ? 'Authorized document unavailable.'
            : 'Authorized history unavailable.',
          user_error_message: kind === 'document'
            ? 'The requested document is unavailable.'
            : 'Previous context is unavailable.',
        });
        assertRedacted(response.body);
        expect(response.body).not.toContain('restricted URL');
        expect(response.body).not.toContain('protected token');
        expect(model).not.toHaveBeenCalled();
        if (kind === 'history') expect(fetch).not.toHaveBeenCalled();
      }
    }
  });

  it('never lets model-supplied 403 become caller denial; preserves 502/503 failures', async () => {
    const cases = [
      { name: 'misleading model 403', status: 403, expected: 500 },
      { name: 'malformed provider 502', status: 502, expected: 502 },
      { name: 'model unavailable 503', status: 503, expected: 503 },
    ];
    for (const scenario of cases) {
      const model = vi.fn(async () => {
        throw new EofficeError(scenario.status, 'PRIVATE_DIAGNOSTIC model credentials',
          'PRIVATE_PUBLIC_MESSAGE protected token');
      });
      const response = await createEofficeApi({
        authorize: authorized, documents, model,
      })(request());
      expect(response.statusCode, scenario.name).toBe(scenario.expected);
      const payload = JSON.parse(response.body);
      expect(payload).toEqual({
        request_id: id,
        system_error_message: expect.any(String),
        user_error_message: expect.any(String),
      });
      if (scenario.status === 403) expect(payload.user_error_message).not.toBe('Access denied.');
      assertRedacted(response.body);
      expect(response.body).not.toContain('model credentials');
      expect(response.body).not.toContain('protected token');
      expect(model).toHaveBeenCalledOnce();
    }
    const malformed = await createEofficeApi({
      authorize: authorized, documents, model: async () => 'not JSON',
    })(request());
    expect(malformed.statusCode).toBe(502);
    expect(JSON.parse(malformed.body).request_id).toBe(id);
  });

  it('does not let a test-only document override bypass officer or department scope', async () => {
    const override = vi.fn(async () => material);
    const harness = createMockEofficeHarness({
      documents: [{
        department: principal.department, officer: principal.officer,
        downloadUrl: ref.download_url, material,
      }],
      fetchDocument: override,
      model: answer,
    });
    for (const other of [
      { ...principal, officer: 'officer-2' },
      { ...principal, department: 'finance-B' },
    ]) {
      const result = await harness.handler(harness.issue('chat', {
        request_id: id, session_id: 'session-1', user_id: other.officer,
        user_input: 'Hello.', context: { documents: [ref] },
      }, other));
      expect(result.statusCode).toBe(422);
    }
    expect(override).not.toHaveBeenCalled();

    const accepted = await harness.handler(harness.issue('chat', {
      request_id: id, session_id: 'session-1', user_id: principal.officer,
      user_input: 'Hello.', context: { documents: [ref] },
    }, principal));
    expect(accepted.statusCode).toBe(200);
    expect(override).toHaveBeenCalledOnce();
  });
});

describe('Task 22D — protected downloader SSRF regression', () => {
  const allow = new Set(['files.example.gov']);

  it('requires exact HTTPS hosts without embedded credentials or custom ports', () => {
    expect(safeUrl('https://files.example.gov/docs/1', allow).hostname)
      .toBe('files.example.gov');
    for (const url of [
      'http://files.example.gov/docs/1',
      'ftp://files.example.gov/docs/1',
      'https://officer:password@files.example.gov/docs/1',
      'https://files.example.gov:8443/docs/1',
      'https://sub.files.example.gov/docs/1',
      'https://files.example.gov.evil.example/docs/1',
      'https://127.0.0.1/docs/1',
    ]) {
      expect(() => safeUrl(url, allow)).toThrow(EofficeError);
    }
  });

  it('rejects a mixed public/private DNS answer before opening transport', async () => {
    const transport = vi.fn(async () => ({
      bytes: new TextEncoder().encode('Public placeholder.'),
      contentType: 'text/plain',
    }));
    const source = new HttpsDocuments(
      async () => ({ allowedHosts: allow, headers: {} }),
      async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      transport,
    );
    await expect(source.fetch(ref, principal, Date.now() + 4000))
      .rejects.toMatchObject({ status: 422 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('uses only the injected pinned transport for an allowed address', async () => {
    const transport = vi.fn(async () => ({
      bytes: new TextEncoder().encode('Public placeholder for policy testing.'),
      contentType: 'text/plain',
    }));
    const source = new HttpsDocuments(
      async () => ({ allowedHosts: allow, headers: {} }),
      async () => [{ address: '8.8.8.8', family: 4 }],
      transport,
    );
    const doc = await source.fetch(ref, principal, Date.now() + 4000);
    expect(doc.document_id).toBe(ref.document_id);
    expect(doc.text).toContain('policy testing');
    expect(transport).toHaveBeenCalledOnce();
  });
});
