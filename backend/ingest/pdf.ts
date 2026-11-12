import { IngestError, LIMITS } from './limits';

/**
 * Searchable-PDF text extraction (embedded text layer only; OCR is a separate stage, see ocr.ts).
 *
 * Every page is classified, never skipped:
 *   - "text"    the page has a usable embedded text layer;
 *   - "empty"   no text at all (a scan or image-only page)           → needs OCR;
 *   - "damaged" at least one glyph could not be mapped to Unicode (typical for Telugu conjuncts in some producers:
 *               NUL / private-use / replacement characters) → needs OCR.
 * A damaged text layer is never imported as if it were correct. Note that a page without unmappable glyphs can still have
 * imperfect spacing from the producer; that cannot be detected, so PDF provenance records the text-layer method.
 */

type TextItem = { str?: string; hasEOL?: boolean };
type PdfPage = { getTextContent(): Promise<{ items: TextItem[] }>; cleanup?(): void };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
type LoadingTask = { promise: Promise<PdfDoc>; destroy?(): Promise<void> | void };
export type PdfJs = { getDocument(src: Record<string, unknown>): LoadingTask };

/** Glyphs with no Unicode mapping come out as NUL, private-use or replacement characters. */
const UNDECODABLE = /[\u0000-�]/g;
/** Pages whose visible text is shorter than this count as "empty" (page numbers, stray marks). */
const MIN_VISIBLE_CHARS = 12;

export type PageKind = 'text' | 'empty' | 'damaged';
export type PdfPageText = { page: number; kind: PageKind; text: string; undecodable: number };
export type PdfExtraction = { pages: PdfPageText[]; pageCount: number };

let cached: Promise<PdfJs> | null = null;
/** pdf.js legacy build with its worker registered in-process (Lambda has no worker threads to spawn). */
export function loadNodePdfJs(): Promise<PdfJs> {
  cached ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  })();
  return cached;
}

export async function extractPdfPages(bytes: Uint8Array, pdfjs?: PdfJs): Promise<PdfExtraction> {
  if (bytes.length < 8 || new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).indexOf('%PDF-') === -1) {
    throw new IngestError('This file is not a PDF (the PDF signature is missing).', 'content_mismatch');
  }
  const lib = pdfjs ?? (await loadNodePdfJs());
  let task: LoadingTask | null = null;
  let doc: PdfDoc;
  try {
    // Copy: pdf.js takes ownership of (detaches) the buffer it is given.
    task = lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0, stopAtErrors: true });
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new IngestError('The PDF is password-protected. Remove the password and upload it again.', 'encrypted');
    throw new IngestError('The PDF is corrupt or unreadable.', 'corrupt');
  }
  try {
    if (doc.numPages < 1) throw new IngestError('The PDF has no pages.', 'corrupt');
    if (doc.numPages > LIMITS.pdf.pages) {
      throw new IngestError('The PDF has ' + doc.numPages + ' pages; the limit is ' + LIMITS.pdf.pages + ' per file. Split it and upload the parts.', 'limit');
    }
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      let content: { items: TextItem[] };
      const page = await doc.getPage(n).catch(() => {
        throw new IngestError('Page ' + n + ' of the PDF could not be read.', 'corrupt');
      });
      try {
        content = await page.getTextContent();
      } catch {
        throw new IngestError('Page ' + n + ' of the PDF could not be read.', 'corrupt');
      }
      const raw = content.items.map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join('').normalize('NFC');
      const bad = (raw.match(UNDECODABLE) ?? []).length;
      const text = raw.replace(UNDECODABLE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const visible = text.replace(/\s+/g, '').length;
      let kind: PageKind = 'text';
      if (visible < MIN_VISIBLE_CHARS && bad === 0) kind = 'empty';
      // Strict on purpose: one unmappable glyph is one lost letter (e.g. a Telugu conjunct), and the rest of the
      // page still looks plausible, so no share of damage is small enough to import silently.
      else if (bad > 0) kind = 'damaged';
      pages.push({ page: n, kind, text: kind === 'text' ? text : '', undecodable: bad });
      page.cleanup?.();
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task?.destroy?.();
  }
}
