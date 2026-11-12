/**
 * Core grievance domain model.
 *
 * Source-integrity rules encoded here (see README → "Data rules"):
 *  - complaintText / responseText are verbatim source text and are never rewritten.
 *  - A response existing does NOT mean the complaint was resolved.
 *  - A missing or unrecognised status is always `unknown`, never `resolved`.
 */

export type CaseStatus = 'resolved' | 'pending' | 'in_progress' | 'unknown';
export type RecordLanguage = 'te' | 'en' | 'mixed' | 'unknown';
export type SourceType = 'note' | 'json' | 'csv' | 'document';

export type GrievanceRecord = {
  /** Stable unique ID, e.g. GRV-000001. */
  id: string;
  /** Verbatim original complaint text (usually Telugu). */
  complaintText: string;
  /** Verbatim department response text, or null when the source has none. Never fabricated. */
  responseText: string | null;
  language: RecordLanguage;
  /** Category as recorded in the source (or assigned in demo data). */
  category: string | null;
  /**
   * Optional structured issue type / sub-category recorded in the source
   * (e.g. "Medicine shortage"). Used for themes because it is a structured field,
   * not a guess from free text.
   */
  issueType: string | null;
  department: string | null;
  district: string | null;
  /** ISO date or date-time, if known. */
  submittedAt: string | null;
  respondedAt: string | null;
  /** Explicit source status; `unknown` when not recorded. */
  status: CaseStatus;
  originalFileName?: string | null;
  sourceType: SourceType;
  isSyntheticDemo: boolean;
};

export const CASE_STATUSES: readonly CaseStatus[] = ['resolved', 'in_progress', 'pending', 'unknown'];

export const UNCATEGORIZED = 'Uncategorized';

/** True only when the source contains non-blank response text. */
export function hasResponse(record: Pick<GrievanceRecord, 'responseText'>): boolean {
  return typeof record.responseText === 'string' && record.responseText.trim().length > 0;
}

export function categoryOf(record: Pick<GrievanceRecord, 'category'>): string {
  const c = record.category?.trim();
  return c ? c : UNCATEGORIZED;
}

/**
 * Normalise a raw status value from an import. Anything that is not an exact,
 * recognised status becomes `unknown` — we never guess "resolved".
 */
export function normalizeStatus(raw: unknown): { status: CaseStatus; recognised: boolean } {
  if (raw === null || raw === undefined) return { status: 'unknown', recognised: true };
  const value = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === '') return { status: 'unknown', recognised: true };
  switch (value) {
    case 'resolved':
    case 'closed_resolved':
      return { status: 'resolved', recognised: true };
    case 'pending':
      return { status: 'pending', recognised: true };
    case 'in_progress':
    case 'inprogress':
      return { status: 'in_progress', recognised: true };
    case 'unknown':
    case 'not_recorded':
      return { status: 'unknown', recognised: true };
    default:
      return { status: 'unknown', recognised: false };
  }
}

/** Basic stats shared by the overview strip and the summarizer (single source of truth). */
export type DatasetStats = {
  total: number;
  withResponse: number;
  missingResponse: number;
  byStatus: Record<CaseStatus, number>;
  missingDate: number;
  uncategorized: number;
  categoryCount: number;
  dateSpan: { from: string; to: string } | null;
};

export function isValidDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

export function computeStats(records: readonly GrievanceRecord[]): DatasetStats {
  const byStatus: Record<CaseStatus, number> = { resolved: 0, pending: 0, in_progress: 0, unknown: 0 };
  let withResponse = 0;
  let missingDate = 0;
  let uncategorized = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  let minS = '';
  let maxS = '';
  const categories = new Set<string>();

  for (const r of records) {
    byStatus[r.status] += 1;
    if (hasResponse(r)) withResponse += 1;
    const cat = categoryOf(r);
    categories.add(cat);
    if (cat === UNCATEGORIZED) uncategorized += 1;
    if (isValidDate(r.submittedAt)) {
      const t = Date.parse(r.submittedAt);
      if (t < minT) {
        minT = t;
        minS = r.submittedAt;
      }
      if (t > maxT) {
        maxT = t;
        maxS = r.submittedAt;
      }
    } else {
      missingDate += 1;
    }
  }

  return {
    total: records.length,
    withResponse,
    missingResponse: records.length - withResponse,
    byStatus,
    missingDate,
    uncategorized,
    categoryCount: categories.size,
    dateSpan: Number.isFinite(minT) ? { from: minS, to: maxS } : null,
  };
}

export type Dataset = {
  /** Stable identifier; changes whenever the loaded data changes. */
  id: string;
  name: string;
  kind: 'sample' | 'synthetic-expansion' | 'imported' | 'live';
  records: GrievanceRecord[];
  /** True when every record is synthetic demo content. */
  isSynthetic: boolean;
  /** Original file name for imported datasets. */
  sourceFileName?: string;
  /** ISO time the data was fetched from the backend (live datasets). */
  loadedAt?: string;
};
