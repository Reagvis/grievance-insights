import type { GrievanceRecord } from '../../src/domain/grievance';
import type { Metadata, PrivateObjects } from './core';
import { validateRecordBounds } from './bounds';

/** Immutable private S3 slices derived only from fully validated source uploads. */
export const INDEX_CHUNK_RECORDS = 50;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function indexChunkKey(sourceKey: string, chunk: number): string {
  if (!/^raw\/[0-9a-f-]+\/source\.(txt|md|docx|csv|json|jsonl|pdf)$/.test(sourceKey) || !Number.isInteger(chunk) || chunk < 0 || chunk >= 40) {
    throw new Error('Invalid dataset index key');
  }
  return sourceKey.replace(/source\.(txt|md|docx|csv|json|jsonl|pdf)$/, 'index-v1/' + chunk + '.json');
}
export function indexChunkCount(total: number): number {
  return Math.ceil(total / INDEX_CHUNK_RECORDS);
}

/**
 * Four concurrent PUTs per wave. Each immutable chunk is below 1.2 MiB.
 * Return the written keys for rollback if the following metadata CAS fails.
 */
export async function writeDatasetIndex(sourceKey: string, records: GrievanceRecord[], files: PrivateObjects): Promise<string[]> {
  if (!files.write) throw new Error('Private dataset index writer unavailable');
  const written: string[] = [];
  try {
    for (let start = 0; start < records.length; start += INDEX_CHUNK_RECORDS * 4) {
      const tasks = Array.from({ length: Math.min(4, Math.ceil((records.length - start) / INDEX_CHUNK_RECORDS)) }, (_, slot) => {
        const index = Math.floor(start / INDEX_CHUNK_RECORDS) + slot;
        const key = indexChunkKey(sourceKey, index);
        const bytes = encoder.encode(JSON.stringify(records.slice(index * INDEX_CHUNK_RECORDS, (index + 1) * INDEX_CHUNK_RECORDS)));
        return files.write!(key, bytes).then(() => { written.push(key); });
      });
      const settled = await Promise.allSettled(tasks);
      const rejected = settled.find(result => result.status === 'rejected');
      if (rejected && rejected.status === 'rejected') throw rejected.reason;
    }
    return written;
  } catch (error) {
    await Promise.allSettled(written.map(key => files.remove(key)));
    throw error;
  }
}
export async function removeDatasetIndex(sourceKey: string, count: number, files: PrivateObjects): Promise<void> {
  for (let i = 0; i < indexChunkCount(count); i += 4) {
    await Promise.all(Array.from({ length: Math.min(4, indexChunkCount(count) - i) }, (_, slot) =>
      files.remove(indexChunkKey(sourceKey, i + slot))));
  }
}
export async function readIndexedRange(dataset: Metadata, files: PrivateObjects, start: number, end: number): Promise<GrievanceRecord[]> {
  if (dataset.indexVersion !== 1 || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end > dataset.recordCount || end < start) throw new Error('Invalid indexed dataset range');
  const result: GrievanceRecord[] = [];
  for (let chunk = Math.floor(start / INDEX_CHUNK_RECORDS); chunk <= Math.floor((end - 1) / INDEX_CHUNK_RECORDS); chunk++) {
    const first = chunk * INDEX_CHUNK_RECORDS;
    const expected = Math.min(INDEX_CHUNK_RECORDS, dataset.recordCount - first);
    const bytes = await files.read(indexChunkKey(dataset.key, chunk));
    // 50 * 24 KiB source records plus JSON framing; reject corrupted index objects.
    if (bytes.length > INDEX_CHUNK_RECORDS * 24 * 1024 + 1024) throw new Error('Indexed chunk exceeds byte budget');
    const rows: unknown = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(rows) || rows.length !== expected) throw new Error('Indexed chunk record count mismatch');
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' ||
          typeof row.complaintText !== 'string') throw new Error('Invalid indexed record');
      validateRecordBounds(row as GrievanceRecord);
    }
    result.push(...(rows as GrievanceRecord[]).slice(Math.max(0, start - first), Math.min(expected, end - first)));
  }
  return result;
}
