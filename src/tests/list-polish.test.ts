import { describe, expect, it } from 'vitest';
import { friendlyReason } from '../components/FileProblems';
import { mergeComplaints } from '../services/allComplaints';
import { timeAgo } from '../utils/timeAgo';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('"Added … ago" labels', () => {
  it('uses plain words at each scale', () => {
    expect(timeAgo(ago(5_000), NOW)).toBe('just now');
    expect(timeAgo(ago(60_000), NOW)).toBe('1 minute ago');
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(timeAgo(ago(60 * 60_000), NOW)).toBe('1 hour ago');
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(timeAgo(ago(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(timeAgo(ago(4 * 86_400_000), NOW)).toBe('4 days ago');
    expect(timeAgo(ago(30 * 86_400_000), NOW)).toMatch(/\d{4}/); // older than a week: a real date
  });
  it('never shows a negative or broken time', () => {
    expect(timeAgo(ago(-60_000), NOW)).toBe('just now'); // clock skew: a file "from the future"
    expect(timeAgo(null, NOW)).toBeNull();
    expect(timeAgo('not a date', NOW)).toBeNull();
  });
  it('each complaint remembers when its file was uploaded', () => {
    const rec = { id: 'A', complaintText: 'x', responseText: null, language: 'en' as const, category: null, issueType: null, department: null, district: null, submittedAt: null, respondedAt: null, status: 'unknown' as const, sourceType: 'csv' as const, isSyntheticDemo: false };
    const m = mergeComplaints([{ dataset: { id: 'd', name: 'f.csv', format: 'csv', status: 'ready', bytes: 1, recordCount: 1, createdAt: '2026-11-12T11:55:00Z', error: null }, records: [rec] }]);
    expect(m.sourceOf.get('A')!.addedAt).toBe('2026-11-12T11:55:00Z');
  });
});

describe('plain-language upload failure reasons', () => {
  it('rewrites the technical OCR messages and keeps clear ones as they are', () => {
    expect(friendlyReason('Page 1 cannot be read by OCR: it is not a single full-page scan (0 large images, 0 image masks).')).toMatch(/font the system cannot read/);
    expect(friendlyReason('OCR could not read page(s) 5 reliably (low confidence or no text). The document was not imported.')).toBe('The scan on page 5 is too unclear to read reliably. Try a clearer scan.');
    expect(friendlyReason('The PDF has 89 pages; the limit is 50 per file. Split it and upload the parts.')).toMatch(/89 pages/);
    expect(friendlyReason('The PDF is password-protected. Remove the password and upload it again.')).toMatch(/password-protected/);
    expect(friendlyReason(null)).toBe('The file could not be read.');
  });
});
