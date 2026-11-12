import { describe, expect, it } from 'vitest';
import { createSampleDataset } from '../data/demoGrievances';
import { buildNoteText } from '../utils/downloads';
import { cleanText, idFromFileName, parseDocumentText, parseNoteDate } from '../utils/documentImport';
import { decodeTextFile, ImportError, readImportFiles } from '../utils/importer';
import { extractPdfText, PdfReadError, type PdfJsLike } from '../utils/pdfText';

const records = createSampleDataset().records;
const file = (name: string, content: string | Uint8Array, type = '') => new File([content as BlobPart], name, { type });

/** Smallest valid-enough PDF with real, selectable Helvetica text (pdf.js rebuilds the xref table itself). */
function tinyPdf(lines: string[]): Uint8Array {
  const stream = 'BT /F1 12 Tf 14 TL 50 740 Td ' + lines.map((l) => '(' + l.replace(/[()\\]/g, '\\$&') + ') Tj T*').join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += i + 1 + ' 0 obj\n' + o + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return new TextEncoder().encode(out);
}

describe('text notes', () => {
  it('imports a note exported by this app back exactly, complaint and response separate', () => {
    const original = records.find((r) => r.responseText && r.status === 'in_progress' && r.submittedAt && r.respondedAt && r.category)!;
    const parsed = parseDocumentText('whatever.txt', buildNoteText(original, 'Sample dataset'), 'txt');
    const r = parsed.record!;
    expect(parsed.layout).toBe('app-note');
    expect(r.id).toBe(original.id);
    expect(r.complaintText).toBe(cleanText(original.complaintText));
    expect(r.responseText).toBe(cleanText(original.responseText!));
    expect(r.category).toBe(original.category);
    expect(r.department).toBe(original.department);
    expect(r.status).toBe(original.status);
    expect(r.submittedAt).toBe(original.submittedAt);
    expect(r.respondedAt).toBe(original.respondedAt);
    expect(r.isSyntheticDemo).toBe(true);
    expect(r.sourceType).toBe('note');
  });

  it('keeps a missing response missing and never invents a status', () => {
    const noResp = records.find((r) => !r.responseText)!;
    const r = parseDocumentText('x.txt', buildNoteText(noResp, 'S'), 'txt').record!;
    expect(r.responseText).toBeNull();
    const plain = parseDocumentText('GRV-9-note.txt', 'నా ఫిర్యాదు ఇది.', 'txt').record!;
    expect(plain.status).toBe('unknown');
  });

  it('splits on explicit English and Telugu headings, and only then', () => {
    const en = parseDocumentText('a.txt', 'Case ID: A-1\nCategory: Roads\n\nComplaint: Potholes on the main road.\nPlease repair.\n\nResponse: Sent to the engineer.', 'txt');
    expect(en.layout).toBe('headings');
    expect(en.record).toMatchObject({ id: 'A-1', category: 'Roads', complaintText: 'Potholes on the main road.\nPlease repair.', responseText: 'Sent to the engineer.' });
    const te = parseDocumentText('b.txt', 'ఫిర్యాదు: మా వీధిలో నీరు రావడం లేదు.\nస్పందన: సంబంధిత విభాగానికి పంపించాము.', 'txt');
    expect(te.record?.complaintText).toBe('మా వీధిలో నీరు రావడం లేదు.');
    expect(te.record?.responseText).toBe('సంబంధిత విభాగానికి పంపించాము.');
    expect(te.record?.language).toBe('te');
    // A sentence that merely starts with the word "Response" is not a heading.
    const none = parseDocumentText('c.txt', 'Response was slow and nobody called back.', 'txt');
    expect(none.layout).toBe('whole-text');
    expect(none.record?.responseText).toBeNull();
  });

  it('takes the ID from the file name, drops "-note", and reports empty files', () => {
    expect(idFromFileName('folder/GRV-000128-note.txt')).toBe('GRV-000128');
    expect(idFromFileName('నా ఫిర్యాదు 5.pdf')).toBe('నా_ఫిర్యాదు_5');
    expect(parseDocumentText('e.txt', '   \n  ', 'txt').record).toBeNull();
  });

  it('parses dates written by the export', () => {
    expect(parseNoteDate('4 Jul 2026')).toBe('2026-07-04');
    expect(parseNoteDate('22 Sept 2026')).toBe('2026-09-22');
    expect(parseNoteDate('31 Feb 2026')).toBeNull();
    expect(parseNoteDate('soon')).toBeNull();
  });

  it('decodes UTF-8 and BOM-marked UTF-16 Telugu, and rejects other encodings', () => {
    const telugu = 'తాగునీటి సరఫరా';
    expect(decodeTextFile(new TextEncoder().encode(telugu).buffer as ArrayBuffer)).toBe(telugu);
    const u16 = new Uint8Array(2 + telugu.length * 2);
    u16.set([0xff, 0xfe]);
    for (let i = 0; i < telugu.length; i++) {
      const c = telugu.charCodeAt(i);
      u16[2 + i * 2] = c & 0xff;
      u16[3 + i * 2] = c >> 8;
    }
    expect(decodeTextFile(u16.buffer)).toBe(telugu);
    expect(() => decodeTextFile(new Uint8Array([0x80, 0x81, 0x82]).buffer as ArrayBuffer)).toThrow(ImportError);
  });
});

