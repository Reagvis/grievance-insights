import { createHash } from 'node:crypto';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { cleanText, isKnownLabel, parseDocumentText, type DocumentKind } from '../../src/utils/documentImport';
import { parseCsvImport, parseJsonImport, type ImportResult } from '../../src/utils/importer';
import { extractDocxText } from './docx';
import { formatFromName, IngestError, LIMITS, type SourceFormat } from './limits';
import { extractPdfPages, type PdfJs } from './pdf';
import { validateRecordBounds } from '../datasets/bounds';

export { SOURCE_FORMATS, CONTENT_TYPE, LIMITS, IngestError, formatFromName, type SourceFormat } from './limits';

export const EXTRACTOR_VERSION = 'ingest-1';

export type PageProvenance = { page: number; method: 'text-layer' | 'ocr'; chars: number; confidence?: number };
export type Provenance = {
  recordId: string;
  sourceFile: string;
  format: SourceFormat;
  /** SHA-256 of the original uploaded bytes (the private original is never modified). */
  sourceSha256: string;
  method: 'direct' | 'text-layer' | 'ocr' | 'mixed';
  pages?: PageProvenance[];
  extractor: string;
};
export type CanonicalDataset = {
  schemaVersion: 1;
  format: SourceFormat;
  sourceFile: string;
  sourceSha256: string;
  extractedAt: string;
  records: GrievanceRecord[];
  provenance: Provenance[];
  /** Human-readable, text-free notes about the extraction (e.g. how the document was divided). */
  notes: string[];
};
export type OcrPage = { page: number; text: string; confidence: number };
export type IngestResult =
  | { kind: 'complete'; canonical: Omit<CanonicalDataset, 'extractedAt'> }
  | { kind: 'needs_ocr'; pageCount: number; ocrPages: number[]; textPages: number[] };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** TXT/MD/CSV/JSON/JSONL: strict UTF-8 (BOM allowed) or UTF-16 with a BOM. Binary content is refused. */
export function decodeText(bytes: Uint8Array): string {
  const looksBinary = (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4);
  if (looksBinary) throw new IngestError('The file content is a PDF or ZIP archive, not the text format its name claims.', 'content_mismatch');
  let text: string;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new IngestError('The file is not valid UTF-8 text. Re-save it as UTF-8 and upload it again.', 'invalid_content');
  }
  if (text.includes('\u0000')) throw new IngestError('The file contains binary data and is not a text file.', 'content_mismatch');
  return text;
}

/** JSON Lines: one JSON object per line; blank lines are ignored. Any malformed line rejects the file, naming the line. */
export function parseJsonl(fileName: string, text: string): ImportResult {
  const objects: unknown[] = [];
  const lineOf: number[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new IngestError('Line ' + (i + 1) + ' is not valid JSON.', 'invalid_content');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestError('Line ' + (i + 1) + ' is not a JSON object.', 'invalid_content');
    objects.push(value);
    lineOf.push(i + 1);
  });
  if (!objects.length) throw new IngestError('The JSON Lines file has no records.', 'invalid_content');
  const result = parseJsonImport(fileName, JSON.stringify(objects));
  // Report physical line numbers, not array positions.
  const line = (row: number) => lineOf[row - 1] ?? row;
  return {
    ...result,
    rejectedRows: result.rejectedRows.map((r) => ({ ...r, row: line(r.row) })),
    duplicates: result.duplicates.map((d) => ({ ...d, keptRow: line(d.keptRow), skippedRows: d.skippedRows.map(line) })),
  };
}

/** Task 19's byte bounds on what may reach the model. Never truncates: an over-long record rejects the whole upload. */
function checkBounds(records: GrievanceRecord[]): void {
  records.forEach((r, i) => {
    try {
      validateRecordBounds(r);
    } catch (e) {
      throw new IngestError('Record ' + (i + 1) + ': ' + (e instanceof Error ? e.message : 'Input size exceeds the safety limit.'), 'limit');
    }
  });
}

/**
 * Parser messages can embed source text (JSON.parse quotes the offending token; the CSV importer lists header cells).
 * They are never returned: only a fixed, format-specific message, plus line numbers for JSONL (which carry no text).
 */
const TABULAR_ERROR: Record<'csv' | 'json' | 'jsonl', string> = {
  csv: 'The CSV file could not be read. It must be UTF-8 with a header row containing id and complaintText, and consistently quoted fields.',
  json: 'The JSON file could not be read. It must be UTF-8 JSON: an array of records, or an object with a "records" array, each with id and complaintText.',
  jsonl: 'The JSON Lines file could not be read. Each non-blank line must be one JSON object with id and complaintText.',
};
function tabular(format: 'csv' | 'json' | 'jsonl', name: string, text: string): ImportResult {
  try {
    return format === 'csv' ? parseCsvImport(name, text) : format === 'json' ? parseJsonImport(name, text) : parseJsonl(name, text);
  } catch (e) {
    if (e instanceof IngestError) throw e; // JSONL line errors are fixed strings with a line number only
    throw new IngestError(TABULAR_ERROR[format], 'invalid_content');
  }
}

