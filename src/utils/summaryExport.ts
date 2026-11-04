import type { ConsolidatedSummary } from '../domain/summary';
import { formatCount, formatDate, formatDateTime, formatPercent, localDateStamp, percentOf, truncateGraphemes } from './format';

const PROCESSING_LABEL: Record<ConsolidatedSummary['processingMode'], string> = {
  'demo-local': 'Demo · Local aggregation (not AI)',
  'browser-local': 'Browser · Deterministic aggregation (not AI)',
  'server-local': 'Local API · Deterministic aggregation (not AI)',
  'server-ai': 'Server AI summarization',
};

export function processingLabel(mode: ConsolidatedSummary['processingMode']): string {
  return PROCESSING_LABEL[mode];
}

export const DEMO_CAVEAT =
  'Demonstration report — local aggregation of synthetic records. This is not an official government report or a live AI analysis.';
export const LOCAL_CAVEAT =
  'Generated locally by deterministic aggregation of imported records. This is not an AI analysis and has not been reviewed.';

export function reportCaveat(s: ConsolidatedSummary): string {
  return s.isSyntheticData ? DEMO_CAVEAT : LOCAL_CAVEAT;
}

export function dateSpanText(s: ConsolidatedSummary): string {
  if (!s.dateSpan) return 'No valid dates recorded';
  const from = formatDate(s.dateSpan.from);
  const to = formatDate(s.dateSpan.to);
  if (!from || !to) return 'No valid dates recorded';
  return from === to ? from : `${from} – ${to}`;
}

/** UTF-8 Markdown version of the report (also used for "Copy summary"). */
export function buildSummaryMarkdown(s: ConsolidatedSummary): string {
  const out: string[] = [];
  const t = s.totalRecords;
  out.push(`# ${s.title}`);
  out.push('');
  out.push(`> ${reportCaveat(s)}`);
  out.push('');
  out.push('| Coverage | |');
  out.push('|---|---|');
  out.push(`| Dataset | ${s.datasetName} |`);
  out.push(`| Scope | ${s.scopeDescription} |`);
  out.push(`| Records included | ${formatCount(t)} |`);
  out.push(`| Submission dates | ${dateSpanText(s)} |`);
  out.push(`| Generated | ${formatDateTime(s.generatedAt) ?? s.generatedAt} |`);
  out.push(`| Report language | ${s.reportLanguage === 'en' ? 'English (source text quoted in original language)' : 'Telugu'} |`);
  out.push(`| Processing mode | ${processingLabel(s.processingMode)} |`);
  out.push('');
  out.push('## Executive overview');
  out.push('');
  out.push(s.executiveOverview);
  out.push('');
  out.push('## Major issue categories');
  out.push('');
  out.push('| Rank | Category | Cases | Share | Responses | Resolved | Example cases |');
  out.push('|---:|---|---:|---:|---:|---:|---|');
  s.categories.forEach((c, i) => {
    out.push(
      `| ${i + 1} | ${c.category} | ${formatCount(c.count)} | ${formatPercent(c.percentage)} | ${formatCount(c.withResponse)} | ${formatCount(c.resolved)} | ${c.exampleCaseIds.join(', ')} |`,
    );
  });
  out.push('');
  out.push('## Outcome coverage (explicit source status)');
  out.push('');
  const rows: Array<[string, number]> = [
    ['Resolved', s.resolvedCount],
    ['In progress', s.inProgressCount],
    ['Pending', s.pendingCount],
    ['Status not recorded', s.unknownStatusCount],
  ];
  for (const [label, n] of rows) out.push(`- ${label}: ${formatCount(n)} (${formatPercent(percentOf(n, t))})`);
  out.push(
    `- Response recorded: ${formatCount(s.withResponseCount)} (${formatPercent(percentOf(s.withResponseCount, t))}) — a response is not the same as a resolution.`,
  );
  out.push('');
  out.push('## Key recurring complaint themes');
  out.push('');
  for (const th of s.themes) {
    out.push(`- **${th.title}.** ${th.detail}${th.caseIds.length ? ` _Examples: ${th.caseIds.join(', ')}_` : ''}`);
  }
  out.push('');
  out.push('## Responses and actions reported');
  out.push('');
  for (const a of s.reportedActions.filter((x) => x.kind === 'fact')) out.push(`- ${a.text}`);
  const excerpts = s.reportedActions.filter((x) => x.kind === 'excerpt');
  if (excerpts.length) {
    out.push('');
    out.push('Sample response excerpts (verbatim, original language):');
    out.push('');
    for (const e of excerpts) {
      out.push(`- ${e.caseIds.join(', ')}${e.category ? ` (${e.category})` : ''}: “${truncateGraphemes(e.text, 140)}”`);
    }
  }
  out.push('');
  out.push('## Priority observations');
  out.push('');
  for (const p of s.priorityObservations) out.push(`- ${p}`);
  out.push('');
  out.push('## Data quality and limitations');
  out.push('');
  for (const l of s.limitations) out.push(`- ${l}`);
  out.push('');
  out.push('## Sources and traceability');
  out.push('');
  const referenced = new Set<string>();
  s.categories.forEach((c) => c.exampleCaseIds.forEach((id) => referenced.add(id)));
  s.reportedActions.forEach((a) => a.caseIds.forEach((id) => referenced.add(id)));
  out.push(
    `This report aggregates ${formatCount(t)} record(s). Case IDs cited as examples: ${[...referenced].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(', ') || 'none'}.`,
  );
  out.push('');
  return out.join('\n');
}

export function summaryFileName(s: ConsolidatedSummary): string {
  const stamp = localDateStamp(new Date(s.generatedAt));
  return `consolidated-grievance-summary-${s.scope}-${stamp}.md`;
}
