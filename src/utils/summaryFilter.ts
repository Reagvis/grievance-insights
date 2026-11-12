import { categoryOf, hasResponse, type CaseStatus, type GrievanceRecord } from '../domain/grievance';
import { describeDateRange, hasDateRange, inDateRange, submittedDay } from './recordSearch';

/**
 * What a Consolidated Summary should cover. Everything defaults to "no restriction"; an empty list means "any".
 * This is separate from the All Complaints list filters, so changing one never silently changes the other.
 */
export type SummaryFilter = {
  /** Category names (use the displayed name, "Uncategorized" for none). [] = every category. */
  categories: string[];
  response: 'any' | 'provided' | 'missing';
  /** [] = any status. */
  statuses: CaseStatus[];
  /** Inclusive submission-date range (YYYY-MM-DD); '' = open. Complaints without a valid date never match an active range. */
  dateFrom: string;
  dateTo: string;
  /** Uploaded files to include (signed-in build). [] = every file. */
  fileIds: string[];
  /** Keep only the newest N complaints (by submission date; undated ones count as oldest). null = no limit. */
  newest: number | null;
};

export const NO_SUMMARY_FILTER: SummaryFilter = { categories: [], response: 'any', statuses: [], dateFrom: '', dateTo: '', fileIds: [], newest: null };
export const NEWEST_CHOICES = [10, 25, 50, 100, 250, 500] as const;

export function isSummaryFiltered(f: SummaryFilter): boolean {
  return f.categories.length > 0 || f.response !== 'any' || f.statuses.length > 0 || hasDateRange(f) || f.fileIds.length > 0 || f.newest !== null;
}

/**
 * Apply the filter. `fileIdOf` maps a record to the uploaded file it came from (only needed when `fileIds` is used).
 * With `newest`, the result is ordered newest-first; otherwise the original order is kept.
 */
export function applySummaryFilter(records: readonly GrievanceRecord[], f: SummaryFilter, fileIdOf?: (record: GrievanceRecord) => string | undefined): GrievanceRecord[] {
  const categories = f.categories.length ? new Set(f.categories) : null;
  const statuses = f.statuses.length ? new Set<CaseStatus>(f.statuses) : null;
  const files = f.fileIds.length ? new Set(f.fileIds) : null;
  const kept = records.filter((r) => {
    if (categories && !categories.has(categoryOf(r))) return false;
    if (f.response === 'provided' && !hasResponse(r)) return false;
    if (f.response === 'missing' && hasResponse(r)) return false;
    if (statuses && !statuses.has(r.status)) return false;
    if (hasDateRange(f) && !inDateRange(r, f.dateFrom, f.dateTo)) return false;
    if (files) {
      const id = fileIdOf?.(r);
      if (!id || !files.has(id)) return false;
    }
    return true;
  });
  if (f.newest === null) return kept;
  return kept
    .map((record, index) => ({ record, index, day: submittedDay(record) }))
    .sort((a, b) => (a.day === b.day ? a.index - b.index : a.day === null ? 1 : b.day === null ? -1 : a.day < b.day ? 1 : -1))
    .slice(0, f.newest)
    .map((x) => x.record);
}

const STATUS_WORD: Record<CaseStatus, string> = { resolved: 'Resolved', in_progress: 'In progress', pending: 'Pending', unknown: 'Status not recorded' };

/** One line describing the restriction, shown in the report ("Scope: …"). */
export function describeSummaryFilter(f: SummaryFilter, fileNameOf?: (fileId: string) => string | undefined): string {
  const parts: string[] = [];
  if (f.categories.length) parts.push('Categories: ' + f.categories.join(', '));
  if (f.response === 'provided') parts.push('Only complaints with a recorded response');
  if (f.response === 'missing') parts.push('Only complaints with no recorded response');
  if (f.statuses.length) parts.push('Status: ' + f.statuses.map((s) => STATUS_WORD[s]).join(', '));
  if (hasDateRange(f)) parts.push(describeDateRange(f.dateFrom, f.dateTo).replace(/^submitted/, 'Submitted'));
  if (f.fileIds.length) parts.push('Files: ' + f.fileIds.map((id) => fileNameOf?.(id) ?? id).join(', '));
  if (f.newest !== null) parts.push('Newest ' + f.newest);
  return parts.length ? parts.join(' · ') : 'All complaints';
}

/** Stable key: changes exactly when the selection changes (used to mark a generated report as out of date). */
export function summaryFilterKey(f: SummaryFilter): string {
  return JSON.stringify({ ...f, categories: [...f.categories].sort(), statuses: [...f.statuses].sort(), fileIds: [...f.fileIds].sort() });
}

/** Complaints per category among the complaints that pass every OTHER part of the filter (so counts stay useful while narrowing). */
export function categoryFacets(records: readonly GrievanceRecord[], f: SummaryFilter, fileIdOf?: (record: GrievanceRecord) => string | undefined): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of applySummaryFilter(records, { ...f, categories: [], newest: null }, fileIdOf)) {
    const name = categoryOf(r);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // Keep categories the user has already ticked visible even if the other filters now leave them at zero.
  for (const name of f.categories) if (!counts.has(name)) counts.set(name, 0);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === 'Uncategorized' ? 1 : b.name === 'Uncategorized' ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}
