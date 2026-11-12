import { zlibSync } from 'fflate';
import { IngestError, LIMITS } from './limits';
import { loadNodePdfJs, type PdfJs } from './pdf';
import type { OcrPage } from './index';

/**
 * OCR for scanned / damaged PDF pages. This stage is independent of the AI analysis: its output is plain text that
 * then goes through the same validation and bounds as any other text. No image is ever sent to the analysis model
 * (Qwen3-32B is text-only).
 *
 * Rasterisation without native code: a scanned page is almost always one full-page raster image, so that embedded
 * image is taken straight from the PDF (pdf.js decodes JPEG/JPX/CCITT/Flate for us) and handed to Tesseract.
 * Pages that are not simply one image (several images, image masks, vector drawing) are refused explicitly
 * rather than approximated.
 */

/** Pages below this mean Tesseract confidence (0–100) are rejected instead of imported as unreliable text. */
export const MIN_PAGE_CONFIDENCE = 50;
/** Smaller images are not a full-page scan (logos, stamps). */
const MIN_SIDE_PX = 600;
/** Pixel budget per page: bounds memory (a 600-DPI A4 page is about 35 million pixels). */
const MAX_PIXELS = 40_000_000;

export interface OcrEngine {
  recognize(png: Uint8Array): Promise<{ text: string; confidence: number }>;
  terminate(): Promise<void>;
}

/** Tesseract (WASM) with Telugu + English. English is required: Telugu-only models garble Latin labels such as "Case ID". */
export async function createTesseractEngine(langPath: string): Promise<OcrEngine> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('tel+eng', OEM.DEFAULT, { langPath, gzip: false, cachePath: '/tmp/tesseract-cache', logger: () => {} });
  return {
    async recognize(png) {
      const r = await worker.recognize(Buffer.from(png));
      return { text: r.data.text, confidence: r.data.confidence };
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

// ---- minimal PNG (8-bit grayscale) encoder -------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(t, data));
  return out;
}
export function encodeGrayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1); // filter byte 0 per row
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit, grayscale
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type PdfImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };
function toGray(img: PdfImage): Uint8Array {
  const { width: w, height: h, data } = img;
  const gray = new Uint8Array(w * h);
  if (img.kind === 1) {
    // 1 bit per pixel, rows padded to whole bytes; 1 = white.
    const stride = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  } else {
    const bpp = img.kind === 3 ? 4 : 3; // RGBA or RGB
    if (data.length < w * h * bpp) throw new IngestError('A scanned page uses an unsupported image format.', 'ocr_failed');
    for (let i = 0, j = 0; i < w * h; i++, j += bpp) gray[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
  }
  return gray;
}

/** The single full-page raster image of a page, as PNG bytes. */
export async function pageImagePng(lib: PdfJs, pdfBytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const fail = (why: string) => new IngestError('Page ' + pageNumber + ' cannot be read by OCR: ' + why, 'ocr_failed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = lib as any;
  const task = any.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0, stopAtErrors: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const ops = await page.getOperatorList();
    const OPS = any.OPS;
    const images: PdfImage[] = [];
    let masks = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageMaskXObjectGroup || fn === OPS.paintSolidColorImageMask) masks++;
      else if (fn === OPS.paintInlineImageXObject) images.push(ops.argsArray[i][0]);
      else if (fn === OPS.paintImageXObject) images.push(await new Promise<PdfImage>((resolve) => page.objs.get(ops.argsArray[i][0], resolve)));
    }
    const big = images.filter((im) => im && im.width >= MIN_SIDE_PX && im.height >= MIN_SIDE_PX);
    if (big.length !== 1 || masks > 0) throw fail('it is not a single full-page scan (' + big.length + ' large images, ' + masks + ' image masks).');
    const img = big[0];
    if (img.width * img.height > MAX_PIXELS) throw fail('the scan resolution is too high (limit ' + MAX_PIXELS / 1e6 + ' megapixels).');
    return encodeGrayPng(img.width, img.height, toGray(img));
  } catch (e) {
    if (e instanceof IngestError) throw e;
    throw fail('the page image could not be decoded.');
  } finally {
    await task.destroy?.();
  }
}

/**
 * OCR the given pages. All-or-nothing: if any requested page fails (unsupported layout, unreadable, low confidence)
 * the whole document is rejected naming the pages, so a partial extraction is never presented as complete.
 */
export async function ocrPdfPages(pdfBytes: Uint8Array, pages: number[], engine: OcrEngine, pdfjs?: PdfJs): Promise<Map<number, OcrPage>> {
  if (pages.length > LIMITS.pdf.ocrPages) {
    throw new IngestError('OCR is limited to ' + LIMITS.pdf.ocrPages + ' pages per document; this PDF needs ' + pages.length + '. Split it and upload the parts.', 'limit');
  }
  const lib = pdfjs ?? (await loadNodePdfJs());
  const out = new Map<number, OcrPage>();
  const low: number[] = [];
  for (const page of pages) {
    const png = await pageImagePng(lib, pdfBytes, page);
    let result: { text: string; confidence: number };
    try {
      result = await engine.recognize(png);
    } catch {
      throw new IngestError('OCR failed on page ' + page + '.', 'ocr_failed');
    }
    const text = result.text.normalize('NFC').trim();
    if (!text || result.confidence < MIN_PAGE_CONFIDENCE) {
      low.push(page);
      continue;
    }
    out.set(page, { page, text, confidence: Math.round(result.confidence * 10) / 10 });
  }
  if (low.length) throw new IngestError('OCR could not read page(s) ' + low.join(', ') + ' reliably (low confidence or no text). The document was not imported.', 'ocr_failed');
  return out;
}

import { ingestDocument, type IngestResult } from './index';

/**
 * Full pipeline for one file: direct extraction first; only the PDF pages that need it go through OCR; the merged
 * text then passes through the same normalisation and bounds as everything else.
 */
export async function ingestWithOcr(input: { name: string; bytes: Uint8Array; engine: () => Promise<OcrEngine>; pdfjs?: PdfJs }): Promise<IngestResult> {
  const first = await ingestDocument({ name: input.name, bytes: input.bytes, pdfjs: input.pdfjs });
  if (first.kind === 'complete') return first;
  const engine = await input.engine();
  try {
    const ocr = await ocrPdfPages(input.bytes, first.ocrPages, engine, input.pdfjs);
    return await ingestDocument({ name: input.name, bytes: input.bytes, ocr, pdfjs: input.pdfjs });
  } finally {
    await engine.terminate();
  }
}
