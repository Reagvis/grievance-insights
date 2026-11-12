import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ingestDocument, IngestError, LIMITS, type IngestResult } from './index';

const fx = (name: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const text = (s: string) => new TextEncoder().encode(s);
const complete = (r: IngestResult) => {
  if (r.kind !== 'complete') throw new Error('expected a complete extraction, got ' + r.kind);
  return r.canonical;
};
const fails = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as IngestError;

const TE_COMPLAINT = 'మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.';
const TE_RESPONSE = 'సంబంధిత విభాగానికి సమస్యను పంపించాము.';

/** A minimal but structurally valid .docx (the same parts Word writes that matter to us). */
function docx(bodyXml: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>' + bodyXml + '</w:body></w:document>'),
    ...extra,
  });
}
const para = (t: string) => '<w:p><w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
const row = (...cells: string[]) => '<w:tr>' + cells.map((c) => '<w:tc>' + para(c) + '</w:tc>').join('') + '</w:tr>';

describe('TXT / Markdown', () => {
  it('imports a plain note as one grievance with explicit headings and Telugu intact', async () => {
    const c = complete(await ingestDocument({ name: 'CMH-1.txt', bytes: text(`Case ID: CMH-1\nCategory: Water supply\nDepartment: RWS\nDistrict: Test\nSubmitted: 2026-03-02\nStatus: Pending\n\nComplaint:\n${TE_COMPLAINT}\n\nResponse:\n${TE_RESPONSE}\n`) }));
    expect(c.records).toHaveLength(1);
    const r = c.records[0];
    expect(r).toMatchObject({ id: 'CMH-1', complaintText: TE_COMPLAINT, responseText: TE_RESPONSE, language: 'te', category: 'Water supply', department: 'RWS', district: 'Test', submittedAt: '2026-03-02', status: 'pending', originalFileName: 'CMH-1.txt', sourceType: 'note' });
    expect(c.provenance[0]).toMatchObject({ recordId: 'CMH-1', format: 'txt', method: 'direct', sourceFile: 'CMH-1.txt' });
    expect(c.provenance[0].sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('without headings keeps the whole text as the complaint and invents no response or status', async () => {
    const r = complete(await ingestDocument({ name: 'free-form.txt', bytes: text(TE_COMPLAINT) })).records[0];
    expect(r.complaintText).toBe(TE_COMPLAINT);
    expect(r.responseText).toBeNull();
    expect(r.status).toBe('unknown');
    expect(r.id).toBe('free-form');
  });
  it('derives a content-hash ID when the file name gives none', async () => {
    const a = complete(await ingestDocument({ name: '.txt', bytes: text('first complaint text here') })).records[0].id;
    const b = complete(await ingestDocument({ name: '.txt', bytes: text('second complaint text here') })).records[0].id;
    expect(a).toMatch(/^DOC-[0-9A-F]{12}$/);
    expect(a).not.toBe(b);
  });
  it('reads UTF-16 (BOM) text and a UTF-8 BOM', async () => {
    const u16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...('Complaint: ' + TE_COMPLAINT)].map((c) => c.charCodeAt(0))).buffer)]);
    expect(complete(await ingestDocument({ name: 'u16.txt', bytes: u16 })).records[0].complaintText).toBe(TE_COMPLAINT);
    expect(complete(await ingestDocument({ name: 'bom.txt', bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...text('Complaint: ' + TE_COMPLAINT)]) })).records[0].complaintText).toBe(TE_COMPLAINT);
  });
  it('markdown headings and bold labels are understood; complaint text stays verbatim', async () => {
    const md = `**Case ID:** MD-7\n**Category:** Roads\n\n## Complaint\n\nThe road has *large* potholes — see **below**.\n\n## Response\n\nInspection scheduled.\n`;
    const r = complete(await ingestDocument({ name: 'MD-7.md', bytes: text(md) })).records[0];
    expect(r).toMatchObject({ id: 'MD-7', category: 'Roads', responseText: 'Inspection scheduled.', sourceType: 'note' });
    expect(r.complaintText).toBe('The road has *large* potholes — see **below**.');
  });
  it('rejects binary content named .txt, invalid UTF-8, empty and oversized files', async () => {
    expect((await fails(ingestDocument({ name: 'a.txt', bytes: fx('encrypted.pdf') })))?.code).toBe('content_mismatch');
    expect((await fails(ingestDocument({ name: 'a.txt', bytes: new Uint8Array([0xc3, 0x28]) })))?.code).toBe('invalid_content');
    expect((await fails(ingestDocument({ name: 'a.txt', bytes: new Uint8Array([]) })))?.code).toBe('too_large');
    expect((await fails(ingestDocument({ name: 'a.txt', bytes: new Uint8Array(LIMITS.bytes.txt + 1).fill(97) })))?.code).toBe('too_large');
    expect((await fails(ingestDocument({ name: 'a.exe', bytes: text('x') })))?.code).toBe('unsupported');
  });
});

