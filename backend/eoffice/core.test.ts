import { describe, expect, it, vi } from 'vitest';
import { createEofficeApi, type Event, type Model, type Principal } from './core';
import type { DocumentSource } from './documents';

const id = 'b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a';
const principal: Principal = { department: 'dept-A', officer: 'officer_4512', permissions: ['chat', 'summarize', 'extract', 'draft-reply'] };
const docA = { document_id: 'doc_policy_2026', download_url: 'https://dept-a.example.gov/temp/abc' };
const docB = { document_id: 'doc_budget_2026', download_url: 'https://dept-a.example.gov/temp/xyz' };
const schema = { type: 'object', properties: { subject: { type: 'string' }, letter_date: { type: ['string', 'null'] } }, required: ['subject'] };
const docs: DocumentSource = { fetch: async d => ({ document_id: d.document_id, title: 'Title for ' + d.document_id, text: 'Budget cap is 1.2 million.' }) };
const narrative = (text = 'Valid answer', used_document_ids: string[] = []) =>
  JSON.stringify({ text, used_document_ids });
const extracted = (extracted_data: unknown, used_document_ids: string[] = []) =>
  JSON.stringify({ extracted_data, used_document_ids });
const defaultModel: Model = async () => narrative();
const routeCases: Array<{ task: string; request: Record<string, unknown> }> = [
  { task: 'chat', request: { request_id: id, session_id: 's1', user_input: 'Budget?' } },
  { task: 'summarize', request: { request_id: id, user_input: 'The policy establishes a budget cap of 1.2 million.' } },
  { task: 'extract', request: { request_id: id, context: { documents: [docA] }, extraction_schema: schema } },
  { task: 'draft-reply', request: { request_id: id, user_input: 'Draft an acknowledgement.' } },
];
function event(task: string, request: unknown, extra: Partial<Event> = {}): Event {
  return {
    rawPath: '/api/v1/ai/' + task, requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(request), ...extra,
  };
}
function api(options: {
  principal?: Principal | null; model?: Model; documents?: DocumentSource;
  history?: (url: string, principal: Principal, deadline: number) => Promise<string>;
} = {}) {
  return createEofficeApi({
    authorize: async () => options.principal === undefined ? principal : options.principal,
    documents: options.documents ?? docs, model: options.model ?? defaultModel, history: options.history,
  });
}
const result = (r: Awaited<ReturnType<ReturnType<typeof api>>>) => JSON.parse(r.body) as Record<string, unknown>;

describe('eOffice HTTP contracts', () => {
  for (const { task, request } of routeCases) {
    it(task + ': permits only POST and UTF-8 JSON, never dispatches invalid requests to the model', async () => {
      const model = vi.fn(defaultModel);
      const handler = api({ model });
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await handler(event(task, request, { requestContext: { http: { method } } }));
        expect(response.statusCode).toBe(405);
        expect(result(response).request_id).toBe(id);
        expect(response.headers.allow).toBe('POST');
      }
      for (const contentType of ['text/plain', 'application/json; charset=iso-8859-1', 'application/xml']) {
        const response = await handler(event(task, request, { headers: { 'Content-Type': contentType } }));
        expect(response.statusCode).toBe(415);
        expect(result(response).request_id).toBe(id);
      }
      expect((await handler(event(task, request, { headers: {} }))).statusCode).toBe(415);
      expect((await handler(event(task, request, { isBase64Encoded: true, body: Buffer.from(JSON.stringify(request)).toString('base64') }))).statusCode).toBe(400);
      expect(model).not.toHaveBeenCalled();
    });
  }
  it('accepts standard and case-insensitive application/json headers', async () => {
    const handler = api();
    const r = await handler(event('chat', routeCases[0].request, { headers: { 'CONTENT-TYPE': 'Application/JSON; Charset="UTF-8"' } }));
    expect(r.statusCode).toBe(200);
  });
  it('echoes only a validated UUID for unauthorized and malformed requests', async () => {
    const unauthorized = api({ principal: null });
    const r = await unauthorized(event('chat', { request_id: id, session_id: 's', user_id: 'anyone', user_input: 'Hi' }));
    expect(r.statusCode).toBe(403);
    expect(result(r).request_id).toBe(id);
    const bad = await unauthorized(event('chat', { request_id: 'not-a-uuid', user_input: 'Hi' }));
    expect(result(bad)).not.toHaveProperty('request_id');
    const oversized = await unauthorized(event('chat', { request_id: id, user_input: 'x'.repeat(65000) }));
    expect(oversized.statusCode).toBe(400);
    expect(result(oversized)).not.toHaveProperty('request_id');
    const malformed = await api()(event('chat', {}, { body: '{invalid-json' }));
    expect(malformed.statusCode).toBe(400);
    expect(result(malformed)).not.toHaveProperty('request_id');
    const missing = await api()(event('chat', { request_id: id, user_input: 'Hi' }));
    expect(missing.statusCode).toBe(400);
    expect(result(missing).request_id).toBe(id);
  });
});

