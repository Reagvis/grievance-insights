import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createExpandedDataset, createSampleDataset } from '../data/demoGrievances';
import { hasResponse, type GrievanceRecord } from '../domain/grievance';
import { buildConsolidatedSummary } from '../services/localDemoSummaryService';
import { buildDashboard, RECENT_LIMIT } from '../utils/dashboard';
import { buildNoteText, buildRecordsZip } from '../utils/downloads';
import { buildHash, parseHash } from '../utils/route';
import { DEFAULT_FILTERS, describeFilters, filterRecords, filtersKey, isFiltered, submittedDay } from '../utils/recordSearch';
import { buildSummaryMarkdown } from '../utils/summaryExport';
import { PAGE_SIZE } from '../components/RecordExplorer';

const sample = createSampleDataset();
const big = createExpandedDataset();

describe('dashboard figures (D1-D7)', () => {
  it('seeds at least 1,500 records and the KPI figures reconcile with the dataset', () => {
    expect(big.records.length).toBeGreaterThanOrEqual(1500);
    const d = buildDashboard(big.records, '', '');
    expect(d.stats.total).toBe(big.records.length);
    expect(d.stats.withResponse + d.stats.missingResponse).toBe(d.stats.total);
    expect(d.stats.withResponse).toBe(big.records.filter(hasResponse).length);
    expect(d.categories.reduce((a, c) => a + c.count, 0)).toBe(d.stats.total);
    expect(d.categories.reduce((a, c) => a + c.withResponse, 0)).toBe(d.stats.withResponse);
  });

  it('reports known categories without counting Uncategorized as a category', () => {
    const records: GrievanceRecord[] = [
      { ...sample.records[0], id: 'A', category: 'Roads' },
      { ...sample.records[0], id: 'B', category: null },
      { ...sample.records[0], id: 'C', category: '  ' },
    ];
    const d = buildDashboard(records, '', '');
    expect(d.knownCategories).toBe(1);
    expect(d.uncategorized).toBe(2);
    expect(d.categories.map((c) => c.name)).toContain('Uncategorized');
  });

  it('date range narrows every dashboard figure consistently and excludes undated records', () => {
    const from = '2026-03-01';
    const to = '2026-03-31';
    const d = buildDashboard(big.records, from, to);
    const expected = big.records.filter((r) => {
      const day = submittedDay(r);
      return day !== null && day >= from && day <= to;
    });
    expect(d.stats.total).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(big.records.length);
    expect(d.categories.reduce((a, c) => a + c.count, 0)).toBe(expected.length);
    expect(d.recent.every((r) => expected.includes(r))).toBe(true);
    expect(d.undatedExcluded).toBe(big.records.filter((r) => submittedDay(r) === null).length);
  });

  it('shows recent complaints newest first, capped', () => {
    const d = buildDashboard(big.records, '', '');
    expect(d.recent).toHaveLength(RECENT_LIMIT);
    const days = d.recent.map((r) => submittedDay(r)!);
    expect([...days].sort().reverse()).toEqual(days);
  });

  it('an empty dataset yields zeros, not placeholder figures', () => {
    const d = buildDashboard([], '', '');
    expect(d.stats.total).toBe(0);
    expect(d.knownCategories).toBe(0);
    expect(d.categories).toEqual([]);
    expect(d.recent).toEqual([]);
  });
});

