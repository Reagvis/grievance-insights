import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { WORKBOOK_LIMITS as L, type WorkbookCell, type WorkbookRow, type Worksheet } from '../../src/domain/workbook';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { mapHeader, parseJsonImport } from '../../src/utils/importer';
import { validateRecordBounds } from '../datasets/bounds';
import { IngestError } from './limits';

function fail(message = 'Invalid or unsupported XLSX workbook. Save a plain, unencrypted .xlsx and retry.'): never {
  throw new IngestError(message, 'invalid_content');
}
function limit(): never { return fail('Workbook exceeds the safe Excel size or worksheet limits. Split it into smaller files.'); }
const decoder = new TextDecoder('utf-8', { fatal: true });
const size = (s: string) => Buffer.byteLength(s, 'utf8');
const blank = (): WorkbookCell => ({ kind: 'blank' });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Central directory and local headers must agree. Inflate only allowlisted XML
 * parts with native zlib's actual output cap, then verify length and CRC. */
function archive(bytes: Uint8Array): Map<string, string> {
  if (bytes.length > L.bytes) limit();
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail();
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => d.getUint16(p, true);
  const u32 = (p: number) => d.getUint32(p, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < 0 || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length ||
      u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail();
  const count = u16(end + 10), start = u32(end + 16);
  if (!count || count > L.entries || start + u32(end + 12) !== end) limit();
  const out = new Map<string, string>();
  const spans: [number, number][] = [];
  let total = 0, p = start;
  const allowed = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:core|app|custom)\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|theme\/theme[1-9]\d*\.xml|worksheets\/sheet[1-9]\d*\.xml))$/;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) fail();
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), compressed = u32(p + 20), inflated = u32(p + 24);
    const n = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), local = u32(p + 42);
    if (p + 46 + n + extra + comment > end || u16(p + 34) || (flags & ~0x080e) || (method !== 0 && method !== 8)) fail();
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + n));
    if (!allowed.test(name) || out.has(name)) fail('Workbook contains unsupported archive parts (macros, links, drawings or other non-table features).');
    if (inflated > L.inflated - total || inflated > Math.max(1, compressed) * L.ratio) limit();
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail();
    const ln = u16(local + 26), le = u16(local + 28), data = local + 30 + ln + le;
    if (data + compressed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + ln)) !== name) fail();
    let finish = data + compressed;
    if (flags & 8) {
      if (finish + 4 <= start && u32(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > start || u32(finish) !== crc || u32(finish + 4) !== compressed || u32(finish + 8) !== inflated) fail();
      finish += 12;
    } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== inflated) fail();
    spans.push([local, finish]);
    const packed = bytes.subarray(data, data + compressed);
    const decoded = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, inflated) });
    if (decoded.length !== inflated || crc32(decoded) !== crc) fail();
    total += inflated;
    out.set(name, decoder.decode(decoded));
    p += 46 + n + extra + comment;
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (p !== end || spans[0][0] !== 0 || spans.some((s, i) => s[1] !== (spans[i + 1]?.[0] ?? start))) fail();
  return out;
}

type Xml = { name: string; attrs: Record<string, string>; children: Xml[]; text: string };
function entities(s: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(s)) fail();
  return s.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (e[0] !== '#') return named[e];
    const n = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    if (!Number.isInteger(n) || n > 0x10ffff || n < 9 || (n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 0xd800 && n <= 0xdfff)) fail();
    return String.fromCodePoint(n);
  });
}
/** Bounded XML subset: no DTD, processing instructions, CDATA, entity expansion,
 * network resolution or namespace-prefix reinterpretation of structural names. */
