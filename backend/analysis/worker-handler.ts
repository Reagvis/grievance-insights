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
    if (typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt) || value.attempt < 0) throw new Error('SQS message missing attempt');
    await processJob(value.jobId, isDeadLetter, value.attempt);
  }
}
