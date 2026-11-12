import type { GrievanceRecord } from '../../src/domain/grievance';
import type { CanonicalDataset } from '../ingest';
import type { DatasetStore, Metadata, PrivateObjects } from './core';
import { writeDatasetIndex } from './index';

/** Provenance (source hash, extraction method, per-page OCR/text-layer) is kept as its own private object beside the original. */
export const provenanceKey = (sourceKey: string) => sourceKey.replace(/source\.[a-z]+$/, 'provenance.json');

/**
 * The one place a dataset becomes `ready`, used by the synchronous finalize path and by the asynchronous extraction worker.
 *
 *   1. record count is made durable first (so a failure part-way can always be cleaned up),
 *   2. immutable index chunks (Task 19) and the provenance object are written,
 *   3. only then does the state move `from → ready`, by compare-and-set.
 *
 * If anything fails, everything written here is removed again and the error propagates: a dataset is never `ready`
 * with partial content. Re-running with the same input is safe (chunks are deterministic).
 */
export async function commitDataset(
  item: Metadata,
  records: GrievanceRecord[],
  provenance: Pick<CanonicalDataset, 'schemaVersion' | 'format' | 'sourceFile' | 'sourceSha256' | 'provenance' | 'notes'> & { extractedAt: string },
  from: 'validating' | 'extracting',
  store: DatasetStore,
  objects: PrivateObjects,
): Promise<void> {
  if (!objects.write) throw new Error('Private dataset writer unavailable');
  let written: string[] = [];
  const pKey = provenanceKey(item.key);
  try {
    if (!(await store.transition(item.id, from, from, { recordCount: records.length }))) throw new Error('Dataset state changed');
    written = await writeDatasetIndex(item.key, records, objects);
    await objects.write(pKey, new TextEncoder().encode(JSON.stringify(provenance)));
    written.push(pKey);
    if (!(await store.transition(item.id, from, 'ready', { recordCount: records.length, indexVersion: 1 }))) throw new Error('Dataset finalization state changed');
  } catch (error) {
    await Promise.allSettled(written.map((key) => objects.remove(key)));
    throw error;
  }
}
