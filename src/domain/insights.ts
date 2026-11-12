import { CASE_STATUSES, categoryOf, computeStats, hasResponse, type CaseStatus, type GrievanceRecord } from './grievance';
import type { AnalysisJob, AnalysisReport, AnalysisItem } from '../services/analysisApi';

export type InsightKind = 'all' | 'response-source' | 'source-category' | 'ai-category' | 'source-status' |
  'assessment' | 'urgent' | 'ai-analyzed' | 'ai-failed';
export type InsightSelection = { kind: InsightKind; value: string };
export type ChartRow = { key: string; label: string; count: number; percent: number };
export type InsightMetrics = {
  total: number;
  withResponse: number;
  statuses: Record<CaseStatus, number>;
  analyzed: number;
  failures: number;
  processed: number;
  flaggedUrgent: number;
  relevant: number;
  insufficient: number;
  inconclusive: number;
  notApplicable: number;
  unassessed: number;
  sourceCategories: ChartRow[];
  aiCategories: ChartRow[];
  statusRows: ChartRow[];
  assessmentRows: ChartRow[];
  hasCompletedReport: boolean;
};

export const STATUS_LABELS: Record<CaseStatus, string> = {
  resolved: 'Resolved (source)', pending: 'Pending (source)',
  in_progress: 'In progress (source)', unknown: 'Unknown (source)',
};
export const ASSESSMENT_LABELS: Record<string, string> = {
  relevant: 'Relevant (AI assessment)',
  insufficient: 'Insufficient (AI assessment)',
  inconclusive: 'Inconclusive (AI assessment)',
  not_applicable: 'Not applicable (no response)',
  unassessed: 'Not assessed by AI',
};
export function percent(count: number, denominator: number): number {
  return denominator > 0 ? Math.round((1000 * count) / denominator) / 10 : 0;
}
export function rowsFromCounts(counts: ReadonlyMap<string, number>, denominator: number, labels?: Record<string, string>): ChartRow[] {
  return [...counts].map(([key, count]) => ({
    key, label: labels?.[key] ?? key, count, percent: percent(count, denominator),
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
/** A report belongs to the current full dataset or it is not eligible for display. */
export function reportForDataset(datasetId: string, job: AnalysisJob | null, report: AnalysisReport | null): AnalysisReport | null {
  if (!job || job.datasetId !== datasetId || job.status !== 'completed' ||
    !report || report.datasetId !== datasetId || report.jobId !== job.id) return null;
  return report;
}
function matchedAnalyses(records: readonly GrievanceRecord[], report: AnalysisReport | null): Map<string, AnalysisItem> {
  const ids = new Set(records.map(r => r.id));
  const matches = new Map<string, AnalysisItem>();
  if (!report) return matches;
  for (const item of report.outcomes) {
    if (item.analysis && item.analysis.id === item.id && ids.has(item.id) && !matches.has(item.id)) matches.set(item.id, item.analysis);
  }
  return matches;
}
/**
 * Source metrics are always derived from original records. AI metrics use only
 * completed, correctly scoped, per-record outputs — never a queued inference.
 */
export function buildInsights(records: readonly GrievanceRecord[], report: AnalysisReport | null, job: AnalysisJob | null): InsightMetrics {
  const source = computeStats(records);
  const analyses = matchedAnalyses(records, report);
  const sourceCats = new Map<string, number>();
  const aiCats = new Map<string, number>();
  const assessments = new Map<string, number>([
    ['relevant', 0], ['insufficient', 0], ['inconclusive', 0], ['not_applicable', 0], ['unassessed', 0],
  ]);
  let flaggedUrgent = 0;
  for (const r of records) sourceCats.set(categoryOf(r), (sourceCats.get(categoryOf(r)) ?? 0) + 1);
  for (const result of analyses.values()) {
    aiCats.set(result.category, (aiCats.get(result.category) ?? 0) + 1);
    if (result.potentiallyUrgent) flaggedUrgent++;
    assessments.set(result.responseRelevance, (assessments.get(result.responseRelevance) ?? 0) + 1);
  }
  assessments.set('unassessed', source.total - analyses.size);
  const statuses = new Map<string, number>(CASE_STATUSES.map(s => [s, source.byStatus[s]]));
  const failed = report ? records.length - analyses.size : Math.min(job?.failureCount ?? 0, source.total);
  return {
    total: source.total, withResponse: source.withResponse, statuses: source.byStatus,
    analyzed: analyses.size, failures: failed,
    processed: report ? records.length : Math.min(job?.processed ?? 0, records.length),
    flaggedUrgent,
    relevant: assessments.get('relevant') ?? 0,
    insufficient: assessments.get('insufficient') ?? 0,
    inconclusive: assessments.get('inconclusive') ?? 0,
    notApplicable: assessments.get('not_applicable') ?? 0,
    unassessed: assessments.get('unassessed') ?? 0,
    sourceCategories: rowsFromCounts(sourceCats, source.total),
    aiCategories: rowsFromCounts(aiCats, analyses.size),
    statusRows: rowsFromCounts(statuses, source.total, STATUS_LABELS),
    assessmentRows: rowsFromCounts(assessments, source.total, ASSESSMENT_LABELS),
    hasCompletedReport: report !== null,
  };
}
export function matchInsightRecords(
  records: readonly GrievanceRecord[], report: AnalysisReport | null, selection: InsightSelection,
): GrievanceRecord[] {
  const analyses = matchedAnalyses(records, report);
  return records.filter(r => {
    const analysis = analyses.get(r.id);
    switch (selection.kind) {
      case 'all': return true;
      case 'response-source': return hasResponse(r);
      case 'source-category': return categoryOf(r) === selection.value;
      case 'source-status': return r.status === selection.value;
      case 'ai-category': return analysis?.category === selection.value;
      case 'assessment': return selection.value === 'unassessed' ? !analysis : analysis?.responseRelevance === selection.value;
      case 'urgent': return analysis?.potentiallyUrgent === true;
      case 'ai-analyzed': return !!analysis;
      case 'ai-failed': return report ? !analysis : false;
    }
  });
}
export function analysisForRecord(report: AnalysisReport | null, record: GrievanceRecord): AnalysisItem | null {
  return matchedAnalyses([record], report).get(record.id) ?? null;
}
