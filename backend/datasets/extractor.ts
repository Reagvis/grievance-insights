import { IngestError } from '../ingest';
import { ingestWithOcr, type OcrEngine } from '../ingest/ocr';
import { commitDataset, provenanceKey } from './commit';
import { ApiError, type DatasetStore, type PrivateObjects } from './core';
import { removeDatasetIndex } from './index';

export type ExtractionOutcome = 'ready' | 'failed' | 'skipped';

/**
 * Asynchronous PDF extraction (text layer, plus OCR for scanned/damaged pages).
 *
 * Guarantees:
 *  - idempotent: a message for a dataset that is no longer `extracting` (finished, failed, deleted, duplicate delivery) is a no-op;
 *  - a dataset becomes `ready` only through commitDataset, i.e. after every page was extracted and the records validated;
 *  - terminal problems (corrupt/encrypted/over-limit/OCR could not read a page) mark the dataset `failed` with a clear message
 *    and are NOT retried (retrying would only repeat the paid work);
 *  - transient problems (S3, DynamoDB, a Lambda timeout or crash) are re-thrown so SQS redelivers; after the queue's
 *    maxReceiveCount the dead-letter message marks the dataset `failed`, so nothing stays `extracting` forever;
 *  - leftovers of an interrupted earlier attempt are removed first (index objects are immutable and cannot be overwritten).
 */
export function createExtractionWorker(store: DatasetStore, objects: PrivateObjects, engine: () => Promise<OcrEngine>, now: () => number = Date.now) {
  return async function extract(datasetId: string, opts: { deadLetter?: boolean; deadlineMs?: number } = {}): Promise<ExtractionOutcome> {
    const item = await store.get(datasetId);
    if (!item || item.status !== 'extracting') return 'skipped';
    if (opts.deadLetter) {
      await store.transition(datasetId, 'extracting', 'failed', { error: 'Extraction could not be completed after several attempts. Delete this dataset and upload it again.' });
      return 'failed';
    }
    try {
      const size = await objects.size(item.key);
      if (size === null) throw new ApiError(422, 'Upload is incomplete or missing.');
      if (size !== item.bytes) throw new ApiError(422, 'Uploaded size differs from the requested size.');
      await removeDatasetIndex(item.key, 1, objects);
      await objects.remove(provenanceKey(item.key));
      const outcome = await ingestWithOcr({ name: item.name, bytes: await objects.read(item.key), engine, deadlineMs: opts.deadlineMs });
      if (outcome.kind !== 'complete') throw new IngestError('Extraction did not complete.', 'ocr_failed');
      const { records, ...rest } = outcome.canonical;
      await commitDataset(item, records, { ...rest, extractedAt: new Date(now()).toISOString() }, 'extracting', store, objects);
      return 'ready';
    } catch (error) {
      const terminal = error instanceof IngestError || (error instanceof ApiError && error.status === 422);
      if (!terminal) throw error;
      await store.transition(datasetId, 'extracting', 'failed', { error: error.message });
      return 'failed';
    }
  };
}
