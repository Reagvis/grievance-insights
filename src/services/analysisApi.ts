import { signalAuthExpired } from './authApi';

export type AnalysisJob = {
  id: string; datasetId: string; status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  processed: number; total: number; failureCount: number; attempt: number;
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
  jobId: string; datasetId: string; modelId: string; region: string; promptVersion: string; generatedAt: string;
  stats: { grievances: number; analyzed: number; failed: number; categoryCounts: Record<string, number>;
    potentiallyUrgent: number; withResponses: number; responsesRelevant: number;
    responsesInsufficient: number; responsesInconclusive: number };
  categories: { category: string; count: number; summaryTe: string; sourceIds: string[] }[];
  outcomes: ({ id: string; analysis: AnalysisItem; failure?: never } | { id: string; failure: string; analysis?: never })[];
};
async function request<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
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
export async function retryAnalysis(jobId: string) {
  return request<{ job: AnalysisJob }>('/api/analyses/' + encodeURIComponent(jobId) + '/retry', 'POST');
}
export async function listAnalyses(datasetId: string) {
  return (await request<{ jobs: AnalysisJob[] }>('/api/datasets/' + encodeURIComponent(datasetId) + '/analyses')).jobs;
}
export async function readAnalysis(jobId: string) {
  return (await request<{ job: AnalysisJob }>('/api/analyses/' + encodeURIComponent(jobId))).job;
}
export async function readAnalysisResults(jobId: string) {
  return request<{ job: AnalysisJob; report: AnalysisReport }>('/api/analyses/' + encodeURIComponent(jobId) + '/results');
}
