import { ArrowRight, CalendarDays, FileText, FlaskConical, Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { categoryOf, hasResponse, UNCATEGORIZED, type Dataset, type GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { buildDashboard } from '../utils/dashboard';
import { describeDateRange } from '../utils/recordSearch';
import { formatCount, formatDate, formatPercent, percentOf } from '../utils/format';
import { DateRangeFilter } from './DateRangeFilter';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';

export type BrowseTarget = { category?: string; response?: 'provided' | 'missing' };

type Props = {
  dataset: Dataset;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  onBrowse: (target: BrowseTarget) => void;
  onOpenRecord: (id: string) => void;
  /** Open the summary workflow; `range` summarises only the dashboard date range. */
  onSummarize: (scope: 'all' | 'range') => void;
  /** True when reports come from an AI service rather than server/browser aggregation. */
  aiSummary: boolean;
};

function ResponseChip({ record }: { record: GrievanceRecord }) {
  return hasResponse(record) ? (
    <span className="response-pill response-pill--available">Response available</span>
  ) : (
    <span className="response-pill response-pill--none">No response</span>
  );
}

export function DashboardPage({ dataset, from, to, onRangeChange, onBrowse, onOpenRecord, onSummarize, aiSummary }: Props) {
  const { categoryLabel } = useI18n();
  const rangeActive = from !== '' || to !== '';
  const d = useMemo(() => buildDashboard(dataset.records, from, to), [dataset, from, to]);
  const { stats } = d;
  const total = stats.total;
  const maxCount = Math.max(1, ...d.categories.map((c) => c.count));
  const rangeText = rangeActive ? describeDateRange(from, to) : 'all dates';
  const datasetEmpty = dataset.records.length === 0;

  const kpis: Array<{ key: string; label: string; value: number; sub: string; target: BrowseTarget | null; action: string }> = [
    {
      key: 'total',
      label: 'Total complaints',
      value: stats.total,
      sub: rangeActive ? `of ${formatCount(dataset.records.length)} loaded · ${rangeText}` : 'All loaded records',
      target: {},
      action: 'Open all complaints',
    },
    {
      key: 'with',
      label: 'Response available',
      value: stats.withResponse,
      sub: `${formatPercent(percentOf(stats.withResponse, total))} of complaints · not the same as resolved`,
      target: { response: 'provided' },
      action: 'Browse complaints with a response',
    },
    {
      key: 'none',
      label: 'No response',
      value: stats.missingResponse,
      sub: `${formatPercent(percentOf(stats.missingResponse, total))} of complaints · no response text recorded`,
      target: { response: 'missing' },
      action: 'Browse complaints without a response',
    },
    {
      key: 'cats',
      label: 'Categories',
      value: d.knownCategories,
      sub:
        d.uncategorized > 0
          ? `+ ${formatCount(d.uncategorized)} uncategorized ${d.uncategorized === 1 ? 'record' : 'records'}`
          : 'Distinct categories in the data',
      target: null,
      action: '',
    },
  ];

  const outcome = [
    { key: 'resolved', seg: 'resolved', label: 'resolved', n: stats.byStatus.resolved },
    { key: 'in_progress', seg: 'progress', label: 'in progress', n: stats.byStatus.in_progress },
    { key: 'pending', seg: 'pending', label: 'pending', n: stats.byStatus.pending },
    { key: 'unknown', seg: 'unknown', label: 'not recorded', n: stats.byStatus.unknown },
  ] as const;
  const outcomeLabel = `Status recorded in source across ${formatCount(total)} complaints: ${outcome.map((o) => `${formatCount(o.n)} ${o.label}`).join(', ')}`;

  return (
    <main className="main" id="main">
      <div className="main-inner dashboard-container">
        <div className="dashboard-top-bar">
          <div className="dashboard-title-block">
            <h1>Dashboard</h1>
            <p className="dashboard-subtitle">
              Every figure is computed from the loaded records. Currently loaded: <strong>{dataset.name}</strong>
            </p>
            {dataset.isSynthetic && (
              <span className="dashboard-demo-banner">
                <FlaskConical size={13} aria-hidden />
                Demo data: every record is synthetic. Nothing here describes real CM Helpline activity.
              </span>
            )}
          </div>
          <DateRangeFilter toolbar from={from} to={to} onChange={onRangeChange} label="Submission date range" />
        </div>

        {rangeActive && (
          <div className="notice notice--warn dash-range-note" role="status">
            <CalendarDays size={16} aria-hidden />
            <span>
              <strong>Date range active:</strong> {rangeText}. It applies to the figures, category chart and recent complaints on this page
              {d.undatedExcluded > 0 ? `; ${formatCount(d.undatedExcluded)} records with no submission date are excluded` : ''}. Opening a figure or
              category carries the range into Complaints.
            </span>
          </div>
        )}

        <section className="dashboard-kpi-strip" aria-label="Key figures">
          <div className="dashboard-kpi-grid">
            {kpis.map((k) => {
              const inner = (
                <>
                  <span className="kpi-cell-top">
                    <span className="kpi-label">{k.label}</span>
                  </span>
                  <span className="kpi-value num">{formatCount(k.value)}</span>
                  <span className="kpi-sub">{k.sub}</span>
                </>
              );
              const target = k.target;
              return target ? (
                <button
                  key={k.key}
                  type="button"
                  className="kpi-cell kpi-cell--link"
                  aria-label={`${k.label}: ${formatCount(k.value)}. ${k.sub}. ${k.action}`}
                  onClick={() => onBrowse(target)}
                >
                  {inner}
                </button>
              ) : (
                <div key={k.key} className="kpi-cell" role="group" aria-label={`${k.label}: ${formatCount(k.value)}. ${k.sub}`}>
                  {inner}
                </div>
              );
            })}
          </div>
          {total > 0 && (
            <div className="kpi-status-footer">
              <div className="kpi-proportional-bar" role="img" aria-label={outcomeLabel}>
                {outcome
                  .filter((o) => o.n > 0)
                  .map((o) => (
                    <span key={o.key} className={`kpi-bar-seg kpi-bar-seg--${o.seg}`} style={{ flexGrow: o.n }} title={`${formatCount(o.n)} ${o.label}`} />
                  ))}
              </div>
              <ul className="kpi-status-legend" aria-label="Status recorded in source">
                <li className="legend-lead">Status recorded in source:</li>
                {outcome.map((o) => (
                  <li key={o.key}>
                    <span className={`legend-dot legend-dot--${o.seg}`} aria-hidden />
                    <b className="num">{formatCount(o.n)}</b> {o.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="dashboard-main-grid">
          <section className="dashboard-panel-card" aria-labelledby="cat-h">
            <div className="panel-card-head">
              <h2 id="cat-h">Complaints by category</h2>
              <span className="panel-card-meta">
                {formatCount(total)} complaints · {rangeText}
              </span>
            </div>
            {total === 0 ? (
              <EmptyState icon={<Inbox size={26} aria-hidden />}>
                {datasetEmpty ? 'No records are loaded. Import a file or switch back to the sample dataset.' : 'No complaints fall inside this date range.'}
              </EmptyState>
            ) : (
              <ul className="category-bar-list">
                {d.categories.map((c) => {
                  const share = formatPercent(percentOf(c.count, total));
                  const unc = c.name === UNCATEGORIZED;
                  return (
                    <li key={c.name}>
                      <button
                        type="button"
                        className="category-bar-row"
                        title={`${categoryLabel(c.name)}: ${formatCount(c.count)} complaints (${share} of ${formatCount(total)}); ${formatCount(c.withResponse)} with a response`}
                        aria-label={`${categoryLabel(c.name)}: ${formatCount(c.count)} complaints, ${share}. Open in Complaints`}
                        onClick={() => onBrowse({ category: c.name })}
                      >
                        <span className={`category-name ${unc ? 'category-name--unc' : ''}`}>{categoryLabel(c.name)}</span>
                        <span className="category-bar-track" aria-hidden>
                          <span className={`category-bar-fill ${unc ? 'category-bar-fill--unc' : ''}`} style={{ width: `${(c.count / maxCount) * 100}%` }} />
                        </span>
                        <span className="category-count num">{formatCount(c.count)}</span>
                        <span className="category-pct num">{share}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="chart-foot">
              Percentages use {formatCount(total)} complaints as the denominator. Select a bar to open that category in Complaints.
            </p>
          </section>

          <section className="dashboard-panel-card" aria-labelledby="recent-h">
            <div className="panel-card-head">
              <h2 id="recent-h">Recent complaints</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBrowse({})}>
                View all
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
            {d.recent.length === 0 ? (
              <EmptyState icon={<Inbox size={26} aria-hidden />}>
                {total === 0 ? 'No complaints to show.' : 'No complaints in range have a submission date.'}
              </EmptyState>
            ) : (
              <ul className="recent-list">
                {d.recent.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="recent-complaint-card" onClick={() => onOpenRecord(r.id)} aria-label={`Open ${r.id}`}>
                      <span className="row-top">
                        <span className="case-id">{r.id}</span>
                        <ResponseChip record={r} />
                      </span>
                      <span className="row-text te" lang={r.language === 'en' ? 'en' : 'te'}>
                        {r.complaintText}
                      </span>
                      <span className="row-meta">
                        <span className="row-meta-left">
                          <span className="cat">{categoryLabel(categoryOf(r))}</span>
                          <span className="row-date">
                            <CalendarDays size={12} aria-hidden />
                            {formatDate(r.submittedAt)}
                          </span>
                        </span>
                        <StatusBadge status={r.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="dashboard-panel-card cta" aria-labelledby="cta-h">
          <div className="cta-copy">
            <h2 id="cta-h">Consolidated summary</h2>
            <p>
              One report across the whole collection: categories, response coverage, themes, recorded responses and data limits. This will summarise{' '}
              <strong className="num">{formatCount(dataset.records.length)}</strong> records (all records).{' '}
              {aiSummary ? 'The report is written by the AI summary service.' : 'The report is computed from the records and is not AI-generated.'}
            </p>
          </div>
          <div className="cta-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => onSummarize('all')} disabled={datasetEmpty}>
              <FileText size={16} aria-hidden />
              Generate Consolidated Summary
            </button>
            {rangeActive && (
              <button type="button" className="btn btn-secondary" onClick={() => onSummarize('range')} disabled={total === 0}>
                Summarize only this date range ({formatCount(total)})
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
