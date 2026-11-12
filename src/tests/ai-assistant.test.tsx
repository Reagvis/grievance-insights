import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalysisResults } from '../components/AiAnalysisPane';
import type { GrievanceRecord } from '../domain/grievance';
import type { AnalysisItem, AnalysisJob, AnalysisReport } from '../services/analysisApi';
import { mergeComplaints, mergedIdOf } from '../services/allComplaints';

const item = (id: string, urgent: boolean): AnalysisItem => ({
  id, complaintSummary: 'సారాంశం', category: 'water', issueClassification: null, requestedAction: null, potentiallyUrgent: urgent,
  urgencyReason: urgent ? 'తక్షణ చర్య అవసరం' : null, complaintEvidence: 'q', responseSummary: null, departmentClaim: null,
  responseRelevance: 'not_applicable', responseAssessment: null, responseEvidence: null, verifiedOutcome: null, verificationStatus: 'not_verified',
});
const job = (status: AnalysisJob['status']): AnalysisJob => ({ id: 'j', datasetId: 'd', status, createdAt: '', startedAt: null, finishedAt: null, processed: 3, total: 3, attempt: 0, failureCount: 0, modelId: 'm', region: 'r', promptVersion: 'p', error: null });
const report: AnalysisReport = {
  jobId: 'j', datasetId: 'd', modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1', promptVersion: 'p', generatedAt: '2026-11-12T10:00:00Z',
  stats: { grievances: 3, analyzed: 2, failed: 1, categoryCounts: { water: 2, roads: 0, public_safety: 1 }, potentiallyUrgent: 1, withResponses: 1, responsesRelevant: 1, responsesInsufficient: 0, responsesInconclusive: 0 },
  categories: [{ category: 'water', count: 2, summaryTe: 'నీటి సమస్యలు', sourceIds: ['A', 'B', 'GONE'] }],
  outcomes: [{ id: 'A', analysis: item('A', true) }, { id: 'B', analysis: item('B', false) }, { id: 'C', failure: 'invalid_output' }],
};
const props = { datasetId: 'd', mergedIdOf: (_d: string, id: string) => (id === 'GONE' ? undefined : id === 'B' ? 'B (new.csv)' : id), onOpenRecord: () => {} };

describe('AI results inside the assistant', () => {
  it('shows counts, categories (non-zero only), urgent complaints and notes, with the honesty caveat', () => {
    const html = renderToStaticMarkup(<AnalysisResults {...props} job={job('completed')} report={report} />);
    expect(html).toContain('Nothing here confirms that a problem was fixed');
    expect(html).toContain('2 of 3'); // analysed
    expect(html).toContain('1 could not be analysed');
    expect(html).toContain('Potentially urgent');
    expect(html).toContain('తక్షణ చర్య అవసరం');
    expect(html).toContain('Public safety'); // underscore → words
    expect(html).not.toContain('>Roads<'); // zero counts are hidden
    expect(html).toContain('నీటి సమస్యలు');
  });
  it('case chips open complaints under their merged ID; a complaint no longer in the list is shown but not clickable', () => {
    const html = renderToStaticMarkup(<AnalysisResults {...props} job={job('completed')} report={report} />);
    expect(html).toMatch(/<button[^>]*class="case-chip"[^>]*>A<\/button>/);
    expect(html).toMatch(/<button[^>]*class="case-chip"[^>]*>B<\/button>/); // shown by its original name, opens the renamed one
    expect(html).toMatch(/<span[^>]*case-chip--unknown[^>]*>GONE<\/span>/);
  });
  it('shows nothing until a job has completed with a report (never a partial or guessed result)', () => {
    for (const status of ['queued', 'running', 'failed'] as const) expect(renderToStaticMarkup(<AnalysisResults {...props} job={job(status)} report={report} />)).toBe('');
    expect(renderToStaticMarkup(<AnalysisResults {...props} job={job('completed')} report={null} />)).toBe('');
    expect(renderToStaticMarkup(<AnalysisResults {...props} job={null} report={report} />)).toBe('');
  });
});

describe('opening a complaint named by a per-file report', () => {
  const rec = (id: string): GrievanceRecord => ({ id, complaintText: 'x', responseText: null, language: 'en', category: null, issueType: null, department: null, district: null, submittedAt: null, respondedAt: null, status: 'unknown', sourceType: 'csv', isSyntheticDemo: false });
  const file = (id: string, name: string) => ({ id, name, format: 'csv' as const, status: 'ready' as const, bytes: 1, recordCount: 1, createdAt: '2026-01-01', error: null });
  it('maps the ID inside a file to its ID in the combined list, including renamed repeats', () => {
    const m = mergeComplaints([{ dataset: file('a', 'new.csv'), records: [rec('X')] }, { dataset: file('b', 'old.csv'), records: [rec('X')] }]);
    expect(mergedIdOf(m, 'a', 'X')).toBe('X');
    expect(mergedIdOf(m, 'b', 'X')).toBe('X (old.csv)');
    expect(mergedIdOf(m, 'b', 'nope')).toBeUndefined();
  });
});