describe('DOCX', () => {
  it('extracts paragraphs, line breaks and tabs, in order', async () => {
    const c = complete(await ingestDocument({ name: 'g.docx', bytes: docx(para('Case ID: W-1') + para('Complaint:') + '<w:p><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t><w:tab/><w:t>tabbed</w:t></w:r></w:p>' + para('Response:') + para(TE_RESPONSE)) }));
    const r = c.records[0];
    expect(r).toMatchObject({ id: 'W-1', responseText: TE_RESPONSE, sourceType: 'document' });
    expect(r.complaintText).toBe('line one\nline two\ttabbed');
    expect(c.provenance[0].format).toBe('docx');
  });
  it('reads a two-column details table as header fields and decodes entities', async () => {
    const body = '<w:tbl>' + row('Case ID', 'W-2') + row('Category', 'Roads &amp; drainage') + row('Complaint', 'Pothole &lt;large&gt; &#x0C2E;') + '</w:tbl>';
    const r = complete(await ingestDocument({ name: 'table.docx', bytes: docx(body) })).records[0];
    expect(r.id).toBe('W-2');
    expect(r.category).toBe('Roads & drainage');
    expect(r.complaintText).toBe('Pothole <large> మ');
  });
  it('renders ordinary tables as "a | b" lines and ignores deleted tracked text and duplicate fallback content', async () => {
    const body = para('Complaint:') + '<w:tbl>' + row('Ward', '4') + row('Place', 'Market') + '</w:tbl>' + '<w:p><w:r><w:delText>DELETED</w:delText></w:r><w:r><w:t>kept</w:t></w:r></w:p><mc:AlternateContent><mc:Choice>' + para('once') + '</mc:Choice><mc:Fallback>' + para('once') + '</mc:Fallback></mc:AlternateContent>';
    const r = complete(await ingestDocument({ name: 't2.docx', bytes: docx(body) })).records[0];
    expect(r.complaintText).toBe('Ward | 4\nPlace | Market\nkept\nonce');
  });
  it('rejects: not a zip, wrong package, missing parts, corrupt zip', async () => {
    expect((await fails(ingestDocument({ name: 'x.docx', bytes: text('plain text') })))?.code).toBe('content_mismatch');
    expect((await fails(ingestDocument({ name: 'x.docx', bytes: zipSync({ 'hello.txt': strToU8('hi') }) })))?.code).toBe('content_mismatch');
    const good = docx(para('Complaint: ok enough text'));
    expect(await fails(ingestDocument({ name: 'x.docx', bytes: good.subarray(0, 30) }))).toBeInstanceOf(IngestError);
  });
  it('rejects a decompression bomb quickly, without inflating it', async () => {
    const bomb = docx(para('x'), { 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + '<w:p><w:r><w:t>aaaaaaaaaaaaaaaa</w:t></w:r></w:p>'.repeat(1_200_000) + '</w:body></w:document>') });
    expect(bomb.length).toBeLessThan(LIMITS.bytes.docx);
    const t0 = Date.now();
    const e = await fails(ingestDocument({ name: 'bomb.docx', bytes: bomb }));
    expect(e?.code).toBe('limit');
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('rejects too many entries and XML entity declarations', async () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < LIMITS.docx.entries + 5; i++) many['word/media/i' + i + '.bin'] = strToU8('x');
    expect((await fails(ingestDocument({ name: 'many.docx', bytes: docx(para('Complaint: enough text here'), many) })))?.code).toBe('limit');
    const xxe = docx('', { 'word/document.xml': strToU8('<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>') });
    expect((await fails(ingestDocument({ name: 'xxe.docx', bytes: xxe })))?.code).toBe('invalid_content');
  });
});

