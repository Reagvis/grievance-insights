import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createEofficeApi, type Event, type Model, type Principal } from './core';
import { HttpsDocuments, declaredFilename, extractDocument, type DocumentSource, type Material } from './documents';

const request_id = '7f9bc8c2-71a4-42fa-a32c-fac64fb0842e';
const officer: Principal = {
  department: 'dept-A', officer: 'officer-4',
  permissions: ['chat', 'summarize', 'extract', 'draft-reply'],
};
const docA = { document_id: 'doc-A', download_url: 'https://docs.example.gov/temp/A?ticket=secret-A' };
const docB = { document_id: 'doc-B', download_url: 'https://docs.example.gov/temp/B?ticket=secret-B' };
const pageOne = 'The introductory note lists office correspondence and approval responsibilities.';
const pageThree = 'The departmental budget cap is 1.2 million for this proposal.';
const pageOther = 'The office received this request on 17 November 2026 and recorded its status.';
const a: Material = {
  document_id: docA.document_id, title: 'Budget Guidelines 2026.pdf',
  pages: [{ page_number: 1, text: pageOne }, { page_number: 3, text: pageThree }],
  text: '[Page 1]\n' + pageOne + '\n[Page 3]\n' + pageThree,
};
const b: Material = {
  document_id: docB.document_id, title: 'Untitled eOffice document',
  text: pageOther,
};
const materials: Record<string, Material> = { [docA.document_id]: a, [docB.document_id]: b };
const schema = {
  type: 'object', properties: {
    subject: { type: 'string' }, letter_date: { type: ['string', 'null'] },
  }, required: ['subject'],
};
function event(task: string, input: Record<string, unknown>): Event {
  return {
    rawPath: '/api/v1/ai/' + task, requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request_id, user_id: officer.officer, ...input }),
  };
}
const result = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;
function make(output: Record<string, unknown>, sources = materials) {
  const model: Model = vi.fn(async () => JSON.stringify(output));
  const documents: DocumentSource = {
    fetch: async d => {
      const material = sources[d.document_id];
      if (!material) throw new Error('Unknown fixture document');
      return material;
    },
  };
  return { api: createEofficeApi({ authorize: async () => officer, model, documents }), model };
}
const quote = (document_id: string, value: string, page_number?: number) => ({
  document_id, quote: value, ...(page_number ? { page_number } : {}),
});
const chat = (documents = [docA, docB]) =>
  event('chat', { session_id: 'session-4', user_input: 'What does the policy say?', context: { documents } });
const good = {
  text: 'The cap is 1.2 million.', used_document_ids: [docA.document_id],
  evidence: [quote(docA.document_id, pageThree)],
};

