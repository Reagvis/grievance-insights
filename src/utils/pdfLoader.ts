import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfJsLike } from './pdfText';

let cached: Promise<PdfJsLike> | null = null;

/** Loads pdf.js on first use only, so it adds nothing to the initial page load. Runs fully in the browser. */
export function loadPdfJs(): Promise<PdfJsLike> {
  cached ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs as unknown as PdfJsLike;
  });
  return cached;
}