describe('CSV / JSON / JSONL', () => {
  const rows = [
    { id: 'R-1', complaintText: TE_COMPLAINT, responseText: TE_RESPONSE, language: 'te', category: 'Water supply', department: 'RWS', district: 'D', submittedAt: '2026-03-01', status: 'resolved' },
    { id: 'R-2', complaintText: 'Streetlight is out.', responseText: '', status: 'maybe-fixed' },
  ];
  const check = (c: ReturnType<typeof complete>) => {
    expect(c.records.map((r) => r.id)).toEqual(['R-1', 'R-2']);
    expect(c.records[0]).toMatchObject({ complaintText: TE_COMPLAINT, responseText: TE_RESPONSE, status: 'resolved', department: 'RWS' });
    expect(c.records[1]).toMatchObject({ responseText: null, status: 'unknown' }); // unrecognised status is never "resolved"
    expect(c.provenance).toHaveLength(2);
  };
  it('CSV (existing behaviour, quoted fields, aliases)', async () => {
    const csv = 'case_id,Complaint,response,status,language,dept\n"R-1","' + TE_COMPLAINT + '","' + TE_RESPONSE + '",resolved,te,RWS\nR-2,Streetlight is out.,,maybe-fixed,,\n';
    check(complete(await ingestDocument({ name: 'd.csv', bytes: text(csv) })));
  });
  it('JSON array and {records:[…]} (existing behaviour)', async () => {
    check(complete(await ingestDocument({ name: 'd.json', bytes: text(JSON.stringify(rows)) })));
    check(complete(await ingestDocument({ name: 'd.json', bytes: text(JSON.stringify({ records: rows })) })));
  });
  it('JSONL: one object per line, blank lines ignored, aliases accepted', async () => {
    check(complete(await ingestDocument({ name: 'd.jsonl', bytes: text(rows.map((r) => JSON.stringify(r)).join('\n\n') + '\n') })));
    const alias = complete(await ingestDocument({ name: 'a.jsonl', bytes: text('{"caseId":"A-1","complaint":"text here","reply":"done"}\n') }));
    expect(alias.records[0]).toMatchObject({ id: 'A-1', complaintText: 'text here', responseText: 'done' });
  });
  it('JSONL: names the bad line; rejects non-object lines and empty files', async () => {
    const e = await fails(ingestDocument({ name: 'bad.jsonl', bytes: text('{"id":"a","complaintText":"x y z"}\n{oops}\n') }));
    expect(e?.message).toBe('Line 2 is not valid JSON.');
    expect((await fails(ingestDocument({ name: 'bad.jsonl', bytes: text('[1,2]\n') })))?.message).toBe('Line 1 is not a JSON object.');
    expect((await fails(ingestDocument({ name: 'bad.jsonl', bytes: text('\n\n') })))?.code).toBe('invalid_content');
  });
  it('rejects duplicate IDs, missing complaint text and missing IDs in every tabular format', async () => {
    const dup = [{ id: 'X', complaintText: 'one one one' }, { id: 'X', complaintText: 'two two two' }];
    for (const [name, body] of [['d.json', JSON.stringify(dup)], ['d.jsonl', dup.map((r) => JSON.stringify(r)).join('\n')], ['d.csv', 'id,complaintText\nX,one one\nX,two two\n']] as const) {
      expect((await fails(ingestDocument({ name, bytes: text(body) })))?.code).toBe('invalid_content');
    }
    expect((await fails(ingestDocument({ name: 'd.json', bytes: text('[{"id":"Y"}]') })))?.code).toBe('invalid_content');
    expect((await fails(ingestDocument({ name: 'd.json', bytes: text('[{"complaintText":"no id"}]') })))?.code).toBe('invalid_content');
  });
  it('enforces the record cap and the per-record text bound (never truncating)', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ id: 'M' + i, complaintText: 'text ' + i }));
    expect((await fails(ingestDocument({ name: 'd.json', bytes: text(JSON.stringify(many)) })))?.message).toContain('200-record limit');
    const long = [{ id: 'L-1', complaintText: 'ఫ'.repeat(LIMITS.text.complaintChars + 1) }];
    const e = await fails(ingestDocument({ name: 'd.json', bytes: text(JSON.stringify(long)) }));
    expect(e?.code).toBe('limit');
    expect(e?.message).not.toContain('ఫ'); // error messages never echo document text
    const atLimit = [{ id: 'L-2', complaintText: 'ఫ'.repeat(LIMITS.text.complaintChars) }];
    expect(complete(await ingestDocument({ name: 'd.json', bytes: text(JSON.stringify(atLimit)) })).records[0].complaintText).toHaveLength(LIMITS.text.complaintChars);
  });
  it('rejects a PDF or ZIP renamed to .csv/.json/.jsonl', async () => {
    for (const name of ['a.csv', 'a.json', 'a.jsonl']) expect((await fails(ingestDocument({ name, bytes: fx('encrypted.pdf') })))?.code).toBe('content_mismatch');
  });
});

