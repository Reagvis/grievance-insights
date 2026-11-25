import type { WorkbookCell, Worksheet } from '../domain/workbook';

/** Chart numbers come only from one owner-authorized typed worksheet, never AI prose. */
export type ChartKind = 'bar' | 'line' | 'pie';
export type ChartPoint = { label: string; exact: string; rows: number[] };
export type ChartSpec = {
  kind: ChartKind;
  title: string;
  sheetIndex: number;
  sheetName: string;
  dimension: string;
  measure: string;
  unit: string;
  points: ChartPoint[];
  total: string;
  coveredRows: number;
  sourceRows: number;
  excludedRows: number;
  note: string;
};
export type ChartDecision = { chart: ChartSpec; reason?: never } | { chart?: never; reason: string };
type Decimal = { units: bigint; scale: number };
const MAX_POINTS = 12;
const zero = (): Decimal => ({ units: 0n, scale: 0 });
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseDecimal(value: string): Decimal | null {
  if (value.length > 64 || !numericPattern.test(value)) return null;
  const [mantissa, exp = '0'] = value.toLowerCase().split('e');
  const exponent = Number(exp);
  const [whole, fraction = ''] = mantissa.replace(/^[+-]/, '').split('.');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100 || whole.length + fraction.length > 32) return null;
  let units = BigInt((whole + fraction) || '0') * (mantissa[0] === '-' ? -1n : 1n);
  let scale = fraction.length - exponent;
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  if (scale > 32 || units.toString().length > 100) return null;
  return { units, scale };
}
export function sumDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}
export function exactText(d: Decimal): string {
  const sign = d.units < 0n ? '-' : '';
  const digits = (d.units < 0n ? -d.units : d.units).toString().padStart(d.scale + 1, '0');
  return sign + (d.scale ? digits.slice(0, -d.scale) + '.' + digits.slice(-d.scale) : digits);
}
const stringValue = (cell: WorkbookCell | undefined) => !cell || cell.kind === 'blank' ? '' : String(cell.value);
const labelOf = (s: string) => s.trim().replace(/\s+/gu, ' ');
type NumericCell = Extract<WorkbookCell, { format: string }>;
const isNumeric = (cell: WorkbookCell | undefined): cell is NumericCell =>
  !!cell && (cell.kind === 'number' || cell.kind === 'currency' || cell.kind === 'percent');