describe('Task 22B: bounded evidence and provenance enforcement', () => {
  it('uses authenticated filename metadata as a label and never fabricates a title from document_id', async () => {
    const text = new TextEncoder().encode('The valid source records an approved office decision.');
    const known = await extractDocument(docA, text, 'text/plain',
      'attachment; filename="Budget Guidelines 2026.txt"');
    expect(known.title).toBe('Budget Guidelines 2026.txt');
    expect(known.text).toBe('The valid source records an approved office decision.');
    expect(known).not.toHaveProperty('pages');
    for (const unsafe of [
      'attachment; filename="../../private.txt"',
      'attachment; filename="https://docs.example.gov/secret"',
      'attachment; filename="notes\r\nAuthorization: stolen"',
      'attachment; filename="admin\\secrets.pdf"',
    ]) {
      const fallback = await extractDocument(docA, text, 'text/plain', unsafe);
      expect(fallback.title).toBe('Untitled eOffice document');
      expect(fallback.title).not.toContain(docA.document_id);
    }
    expect(declaredFilename("attachment; filename*=UTF-8''%E0%B0%AA%E0%B0%A4%E0%B1%8D%E0%B0%B0%E0%B0%82.pdf"))
      .toBe('పత్రం.pdf');
  });

  it('propagates only safe file labels from a mocked protected HTTPS response, not the URL', async () => {
    const download = vi.fn(async () => ({
      bytes: new TextEncoder().encode('This department document records the procurement budget decision.'),
      contentType: 'text/plain; charset=utf-8',
      contentDisposition: 'attachment; filename="Procurement Record 2026.txt"',
    }));
    const source = new HttpsDocuments(
      async () => ({ allowedHosts: new Set(['docs.example.gov']), headers: { Authorization: 'private' } }),
      async () => [{ address: '8.8.8.8', family: 4 }],
      download,
    );
    const material = await source.fetch(docA, officer, Date.now() + 5000);
    expect(material.title).toBe('Procurement Record 2026.txt');
    expect(material.title).not.toContain('secret-A');
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('derives a PDF page from verified source text, rather than accepting the model assertion', async () => {
    const { api } = make(good);
    const response = await api(chat());
    expect(response.statusCode).toBe(200);
    expect(result(response)).toEqual({
      request_id, answer: good.text,
      references: [{ document_id: docA.document_id, title: a.title, page_number: 3 }],
    });
  });

  it('refuses fabricated page numbers, unknown documents and evidence from the wrong page', async () => {
    const claims = [
      { ...good, evidence: [quote(docA.document_id, pageThree, 1)] },
      { ...good, evidence: [quote(docA.document_id, pageThree, 2)] },
      { ...good, evidence: [quote('unknown-document', pageThree)] },
      { ...good, used_document_ids: ['unknown-document'] },
      { ...good, evidence: [quote(docA.document_id, 'The policy approved 900 million.') ] },
    ];
    for (const output of claims) {
      const response = await make(output).api(chat());
      expect(response.statusCode).toBe(502);
      expect(result(response)).toEqual({ request_id,
        system_error_message: expect.any(String), user_error_message: expect.any(String) });
    }
  });

  it('omits page_number when valid evidence comes from multiple pages of one document', async () => {
    const { api } = make({
      text: 'The introduction and the budget cap are noted.',
      used_document_ids: [docA.document_id],
      evidence: [quote(docA.document_id, pageOne), quote(docA.document_id, pageThree)],
    });
    const response = await api(chat([docA]));
    expect(response.statusCode).toBe(200);
    expect(result(response).references).toEqual([{ document_id: docA.document_id, title: a.title }]);
  });

  it('requires independently matching evidence for every used document, including multi-document outputs', async () => {
    const valid = {
      text: 'The budget is 1.2 million and the letter was received on 17 November 2026.',
      used_document_ids: [docA.document_id, docB.document_id],
      evidence: [quote(docA.document_id, pageThree), quote(docB.document_id, pageOther)],
    };
    const response = await make(valid).api(chat());
    expect(response.statusCode).toBe(200);
    expect(result(response).references).toEqual([
      { document_id: docA.document_id, title: a.title, page_number: 3 },
      { document_id: docB.document_id, title: b.title },
    ]);
    for (const evidence of [
      [quote(docA.document_id, pageThree)],
      [quote(docA.document_id, pageThree), quote(docB.document_id, pageThree)],
    ]) {
      const failed = await make({ ...valid, evidence }).api(chat());
      expect(failed.statusCode).toBe(502);
    }
  });

  it('rejects an ambiguous cross-document quote instead of guessing attribution', async () => {
    const duplicate: Material = { ...b, text: pageThree };
    const failed = await make(good, { [docA.document_id]: a, [docB.document_id]: duplicate }).api(chat());
    expect(failed.statusCode).toBe(502);
  });

  it('rejects unsupported numeric claims despite valid reference and evidence', async () => {
    const model = { ...good, text: 'The cap is 9.7 million.' };
    const resultResponse = await make(model).api(chat());
    expect(resultResponse.statusCode).toBe(502);
    expect(resultResponse.body).not.toContain('9.7 million');
  });

  it('rejects extracted values absent from cited source, and preserves 422 for missing required values', async () => {
    const base = {
      used_document_ids: [docB.document_id], evidence: [quote(docB.document_id, pageOther)],
    };
    const input = event('extract', { context: { documents: [docB] }, extraction_schema: schema });
    const unsupported = await make({ ...base, extracted_data: {
      subject: 'An invented approval', letter_date: null,
    } }).api(input);
    expect(unsupported.statusCode).toBe(502);
    const missing = await make({ ...base, extracted_data: {
      subject: null, letter_date: null,
    } }).api(input);
    expect(missing.statusCode).toBe(422);
    const supported = await make({ ...base, extracted_data: {
      subject: 'The office received this request', letter_date: null,
    } }).api(input);
    expect(supported.statusCode).toBe(200);
    expect(result(supported).extracted_data).toEqual({
      subject: 'The office received this request', letter_date: null,
    });
  });

  it('rejects protected source URLs even when encoded, without leaking them in error body', async () => {
    for (const text of [
      'Download at ' + docA.download_url,
      'Download at ' + encodeURIComponent(docA.download_url),
      'See https://docs.example.gov/another-private-resource',
      'The bearer ticket is secret-A.',
    ]) {
      const response = await make({ ...good, text }).api(chat());
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain('secret-A');
      expect(result(response).request_id).toBe(request_id);
    }
  });

  it('rejects an invented external link in a proposed official draft', async () => {
    const output = {
      text: 'Please visit https://fabricated.example.org/approval',
      used_document_ids: [], evidence: [],
    };
    const response = await make(output).api(
      event('draft-reply', { user_input: 'Draft a short receipt acknowledgement.' }));
    expect(response.statusCode).toBe(502);
  });

  it('retains explicit source-size, invalid-PDF, and OCR-required failures without truncating text', async () => {
    const tooLong = new TextEncoder().encode('This is a valid source paragraph.\n'.repeat(1000));
    await expect(extractDocument(docA, tooLong, 'text/plain')).rejects.toMatchObject({ status: 422 });
    await expect(extractDocument(docA, new Uint8Array([0xff, 0xfe]), 'text/plain'))
      .rejects.toThrow();
    await expect(extractDocument(docA, new TextEncoder().encode('not really a PDF'), 'application/pdf'))
      .rejects.toMatchObject({ status: 422 });
    const searchable = readFileSync(new URL('../ingest/fixtures/searchable-english-3page.pdf', import.meta.url));
    const pdf = await extractDocument(docA, searchable, 'application/pdf');
    expect(pdf.pages).toHaveLength(3);
    expect(pdf.pages?.map(page => page.page_number)).toEqual([1, 2, 3]);
    expect(pdf.text).toContain('[Page 3]');
    const scanned = readFileSync(new URL('../ingest/fixtures/scanned-telugu-2page.pdf', import.meta.url));
    await expect(extractDocument(docA, scanned, 'application/pdf')).rejects.toMatchObject({ status: 422 });
  });
});