describe('batch import of TXT / PDF files', () => {
  it('turns many files into records, sorted by name, with duplicates and bad files reported', async () => {
    const files = [
      file('GRV-2-note.txt', 'Complaint: రెండవ ఫిర్యాదు\nResponse: స్పందన ఉంది'),
      file('GRV-1-note.txt', 'మొదటి ఫిర్యాదు, శీర్షిక లేదు'),
      file('GRV-10-note.txt', 'పదవ ఫిర్యాదు'),
      file('GRV-1.txt', 'Another file that maps to the same ID GRV-1'),
      file('empty.txt', ''),
      file('bad.txt', new Uint8Array([0xc3, 0x28, 0xa0])),
      file('photo.png', new Uint8Array([1, 2, 3])),
    ];
    const r = await readImportFiles(files);
    expect(r.format).toBe('documents');
    expect(r.records.map((x) => x.id)).toEqual(['GRV-1', 'GRV-2', 'GRV-10']); // natural order, not text order
    expect(r.records[1].responseText).toBe('స్పందన ఉంది');
    expect(r.duplicates).toHaveLength(1);
    expect(r.rejectedRows.map((x) => x.reason).join('|')).toMatch(/empty\.txt.*empty/);
    expect(r.rejectedRows.map((x) => x.reason).join('|')).toMatch(/bad\.txt.*UTF-8/);
    expect(r.documents).toMatchObject({ txt: 6, pdf: 0, ignored: 1, split: 1, wholeText: 2 });
    expect(r.issues.some((i) => /no "Complaint:" \/ "Response:" headings/.test(i.message))).toBe(true);
  });

  it('refuses to mix structured and document files', async () => {
    await expect(readImportFiles([file('a.csv', 'id,complaintText\n1,x'), file('b.txt', 'x')])).rejects.toThrow(/not a mix/);
    await expect(readImportFiles([file('a.csv', 'id,complaintText\n1,x'), file('b.json', '[]')])).rejects.toThrow(/one CSV or JSON/);
    await expect(readImportFiles([file('a.docx', 'x')])).rejects.toThrow(/Unsupported/);
  });

  it('still imports a single CSV exactly as before', async () => {
    const r = await readImportFiles([file('x.csv', 'id,complaintText,status\nA-1,తాగునీరు,resolved\n')]);
    expect(r.format).toBe('csv');
    expect(r.records[0]).toMatchObject({ id: 'A-1', status: 'resolved' });
  });

  it('handles 2,000 notes quickly and keeps every one', async () => {
    const files = Array.from({ length: 2000 }, (_, i) => file('GRV-' + String(i + 1).padStart(6, '0') + '-note.txt', buildNoteText(records[i % records.length], 'S')));
    const progress: number[] = [];
    const t0 = performance.now();
    const r = await readImportFiles(files, { onProgress: (d) => progress.push(d) });
    // The notes carry their own Case IDs (30 distinct), so only 30 survive; every file is accounted for.
    expect(r.records.length + r.duplicates.reduce((a, d) => a + d.skippedRows.length, 0)).toBe(2000);
    expect(progress.at(-1)).toBe(2000);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });

  it('cancels cleanly', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(readImportFiles([file('a.txt', 'x')], { signal: ac.signal })).rejects.toThrow();
  });
});

