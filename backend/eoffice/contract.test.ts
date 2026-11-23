import { describe, expect, it, vi } from 'vitest';
import { createEofficeApi, type Event, type Principal } from './core';
import { handler as productionHandler } from './handler';

const request_id = 'f119b216-5ca1-4d45-979e-4eac9ffcd81e';
const file = { document_id: 'note-17', download_url: 'https://department.example.gov/protected/note-17' };
const principal: Principal = { department: 'department', officer: 'officer-17',
  permissions: ['chat', 'summarize', 'extract', 'draft-reply'] };
const schema = { type: 'object', properties: {
  subject: { type: 'string' }, file_number: { type: ['string', 'null'] },
  approved: { type: ['boolean', 'null'] },
}, required: ['subject'] };
const event = (path: string, input: Record<string, unknown>): Event => ({
  rawPath: '/api/v1/ai/' + path,
  requestContext: { http: { method: 'POST' } },
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ request_id, user_id: principal.officer, ...input }),
});
const body = (response: { body: string }) => JSON.parse(response.body) as Record<string, unknown>;
const make = (output: unknown) => {
  const model = vi.fn(async () => JSON.stringify(output));
  const documents = { fetch: vi.fn(async (ref: typeof file) =>
    ({ document_id: ref.document_id, title: 'Office note 17', text: 'Subject: Leave application. No file number or approval is recorded.' })) };
  const api = createEofficeApi({ authorize: async () => principal, model, documents });
  return { api, model, documents };
};

describe('eOffice Phase 1 v2.0 mocked contract fixtures (Task 22A)', () => {
  it('chat: synchronous HTTP 200, UUID echo, answer and document references', async () => {
    const { api } = make({ text: 'The note concerns a leave application.', used_document_ids: [file.document_id] });
    const response = await api(event('chat', { session_id: 'office-session', user_input: 'What is the subject?',
      context: { documents: [file] } }));
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ request_id, answer: 'The note concerns a leave application.',
      references: [{ document_id: file.document_id, title: 'Office note 17' }] });
    expect(response.body).not.toContain(file.download_url);
  });

  it('summarize: source-text-only request produces the exact public summary shape', async () => {
    const { api, documents } = make({ text: 'The office note requests leave.', used_document_ids: [] });
    const response = await api(event('summarize', { user_input: 'The office note requests leave for two working days.' }));
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ request_id, summary: 'The office note requests leave.' });
    expect(documents.fetch).not.toHaveBeenCalled();
  });

  it('extract: returns all declared properties, converting missing or blank optional fields to null', async () => {
    for (const optional of [undefined, '', '   ', '\t\n']) {
      const extracted_data: Record<string, unknown> = { subject: 'Leave application' };
      if (optional !== undefined) extracted_data.file_number = optional;
      const { api } = make({ extracted_data, used_document_ids: [file.document_id] });
      const response = await api(event('extract', { context: { documents: [file] }, extraction_schema: schema }));
      expect(response.statusCode).toBe(200);
      expect(body(response)).toEqual({ request_id,
        extracted_data: { subject: 'Leave application', file_number: null, approved: null },
        references: [{ document_id: file.document_id, title: 'Office note 17' }] });
    }
  });

  it('extract: missing mandatory evidence returns standardized 422 rather than fabricated values', async () => {
    for (const missing of [null, '', ' \t ', undefined]) {
      const extracted_data = missing === undefined ? {} : { subject: missing };
      const { api } = make({ extracted_data, used_document_ids: [file.document_id] });
      const response = await api(event('extract', { context: { documents: [file] }, extraction_schema: schema }));
      expect(response.statusCode).toBe(422);
      expect(body(response)).toMatchObject({ request_id, system_error_message: expect.any(String),
        user_error_message: expect.any(String) });
      expect(body(response)).not.toHaveProperty('extracted_data');
    }
  });

  it('draft-reply: returns reviewable text and references without fabricated download artifact', async () => {
    const { api } = make({ text: 'Draft: Please provide the supporting documents.', used_document_ids: [file.document_id] });
    const response = await api(event('draft-reply', { user_input: 'Draft an acknowledgement.',
      context: { documents: [file] } }));
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ request_id, draft_text: 'Draft: Please provide the supporting documents.',
      references: [{ document_id: file.document_id, title: 'Office note 17' }] });
    expect(body(response)).not.toHaveProperty('generated_file_url');
  });

  it('all endpoints: reject malformed model envelopes with standardized 502 and echoed UUID', async () => {
    const cases = [
      ['chat', { session_id: 's', user_input: 'What is recorded?' }],
      ['summarize', { user_input: 'This is a source passage reporting a meeting.' }],
      ['extract', { context: { documents: [file] }, extraction_schema: schema }],
      ['draft-reply', { user_input: 'Prepare a proposed reply.' }],
    ] as const;
    for (const [task, input] of cases) {
      const { api } = make({ text: 'AI text', used_document_ids: ['invented-reference'] });
      const response = await api(event(task, input));
      expect(response.statusCode).toBe(502);
      expect(body(response)).toEqual({ request_id, system_error_message: expect.any(String),
        user_error_message: expect.any(String) });
    }
  });

  it('production handler is fail-closed and never invokes an unauthenticated integration', async () => {
    const response = await productionHandler(event('chat', {
      session_id: 's', user_input: 'Read a protected file', context: { documents: [file] },
    }));
    expect(response.statusCode).toBe(403);
    expect(body(response)).toMatchObject({ request_id, user_error_message: 'Access denied.' });
  });
});