const identifier = /(?:^|[\s_-])(id|code|identifier|reference|ref|phone|zip|pin|serial)(?:$|[\s_-])/i;
const temporal = /\b(month|date|period|year|quarter|week)\b/i;
const metricName = /\b(amount|total|spend|sales|revenue|budget|cost|expense|quantity|count|value|volume|income|price|rate)\b/i;
const categoryName = /\b(category|categories|district|department|status|type|region|area|group|team|product|sector|location|division|service|class)\b/i;
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function timeValue(cell: WorkbookCell | undefined, heading: string, date1904: boolean): { label: string; order: number } | null {
  if (!temporal.test(heading) || !cell || cell.kind === 'blank') return null;
  if (cell.kind === 'text' || cell.kind === 'iso-date') {
    const input = String(cell.value).trim();
    const month = months.findIndex(m => m.toLowerCase() === input.toLowerCase() || m.slice(0,3).toLowerCase() === input.toLowerCase());
    if (month >= 0) return { label: months[month], order: month };
    if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(input)) {
      const year = Number(input.slice(0,4)), mo = Number(input.slice(5,7));
      if (year >= 1900 && year < 10000 && mo >= 1 && mo <= 12) {
        if (input.length === 10) {
          const day = Number(input.slice(8,10));
          const test = new Date(Date.UTC(year,mo-1,day));
          if (test.getUTCFullYear() !== year || test.getUTCMonth() !== mo-1 || test.getUTCDate() !== day) return null;
        }
        return { label: input.slice(0,7), order: year * 12 + mo };
      }
    }
  }
  if (cell.kind === 'number' && /\byear\b/i.test(heading) && /^\d{4}$/.test(cell.value)) {
    const year = Number(cell.value);
    return year >= 1900 && year <= 9999 ? { label: cell.value, order: year } : null;
  }
  if (cell.kind === 'date' && /^\d+$/.test(cell.value)) {
    const n = Number(cell.value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 2958465 || (!date1904 && n === 60)) return null;
    const epoch = date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,n < 60 ? 31 : 30);
    const date = new Date(epoch + n * 86400000);
    if (!Number.isFinite(date.getTime())) return null;
    const year = date.getUTCFullYear(), mo = date.getUTCMonth() + 1;
    return { label: String(year).padStart(4,'0') + '-' + String(mo).padStart(2,'0'), order: year * 12 + mo };
  }
  return null;
}
export function chartRequested(question: string): boolean {
  return /\b(chart|graph|plot|trend|monthly|compare|comparison|categories|category|distribution|shares?|breakdown|summari[sz]e|overview)\b/i.test(question) ||
    /(చార్ట్|గ్రాఫ్|సారాంశ|నెలవారీ|పోల్చు|వర్గాల)/u.test(question);
}
function validSheet(sheet: Worksheet): boolean {
  const info = sheet?.info;
  return !!info && sheet.version === 1 && Number.isInteger(info.index) && info.index >= 0 && info.index < 8 &&
    typeof info.name === 'string' && info.name.length > 0 && info.name.length <= 31 &&
    Number.isInteger(info.columns) && info.columns >= 1 && info.columns <= 32 &&
    Number.isInteger(info.rows) && info.rows >= 1 && info.rows <= 1000 &&
    sheet.headers.length === info.columns && sheet.data.length === info.rows &&
    Array.isArray(info.rowNumbers) && info.rowNumbers.length === info.rows &&
    sheet.data.every((r,i) => r.row === info.rowNumbers[i] && r.row >= 2 && r.row <= 1001 && r.cells.length === info.columns);
}
export function buildWorkbookChart(sheet: Worksheet, question: string): ChartDecision {
  if (!validSheet(sheet)) return { reason: 'Worksheet dimensions or source rows could not be verified.' };
  if (sheet.info.rows < 2) return { reason: 'At least two source rows are needed for a meaningful chart.' };
  const headings = sheet.headers.map((cell,i) => labelOf(stringValue(cell)) || 'Column ' + (i+1));
  const columns = headings.map((name,index)=>({ name,index }));
  const dates = columns.filter(c => temporal.test(c.name) &&
    sheet.data.some(r => timeValue(r.cells[c.index],c.name,sheet.date1904) !== null));
  const categories = columns.filter(c => !identifier.test(c.name) &&
    sheet.data.some(r => ['text','boolean','iso-date'].includes(r.cells[c.index]?.kind ?? 'blank')) &&
    (categoryName.test(c.name) || (() => {
      const values = sheet.data.map(r => labelOf(stringValue(r.cells[c.index]))).filter(Boolean);
      return values.length > 1 && new Set(values).size < values.length && new Set(values).size <= 12;
    })()));
  const wantTrend = /\b(trend|monthly|timeline|over time|by month|by date|line|yearly)\b/i.test(question) || /నెలవారీ/u.test(question);
  const wantCategory = /\b(category|categories|compare|comparison|distribution|share|pie|donut)\b/i.test(question);
  const wantShare = /\b(pie|donut|share|distribution|proportion)\b/i.test(question);
  const wantCount = /\b(count|number of|how many|frequency)\b/i.test(question);
  const dimension = wantTrend ? dates[0] : (wantCategory ? categories[0] ?? dates[0] : dates[0] ?? categories[0]);
  if (!dimension) return { reason: 'No suitable category or time dimension is available.' };
  const isTime = !!dates.find(d=>d.index === dimension.index);
  if (wantTrend && !isTime) return { reason: 'This worksheet has no interpretable time column.' };
  const metrics = columns.filter(c => c.index !== dimension.index && !identifier.test(c.name) &&
    sheet.data.some(r => isNumeric(r.cells[c.index])) &&
    sheet.data.every(r => r.cells[c.index]?.kind === 'blank' || isNumeric(r.cells[c.index])));
  const mentionedMetric = metrics.find(c => question.toLowerCase().includes(c.name.toLowerCase()));
  const metric = wantCount ? undefined : mentionedMetric ?? metrics.find(c => metricName.test(c.name)) ?? metrics[0];
  type Group = { label: string; order: number; sum: Decimal; rows: number[] };
  const groups = new Map<string,Group>();
  let excluded = 0, covered = 0;
  let format: string | undefined;
  for (const row of sheet.data) {
    const dimensionCell = row.cells[dimension.index];
    const time = isTime ? timeValue(dimensionCell, dimension.name, sheet.date1904) : null;
    const label = isTime ? time?.label ?? '' : labelOf(stringValue(dimensionCell));
    if (!label) { excluded++; continue; }
    if (label.length > 90) return { reason: 'Category labels longer than 90 characters cannot be safely charted without losing distinctions.' };
    let amount: Decimal = {units:1n,scale:0};
    if (metric) {
      const cell = row.cells[metric.index];
      if (!isNumeric(cell)) { excluded++; continue; }
      const currentFormat = cell.kind + ':' + cell.format;
      if (format && format !== currentFormat) return {reason:'The selected metric mixes number formats or units. No values were combined.'};
      format = currentFormat;
      const parsed = parseDecimal(cell.value);
      if (!parsed) return {reason:'At least one numeric cell is outside supported exact-decimal limits.'};
      if (cell.kind === 'percent' && groups.has(label)) return {reason:'Repeated percentages cannot be summed meaningfully.'};
      amount = cell.kind === 'percent' ? {units:parsed.units * 100n,scale:parsed.scale} : parsed;
    }
    const group = groups.get(label) ?? { label, order:time?.order ?? 0, sum:zero(), rows:[] };
    group.sum = sumDecimal(group.sum,amount);
    group.rows.push(row.row);
    groups.set(label,group);
    covered++;
    if (groups.size > 12) return {reason:'More than 12 distinct categories or periods were found. A chart would hide values; narrow the worksheet first.'};
  }
  if (groups.size < 2) return {reason:'Fewer than two comparable nonblank groups were found.'};
  const ordered = [...groups.values()];
  if (isTime) ordered.sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label));
  else ordered.sort((a,b)=>a.label.localeCompare(b.label,'en',{numeric:true}));
  const values = ordered.map(g=>Number(exactText(g.sum)));
  if (values.every(n=>n===0) || values.some(n=>!Number.isFinite(n) || Math.abs(n)>Number.MAX_SAFE_INTEGER)) {
    return {reason:'Numbers are all zero or exceed safe SVG plotting precision. The worksheet retains the exact values.'};
  }
  let total = zero();
  for (const group of ordered) total = sumDecimal(total,group.sum);
  const unit = !metric ? 'source rows (count)' : format?.startsWith('currency:') ?
    'currency; Excel format ' + format.slice(9) : format?.startsWith('percent:') ?
    'percent (%)' : 'numeric source values; Excel format ' + (format?.slice(7) ?? 'General');
  const percentMeasure = format?.startsWith('percent:') ?? false;
  const kind: ChartKind = isTime ? 'line' : wantShare && !percentMeasure && ordered.length<=6 && values.every(n=>n>0) ? 'pie' : 'bar';
  const measure = metric?.name ?? 'Row count';
  return {chart:{
    kind, title:(kind==='line'?'Trend of ':kind==='pie'?'Share of ':'Comparison of ')+measure+' by '+dimension.name,
    sheetIndex:sheet.info.index,sheetName:sheet.info.name,dimension:dimension.name,measure,unit,
    points:ordered.map(g=>({label:g.label,exact:exactText(g.sum),rows:g.rows})),
    total:percentMeasure ? 'not additive' : exactText(total),coveredRows:covered,sourceRows:sheet.info.rows,excludedRows:excluded,
    note:'Calculated from exact typed worksheet values, independent of the Assistant model. '+
      (excluded ? excluded+' row(s) excluded (missing/incompatible labels or values). ':'All data rows included. ')+
      (kind==='pie'?'Share denominator is the sum of all included positive values.': percentMeasure ? 'Percentage values cannot be summed across categories without a common denominator.' : 'SVG geometry is approximate; the data table contains exact values.')
  }};
}
