import { isValidDate, normalizeStatus, type GrievanceRecord, type RecordLanguage } from '../domain/grievance';
import { CsvParseError, parseCsv } from './csv';
import { csvCell } from './downloads';
import { parseDocumentText } from './documentImport';
import { extractPdfText, PdfReadError, type PdfJsLike } from './pdfText';

/**
 * Local, in-browser import of UTF-8 JSON / CSV grievance records.
 * Nothing is uploaded or persisted; parsed records live in memory only.
 */

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export type ImportIssue = { level: 'error' | 'warning'; message: string };

export type ImportResult = {
  format: 'csv' | 'json' | 'documents';
  fileName: string;
  records: GrievanceRecord[];
  totalRows: number;
  emptyRows: number;
  /** Rows rejected because mandatory data is missing or invalid. */
  rejectedRows: Array<{ row: number; reason: string }>;
  /** IDs that appeared more than once; the first occurrence is kept. */
  duplicates: Array<{ id: string; keptRow: number; skippedRows: number[]; identical: boolean }>;
  issues: ImportIssue[];
  /** Set when the import was a batch of TXT / PDF files. */
  documents?: DocumentSummary;
};

export type DocumentSummary = {
  txt: number;
  pdf: number;
  /** Files of other types that were skipped (e.g. when a whole folder is chosen). */
  ignored: number;
  /** Files split into complaint and response by an app note layout or explicit headings. */
  split: number;
  /** Files imported whole as the complaint because no headings were found. */
  wholeText: number;
};

type FieldKey =
  | 'id'
  | 'complaintText'
  | 'responseText'
  | 'language'
  | 'category'
  | 'issueType'
  | 'department'
  | 'district'
  | 'submittedAt'
  | 'respondedAt'
  | 'status'
  | 'originalFileName'
  | 'isSyntheticDemo';

const ALIASES: Record<FieldKey, string[]> = {
  id: ['id', 'caseid', 'case_id', 'grievanceid', 'grievance_id'],
  complaintText: ['complainttext', 'complaint_text', 'complaint', 'query', 'grievance'],
  responseText: ['responsetext', 'response_text', 'response', 'reply', 'action_taken', 'actiontaken'],
  language: ['language', 'lang'],
  category: ['category'],
  issueType: ['issuetype', 'issue_type', 'subcategory', 'sub_category'],
  department: ['department', 'dept'],
  district: ['district'],
  submittedAt: ['submittedat', 'submitted_at', 'submitted', 'date', 'createdat', 'created_at'],
  respondedAt: ['respondedat', 'responded_at', 'responsedate', 'response_date'],
  status: ['status', 'outcome'],
  originalFileName: ['originalfilename', 'original_file_name', 'filename', 'file_name'],
  isSyntheticDemo: ['issyntheticdemo', 'is_synthetic_demo', 'synthetic'],
};

const ALIAS_LOOKUP = new Map<string, FieldKey>();
for (const [key, list] of Object.entries(ALIASES) as Array<[FieldKey, string[]]>) {
  for (const alias of list) ALIAS_LOOKUP.set(alias, key);
}

function mapHeader(name: string): FieldKey | undefined {
  const k = name.normalize('NFC').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIAS_LOOKUP.get(k) ?? ALIAS_LOOKUP.get(k.replace(/_/g, ''));
}

export const TEMPLATE_COLUMNS: FieldKey[] = [
  'id',
  'complaintText',
  'responseText',
  'language',
  'category',
  'issueType',
  'department',
  'district',
  'submittedAt',
  'respondedAt',
  'status',
];

/** Decode bytes as strict UTF-8; rejects files in other encodings instead of mangling Telugu. */
export function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportError('The file is not valid UTF-8 text. Re-save it as "CSV UTF-8" or UTF-8 JSON and try again.');
  }
}

const TELUGU = /[ఀ-౿]/;
const LATIN = /[A-Za-z]/;

/** Script-based language detection (Unicode ranges only — no guessing of meaning). */
export function detectLanguage(text: string): RecordLanguage {
  const te = TELUGU.test(text);
  const latin = LATIN.test(text);
  if (te && latin) return 'mixed';
  if (te) return 'te';
  if (latin) return 'en';
  return 'unknown';
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
  if (s === null) return null;
  const trimmed = s.normalize('NFC').trim();
  return trimmed === '' ? null : trimmed;
}

