import { WORKBOOK_LIMITS as L, type Worksheet } from '../../src/domain/workbook';
import type { ParsedWorkbook } from '../ingest/xlsx';
import type { DatasetStore, Metadata, PrivateObjects } from './core';
import { writeDatasetIndex } from './index';
import { provenanceKey } from './commit';

export function worksheetKey(source: string, index: number) {
  if (!/^raw\/[0-9a-f-]+\/source\.xlsx$/.test(source) || !Number.isInteger(index) || index < 0 || index >= L.sheets) throw new Error('Invalid worksheet key');
  return source.replace(/source\.xlsx$/, 'workbook-v1/' + index + '.json');
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** Persist metadata before writes for retriable deletion; only expose complete immutable objects. */
export async function commitWorkbook(item: Metadata, workbook: ParsedWorkbook, store: DatasetStore, objects: PrivateObjects): Promise<Metadata> {
  if (!objects.write) throw new Error('Private workbook writer unavailable');
  const patch = { sheets: workbook.sheets.map(s => s.info), recordCount: workbook.records.length };
  const written: string[] = [];
  try {
    if (!await store.transition(item.id, 'validating', 'validating', patch)) throw new Error('Workbook state changed');
    for (const sheet of workbook.sheets) {
      const key = worksheetKey(item.key, sheet.info.index);
      const bytes = encode(sheet);
      if (bytes.length > L.sheetBytes) throw new Error('Worksheet index too large');
      await objects.write(key, bytes);
      written.push(key);
    }
    written.push(...await writeDatasetIndex(item.key, workbook.records, objects));
    const key = provenanceKey(item.key);
    await objects.write(key, encode({ schemaVersion: 1, format: 'xlsx', sourceFile: item.name, sourceSha256: workbook.sourceSha256, provenance: workbook.provenance }));
    written.push(key);
    if (!await store.transition(item.id, 'validating', 'ready', { ...patch, indexVersion: 1 })) throw new Error('Workbook state changed');
    return { ...item, ...patch, status: 'ready', indexVersion: 1 };
  } catch (error) {
    await Promise.allSettled(written.map(key => objects.remove(key)));
    throw error;
  }
}

/** Caller must establish authenticated owner and ready state before this read. */
export async function readWorksheet(item: Metadata, objects: PrivateObjects, index: number): Promise<Worksheet | undefined> {
  if (item.format !== 'xlsx' || item.status !== 'ready' || item.indexVersion !== 1) return;
  const info = item.sheets?.find(s => s.index === index);
  if (!info) return;
  const bytes = await objects.read(worksheetKey(item.key, index));
  if (bytes.length > L.sheetBytes) throw new Error('Worksheet index exceeds bounds');
  const sheet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Worksheet;
  if (sheet.version !== 1 || JSON.stringify(sheet.info) !== JSON.stringify(info) ||
      !Array.isArray(sheet.headers) || sheet.headers.length !== info.columns ||
      !Array.isArray(sheet.data) || sheet.data.length !== info.rows ||
      sheet.data.some((r, i) => r.row !== info.rowNumbers[i] || !Array.isArray(r.cells) || r.cells.length !== info.columns)) throw new Error('Invalid worksheet index');
  return sheet;
}
export async function removeWorkbook(item: Metadata, objects: PrivateObjects) {
  for (const info of item.sheets ?? []) await objects.remove(worksheetKey(item.key, info.index));
}
