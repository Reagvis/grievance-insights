import { describe, expect, it } from 'vitest';
import { createEofficeApi, type Principal } from './core';
import type { DocumentSource } from './documents';
const id = 'b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a';
const principal: Principal = { department: 'd1', officer: 'officer_4512', permissions: ['chat','summarize','extract','draft-reply'] };
const documents: DocumentSource = { fetch: async d => ({ document_id: d.document_id, title: 'Policy', text: 'Budget cap is 1.2 million.' }) };
const doc = { document_id: 'doc_policy_2026', download_url: 'https://eoffice.example.gov/temp/abc' };
const invoke = (task: string, data: unknown, model = async () => 'Valid answer', authorized: Principal | null = principal) =>
  createEofficeApi({ authorize: async () => authorized, documents, model })({ rawPath: '/api/v1/ai/' + task, body: JSON.stringify(data) });
describe('eOffice Phase 1 contracts', () => {
  it('denies access by default', async () => expect((await invoke('chat', { request_id: id }, undefined, null)).statusCode).toBe(403));
  it('chat returns answer, references and exact request ID', async () => {
    const r = await invoke('chat', { request_id: id, user_id: principal.officer, session_id: 's1', user_input: 'Budget?', context: { documents: [doc] } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ request_id: id, answer: 'Valid answer', references: [{ document_id: doc.document_id, title: 'Policy' }] });
  });
  it('summarizes supplied source text without documents', async () => {
    const r = await invoke('summarize', { request_id: id, user_input: 'A short document to summarize.' });
    expect(JSON.parse(r.body)).toEqual({ request_id: id, summary: 'Valid answer' });
  });
  it('returns complete typed extraction with nullable optional fields', async () => {
    const extraction_schema = { type: 'object', properties: { subject: { type: 'string' }, letter_date: { type: ['string', 'null'] } }, required: ['subject'] };
    const r = await invoke('extract', { request_id: id, context: { documents: [doc] }, extraction_schema }, async () => '{"subject":"Budget"}');
    expect(JSON.parse(r.body).extracted_data).toEqual({ subject: 'Budget', letter_date: null });
  });
  it('returns 422 when mandatory extraction is absent', async () => {
    const r = await invoke('extract', { request_id: id, context: { documents: [doc] }, extraction_schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'] } }, async () => '{}');
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).request_id).toBe(id);
  });
  it('drafts without fabricating a generated file link', async () => {
    const r = await invoke('draft-reply', { request_id: id, user_input: 'Draft an acknowledgement.' });
    expect(JSON.parse(r.body)).toEqual({ request_id: id, draft_text: 'Valid answer', references: [] });
  });
  it('rejects missing session, malformed JSON, and identity mismatch', async () => {
    expect((await invoke('chat', { request_id: id, user_input: 'hi' })).statusCode).toBe(400);
    expect((await invoke('chat', { request_id: id, session_id: 's', user_input: 'hi', user_id: 'someone_else' })).statusCode).toBe(403);
  });
  it('rejects unagreed provider state tokens and missing history adapter', async () => {
    expect((await invoke('chat', { request_id: id, session_id: 's', user_input: 'hi', context: { provider_context_token: 'abc' } })).statusCode).toBe(422);
    expect((await invoke('chat', { request_id: id, session_id: 's', user_input: 'hi', context: { previous_context: 'https://example.gov/h' } })).statusCode).toBe(422);
  });
  it('rejects excessive input and suppresses model exception details', async () => {
    expect((await invoke('summarize', { request_id: id, user_input: 'x'.repeat(25000) })).statusCode).toBe(400);
    const r = await invoke('chat', { request_id: id, session_id: 's', user_input: 'hi' }, async () => { throw Error('SENSITIVE DATA'); });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('SENSITIVE DATA');
  });
});
