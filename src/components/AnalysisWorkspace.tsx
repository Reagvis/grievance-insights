import { useEffect, useState } from 'react';
import type { GrievanceRecord } from '../domain/grievance';
import { createAnalysis, listAnalyses, readAnalysis, readAnalysisResults, type AnalysisJob, type AnalysisReport } from '../services/analysisApi';
import { triggerDownload } from '../utils/downloads';

export function AnalysisWorkspace({ datasetId, records }: { datasetId: string; records: GrievanceRecord[] }) {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const source = new Map(records.map(r => [r.id, r]));
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
        if (next?.status === 'completed') {
          const output = await readAnalysisResults(next.id);
          if (active) { reportLoaded = true; setReport(output.report); setError(''); }
        }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Could not load AI analysis.'); }
    };
    void tick();
    const timer = window.setInterval(() => {
      if (!current || current.status === 'queued' || current.status === 'running' ||
          (current.status === 'completed' && !reportLoaded)) void tick();
    }, 7000);
    return () => { active = false; window.clearInterval(timer); };
  }, [datasetId]);
  async function start() {
    setBusy(true); setError('');
    try {
      const next = await createAnalysis(datasetId);
      setJob(next.job);
      if (next.job.status === 'completed') setReport((await readAnalysisResults(next.job.id)).report);
      else if (next.job.status === 'failed') setError(next.job.error ?? 'Analysis failed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start analysis.'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    triggerDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }),
      'grievance-ai-analysis-' + report.jobId + '.json');
  }
  return <section className="notice notice--info dataset-notice" aria-label="AI-assisted grievance analysis">
    <div style={{ width: '100%' }}>
      <h2>AI-assisted grievance analysis</h2>
      <p>Qwen3-32B · Telugu · requires human review. Department claims are not verified resolutions.
        Deterministic summaries remain available below.</p>
      {!job && <button type="button" className="btn btn-primary" disabled={busy || records.length > 30}
        onClick={() => void start()}>{busy ? 'Submitting…' : 'Analyze with AI'}</button>}
      {records.length > 30 && !job && <p role="status">AI pilot limit: 30 records. Import a smaller dataset for AI processing.</p>}
      {job && <div role="status">
        <strong>Analysis status: {job.status}</strong> · {job.processed}/{job.total} records processed
        {job.failureCount > 0 ? ' · ' + job.failureCount + ' record failures' : ''}
        {job.error ? ' · ' + job.error : ''}
      </div>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {job?.status === 'completed' && !report && <p>Loading validated results…</p>}
      {report && <>
        <div className="import-stats">
          <div><strong>{report.stats.grievances}</strong><span>Grievances</span></div>
          <div><strong>{report.stats.potentiallyUrgent}</strong><span>Potential urgency (AI)</span></div>
          <div><strong>{report.stats.responsesRelevant}</strong><span>Responses appearing relevant (AI)</span></div>
          <div><strong>{report.stats.failed}</strong><span>Failed records</span></div>
        </div>
        <p><strong>Deterministic counts</strong> from validated AI classifications: {report.stats.withResponses} with department responses,
          {report.stats.responsesInsufficient} insufficient, {report.stats.responsesInconclusive} inconclusive.
          Interpretations and categories are AI-generated.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={download}>Export validated AI results (JSON)</button>
        <h3>Category-level analysis</h3>
        <table className="preview-table"><thead><tr><th>Category</th><th>Count</th><th>AI-assisted Telugu synthesis</th></tr></thead>
          <tbody>{report.categories.map(c => <tr key={c.category}><td>{c.category}</td><td>{c.count}</td>
            <td lang="te" className="te">{c.summaryTe}<small> Source IDs: {c.sourceIds.join(', ')}</small></td></tr>)}</tbody></table>
        <h3>Individual grievance analyses</h3>
        <ul className="details-list">
          {report.outcomes.map(item => <li key={item.id}>
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded === item.id}
              onClick={() => setExpanded(x => x === item.id ? null : item.id)}>{item.id} — {item.analysis?.category ?? 'Analysis failed'}</button>
            {expanded === item.id && <div>
              {item.failure ? <p>Analysis unavailable: {item.failure}.</p> : item.analysis && <>
                <p><strong>Original complaint:</strong> <span lang="te" className="te">{source.get(item.id)?.complaintText}</span></p>
                <p><strong>AI complaint summary:</strong> <span lang="te" className="te">{item.analysis.complaintSummary}</span></p>
                <p><strong>Issue:</strong> {item.analysis.issueClassification ?? 'Not classified'} · <strong>Requested action:</strong> {item.analysis.requestedAction ?? 'Not stated'}</p>
                <p><strong>Potentially urgent:</strong> {item.analysis.potentiallyUrgent ? 'Yes — human review required' : 'Not flagged'} {item.analysis.urgencyReason}</p>
                <p><strong>Complaint evidence (verbatim):</strong> <span lang="te" className="te">{item.analysis.complaintEvidence}</span></p>
                <p><strong>Original department response:</strong> <span lang="te" className="te">{source.get(item.id)?.responseText ?? 'No response provided'}</span></p>
                <p><strong>AI response summary:</strong> {item.analysis.responseSummary ?? 'Not available'}</p>
                <p><strong>Department claims:</strong> {item.analysis.departmentClaim ?? 'No explicit claim identified'}</p>
                <p><strong>Response assessment:</strong> {item.analysis.responseRelevance} — {item.analysis.responseAssessment ?? 'Not applicable'}</p>
                <p><strong>Response evidence (verbatim):</strong> <span lang="te" className="te">{item.analysis.responseEvidence ?? 'Not available'}</span></p>
                <p><strong>Verified outcome:</strong> Not verified; independent verification required.</p>
              </>}
            </div>}
          </li>)}
        </ul>
      </>}
    </div>
  </section>;
}
