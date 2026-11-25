import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { WORKBOOK_LIMITS as L } from '../../src/domain/workbook';
import { ingestDocument } from './index';
import { parseWorkbook } from './xlsx';
import { summarizeWorksheet, worksheetContext } from '../analysis/workbook-context';
import { budget, grievances, mixedWorkbook, numCell, row, sheetXml, simple, textCell, workbookParts, zipParts } from './xlsx-fixtures';

describe('bounded XLSX parsing and typed worksheet context', () => {
  it('preserves exact numeric strings, formats, blanks, Unicode and coordinates; maps only recognized grievance sheets', async () => {
    const result = await ingestDocument({ name: 'sample.xlsx', bytes: mixedWorkbook() });
    expect(result.kind).toBe('workbook');
    if (result.kind !== 'workbook') throw new Error('Workbook expected');
    const { sheets, records, provenance } = result.workbook;
    expect(sheets.map(s => s.info)).toMatchObject([
      { name: 'Budget', kind: 'table', rows: 3, columns: 4, rowNumbers: [2, 3, 4] },
      { name: 'Cases', kind: 'grievance', rows: 1, columns: 3, rowNumbers: [2] },
    ]);
    expect(sheets[0].data[0].cells).toEqual([
      { kind: 'text', value: 'జనవరి' },
      { kind: 'currency', value: '9007199254740993.10', format: 'builtin:5' },
      { kind: 'percent', value: '0.125', format: 'builtin:9' },
      { kind: 'date', value: '46000', format: 'builtin:14' },
    ]);
    expect(sheets[0].data[1].cells[2]).toEqual({ kind: 'boolean', value: true });
    expect(sheets[0].data[1].cells[3]).toEqual({ kind: 'blank' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'SYN-1', complaintText: 'నీటి సరఫరా సమస్య', sourceType: 'xlsx',
      worksheetSource: { sheetIndex: 1, sheetName: 'Cases', row: 2 }, status: 'unknown' });
    expect(provenance).toEqual([{ recordId: 'SYN-1', sheetIndex: 1, row: 2 }]);
    expect(summarizeWorksheet(sheets[0])[1].totals).toEqual([{ format: 'currency:builtin:5', count: 3, exactSum: '9007199254740993' }]);
    expect(summarizeWorksheet(sheets[0])[3].totals).toEqual([]);
  });
  it('handles shared strings, physical blank rows and the 1904 date epoch', () => {
    const parts = workbookParts([{ name: 'Shared', xml: sheetXml(row(1, '<c r="A1" t="s"><v>0</v></c>') + row(3, '<c r="A3" t="s"><v>1</v></c>')) }]);
    parts['xl/sharedStrings.xml'] = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Header</t></si><si><r><t>తెలుగు</t></r><r><t> text</t></r></si></sst>';
    parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace('<sheets>', '<workbookPr date1904="1"/><sheets>');
    const sheet = parseWorkbook(zipParts(parts), 'x.xlsx').sheets[0];
    expect(sheet.date1904).toBe(true);
    expect(sheet.data).toEqual([{ row: 2, cells: [{ kind: 'blank' }] }, { row: 3, cells: [{ kind: 'text', value: 'తెలుగు text' }] }]);
  });
  it('summarizes every row above the old 40-record limit without injecting omitted row text', () => {
    const rows = row(1, textCell('A1', 'Spend') + textCell('B1', 'Description')) +
      Array.from({ length: 80 }, (_, i) => row(i + 2, numCell('A' + (i + 2), '0.1') + textCell('B' + (i + 2), 'PRIVATE-TEXT-' + i + ' '.repeat(500)))).join('');
    const sheet = parseWorkbook(zipParts(workbookParts([{ name: 'Spend', xml: sheetXml(rows) }])), 'x.xlsx').sheets[0];
    const source = JSON.parse(worksheetContext(sheet, undefined, 24000));
    expect(source.coverage).toContain('summary only');
    expect(source.rowCount).toBe(80);
    expect(source.columns[0].totals[0]).toMatchObject({ count: 80, exactSum: '8' });
    expect(JSON.stringify(source)).not.toContain('PRIVATE-TEXT-');
    const selected = JSON.parse(worksheetContext(sheet, 20, 24000));
    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0].row).toBe(20);
    expect(JSON.stringify(selected)).toContain('PRIVATE-TEXT-18');
    expect(JSON.stringify(selected)).not.toContain('PRIVATE-TEXT-19');
  });
  it('does not turn general tables with an ID into grievances', () => {
    const result = parseWorkbook(zipParts(workbookParts([{ name: 'Metrics', xml: sheetXml(row(1, textCell('A1', 'id') + textCell('B1', 'amount')) + row(2, textCell('A2', 'A') + numCell('B2', '5'))) }])), 'x.xlsx');
    expect(result.records).toEqual([]);
    expect(result.sheets[0].info.kind).toBe('table');
  });
  it('preserves text case IDs with leading zeros and unambiguous plain integer IDs', () => {
    const xml = sheetXml(row(1, textCell('A1', 'Case ID') + textCell('B1', 'Complaint')) +
      row(2, textCell('A2', '000001') + textCell('B2', 'First complaint')) +
      row(3, numCell('A3', '1') + textCell('B3', 'Second complaint')));
    const result = parseWorkbook(zipParts(workbookParts([{ name: 'Cases', xml }])), 'x.xlsx');
    expect(result.records.map(r => r.id)).toEqual(['000001', '1']);
    expect(result.provenance.map(p => p.recordId)).toEqual(['000001', '1']);
  });
  it('rejects numeric case IDs displayed with leading zeros rather than silently rewriting them', () => {
    const xml = sheetXml(row(1, textCell('A1', 'Case ID') + textCell('B1', 'Complaint')) +
      row(2, numCell('A2', '1', 1) + textCell('B2', 'Synthetic complaint')));
    const parts = workbookParts([{ name: 'Cases', xml }]);
    parts['xl/styles.xml'] = parts['xl/styles.xml']
      .replace('<cellXfs', '<numFmts count="1"><numFmt numFmtId="164" formatCode="000000"/></numFmts><cellXfs')
      .replace('numFmtId="5"', 'numFmtId="164"');
    expect(() => parseWorkbook(zipParts(parts), 'x.xlsx')).toThrow(/Ambiguous Excel case ID/);
    // The same formatted numeric cell remains available in a general table.
    parts['xl/worksheets/sheet1.xml'] = xml.replace('Complaint</t>', 'Description</t>');
    const table = parseWorkbook(zipParts(parts), 'x.xlsx');
    expect(table.records).toEqual([]);
    expect(table.sheets[0].data[0].cells[0]).toEqual({ kind: 'number', value: '1', format: '000000' });
  });
  it('rejects missing grievance text and duplicate IDs across sheets rather than dropping rows', () => {
    const missing = sheetXml(row(1, textCell('A1', 'id') + textCell('B1', 'complaint')) + row(2, textCell('A2', 'SYN')));
    expect(() => parseWorkbook(zipParts(workbookParts([{ name: 'Cases', xml: missing }])), 'x.xlsx')).toThrow(/unique case ID/);
    expect(() => parseWorkbook(zipParts(workbookParts([{ name: 'A', xml: grievances }, { name: 'B', xml: grievances }])), 'x.xlsx')).toThrow(/Duplicate grievance IDs/);
  });
  it.each([
    ['formula', sheetXml(row(1, textCell('A1', 'Header')) + row(2, '<c r="A2"><f>1+1</f><v>2</v></c>'))],
    ['hidden row', sheetXml(row(1, textCell('A1', 'Header')) + row(2, numCell('A2', '7'), 'hidden="1"'))],
    ['hidden column', sheetXml(row(1, textCell('A1', 'Header')) + row(2, numCell('A2', '7')), '<cols><col min="1" max="1" width="0.0"/></cols>')],
    ['merged cells', simple.replace('</worksheet>', '<mergeCells><mergeCell ref="A1:A2"/></mergeCells></worksheet>')],
    ['entity', simple.replace('<worksheet', '<!DOCTYPE worksheet [<!ENTITY x "secret">]><worksheet')],
    ['bad row coordinate', simple.replace('r="A2"', 'r="A3"')],
    ['oversize row index', simple.replaceAll('r="2"', 'r="1002"').replace('r="A2"', 'r="A1002"')],
    ['oversize column', simple.replace('r="A2"', 'r="AG2"')],
    ['oversize cell', sheetXml(row(1, textCell('A1', 'Header')) + row(2, textCell('A2', 'x'.repeat(L.cellBytes + 1))))],
  ])('refuses %s', (_, xml) => {
    expect(() => parseWorkbook(zipParts(workbookParts([{ name: 'Sheet', xml }])), 'x.xlsx')).toThrow();
  });
  it('refuses hidden sheets, external relations, macro parts, encrypted flags, unsafe paths and malformed ZIP', () => {
    const parts = workbookParts([{ name: 'Budget', xml: budget }]);
    expect(() => parseWorkbook(zipParts(workbookParts([{ name: 'Hidden', xml: simple, state: 'veryHidden' }])), 'x.xlsx')).toThrow(/Hidden/);
    expect(() => parseWorkbook(zipParts({ ...parts, 'xl/_rels/workbook.xml.rels': parts['xl/_rels/workbook.xml.rels'].replace('Target="worksheets', 'TargetMode="External" Target="worksheets') }), 'x.xlsx')).toThrow(/External/);
    expect(() => parseWorkbook(zipParts({ ...parts, 'xl/vbaProject.bin': 'macro' }), 'x.xlsx')).toThrow(/unsupported archive/);
    expect(() => parseWorkbook(zipParts({ ...parts, '../escape.xml': 'x' }), 'x.xlsx')).toThrow();
    const encrypted = zipParts(parts);
    encrypted[6] |= 1;
    expect(() => parseWorkbook(encrypted, 'x.xlsx')).toThrow();
    expect(() => parseWorkbook(encrypted.subarray(0, encrypted.length - 10), 'x.xlsx')).toThrow();
    expect(() => parseWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'x.xlsx')).toThrow();
    const bomb = zipSync({ ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), 'docProps/custom.xml': strToU8('x'.repeat(1024 * 1024)) }, { level: 9 });
    expect(() => parseWorkbook(bomb, 'x.xlsx')).toThrow(/limits/);
  });
});
