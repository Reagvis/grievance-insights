import { categoryOf, computeStats, hasResponse, UNCATEGORIZED, type GrievanceRecord } from '../domain/grievance';
import type {
  CategoryMetric,
  ConsolidatedSummary,
  ReportedAction,
  ReportLanguage,
  SummaryOptions,
  SummaryService,
} from '../domain/summary';
import { formatCount, formatDate, formatPercent, percentOf, pluralize } from '../utils/format';

/**
 * LOCAL DEMONSTRATION SUMMARIZER — deterministic aggregation, not AI.
 *
 * Every sentence it writes is a template filled with counts computed from structured
 * fields (category, issue type, status, response presence, dates). It never reads
 * meaning into Telugu free text, never classifies sentiment, and never treats a
 * response as a resolution.
 */

export class EmptyScopeError extends Error {
  constructor() {
    super('There are no records in the selected scope to summarise.');
    this.name = 'EmptyScopeError';
  }
}

export type BuildOptions = SummaryOptions;

const MAX_CATEGORIES_IN_THEMES = 5;
const EXAMPLES_PER_CATEGORY = 3;
const MAX_EXCERPTS = 3;

const have = (n: number) => (n === 1 ? 'has' : 'have');
const are = (n: number) => (n === 1 ? 'is' : 'are');

function listWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function buildCategoryMetrics(records: readonly GrievanceRecord[]): CategoryMetric[] {
  const total = records.length;
  const groups = new Map<string, GrievanceRecord[]>();
  for (const r of records) {
    const c = categoryOf(r);
    const list = groups.get(c);
    if (list) list.push(r);
    else groups.set(c, [r]);
  }

  const metrics: CategoryMetric[] = [];
  for (const [category, list] of groups) {
    const issueCounts = new Map<string, number>();
    for (const r of list) {
      const it = r.issueType?.trim();
      if (it) issueCounts.set(it, (issueCounts.get(it) ?? 0) + 1);
    }
    const sortedIds = list.map((r) => r.id).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    metrics.push({
      category,
      count: list.length,
      percentage: percentOf(list.length, total),
      withResponse: list.filter(hasResponse).length,
      resolved: list.filter((r) => r.status === 'resolved').length,
      topIssueTypes: [...issueCounts.entries()]
        .map(([issueType, count]) => ({ issueType, count }))
        .sort((a, b) => b.count - a.count || a.issueType.localeCompare(b.issueType))
        .slice(0, 3),
      exampleCaseIds: sortedIds.slice(0, EXAMPLES_PER_CATEGORY),
    });
  }

  // Highest volume first; "Uncategorized" sorts after any category with the same count.
  return metrics.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.category === UNCATEGORIZED) return 1;
    if (b.category === UNCATEGORIZED) return -1;
    return a.category.localeCompare(b.category);
  });
}