describe('PDF', () => {
  it('extracts a multi-page text PDF in page order, none dropped, with page provenance', async () => {
    const c = complete(await ingestDocument({ name: 'EN-PDF-003.pdf', bytes: fx('searchable-english-3page.pdf') }));
    const r = c.records[0];
    expect(r.id).toBe('EN-PDF-003');
    expect(r.category).toBe('Roads');
    expect(r.complaintText).toMatch(/^The main road near the market/);
    expect(r.complaintText).toContain('Second page: several two-wheeler riders');
    expect(r.complaintText).toContain('Third page: residents request repair');
    expect(r.complaintText.indexOf('Second page')).toBeLessThan(r.complaintText.indexOf('Third page'));
    expect(r.responseText).toBeNull();
    expect(r.sourceType).toBe('document');
    expect(c.provenance[0]).toMatchObject({ method: 'text-layer', format: 'pdf' });
    expect(c.provenance[0].pages?.map((p) => [p.page, p.method])).toEqual([[1, 'text-layer'], [2, 'text-layer'], [3, 'text-layer']]);
  });
  it('splits complaint (page 1) and response (page 2) of a Telugu text PDF without altering the Telugu', async () => {
    const r = complete(await ingestDocument({ name: 'TE-PDF-001.pdf', bytes: fx('searchable-telugu-2page.pdf') })).records[0];
    expect(r).toMatchObject({ id: 'TE-PDF-001', category: 'Water supply', department: 'Rural Water Supply', district: 'Test District', submittedAt: '2026-03-02', language: 'te' });
    expect(r.complaintText).toBe('మా వీధిలో నీటి సరఫరా లేదు\nరెండు రోజులుగా నీరు రావడం లేదు');
    expect(r.responseText).toBe('అధికారులకు విషయం తెలిపాము');
  });
  it('sends pages with an unmappable text layer to OCR instead of importing damaged Telugu', async () => {
    for (const f of ['damaged-conjunct-telugu-1page.pdf', 'chrome-damaged-telugu-2page.pdf']) {
      const r = await ingestDocument({ name: f, bytes: fx(f) });
      expect(r.kind).toBe('needs_ocr');
      expect(r.kind === 'needs_ocr' && r.ocrPages.length).toBeGreaterThan(0);
    }
  });
  it('treats an image-only (scanned) PDF as needing OCR on every page; never a blank or fabricated success', async () => {
    const r = await ingestDocument({ name: 's.pdf', bytes: fx('scanned-telugu-2page.pdf') });
    expect(r).toEqual({ kind: 'needs_ocr', pageCount: 2, ocrPages: [1, 2], textPages: [] });
  });
  it('merges OCR text with the text layer per page and records which method produced each page', async () => {
    const ocr = new Map([[1, { page: 1, text: 'Case ID: TE-SCAN-001\nComplaint:\n' + TE_COMPLAINT, confidence: 91.5 }], [2, { page: 2, text: 'Response:\n' + TE_RESPONSE, confidence: 88 }]]);
    const c = complete(await ingestDocument({ name: 'scan.pdf', bytes: fx('scanned-telugu-2page.pdf'), ocr }));
    expect(c.records[0]).toMatchObject({ id: 'TE-SCAN-001', complaintText: TE_COMPLAINT, responseText: TE_RESPONSE });
    expect(c.provenance[0]).toMatchObject({ method: 'ocr' });
    expect(c.provenance[0].pages).toEqual([{ page: 1, method: 'ocr', chars: expect.any(Number), confidence: 91.5 }, { page: 2, method: 'ocr', chars: expect.any(Number), confidence: 88 }]);
  });
  it('rejects encrypted, corrupt, truncated and non-PDF files with clear errors', async () => {
    expect((await fails(ingestDocument({ name: 'e.pdf', bytes: fx('encrypted.pdf') })))?.code).toBe('encrypted');
    expect((await fails(ingestDocument({ name: 'c.pdf', bytes: text('%PDF-1.4 this is not really a pdf at all') })))?.code).toBe('corrupt');
    expect((await fails(ingestDocument({ name: 'c.pdf', bytes: fx('searchable-english-3page.pdf').subarray(0, 400) })))?.code).toBe('corrupt');
    expect((await fails(ingestDocument({ name: 'c.pdf', bytes: text('just text, no signature') })))?.code).toBe('content_mismatch');
    expect((await fails(ingestDocument({ name: 'c.pdf', bytes: new Uint8Array(LIMITS.bytes.pdf + 1) })))?.code).toBe('too_large');
  });
});

describe('guarantees across formats', () => {
  it('never reports a verified outcome: only the source status is kept, unrecognised values become unknown', async () => {
    const r = complete(await ingestDocument({ name: 'v.txt', bytes: text('Complaint:\nsomething happened\nResponse:\nWe have looked into it and fixed it.') })).records[0];
    expect(r.responseText).toBe('We have looked into it and fixed it.');
    expect(r.status).toBe('unknown');
  });
});
