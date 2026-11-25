/** XLSX values are source values, not rendered Excel text or JS floating-point numbers. */
export type WorkbookCell =
  | { kind: 'blank' }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number' | 'currency' | 'percent' | 'date' | 'formatted'; value: string; format: string }
  | { kind: 'iso-date'; value: string };
export type WorkbookRow = { row: number; cells: WorkbookCell[] };
export type SheetInfo = { index: number; name: string; rows: number; columns: number; rowNumbers: number[]; kind: 'grievance' | 'table' };
export type Worksheet = { version: 1; info: SheetInfo; date1904: boolean; headers: WorkbookCell[]; data: WorkbookRow[] };
export const WORKBOOK_LIMITS = {
  bytes: 2 * 1024 * 1024, inflated: 8 * 1024 * 1024, entries: 100, ratio: 150,
  sheets: 8, rows: 1000, totalRows: 2000, columns: 32, cells: 16000,
  cellBytes: 4000, sheetBytes: 1024 * 1024,
} as const;
