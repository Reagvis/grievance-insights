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
