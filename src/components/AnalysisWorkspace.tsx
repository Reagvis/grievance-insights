import { useEffect, useState } from 'react';
import type { GrievanceRecord } from '../domain/grievance';
import { createAnalysis, retryAnalysis, listAnalyses, readAnalysis, readAnalysisResults, type AnalysisJob, type AnalysisReport } from '../services/analysisApi';
import { triggerDownload } from '../utils/downloads';

type Props = {
  datasetId: string;
  records: GrievanceRecord[];
  onStateChange: (datasetId: string, job: AnalysisJob | null, report: AnalysisReport | null,
    loading: boolean, error: string) => void;
};

/** One authenticated job reader shared with the dashboard; never infer results from an in-flight job. */
export function AnalysisWorkspace({ datasetId, records, onStateChange }: Props) {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { onStateChange(datasetId, job, report, loading, error); }, [datasetId, job, report, loading, error, onStateChange]);

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
      if (!current || current.status === 'queued' || current.status === 'running' || current.status === 'failed' ||
        (current.status === 'completed' && !reportLoaded)) void tick();
    }, 7000);
    return () => { active = false; window.clearInterval(timer); };
  }, [datasetId]);

  async function start() {
    if (records.length === 0 || records.length > 2000) return;
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
  async function retry(mode: 'resume' | 'fresh') {
    if (!job || job.status !== 'failed') return;
    setBusy(true);
    setError('');
    try {
      const response = await retryAnalysis(job.id, mode);
      setReport(null);
      setJob(response.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not retry analysis.');
    } finally { setBusy(false); }
  }
  function download() {
    if (!report || job?.status !== 'completed') return;
    triggerDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }),
      'grievance-ai-analysis-' + report.jobId + '.json');
  }

  return <section className="analysis-control" aria-label="AI analysis job and export">
    <header>
      <div><h3>Run the analysis</h3>
        <p>Works on files of 1–2,000 complaints. Results appear below once the analysis finishes; the Consolidated Summary stays separate and is not AI.</p>
      </div>
      {job?.status === 'completed' && report && <button className="btn btn-secondary btn-sm" type="button" onClick={download}>Export validated AI JSON</button>}
    </header>
    {loading && <p role="status">Checking for a saved AI analysis…</p>}
    {!loading && !job && <div className="analysis-action-row">
      <button type="button" className="btn btn-primary" disabled={busy || records.length === 0 || records.length > 2000}
        onClick={() => void start()}>{busy ? 'Submitting…' : 'Analyze with AI'}</button>
      {records.length > 2000 ? <p>This file has more than 2,000 complaints, which is the limit for AI analysis.</p> :
        records.length === 0 ? <p>This file has no complaints to analyse.</p> : <p>No AI analysis has been run on this file yet.</p>}
    </div>}
    {job && <div className="analysis-progress" role="status">
      <strong>Job: {job.status}</strong> <span>{job.processed}/{job.total} records checkpointed · {job.failureCount} recorded failures</span>
      {job.status === 'queued' && <p>Queued for processing. Results appear here when the analysis finishes.</p>}
      {job.status === 'running' && <p>Processing asynchronously. You may refresh; this job will remain available.</p>}
      {job.status === 'completed' && report && <p>Finished. The results are below, and you can export them.</p>}
      {job.status === 'failed' && <p className="analysis-error" role="alert">
        {job.error === 'all_records_failed' ? 'No records produced a usable AI analysis. All failures have been counted; no completed report is available.' :
          'The AI job failed. No verified outcome or successful AI report is available.'}
        {job.error && <> Failure code: {job.error}.</>}
      </p>}
      {job.status === 'failed' && (job.error === 'queue_unavailable' || job.error === 'retries_exhausted') &&
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void retry('resume')}>{busy ? 'Retrying…' : 'Retry interrupted job'}</button>}
      {job.status === 'failed' && ['all_records_failed', 'retries_exhausted', 'queue_unavailable'].includes(job.error ?? '') &&
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void retry('fresh')}>
          {busy ? 'Submitting…' : 'Start fresh AI analysis attempt'}
        </button>}
      {job.status === 'failed' && ['all_records_failed', 'retries_exhausted', 'queue_unavailable'].includes(job.error ?? '') &&
        <p>Fresh analysis creates a new immutable result generation. Earlier attempts remain private and unchanged.</p>}
    </div>}
    {error && <p role="alert" className="analysis-error">{error}</p>}
  </section>;
}