/** Verbatim text: NFC-normalised and outer whitespace trimmed, inner line breaks kept. */
function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).normalize('NFC').replace(/\r\n?/g, '\n').trim();
  return s === '' ? null : s;
}

type RawRow = { row: number; values: Partial<Record<FieldKey, unknown>> };

function buildResult(format: 'csv' | 'json', fileName: string, rows: RawRow[], emptyRows: number, issues: ImportIssue[]): ImportResult {
  const records: GrievanceRecord[] = [];
  const rejectedRows: ImportResult['rejectedRows'] = [];
  const firstSeen = new Map<string, { row: number; record: GrievanceRecord }>();
  const dupMap = new Map<string, ImportResult['duplicates'][number]>();
  const unknownStatusValues = new Map<string, number>();
  let invalidDates = 0;
  let detectedLanguages = 0;

  for (const { row, values } of rows) {
    const id = str(values.id);
    const complaint = text(values.complaintText);
    if (!id) {
      rejectedRows.push({ row, reason: 'Missing case ID' });
      continue;
    }
    if (!complaint) {
      rejectedRows.push({ row, reason: `Missing complaint text for ${id}` });
      continue;
    }

    const { status, recognised } = normalizeStatus(values.status);
    if (!recognised) {
      const raw = String(values.status);
      unknownStatusValues.set(raw, (unknownStatusValues.get(raw) ?? 0) + 1);
    }

    const date = (v: unknown) => {
      const s = str(v);
      if (!s) return null;
      if (!isValidDate(s)) {
        invalidDates += 1;
        return null;
      }
      return s;
    };

    let language = str(values.language)?.toLowerCase() as RecordLanguage | undefined;
    if (!language || !['te', 'en', 'mixed', 'unknown'].includes(language)) {
      language = detectLanguage(complaint);
      detectedLanguages += 1;
    }

    const synthetic = values.isSyntheticDemo;
    const record: GrievanceRecord = {
      id,
      complaintText: complaint,
      responseText: text(values.responseText),
      language,
      category: str(values.category),
      issueType: str(values.issueType),
      department: str(values.department),
      district: str(values.district),
      submittedAt: date(values.submittedAt),
      respondedAt: date(values.respondedAt),
      status,
      originalFileName: str(values.originalFileName),
      sourceType: format,
      isSyntheticDemo: synthetic === true || (typeof synthetic === 'string' && ['true', 'yes', '1'].includes(synthetic.trim().toLowerCase())),
    };

    const seen = firstSeen.get(id);
    if (seen) {
      const identical = JSON.stringify({ ...seen.record, sourceType: null }) === JSON.stringify({ ...record, sourceType: null });
      const d = dupMap.get(id) ?? { id, keptRow: seen.row, skippedRows: [], identical: true };
      d.skippedRows.push(row);
      d.identical = d.identical && identical;
      dupMap.set(id, d);
      continue;
    }
    firstSeen.set(id, { row, record });
    records.push(record);
  }

  if (unknownStatusValues.size > 0) {
    const examples = [...unknownStatusValues.keys()].slice(0, 3).map((v) => `"${v}"`).join(', ');
    const n = [...unknownStatusValues.values()].reduce((a, b) => a + b, 0);
    issues.push({
      level: 'warning',
      message: `${n} row(s) had unrecognised status values (${examples}). They were set to "Status not recorded", never to Resolved.`,
    });
  }
  if (invalidDates > 0) issues.push({ level: 'warning', message: `${invalidDates} date value(s) could not be read and were left blank.` });
  if (detectedLanguages > 0)
    issues.push({ level: 'warning', message: `Language was missing or invalid for ${detectedLanguages} record(s) and was detected from the script used.` });
  if (rejectedRows.length > 0)
    issues.push({ level: 'error', message: `${rejectedRows.length} row(s) were rejected because mandatory data is missing.` });
  const duplicates = [...dupMap.values()];
  if (duplicates.length > 0) {
    const skipped = duplicates.reduce((a, d) => a + d.skippedRows.length, 0);
    issues.push({
      level: 'warning',
      message: `${duplicates.length} case ID(s) appear more than once. The first occurrence was kept; ${skipped} later row(s) were set aside and are listed below.`,
    });
  }
  if (records.length === 0) issues.push({ level: 'error', message: 'No valid records were found in this file.' });

  return { format, fileName, records, totalRows: rows.length + emptyRows, emptyRows, rejectedRows, duplicates, issues };
}