function documentRecord(format: DocumentKind, name: string, text: string, sourceHash: string, notes: string[]): GrievanceRecord {
  const parsed = parseDocumentText(name, text, format);
  if (!parsed.record) throw new IngestError(parsed.problem ?? 'The document has no usable text.', 'invalid_content');
  const record = parsed.record;
  // A generic or empty file name gives no usable ID: derive a stable one from the content hash.
  if (record.id === 'document') record.id = 'DOC-' + sourceHash.slice(0, 12).toUpperCase();
  notes.push(
    parsed.layout === 'whole-text'
      ? 'No explicit complaint/response headings: the whole text was kept as the complaint and no response was recorded.'
      : 'Complaint and response were separated using explicit headings (' + parsed.layout + ').',
  );
  return record;
}

/**
 * One uploaded file → one canonical dataset (or, for scanned/damaged PDF pages without OCR yet, a request for OCR).
 * Throws IngestError with an administrator-safe message for anything unacceptable; never returns partial data as success.
 */
export async function ingestDocument(input: { name: string; bytes: Uint8Array; ocr?: Map<number, OcrPage>; pdfjs?: PdfJs }): Promise<IngestResult> {
  const { name, bytes } = input;
  const format = formatFromName(name);
  if (!format) throw new IngestError('Unsupported file type. Use .txt, .md, .docx, .csv, .json, .jsonl or .pdf.', 'unsupported');
  if (!bytes.length) throw new IngestError('The file is empty.', 'too_large');
  if (bytes.length > LIMITS.bytes[format]) throw new IngestError('The file is larger than the ' + Math.round(LIMITS.bytes[format] / 1048576) + ' MiB limit for .' + format + ' files.', 'too_large');
  const sourceSha256 = sha256(bytes);
  const base = { schemaVersion: 1 as const, format, sourceFile: name, sourceSha256 };
  const notes: string[] = [];

  if (format === 'csv' || format === 'json' || format === 'jsonl') {
    const parsed = tabular(format, name, decodeText(bytes));
    if (parsed.totalRows > LIMITS.records || parsed.records.length > LIMITS.records) throw new IngestError('Dataset exceeds the ' + LIMITS.records.toLocaleString('en-US') + '-record limit.', 'limit');
    if (parsed.rejectedRows.length || parsed.duplicates.length || parsed.emptyRows || !parsed.records.length) {
      throw new IngestError('Every row requires a unique ID and complaintText; empty, missing, or duplicate rows are not accepted.', 'invalid_content');
    }
    checkBounds(parsed.records);
    return {
      kind: 'complete',
      canonical: {
        ...base,
        records: parsed.records,
        provenance: parsed.records.map((r) => ({ recordId: r.id, sourceFile: name, format, sourceSha256, method: 'direct' as const, extractor: EXTRACTOR_VERSION })),
        notes,
      },
    };
  }

  let text: string;
  let pages: PageProvenance[] | undefined;
  let method: Provenance['method'] = 'direct';
  if (format === 'txt' || format === 'md') {
    text = decodeText(bytes);
  } else if (format === 'docx') {
    const docx = extractDocxText(bytes, isKnownLabel);
    text = docx.text;
    notes.push('Word body text only (' + docx.paragraphs + ' paragraphs, ' + docx.tables + ' tables); headers, footers, comments and images are not read.');
  } else {
    const extraction = await extractPdfPages(bytes, input.pdfjs);
    const needOcr = extraction.pages.filter((p) => p.kind !== 'text' && !input.ocr?.has(p.page));
    if (needOcr.length) {
      return { kind: 'needs_ocr', pageCount: extraction.pageCount, ocrPages: needOcr.map((p) => p.page), textPages: extraction.pages.filter((p) => p.kind === 'text').map((p) => p.page) };
    }
    pages = [];
    const parts: string[] = [];
    for (const p of extraction.pages) {
      const ocr = p.kind === 'text' ? undefined : input.ocr!.get(p.page)!;
      const pageText = cleanText(ocr ? ocr.text : p.text);
      pages.push({ page: p.page, method: ocr ? 'ocr' : 'text-layer', chars: pageText.length, ...(ocr ? { confidence: ocr.confidence } : {}) });
      parts.push(pageText);
    }
    text = parts.join('\n\n');
    const ocrCount = pages.filter((p) => p.method === 'ocr').length;
    method = ocrCount === 0 ? 'text-layer' : ocrCount === pages.length ? 'ocr' : 'mixed';
    notes.push(extraction.pageCount + ' page(s): ' + (extraction.pageCount - ocrCount) + ' from the text layer, ' + ocrCount + ' by OCR.');
    if (!parts.some((t) => t.replace(/\s+/g, '').length >= 10)) throw new IngestError('No readable text was found in the PDF.', 'invalid_content');
  }
  const record = documentRecord(format, name, text, sourceSha256, notes);
  checkBounds([record]);
  return {
    kind: 'complete',
    canonical: {
      ...base,
      records: [record],
      provenance: [{ recordId: record.id, sourceFile: name, format, sourceSha256, method, ...(pages ? { pages } : {}), extractor: EXTRACTOR_VERSION }],
      notes,
    },
  };
}
