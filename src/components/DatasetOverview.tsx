import type { DatasetStats } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { formatCount, formatPercent, percentOf } from '../utils/format';

/** Four metrics computed from the loaded dataset (never from the filtered view). */
export function DatasetOverview({ stats }: { stats: DatasetStats }) {
  const { t, statusLabel } = useI18n();
  const pct = (n: number) => formatPercent(percentOf(n, stats.total));
  // Bar widths come straight from the status counts — no minimum "visual weight" padding.
  const segments = [
    { key: 'resolved', n: stats.byStatus.resolved },
    { key: 'in_progress', n: stats.byStatus.in_progress },
    { key: 'pending', n: stats.byStatus.pending },
    { key: 'unknown', n: stats.byStatus.unknown },
  ] as const;
  const barLabel = `Outcome status across all ${stats.total} records: ${segments
    .map((s) => `${statusLabel(s.key)} ${s.n} (${pct(s.n)})`)
    .join(', ')}`;

  return (
    <section className="overview" aria-label={t('overviewTitle')}>
      <div className="overview-grid">
        <div className="metric">
          <span className="metric-label">{t('totalRecords')}</span>
          <span className="metric-value">{formatCount(stats.total)}</span>
          <span className="metric-sub">
            {formatCount(stats.categoryCount)} {stats.categoryCount === 1 ? 'category' : 'categories'}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">
            <span className="legend-swatch swatch-response" aria-hidden />
            {t('withResponse')}
          </span>
          <span className="metric-value">{formatCount(stats.withResponse)}</span>
          <span className="metric-sub">{pct(stats.withResponse)} · not the same as resolved</span>
        </div>
        <div className="metric">
          <span className="metric-label">
            <span className="legend-swatch legend-dot seg-resolved" aria-hidden />
            {t('resolved')}
          </span>
          <span className="metric-value">{formatCount(stats.byStatus.resolved)}</span>
          <span className="metric-sub">{pct(stats.byStatus.resolved)} · per source status</span>
        </div>
        <div className="metric">
          <span className="metric-label">
            <span className="legend-swatch swatch-unknown" aria-hidden />
            {t('outcomeUnknown')}
          </span>
          <span className="metric-value">{formatCount(stats.byStatus.unknown)}</span>
          <span className="metric-sub">
            {pct(stats.byStatus.unknown)} · {formatCount(stats.byStatus.pending + stats.byStatus.in_progress)} more pending or in progress
          </span>
        </div>
      </div>
      {stats.total > 0 && (
        <div className="overview-bar" role="img" aria-label={barLabel}>
          {segments
            .filter((s) => s.n > 0)
            .map((s) => (
              <span key={s.key} className={`seg-${s.key}`} style={{ flexGrow: s.n }} title={`${statusLabel(s.key)}: ${formatCount(s.n)} (${pct(s.n)})`} />
            ))}
        </div>
      )}
    </section>
  );
}
