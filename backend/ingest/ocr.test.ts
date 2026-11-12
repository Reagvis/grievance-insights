import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { IngestError, LIMITS } from './index';
import { createTesseractEngine, encodeGrayPng, ingestWithOcr, MIN_PAGE_CONFIDENCE, ocrPdfPages, pageImagePng, type OcrEngine } from './ocr';
import { loadNodePdfJs } from './pdf';

const fx = (n: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + n, import.meta.url)));
const tessdata = fileURLToPath(new URL('./tessdata', import.meta.url));
const fails = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as IngestError;
const fake = (text: string, confidence: number): OcrEngine => ({ recognize: vi.fn(async () => ({ text, confidence })), terminate: vi.fn(async () => {}) });

const TE_COMPLAINT = 'మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు. ప్రభుత్వ అధికారులు వెంటనే చర్యలు తీసుకోవాలి.';
const TE_RESPONSE = 'సంబంధిత విభాగానికి సమస్యను పంపించాము. పరిశీలన కొనసాగుతోంది.';

describe('page image extraction', () => {
  it('takes the single full-page image of a scanned page and encodes a valid PNG', async () => {
    const png = await pageImagePng(await loadNodePdfJs(), fx('scanned-telugu-2page.pdf'), 1);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBeGreaterThan(1000); // width
  });
  it('refuses a page that has no raster image rather than rendering nothing', async () => {
    const e = await fails(pageImagePng(await loadNodePdfJs(), fx('searchable-english-3page.pdf'), 1));
    expect(e).toBeInstanceOf(IngestError);
    expect(e.code).toBe('ocr_failed');
  });
  it('encodes grayscale PNGs deterministically', () => {
    const png = encodeGrayPng(2, 2, new Uint8Array([0, 255, 255, 0]));
    expect(png.length).toBeGreaterThan(40);
    expect(encodeGrayPng(2, 2, new Uint8Array([0, 255, 255, 0]))).toEqual(png);
  });
});

describe('OCR gating (mock engine, no Tesseract)', () => {
  it('rejects the whole document, naming the pages, when confidence is too low', async () => {
    const e = await fails(ocrPdfPages(fx('scanned-telugu-2page.pdf'), [1, 2], fake('గిజిబిజి', MIN_PAGE_CONFIDENCE - 1)));
    expect(e.code).toBe('ocr_failed');
    expect(e.message).toContain('1, 2');
  });
  it('rejects empty OCR output and engine failures; never fabricates text', async () => {
    expect((await fails(ocrPdfPages(fx('scanned-telugu-2page.pdf'), [1], fake('   ', 99))))?.code).toBe('ocr_failed');
    const broken: OcrEngine = { recognize: async () => { throw new Error('boom'); }, terminate: async () => {} };
    expect((await fails(ocrPdfPages(fx('scanned-telugu-2page.pdf'), [1], broken)))?.code).toBe('ocr_failed');
  });
  it('enforces the per-document OCR page cap before doing any work', async () => {
    const engine = fake('x', 99);
    const e = await fails(ocrPdfPages(fx('scanned-telugu-2page.pdf'), Array.from({ length: LIMITS.pdf.ocrPages + 1 }, (_, i) => i + 1), engine));
    expect(e.code).toBe('limit');
    expect(engine.recognize).not.toHaveBeenCalled();
  });
  it('terminates the engine even when OCR fails', async () => {
    const engine = fake('x', 1);
    await fails(ingestWithOcr({ name: 's.pdf', bytes: fx('scanned-telugu-2page.pdf'), engine: async () => engine }));
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });
  it('does not start OCR at all for a searchable PDF', async () => {
    const factory = vi.fn(async () => fake('x', 99));
    const r = await ingestWithOcr({ name: 'a.pdf', bytes: fx('searchable-english-3page.pdf'), engine: factory });
    expect(r.kind).toBe('complete');
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('real Tesseract (Telugu + English) on the scanned fixture', () => {
  it('turns a scanned Telugu PDF into the exact canonical record, with per-page OCR provenance', { timeout: 120_000 }, async () => {
    const r = await ingestWithOcr({ name: 'TE-SCAN-001.pdf', bytes: fx('scanned-telugu-2page.pdf'), engine: () => createTesseractEngine(tessdata) });
    expect(r.kind).toBe('complete');
    if (r.kind !== 'complete') return;
    const rec = r.canonical.records[0];
    expect(rec).toMatchObject({ id: 'TE-SCAN-001', category: 'Water supply', language: 'te', responseText: TE_RESPONSE, status: 'unknown', sourceType: 'document' });
    // OCR keeps the page's visual line breaks, so compare the text modulo whitespace.
    expect(rec.complaintText.replace(/\s+/g, ' ')).toBe(TE_COMPLAINT);
    const prov = r.canonical.provenance[0];
    expect(prov.method).toBe('ocr');
    expect(prov.pages).toHaveLength(2);
    for (const p of prov.pages!) {
      expect(p.method).toBe('ocr');
      expect(p.confidence).toBeGreaterThan(80);
    }
    // The original bytes are only hashed, never altered.
    expect(prov.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
