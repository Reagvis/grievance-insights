import { Clock3, ClipboardCopy, FileDown, Info, LoaderCircle, Printer, RefreshCw, TriangleAlert, FileText } from 'lucide-react';
import type { RefObject } from 'react';
import type { ConsolidatedSummary, SummaryScope } from '../domain/summary';
import { useI18n } from '../i18n/strings';
import { IS_STATIC_BUILD } from '../services/runtimeServices';
import { formatCount, formatDateTime } from '../utils/format';
import { SummaryReport } from './SummaryReport';

export type SummaryState = {
  status: 'idle' | 'generating' | 'ready' | 'error';
  summary: ConsolidatedSummary | null;
  error: string | null;
};

type Props = {
  scope: SummaryScope;
  onScopeChange: (scope: SummaryScope) => void;
  allCount: number;
  filteredCount: number;
  filtersActive: boolean;
  filtersDescription: string;
  included: { count: number; categories: number; dateSpan: string | null };
  state: SummaryState;
  stale: boolean;
  staleReason: string;
  isSynthetic: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onDownloadMarkdown: () => void;
  onPrint: () => void;
  onOpenRecord: (id: string) => void;
  reportRef: RefObject<HTMLElement | null>;
  generateRef: RefObject<HTMLButtonElement | null>;
};

const OUTLINE = [
  'Coverage and processing details',
  'Executive overview',
  'Major issue categories with shares',
  'Outcome coverage from source status',
  'Recurring themes, responses and actions',
  'Priority observations and data limitations',
];

/** Two tilted report pages — decorative only. */
function ReportSheetsIllustration() {
  return (
    <svg className="report-sheets" viewBox="0 0 220 200" fill="none" aria-hidden="true" focusable="false">
      <g transform="translate(38, 26) rotate(-14)">
        <rect x="0" y="0" width="110" height="142" rx="6" fill="#f8fafd" stroke="#cbd5e1" strokeWidth="1.5" />
        <rect x="14" y="14" width="68" height="9" rx="2.5" fill="#dce3ef" />
        <circle cx="20" cy="40" r="6" fill="#cbd5e1" />
        <rect x="34" y="36" width="58" height="4" rx="2" fill="#cbd5e1" />
        <rect x="34" y="43" width="42" height="4" rx="2" fill="#e2e8f0" />
        <circle cx="20" cy="64" r="6" fill="#cbd5e1" />
        <rect x="34" y="60" width="54" height="4" rx="2" fill="#cbd5e1" />
        <rect x="34" y="67" width="38" height="4" rx="2" fill="#e2e8f0" />
        <circle cx="20" cy="88" r="6" fill="#cbd5e1" />
        <rect x="34" y="84" width="60" height="4" rx="2" fill="#cbd5e1" />
        <rect x="34" y="91" width="46" height="4" rx="2" fill="#e2e8f0" />
      </g>
      <g transform="translate(96, 36) rotate(12)">
        <rect x="0" y="0" width="114" height="146" rx="6" fill="#ffffff" stroke="#b8c2d4" strokeWidth="1.5" />
        <rect x="14" y="14" width="76" height="10" rx="2.5" fill="#d3dbe8" />
        <rect x="14" y="32" width="84" height="4" rx="2" fill="#cbd5e1" />
        <rect x="14" y="40" width="78" height="4" rx="2" fill="#cbd5e1" />
        <rect x="14" y="48" width="60" height="4" rx="2" fill="#dce3ef" />
        <circle cx="21" cy="70" r="6.5" fill="#6b8a88" />
        <rect x="35" y="66" width="62" height="4.5" rx="2" fill="#94a3b8" />
        <rect x="35" y="74" width="48" height="4" rx="2" fill="#cbd5e1" />
        <circle cx="21" cy="96" r="6.5" fill="#89a7a5" />
        <rect x="35" y="92" width="58" height="4.5" rx="2" fill="#94a3b8" />
        <rect x="35" y="100" width="44" height="4" rx="2" fill="#cbd5e1" />
        <circle cx="21" cy="122" r="6.5" fill="#9bb5b3" />
        <rect x="35" y="118" width="64" height="4.5" rx="2" fill="#94a3b8" />
        <rect x="35" y="126" width="40" height="4" rx="2" fill="#cbd5e1" />
      </g>
    </svg>
  );
}

