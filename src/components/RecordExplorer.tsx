import { ChevronDown, ChevronLeft, ChevronRight, FileArchive, LoaderCircle, RotateCcw, Search, SearchX, X, Inbox } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CASE_STATUSES, type CaseStatus, type GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { formatCount } from '../utils/format';
import { timeAgo } from '../utils/timeAgo';
import { isFiltered, type RecordFilters, type ResponseFilter } from '../utils/recordSearch';
import { DateRangeFilter } from './DateRangeFilter';
import { EmptyState } from './EmptyState';
import { RecordListItem } from './RecordListItem';

export const PAGE_SIZE = 50;

type Props = {
  totalCount: number;
  filtered: GrievanceRecord[];
  filters: RecordFilters;
  onFiltersChange: (patch: Partial<RecordFilters>) => void;
  onReset: () => void;
  categories: Array<{ name: string; count: number }>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  onDownloadAll: () => void;
  onExportFiltered: () => void;
  zipBusy: 'all' | 'filtered' | null;
  /** Record ID → when its file was uploaded (ISO). Shows "Added 5 minutes ago" on each row. */
  addedAt?: ReadonlyMap<string, string>;
  /** A prominent action shown under the title (the signed-in build puts "AI analysis" here). */
  headerAction?: ReactNode;
};

export function RecordExplorer({
  totalCount,
  filtered,
  filters,
  onFiltersChange,
  onReset,
  categories,
  selectedId,
  onOpen,
  page,
  onPageChange,
  onDownloadAll,
  onExportFiltered,
  zipBusy,
  addedAt,
  headerAction,
}: Props) {
  const { t, categoryLabel, statusLabel } = useI18n();
  const active = isFiltered(filters);
  // "Added … ago" labels stay current while the page is open.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!addedAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [addedAt]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const extraActive = (filters.status !== 'all' ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0);
  const [moreOpen, setMoreOpen] = useState(extraActive > 0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [safePage, filters]);

  // Arrow-key navigation between record rows.
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.record-row'));
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
  };

  return (
    <aside className="rail" aria-labelledby="rail-title">
      <div className="rail-head">
        <div className="rail-title-row">
          <h2 className="rail-title" id="rail-title">
            {t('records')}
          </h2>
          <span className="muted num">{formatCount(totalCount)}</span>
        </div>
        {headerAction}
        <div className="search" role="search">
          <label htmlFor="record-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <Search size={16} className="search-icon" aria-hidden />
          <input
            id="record-search"
            className="input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('searchPlaceholder')}
            value={filters.query}
            onChange={(e) => onFiltersChange({ query: e.target.value })}
          />
          {filters.query && (
            <button type="button" className="icon-btn" aria-label={t('clearSearch')} onClick={() => onFiltersChange({ query: '' })}>
              <X size={15} aria-hidden />
            </button>
          )}
        </div>
        <div className="filters">
          <div>
            <label className="field-label" htmlFor="filter-category">
              {t('category')}
            </label>
            <select id="filter-category" className="select" value={filters.category} onChange={(e) => onFiltersChange({ category: e.target.value })}>
              <option value="all">{t('allCategories')}</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {categoryLabel(c.name)} ({formatCount(c.count)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="filter-response">
              {t('response')}
            </label>
            <select id="filter-response" className="select" value={filters.response} onChange={(e) => onFiltersChange({ response: e.target.value as ResponseFilter })}>
              <option value="all">{t('anyResponse')}</option>
              <option value="provided">{t('responseProvided')}</option>
              <option value="missing">{t('responseMissing')}</option>
            </select>
          </div>
          <div className="full">
            <button
              type="button"
              className="more-filters-toggle"
              aria-expanded={moreOpen}
              aria-controls="more-filters"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <ChevronDown size={14} className={moreOpen ? 'chev chev--open' : 'chev'} aria-hidden />
              More filters
              {extraActive > 0 && <span className="more-filters-count">{extraActive}</span>}
            </button>
          </div>
          {moreOpen && (
            <div className="full more-filters" id="more-filters">
              <div>
                <label className="field-label" htmlFor="filter-status">
                  {t('status')}
                </label>
                <select
                  id="filter-status"
                  className="select"
                  value={filters.status}
                  onChange={(e) => onFiltersChange({ status: e.target.value as CaseStatus | 'all' })}
                >
                  <option value="all">{t('allStatuses')}</option>
                  {CASE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <DateRangeFilter
                compact
                label="Submission date"
                from={filters.dateFrom}
                to={filters.dateTo}
                onChange={(dateFrom, dateTo) => onFiltersChange({ dateFrom, dateTo })}
              />
            </div>
          )}
        </div>
        <div className="result-line" aria-live="polite">
          <span>
            <span className={`scope-chip ${active ? 'scope-chip--filtered' : ''}`}>{active ? t('showingFiltered') : t('showingAll')}</span>
            <strong className="num">{formatCount(filtered.length)}</strong> {t('of')} <span className="num">{formatCount(totalCount)}</span>
          </span>
          <button type="button" className="reset-link" onClick={onReset} disabled={!active}>
            {t('resetFilters')}
          </button>
        </div>
      </div>

      <div className="record-scroll" ref={scrollRef}>
        {totalCount === 0 ? (
          <EmptyState icon={<Inbox size={28} aria-hidden />}>{t('noRecords')}</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<SearchX size={28} aria-hidden />}
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={onReset}>
                <RotateCcw size={14} aria-hidden />
                {t('resetFilters')}
              </button>
            }
          >
            {t('noMatches')}
          </EmptyState>
        ) : (
          <ul className="record-list" aria-label={t('records')} onKeyDown={onListKey}>
            {pageItems.map((r) => (
              <RecordListItem key={r.id} record={r} selected={r.id === selectedId} onOpen={onOpen} addedLabel={timeAgo(addedAt?.get(r.id), clock)} />
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 && (
        <nav className="rail-pager" aria-label="Record pages">
          <button
            type="button"
            className="icon-btn"
            aria-label={t('prevPage')}
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className="num">
            {formatCount(start + 1)}–{formatCount(start + pageItems.length)} {t('of')} {formatCount(filtered.length)}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('nextPage')}
            disabled={safePage >= pageCount - 1}
            onClick={() => onPageChange(safePage + 1)}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </nav>
      )}

      <div className="rail-foot">
        <button type="button" className="btn btn-secondary btn-block" onClick={onDownloadAll} disabled={totalCount === 0 || zipBusy !== null}>
          {zipBusy === 'all' ? <LoaderCircle size={15} className="spin" aria-hidden /> : <FileArchive size={15} aria-hidden />}
          {zipBusy === 'all' ? t('preparingZip') : `${t('downloadAll')} (${formatCount(totalCount)})`}
        </button>
        {active && filtered.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={onExportFiltered} disabled={zipBusy !== null}>
            {zipBusy === 'filtered' ? <LoaderCircle size={14} className="spin" aria-hidden /> : null}
            Export filtered records only ({formatCount(filtered.length)})
          </button>
        )}
        <span className="hint">ZIP of UTF-8 text notes with manifest.csv</span>
      </div>
    </aside>
  );
}
