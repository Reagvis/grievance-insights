import { useCallback, useState } from 'react';
import type { GrievanceRecord } from '../domain/grievance';
import { ASSESSMENT_LABELS } from '../domain/insights';
import type { AnalysisJob, AnalysisReport } from '../services/analysisApi';
import { AnalysisWorkspace } from './AnalysisWorkspace';

type Snapshot = { datasetId: string; job: AnalysisJob | null; report: AnalysisReport | null; loading: boolean; error: string };
type Props = {
  /** Uploaded files that are ready, newest first. */
  files: Array<{ id: string; name: string; count: number }>;
  recordsByDataset: ReadonlyMap<string, GrievanceRecord[]>;
  /** The ID a complaint has in the combined list (IDs repeated across files are renamed there). */
  mergedIdOf: (datasetId: string, originalId: string) => string | undefined;
  onOpenRecord: (id: string) => void;
  /** File to show first (the file of the complaint that is open). */
  preferredFileId?: string;
  /** ID (in the combined list) of the complaint that is open, if any. */
  selectedId?: string;
};

const label = (category: string) => category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function CaseChips({ datasetId, ids, mergedIdOf, onOpenRecord, limit = 8 }: { datasetId: string; ids: string[]; mergedIdOf: Props['mergedIdOf']; onOpenRecord: Props['onOpenRecord']; limit?: number }) {
  return (
    <span className="ai-chips">
      {ids.slice(0, limit).map((id) => {
        const merged = mergedIdOf(datasetId, id);
        return merged ? (
          <button key={id} type="button" className="case-chip" onClick={() => onOpenRecord(merged)} title="Open this complaint">{id}</button>
        ) : (
          <span key={id} className="case-chip case-chip--unknown" title="This complaint is no longer in your list.">{id}</span>
        );
      })}
      {ids.length > limit && <span className="ai-more">+{ids.length - limit} more</span>}
    </span>
  );
}

