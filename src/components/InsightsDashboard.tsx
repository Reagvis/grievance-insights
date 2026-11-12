import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, CircleAlert, FileText, ListFilter, ShieldAlert } from 'lucide-react';
import { categoryOf, type Dataset, type GrievanceRecord } from '../domain/grievance';
import { analysisForRecord, ASSESSMENT_LABELS, buildInsights, matchInsightRecords, reportForDataset,
  type ChartRow, type InsightSelection } from '../domain/insights';
import type { AnalysisJob, AnalysisReport } from '../services/analysisApi';
import { formatCount } from '../utils/format';

type Props = {
  dataset: Dataset;
  filteredCount: number;
  job: AnalysisJob | null;
  report: AnalysisReport | null;
  onOpenRecord: (id: string) => void;
};

function Metric({ label, value, context, source, urgent = false }: {
  label: string; value: number | string; context: string; source: 'source' | 'ai'; urgent?: boolean;
}) {
  return <div className={`insight-metric${urgent ? ' insight-metric--urgent' : ''}`}>
    <span className="insight-metric-label">{label}</span>
    <strong className="insight-metric-value">{typeof value === 'number' ? formatCount(value) : value}</strong>
    <span className="insight-metric-sub">{context}</span>
    <span className="insight-origin">{source === 'source' ? 'Source record' : 'AI-assisted'}</span>
  </div>;
}

function ChartPanel({ id, title, description, rows, emptyText, onSelect }: {
  id: string; title: string; description: string; rows: ChartRow[]; emptyText: string;
  onSelect: (key: string) => void;
}) {
  return <section className="insight-chart" aria-labelledby={id}>
    <div className="insight-chart-heading">
      <h3 id={id}>{title}</h3>
      <p>{description}</p>
    </div>
    {rows.length === 0
      ? <p className="insight-empty">{emptyText}</p>
      : <ol className="insight-bars">
        {rows.map(row => <li key={row.key}>
          <button type="button" className="insight-bar-button" disabled={row.count === 0}
            aria-label={`Show ${row.count} cases for ${row.label}, ${row.percent}% of chart scope`}
            onClick={() => onSelect(row.key)}>
            <span className="insight-bar-heading">
              <span>{row.label}</span>
              <span className="insight-bar-number">{formatCount(row.count)} <span>({row.percent}%)</span></span>
            </span>
            <span className="insight-track" aria-hidden="true">
              <span className="insight-fill" style={{ width: `${row.percent}%` }} />
            </span>
          </button>
        </li>)}
      </ol>}
  </section>;
}

function CaseEvidence({ record, report, onOpenRecord }: {
  record: GrievanceRecord; report: AnalysisReport | null; onOpenRecord: (id: string) => void;
}) {
  const ai = analysisForRecord(report, record);
  return <article className="insight-case" aria-label={`Evidence for case ${record.id}`}>
    <header className="insight-case-head">
      <h4>{record.id} <small>Source status: {record.status.replace('_', ' ')}</small></h4>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenRecord(record.id)}>
        <FileText size={14} aria-hidden /> Open source record
      </button>
    </header>
    <div className="insight-evidence-grid">
      <div>
        <h5>Original citizen complaint</h5>
        <p className="insight-telugu" lang={record.language === 'te' ? 'te' : undefined}>{record.complaintText}</p>
        <h5>Original department response</h5>
        <p className="insight-telugu" lang={record.language === 'te' ? 'te' : undefined}>{record.responseText?.trim() || 'No response recorded in source.'}</p>
      </div>
      <div>
        {ai ? <>
          <h5>AI-generated Telugu summary</h5>
          <p className="insight-telugu" lang="te">{ai.complaintSummary}</p>
          <dl className="insight-assessment">
            <dt>AI classification</dt><dd>{ai.category}</dd>
            <dt>Requested action (AI)</dt><dd lang="te" className="insight-telugu">{ai.requestedAction ?? 'Not established'}</dd>
            <dt>Complaint evidence — exact quotation</dt><dd lang="te" className="insight-telugu"><q>{ai.complaintEvidence}</q></dd>
            <dt>Response assessment — AI interpretation</dt><dd>{ASSESSMENT_LABELS[ai.responseRelevance]}</dd>
            <dt>Department claim — unverified</dt><dd lang="te" className="insight-telugu">{ai.departmentClaim ?? 'No explicit claim identified'}</dd>
            <dt>AI assessment explanation</dt><dd lang="te" className="insight-telugu">{ai.responseAssessment ?? 'Not applicable'}</dd>
            <dt>Response evidence — exact quotation</dt>
            <dd lang="te" className="insight-telugu">{ai.responseEvidence ? <q>{ai.responseEvidence}</q> : 'Not available'}</dd>
            <dt>Verification</dt><dd><strong>Not independently verified</strong>. Department claims are not proof of resolution.</dd>
          </dl>
        </> : <p className="insight-empty">No validated AI output is available for this case. Source text remains unchanged.</p>}
      </div>
    </div>
  </article>;
}

