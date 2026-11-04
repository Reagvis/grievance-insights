import { categoryOf, hasResponse, type CaseStatus, type GrievanceRecord } from '../domain/grievance';

export type ResponseFilter = 'all' | 'provided' | 'missing';

export type RecordFilters = {
  query: string;
  /** 'all', a category name, or UNCATEGORIZED. */
  category: string;
  status: CaseStatus | 'all';
  response: ResponseFilter;
};

export const DEFAULT_FILTERS: RecordFilters = { query: '', category: 'all', status: 'all', response: 'all' };

/** Unicode-safe normalisation: NFC (so composed/decomposed Telugu match) + case folding for Latin. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

const haystackCache = new WeakMap<GrievanceRecord, string>();

function haystack(record: GrievanceRecord): string {
  let h = haystackCache.get(record);
  if (h === undefined) {
    h = normalizeForSearch(
      [
        record.id,
        record.complaintText,
        record.responseText ?? '',
        record.category ?? '',
        record.issueType ?? '',
        record.department ?? '',
        record.district ?? '',
      ].join(' \u0000 '),
    );
    haystackCache.set(record, h);
  }
  return h;
}

export function matchesQuery(record: GrievanceRecord, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const h = haystack(record);
  // Every whitespace-separated term must appear (AND search).
  return q.split(' ').every((term) => h.includes(term));
}

export function filterRecords(records: readonly GrievanceRecord[], filters: RecordFilters): GrievanceRecord[] {
  const q = normalizeForSearch(filters.query);
  return records.filter((r) => {
    if (filters.category !== 'all' && categoryOf(r) !== filters.category) return false;
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.response === 'provided' && !hasResponse(r)) return false;
    if (filters.response === 'missing' && hasResponse(r)) return false;
    if (q && !matchesQuery(r, q)) return false;
    return true;
  });
}

export function isFiltered(filters: RecordFilters): boolean {
  return (
    normalizeForSearch(filters.query) !== '' ||
    filters.category !== 'all' ||
    filters.status !== 'all' ||
    filters.response !== 'all'
  );
}

/** Stable key used to detect when a filtered-scope summary has gone stale. */
export function filtersKey(filters: RecordFilters): string {
  return JSON.stringify([normalizeForSearch(filters.query), filters.category, filters.status, filters.response]);
}

const STATUS_TEXT: Record<CaseStatus, string> = {
  resolved: 'Resolved',
  in_progress: 'In progress',
  pending: 'Pending',
  unknown: 'Status not recorded',
};

/** Plain-English description of active filters, used in report coverage metadata. */
export function describeFilters(filters: RecordFilters): string {
  const parts: string[] = [];
  const q = filters.query.trim();
  if (q) parts.push(`search "${q}"`);
  if (filters.category !== 'all') parts.push(`category: ${filters.category}`);
  if (filters.status !== 'all') parts.push(`status: ${STATUS_TEXT[filters.status]}`);
  if (filters.response === 'provided') parts.push('response recorded');
  if (filters.response === 'missing') parts.push('no response recorded');
  return parts.length ? parts.join('; ') : 'no filters';
}

/** Distinct category values present in a record set, most frequent first. */
export function listCategories(records: readonly GrievanceRecord[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const c = categoryOf(r);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
