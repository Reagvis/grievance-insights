// Node-only test reader. Register the legacy fake worker just as PDF.js
// expects in Node; never import the backend ingestion implementation here.
let cached;
export function loadNodePdfJs() {
  cached ??= (async () => {
    globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return cached;
}
