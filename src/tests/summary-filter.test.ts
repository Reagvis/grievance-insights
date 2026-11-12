import { describe, expect, it } from 'vitest';
import type { CaseStatus, GrievanceRecord } from '../domain/grievance';
import { applySummaryFilter, categoryFacets, describeSummaryFilter, isSummaryFiltered, NO_SUMMARY_FILTER, summaryFilterKey, type SummaryFilter } from '../utils/summaryFilter';

const rec = (id: string, category: string | null, o: Partial<{ response: string | null; status: CaseStatus; day: string | null }> = {}): GrievanceRecord => ({
  id, complaintText: 'complaint ' + id, responseText: o.response ?? null, language: 'en', category, issueType: null, department: null, district: null,
  submittedAt: o.day === undefined ? null : o.day, respondedAt: null, status: o.status ?? 'unknown', sourceType: 'csv', isSyntheticDemo: false,
});
const data = [
  rec('R1', 'Roads', { response: 'fixed', status: 'resolved', day: '2026-03-01' }),
  rec('R2', 'Roads', { day: '2026-03-20' }),
  rec('W1', 'Water supply', { response: 'looking', status: 'pending', day: '2026-02-10' }),
  rec('W2', 'Water supply', { day: '2026-03-25' }),
  rec('P1', 'Pension', { response: 'paid', status: 'resolved', day: null }),
  rec('U1', null, { day: '2026-01-05' }),
];
const ids = (list: GrievanceRecord[]) => list.map((r) => r.id);
const f = (patch: Partial<SummaryFilter>): SummaryFilter => ({ ...NO_SUMMARY_FILTER, ...patch });

describe('summary filter', () => {
  it('no restriction includes everything, in the original order', () => {
    expect(ids(applySummaryFilter(data, NO_SUMMARY_FILTER))).toEqual(['R1', 'R2', 'W1', 'W2', 'P1', 'U1']);
    expect(isSummaryFiltered(NO_SUMMARY_FILTER)).toBe(false);
  });
  it('category: one, several, and Uncategorized', () => {
    expect(ids(applySummaryFilter(data, f({ categories: ['Roads'] })))).toEqual(['R1', 'R2']);
    expect(ids(applySummaryFilter(data, f({ categories: ['Roads', 'Pension'] })))).toEqual(['R1', 'R2', 'P1']);
    expect(ids(applySummaryFilter(data, f({ categories: ['Uncategorized'] })))).toEqual(['U1']);
  });
  it('response and status', () => {
    expect(ids(applySummaryFilter(data, f({ response: 'provided' })))).toEqual(['R1', 'W1', 'P1']);
    expect(ids(applySummaryFilter(data, f({ response: 'missing' })))).toEqual(['R2', 'W2', 'U1']);
    expect(ids(applySummaryFilter(data, f({ statuses: ['resolved'] })))).toEqual(['R1', 'P1']);
    expect(ids(applySummaryFilter(data, f({ statuses: ['pending', 'unknown'] })))).toEqual(['R2', 'W1', 'W2', 'U1']);
  });
  it('date range is inclusive and never matches complaints without a date', () => {
    expect(ids(applySummaryFilter(data, f({ dateFrom: '2026-03-01', dateTo: '2026-03-20' })))).toEqual(['R1', 'R2']);
    expect(ids(applySummaryFilter(data, f({ dateFrom: '2026-03-01' })))).toEqual(['R1', 'R2', 'W2']);
    expect(ids(applySummaryFilter(data, f({ dateTo: '2026-02-28' })))).toEqual(['W1', 'U1']);
  });
  it('filters combine (all must match)', () => {
    expect(ids(applySummaryFilter(data, f({ categories: ['Roads', 'Water supply'], response: 'missing', dateFrom: '2026-03-10' })))).toEqual(['R2', 'W2']);
    expect(applySummaryFilter(data, f({ categories: ['Pension'], response: 'missing' }))).toEqual([]);
  });
  it('source file selection uses the supplied lookup, and excludes records with no known file', () => {
    const fileOf = (r: GrievanceRecord) => ({ R1: 'a', R2: 'a', W1: 'b' } as Record<string, string>)[r.id];
    expect(ids(applySummaryFilter(data, f({ fileIds: ['a'] }), fileOf))).toEqual(['R1', 'R2']);
    expect(ids(applySummaryFilter(data, f({ fileIds: ['a', 'b'] }), fileOf))).toEqual(['R1', 'R2', 'W1']);
  });
  it('newest N orders by date (undated last) after the other filters', () => {
    expect(ids(applySummaryFilter(data, f({ newest: 2 })))).toEqual(['W2', 'R2']);
    expect(ids(applySummaryFilter(data, f({ newest: 100 })))).toEqual(['W2', 'R2', 'R1', 'W1', 'U1', 'P1']);
    expect(ids(applySummaryFilter(data, f({ categories: ['Water supply'], newest: 1 })))).toEqual(['W2']);
  });
  it('describes the restriction in plain words, and a stable key changes only when the selection does', () => {
    expect(describeSummaryFilter(NO_SUMMARY_FILTER)).toBe('All complaints');
    const d = describeSummaryFilter(f({ categories: ['Roads', 'Pension'], response: 'missing', newest: 25, fileIds: ['a'] }), (id) => (id === 'a' ? 'jan.csv' : undefined));
    expect(d).toBe('Categories: Roads, Pension · Only complaints with no recorded response · Files: jan.csv · Newest 25');
    expect(summaryFilterKey(f({ categories: ['B', 'A'] }))).toBe(summaryFilterKey(f({ categories: ['A', 'B'] })));
    expect(summaryFilterKey(f({ categories: ['A'] }))).not.toBe(summaryFilterKey(NO_SUMMARY_FILTER));
  });
  it('category counts narrow with the other filters but ignore the category choice itself', () => {
    expect(categoryFacets(data, NO_SUMMARY_FILTER)).toEqual([
      { name: 'Roads', count: 2 }, { name: 'Water supply', count: 2 }, { name: 'Pension', count: 1 }, { name: 'Uncategorized', count: 1 },
    ]);
    // Only complaints with a response: Roads 1, Water 1, Pension 1. Ticking Roads must not hide the other categories.
    expect(categoryFacets(data, f({ response: 'provided', categories: ['Roads'] }))).toEqual([
      { name: 'Pension', count: 1 }, { name: 'Roads', count: 1 }, { name: 'Water supply', count: 1 },
    ]);
    // A ticked category stays listed even when the other filters leave it empty.
    expect(categoryFacets(data, f({ categories: ['Roads'], dateFrom: '2026-04-01' }))).toContainEqual({ name: 'Roads', count: 0 });
  });
});
