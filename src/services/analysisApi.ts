import { signalAuthExpired } from './authApi';

export type AnalysisJob = {
  id: string; datasetId: string; status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  processed: number; total: number; failureCount: number; attempt: number; generation?: number;
  modelId: string; region: string; promptVersion: string; error: string | null;
};
export type AnalysisItem = {
  id: string; complaintSummary: string; category: string; issueClassification: string | null;
  requestedAction: string | null; potentiallyUrgent: boolean; urgencyReason: string | null;
  complaintEvidence: string; responseSummary: string | null; departmentClaim: string | null;
  responseRelevance: 'relevant' | 'insufficient' | 'inconclusive' | 'not_applicable';
  responseAssessment: string | null; responseEvidence: string | null;
  verifiedOutcome: null; verificationStatus: 'not_verified';
};
export type AnalysisReport = {
  jobId: string; datasetId: string; modelId: string; region: string; promptVersion: string; generation?: number; generatedAt: string;
  stats: { grievances: number; analyzed: number; failed: number; categoryCounts: Record<string, number>;
    potentiallyUrgent: number; withResponses: number; responsesRelevant: number;
    responsesInsufficient: number; responsesInconclusive: number };
  categories: { category: string; count: number; summaryTe: string; sourceIds: string[] }[];
  outcomes: ({ id: string; analysis: AnalysisItem; failure?: never } | { id: string; failure: string; analysis?: never })[];
};
async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: string): Promise<T> {
  const response = await fetch(path, { method, ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}),
    credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (response.status === 401) {
    signalAuthExpired();
    throw new Error('Your administrator session has expired.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? 'AI analysis service unavailable.');
  }
  return response.json() as Promise<T>;
}
export async function createAnalysis(datasetId: string) {
  return request<{ job: AnalysisJob; alreadyExists: boolean }>('/api/datasets/' + encodeURIComponent(datasetId) + '/analyze', 'POST');
}
export async function retryAnalysis(jobId: string, mode: 'resume' | 'fresh' = 'resume') {
  return request<{ job: AnalysisJob }>('/api/analyses/' + encodeURIComponent(jobId) + '/retry', 'POST', JSON.stringify({ mode }));
}
export async function listAnalyses(datasetId: string) {
  return (await request<{ jobs: AnalysisJob[] }>('/api/datasets/' + encodeURIComponent(datasetId) + '/analyses')).jobs;
}
export async function readAnalysis(jobId: string) {
  return (await request<{ job: AnalysisJob }>('/api/analyses/' + encodeURIComponent(jobId))).job;
}
export async function readAnalysisResults(jobId: string) {
  const path = '/api/analyses/' + encodeURIComponent(jobId) + '/results';
  let cursor: number | null = 0;
  let result: { job: AnalysisJob; report: AnalysisReport } | null = null;
  const outcomes: AnalysisReport['outcomes'] = [];
  let categories: AnalysisReport['categories'] | null = null;
  while (cursor !== null) {
    const page: { job: AnalysisJob; report: AnalysisReport; nextCursor: number | null } =
      await request(path + '?cursor=' + cursor);
    if (page.job.id !== jobId || page.report.jobId !== jobId || page.report.datasetId !== page.job.datasetId ||
        page.job.status !== 'completed' || (page.report.generation ?? 0) !== (page.job.generation ?? 0)) throw new Error('AI result page does not match the requested job.');
    if (result && (result.report.generatedAt !== page.report.generatedAt || result.report.stats.grievances !== page.report.stats.grievances)) {
      throw new Error('AI report changed while downloading.');
    }
    if (page.report.outcomes.length > 100 || page.nextCursor !== null &&
        (page.nextCursor !== cursor + page.report.outcomes.length || page.nextCursor > 2000)) {
      throw new Error('Invalid AI result pagination.');
    }
    if (categories === null) {
      categories = page.report.categories.map(category => ({ ...category, sourceIds: [] }));
    } else if (page.report.categories.length !== categories.length ||
        page.report.categories.some((category, index) =>
          category.category !== categories![index].category || category.count !== categories![index].count ||
          category.summaryTe !== categories![index].summaryTe)) {
      throw new Error('AI report category metadata changed while downloading.');
    }
    const pageMembership = new Set<string>();
    const pageAnalyses = new Map(page.report.outcomes.filter(item => !!item.analysis)
      .map(item => [item.id, item.analysis!.category]));
    for (let index = 0; index < page.report.categories.length; index++) {
      const category = page.report.categories[index];
      for (const sourceId of category.sourceIds) {
        if (pageAnalyses.get(sourceId) !== category.category || pageMembership.has(sourceId)) {
          throw new Error('AI category evidence does not match the result page.');
        }
        pageMembership.add(sourceId);
      }
      categories[index].sourceIds.push(...category.sourceIds);
    }
    if (pageMembership.size !== pageAnalyses.size) throw new Error('Incomplete AI category evidence in result page.');
    outcomes.push(...page.report.outcomes);
    result = { job: page.job, report: page.report };
    cursor = page.nextCursor;
  }
  if (!result || outcomes.length !== result.report.stats.grievances ||
      !categories || categories.some(category => category.sourceIds.length !== category.count)) {
    throw new Error('Incomplete AI report retrieval.');
  }
  return { ...result, report: { ...result.report, categories, outcomes } };
}
