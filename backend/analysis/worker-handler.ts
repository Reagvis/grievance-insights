import type { SQSEvent } from 'aws-lambda';
import { createAnalysisWorker } from './core';
import { awsAnalysisDependencies } from './aws';

const deps = awsAnalysisDependencies();
const processJob = createAnalysisWorker(deps.datasets, deps.files, deps.jobs, deps.queue, deps.results, deps.model);
export async function handler(event: SQSEvent): Promise<void> {
  for (const message of event.Records) {
    const value = JSON.parse(message.body) as { jobId?: unknown; attempt?: unknown };
    if (typeof value.jobId !== 'string') throw new Error('SQS message missing job ID');
    const isDeadLetter = message.eventSourceARN === process.env.ANALYSES_DLQ_ARN;
    // Messages already in the pilot queue before the upgrade have no attempt field.
    const attempt = value.attempt === undefined ? 0 : value.attempt;
    if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) throw new Error('Invalid SQS attempt');
    try {
      await processJob(value.jobId, isDeadLetter, attempt);
    } catch (error) {
      console.error(JSON.stringify({ event: 'analysis_batch_error', jobId: value.jobId, attempt,
        errorType: error instanceof Error ? error.name : 'Unknown' }));
      throw error;
    }
  }
}