describe('eOffice Phase 1 response contracts', () => {
  it('returns chat answer with only an attributed eOffice reference and exact request ID', async () => {
    const r = await api({ model: async () => narrative('The cap is 1.2 million.', [docA.document_id]) })(
      event('chat', { request_id: id, user_id: principal.officer, session_id: 'chat-4512', user_input: 'Budget?', context: { documents: [docA, docB] } }));
    expect(r.statusCode).toBe(200);
    expect(result(r)).toEqual({
      request_id: id, answer: 'The cap is 1.2 million.',
      references: [{ document_id: docA.document_id, title: 'Title for ' + docA.document_id }],
    });
    expect(r.body).not.toContain(docA.download_url);
  });
  it('returns empty references when no document was used, even when attached', async () => {
    const r = await api()(event('chat', {
      request_id: id, session_id: 's', user_input: 'Hello', context: { documents: [docA, docB] },
    }));
    expect(r.statusCode).toBe(200);
    expect(result(r).references).toEqual([]);
  });
  it('refuses unknown, duplicate, and fabricated model source IDs', async () => {
    const req = { request_id: id, user_input: 'Draft a reply.', context: { documents: [docA, docB] } };
    for (const ids of [['not-supplied'], [docA.document_id, docA.document_id]]) {
      const r = await api({ model: async () => narrative('Reply', ids) })(event('draft-reply', req));
      expect(r.statusCode).toBe(502);
      expect(result(r).request_id).toBe(id);
    }
    expect((await api()(event('draft-reply', { ...req, context: { documents: [docA, docA] } }))).statusCode).toBe(400);
  });
  it('rejects protected URL disclosure in narrative output', async () => {
    const r = await api({ model: async () => narrative('Open ' + docA.download_url, [docA.document_id]) })(
      event('draft-reply', { request_id: id, user_input: 'Draft a reply', context: { documents: [docA] } }));
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain(docA.download_url);
  });
  it('summarizes source text without requiring a new mandatory request field', async () => {
    const r = await api()(event('summarize', { request_id: id, user_input: 'The committee approved the financial proposal on 6 November.' }));
    expect(r.statusCode).toBe(200);
    expect(result(r)).toEqual({ request_id: id, summary: 'Valid answer' });
  });
  it('rejects instruction-only summarization without invoking inference', async () => {
    const model = vi.fn(defaultModel);
    for (const user_input of ['Summarize the attached document', 'Please summarize the key decisions in bullets.', 'Provide a summary of the above text.']) {
      const r = await api({ model })(event('summarize', { request_id: id, user_input }));
      expect(r.statusCode).toBe(400);
      expect(result(r).request_id).toBe(id);
    }
    expect(model).not.toHaveBeenCalled();
  });
  it('permits clearly delimited source text and instruction-only input WITH documents', async () => {
    const handler = api();
    expect((await handler(event('summarize', {
      request_id: id, user_input: 'Summarize as bullets.\nSource text:\nThe meeting approved a cap of 12 lakh.',
    }))).statusCode).toBe(200);
    expect((await handler(event('summarize', {
      request_id: id, user_input: 'Summarize the key decisions in bullets.', context: { documents: [docA] },
    }))).statusCode).toBe(200);
  });
  it('returns full structured extraction and nullable optional values', async () => {
    const r = await api({ model: async () => extracted({ subject: 'Budget' }, [docA.document_id]) })(
      event('extract', { request_id: id, context: { documents: [docA] }, extraction_schema: schema }));
    expect(r.statusCode).toBe(200);
    expect(result(r)).toEqual({
      request_id: id, extracted_data: { subject: 'Budget', letter_date: null },
      references: [{ document_id: docA.document_id, title: 'Title for ' + docA.document_id }],
    });
  });
  it('treats genuinely unavailable required extraction fields as 422, malformed model output as 502', async () => {
    const req = event('extract', { request_id: id, context: { documents: [docA] }, extraction_schema: schema });
    for (const value of [extracted({ subject: null }), extracted({}), extracted({ subject: '' })]) {
      const r = await api({ model: async () => value })(req);
      expect(r.statusCode).toBe(422);
      expect(result(r).request_id).toBe(id);
    }
    for (const value of ['not JSON', '{"subject":"Budget"}', extracted({ subject: 123 }), extracted({ subject: 'Budget', junk: true })]) {
      const r = await api({ model: async () => value })(req);
      expect(r.statusCode).toBe(502);
    }
  });
  it('returns 422 for whitespace-only required extraction strings without misclassifying malformed output', async () => {
    const req = event('extract', { request_id: id, context: { documents: [docA] }, extraction_schema: schema });
    for (const blank of [' ', '   ', '\t', ' \n\t ']) {
      const r = await api({ model: async () => extracted({ subject: blank }) })(req);
      expect(r.statusCode).toBe(422);
      expect(result(r).request_id).toBe(id);
    }
    const malformed = await api({ model: async () => extracted({ subject: 42 }) })(req);
    expect(malformed.statusCode).toBe(502);
  });
  it('returns proposed correspondence without invented file links', async () => {
    const r = await api()(event('draft-reply', { request_id: id, user_input: 'Draft an acknowledgement.' }));
    expect(result(r)).toEqual({ request_id: id, draft_text: 'Valid answer', references: [] });
    expect(result(r)).not.toHaveProperty('generated_file_url');
  });
  it('retains user identity and chat-history boundaries', async () => {
    const r = await api()(event('chat', { request_id: id, session_id: 's', user_input: 'hi', user_id: 'another_officer' }));
    expect(r.statusCode).toBe(403);
    expect((await api()(event('chat', { request_id: id, session_id: 's', user_input: 'hi', context: { provider_context_token: 'opaque' } }))).statusCode).toBe(422);
    expect((await api()(event('chat', { request_id: id, session_id: 's', user_input: 'hi', context: { previous_context: 'https://eoffice.example.gov/history' } }))).statusCode).toBe(422);
    const withHistory = await api({ history: async (_url, p) => {
      expect(p.department).toBe('dept-A');
      return 'Previous officer answer.';
    } })(event('chat', { request_id: id, session_id: 's', user_input: 'Continue', context: { previous_context: 'https://eoffice.example.gov/history' } }));
    expect(withHistory.statusCode).toBe(200);
  });
  it('passes only a trusted tenant principal and deadline into the document adapter', async () => {
    const seen: string[] = [];
    const source: DocumentSource = { fetch: async (d, p, deadline) => {
      seen.push(p.department + ':' + p.officer);
      expect(deadline).toBeGreaterThan(Date.now());
      return { document_id: d.document_id, title: 'Policy', text: 'A policy fact.' };
    } };
    const second: Principal = { department: 'dept-B', officer: 'officer_B', permissions: ['chat'] };
    for (const p of [principal, second]) {
      const r = await api({ principal: p, documents: source })(event('chat', {
        request_id: id, session_id: 's', user_input: 'Question?', user_id: p.officer, context: { documents: [docA] },
      }));
      expect(r.statusCode).toBe(200);
    }
    expect(seen).toEqual(['dept-A:officer_4512', 'dept-B:officer_B']);
  });
  it('bounds the combined prompt, history and model deadline without charging Bedrock', async () => {
    const model = vi.fn(defaultModel);
    const bigDocs: DocumentSource = { fetch: async d => ({ document_id: d.document_id, title: 'Policy', text: 'Policy '.repeat(2300) }) };
    const r = await api({ model, documents: bigDocs, history: async () => 'H'.repeat(7000) })(
      event('chat', { request_id: id, session_id: 's', user_input: 'Q'.repeat(12000),
        context: { documents: [docA], previous_context: 'https://eoffice.example.gov/history' } }));
    expect(r.statusCode).toBe(422);
    expect(model).not.toHaveBeenCalled();
    const time = vi.fn(defaultModel);
    const ok = await api({ model: time })(event('chat', { request_id: id, session_id: 's', user_input: 'What is known?' }));
    expect(ok.statusCode).toBe(200);
    expect(time.mock.calls[0][3]).toBeLessThanOrEqual(18000);
    expect(time.mock.calls[0][3]).toBeGreaterThan(0);
  });
  it('rejects a document adapter returning a different ID or unsafe reference metadata', async () => {
    const wrong: DocumentSource = { fetch: async () => ({
      document_id: 'other_department_document', title: 'Policy', text: 'Classified material',
    }) };
    const r = await api({ documents: wrong })(event('chat', {
      request_id: id, session_id: 's', user_input: 'Question?', context: { documents: [docA] },
    }));
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('Classified material');
    expect(result(r).request_id).toBe(id);
  });
  it('returns 503 without invoking the model when the shared invocation budget is exhausted', async () => {
    const clock = vi.spyOn(Date, 'now');
    const model = vi.fn(defaultModel);
    let reads = 0;
    clock.mockImplementation(() => reads++ === 0 ? 100000 : 125000);
    try {
      const r = await api({ model })(event('chat', {
        request_id: id, session_id: 's', user_input: 'Continue',
      }));
      expect(r.statusCode).toBe(503);
      expect(result(r).request_id).toBe(id);
      expect(model).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it('does not expose thrown sensitive model errors', async () => {
    const r = await api({ model: async () => { throw new Error('SECRET DOWNLOADED FILE'); } })(
      event('chat', { request_id: id, session_id: 's', user_input: 'Hi' }));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('SECRET');
    expect(result(r).request_id).toBe(id);
  });
});