describe('explorer date filter and pagination (E2, E3)', () => {
  it('combines a date range with other filters and never returns out-of-scope records', () => {
    const f = { ...DEFAULT_FILTERS, category: 'Healthcare', response: 'missing' as const, dateFrom: '2026-02-01', dateTo: '2026-05-31' };
    const hits = filterRecords(big.records, f);
    expect(hits.length).toBeGreaterThan(0);
    for (const r of hits) {
      expect(r.category).toBe('Healthcare');
      expect(hasResponse(r)).toBe(false);
      const day = submittedDay(r)!;
      expect(day >= '2026-02-01' && day <= '2026-05-31').toBe(true);
    }
    expect(isFiltered(f)).toBe(true);
    expect(describeFilters(f)).toContain('submitted 2026-02-01 to 2026-05-31');
    expect(filtersKey(f)).not.toBe(filtersKey({ ...f, dateTo: '2026-06-01' }));
  });

  it('supports open-ended ranges and treats undated records as outside any active range', () => {
    const after = filterRecords(big.records, { ...DEFAULT_FILTERS, dateFrom: '2026-10-01' });
    expect(after.every((r) => (submittedDay(r) ?? '') >= '2026-10-01')).toBe(true);
    expect(filterRecords(big.records, DEFAULT_FILTERS)).toHaveLength(big.records.length);
  });

  it('pages 2,000 records into PAGE_SIZE slices covering each record exactly once', () => {
    const pages = Math.ceil(big.records.length / PAGE_SIZE);
    const seen = new Set<string>();
    for (let p = 0; p < pages; p++) for (const r of big.records.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)) seen.add(r.id);
    expect(seen.size).toBe(big.records.length);
  });

  it('finds Telugu text across the large dataset', () => {
    const hits = filterRecords(big.records, { ...DEFAULT_FILTERS, query: 'తాగునీటి' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(big.records.length);
  });
});

describe('downloads at scale (E5, E6)', () => {
  it('download-all contains every record, including ones far outside the first page', () => {
    const zip = unzipSync(buildRecordsZip(big, big.records, 'All records in the dataset'));
    const txt = Object.keys(zip).filter((n) => n.includes('/notes/') && n.endsWith('.txt'));
    expect(txt).toHaveLength(big.records.length);
    const last = big.records[big.records.length - 1];
    const entry = txt.find((n) => n.includes(last.id));
    expect(entry).toBeTruthy();
    expect(strFromU8(zip[entry!])).toContain(last.complaintText);
  });

  it('a single note contains exactly that note, Telugu intact', () => {
    const r = big.records[1234];
    const text = buildNoteText(r, big.name);
    expect(text).toContain(r.id);
    expect(text).toContain(r.complaintText);
    if (r.responseText) expect(text).toContain(r.responseText);
    const other = big.records[1235];
    if (other.id !== r.id) expect(text).not.toContain(other.id);
  });
});

describe('consolidated summary (S1-S4)', () => {
  it('summary of all records covers the full collection and its Markdown matches the counts', async () => {
    const summary = await buildConsolidatedSummary(big.records, {
      scope: 'all',
      scopeDescription: 'no filters',
      reportLanguage: 'en',
      datasetName: big.name,
      isSyntheticData: true,
    });
    expect(summary.totalRecords).toBe(big.records.length);
    const md = buildSummaryMarkdown(summary);
    expect(md).toContain(String(big.records.length.toLocaleString('en-IN')));
    expect(md.toLowerCase()).toMatch(/demo|not ai/);
  });

  it('a date-range filtered summary covers only the explicit subset', async () => {
    const subset = filterRecords(big.records, { ...DEFAULT_FILTERS, dateFrom: '2026-03-01', dateTo: '2026-03-31' });
    const summary = await buildConsolidatedSummary(subset, {
      scope: 'filtered',
      scopeDescription: describeFilters({ ...DEFAULT_FILTERS, dateFrom: '2026-03-01', dateTo: '2026-03-31' }),
      reportLanguage: 'en',
      datasetName: big.name,
      isSyntheticData: true,
    });
    expect(summary.totalRecords).toBe(subset.length);
    expect(summary.totalRecords).toBeLessThan(big.records.length);
  });

  it('never counts a recorded response as resolved', () => {
    const d = buildDashboard(big.records, '', '');
    expect(d.stats.byStatus.resolved).toBeLessThan(d.stats.withResponse);
    expect(big.records.filter((r) => r.status === 'resolved').every(hasResponse)).toBe(true);
  });
});

describe('hash routing (stable note links)', () => {
  it('round-trips page and note id', () => {
    expect(parseHash('#/complaints?id=GRV-000123')).toEqual({ page: 'complaints', noteId: 'GRV-000123' });
    expect(buildHash({ page: 'summary', noteId: null })).toBe('#/summary');
    expect(parseHash(buildHash({ page: 'dashboard', noteId: 'GRV 1&2' }))).toEqual({ page: 'dashboard', noteId: 'GRV 1&2' });
  });
  it('falls back to the dashboard for empty or unknown hashes', () => {
    expect(parseHash('')).toEqual({ page: 'dashboard', noteId: null });
    expect(parseHash('#/nope')).toEqual({ page: 'dashboard', noteId: null });
  });
});