export function parseCsvImport(fileName: string, content: string): ImportResult {
  let rows: string[][];
  try {
    rows = parseCsv(content);
  } catch (e) {
    throw new ImportError(e instanceof CsvParseError ? `Malformed CSV: ${e.message}` : 'Malformed CSV file.');
  }
  if (rows.length === 0 || rows[0].every((c) => c.trim() === '')) throw new ImportError('The CSV file is empty or has no header row.');

  const header = rows[0];
  const mapping: Array<FieldKey | undefined> = header.map(mapHeader);
  const issues: ImportIssue[] = [];
  const mapped = new Set(mapping.filter(Boolean));
  if (!mapped.has('id') || !mapped.has('complaintText')) {
    throw new ImportError(
      `Required columns are missing. The header must include "id" and "complaintText". Found: ${header.map((h) => `"${h.trim()}"`).join(', ')}.`,
    );
  }
  const ignored = header.filter((_, i) => !mapping[i]).map((h) => h.trim()).filter(Boolean);
  if (ignored.length) issues.push({ level: 'warning', message: `Ignored unrecognised column(s): ${ignored.join(', ')}.` });

  const raw: RawRow[] = [];
  let emptyRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.every((c) => c.trim() === '')) {
      emptyRows += 1;
      continue;
    }
    const values: Partial<Record<FieldKey, unknown>> = {};
    mapping.forEach((key, idx) => {
      if (key && values[key] === undefined) values[key] = cells[idx] ?? '';
    });
    raw.push({ row: i + 1, values });
  }
  return buildResult('csv', fileName, raw, emptyRows, issues);
}

export function parseJsonImport(fileName: string, content: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
  } catch (e) {
    throw new ImportError(`Malformed JSON: ${e instanceof Error ? e.message : 'could not parse file'}.`);
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { records?: unknown }).records)
      ? (data as { records: unknown[] }).records
      : null;
  if (!list) throw new ImportError('JSON must be an array of records, or an object with a "records" array.');

  const issues: ImportIssue[] = [];
  const unknownKeys = new Set<string>();
  const raw: RawRow[] = [];
  let emptyRows = 0;
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      emptyRows += 1;
      return;
    }
    const values: Partial<Record<FieldKey, unknown>> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      const key = mapHeader(k);
      if (key) {
        if (values[key] === undefined) values[key] = v;
      } else if (!['sourcetype', 'source_type'].includes(k.toLowerCase())) {
        unknownKeys.add(k);
      }
    }
    if (Object.keys(values).length === 0) {
      emptyRows += 1;
      return;
    }
    raw.push({ row: i + 1, values });
  });
  if (unknownKeys.size)
    issues.push({ level: 'warning', message: `Ignored unrecognised field(s): ${[...unknownKeys].slice(0, 8).join(', ')}.` });
  return buildResult('json', fileName, raw, emptyRows, issues);
}

export async function readImportFile(file: File): Promise<ImportResult> {
  if (file.size === 0) throw new ImportError('The selected file is empty.');
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('The file is larger than 25 MB. Split it into smaller files.');
  const name = file.name.toLowerCase();
  const isJson = name.endsWith('.json') || file.type === 'application/json';
  const isCsv = name.endsWith('.csv') || file.type === 'text/csv';
  if (!isJson && !isCsv) throw new ImportError('Unsupported file type. Choose a .csv or .json file.');
  const content = decodeUtf8(await file.arrayBuffer());
  return isJson ? parseJsonImport(file.name, content) : parseCsvImport(file.name, content);
}

const fileKind = (f: File): 'csv' | 'json' | 'txt' | 'pdf' | null => {
  const n = f.name.toLowerCase();
  if (n.endsWith('.csv') || f.type === 'text/csv') return 'csv';
  if (n.endsWith('.json') || f.type === 'application/json') return 'json';
  if (n.endsWith('.txt') || f.type === 'text/plain') return 'txt';
  if (n.endsWith('.pdf') || f.type === 'application/pdf') return 'pdf';
  return null;
};

/** TXT files: strict UTF-8, or UTF-16 when the file starts with a byte-order mark (what Windows Notepad calls "Unicode"). */
export function decodeTextFile(buffer: ArrayBuffer): string {
  const b = new Uint8Array(buffer);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return decodeUtf8(buffer);
}

