/**
 * Real-browser React interaction regression checks, served by Vite and executed
 * with headless Chromium in CI. All data and job responses are synthetic.
 * No AWS endpoint or external network request is made.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { InsightsDashboard } from '../components/InsightsDashboard';
import { AnalysisWorkspace } from '../components/AnalysisWorkspace';
import type { Dataset, GrievanceRecord } from '../domain/grievance';
import type { AnalysisItem, AnalysisJob, AnalysisReport } from '../services/analysisApi';

const app = document.getElementById('browser-dashboard-root');
const analysisApp = document.getElementById('browser-analysis-root');
const statusNode = document.getElementById('dashboard-browser-result');
if (!app || !analysisApp || !statusNode) throw new Error('Interactive test elements absent');
const dashboardRoot = createRoot(app);
const analysisRoot = createRoot(analysisApp);
let assertions = 0;
const opened: string[] = [];

function check(condition: unknown, message: string): asserts condition {
  assertions++;
  if (!condition) throw new Error(message);
}
const settle = () => new Promise<void>(resolve => window.setTimeout(resolve, 60));
function element<T extends Element>(selector: string, parent: ParentNode = app): T {
  const item = parent.querySelector<T>(selector);
  check(!!item, 'Element missing: ' + selector);
  return item!;
}
function record(id: string, category: string, responseText: string | null): GrievanceRecord {
  return {
    id, category, responseText,
    complaintText: 'తాగునీటి సమస్య ఉంది - ' + id, language: 'te', issueType: null,
    department: null, district: null, status: 'pending', submittedAt: null, respondedAt: null,
    sourceType: 'json', isSyntheticDemo: true,
  };
}
const aRecords = [
  record('A-1', 'Water', 'సమస్యను పరిశీలించాము'),
  record('A-2', 'Water', null),
  record('A-3', 'Roads', 'రోడ్లు పరిశీలించాము'),
];
const bRecords = [record('B-1', 'Sanitation', 'స్వచ్ఛతపై పరిశీలించాము')];
const datasetA: Dataset = { id: 'dataset-a', name: 'Synthetic A', records: aRecords, kind: 'imported', isSynthetic: true };
const datasetB: Dataset = { id: 'dataset-b', name: 'Synthetic B', records: bRecords, kind: 'imported', isSynthetic: true };
function job(datasetId: string, id: string, state: AnalysisJob['status'] = 'completed'): AnalysisJob {
  return {
    id, datasetId, status: state, processed: state === 'queued' ? 0 : 3,
    total: datasetId === 'dataset-a' ? 3 : 1, failureCount: 1,
    createdAt: '2026-11-12T00:00:00Z', startedAt: null, finishedAt: state === 'completed' ? '2026-11-12T01:00:00Z' : null,
    modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1',
    promptVersion: 'te-grievance-response-v1', error: state === 'failed' ? 'model_request_failed' : null,
  };
}
function analysis(id: string, category: string, relevance: AnalysisItem['responseRelevance'], evidence: string): AnalysisItem {
  return {
    id, category, responseRelevance: relevance, potentiallyUrgent: false, complaintSummary: 'తెలుగు AI వివరణ ' + id,
    issueClassification: null, requestedAction: null, urgencyReason: null,
    complaintEvidence: evidence, responseSummary: 'ప్రభుత్వ పరిశీలన', departmentClaim: 'పరిశీలించారు',
    responseAssessment: 'పూర్తి ధృవీకరణ లేదు', responseEvidence: 'పరిశీలించాము',
    verificationStatus: 'not_verified', verifiedOutcome: null,
  };
}
const jobA = job('dataset-a', 'analysis-a');
const jobB = job('dataset-b', 'analysis-b');
const reportA: AnalysisReport = {
  jobId: jobA.id, datasetId: jobA.datasetId, modelId: jobA.modelId, region: jobA.region, promptVersion: jobA.promptVersion,
  generatedAt: '2026-11-12T01:00:00Z',
  outcomes: [
    { id: 'A-1', analysis: analysis('A-1', 'water', 'relevant', 'తాగునీటి సమస్య') },
    { id: 'A-2', failure: 'invalid_model_output' },
    { id: 'A-3', analysis: analysis('A-3', 'roads', 'insufficient', 'తాగునీటి సమస్య') },
  ],
  categories: [{ category: 'water', count: 1, summaryTe: 'నీటి సమస్యల సమగ్ర వివరణ', sourceIds: ['A-1'] }],
  stats: { grievances: 3, analyzed: 2, failed: 1, categoryCounts: { water: 1, roads: 1 },
    potentiallyUrgent: 0, withResponses: 2, responsesRelevant: 1, responsesInsufficient: 1,
    responsesInconclusive: 0 },
};
const reportB: AnalysisReport = {
  ...reportA, jobId: jobB.id, datasetId: jobB.datasetId, outcomes: [
    { id: 'B-1', analysis: analysis('B-1', 'sanitation', 'relevant', 'తాగునీటి సమస్య') },
  ],
  categories: [{ category: 'sanitation', count: 1, summaryTe: 'స్వచ్ఛత సేవలు', sourceIds: ['B-1'] }],
  stats: { ...reportA.stats, grievances: 1, analyzed: 1, failed: 0 },
};
function render(dataset: Dataset, activeJob: AnalysisJob | null, report: AnalysisReport | null) {
  flushSync(() => dashboardRoot.render(<InsightsDashboard dataset={dataset} filteredCount={dataset.records.length}
    job={activeJob} report={report} onOpenRecord={id => opened.push(id)} />));
}
function chartButton(container: string, term: string): HTMLButtonElement {
  const buttons = [...element<HTMLElement>(container).querySelectorAll<HTMLButtonElement>('button')];
  const selected = buttons.find(button => button.getAttribute('aria-label')?.includes(term));
  check(!!selected, 'Chart option missing: ' + container + ' ' + term +
    ' | labels=' + buttons.map(button => button.getAttribute('aria-label')).join('; ') +
    ' | markup=' + element<HTMLElement>(container).outerHTML.slice(0, 1200));
  return selected!;
}
async function run() {
  // 1. Select source category in real DOM and inspect matching grievance IDs.
  render(datasetA, jobA, reportA);
  await settle();
  const water = chartButton('#source-cat-chart', 'for Water,');
  check(water.getAttribute('aria-label')?.includes('66.7%'), 'Chart must disclose precise source percentage');
  water.focus();
  check(document.activeElement === water, 'Chart must be keyboard focusable');
  water.click();
  await settle();
  check(app.querySelectorAll('.insight-match-button').length === 2, 'Water selection must show exactly two cases');
  check(!!app.textContent?.includes('Matching cases · 2'), 'Drilldown count must be shown');
  check(![...app.querySelectorAll('.insight-match-button')].some(n => n.textContent?.includes('A-3')), 'Unmatched case leaked');

  // 2. Expand real source and model evidence, confirm exact source text is unchanged.
  const caseButton = element<HTMLButtonElement>('.insight-match-button');
  check(caseButton.textContent?.includes('A-1'), 'First matching case should be A-1');
  caseButton.click();
  await settle();
  const evidence = element<HTMLElement>('.insight-case');
  check(evidence.textContent?.includes(aRecords[0].complaintText), 'Original Telugu complaint absent');
  check(evidence.textContent?.includes(aRecords[0].responseText!), 'Original response absent');
  check(evidence.textContent?.includes('తెలుగు AI వివరణ A-1'), 'Validated AI summary absent');
  check(evidence.textContent?.includes('తాగునీటి సమస్య'), 'Verbatim complaint quote absent');
  check(evidence.textContent?.includes('పరిశీలించాము'), 'Verbatim response quote absent');
  check(evidence.textContent?.includes('Not independently verified'), 'Unverified claims warning absent');
  
  // 3. Source-record navigation dispatches actual record ID; collapse hides evidence.
  element<HTMLButtonElement>('.insight-case .btn').click();
  check(opened.length === 1 && opened[0] === 'A-1', 'Source-record callback did not receive selected ID');
  caseButton.click();
  await settle();
  check(app.querySelector('.insight-case') === null, 'Evidence did not collapse on second click');

  // 4. Select AI assessment chart; exclude failed and unassessed results.
  chartButton('#response-assessment-chart', 'for Relevant (AI assessment)').click();
  await settle();
  const matches = [...app.querySelectorAll('.insight-match-button')];
  check(matches.length === 1 && matches[0].textContent?.includes('A-1'), 'AI assessment selection used wrong cases');

  // 5. Changing analysis status must immediately clear the *old* completed AI report.
  render(datasetA, { ...jobA, status: 'running' }, reportA);
  await settle();
  check(app.querySelector('#ai-cat-chart .insight-bar-button') === null, 'Stale AI chart shown during running state');
  check(!app.textContent?.includes('నీటి సమస్యల సమగ్ర వివరణ'), 'Stale category narrative shown during running state');
  check(app.querySelector('.insight-case') === null, 'Stale AI case evidence shown during running state');

  // 6. Dataset switch clears previous selection and rejects report/job belonging to A.
  chartButton('#source-cat-chart', 'for Water,').click();
  await settle();
  render(datasetB, jobA, reportA);
  await settle();
  check(app.textContent?.includes('Synthetic B'), 'New dataset scope not shown');
  check(app.textContent?.includes('Explore cases behind the figures'), 'Old selection retained after dataset switch');
  check(app.querySelector('.insight-match-button') === null, 'Old case selection retained after dataset switch');
  check(app.querySelector('#ai-cat-chart .insight-bar-button') === null, 'Old report leaked into new dataset');
  check(!app.textContent?.includes('నీటి సమస్యల సమగ్ర వివరణ'), 'Old AI narrative leaked into new dataset');
  render(datasetB, jobB, reportB);
  await settle();
  check(!!app.querySelector('#ai-cat-chart .insight-bar-button'), 'New dataset report did not display');
  check(!app.textContent?.includes('నీటి సమస్యల సమగ్ర వివరణ'), 'A report remained after B completed');

  // 7. Late async response for unmounted dataset cannot be published into new dataset.
  const nativeFetch = window.fetch.bind(window);
  let resolveOld: ((value: Response) => void) | null = null;
  const notifications: { datasetId: string; report: AnalysisReport | null }[] = [];
  window.fetch = ((resource: RequestInfo | URL) => {
    const url = String(resource);
    const reply = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (url.endsWith('/api/datasets/dataset-a/analyses')) {
      return new Promise<Response>(resolve => { resolveOld = resolve; });
    }
    if (url.endsWith('/api/datasets/dataset-b/analyses')) return Promise.resolve(reply({ jobs: [jobB] }));
    if (url.endsWith('/api/analyses/analysis-b/results')) return Promise.resolve(reply({ job: jobB, report: reportB }));
    return Promise.reject(new Error('Unexpected synthetic network request: ' + url));
  }) as typeof fetch;
  const onStateChange = (datasetId: string, _job: AnalysisJob | null, report: AnalysisReport | null) =>
    notifications.push({ datasetId, report });
  flushSync(() => analysisRoot.render(<AnalysisWorkspace key="dataset-a" datasetId="dataset-a"
    records={aRecords} onStateChange={onStateChange} />));
  await settle();
  check(!!resolveOld, 'Old dataset list call was not captured');
  flushSync(() => analysisRoot.render(<AnalysisWorkspace key="dataset-b" datasetId="dataset-b"
    records={bRecords} onStateChange={onStateChange} />));
  await settle();
  check(notifications.some(n => n.datasetId === 'dataset-b' && n.report?.jobId === jobB.id),
    'Current dataset AI report did not load');
  const beforeOld = notifications.length;
  resolveOld!(new Response(JSON.stringify({ jobs: [jobA] }), { status: 200,
    headers: { 'content-type': 'application/json' } }));
  await settle();
  check(notifications.length === beforeOld, 'Obsolete dataset async result was published');
  check(!notifications.some(n => n.datasetId === 'dataset-b' && n.report?.jobId === jobA.id),
    'Obsolete AI result leaked into the current dataset');

  window.fetch = nativeFetch;
  dashboardRoot.unmount();
  analysisRoot.unmount();
}

void run().then(() => {
  statusNode.dataset.status = 'passed';
  statusNode.textContent = 'PASS ' + assertions + ' real-browser interactive assertions';
}).catch(error => {
  statusNode.dataset.status = 'failed';
  statusNode.textContent = 'FAIL ' + (error instanceof Error ? error.stack : String(error));
});