export function buildConsolidatedSummary(
  records: readonly GrievanceRecord[],
  options: BuildOptions,
  now: Date = new Date(),
): ConsolidatedSummary {
  if (records.length === 0) throw new EmptyScopeError();

  const stats = computeStats(records);
  const t = stats.total;
  const { resolved, pending, in_progress: inProgress, unknown } = stats.byStatus;
  const categories = buildCategoryMetrics(records);
  const named = categories.filter((c) => c.category !== UNCATEGORIZED);
  const pct = (n: number) => formatPercent(percentOf(n, t));
  const from = stats.dateSpan ? formatDate(stats.dateSpan.from) : null;
  const to = stats.dateSpan ? formatDate(stats.dateSpan.to) : null;

  // ── Executive overview (2–4 sentences, facts only) ──────────────────────
  const overview: string[] = [];
  let coverage = `This report covers ${pluralize(t, 'complaint record')}`;
  if (from && to) coverage += from === to ? ` submitted on ${from}` : ` submitted between ${from} and ${to}`;
  if (stats.missingDate > 0 && from) coverage += ` (${formatCount(stats.missingDate)} undated)`;
  overview.push(`${coverage}.`);

  const top = named.slice(0, 3).map((c) => `${c.category} (${formatPercent(c.percentage)})`);
  if (named.length === 1) overview.push(`All categorised complaints fall under ${named[0].category}.`);
  else if (top.length > 1) overview.push(`The largest categories are ${listWithAnd(top)}.`);
  else if (named.length === 0) overview.push('No complaint in this scope has a category recorded.');

  const resolvedPhrase =
    resolved === 0
      ? 'none are explicitly marked resolved'
      : `${formatCount(resolved)} (${pct(resolved)}) ${are(resolved)} explicitly marked resolved`;
  overview.push(
    `A department response is recorded for ${formatCount(stats.withResponse)} (${pct(stats.withResponse)}), but ${resolvedPhrase}; ${formatCount(unknown)} ${have(unknown)} no recorded outcome.`,
  );
  if (options.isSyntheticData) overview.push('All figures come from synthetic demonstration records.');
  else if (stats.missingResponse > 0)
    overview.push(`${pluralize(stats.missingResponse, 'complaint')} ${have(stats.missingResponse)} no response text in the source.`);

  // ── Themes: structured fields only ───────────────────────────────────────
  const themeSource = named.length > 0 ? named : categories;
  const themes = themeSource.slice(0, MAX_CATEGORIES_IN_THEMES).map((c) => {
    const issues = c.topIssueTypes.map((i) => `${i.issueType} (${formatCount(i.count)})`);
    const issueText = issues.length ? `Top issue types: ${issues.join(', ')}.` : 'Issue types are not recorded for this category.';
    const outcome = `Responses ${formatCount(c.withResponse)} of ${formatCount(c.count)}; explicitly resolved ${formatCount(c.resolved)}.`;
    return {
      title: `${c.category} · ${pluralize(c.count, 'case')} (${formatPercent(c.percentage)})`,
      detail: `${issueText} ${outcome}`,
      caseIds: c.exampleCaseIds,
    };
  });
  const uncategorized = categories.find((c) => c.category === UNCATEGORIZED);
  if (uncategorized && named.length > 0) {
    themes.push({
      title: `${UNCATEGORIZED} · ${pluralize(uncategorized.count, 'case')} (${formatPercent(uncategorized.percentage)})`,
      detail: 'No category is recorded in the source; these complaints need manual classification before they can be grouped.',
      caseIds: uncategorized.exampleCaseIds,
    });
  }

  // ── Responses / actions: conservative facts + verbatim excerpts ─────────
  const respondedNotResolved = records.filter((r) => hasResponse(r) && r.status !== 'resolved').length;
  const reportedActions: ReportedAction[] = [
    {
      kind: 'fact',
      text: `Responses are recorded for ${formatCount(stats.withResponse)} of ${formatCount(t)} complaints (${pct(stats.withResponse)}); ${formatCount(stats.missingResponse)} have no response text.`,
      caseIds: [],
    },
    {
      kind: 'fact',
      text: `${pluralize(respondedNotResolved, 'responded complaint')} ${are(respondedNotResolved)} not marked resolved. A response records a reply, referral or proposed step — it does not confirm the issue was fixed.`,
      caseIds: [],
    },
  ];
  const usedCategories = new Set<string>();
  for (const c of categories) {
    if (reportedActions.filter((a) => a.kind === 'excerpt').length >= MAX_EXCERPTS) break;
    if (usedCategories.has(c.category)) continue;
    const sample = records
      .filter((r) => categoryOf(r) === c.category && hasResponse(r))
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))[0];
    if (sample?.responseText) {
      usedCategories.add(c.category);
      reportedActions.push({ kind: 'excerpt', text: sample.responseText.trim(), caseIds: [sample.id], category: c.category });
    }
  }

  // ── Priority observations (observations, not conclusions) ───────────────
  const priorityObservations: string[] = [];
  if (named.length > 0) {
    const maxCount = named[0].count;
    const leaders = named.filter((c) => c.count === maxCount).map((c) => c.category);
    priorityObservations.push(
      leaders.length === 1
        ? `${leaders[0]} has the highest volume: ${pluralize(maxCount, 'complaint')} (${formatPercent(named[0].percentage)} of this report).`
        : `${listWithAnd(leaders)} share the highest volume, with ${pluralize(maxCount, 'complaint')} each.`,
    );
  }
  // Missing-response hotspot — only named when one category clearly leads; ties are reported as ties.
  const missingByCategory = categories
    .map((c) => ({ category: c.category, missing: c.count - c.withResponse, count: c.count }))
    .filter((c) => c.missing > 0);
  if (missingByCategory.length > 0) {
    const maxMissing = Math.max(...missingByCategory.map((c) => c.missing));
    const leaders = missingByCategory.filter((c) => c.missing === maxMissing).sort((a, b) => a.category.localeCompare(b.category));
    if (leaders.length === 1) {
      const m = leaders[0];
      priorityObservations.push(
        `${m.category} has the most complaints without a recorded response (${formatCount(m.missing)} of ${formatCount(m.count)}).`,
      );
    } else if (leaders.length <= 3) {
      priorityObservations.push(
        `${listWithAnd(leaders.map((l) => l.category))} each have ${pluralize(maxMissing, 'complaint')} without a recorded response.`,
      );
    } else {
      priorityObservations.push(
        `Complaints without a recorded response are spread across ${formatCount(missingByCategory.length)} categories, with no more than ${formatCount(maxMissing)} in any one.`,
      );
    }
  }
  if (pending + inProgress > 0) {
    priorityObservations.push(
      `${pluralize(pending + inProgress, 'complaint')} (${pct(pending + inProgress)}) ${are(pending + inProgress)} recorded as pending or in progress and may need follow-up verification.`,
    );
  }
  if (unknown > 0) {
    priorityObservations.push(
      `${pluralize(unknown, 'complaint')} (${pct(unknown)}) ${have(unknown)} no recorded outcome, so resolution cannot be confirmed from the data.`,
    );
  }
  const minSize = Math.max(3, Math.ceil(t * 0.05));
  const sizable = named.filter((c) => c.count >= minSize).map((c) => ({ ...c, share: c.resolved / c.count }));
  if (sizable.length > 1) {
    const minShare = Math.min(...sizable.map((c) => c.share));
    const lowest = sizable.filter((c) => c.share === minShare);
    if (minShare < resolved / t && lowest.length <= 2) {
      const detail = lowest.map((c) => `${c.category} (${formatCount(c.resolved)} of ${formatCount(c.count)})`);
      priorityObservations.push(
        `Among categories with at least ${minSize} complaints, the lowest explicitly-resolved share is in ${listWithAnd(detail)}.`,
      );
    }
  }

  // ── Data quality & limitations ───────────────────────────────────────────
  const limitations: string[] = [];
  if (options.isSyntheticData) limitations.push('All records are synthetic demonstration data. Figures do not describe real CM Helpline activity.');
  if (options.datasetNotes) limitations.push(...options.datasetNotes);
  if (options.scope === 'filtered')
    limitations.push(`This report covers a filtered subset (${options.scopeDescription}) and does not represent the whole dataset.`);
  if (unknown > 0)
    limitations.push(`${formatCount(unknown)} of ${pluralize(t, 'record')} (${pct(unknown)}) ${have(unknown)} no outcome status recorded.`);
  if (stats.missingResponse > 0)
    limitations.push(`${pluralize(stats.missingResponse, 'record')} ${have(stats.missingResponse)} no response text in the source.`);
  if (stats.missingDate > 0)
    limitations.push(
      `${pluralize(stats.missingDate, 'record')} ${have(stats.missingDate)} no valid submission date; the date span covers dated records only.`,
    );
  if (stats.uncategorized > 0) limitations.push(`${pluralize(stats.uncategorized, 'record')} ${have(stats.uncategorized)} no category recorded.`);
  limitations.push(
    'Method: themes use structured fields (category, issue type, status) only; complaint and response text was not analysed or translated. Percentages are rounded to one decimal place.',
  );

  return {
    title: 'Consolidated Grievance Summary',
    datasetName: options.datasetName,
    scope: options.scope,
    scopeDescription: options.scope === 'all' ? 'All records in the dataset' : `Filtered records (${options.scopeDescription})`,
    includedRecordIds: records.map((r) => r.id),
    generatedAt: now.toISOString(),
    processingMode: 'demo-local',
    reportLanguage: options.reportLanguage,
    isSyntheticData: options.isSyntheticData,
    totalRecords: t,
    withResponseCount: stats.withResponse,
    resolvedCount: resolved,
    pendingCount: pending,
    inProgressCount: inProgress,
    unknownStatusCount: unknown,
    missingResponseCount: stats.missingResponse,
    missingDateCount: stats.missingDate,
    uncategorizedCount: stats.uncategorized,
    dateSpan: stats.dateSpan,
    categories,
    executiveOverview: overview.join(' '),
    themes,
    reportedActions,
    priorityObservations,
    limitations,
  };
}

export class LocalDemoSummaryService implements SummaryService {
  readonly mode = 'demo-local' as const;
  /** Report templates exist in English only; Telugu templates are a planned capability. */
  readonly supportedLanguages: readonly ReportLanguage[] = ['en'];

  async generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary> {
    if (!this.supportedLanguages.includes(options.reportLanguage)) {
      throw new Error(`Report language "${options.reportLanguage}" is not supported by the local demo summarizer.`);
    }
    return buildConsolidatedSummary(records, options);
  }
}
