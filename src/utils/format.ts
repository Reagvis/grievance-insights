import { isValidDate } from '../domain/grievance';

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Returns a formatted date, or null for missing/invalid values (never "Invalid Date"). */
export function formatDate(value: string | null | undefined): string | null {
  if (!isValidDate(value)) return null;
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string | null {
  if (!isValidDate(value)) return null;
  return dateTimeFmt.format(new Date(value));
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

/** Percentage of `part` in `total`, rounded to one decimal place. 0 when total is 0. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function formatPercent(p: number): string {
  return `${Number.isInteger(p) ? p.toFixed(0) : p.toFixed(1)}%`;
}

type SegmenterLike = { segment(input: string): Iterable<{ segment: string }> };

function getSegmenter(): SegmenterLike | null {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => SegmenterLike }).Segmenter;
  return Seg ? new Seg('te', { granularity: 'grapheme' }) : null;
}

const segmenter = getSegmenter();

/** Split into user-perceived characters so Telugu conjuncts/vowel signs are never cut. */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/**
 * Grapheme-safe truncation for exports (the UI itself uses CSS line clamping).
 * Prefers to cut at a space near the limit.
 */
export function truncateGraphemes(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = graphemes(clean);
  if (parts.length <= max) return clean;
  let cut = parts.slice(0, max).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > cut.length * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trimEnd()}…`;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

/** YYYY-MM-DD in the viewer's local time zone (used in file names). */
export function localDateStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