/** Compact, read-only view of a finished AI report: counts, urgent complaints and per-category notes, each linking back to the complaint. */
export function AnalysisResults({ datasetId, job, report, mergedIdOf, onOpenRecord }: { datasetId: string; job: AnalysisJob | null; report: AnalysisReport | null } & Pick<Props, 'mergedIdOf' | 'onOpenRecord'>) {
  if (!report || job?.status !== 'completed') return null;
  const s = report.stats;
  const categories = Object.entries(s.categoryCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const urgent = report.outcomes.filter((o) => o.analysis?.potentiallyUrgent);
  return (
    <div className="ai-results">
      <p className="ai-caveat">AI-assisted interpretation of the complaint text. Nothing here confirms that a problem was fixed.</p>
      <dl className="ai-stats">
        <div><dt>Analysed</dt><dd>{s.analyzed} of {s.grievances}{s.failed > 0 ? <small> · {s.failed} could not be analysed</small> : null}</dd></div>
        <div><dt>Potentially urgent</dt><dd>{s.potentiallyUrgent}</dd></div>
        <div><dt>With a response</dt><dd>{s.withResponses}</dd></div>
      </dl>

      {s.withResponses > 0 && (
        <section>
          <h4>Is the department response relevant?</h4>
          <ul className="ai-bars">
            <li><span>{ASSESSMENT_LABELS.relevant ?? 'Relevant'}</span><strong>{s.responsesRelevant}</strong></li>
            <li><span>{ASSESSMENT_LABELS.insufficient ?? 'Insufficient'}</span><strong>{s.responsesInsufficient}</strong></li>
            <li><span>{ASSESSMENT_LABELS.inconclusive ?? 'Inconclusive'}</span><strong>{s.responsesInconclusive}</strong></li>
          </ul>
        </section>
      )}

      {categories.length > 0 && (
        <section>
          <h4>By AI category</h4>
          <ul className="ai-bars">
            {categories.map(([name, n]) => (
              <li key={name}><span>{label(name)}</span><strong>{n}</strong></li>
            ))}
          </ul>
        </section>
      )}

      {urgent.length > 0 && (
        <section>
          <h4>Potentially urgent</h4>
          <ul className="ai-urgent">
            {urgent.map((o) => (
              <li key={o.id}>
                <CaseChips datasetId={datasetId} ids={[o.id]} mergedIdOf={mergedIdOf} onOpenRecord={onOpenRecord} />
                {o.analysis?.urgencyReason && <span lang="te">{o.analysis.urgencyReason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.categories.length > 0 && (
        <section>
          <h4>What each category is about</h4>
          {report.categories.map((c) => (
            <div key={c.category} className="ai-category">
              <strong>{label(c.category)} · {c.count}</strong>
              <p lang="te">{c.summaryTe}</p>
              <CaseChips datasetId={datasetId} ids={c.sourceIds} mergedIdOf={mergedIdOf} onOpenRecord={onOpenRecord} />
            </div>
          ))}
        </section>
      )}
      <p className="ai-meta">Model {report.modelId} · {new Date(report.generatedAt).toLocaleString('en-IN')}</p>
    </div>
  );
}

const RELEVANCE: Record<string, string> = { relevant: 'Relevant', insufficient: 'Insufficient', inconclusive: 'Inconclusive', not_applicable: 'No response to assess' };

/** The AI's reading of the one complaint that is open (taken from its file's finished analysis). */
function ThisComplaint({ displayId, originalId, job, report }: { displayId: string; originalId: string | undefined; job: AnalysisJob | null; report: AnalysisReport | null }) {
  const done = report && job?.status === 'completed';
  const outcome = done && originalId ? report.outcomes.find((o) => o.id === originalId) : undefined;
  const a = outcome?.analysis;
  return (
    <section className="ai-this" aria-label="AI reading of the open complaint">
      <h4>This complaint · {displayId}</h4>
      {a ? (
        <>
          <p className="ai-this-line"><strong>{label(a.category)}</strong>{a.potentiallyUrgent ? <span className="ai-flag"> · Potentially urgent</span> : null}</p>
          <p lang="te">{a.complaintSummary}</p>
          {a.potentiallyUrgent && a.urgencyReason && <p lang="te" className="ai-this-urgent">{a.urgencyReason}</p>}
          <p className="ai-this-line">Response: {RELEVANCE[a.responseRelevance] ?? a.responseRelevance}{a.responseAssessment ? ` — ${a.responseAssessment}` : ''}</p>
        </>
      ) : outcome?.failure ? (
        <p className="ai-empty">The AI could not analyse this complaint.</p>
      ) : done ? (
        <p className="ai-empty">This complaint is not in the finished analysis of this file.</p>
      ) : (
        <p className="ai-empty">Not analysed yet. Run the analysis on this file below and this complaint's result will appear here.</p>
      )}
    </section>
  );
}

/** The Assistant's "AI analysis" mode: choose an uploaded file, start the analysis, watch progress, read and export the result. */
export function AiAnalysisPane({ files, recordsByDataset, mergedIdOf, onOpenRecord, preferredFileId, selectedId }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Opening a different complaint puts the tab back on that complaint's file.
  const [seenSelected, setSeenSelected] = useState(selectedId);
  if (seenSelected !== selectedId) {
    setSeenSelected(selectedId);
    setChosen(null);
  }
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const activeId = files.find((f) => f.id === chosen)?.id ?? files.find((f) => f.id === preferredFileId)?.id ?? files[0]?.id ?? null;
  const onState = useCallback((datasetId: string, job: AnalysisJob | null, report: AnalysisReport | null, loading: boolean, error: string) => {
    setSnapshot((prev) => (prev && prev.datasetId === datasetId && prev.job === job && prev.report === report && prev.loading === loading && prev.error === error ? prev : { datasetId, job, report, loading, error }));
  }, []);

  if (!activeId) {
    return (
      <div className="ai-pane">
        <p className="ai-empty">No files yet. Upload a file first, then come back to analyse it.</p>
      </div>
    );
  }
  const current = snapshot && snapshot.datasetId === activeId ? snapshot : null;
  const originalId = selectedId ? (recordsByDataset.get(activeId) ?? []).find((r) => mergedIdOf(activeId, r.id) === selectedId)?.id : undefined;
  return (
    <div className="ai-pane">
      <p className="ai-intro">
        The AI works on a <strong>whole file</strong> at a time, not a single complaint. It reads every complaint in the file, and the department response if there is one. It sorts each complaint into a category, summarises it in Telugu,
        flags anything potentially urgent and says whether the response looks relevant.
      </p>
      <label className="ai-file-picker">
        File{' '}
        <select className="select" value={activeId} onChange={(e) => setChosen(e.target.value)}>
          {files.map((f) => (
            <option key={f.id} value={f.id}>{f.name} ({f.count} {f.count === 1 ? 'complaint' : 'complaints'})</option>
          ))}
        </select>
      </label>
      {selectedId && originalId && <ThisComplaint displayId={selectedId} originalId={originalId} job={current?.job ?? null} report={current?.report ?? null} />}
      <AnalysisWorkspace key={activeId} datasetId={activeId} records={recordsByDataset.get(activeId) ?? []} onStateChange={onState} />
      <AnalysisResults datasetId={activeId} job={current?.job ?? null} report={current?.report ?? null} mergedIdOf={mergedIdOf} onOpenRecord={onOpenRecord} />
    </div>
  );
}
