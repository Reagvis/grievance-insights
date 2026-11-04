import { Cpu } from 'lucide-react';
import { forwardRef, useState, type ReactNode } from 'react';
import { UNCATEGORIZED } from '../domain/grievance';
import type { ConsolidatedSummary } from '../domain/summary';
import { formatCount, formatDateTime, formatPercent, percentOf } from '../utils/format';
import { dateSpanText, processingLabel, reportCaveat } from '../utils/summaryExport';

type Props = {
  summary: ConsolidatedSummary;
  stale: boolean;
  onOpenRecord: (id: string) => void;
};

function CaseRefs({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  if (ids.length === 0) return null;
  return (
    <span className="case-refs">
      {ids.map((id) => (
        <button key={id} type="button" className="case-link" onClick={() => onOpen(id)} aria-label={`Open case ${id}`}>
          {id}
        </button>
      ))}
    </span>
  );
}

function Section({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`report-section ${className ?? ''}`}>
      <h3>
        {title}
        {note && <small>{note}</small>}
      </h3>
      {children}
    </section>
  );
}

/** Keeps the printed report to one page even when imports carry many categories. */
const CATEGORY_ROWS = 10;

export const SummaryReport = forwardRef<HTMLElement, Props>(function SummaryReport({ summary: s, stale, onOpenRecord }, ref) {
  const t = s.totalRecords;
  const [showAllCategories, setShowAllCategories] = useState(false);
  const maxCount = Math.max(1, ...s.categories.map((c) => c.count));
  const collapse = s.categories.length > CATEGORY_ROWS && !showAllCategories;
  const visibleCategories = collapse ? s.categories.slice(0, CATEGORY_ROWS - 1) : s.categories;
  const hidden = collapse ? s.categories.slice(CATEGORY_ROWS - 1) : [];
  const hiddenCount = hidden.reduce((a, c) => a + c.count, 0);
  const outcomes = [
    { key: 'resolved', label: 'Resolved', n: s.resolvedCount },
    { key: 'in_progress', label: 'In progress', n: s.inProgressCount },
    { key: 'pending', label: 'Pending', n: s.pendingCount },
    { key: 'unknown', label: 'Status not recorded', n: s.unknownStatusCount },
  ];
  const outcomeText = outcomes.map((o) => `${o.label} ${o.n} (${formatPercent(percentOf(o.n, t))})`).join(', ');
  const facts = s.reportedActions.filter((a) => a.kind === 'fact');
  const excerpts = s.reportedActions.filter((a) => a.kind === 'excerpt');
  const cited = new Set<string>();
  s.categories.forEach((c) => c.exampleCaseIds.forEach((id) => cited.add(id)));
  excerpts.forEach((e) => e.caseIds.forEach((id) => cited.add(id)));
  const citedIds = [...cited].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  return (
    <article
      className={`report ${stale ? 'is-stale' : ''}`}
      aria-labelledby="report-title"
      ref={ref}
      tabIndex={-1}
      aria-describedby={stale ? 'stale-msg' : undefined}
    >
      <header className="report-head">
        <div className="report-title-row">
          <h2 className="report-title" id="report-title">
            {s.title}
          </h2>
          <span className="report-mode">
            <Cpu size={13} aria-hidden />
            {processingLabel(s.processingMode)}
          </span>
        </div>
        <p className="report-caveat">{reportCaveat(s)}</p>
        <dl className="report-meta">
          <div className="wide">
            <dt>Dataset</dt>
            <dd>{s.datasetName}</dd>
          </div>
          <div className="wide">
            <dt>Scope</dt>
            <dd>{s.scopeDescription}</dd>
          </div>
          <div>
            <dt>Records included</dt>
            <dd className="num">{formatCount(t)}</dd>
          </div>
          <div>
            <dt>Submission dates</dt>
            <dd>{dateSpanText(s)}</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>{formatDateTime(s.generatedAt)}</dd>
          </div>
          <div>
            <dt>Report language</dt>
            <dd>English · source quoted verbatim</dd>
          </div>
        </dl>
      </header>

      <Section title="Executive overview">
        <p className="overview-text">{s.executiveOverview}</p>
      </Section>

      <div className="report-grid">
        <Section title="Major issue categories" note="share of included records">
          <ol className="cat-list" aria-label="Categories ranked by number of complaints">
            {visibleCategories.map((c) => (
              <li key={c.category} className={`cat-row ${c.category === UNCATEGORIZED ? 'is-uncat' : ''}`}>
                <span className="cat-name" title={c.category}>
                  {c.category}
                </span>
                <span className="cat-track" aria-hidden>
                  <span className="cat-fill" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                </span>
                <span className="cat-count">{formatCount(c.count)}</span>
                <span className="cat-pct">{formatPercent(c.percentage)}</span>
              </li>
            ))}
            {hidden.length > 0 && (
              <li className="cat-row is-uncat">
                <span className="cat-name">{formatCount(hidden.length)} other categories</span>
                <span className="cat-track" aria-hidden>
                  <span className="cat-fill" style={{ width: `${Math.min(100, (hiddenCount / maxCount) * 100)}%` }} />
                </span>
                <span className="cat-count">{formatCount(hiddenCount)}</span>
                <span className="cat-pct">{formatPercent(percentOf(hiddenCount, t))}</span>
              </li>
            )}
          </ol>
          {s.categories.length > CATEGORY_ROWS && (
            <button type="button" className="btn btn-ghost btn-sm no-print" onClick={() => setShowAllCategories((v) => !v)}>
              {showAllCategories ? 'Show top categories only' : `Show all ${formatCount(s.categories.length)} categories`}
            </button>
          )}
        </Section>

        <Section title="Outcome coverage" note="explicit source status only">
          <div className="outcome-bar" role="img" aria-label={`Outcome status: ${outcomeText}`}>
            {outcomes
              .filter((o) => o.n > 0)
              .map((o) => (
                <span key={o.key} className={`seg-${o.key}`} style={{ flexGrow: o.n }} title={`${o.label}: ${o.n}`} />
              ))}
          </div>
          <ul className="legend">
            {outcomes.map((o) => (
              <li key={o.key}>
                <span className={`legend-swatch ${o.key === 'unknown' ? 'swatch-unknown' : `seg-${o.key}`}`} aria-hidden />
                <span>{o.label}</span>
                <span className="v">{formatCount(o.n)}</span>
                <span className="p">{formatPercent(percentOf(o.n, t))}</span>
              </li>
            ))}
          </ul>
          <p className="response-line">
            Response recorded for <strong>{formatCount(s.withResponseCount)}</strong> of {formatCount(t)} (
            {formatPercent(percentOf(s.withResponseCount, t))}). A response is not counted as a resolution.
          </p>
        </Section>
      </div>

      <Section title="Key recurring complaint themes" note="from category and issue-type fields">
        <ul className="report-list themes-grid">
          {s.themes.map((th) => (
            <li key={th.title}>
              <span className="theme-title">{th.title}.</span> {th.detail} <CaseRefs ids={th.caseIds} onOpen={onOpenRecord} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Responses and actions reported">
        <ul className="report-list">
          {facts.map((a) => (
            <li key={a.text}>{a.text}</li>
          ))}
        </ul>
        {excerpts.length > 0 && (
          <>
            <p className="excerpt-label">Sample response excerpts, quoted verbatim:</p>
            <div className="excerpts">
              {excerpts.map((e) => (
                <figure className="excerpt" key={e.caseIds.join()}>
                  <q className="te" lang="te">
                    {e.text}
                  </q>
                  <figcaption className="excerpt-meta">
                    <CaseRefs ids={e.caseIds} onOpen={onOpenRecord} />
                    {e.category && <span>{e.category}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </Section>

      <div className="report-grid two-col-print">
        <Section title="Priority observations">
          <ul className="report-list">
            {s.priorityObservations.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>
        <Section title="Data quality and limitations">
          <ul className="report-list report-list--quiet">
            {s.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      </div>

      <footer className="report-foot">
        <span>
          Sources and traceability: aggregated from {formatCount(t)} record(s) in “{s.datasetName}”.{' '}
          <span className="no-print">Example cases cited in this report:</span>
          <span className="print-inline">
            Example case IDs are cited beside each theme and excerpt; every included record is listed in the records export manifest.
          </span>
        </span>
        <span className="no-print">
          <CaseRefs ids={citedIds} onOpen={onOpenRecord} />
        </span>
      </footer>
    </article>
  );
});
