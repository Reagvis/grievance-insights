import { RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CaseStatus, GrievanceRecord } from '../domain/grievance';
import { categoryFacets, isSummaryFiltered, NEWEST_CHOICES, NO_SUMMARY_FILTER, type SummaryFilter } from '../utils/summaryFilter';
import { DateRangeFilter } from './DateRangeFilter';

type Props = {
  records: readonly GrievanceRecord[];
  filter: SummaryFilter;
  onChange: (next: SummaryFilter) => void;
  /** How many complaints the report will cover with this filter. */
  includedCount: number;
  /** Uploaded files (signed-in build); lets the report be limited to some files. */
  files?: Array<{ id: string; name: string; count: number }>;
  fileIdOf?: (record: GrievanceRecord) => string | undefined;
};

const STATUSES: Array<[CaseStatus, string]> = [
  ['resolved', 'Resolved'],
  ['in_progress', 'In progress'],
  ['pending', 'Pending'],
  ['unknown', 'Status not recorded'],
];
const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

/** The "what should the summary cover?" panel: category first, then response, status, dates, files and newest-N. */
export function SummaryFilters({ records, filter, onChange, includedCount, files, fileIdOf }: Props) {
  const [categorySearch, setCategorySearch] = useState('');
  const facets = useMemo(() => categoryFacets(records, filter, fileIdOf), [records, filter, fileIdOf]);
  const active = isSummaryFiltered(filter);
  const set = (patch: Partial<SummaryFilter>) => onChange({ ...filter, ...patch });
  const shown = categorySearch.trim() ? facets.filter((c) => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())) : facets;

  return (
    <section className="summary-filters" aria-label="What the summary covers">
      <header className="sf-head">
        <div>
          <h2>What should the summary cover?</h2>
          <p className="sf-count" aria-live="polite">
            <strong>{includedCount.toLocaleString('en-IN')}</strong> of {records.length.toLocaleString('en-IN')} complaints selected
          </p>
        </div>
        {active && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(NO_SUMMARY_FILTER)}>
            <RotateCcw size={14} aria-hidden /> Reset to all complaints
          </button>
        )}
      </header>

      <div className="sf-block">
        <div className="sf-label">
          <span id="sf-category">Category</span>
          <span className="sf-hint">Pick one or more. Nothing picked means every category.</span>
          <span className="sf-actions">
            <button type="button" className="link-button" onClick={() => set({ categories: facets.map((c) => c.name) })} disabled={facets.length === 0}>
              Select all
            </button>
            <button type="button" className="link-button" onClick={() => set({ categories: [] })} disabled={filter.categories.length === 0}>
              Clear
            </button>
          </span>
        </div>
        {facets.length > 10 && (
          <label className="sf-search">
            <Search size={14} aria-hidden />
            <input type="search" placeholder="Find a category…" value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} aria-label="Find a category" />
          </label>
        )}
        <div className="sf-chips" role="group" aria-labelledby="sf-category">
          {shown.map((c) => {
            const on = filter.categories.includes(c.name);
            return (
              <button key={c.name} type="button" className={'sf-chip' + (on ? ' is-on' : '') + (c.count === 0 ? ' is-empty' : '')} aria-pressed={on} onClick={() => set({ categories: toggle(filter.categories, c.name) })}>
                {c.name} <span className="sf-chip-count">{c.count.toLocaleString('en-IN')}</span>
              </button>
            );
          })}
          {shown.length === 0 && <span className="sf-hint">No category matches “{categorySearch}”.</span>}
        </div>
      </div>

      <div className="sf-grid">
        <div className="sf-block">
          <span className="sf-label" id="sf-response">Department response</span>
          <div className="segmented" role="group" aria-labelledby="sf-response">
            {([['any', 'Any'], ['provided', 'Has a response'], ['missing', 'No response']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter.response === value} onClick={() => set({ response: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="sf-block">
          <span className="sf-label" id="sf-status">Status in the source</span>
          <div className="sf-chips" role="group" aria-labelledby="sf-status">
            {STATUSES.map(([value, label]) => (
              <button key={value} type="button" className={'sf-chip' + (filter.statuses.includes(value) ? ' is-on' : '')} aria-pressed={filter.statuses.includes(value)} onClick={() => set({ statuses: toggle(filter.statuses, value) })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="sf-block">
          <DateRangeFilter label="Submitted between" compact from={filter.dateFrom} to={filter.dateTo} onChange={(dateFrom, dateTo) => set({ dateFrom, dateTo })} />
        </div>

        <div className="sf-block">
          <label className="sf-label" htmlFor="sf-newest">Only the newest</label>
          <select id="sf-newest" className="select" value={filter.newest ?? ''} onChange={(e) => set({ newest: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">All matching complaints</option>
            {NEWEST_CHOICES.map((n) => (
              <option key={n} value={n}>{n} complaints</option>
            ))}
          </select>
        </div>

        {files && files.length > 1 && (
          <details className="sf-block sf-files">
            <summary className="sf-label">
              Uploaded files <span className="sf-hint">{filter.fileIds.length === 0 ? 'all files' : `${filter.fileIds.length} of ${files.length}`}</span>
            </summary>
            <ul className="sf-file-list">
              {files.map((f) => (
                <li key={f.id}>
                  <label>
                    <input type="checkbox" checked={filter.fileIds.includes(f.id)} onChange={() => set({ fileIds: toggle(filter.fileIds, f.id) })} />
                    <span>{f.name}</span>
                    <span className="sf-chip-count">{f.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
