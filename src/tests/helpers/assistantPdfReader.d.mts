// Narrow declaration for the JS test-only reader. The frontend TS project
// does not traverse Node worker or backend ingestion implementation files.
type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = { getTextContent(): Promise<{ items: PdfTextItem[] }> };
type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfReader = {
  getDocument(options: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; verbosity?: number }): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
};
export function loadNodePdfJs(): Promise<PdfReader>;
