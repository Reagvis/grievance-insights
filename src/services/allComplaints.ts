import type { GrievanceRecord } from '../domain/grievance';
import { listDatasets, openDataset, type RemoteDataset } from './datasetApi';

/**
 * The signed-in app shows ONE list: every complaint from every uploaded file, newest file first.
 * Uploads are still stored as separate private files (one per upload); this module merges them for display.
 */
export type SourceRef = { datasetId: string; fileName: string; fileRecordCount: number; /** When the file was uploaded (ISO). */ addedAt: string };
export type AllComplaints = {
  /** Merged list; IDs are unique across files. */
  records: GrievanceRecord[];
  /** Merged record ID → the uploaded file it came from (used for "delete this file"). */
  sourceOf: ReadonlyMap<string, SourceRef>;
  /** Each file's records exactly as stored (original IDs), for per-file AI analysis whose report is keyed by those IDs. */
  recordsByDataset: ReadonlyMap<string, GrievanceRecord[]>;
  /** Every uploaded file, newest first, in any state (ready, extracting, failed…). */
  files: RemoteDataset[];
  /** Names of ready files that could not be opened this time. */
  unreadable: string[];
};

/** Merge files (newest first). A repeated ID from a later file is kept, renamed "ID (file name)" so nothing is ever dropped. */
export function mergeComplaints(loaded: Array<{ dataset: RemoteDataset; records: GrievanceRecord[] }>): Pick<AllComplaints, 'records' | 'sourceOf' | 'recordsByDataset'> {
  const records: GrievanceRecord[] = [];
  const sourceOf = new Map<string, SourceRef>();
  const recordsByDataset = new Map<string, GrievanceRecord[]>();
  const seen = new Set<string>();
  for (const { dataset, records: list } of loaded) {
    recordsByDataset.set(dataset.id, list);
    for (const record of list) {
      let id = record.id;
      if (seen.has(id)) {
        id = `${record.id} (${dataset.name})`;
        for (let n = 2; seen.has(id); n++) id = `${record.id} (${dataset.name} #${n})`;
      }
      seen.add(id);
      records.push(id === record.id ? record : { ...record, id });
      sourceOf.set(id, { datasetId: dataset.id, fileName: dataset.name, fileRecordCount: list.length, addedAt: dataset.createdAt });
    }
  }
  return { records, sourceOf, recordsByDataset };
}

export async function loadAllComplaints(): Promise<AllComplaints> {
  const files = (await listDatasets()).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ready = files.filter((f) => f.status === 'ready');
  const loaded: Array<{ dataset: RemoteDataset; records: GrievanceRecord[] } | null> = new Array(ready.length).fill(null);
  const unreadable: string[] = [];
  let next = 0;
  // Three files at a time: quick for a handful of files, gentle on the API for many.
  await Promise.all(Array.from({ length: Math.min(3, ready.length) }, async () => {
    while (next < ready.length) {
      const index = next++;
      try {
        const opened = await openDataset(ready[index].id);
        if (opened.records) loaded[index] = { dataset: ready[index], records: opened.records };
        else unreadable.push(ready[index].name);
      } catch {
        unreadable.push(ready[index].name);
      }
    }
  }));
  return { ...mergeComplaints(loaded.filter((x): x is NonNullable<typeof x> => x !== null)), files, unreadable };
}