describe('PDF text', () => {
  it('reads selectable text from a real PDF through pdf.js', async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;
    const bytes = tinyPdf(['Complaint: Street light is broken.', 'Response: Work order issued.']);
    const { text, pages } = await extractPdfText(pdfjs, bytes.buffer as ArrayBuffer);
    expect(pages).toBe(1);
    expect(text).toContain('Street light is broken.');
    const r = await readImportFiles([file('GRV-77.pdf', bytes, 'application/pdf')], { loadPdf: async () => pdfjs });
    expect(r.records[0]).toMatchObject({ id: 'GRV-77', complaintText: 'Street light is broken.', responseText: 'Work order issued.', sourceType: 'document' });
    expect(r.documents?.pdf).toBe(1);
    expect(r.issues.some((i) => /text layer/.test(i.message))).toBe(true);
  });

  it('explains a PDF with no text layer (scan) instead of importing nothing silently', async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;
    const r = await readImportFiles([file('scan.pdf', tinyPdf([' ']), 'application/pdf')], { loadPdf: async () => pdfjs });
    expect(r.records).toHaveLength(0);
    expect(r.rejectedRows[0].reason).toMatch(/scan.*OCR/i);
  });

  it('rejects garbage that is not a PDF, and text that cannot be decoded', async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;
    const bad = await readImportFiles([file('x.pdf', 'not a pdf at all', 'application/pdf')], { loadPdf: async () => pdfjs });
    expect(bad.rejectedRows[0].reason).toMatch(/not a readable PDF/);

    const fake = (str: string): PdfJsLike => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [{ str }] }) }),
          destroy: () => undefined,
        }),
      }),
    });
    await expect(extractPdfText(fake('  a'), new ArrayBuffer(4))).rejects.toMatchObject({ reason: 'undecodable' });
    // pdf.js yields NUL for glyphs without a Unicode mapping (what Telugu conjuncts hit): that is data loss, never silent.
    await expect(extractPdfText(fake(' ప భు త  ఆసుప లో రా  వేళలో'), new ArrayBuffer(4))).rejects.toMatchObject({ reason: 'undecodable' });
    const mild = 'మా గ్రామంలో నీరు రావడం లేదు, దయచేసి వెంటనే చర్యలు తీసుకోండి. ' .repeat(8) + ' ';
    const lossy = await extractPdfText(fake(mild), new ArrayBuffer(4));
    expect(lossy.undecodable).toBe(1);
    expect(lossy.text).not.toContain(' ');
    const batch = await readImportFiles([file('lossy.pdf', 'x', 'application/pdf')], { loadPdf: async () => fake(mild) });
    expect(batch.records).toHaveLength(1);
    expect(batch.issues.some((i) => /could not be decoded and were dropped/.test(i.message))).toBe(true);
    const ok = await extractPdfText(fake('మా గ్రామంలో నీరు లేదు'), new ArrayBuffer(4));
    expect(ok.text).toBe('మా గ్రామంలో నీరు లేదు');
    await expect(extractPdfText(fake('x'), new ArrayBuffer(4))).rejects.toBeInstanceOf(PdfReadError);
  });
});