export function SummaryWorkspace({ reportRef, generateRef, ...p }: Props) {
  const { t } = useI18n();
  const { state, stale } = p;
  const generating = state.status === 'generating';
  const hasReport = state.summary !== null;
  const exportDisabled = !hasReport || stale || generating;
  const emptyScope = p.included.count === 0;

  const filteredLocked = !p.filtersActive && p.scope !== 'filtered';
  const sheetState = emptyScope || !hasReport ? 'is-ready' : 'has-report';

  return (
    <section className={`summary-card ${sheetState}`} aria-labelledby="summary-h">
      <div className="summary-head">
        <h2 id="summary-h">{t('consolidatedInsights')}</h2>
        <p>{t('summarySubtitle')}</p>
        <p className="local-hint">
          <Clock3 size={13} aria-hidden />
          Summaries aggregate {p.isSynthetic ? 'sample' : 'imported'} data {IS_STATIC_BUILD ? 'in this browser' : 'through the local API'}. Processing is deterministic, not AI.
        </p>
      </div>

      <div className="summary-controls">
        <div className="controls-left">
          <div className="control-group scope-group">
            <span className="field-label" id="scope-label">
              {t('reportScope')}
            </span>
            <div className="segmented scope-segmented" role="group" aria-labelledby="scope-label">
              <button type="button" aria-pressed={p.scope === 'all'} onClick={() => p.onScopeChange('all')}>
                {t('allRecordsScope')} <span className="count">{formatCount(p.allCount)}</span>
              </button>
              <button
                type="button"
                aria-pressed={p.scope === 'filtered'}
                onClick={() => p.onScopeChange('filtered')}
                disabled={filteredLocked}
                aria-describedby={filteredLocked ? 'scope-hint' : undefined}
                title={p.filtersActive ? `Current filters: ${p.filtersDescription}` : undefined}
              >
                {t('filteredRecordsScope')} <span className="count">{formatCount(p.filteredCount)}</span>
              </button>
            </div>
            {filteredLocked && (
              <span className="scope-hint" id="scope-hint">
                {t('applyFiltersHint')}
              </span>
            )}
          </div>
          <div className="control-group">
            <label className="field-label" htmlFor="report-lang">
              {t('reportLanguage')}
            </label>
            <select id="report-lang" className="select" defaultValue="en">
              <option value="en">{t('reportLangEnglish')}</option>
              <option value="te" disabled>
                తెలుగు — planned, not yet available
              </option>
            </select>
          </div>
        </div>
        <button
          type="button"
          ref={generateRef}
          className="btn btn-primary generate"
          onClick={p.onGenerate}
          disabled={generating || emptyScope}
          aria-describedby="scope-summary"
        >
          {generating ? <LoaderCircle size={15} className="spin" aria-hidden /> : hasReport ? <RefreshCw size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
          {generating ? `Aggregating ${formatCount(p.included.count)} records…` : hasReport ? t('regenerate') : t('generate')}
        </button>
      </div>

      <p id="scope-summary" className="sr-only" aria-live="polite">
        {emptyScope
          ? 'No records in the selected scope.'
          : `The report will cover ${p.included.count} records across ${p.included.categories} categories.`}
        {generating ? ' Generating summary.' : ''}
      </p>

      {p.scope === 'filtered' && !p.filtersActive && (
        <div className="notice notice--info">
          <Info size={16} aria-hidden />
          <span>No filters are active, so “Filtered records” currently includes every record.</span>
          <span className="notice-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => p.onScopeChange('all')}>
              Use all records
            </button>
          </span>
        </div>
      )}

      {state.status === 'error' && state.error && (
        <div className="notice notice--error" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span>{state.error}</span>
          <span className="notice-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={p.onGenerate} disabled={emptyScope}>
              Try again
            </button>
          </span>
        </div>
      )}

      {emptyScope ? (
        <div className="ready-sheet ready-sheet--single">
          <div className="ready-prose">
            <h3>No records in this scope</h3>
            <p className="ready-body">
              {p.allCount === 0
                ? 'The loaded dataset is empty. Import a file or switch back to the sample dataset.'
                : 'The current search and filters match no complaints. Clear the filters or switch the scope to “All records” to generate a report.'}
            </p>
          </div>
        </div>
      ) : !hasReport ? (
        <div className="ready-sheet">
          <div className="ready-prose">
            <h3>Consolidated Grievance Summary</h3>
            <p className="ready-lead">
              Ready to summarise <strong className="num">{formatCount(p.included.count)}</strong> complaint records across{' '}
              <strong className="num">{formatCount(p.included.categories)}</strong>{' '}
              {p.included.categories === 1 ? 'category' : 'categories'}
              {p.included.dateSpan ? `, submitted ${p.included.dateSpan}` : ''}.
            </p>
            <p className="ready-body">
              The report brings every complaint and department response in scope onto a single printable page: what people raised most, what
              responses were recorded, which outcomes are confirmed, and what the data cannot tell you.
            </p>
          </div>
          <div className="report-contents">
            <div className="report-contents-list">
              <h4 id="contents-h">{t('inThisReport')}</h4>
              <ol aria-labelledby="contents-h">
                {OUTLINE.map((o, i) => (
                  <li key={o}>
                    <span className="n" aria-hidden>
                      {i + 1}
                    </span>
                    {o}
                  </li>
                ))}
              </ol>
            </div>
            <ReportSheetsIllustration />
          </div>
        </div>
      ) : (
        <>
          {stale && (
            <div className="notice notice--warn print-keep" role="status" id="stale-msg">
              <TriangleAlert size={16} aria-hidden />
              <span>
                <strong>Summary is out of date.</strong> {p.staleReason} The report below still describes its original scope. Regenerate to
                update it; exports are paused until then.
              </span>
              <span className="notice-actions no-print">
                <button type="button" className="btn btn-primary btn-sm" onClick={p.onGenerate} disabled={generating}>
                  <RefreshCw size={14} aria-hidden />
                  Regenerate
                </button>
              </span>
            </div>
          )}
          <div className="report-toolbar">
            <span className="generated-line">
              {state.summary && `Generated ${formatDateTime(state.summary.generatedAt)} · ${formatCount(state.summary.totalRecords)} records`}
            </span>
            <span className="spacer" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={p.onCopy} disabled={exportDisabled}>
              <ClipboardCopy size={14} aria-hidden />
              {t('copySummary')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={p.onDownloadMarkdown} disabled={exportDisabled}>
              <FileDown size={14} aria-hidden />
              {t('downloadMarkdown')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={p.onPrint} disabled={exportDisabled}>
              <Printer size={14} aria-hidden />
              {t('printPdf')}
            </button>
          </div>
          {state.summary && <SummaryReport ref={reportRef} summary={state.summary} stale={stale} onOpenRecord={p.onOpenRecord} />}
        </>
      )}
    </section>
  );
}
