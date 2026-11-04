import { strToU8, zipSync } from 'fflate';
import { categoryOf, hasResponse, type CaseStatus, type Dataset, type GrievanceRecord } from '../domain/grievance';
import { formatDate, localDateStamp } from './format';

export const NOT_RECORDED = 'Not recorded';

const STATUS_LABEL: Record<CaseStatus, string> = {
  resolved: 'Resolved (as recorded in source)',
  in_progress: 'In progress (as recorded in source)',
  pending: 'Pending (as recorded in source)',
  unknown: 'Resolution status not recorded',
};

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Triggers a real browser download of a Blob. Throws DownloadError when the
 * environment blocks it, so callers never show a false "downloaded" message.
 */
export function triggerDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new DownloadError('Downloads are not available in this environment.');
  }
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    throw new DownloadError('The browser blocked creating the download file.');
  }
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    throw new DownloadError('The browser blocked the download. Check your download permissions and try again.');
  } finally {
    // Give the browser time to start the download before revoking.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function utf8Blob(text: string, type: string): Blob {
  return new Blob([strToU8(text)], { type: `${type};charset=utf-8` });
}

/** File-system safe name derived from the case ID. */
export function safeFileStem(id: string): string {
  const stem = id.normalize('NFC').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return stem || 'record';
}

export function noteFileName(record: Pick<GrievanceRecord, 'id'>): string {
  return `${safeFileStem(record.id)}-note.txt`;
}

function field(label: string, value: string | null | undefined): string {
  const v = value && value.trim() ? value.trim() : NOT_RECORDED;
  return `${(label + ':').padEnd(16, ' ')}${v}`;
}

/** Human-readable UTF-8 note containing the verbatim complaint and response. */
export function buildNoteText(record: GrievanceRecord, datasetName: string): string {
  const lines: string[] = [];
  lines.push(`GRIEVANCE NOTE  ${record.id}`);
  if (record.isSyntheticDemo) {
    lines.push('SYNTHETIC DEMONSTRATION RECORD — not real CM Helpline data.');
  }
  lines.push(`Dataset: ${datasetName}`);
  lines.push('');
  lines.push(field('Case ID', record.id));
  lines.push(field('Category', record.category));
  lines.push(field('Issue type', record.issueType));
  lines.push(field('Department', record.department));
  lines.push(field('District', record.district));
  lines.push(field('Submitted', formatDate(record.submittedAt)));
  lines.push(field('Responded', formatDate(record.respondedAt)));
  lines.push(field('Status', STATUS_LABEL[record.status]));
  lines.push(field('Response', hasResponse(record) ? 'Provided in source' : 'Not provided in source'));
  lines.push(field('Language', record.language));
  lines.push(field('Source file', record.originalFileName ?? null));
  lines.push('');
  lines.push('CITIZEN COMPLAINT');
  lines.push('-----------------');
  lines.push(record.complaintText);
  lines.push('');
  lines.push('DEPARTMENT RESPONSE');
  lines.push('-------------------');
  lines.push(hasResponse(record) ? (record.responseText as string) : 'No response recorded in the source data.');
  lines.push('');
  return lines.join('\n');
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const MANIFEST_HEADER = [
  'id',
  'file',
  'category',
  'issueType',
  'department',
  'district',
  'submittedAt',
  'respondedAt',
  'status',
  'responseProvided',
  'language',
  'isSyntheticDemo',
];

export function buildManifestCsv(records: readonly GrievanceRecord[], fileNames: Map<string, string>): string {
  const rows = [MANIFEST_HEADER.join(',')];
  for (const r of records) {
    rows.push(
      [
        r.id,
        fileNames.get(r.id) ?? noteFileName(r),
        categoryOf(r),
        r.issueType,
        r.department,
        r.district,
        r.submittedAt,
        r.respondedAt,
        r.status,
        hasResponse(r) ? 'yes' : 'no',
        r.language,
        r.isSyntheticDemo ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // BOM so spreadsheet apps detect UTF-8 (Telugu category names, etc.).
  return `﻿${rows.join('\r\n')}\r\n`;
}

function buildReadme(dataset: Dataset, count: number, scopeNote: string): string {
  const lines = [
    'Grievance Insights — record export',
    '',
    `Dataset: ${dataset.name}`,
    `Scope: ${scopeNote}`,
    `Records: ${count}`,
    `Exported: ${new Date().toISOString()}`,
    '',
    'Contents:',
    '  notes/       one UTF-8 text note per record (verbatim complaint and response)',
    '  manifest.csv record metadata (UTF-8 with BOM)',
    '',
  ];
  if (dataset.isSynthetic) {
    lines.push('IMPORTANT: This dataset is SYNTHETIC SAMPLE DATA created for a prototype demonstration.');
    lines.push('It is not real CM Helpline data and must not be cited as such.');
  } else {
    lines.push('Records were imported locally from a user-supplied file. Missing values are shown as "Not recorded".');
  }
  lines.push('');
  return lines.join('\n');
}

/** Assigns unique note file names (guards against IDs that sanitise to the same stem). */
export function assignNoteFileNames(records: readonly GrievanceRecord[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const r of records) {
    let name = noteFileName(r);
    let i = 2;
    while (used.has(name.toLowerCase())) {
      name = `${safeFileStem(r.id)}-${i}-note.txt`;
      i += 1;
    }
    used.add(name.toLowerCase());
    names.set(r.id, name);
  }
  return names;
}

export function zipFolderName(dataset: Dataset): string {
  const base = dataset.kind === 'imported' ? 'imported-grievance-records' : 'sample-grievance-records';
  return base;
}

/** Builds a ZIP of every record in `records` plus manifest and README. */
export function buildRecordsZip(
  dataset: Dataset,
  records: readonly GrievanceRecord[],
  scopeNote = 'All records in the dataset',
): Uint8Array {
  if (records.length === 0) throw new DownloadError('There are no records to export.');
  const folder = zipFolderName(dataset);
  const names = assignNoteFileNames(records);
  const files: Record<string, Uint8Array> = {
    [`${folder}/README.txt`]: strToU8(buildReadme(dataset, records.length, scopeNote)),
    [`${folder}/manifest.csv`]: strToU8(buildManifestCsv(records, names)),
  };
  for (const r of records) {
    files[`${folder}/notes/${names.get(r.id)}`] = strToU8(buildNoteText(r, dataset.name));
  }
  // Text compresses well; level 6 keeps 2,000 notes well under a second.
  return zipSync(files, { level: 6 });
}

export function downloadStamp(date = new Date()): string {
  return localDateStamp(date);
}