export type ReadFilesOptions = {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Supplies pdf.js; defaults to the browser loader (tests inject their own). */
  /** Supplies pdf.js. Injected (the browser UI passes `loadPdfJs` from pdfLoader.ts) so this module stays free of browser-only imports: the AWS dataset Lambda bundles it too. */
  loadPdf?: () => Promise<PdfJsLike>;
  concurrency?: number;
};

const n = (x: number) => x.toLocaleString('en-IN');

/**
 * Import from the user's selection:
 *  - exactly one CSV or JSON file (structured records), or
 *  - any number of TXT and/or PDF notes (one record per file).
 */
export async function readImportFiles(files: File[], opts: ReadFilesOptions = {}): Promise<ImportResult> {
  if (files.length === 0) throw new ImportError('No files were selected.');
  const kinds = files.map(fileKind);
  const structured = files.filter((_, i) => kinds[i] === 'csv' || kinds[i] === 'json');
  const docs = files.map((f, i) => ({ f, kind: kinds[i] })).filter((d): d is { f: File; kind: 'txt' | 'pdf' } => d.kind === 'txt' || d.kind === 'pdf');
  const ignored = files.length - structured.length - docs.length;

  if (structured.length > 0 && docs.length > 0) {
    throw new ImportError('Choose either one CSV / JSON file, or TXT / PDF notes — not a mix of both.');
  }
  if (structured.length > 1) throw new ImportError('Choose one CSV or JSON file at a time.');
  if (structured.length === 1) return readImportFile(structured[0]);
  if (docs.length === 0) throw new ImportError('Unsupported file type. Choose a .csv or .json file, or .txt / .pdf notes.');

  docs.sort((a, b) => a.f.name.localeCompare(b.f.name, 'en', { numeric: true }));
  type Outcome = { row: number; name: string; record?: GrievanceRecord; layout?: 'app-note' | 'headings' | 'whole-text'; problem?: string; lossy?: number };
  const outcomes: Outcome[] = new Array(docs.length);
  let next = 0;
  let done = 0;
  let pdfjs: PdfJsLike | null = null;

  const work = async () => {
    for (;;) {
      opts.signal?.throwIfAborted();
      const i = next++;
      if (i >= docs.length) return;
      const { f, kind } = docs[i];
      const out: Outcome = { row: i + 1, name: f.name };
      try {
        if (f.size === 0) throw new ImportError('The file is empty.');
        if (f.size > MAX_IMPORT_BYTES) throw new ImportError('The file is larger than 25 MB.');
        const buffer = await f.arrayBuffer();
        let text: string;
        if (kind === 'pdf') {
          if (!opts.loadPdf) throw new ImportError('PDF files cannot be read in this environment.');
          pdfjs ??= await opts.loadPdf();
          const pdfText = await extractPdfText(pdfjs, buffer);
          text = pdfText.text;
          if (pdfText.undecodable > 0) out.lossy = pdfText.undecodable;
        } else {
          text = decodeTextFile(buffer);
        }
        const parsed = parseDocumentText(f.name, text, kind);
        out.layout = parsed.layout;
        if (parsed.record) out.record = parsed.record;
        else out.problem = parsed.problem ?? 'No usable text.';
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        out.problem = e instanceof ImportError || e instanceof PdfReadError ? e.message : 'The file could not be read.';
      }
      outcomes[i] = out;
      opts.onProgress?.(++done, docs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, docs.length) }, work));

  const records: GrievanceRecord[] = [];
  const rejectedRows: ImportResult['rejectedRows'] = [];
  const firstSeen = new Map<string, { row: number; record: GrievanceRecord }>();
  const dupMap = new Map<string, ImportResult['duplicates'][number]>();
  let split = 0;
  let wholeText = 0;
  for (const o of outcomes) {
    if (!o.record) {
      rejectedRows.push({ row: o.row, reason: o.name + ': ' + o.problem });
      continue;
    }
    const seen = firstSeen.get(o.record.id);
    if (seen) {
      const d = dupMap.get(o.record.id) ?? { id: o.record.id, keptRow: seen.row, skippedRows: [], identical: true };
      d.skippedRows.push(o.row);
      d.identical = d.identical && seen.record.complaintText === o.record.complaintText && seen.record.responseText === o.record.responseText;
      dupMap.set(o.record.id, d);
      continue;
    }
    firstSeen.set(o.record.id, { row: o.row, record: o.record });
    records.push(o.record);
    if (o.layout === 'whole-text') wholeText += 1;
    else split += 1;
  }

  const issues: ImportIssue[] = [];
  const pdf = docs.filter((d) => d.kind === 'pdf').length;
  if (wholeText > 0) {
    issues.push({
      level: 'warning',
      message:
        n(wholeText) +
        (wholeText === 1 ? ' file has' : ' files have') +
        ' no "Complaint:" / "Response:" headings, so the whole text is imported as the complaint and no response is recorded. Nothing was guessed.',
    });
  }
  if (pdf > 0 && records.some((r) => r.sourceType === 'document')) {
    issues.push({
      level: 'warning',
      message:
        "PDF text was read from each file's text layer. Check the preview: PDFs made with older non-Unicode Telugu fonts can read as unreadable characters, and scanned PDFs have no text (OCR is not available yet).",
    });
  }
  const lossy = outcomes.filter((o) => o.record && o.lossy).length;
  if (lossy > 0) {
    issues.push({
      level: 'warning',
      message: n(lossy) + (lossy === 1 ? ' PDF has' : ' PDFs have') + ' a few letters that could not be decoded and were dropped, so that text may be incomplete. Compare it with the original before relying on it.',
    });
  }
  if (ignored > 0) issues.push({ level: 'warning', message: n(ignored) + (ignored === 1 ? ' other file was' : ' other files were') + ' skipped (only .txt and .pdf are read).' });
  if (records.some((r) => r.status === 'unknown')) {
    issues.push({ level: 'warning', message: 'Status and dates are only read from a file when it states them; otherwise they stay “not recorded”.' });
  }

  return {
    format: 'documents',
    fileName: docs.length === 1 ? docs[0].f.name : n(docs.length) + ' files',
    records,
    totalRows: docs.length,
    emptyRows: 0,
    rejectedRows,
    duplicates: [...dupMap.values()],
    issues,
    documents: { txt: docs.length - pdf, pdf, ignored, split, wholeText },
  };
}

