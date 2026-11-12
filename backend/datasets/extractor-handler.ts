import { join } from 'node:path';
import type { Context, SQSEvent } from 'aws-lambda';
import { createTesseractEngine } from '../ingest/ocr';
import { createAwsDatasetDependencies } from './aws';
import { createExtractionWorker } from './extractor';

const deps = createAwsDatasetDependencies();
// Tesseract language data ships inside the deployment package; nothing is downloaded at runtime.
const tessdata = process.env.TESSDATA_DIR ?? join(__dirname, 'tessdata');
const extract = createExtractionWorker(deps.store, deps.objects, () => createTesseractEngine(tessdata));

export async function handler(event: SQSEvent, context: Context): Promise<void> {
  for (const message of event.Records) {
    const value = JSON.parse(message.body) as { datasetId?: unknown };
    if (typeof value.datasetId !== 'string') throw new Error('SQS message missing dataset ID');
    const deadLetter = message.eventSourceARN === process.env.EXTRACTION_DLQ_ARN;
    try {
      // Stop OCR 20 s before the Lambda timeout so a slow document fails cleanly instead of being killed mid-write.
      await extract(value.datasetId, { deadLetter, deadlineMs: Date.now() + context.getRemainingTimeInMillis() - 20_000 });
    } catch (error) {
      // Never log document text or file names: only the dataset ID and error type.
      console.error(JSON.stringify({ event: 'extraction_error', datasetId: value.datasetId, errorType: error instanceof Error ? error.name : 'Unknown' }));
      throw error;
    }
  }
}