function xml(input: string): Xml {
  const s = input.replace(/^\uFEFF/, '').replace(/^<\?xml\s[^?]*\?>/, '');
  if (/<[!?]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) fail();
  const root: Xml = { name: '', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tokens = /<[^<>]*>|[^<]+/g;
  let at = 0, count = 0;
  for (const m of s.matchAll(tokens)) {
    if (m.index !== at) fail();
    at += m[0].length;
    const token = m[0], parent = stack[stack.length - 1];
    if (!token.startsWith('<')) { parent.text += entities(token); continue; }
    const closing = /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(token);
    if (closing) {
      if (stack.length === 1 || parent.name !== closing[1]) fail();
      stack.pop(); continue;
    }
    const open = /^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!open || ++count > 120000 || stack.length > 32) fail();
    const node: Xml = { name: open[1], attrs: Object.create(null) as Record<string, string>, children: [], text: '' };
    let rest = open[2];
    while (rest.trim()) {
      const attr = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!attr || Object.hasOwn(node.attrs, attr[1])) fail();
      node.attrs[attr[1]] = entities(attr[2] ?? attr[3]);
      rest = rest.slice(attr[0].length);
    }
    parent.children.push(node);
    if (!open[3]) stack.push(node);
  }
  if (at !== s.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail();
  return root.children[0];
}
const child = (n: Xml, name: string) => n.children.filter(c => c.name === name);
function one(n: Xml, name: string): Xml {
  const matches = child(n, name);
  if (matches.length !== 1) fail();
  return matches[0];
}
const truthy = (s?: string) => s !== undefined && s !== '0' && s !== 'false';
function int(s: string | undefined, max: number, min = 0): number {
  if (s === undefined || !/^(0|[1-9]\d*)$/.test(s)) fail();
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) limit();
  return n;
}
function textValue(s: string): string {
  if (size(s) > L.cellBytes || /_x[0-9a-f]{4}_/i.test(s)) fail('Workbook contains a long cell or unsupported Excel escape.');
  return s;
}
function rich(n: Xml): string {
  if (n.children.some(c => c.name !== 't' && c.name !== 'r')) fail();
  return textValue(n.children.map(c => c.name === 't' ? c.text : one(c, 't').text).join(''));
}
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function decimalParts(value: string): { units: bigint; scale: number } {
  if (!numeric.test(value) || value.length > 64) fail('Unsupported numeric cell value.');
  const [mantissa, exponent = '0'] = value.toLowerCase().split('e');
  const e = Number(exponent);
  const unsigned = mantissa.replace(/^[+-]/, '');
  const [whole, frac = ''] = unsigned.split('.');
  if (!Number.isInteger(e) || Math.abs(e) > 100 || whole.length + frac.length > 32) fail('Numeric cell exceeds exact decimal limits.');
  let units = BigInt((whole + frac) || '0') * (mantissa.startsWith('-') ? -1n : 1n);
  let scale = frac.length - e;
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  return { units, scale };
}
type NumberStyle = { kind: 'number' | 'currency' | 'percent' | 'date' | 'formatted'; format: string };
function numberStyle(id: number, custom: Map<number, string>): NumberStyle {
  const code = custom.get(id);
  if (code !== undefined) {
    const bare = code.replace(/"[^"]*"|\\./g, '').toLowerCase();
    if (/[年月日]|[ydhs]|m{2,}/.test(bare.replace(/\[[^\]]*\]/g, ''))) return { kind: 'date', format: code };
    if (/[$€£₹¥]|\[\$/.test(code)) return { kind: 'currency', format: code };
    if (bare.includes('%')) return { kind: 'percent', format: code };
    // Keep arbitrary formats verbatim; don't sum unknown units or scaling.
    return { kind: 'formatted', format: code };
  }
  const format = 'builtin:' + id;
  if ([5, 6, 7, 8, 42, 44].includes(id)) return { kind: 'currency', format };
  if (id === 9 || id === 10) return { kind: 'percent', format };
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return { kind: 'date', format };
  if (id >= 0 && id <= 13 || [37, 38, 39, 40, 48, 49].includes(id)) return { kind: 'number', format };
  return { kind: 'formatted', format };
}
function styles(entries: Map<string, string>): NumberStyle[] {
  const s = entries.get('xl/styles.xml');
  if (!s) return [numberStyle(0, new Map())];
  const root = xml(s);
  if (root.name !== 'styleSheet') fail();
  const custom = new Map<number, string>();
  for (const n of child(root, 'numFmts').flatMap(n => child(n, 'numFmt'))) {
    const id = int(n.attrs.numFmtId, 65535);
    const code = n.attrs.formatCode;
    if (!code || size(code) > 160 || custom.has(id)) fail();
    // Custom display formats may hide source data (e.g. ;;;).
    if (/;{2,}/.test(code) || /\\\*|_x[0-9a-f]{4}_/i.test(code)) fail('Unsupported custom number format.');
    custom.set(id, code);
  }
  return child(one(root, 'cellXfs'), 'xf').map(n => numberStyle(int(n.attrs.numFmtId ?? '0', 65535), custom));
}
function value(n: Xml, strings: string[], formats: NumberStyle[]): WorkbookCell {
  if (n.children.some(c => c.name !== 'v' && c.name !== 'is')) fail('Formulas and unsupported cell features are not accepted. Paste values into a new workbook.');
  const v = child(n, 'v'), inline = child(n, 'is');
  if (v.length > 1 || inline.length > 1 || (v.length && inline.length)) fail();
  const style = formats[int(n.attrs.s ?? '0', formats.length - 1)];
  const type = n.attrs.t ?? 'n', raw = v[0]?.text;
  if (type === 'inlineStr' && inline.length === 1) return { kind: 'text', value: rich(inline[0]) };
  if (inline.length || (type !== 'n' && type !== 's' && type !== 'b' && type !== 'd')) fail('Unsupported cell type. Formula and error cells must be replaced with values.');
  if (raw === undefined || raw === '') return blank();
  if (type === 's') return { kind: 'text', value: strings[int(raw, strings.length - 1)] };
  if (type === 'b') {
    if (raw !== '0' && raw !== '1') fail();
    return { kind: 'boolean', value: raw === '1' };
  }
  if (type === 'd') {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/.test(raw) || !Number.isFinite(Date.parse(raw))) fail();
    return { kind: 'iso-date', value: textValue(raw) };
  }
  decimalParts(raw);
  return { ...style, value: raw };
}
function cellColumn(ref: string | undefined, row: number): number {
  const m = /^([A-Z]{1,2})([1-9]\d*)$/.exec(ref ?? '');
  if (!m || Number(m[2]) !== row) fail();
  let col = 0;
  for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64;
  if (col > L.columns) limit();
  return col - 1;
}
const asText = (c: WorkbookCell): string | null => c.kind === 'blank' ? null : String(c.value);
function worksheet(root: Xml, name: string, index: number, strings: string[], formats: NumberStyle[], date1904: boolean): Worksheet {
  if (root.name !== 'worksheet') fail();
  const allowed = new Set(['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'pageMargins', 'pageSetup', 'printOptions', 'headerFooter']);
  if (root.children.some(n => !allowed.has(n.name))) fail('Unsupported worksheet feature (filters, merged cells, links, drawings or protection). Save plain visible tables.');
  if (child(root, 'sheetFormatPr').some(n => truthy(n.attrs.zeroHeight)) ||
      child(root, 'cols').flatMap(n => n.children).some(n => truthy(n.attrs.hidden) || n.attrs.width === '0' || truthy(n.attrs.collapsed))) fail('Hidden rows or columns are not accepted.');
  const rows: WorkbookRow[] = [];
  let width = 0, previous = 0;
  for (const row of one(root, 'sheetData').children) {
    if (row.name !== 'row' || truthy(row.attrs.hidden) || row.attrs.ht === '0' || truthy(row.attrs.collapsed)) fail('Hidden or unsupported worksheet rows are not accepted.');
    const r = int(row.attrs.r, L.rows + 1, 1);
    if (r <= previous || row.children.some(c => c.name !== 'c')) fail();
    previous = r;
    const cells: WorkbookCell[] = [];
    let prevCol = -1;
    for (const c of row.children) {
      const col = cellColumn(c.attrs.r, r);
      if (col <= prevCol) fail();
      prevCol = col;
      while (cells.length < col) cells.push(blank());
      cells.push(value(c, strings, formats));
    }
    width = Math.max(width, cells.length);
    rows.push({ row: r, cells });
  }
  if (rows.length < 2 || rows[0].row !== 1 || !width) fail('Each worksheet requires a header in row 1 and at least one data row.');
  // Preserve every physical row (including gaps) and every column.
  const byRow = new Map(rows.map(r => [r.row, r]));
  const full = Array.from({ length: previous }, (_, i) => {
    const cells = byRow.get(i + 1)?.cells ?? [];
    return { row: i + 1, cells: Array.from({ length: width }, (_, j) => cells[j] ?? blank()) };
  });
  if (full.length * width > L.cells) limit();
  const headers = full[0].cells;
  const mapped = headers.map(c => mapHeader(asText(c) ?? ''));
  const grievance = mapped.includes('id') && mapped.includes('complaintText');
  if (grievance && new Set(mapped.filter(Boolean)).size !== mapped.filter(Boolean).length) fail('Duplicate grievance header aliases are not accepted.');
  const data = full.slice(1);
  return { version: 1, info: { index, name, rows: data.length, columns: width, rowNumbers: data.map(r => r.row), kind: grievance ? 'grievance' : 'table' }, date1904, headers, data };
}
export type ParsedWorkbook = { sheets: Worksheet[]; records: GrievanceRecord[]; provenance: { recordId: string; sheetIndex: number; row: number }[]; sourceSha256: string };
export function parseWorkbook(bytes: Uint8Array, name: string): ParsedWorkbook {
  try {
    const entries = archive(bytes);
    const required = (path: string) => {
      const contents = entries.get(path);
      if (contents === undefined) fail();
      return xml(contents);
    };
    const types = required('[Content_Types].xml');
    if (types.name !== 'Types' || !child(types, 'Override').some(n => n.attrs.PartName === '/xl/workbook.xml' && n.attrs.ContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) fail();
    for (const [path, contents] of entries) {
      if (/<!DOCTYPE|<!ENTITY/i.test(contents)) fail();
      if (path.endsWith('.rels')) {
        const rels = xml(contents);
        if (rels.name !== 'Relationships' || rels.children.some(n => n.name !== 'Relationship' || n.attrs.TargetMode !== undefined && n.attrs.TargetMode !== 'Internal' || /externalLink|connections|vba|oleObject/i.test(n.attrs.Type ?? ''))) fail('External links and active workbook content are not accepted.');
      }
    }
    const book = required('xl/workbook.xml'), rels = required('xl/_rels/workbook.xml.rels');
    if (book.name !== 'workbook' || book.children.some(n => !['fileVersion', 'workbookPr', 'bookViews', 'sheets', 'definedNames', 'calcPr'].includes(n.name)) ||
        child(book, 'definedNames').some(n => n.children.length)) fail('Unsupported workbook feature. Use a plain workbook with no named ranges or links.');
    const date1904 = child(book, 'workbookPr').some(n => truthy(n.attrs.date1904));
    const sheetNodes = one(book, 'sheets').children;
    if (!sheetNodes.length || sheetNodes.length > L.sheets) limit();
    const strings = entries.has('xl/sharedStrings.xml') ? child(required('xl/sharedStrings.xml'), 'si').map(rich) : [];
    if (strings.length > L.cells) limit();
    const formats = styles(entries);
    const used = new Set<string>(), names = new Set<string>(), records: GrievanceRecord[] = [], provenance: ParsedWorkbook['provenance'] = [];
    let totalRows = 0, cells = 0;
    const sheets = sheetNodes.map((s, index) => {
      const name = s.attrs.name;
      if (s.name !== 'sheet' || s.attrs.state && s.attrs.state !== 'visible' || !name || name.length > 31 || names.has(name.toLowerCase())) fail('Hidden or invalid worksheets are not accepted.');
      names.add(name.toLowerCase());
      const matches = rels.children.filter(n => n.attrs.Id === s.attrs['r:id']);
      if (matches.length !== 1 || !matches[0].attrs.Type?.endsWith('/worksheet')) fail();
      const target = matches[0].attrs.Target ?? '';
      const path = target.startsWith('/xl/') ? target.slice(1) : 'xl/' + target;
      if (!/^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(path) || used.has(path)) fail();
      used.add(path);
      const sheet = worksheet(required(path), name, index, strings, formats, date1904);
      totalRows += sheet.info.rows;
      cells += (sheet.info.rows + 1) * sheet.info.columns;
      if (totalRows > L.totalRows || cells > L.cells || size(JSON.stringify(sheet)) > L.sheetBytes) limit();
      return sheet;
    });
    if ([...entries.keys()].some(p => p.startsWith('xl/worksheets/') && !used.has(p))) fail('Unreferenced worksheets are not accepted.');
    const ids = new Set<string>();
    for (const sheet of sheets) {
      if (sheet.info.kind !== 'grievance') continue;
      const keys = sheet.headers.map(c => mapHeader(asText(c) ?? ''));
      const objects = sheet.data.map(r => Object.fromEntries(keys.flatMap((k, i) => k ? [[k, asText(r.cells[i])]] : [])));
      const parsed = parseJsonImport(name, JSON.stringify(objects));
      if (parsed.records.length !== sheet.data.length || parsed.rejectedRows.length || parsed.duplicates.length || parsed.emptyRows) fail('Every grievance worksheet row requires a unique case ID and complaint text.');
      parsed.records.forEach((record, i) => {
        if (ids.has(record.id)) fail('Duplicate grievance IDs across worksheets are not accepted.');
        ids.add(record.id);
        const mappedRecord = { ...record, originalFileName: name, isSyntheticDemo: false,
          worksheetSource: { sheetIndex: sheet.info.index, sheetName: sheet.info.name, row: sheet.data[i].row } };
        validateRecordBounds(mappedRecord);
        records.push(mappedRecord);
        provenance.push({ recordId: record.id, sheetIndex: sheet.info.index, row: sheet.data[i].row });
      });
    }
    return { sheets, records, provenance, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (e) {
    if (e instanceof IngestError) throw e;
    return fail();
  }
}
