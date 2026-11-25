import type { Worksheet, WorkbookCell } from '../../src/domain/workbook';
import { decimalParts } from '../ingest/xlsx';

function decimalString(units: bigint, scale: number): string {
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  return sign + digits.slice(0, -scale) + ('.' + digits.slice(-scale)).replace(/0+$/, '').replace(/\.$/, '');
}
type Total = { count: number; units: bigint; scale: number };
function add(total: Total, value: string) {
  const next = decimalParts(value);
  const scale = Math.max(total.scale, next.scale);
  total.units = total.units * 10n ** BigInt(scale - total.scale) + next.units * 10n ** BigInt(scale - next.scale);
  total.scale = scale;
  total.count++;
}
function numeric(cell: WorkbookCell): cell is Extract<WorkbookCell, { format: string }> {
  return cell.kind === 'number' || cell.kind === 'currency' || cell.kind === 'percent';
}
/** Deterministic full-sheet summaries. Never add different format groups or dates.
 * Counts include blanks and all physical data rows; decimal sums use BigInt.
 * Numeric identifiers are not necessarily measures: label as arithmetic totals only. */
export function summarizeWorksheet(sheet: Worksheet) {
  return sheet.headers.map((header, col) => {
    const types: Record<string, number> = {};
    const totals = new Map<string, Total>();
    for (const row of sheet.data) {
      const cell = row.cells[col];
      types[cell.kind] = (types[cell.kind] ?? 0) + 1;
      if (numeric(cell)) {
        const key = cell.kind + ':' + cell.format;
        const total = totals.get(key) ?? { count: 0, units: 0n, scale: 0 };
        add(total, cell.value);
        totals.set(key, total);
      }
    }
    return { column: col + 1, header, types, totals: [...totals].map(([format, total]) => ({
      format, count: total.count, exactSum: decimalString(total.units, total.scale),
    })) };
  });
}
export function worksheetContext(sheet: Worksheet, row: number | undefined, maxBytes: number): string {
  const source = { sheetIndex: sheet.info.index, sheetName: sheet.info.name, kind: sheet.info.kind, date1904: sheet.date1904,
    rowCount: sheet.info.rows, columnCount: sheet.info.columns, headerRow: 1 };
  if (row !== undefined) return JSON.stringify({ ...source, coverage: 'selected row only', headers: sheet.headers, rows: sheet.data.filter(r => r.row === row) });
  const columns = summarizeWorksheet(sheet);
  const summary = { ...source, coverage: 'all data rows summarized; arithmetic totals by cell format, not interpreted measures; percent values are stored fractions', columns };
  const full = JSON.stringify({ ...summary, coverage: 'all data rows and exact arithmetic summaries by format; percent values are stored fractions', rows: sheet.data });
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full;
  return JSON.stringify({ ...summary, coverage: 'summary only: all data rows counted, individual rows omitted; select a row for details; arithmetic totals by format, percent values are stored fractions' });
}
