/**
 * PDF text extraction (text layer only — there is no OCR).
 * The pdf.js module is injected so the same code runs in the browser (see pdfLoader.ts) and in tests.
 */

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = { getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup?(): void };
type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy?(): Promise<void> | void };
export type PdfJsLike = {
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean }): { promise: Promise<PdfDocument>; destroy?(): Promise<void> | void };
};

export class PdfReadError extends Error {
  readonly reason: 'password' | 'invalid' | 'no-text' | 'undecodable';
  constructor(reason: PdfReadError['reason'], message: string) {
    super(message);
    this.name = 'PdfReadError';
    this.reason = reason;
  }
}

export const MAX_PDF_PAGES = 200;

/**
 * What text extraction yields for glyphs that have no Unicode mapping: NUL (U+0000), private-use or replacement characters.
 * Telugu conjunct letters (e.g. the "pra" in ప్రభుత్వ) are the usual victims, so missing letters would otherwise go unnoticed.
 */
const UNDECODABLE = /[\u0000-�]/g;
/** Above this share of undecodable characters the text is too damaged to import. */
export const MAX_UNDECODABLE_SHARE = 0.02;

export async function extractPdfText(pdfjs: PdfJsLike, data: ArrayBuffer): Promise<{ text: string; pages: number; undecodable: number }> {
  let loading: ReturnType<PdfJsLike['getDocument']> | null = null;
  let doc: PdfDocument | null = null;
  try {
    // Copy: pdf.js transfers (detaches) the buffer it is given.
    loading = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
    doc = await loading.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new PdfReadError('password', 'The PDF is password-protected.');
    throw new PdfReadError('invalid', 'This is not a readable PDF file.');
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfReadError('invalid', 'The PDF has ' + doc.numPages + ' pages; the limit is ' + MAX_PDF_PAGES + ' per file.');
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join(''));
      page.cleanup?.();
    }
    const rawText = pages.join('\n\n').normalize('NFC');
    const bad = (rawText.match(UNDECODABLE) ?? []).length;
    const text = rawText.replace(UNDECODABLE, '');
    const visible = text.replace(/\s+/g, '');
    if (visible.length < 10 && bad === 0) {
      throw new PdfReadError('no-text', 'The PDF has no selectable text (it looks like a scan or an image). Text from scanned pages needs OCR, which is not available yet.');
    }
    if (bad / (visible.length + bad) > MAX_UNDECODABLE_SHARE) {
      throw new PdfReadError(
        'undecodable',
        'About ' +
          Math.round((bad / (visible.length + bad)) * 100) +
          '% of the letters in this PDF could not be decoded (common with Telugu conjunct letters), so importing it would silently corrupt the text. Use a TXT export of the note instead, or wait for OCR support.',
      );
    }
    return { text, pages: doc.numPages, undecodable: bad };
  } finally {
    // Releases the document and its worker resources (the loading task owns both).
    await (loading.destroy ? loading.destroy() : doc.destroy?.());
  }
}
