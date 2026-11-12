/**
 * Supported input formats and the hard limits applied to untrusted uploads.
 * Limits are deliberately conservative and documented in docs/TASK_21_INGESTION.md.
 */
export const SOURCE_FORMATS = ['txt', 'md', 'docx', 'csv', 'json', 'jsonl', 'pdf'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const CONTENT_TYPE: Record<SourceFormat, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  pdf: 'application/pdf',
};

const MiB = 1024 * 1024;

export const LIMITS = {
  /** Maximum upload size per format (bytes). CSV/JSON keep the existing pilot limit. */
  bytes: { txt: 1 * MiB, md: 1 * MiB, csv: 20 * MiB, json: 20 * MiB, jsonl: 20 * MiB, docx: 5 * MiB, pdf: 10 * MiB } as Record<SourceFormat, number>,
  /** Records per dataset (Task 19). Document formats always yield exactly one. */
  records: 2000,
  docx: {
    /** Entries in the archive (a real grievance .docx has roughly 10–30). */
    entries: 200,
    /** Only word/document.xml is ever inflated; this caps its decompressed size, whatever the archive header claims. */
    documentXmlBytes: 8 * MiB,
    /** Decompressed:compressed ratio above which the archive is treated as a decompression bomb. */
    maxRatio: 150,
  },
  pdf: {
    /** Pages processed per PDF. Documents above this are rejected, never truncated. */
    pages: 50,
    /** Pages OCR will process in one document (cost bound). */
    ocrPages: 20,
  },
} as const;

export const EXTENSION_FORMAT: Record<string, SourceFormat> = Object.fromEntries(SOURCE_FORMATS.map((f) => ['.' + f, f]));

export function formatFromName(name: string): SourceFormat | null {
  const m = /(\.[A-Za-z0-9]+)$/.exec(name);
  return m ? (EXTENSION_FORMAT[m[1].toLowerCase()] ?? null) : null;
}