/** Template files offered for download in the import dialog. */
export function buildCsvTemplate(): string {
  const example: Record<string, string> = {
    id: 'GRV-000001',
    complaintText: 'మా ప్రాంతంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.',
    responseText: 'సంబంధిత నీటి సరఫరా విభాగానికి సమస్యను పంపించాము. పరిశీలన కొనసాగుతోంది.',
    language: 'te',
    category: 'Water supply',
    issueType: 'Irregular supply',
    department: 'Rural Water Supply',
    district: 'District A',
    submittedAt: '2026-07-07',
    respondedAt: '2026-07-08',
    status: 'in_progress',
  };
  const example2: Record<string, string> = {
    id: 'GRV-000002',
    complaintText: 'ప్రభుత్వ ఆసుపత్రిలో మందులు అందుబాటులో లేవు.',
    responseText: '',
    language: 'te',
    category: 'Healthcare',
    issueType: '',
    department: '',
    district: '',
    submittedAt: '',
    respondedAt: '',
    status: '',
  };
  const line = (r: Record<string, string>) => TEMPLATE_COLUMNS.map((c) => csvCell(r[c])).join(',');
  return `﻿${TEMPLATE_COLUMNS.join(',')}\r\n${line(example)}\r\n${line(example2)}\r\n`;
}

export function buildJsonTemplate(): string {
  return `${JSON.stringify(
    [
      {
        id: 'GRV-000001',
        complaintText: 'మా ప్రాంతంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.',
        responseText: 'సంబంధిత నీటి సరఫరా విభాగానికి సమస్యను పంపించాము. పరిశీలన కొనసాగుతోంది.',
        language: 'te',
        category: 'Water supply',
        issueType: 'Irregular supply',
        department: 'Rural Water Supply',
        district: 'District A',
        submittedAt: '2026-07-07',
        respondedAt: '2026-07-08',
        status: 'in_progress',
      },
      {
        id: 'GRV-000002',
        complaintText: 'ప్రభుత్వ ఆసుపత్రిలో మందులు అందుబాటులో లేవు.',
        responseText: null,
        language: 'te',
        category: 'Healthcare',
        issueType: null,
        department: null,
        district: null,
        submittedAt: null,
        respondedAt: null,
        status: 'unknown',
      },
    ],
    null,
    2,
  )}\n`;
}
