import { RotateCcw } from 'lucide-react';
import { useId } from 'react';

type Props = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Visible label for the group. */
  label: string;
  compact?: boolean;
  /** Single-row toolbar used in the dashboard header. */
  toolbar?: boolean;
};

/** Two native date inputs (keyboard + screen-reader friendly) with an explicit reset. */
export function DateRangeFilter({ from, to, onChange, label, compact, toolbar }: Props) {
  const id = useId();
  const active = from !== '' || to !== '';
  const invalid = from !== '' && to !== '' && from > to;

  if (toolbar) {
    return (
      <div className="dashboard-date-toolbar" role="group" aria-labelledby={`${id}-title`}>
        <span className="date-toolbar-title" id={`${id}-title`}>
          {label}
        </span>
        <div className="date-field-inline">
          <label htmlFor={`${id}-from`}>From</label>
          <input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
        </div>
        <div className="date-field-inline">
          <label htmlFor={`${id}-to`}>To</label>
          <input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('', '')} disabled={!active}>
          <RotateCcw size={13} aria-hidden />
          Reset
        </button>
        {invalid && (
          <p className="date-error" role="alert">
            “From” is after “To”, so no records can match.
          </p>
        )}
      </div>
    );
  }

  return (
    <fieldset className={`date-range ${compact ? 'date-range--compact' : ''}`}>
      <legend className="field-label">{label}</legend>
      <div className="date-range-row">
        <div>
          <label htmlFor={`${id}-from`} className="date-label">
            From
          </label>
          <input id={`${id}-from`} className="input date-input" type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
        </div>
        <div>
          <label htmlFor={`${id}-to`} className="date-label">
            To
          </label>
          <input id={`${id}-to`} className="input date-input" type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('', '')} disabled={!active}>
          <RotateCcw size={13} aria-hidden />
          Reset
        </button>
      </div>
      {invalid && (
        <p className="date-error" role="alert">
          “From” is after “To”, so no records can match.
        </p>
      )}
    </fieldset>
  );
}
