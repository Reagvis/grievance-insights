import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createSampleDataset } from '../data/demoGrievances';
import { buildConsolidatedSummary } from '../services/localDemoSummaryService';
import { buildNoteText, buildRecordsZip, noteFileName, utf8Blob } from '../utils/downloads';
import { graphemes, truncateGraphemes } from '../utils/format';
import { decodeUtf8, ImportError, parseCsvImport, parseJsonImport } from '../utils/importer';
import { DEFAULT_FILTERS, filterRecords, isFiltered } from '../utils/recordSearch';
import { buildSummaryMarkdown } from '../utils/summaryExport';
import { parseCsv } from '../utils/csv';

const ds = createSampleDataset();

describe('search and filters', () => {
  it('finds records by a Telugu substring', () => {
    const hits = filterRecords(ds.records, { ...DEFAULT_FILTERS, query: 'తాగునీటి' });
    expect(hits.map((r) => r.id)).toContain('GRV-000109');
    expect(hits.every((r) => (r.complaintText + (r.responseText ?? '')).includes('తాగునీటి'))).toBe(true);
  });

  it('matches NFD-decomposed input against NFC text', () => {
    const q = 'ఆసుపత్రి'.normalize('NFD');
    expect(filterRecords(ds.records, { ...DEFAULT_FILTERS, query: q }).length).toBeGreaterThan(0);
  });

  it('finds records by case ID (full, partial, case-insensitive)', () => {
    expect(filterRecords(ds.records, { ...DEFAULT_FILTERS, query: 'GRV-000128' }).map((r) => r.id)).toEqual(['GRV-000128']);
    expect(filterRecords(ds.records, { ...DEFAULT_FILTERS, query: 'grv-000128' })).toHaveLength(1);
  });

  it('combines category, status and response filters', () => {
    const hits = filterRecords(ds.records, { ...DEFAULT_FILTERS, category: 'Healthcare', status: 'unknown', response: 'provided' });
    expect(hits.map((r) => r.id).sort()).toEqual(['GRV-000102', 'GRV-000103']);
    expect(isFiltered({ ...DEFAULT_FILTERS, query: '   ' })).toBe(false);
  });

  it('returns an empty list (not an error) when nothing matches', () => {
    expect(filterRecords(ds.records, { ...DEFAULT_FILTERS, query: 'zzzz-no-match' })).toEqual([]);
  });
});

describe('exports keep Telugu intact', () => {
  it('note text round-trips through UTF-8 bytes', async () => {
    const r = ds.records.find((x) => x.id === 'GRV-000105')!;
    const note = buildNoteText(r, ds.name);
    const bytes = new Uint8Array(await utf8Blob(note, 'text/plain').arrayBuffer());
    const back = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(back).toBe(note);
    expect(back).toContain(r.complaintText);
    expect(back).toContain('No response recorded in the source data.');
    expect(back).toContain('Department:     Health Department');
    expect(back).toContain('Responded:      Not recorded');
    expect(noteFileName(r)).toBe('GRV-000105-note.txt');
  });

  it('ZIP contains every record, a manifest and README', () => {
    const zip = unzipSync(buildRecordsZip(ds, ds.records));
    const names = Object.keys(zip);
    const notes = names.filter((n) => n.includes('/notes/'));
    expect(notes).toHaveLength(30);
    expect(names).toContain('sample-grievance-records/manifest.csv');
    expect(strFromU8(zip['sample-grievance-records/README.txt'])).toMatch(/SYNTHETIC SAMPLE DATA/);
    const note = strFromU8(zip['sample-grievance-records/notes/GRV-000101-note.txt']);
    expect(note).toContain(ds.records[0].complaintText);
    const manifest = strFromU8(zip['sample-grievance-records/manifest.csv']);
    expect(manifest.trim().split('\r\n')).toHaveLength(31);
  });

  it('refuses to build an empty archive', () => {
    expect(() => buildRecordsZip(ds, [])).toThrow(/no records/);
  });

  it('markdown report quotes Telugu excerpts without splitting graphemes', () => {
    const s = buildConsolidatedSummary(ds.records, {
      scope: 'all',
      scopeDescription: 'no filters',
      reportLanguage: 'en',
      datasetName: ds.name,
      isSyntheticData: true,
    });
    const md = buildSummaryMarkdown(s);
    expect(md).toContain('# Consolidated Grievance Summary');
    expect(md).toContain('Demonstration report');
    expect(md).toMatch(/[ఀ-౿]/);
    expect(md).not.toContain('�');
  });

  it('grapheme truncation never leaves a dangling vowel sign', () => {
    const text = 'ప్రభుత్వ ఆసుపత్రిలో మందులు అందుబాటులో లేవు.';
    for (let n = 1; n < graphemes(text).length; n++) {
      const cut = truncateGraphemes(text, n).replace(/…$/, '');
      const chars = graphemes(cut);
      expect(chars.join('')).toBe(cut);
      // the cut must be a prefix made of whole graphemes
      expect(text.startsWith(cut)).toBe(true);
    }
  });
});

describe('import', () => {
  it('parses quoted CSV with commas, newlines and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\n"he said ""hi""",z');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['he said "hi"', 'z'],
    ]);
  });

  it('validates CSV rows, duplicates and unknown statuses without dropping silently', () => {
    const csv = [
      'id,complaintText,responseText,status,category,extra',
      'GRV-1,మొదటి ఫిర్యాదు,,closed,Roads,x',
      'GRV-2,రెండవ ఫిర్యాదు,స్పందన,resolved,,x',
      ',ఐడీ లేదు,,,,',
      'GRV-3,,,,,',
      ',,,,,',
      'GRV-1,మొదటి ఫిర్యాదు మళ్లీ,,pending,Roads,x',
    ].join('\n');
    const res = parseCsvImport('t.csv', csv);
    expect(res.records.map((r) => r.id)).toEqual(['GRV-1', 'GRV-2']);
    expect(res.records[0].status).toBe('unknown');
    expect(res.records[0].responseText).toBeNull();
    expect(res.records[1].category).toBeNull();
    expect(res.rejectedRows).toHaveLength(2);
    expect(res.emptyRows).toBe(1);
    expect(res.duplicates).toEqual([{ id: 'GRV-1', keptRow: 2, skippedRows: [7], identical: false }]);
    expect(res.issues.some((i) => i.message.includes('extra'))).toBe(true);
    expect(res.issues.some((i) => i.message.includes('"closed"'))).toBe(true);
  });

  it('rejects CSV without required columns', () => {
    expect(() => parseCsvImport('t.csv', 'name,text\na,b')).toThrow(ImportError);
  });

  it('parses JSON arrays and { records } objects', () => {
    const json = JSON.stringify({ records: [{ id: 'X-1', complaint_text: 'Water problem', submittedAt: 'bad-date' }] });
    const res = parseJsonImport('t.json', json);
    expect(res.records[0]).toMatchObject({ id: 'X-1', language: 'en', submittedAt: null, status: 'unknown', sourceType: 'json' });
    expect(() => parseJsonImport('t.json', '{oops')).toThrow(/Malformed JSON/);
    expect(() => parseJsonImport('t.json', '{"a":1}')).toThrow(/array/);
  });

  it('rejects non-UTF-8 bytes instead of mangling them', () => {
    const latin1 = new Uint8Array([0x69, 0x64, 0x2c, 0xe9, 0x0a]);
    expect(() => decodeUtf8(latin1.buffer)).toThrow(/not valid UTF-8/);
  });
});
