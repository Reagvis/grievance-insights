import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InsightsDashboard } from '../components/InsightsDashboard';
import { AnalysisWorkspace } from '../components/AnalysisWorkspace';
import type { Dataset, GrievanceRecord, CaseStatus } from '../domain/grievance';
import { analysisForRecord, buildInsights, matchInsightRecords, percent, reportForDataset, rowsFromCounts } from '../domain/insights';
import type { AnalysisItem, AnalysisJob, AnalysisReport } from '../services/analysisApi';

const record = (id: string, status: CaseStatus, category: string | null, responseText: string | null): GrievanceRecord => ({
  id, status, category, responseText, complaintText: 'గ్రామంలో నీటి సమస్య ఉంది. ' + id,
  language: 'te', issueType: null, department: null, district: null, submittedAt: null,
  respondedAt: null, sourceType: 'json', isSyntheticDemo: true,
});
const records = [
  record('A-1', 'resolved', 'Water', 'విచారిస్తున్నాము'),
  record('A-2', 'pending', 'Roads', 'ప్రక్రియలో ఉంది'),
  record('A-3', 'in_progress', 'Water', null),
  record('A-4', 'unknown', null, 'వివరాలు లేవు'),
  record('A-5', 'pending', 'Roads', null),
];
const analysis = (id: string, category: string, relevance: AnalysisItem['responseRelevance'], urgent = false): AnalysisItem => ({
  id, category, responseRelevance: relevance, potentiallyUrgent: urgent,
  complaintSummary: 'నీటి సమస్య', issueClassification: 'నీరు', requestedAction: null,
  urgencyReason: urgent ? 'ప్రమాద సూచన' : null,
  complaintEvidence: 'నీటి సమస్య', responseSummary: relevance === 'not_applicable' ? null : 'పరిశీలన',
  departmentClaim: null, responseAssessment: relevance === 'not_applicable' ? null : 'పూర్తి కాదు',
  responseEvidence: null, verifiedOutcome: null, verificationStatus: 'not_verified',
});
const job: AnalysisJob = { id: 'job-1', datasetId: 'ds-1', status: 'completed',
  createdAt: '2026-11-12T00:00:00Z', startedAt: '2026-11-12T00:00:00Z',
  finishedAt: '2026-11-12T00:00:00Z', processed: 5, total: 5, failureCount: 1,
  modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1', promptVersion: 'te-grievance-response-v1', error: null };
const report: AnalysisReport = {
  jobId: job.id, datasetId: job.datasetId, modelId: job.modelId, region: job.region, promptVersion: job.promptVersion,
  generatedAt: job.finishedAt!, stats: { grievances: 5, analyzed: 4, failed: 1,
    categoryCounts: { water: 2, sanitation: 1, other: 1 }, potentiallyUrgent: 1, withResponses: 3,
    responsesRelevant: 1, responsesInsufficient: 1, responsesInconclusive: 1 },
  categories: [{ category: 'water', count: 2, summaryTe: 'నీటి సమస్యల ఫిర్యాదులు.', sourceIds: ['A-1', 'A-3'] }],
  outcomes: [
    { id: 'A-1', analysis: analysis('A-1', 'water', 'relevant', true) },
    { id: 'A-2', analysis: analysis('A-2', 'sanitation', 'insufficient') },
    { id: 'A-3', analysis: analysis('A-3', 'water', 'not_applicable') },
    { id: 'A-4', analysis: analysis('A-4', 'other', 'inconclusive') },
    { id: 'A-5', failure: 'invalid_model_output' },
  ],
};
const dataset: Dataset = { id: 'ds-1', name: 'Synthetic pilot', kind: 'imported', records, isSynthetic: true };
const render = (props: Partial<Parameters<typeof InsightsDashboard>[0]> = {}) => renderToStaticMarkup(
  <InsightsDashboard dataset={dataset} job={job} report={report} filteredCount={2} onOpenRecord={vi.fn()} {...props} />,
);
describe('unified dashboard metric aggregation', () => {
  it('counts source responses and statuses independently from AI assessments', () => {
    const m = buildInsights(records, report, job);
    expect(m).toMatchObject({ total: 5, withResponse: 3, statuses: {
      resolved: 1, pending: 2, in_progress: 1, unknown: 1,
    }, analyzed: 4, failures: 1, flaggedUrgent: 1,
    relevant: 1, insufficient: 1, inconclusive: 1, notApplicable: 1, unassessed: 1 });
    // A response assessment never changes the source's reported resolution status.
    expect(records[0].status).toBe('resolved');
    expect(records[1].status).toBe('pending');
  });
  it('computes source and model category percentages using different denominators', () => {
    const m = buildInsights(records, report, job);
    expect(m.sourceCategories[0]).toMatchObject({ key: 'Roads', count: 2, percent: 40 });
    expect(m.sourceCategories.find(x => x.key === 'Water')).toMatchObject({ count: 2, percent: 40 });
    expect(m.sourceCategories.find(x => x.key === 'Uncategorized')).toMatchObject({ count: 1, percent: 20 });
    expect(m.aiCategories[0]).toMatchObject({ key: 'water', count: 2, percent: 50 });
    expect(m.aiCategories.find(x => x.key === 'sanitation')).toMatchObject({ count: 1, percent: 25 });
    expect(percent(2, 0)).toBe(0);
    expect(rowsFromCounts(new Map([['small', 1], ['large', 3]]), 4)[0].key).toBe('large');
  });
  it('treats an absent response as not applicable only when AI actually analyzed the case', () => {
    const m = buildInsights(records, report, job);
    expect(Object.fromEntries(m.assessmentRows.map(r => [r.key, r.count]))).toEqual({
      inconclusive: 1, insufficient: 1, not_applicable: 1, relevant: 1, unassessed: 1,
    });
    expect(matchInsightRecords(records, report, { kind: 'assessment', value: 'not_applicable' }).map(r => r.id)).toEqual(['A-3']);
    expect(matchInsightRecords(records, report, { kind: 'assessment', value: 'unassessed' }).map(r => r.id)).toEqual(['A-5']);
  });
  it('does not invent AI coverage while queued/running, and retains checkpointed failures', () => {
    const running = { ...job, status: 'running' as const, processed: 3, failureCount: 2 };
    const m = buildInsights(records, null, running);
    expect(m).toMatchObject({ analyzed: 0, processed: 3, failures: 2, flaggedUrgent: 0, unassessed: 5, hasCompletedReport: false });
    expect(m.aiCategories).toEqual([]);
    expect(buildInsights(records, null, null).unassessed).toBe(5);
    expect(reportForDataset(dataset.id, running, report)).toBeNull();
  });
  it('keeps failed jobs and stale datasets from surfacing completed AI conclusions', () => {
    expect(reportForDataset('ds-2', job, report)).toBeNull();
    expect(reportForDataset('ds-1', { ...job, status: 'failed' }, report)).toBeNull();
    expect(reportForDataset('ds-1', job, { ...report, jobId: 'another-job' })).toBeNull();
    expect(reportForDataset('ds-1', job, report)).toBe(report);
    expect(buildInsights(records, null, { ...job, status: 'failed', failureCount: 5 }).failures).toBe(5);
  });
  it('returns safe zero metrics for an empty dataset', () => {
    const m = buildInsights([], null, null);
    expect(m.total).toBe(0);
    expect(m.withResponse).toBe(0);
    expect(m.sourceCategories).toEqual([]);
    expect(m.statusRows.every(x => x.count === 0 && x.percent === 0)).toBe(true);
    expect(m.assessmentRows.every(x => x.count === 0)).toBe(true);
    expect(render({ dataset: { ...dataset, id: 'empty', records: [] }, job: null, report: null }))
      .toContain('No grievance records in this dataset');
  });
});
describe('accessible visual analytics and drill-down', () => {
  it('provides ranked bar labels, percentages, human review warnings and source distinctions', () => {
    const html = render();
    expect(html).toContain('Grievance insights dashboard');
    expect(html).toContain('Source record');
    expect(html).toContain('AI-assisted');
    expect(html).toContain('chart scope');
    expect(html).toContain('40%');
    expect(html).toContain('50%');
    expect(html).toContain('Resolved (source)');
    expect(html).toContain('Not independently verified');
    expect(html).toContain('not a separately generated category-level synthesis');
    expect(html).toContain('The case explorer currently shows 2 filtered records; charts remain full-dataset.');
    expect(html).toContain('aria-label="Potential urgency requiring human review"');
  });
  it('drills down to matching source and AI cases without altering originals', () => {
    const complaint = records[0].complaintText;
    expect(matchInsightRecords(records, report, { kind: 'source-category', value: 'Water' }).map(r => r.id)).toEqual(['A-1', 'A-3']);
    expect(matchInsightRecords(records, report, { kind: 'source-status', value: 'resolved' }).map(r => r.id)).toEqual(['A-1']);
    expect(matchInsightRecords(records, report, { kind: 'response-source', value: 'provided' }).map(r => r.id)).toEqual(['A-1', 'A-2', 'A-4']);
    expect(matchInsightRecords(records, report, { kind: 'ai-category', value: 'water' }).map(r => r.id)).toEqual(['A-1', 'A-3']);
    expect(matchInsightRecords(records, report, { kind: 'urgent', value: 'true' }).map(r => r.id)).toEqual(['A-1']);
    expect(matchInsightRecords(records, report, { kind: 'ai-failed', value: 'true' }).map(r => r.id)).toEqual(['A-5']);
    expect(analysisForRecord(report, records[0])?.complaintSummary).toBe('నీటి సమస్య');
    expect(records[0].complaintText).toBe(complaint);
    expect(records[0].responseText).toBe('విచారిస్తున్నాము');
  });
  it('supports no-AI and over-limit datasets with source charts intact and no fake AI data', () => {
    const large = { ...dataset, id: 'large', records: Array.from({ length: 31 }, (_, i) =>
      record('L-' + i, 'unknown', null, null)) };
    const html = render({ dataset: large, job: null, report: null, filteredCount: 31 });
    expect(html).toContain('exceeds the 30-record AI pilot limit');
    expect(html).toContain('Grievances by source category');
    expect(html).toContain('Requires a completed AI report');
    expect(html).not.toContain('Category excerpts from individual AI summaries');
    expect(html).not.toContain('నీటి సమస్యల ఫిర్యాదులు.');
  });
  it('shows queued/failed status and keeps the existing job controls accessible', () => {
    const html = render({ job: { ...job, status: 'queued', processed: 0 }, report: null });
    expect(html).toContain('AI analysis is queued.');
    expect(html).not.toContain('Category excerpts from individual AI summaries');
    const failed = render({ job: { ...job, status: 'failed', error: 'all_records_failed' }, report: null });
    expect(failed).toContain('AI analysis failed');
    const jobHtml = renderToStaticMarkup(<AnalysisWorkspace datasetId="ds-1" records={records} onStateChange={vi.fn()} />);
    expect(jobHtml).toContain('Checking for a saved AI analysis');
    expect(jobHtml).toContain('AI analysis job and export');
  });
});
