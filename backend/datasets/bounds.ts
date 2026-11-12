import type { GrievanceRecord } from '../../src/domain/grievance';
import { recordPrompt } from '../analysis/schema';

/**
 * UTF-8 byte ceilings, not JavaScript code-unit lengths.
 * A 12 KiB prompt is well below the model's 32K-token context even for
 * pathological byte-level tokenization, leaving room for system/output tokens.
 * The 24 KiB serialized-row ceiling also bounds authenticated API responses.
 * Never truncate source text: reject the entire invalid upload.
 */
export const MAX_RECORD_PROMPT_BYTES = 12 * 1024;
export const MAX_RECORD_JSON_BYTES = 24 * 1024;

export function validateRecordBounds(record: GrievanceRecord): void {
  if (Buffer.byteLength(recordPrompt(record), 'utf8') > MAX_RECORD_PROMPT_BYTES) {
    throw new Error('A record exceeds the 12 KiB AI-input limit. Split or correct the source and upload again; no text was truncated.');
  }
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECORD_JSON_BYTES) {
    throw new Error('A record exceeds the 24 KiB serialized-record limit. Split or correct the source and upload again; no text was truncated.');
  }
}
