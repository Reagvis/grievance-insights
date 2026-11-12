import { normalizeStatus, type CaseStatus, type GrievanceRecord, type RecordLanguage } from '../domain/grievance';

/**
 * Turning the text of one TXT / PDF note into a record.
 *
 * Nothing is guessed from meaning. A file is split into complaint and response ONLY when:
 *   1. it is a note exported by this app ("GRIEVANCE NOTE … CITIZEN COMPLAINT … DEPARTMENT RESPONSE"), or
 *   2. it has explicit headings such as "Complaint:" / "Response:" (English or Telugu).
 * Otherwise the whole text becomes the complaint and no response is recorded — the importer reports how many files fell into that case.
 */

export type DocumentParse = {
  record: GrievanceRecord | null;
  /** Why no record was produced. */
  problem?: string;
  /** How the text was divided, for the import summary. */
  layout: 'app-note' | 'headings' | 'whole-text';
};

const TELUGU = /[ఀ-౿]/;
const LATIN = /[A-Za-z]/;

function language(text: string): RecordLanguage {
  const te = TELUGU.test(text);
  const latin = LATIN.test(text);
  return te && latin ? 'mixed' : te ? 'te' : latin ? 'en' : 'unknown';
}

export function cleanText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** File name without folder or extension, made safe for use as a case ID. */
export function idFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[^.]+$/, '').replace(/-note$/i, '');
  const id = stem.normalize('NFC').replace(/\s+/g, '_').replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '').replace(/^[._-]+|[._-]+$/g, '');
  return id || 'document';
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "4 Jul 2026" (as written by the note export) or ISO → YYYY-MM-DD; null when not a real date. */
export function parseNoteDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return Number.isFinite(Date.parse(v)) ? v.slice(0, 10) : null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3,4})[a-z]*\.?,?\s+(\d{4})$/.exec(v);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return d.getUTCMonth() === month && d.getUTCDate() === Number(m[1]) ? d.toISOString().slice(0, 10) : null;
}

const NOT_RECORDED = /^(not recorded|not provided.*|none|n\/a|-|—)$/i;

function statusFromLabel(value: string): CaseStatus {
  const v = value.trim().toLowerCase();
  if (v.startsWith('resolved')) return 'resolved';
  if (v.startsWith('in progress') || v.startsWith('in_progress')) return 'in_progress';
  if (v.startsWith('pending')) return 'pending';
  return normalizeStatus(v).status;
}

type Header = { id?: string; category?: string; issueType?: string; department?: string; district?: string; submittedAt?: string; respondedAt?: string; status?: CaseStatus; language?: RecordLanguage; sourceFile?: string };

const HEADER_KEYS: Array<[RegExp, keyof Header]> = [
  [/^(case\s*id|id|grievance\s*id)$/i, 'id'],
  [/^category$/i, 'category'],
  [/^issue\s*type$/i, 'issueType'],
  [/^department$/i, 'department'],
  [/^district$/i, 'district'],
  [/^(submitted|submitted\s*at|date)$/i, 'submittedAt'],
  [/^(responded|responded\s*at|response\s*date)$/i, 'respondedAt'],
  [/^status$/i, 'status'],
  [/^language$/i, 'language'],
  [/^source\s*file$/i, 'sourceFile'],
];

/** Reads simple "Label:   value" lines; unknown labels are ignored. */
function readHeader(lines: string[]): Header {
  const h: Header = {};
  for (const line of lines) {
    const m = /^\s*([^:：]{1,24}?)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = HEADER_KEYS.find(([re]) => re.test(m[1]))?.[1];
    if (!key || NOT_RECORDED.test(m[2])) continue;
    const value = m[2];
    if (key === 'status') h.status = statusFromLabel(value);
    else if (key === 'language') {
      const l = value.toLowerCase();
      if (l === 'te' || l === 'en' || l === 'mixed' || l === 'unknown') h.language = l;
    } else if (key === 'submittedAt' || key === 'respondedAt') {
      const d = parseNoteDate(value);
      if (d) h[key] = d;
    } else (h as Record<string, string>)[key] = value;
  }
  return h;
}

const COMPLAINT_LABEL = /^\s*(?:citizen\s+complaint|complaint|grievance|query|పౌరుని\s+ఫిర్యాదు|ఫిర్యాదు)\s*(?:[:：]\s*(.*))?$/iu;
const RESPONSE_LABEL = /^\s*(?:department\s+response|official\s+response|response|reply|action\s+taken|విభాగం\s+స్పందన|అధికారిక\s+స్పందన|స్పందన)\s*(?:[:：]\s*(.*))?$/iu;
/** True for a label this parser understands (a header field, "Complaint" or "Response"); used to read two-column Word tables. */
export function isKnownLabel(label: string): boolean {
  const l = label.trim();
  return HEADER_KEYS.some(([re]) => re.test(l)) || COMPLAINT_LABEL.test(l) || RESPONSE_LABEL.test(l);
}
const UNDERLINE = /^\s*[-=_–—]{3,}\s*$/;
const NO_RESPONSE_SENTINEL = /^no response recorded in the source data\.?$/i;

