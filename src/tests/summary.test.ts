import { describe, expect, it } from 'vitest';
import { createExpandedDataset, createSampleDataset, DEMO_GRIEVANCES } from '../data/demoGrievances';
import { computeStats, normalizeStatus, type GrievanceRecord } from '../domain/grievance';
import { buildConsolidatedSummary, EmptyScopeError, LocalDemoSummaryService } from '../services/localDemoSummaryService';
import { DEFAULT_FILTERS, filterRecords } from '../utils/recordSearch';

const base = (over: Partial<GrievanceRecord>): GrievanceRecord => ({
  id: 'GRV-1',
  complaintText: 'పరీక్ష ఫిర్యాదు',
  responseText: null,
  language: 'te',
  category: null,
  issueType: null,
  department: null,
  district: null,
  submittedAt: null,
  respondedAt: null,
  status: 'unknown',
  sourceType: 'json',
  isSyntheticDemo: false,
  ...over,
});

const opts = { scope: 'all' as const, scopeDescription: 'no filters', reportLanguage: 'en' as const, datasetName: 'Test', isSyntheticData: false };

describe('sample dataset', () => {
  it('has 30 curated, uniquely identified, synthetic records', () => {
    expect(DEMO_GRIEVANCES).toHaveLength(30);
    expect(new Set(DEMO_GRIEVANCES.map((r) => r.id)).size).toBe(30);
    expect(DEMO_GRIEVANCES.every((r) => r.isSyntheticDemo)).toBe(true);
  });

  it('expansion is deterministic and 2,000 records long', () => {
    const a = createExpandedDataset();
    const b = createExpandedDataset();
    expect(a.records).toHaveLength(2000);
    expect(a.records.map((r) => r.status)).toEqual(b.records.map((r) => r.status));
    expect(new Set(a.records.map((r) => r.id)).size).toBe(2000);
  });
});

describe('status handling', () => {
  it('maps missing and unrecognised statuses to unknown, never resolved', () => {
    expect(normalizeStatus(undefined).status).toBe('unknown');
    expect(normalizeStatus('').status).toBe('unknown');
    expect(normalizeStatus('closed')).toEqual({ status: 'unknown', recognised: false });
    expect(normalizeStatus('Done').status).toBe('unknown');
    expect(normalizeStatus('In Progress').status).toBe('in_progress');
    expect(normalizeStatus('RESOLVED').status).toBe('resolved');
  });
});