export function InsightsDashboard({ dataset, filteredCount, job, report, onOpenRecord }: Props) {
  const scopedReport = reportForDataset(dataset.id, job, report);
  const metrics = useMemo(() => buildInsights(dataset.records, scopedReport, job), [dataset.records, scopedReport, job]);
  const [selection, setSelection] = useState<InsightSelection | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);

  // Reset charts and drill-down when a different persisted or demo dataset is selected.
  useEffect(() => { setSelection(null); setEvidenceId(null); setLimit(12); }, [dataset.id, scopedReport?.jobId]);
  const matching = useMemo(() => selection ? matchInsightRecords(dataset.records, scopedReport, selection) : [],
    [dataset.records, scopedReport, selection]);
  const evidence = evidenceId ? matching.find(r => r.id === evidenceId) ?? null : null;
  const choose = (kind: InsightSelection['kind'], value: string) => {
    setSelection({ kind, value });
    setEvidenceId(null);
    setLimit(12);
  };
  const state = job?.status ?? 'not requested';
  const hasJob = job !== null;
  const availableAI = scopedReport !== null;
  const progressText = hasJob ? `${formatCount(metrics.processed)} of ${formatCount(job.total)} processing attempts checkpointed` : 'No AI job for this dataset';
  const aiValue = (n: number) => hasJob ? n : '—';

  return <section id="insights-dashboard" className="insights-dashboard" aria-labelledby="insights-title">
    <header className="insights-header">
      <div className="insights-heading">
        <span className="insight-eyebrow"><BarChart3 size={15} aria-hidden /> DATASET INTELLIGENCE</span>
        <h2 id="insights-title">Grievance insights dashboard</h2>
        <p>Full loaded dataset: <strong>{dataset.name}</strong> · {formatCount(dataset.records.length)} source records.
          {filteredCount !== dataset.records.length && <> The case explorer currently shows {formatCount(filteredCount)} filtered records; charts remain full-dataset.</>}
        </p>
      </div>
      <a className="btn btn-secondary btn-sm" href="#deterministic-report"><FileText size={15} aria-hidden /> Detailed deterministic report</a>
    </header>
    <div className="insight-groups">
      <section aria-labelledby="source-metrics-heading">
        <div className="insight-section-head"><h3 id="source-metrics-heading">Recorded source facts</h3><span>Source fields only</span></div>
        <div className="insight-metric-grid">
          <Metric label="Total grievances" value={metrics.total} context="All loaded records" source="source" />
          <Metric label="Department responses" value={metrics.withResponse} context="Response text present" source="source" />
          <Metric label="Resolved" value={metrics.statuses.resolved} context="Source-reported status" source="source" />
          <Metric label="Pending" value={metrics.statuses.pending} context="Source-reported status" source="source" />
          <Metric label="In progress" value={metrics.statuses.in_progress} context="Source-reported status" source="source" />
          <Metric label="Unknown status" value={metrics.statuses.unknown} context="Missing/unrecognized source status" source="source" />
        </div>
      </section>
      <section aria-labelledby="ai-metrics-heading">
        <div className="insight-section-head"><h3 id="ai-metrics-heading">AI-assisted interpretation</h3><span>{state} · {progressText}</span></div>
        <div className="insight-metric-grid">
          <Metric label="AI-analyzed" value={aiValue(metrics.analyzed)} context={availableAI ? 'Validated record outputs' : 'Confirmed after completed report'} source="ai" />
          <Metric label="Analysis failures" value={aiValue(metrics.failures)} context={availableAI ? 'Per-record failures' : 'Checkpointed failures so far'} source="ai" />
          <Metric label="Potential urgency" value={aiValue(metrics.flaggedUrgent)} context="AI-flagged · needs human review" source="ai" urgent={metrics.flaggedUrgent > 0} />
          <Metric label="Responses relevant" value={aiValue(metrics.relevant)} context="AI assessment, not outcome" source="ai" />
          <Metric label="Responses insufficient" value={aiValue(metrics.insufficient)} context="AI assessment, not outcome" source="ai" />
          <Metric label="Responses inconclusive" value={aiValue(metrics.inconclusive)} context="AI assessment, not outcome" source="ai" />
        </div>
      </section>
    </div>
    <div className="insight-disclaimer" role="note"><ShieldAlert size={18} aria-hidden />
      <span>Source status is recorded data, not independent verification. AI categories, response assessments and urgency flags are interpretations requiring human review. Not independently verified: no department claim is treated as proven resolution.</span>
    </div>
    {dataset.records.length === 0 && <div className="insight-empty" role="status">No grievance records in this dataset. Import or select a dataset to populate the charts.</div>}
    {job && job.status !== 'completed' && <div className="insight-progress" role="status">
      {job.status === 'queued' ? 'AI analysis is queued.' : job.status === 'running' ?
        `AI analysis is running; ${progressText}. Completed report data is not yet available.` :
        `AI analysis failed (${job.error ?? 'unknown cause'}). No completed AI report is available.`}
    </div>}
    {!hasJob && <p className="insight-scope-note">No AI analysis has been requested for this dataset. Source charts are available independently.</p>}
    {dataset.records.length > 30 && !hasJob && <p className="insight-scope-note">This dataset exceeds the 30-record AI pilot limit; all source statistics remain available. Use a dataset of up to 30 records to request AI analysis.</p>}
    <div className="insight-chart-grid" id="insight-charts">
      <ChartPanel id="source-cat-chart" title="Grievances by source category"
        description="Categories provided in source data · percentage of all source records. Select a bar for cases."
        rows={metrics.sourceCategories} emptyText="No source categories available."
        onSelect={key => choose('source-category', key)} />
      <ChartPanel id="ai-cat-chart" title="Grievances by AI classification"
        description="Model-generated categories · percentage of successfully analyzed records, not the source-filtered view."
        rows={metrics.aiCategories} emptyText={availableAI ? 'No validated AI classifications.' : 'Requires a completed AI report.'}
        onSelect={key => choose('ai-category', key)} />
      <ChartPanel id="source-status-chart" title="Recorded case status"
        description="Source-reported only. Resolved means the source field says resolved; not independently verified."
        rows={metrics.statusRows} emptyText="No source statuses." onSelect={key => choose('source-status', key)} />
      <ChartPanel id="response-assessment-chart" title="Department response assessment"
        description="AI judgments from completed reports. Not applicable means analyzed without a response; unassessed includes missing/failed AI outputs."
        rows={metrics.assessmentRows} emptyText="No responses or assessments." onSelect={key => choose('assessment', key)} />
    </div>
    <section className="insight-urgency" aria-label="Potential urgency requiring human review">
      <div><CircleAlert size={20} aria-hidden /><div>
        <h3>Potential urgency: {availableAI ? formatCount(metrics.flaggedUrgent) : 'Not yet assessed'}</h3>
        <p>AI-flagged for human review only. No risk scores, verified threats, or priority ranks are inferred.</p>
      </div></div>
      <button type="button" className="btn btn-secondary btn-sm" disabled={metrics.flaggedUrgent === 0}
        onClick={() => choose('urgent', 'true')}>Inspect flagged cases</button>
    </section>
    {availableAI && scopedReport.categories.length > 0 && <section className="insight-category-summaries" aria-labelledby="ai-excerpts-heading">
      <h3 id="ai-excerpts-heading">Category excerpts from individual AI summaries</h3>
      <p>These excerpts are assembled from per-record AI summaries; they are not a separately generated category-level synthesis.</p>
      <div className="insight-excerpt-list">
        {scopedReport.categories.map(c => <article key={c.category}>
          <h4>{c.category} · {formatCount(c.count)} analyzed</h4>
          <p lang="te" className="insight-telugu">{c.summaryTe}</p>
          <small>Cases: {c.sourceIds.join(', ')}</small>
        </article>)}
      </div>
    </section>}
    <section className="insight-drilldown" aria-labelledby="insight-drilldown-title">
      <div className="insight-drilldown-header">
        <div><span className="insight-eyebrow"><ListFilter size={14} aria-hidden /> CASE DRILL-DOWN</span>
          <h3 id="insight-drilldown-title">{selection ? `Matching cases · ${formatCount(matching.length)}` : 'Explore cases behind the figures'}</h3>
          <p>{selection ? `Selected ${selection.kind.replaceAll('-', ' ')}: ${selection.value}. Charts cover all ${formatCount(metrics.total)} source records.` :
            'Select any nonzero chart bar or an urgency flag to inspect its underlying cases.'}</p>
        </div>
        {selection && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
          setSelection(null); setEvidenceId(null);
        }}>Clear selection</button>}
      </div>
      {selection && (matching.length === 0 ? <p className="insight-empty">No matching cases.</p> : <>
        <ul className="insight-match-list" aria-label="Matching grievance records">
          {matching.slice(0, limit).map(r => <li key={r.id}>
            <button type="button" className="insight-match-button" aria-expanded={evidenceId === r.id}
              onClick={() => setEvidenceId(x => x === r.id ? null : r.id)}>
              <span>{r.id} <small>{categoryOf(r)} · source: {r.status.replace('_', ' ')}</small></span>
              <span>{evidenceId === r.id ? 'Hide evidence' : 'Inspect evidence'}</span>
            </button>
          </li>)}
        </ul>
        {matching.length > limit && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLimit(n => n + 20)}>
          Show more cases ({formatCount(matching.length - limit)} remaining)
        </button>}
        {evidence && <CaseEvidence record={evidence} report={scopedReport} onOpenRecord={onOpenRecord} />}
      </>)}
    </section>
    <footer className="insight-footer">
      <CheckCircle2 size={15} aria-hidden /> Source record exploration, filters, ZIP exports and deterministic Markdown/print reporting remain separate from AI-assisted results.
    </footer>
  </section>;
}