function build(
  fileName: string,
  header: Header,
  complaint: string,
  response: string | null,
  sourceType: GrievanceRecord['sourceType'],
  synthetic: boolean,
): GrievanceRecord {
  const resp = response && response.trim() && !NO_RESPONSE_SENTINEL.test(response.trim()) ? response.trim() : null;
  return {
    id: header.id ?? idFromFileName(fileName),
    complaintText: complaint,
    responseText: resp,
    language: header.language && header.language !== 'unknown' ? header.language : language(complaint),
    category: header.category ?? null,
    issueType: header.issueType ?? null,
    department: header.department ?? null,
    district: header.district ?? null,
    submittedAt: header.submittedAt ?? null,
    respondedAt: header.respondedAt ?? null,
    status: header.status ?? 'unknown',
    originalFileName: header.sourceFile ?? fileName.split(/[\\/]/).pop() ?? fileName,
    sourceType,
    isSyntheticDemo: synthetic,
  };
}

export type DocumentKind = 'txt' | 'md' | 'docx' | 'pdf';

/**
 * Markdown decoration is removed from LABEL and HEADER lines only ("## Complaint", "**Case ID:** X"), so the
 * explicit-heading rules below also work for .md files. Every other line, including the complaint text itself, is left verbatim.
 */
export function stripMarkdownLabels(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading && (COMPLAINT_LABEL.test(heading[1]) || RESPONSE_LABEL.test(heading[1]))) return heading[1].replace(/[:：]\s*$/, '') + ':';
      const bold = /^\s*(?:[-*]\s+)?(?:\*\*|__)([^*_:：]{1,24}?)\s*[:：]?\s*(?:\*\*|__)\s*[:：]?\s*(.*)$/.exec(line);
      if (bold && (HEADER_KEYS.some(([re]) => re.test(bold[1].trim())) || COMPLAINT_LABEL.test(bold[1]) || RESPONSE_LABEL.test(bold[1]))) {
        return bold[1].trim() + ': ' + bold[2];
      }
      return line;
    })
    .join('\n');
}

/** Parse the text of one document. `kind` only decides the recorded source type. */
export function parseDocumentText(fileName: string, raw: string, kind: DocumentKind): DocumentParse {
  const text = kind === 'md' ? stripMarkdownLabels(cleanText(raw)) : cleanText(raw);
  const sourceType: GrievanceRecord['sourceType'] = kind === 'pdf' || kind === 'docx' ? 'document' : 'note';
  if (!text) return { record: null, problem: 'The file has no text.', layout: 'whole-text' };
  const lines = text.split('\n');

  // 1) A note exported by this app.
  const cIdx = lines.findIndex((l) => l.trim() === 'CITIZEN COMPLAINT');
  const rIdx = lines.findIndex((l) => l.trim() === 'DEPARTMENT RESPONSE');
  if (lines[0]?.startsWith('GRIEVANCE NOTE') && cIdx > 0 && rIdx > cIdx) {
    const complaint = lines.slice(UNDERLINE.test(lines[cIdx + 1] ?? '') ? cIdx + 2 : cIdx + 1, rIdx).join('\n').trim();
    const response = lines.slice(UNDERLINE.test(lines[rIdx + 1] ?? '') ? rIdx + 2 : rIdx + 1).join('\n').trim();
    if (!complaint) return { record: null, problem: 'The note has an empty complaint section.', layout: 'app-note' };
    const synthetic = lines.slice(0, cIdx).some((l) => l.startsWith('SYNTHETIC DEMONSTRATION RECORD'));
    return { record: build(fileName, readHeader(lines.slice(0, cIdx)), complaint, response, sourceType, synthetic), layout: 'app-note' };
  }

  // 2) Explicit "Complaint:" / "Response:" headings.
  const labelC = lines.findIndex((l) => COMPLAINT_LABEL.test(l));
  const labelR = labelC >= 0 ? lines.findIndex((l, i) => i > labelC && RESPONSE_LABEL.test(l)) : -1;
  if (labelC >= 0) {
    const inlineC = COMPLAINT_LABEL.exec(lines[labelC])?.[1] ?? '';
    const endC = labelR >= 0 ? labelR : lines.length;
    const body = (first: string, from: number, to: number) =>
      [first, ...lines.slice(from, to).filter((l, i) => !(i === 0 && UNDERLINE.test(l)))].join('\n').trim();
    const complaint = body(inlineC, labelC + 1, endC);
    if (complaint) {
      const response = labelR >= 0 ? body(RESPONSE_LABEL.exec(lines[labelR])?.[1] ?? '', labelR + 1, lines.length) : null;
      const header = readHeader(lines.slice(0, labelC));
      return { record: build(fileName, header, complaint, response, sourceType, false), layout: 'headings' };
    }
  }

  // 3) Whole text is the complaint; nothing is invented about a response.
  return { record: build(fileName, {}, text, null, sourceType, false), layout: 'whole-text' };
}
