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


/**
 * The four published request/response illustrations in the actual 8-page Phase 1 v2.0 PDF:
 * chat §2.1 pp.1–2, summarize §2.2 p.2, extract §2.3 pp.2–3,
 * draft-reply §2.4 pp.3–4.  Protected URLs are fixture strings, never fetched.
 *
 * The chat illustration carries BOTH optional context mechanisms.  Those are
 * onboarding choices (§4), not required for a stateless text/document turn;
 * this fixture deliberately omits them rather than pretending they work.
 */
describe('published eOffice Phase 1 v2.0 examples (mocked, no external access)', () => {
  const officer: Principal = {
    department: 'test-department', officer: 'officer_4512',
    permissions: ['chat', 'summarize', 'extract', 'draft-reply'],
  };
  const examples = [
    {
      task: 'chat',
      request: {
        request_id: 'b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a',
        session_id: 'chat_session_4512', user_id: 'officer_4512',
        user_input: 'What is the budget cap under the attached policy?',
        context: { documents: [{ document_id: 'doc_policy_2026',
          download_url: 'https://eoffice.example.gov/api/files/temp/abc123' }] },
      },
      modelOutput: { text: 'According to Budget Guidelines 2026, the applicable budget cap is 1.2 million.',
        used_document_ids: ['doc_policy_2026'] },
      sourceTitles: { doc_policy_2026: { title: 'Budget Guidelines 2026', page_number: 3 } },
      expected: {
        request_id: 'b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a',
        answer: 'According to Budget Guidelines 2026, the applicable budget cap is 1.2 million.',
        references: [{ document_id: 'doc_policy_2026', title: 'Budget Guidelines 2026', page_number: 3 }],
      },
    },
    {
      task: 'summarize',
      request: {
        request_id: 'c7e9f5b3-8d40-4e2b-9f3c-6a0d7e4f9a2b',
        user_id: 'officer_4512',
        user_input: 'Summarize the key decisions in bullet points.',
        context: { documents: [{ document_id: 'doc_policy_2026',
          download_url: 'https://eoffice.example.gov/api/files/temp/abc123' }] },
      },
      modelOutput: { text: '- Prior approval is required for the specified expenditure.\n- Applications must be submitted before the quarterly deadline.',
        used_document_ids: ['doc_policy_2026'] },
      sourceTitles: { doc_policy_2026: { title: 'Budget Guidelines 2026' } },
      expected: {
        request_id: 'c7e9f5b3-8d40-4e2b-9f3c-6a0d7e4f9a2b',
        summary: '- Prior approval is required for the specified expenditure.\n- Applications must be submitted before the quarterly deadline.',
      },
    },
    {
      task: 'extract',
      request: {
        request_id: 'd8f0a6c4-9e51-4f3c-8a4d-7b1e8f5a0c3d',
        user_id: 'officer_4512',
        context: { documents: [{ document_id: 'receipt_9912',
          download_url: 'https://eoffice.example.gov/api/files/temp/xyz789' }] },
        extraction_schema: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            letter_number: { type: 'string' },
            letter_date: { type: ['string', 'null'] },
          },
          required: ['letter_number', 'subject'],
        },
      },
      modelOutput: {
        extracted_data: { letter_number: 'R-2026-9912', subject: 'RT! Query on XYZ', letter_date: null },
        used_document_ids: ['receipt_9912'],
      },
      sourceTitles: { receipt_9912: { title: 'Incoming correspondence', page_number: 1 } },
      expected: {
        request_id: 'd8f0a6c4-9e51-4f3c-8a4d-7b1e8f5a0c3d',
        extracted_data: { letter_number: 'R-2026-9912', subject: 'RT! Query on XYZ', letter_date: null },
        references: [{ document_id: 'receipt_9912', title: 'Incoming correspondence', page_number: 1 }],
      },
    },
    {
      task: 'draft-reply',
      request: {
        request_id: 'e9a1b7d5-0f62-4a4d-8b2f-9a6b1c4d2e7f',
        user_id: 'officer_4512',
        user_input: 'Prepare a formal draft reply acknowledging the budget request and asking for supporting documents.',
        context: { documents: [{ document_id: 'doc_incoming_101',
          download_url: 'https://eoffice.example.gov/api/files/temp/pqr456' }] },
      },
      modelOutput: {
        text: 'Subject: Request for supporting documents\n\nSir/Madam,\n\nWith reference to your budget allocation proposal, kindly submit the supporting financial statements for further examination.\n\nYours faithfully,\n[Authorized Officer]',
        used_document_ids: ['doc_incoming_101'],
      },
      sourceTitles: { doc_incoming_101: { title: 'Incoming Budget Request' } },
      expected: {
        request_id: 'e9a1b7d5-0f62-4a4d-8b2f-9a6b1c4d2e7f',
        draft_text: 'Subject: Request for supporting documents\n\nSir/Madam,\n\nWith reference to your budget allocation proposal, kindly submit the supporting financial statements for further examination.\n\nYours faithfully,\n[Authorized Officer]',
        references: [{ document_id: 'doc_incoming_101', title: 'Incoming Budget Request' }],
      },
    },
  ] as const;

  for (const example of examples) {
    it(example.task + ': implements the published mandatory fields and response envelope', async () => {
      const model = vi.fn(async () => JSON.stringify(example.modelOutput));
      const sources = example.sourceTitles as Record<string, { title: string; page_number?: number }>;
      const documents = { fetch: vi.fn(async (ref: { document_id: string; download_url: string }) => ({
        document_id: ref.document_id, title: sources[ref.document_id]?.title ?? '',
        ...(sources[ref.document_id]?.page_number ? { page_number: sources[ref.document_id].page_number } : {}),
        text: 'Synthetic, mock-supplied supporting text for ' + ref.document_id,
      })) };
      const api = createEofficeApi({ authorize: async () => officer, model, documents });
      const response = await api(event(example.task, example.request));
      expect(response.statusCode).toBe(200);
      expect(body(response)).toEqual(example.expected);
      expect(response.headers['content-type']).toContain('application/json');
      expect(model).toHaveBeenCalledTimes(1);
      expect(documents.fetch).toHaveBeenCalledTimes(1);
      expect(response.body).not.toContain('download_url');
      expect(response.body).not.toContain('https://eoffice.example.gov/api/files/temp/');
    });
  }
});
