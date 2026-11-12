import { useEffect, useState } from 'react';
import type { GrievanceRecord } from '../domain/grievance';
import { createAnalysis, listAnalyses, readAnalysis, readAnalysisResults, type AnalysisJob, type AnalysisReport } from '../services/analysisApi';
import { triggerDownload } from '../utils/downloads';

type Props = {
  datasetId: string;
  records: GrievanceRecord[];
  onStateChange: (datasetId: string, job: AnalysisJob | null, report: AnalysisReport | null) => void;
};

/** One authenticated job reader shared with the dashboard; never infer results from an in-flight job. */
export function AnalysisWorkspace({ datasetId, records, onStateChange }: Props) {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { onStateChange(datasetId, job, report); }, [datasetId, job, report, onStateChange]);

  useEffect(() => {
    let active = true;
    let current: AnalysisJob | null = null;
    let reportLoaded = false;
    const tick = async () => {
      try {
        const next = current ? await readAnalysis(current.id) : (await listAnalyses(datasetId))[0] ?? null;
        if (!active) return;
        current = next;
        setJob(next);
        if (next?.status === 'completed' && !reportLoaded) {
          const output = await readAnalysisResults(next.id);
          if (!active) return;
          if (output.job.id !== next.id || output.report.datasetId !== datasetId || output.report.jobId !== next.id) {
            throw new Error('The AI report belongs to another dataset or job.');
          }
          reportLoaded = true;
          setReport(output.report);
        } else if (next?.status !== 'completed') {
          setReport(null);
        }
        if (active) setError('');
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to retrieve the AI job.');
      } finally { if (active) setLoading(false); }
    };
    void tick();
    const timer = window.setInterval(() => {
      if (!current || current.status === 'queued' || current.status === 'running' ||
        (current.status === 'completed' && !reportLoaded)) void tick();
    }, 7000);
    return () => { active = false; window.clearInterval(timer); };
  }, [datasetId]);

  async function start() {
    if (records.length === 0 || records.length > 30) return;
    setBusy(true);
    setError('');
    try {
      const response = await createAnalysis(datasetId);
      if (response.job.datasetId !== datasetId) throw new Error('Server returned an analysis for another dataset.');
      setJob(response.job);
      if (response.job.status === 'completed') {
        const output = await readAnalysisResults(response.job.id);
        if (output.report.datasetId !== datasetId || output.report.jobId !== response.job.id) {
          throw new Error('Server returned an unrelated analysis report.');
        }
        setReport(output.report);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start AI analysis.');
    } finally { setBusy(false); }
  }
  function download() {
    if (!report || job?.status !== 'completed') return;
    triggerDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }),
      'grievance-ai-analysis-' + report.jobId + '.json');
  }

  return <section className="analysis-control" aria-label="AI analysis job and export">
    <header>
      <div><h2>AI analysis</h2>
        <p>Available only for persisted AWS datasets of 1–30 records. Completed AI interpretations appear in the dashboard; deterministic reporting stays separate.</p>
      </div>
      {job?.status === 'completed' && report && <button className="btn btn-secondary btn-sm" type="button" onClick={download}>Export validated AI JSON</button>}
    </header>
    {loading && <p role="status">Checking for a saved AI analysis…</p>}
    {!loading && !job && <div className="analysis-action-row">
      <button type="button" className="btn btn-primary" disabled={busy || records.length === 0 || records.length > 30}
        onClick={() => void start()}>{busy ? 'Submitting…' : 'Analyze with AI'}</button>
      {records.length > 30 ? <p>This dataset exceeds the 30-record AI pilot limit. Source analytics remain available above.</p> :
        records.length === 0 ? <p>Select a nonempty dataset first.</p> : <p>No AI job has been requested for this dataset.</p>}
    </div>}
    {job && <div className="analysis-progress" role="status">
      <strong>Job: {job.status}</strong> <span>{job.processed}/{job.total} records checkpointed · {job.failureCount} recorded failures</span>
      {job.status === 'queued' && <p>Queued for processing. The dashboard will not display AI conclusions until the report completes.</p>}
      {job.status === 'running' && <p>Processing asynchronously. You may refresh; this job will remain available.</p>}
      {job.status === 'completed' && report && <p>Validated report available. <a href="#insight-charts">Inspect category and assessment charts</a> or <a href="#insight-drilldown-title">inspect case evidence</a>.</p>}
      {job.status === 'failed' && <p className="analysis-error" role="alert">
        {job.error === 'all_records_failed' ? 'No records produced a usable AI analysis. All failures have been counted; no completed report is available.' :
          'The AI job failed. No verified outcome or successful AI report is available.'}
        {job.error && <> Failure code: {job.error}.</>}
      </p>}
    </div>}
    {error && <p role="alert" className="analysis-error">{error}</p>}
  </section>;
}
