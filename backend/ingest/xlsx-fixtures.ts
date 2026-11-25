/** Synthetic, actual ZIP/OOXML fixtures. No operator documents. */
import { strToU8, zipSync } from 'fflate';
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const textCell = (ref: string, value: string) => '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(value) + '</t></is></c>';
export const numCell = (ref: string, value: string, style = 0) => '<c r="' + ref + '" s="' + style + '"><v>' + esc(value) + '</v></c>';
export const row = (r: number, cells: string, attrs = '') => '<row r="' + r + '" ' + attrs + '>' + cells + '</row>';
export const sheetXml = (rows: string, extra = '') => '<worksheet xmlns="' + ns + '">' + extra + '<sheetData>' + rows + '</sheetData></worksheet>';
export function workbookParts(sheets: { name: string; xml: string; state?: string }[]) {
  return {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="' + ns + '" xmlns:r="' + rel + '"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"' + (s.state ? ' state="' + s.state + '"' : '') + '/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + pkg + '">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rIdStyles" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet xmlns="' + ns + '"><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="5"/><xf numFmtId="9"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ...Object.fromEntries(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', s.xml])),
  } as Record<string, string>;
}
export function zipParts(parts: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)])), { level: 0 });
}
export const budget = sheetXml(
  row(1, textCell('A1', 'Month') + textCell('B1', 'Budget') + textCell('C1', 'Share') + textCell('D1', 'Date')) +
  row(2, textCell('A2', 'జనవరి') + numCell('B2', '9007199254740993.10', 1) + numCell('C2', '0.125', 2) + numCell('D2', '46000', 3)) +
  row(3, textCell('A3', 'February') + numCell('B3', '0.20', 1) + '<c r="C3" t="b"><v>1</v></c>') +
  row(4, textCell('A4', 'March') + numCell('B4', '-0.30', 1))
);
export const grievances = sheetXml(
  row(1, textCell('A1', 'Case ID') + textCell('B1', 'Complaint Text') + textCell('C1', 'Date')) +
  row(2, textCell('A2', 'SYN-1') + textCell('B2', 'నీటి సరఫరా సమస్య') + numCell('C2', '46000', 3))
);
export const simple = sheetXml(row(1, textCell('A1', 'Metric')) + row(2, numCell('A2', '1.25')));
export const mixedWorkbook = () => zipParts(workbookParts([{ name: 'Budget', xml: budget }, { name: 'Cases', xml: grievances }]));