describe('consolidated summary', () => {
  it('does not treat a response as a resolution', () => {
    const recs = [
      base({ id: 'A', responseText: 'స్పందన ఇచ్చాము', status: 'unknown', category: 'Roads' }),
      base({ id: 'B', responseText: 'పని పూర్తయింది', status: 'pending', category: 'Roads' }),
      base({ id: 'C', responseText: null, status: 'unknown', category: 'Water supply' }),
    ];
    const s = buildConsolidatedSummary(recs, opts);
    expect(s.withResponseCount).toBe(2);
    expect(s.resolvedCount).toBe(0);
    expect(s.unknownStatusCount).toBe(2);
    expect(s.missingResponseCount).toBe(1);
    expect(s.executiveOverview).toContain('none are explicitly marked resolved');
  });

  it('treats blank response text as missing', () => {
    const s = buildConsolidatedSummary([base({ id: 'A', responseText: '   ' })], opts);
    expect(s.withResponseCount).toBe(0);
    expect(s.missingResponseCount).toBe(1);
  });

  it('groups missing categories as Uncategorized and computes percentages from included records', () => {
    const recs = [
      base({ id: '1', category: 'Healthcare' }),
      base({ id: '2', category: 'Healthcare' }),
      base({ id: '3', category: 'Roads' }),
      base({ id: '4', category: '  ' }),
    ];
    const s = buildConsolidatedSummary(recs, opts);
    expect(s.categories.map((c) => [c.category, c.count, c.percentage])).toEqual([
      ['Healthcare', 2, 50],
      ['Roads', 1, 25],
      ['Uncategorized', 1, 25],
    ]);
    expect(s.uncategorizedCount).toBe(1);
  });

  it('matches the curated sample counts exactly', () => {
    const ds = createSampleDataset();
    const s = buildConsolidatedSummary(ds.records, { ...opts, isSyntheticData: true });
    expect(s.totalRecords).toBe(30);
    expect(s.resolvedCount).toBe(7);
    expect(s.inProgressCount).toBe(7);
    expect(s.pendingCount).toBe(7);
    expect(s.unknownStatusCount).toBe(9);
    expect(s.missingResponseCount).toBe(6);
    expect(s.missingDateCount).toBe(2);
    expect(s.categories[0]).toMatchObject({ category: 'Healthcare', count: 5, percentage: 16.7 });
    expect(s.limitations[0]).toMatch(/synthetic/i);
    // every cited case ID belongs to the included set
    const included = new Set(s.includedRecordIds);
    for (const id of s.categories.flatMap((c) => c.exampleCaseIds)) expect(included.has(id)).toBe(true);
    for (const id of s.reportedActions.flatMap((a) => a.caseIds)) expect(included.has(id)).toBe(true);
  });

  it('filtered scope reports only the filtered set', () => {
    const ds = createSampleDataset();
    const filtered = filterRecords(ds.records, { ...DEFAULT_FILTERS, category: 'Electricity' });
    const s = buildConsolidatedSummary(filtered, { ...opts, scope: 'filtered', scopeDescription: 'category: Electricity' });
    expect(s.totalRecords).toBe(4);
    expect(s.categories).toHaveLength(1);
    expect(s.categories[0].percentage).toBe(100);
    expect(s.includedRecordIds.every((id) => filtered.some((r) => r.id === id))).toBe(true);
    expect(s.scopeDescription).toContain('Filtered records');
    expect(s.limitations.some((l) => l.includes('filtered subset'))).toBe(true);
  });

  it('agrees with the shared stats helper', () => {
    const ds = createExpandedDataset();
    const stats = computeStats(ds.records);
    const s = buildConsolidatedSummary(ds.records, opts);
    expect(s.withResponseCount).toBe(stats.withResponse);
    expect(s.resolvedCount + s.pendingCount + s.inProgressCount + s.unknownStatusCount).toBe(2000);
    expect(s.categories.reduce((a, c) => a + c.count, 0)).toBe(2000);
  });

  it('reports ties honestly instead of naming one category as "the most"', () => {
    const recs = ['Roads', 'Water supply', 'Healthcare', 'Education'].flatMap((cat, i) => [
      base({ id: `${i}-a`, category: cat, responseText: null }),
      base({ id: `${i}-b`, category: cat, responseText: 'స్పందన' }),
    ]);
    const s = buildConsolidatedSummary(recs, opts);
    const obs = s.priorityObservations.join(' ');
    expect(obs).toContain('spread across 4 categories');
    expect(obs).not.toMatch(/has the most complaints without/);
    expect(obs).toContain('share the highest volume');
  });

  it('uses singular grammar for single counts', () => {
    const s = buildConsolidatedSummary([base({ id: 'A', category: null })], opts);
    expect(s.limitations.join(' ')).toContain('1 record has no category recorded');
    expect(s.limitations.join(' ')).not.toMatch(/\b1 records\b/);
  });

  it('refuses to fabricate a report for zero records', () => {
    expect(() => buildConsolidatedSummary([], opts)).toThrow(EmptyScopeError);
  });

  it('service rejects unsupported report languages honestly', async () => {
    const svc = new LocalDemoSummaryService();
    await expect(svc.generate([base({})], { ...opts, reportLanguage: 'te' })).rejects.toThrow(/not supported/);
  });

  it('does not show invalid dates', () => {
    const s = buildConsolidatedSummary([base({ submittedAt: 'not-a-date' })], opts);
    expect(s.dateSpan).toBeNull();
    expect(s.missingDateCount).toBe(1);
    expect(s.executiveOverview).not.toMatch(/Invalid/);
  });
});
