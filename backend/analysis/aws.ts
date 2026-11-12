import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDatasets, SignedS3 } from '../datasets/aws';
import type { Job, JobQueue, JobStore, ResultObjects, Inference } from './core';
import { InvalidModelOutput, MODEL_ID, MODEL_REGION, SYSTEM_PROMPT, parseConverseOutput, recordPrompt, type Report, type RecordOutcome } from './schema';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { objectUrl, signedAwsRequest } from './aws-http';

const textBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function conditional(error: unknown): boolean { return error instanceof Error && error.name === 'ConditionalCheckFailedException'; }
export class DynamoJobs implements JobStore {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly table: string) {}
  async get(id: string): Promise<Job | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.table, Key: { id }, ConsistentRead: true }));
    return response.Item as Job | undefined;
  }
  async create(job: Job): Promise<boolean> {
    try {
      await this.client.send(new PutCommand({ TableName: this.table, Item: job, ConditionExpression: 'attribute_not_exists(id)' }));
      return true;
    } catch (error) { if (conditional(error)) return false; throw error; }
  }
  async start(id: string, startedAt: string, attempt = 0) {
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id },
        UpdateExpression: 'SET #s = :running, startedAt = :started',
        ConditionExpression: '#s = :queued AND (#attempt = :attempt OR (attribute_not_exists(#attempt) AND :attempt = :zero))',
        ExpressionAttributeNames: { '#s': 'status', '#attempt': 'attempt' },
        ExpressionAttributeValues: { ':running': 'running', ':queued': 'queued', ':started': startedAt, ':attempt': attempt, ':zero': 0 } }));
    } catch (error) { if (!conditional(error)) throw error; }
  }
  async checkpoint(id: string, expected: number, failed: boolean, attempt = 0): Promise<boolean> {
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id },
        UpdateExpression: 'SET #cursor = :next ADD failureCount :failed',
        ConditionExpression: '#s = :running AND #cursor = :expected AND (#attempt = :attempt OR (attribute_not_exists(#attempt) AND :attempt = :zero))',
        ExpressionAttributeNames: { '#s': 'status', '#cursor': 'cursor', '#attempt': 'attempt' },
        ExpressionAttributeValues: { ':next': expected + 1, ':expected': expected, ':failed': failed ? 1 : 0, ':running': 'running', ':attempt': attempt, ':zero': 0 } }));
      return true;
    } catch (error) { if (conditional(error)) return false; throw error; }
  }
  async complete(id: string, key: string, timestamp: string, attempt = 0) {
    await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id },
      UpdateExpression: 'SET #s = :completed, resultsKey = :key, finishedAt = :now',
      ConditionExpression: '#s = :running AND #cursor = #total AND (#attempt = :attempt OR (attribute_not_exists(#attempt) AND :attempt = :zero))',
      ExpressionAttributeNames: { '#s': 'status', '#cursor': 'cursor', '#total': 'total', '#attempt': 'attempt' },
      ExpressionAttributeValues: { ':completed': 'completed', ':running': 'running', ':key': key, ':now': timestamp, ':attempt': attempt, ':zero': 0 } }));
  }
  async retry(id: string, mode: 'resume' | 'fresh' = 'resume'): Promise<boolean> {
    const fresh = mode === 'fresh';
    const reasons = fresh ? '(#error = :exhausted OR #error = :unavailable OR #error = :allfailed)'
      : '(#error = :exhausted OR #error = :unavailable)';
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id },
        UpdateExpression: 'SET #s = :queued, #error = :null, finishedAt = :null, startedAt = :null, ' +
          '#attempt = if_not_exists(#attempt, :zero) + :one' +
          (fresh ? ', #generation = if_not_exists(#generation, :zero) + :one, #cursor = :zero, failureCount = :zero, resultsKey = :null' : ''),
        ConditionExpression: '#s = :failed AND ' + reasons + ' AND #cursor <= #total',
        ExpressionAttributeNames: { '#s': 'status', '#error': 'error', '#cursor': 'cursor', '#total': 'total',
          '#attempt': 'attempt', ...(fresh ? { '#generation': 'generation' } : {}) },
        ExpressionAttributeValues: { ':queued': 'queued', ':failed': 'failed', ':exhausted': 'retries_exhausted',
          ':unavailable': 'queue_unavailable', ...(fresh ? { ':allfailed': 'all_records_failed' } : {}),
          ':null': null, ':zero': 0, ':one': 1 } }));
      return true;
    } catch (error) { if (conditional(error)) return false; throw error; }
  }
  async fail(id: string, code: string, timestamp: string, attempt = 0) {
    if (!/^[a-z_]{1,60}$/.test(code)) throw new Error('Only safe failure codes may be stored');
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id },
        UpdateExpression: 'SET #s = :failed, #error = :code, finishedAt = :now',
        ConditionExpression: 'attribute_exists(id) AND (#s = :queued OR #s = :running) AND (#attempt = :attempt OR (attribute_not_exists(#attempt) AND :attempt = :zero))',
        ExpressionAttributeNames: { '#s': 'status', '#error': 'error', '#attempt': 'attempt' },
        ExpressionAttributeValues: { ':failed': 'failed', ':queued': 'queued', ':running': 'running', ':code': code, ':now': timestamp, ':attempt': attempt, ':zero': 0 } }));
    } catch (error) { if (!conditional(error)) throw error; }
  }
}
export class SqsJobQueue implements JobQueue {
  constructor(private readonly queueUrl: string) {}
  async send(id: string, cursor: number, attempt = 0) {
    const body = textBytes({
      QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ jobId: id, attempt }),
      MessageGroupId: id, MessageDeduplicationId: id + '-' + attempt + '-' + cursor,
    });
    const response = await signedAwsRequest('sqs', MODEL_REGION, 'POST', 'https://sqs.' + MODEL_REGION + '.amazonaws.com/', body,
      { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'AmazonSQS.SendMessage' });
    // A successful HTTP status without a SendMessage acknowledgement is not delivery.
    const acknowledgement = await response.json() as { MessageId?: unknown };
    if (typeof acknowledgement.MessageId !== 'string' || !acknowledgement.MessageId) {
      throw new Error('SQS did not acknowledge message delivery');
    }
  }
}
export class S3Results implements ResultObjects {
  constructor(private readonly bucket: string) {}
  private key(id: string, index: number) { return 'analyses/' + id + '/records/' + index + '.json'; }
  private async read(key: string): Promise<unknown | null> {
    const res = await signedAwsRequest('s3', MODEL_REGION, 'GET', objectUrl(this.bucket, MODEL_REGION, key));
    if (res.status === 404) return null;
    return res.json();
  }
  private async put(key: string, value: unknown): Promise<void> {
    const response = await signedAwsRequest('s3', MODEL_REGION, 'PUT', objectUrl(this.bucket, MODEL_REGION, key),
      textBytes(value), { 'content-type': 'application/json', 'if-none-match': '*' });
    if (response.status !== 412 && !response.ok) throw new Error('Private result persistence failed');
  }
  async readRecord(id: string, index: number): Promise<RecordOutcome | null> {
    return await this.read(this.key(id, index)) as RecordOutcome | null;
  }
  async writeRecord(id: string, index: number, value: RecordOutcome) { await this.put(this.key(id, index), value); }
  async writeReport(id: string, report: Report) {
    const key = 'analyses/' + id + '/report.json';
    await this.put(key, report);
    return key;
  }
  async readReport(key: string): Promise<Report> {
    const payload = await this.read(key);
    if (!payload) throw new Error('Completed report missing');
    return payload as Report;
  }
}
export class QwenBedrock implements Inference {
  async analyze(record: GrievanceRecord, context?: { jobId: string; attempt: number; generation: number; recordIndex: number }) {
    const payload = textBytes({
      system: [{ text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: recordPrompt(record) }] }],
      inferenceConfig: { maxTokens: 1800, temperature: 0 },
    });
    const path = 'https://bedrock-runtime.' + MODEL_REGION + '.amazonaws.com/model/' + encodeURIComponent(MODEL_ID) + '/converse';
    const response = await signedAwsRequest('bedrock', MODEL_REGION, 'POST', path, payload, { 'content-type': 'application/json' });
    const parsed = await response.json() as {
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      stopReason?: string;
      output?: { message?: { content?: { text?: string }[] } };
    };
    if (parsed.usage) {
      console.info(JSON.stringify({
        event: 'analysis_bedrock_usage', model: MODEL_ID,
        jobId: context?.jobId ?? 'unknown', attempt: context?.attempt ?? 0,
        generation: context?.generation ?? 0, recordIndex: context?.recordIndex ?? -1,
        inputTokens: parsed.usage.inputTokens ?? 0,
        outputTokens: parsed.usage.outputTokens ?? 0, totalTokens: parsed.usage.totalTokens ?? 0,
      }));
    }
    if (parsed.stopReason !== 'end_turn') {
      throw new InvalidModelOutput('Model did not finish structured response');
    }
    const text = parsed.output?.message?.content?.map(c => c.text ?? '').join('') ?? '';
    return parseConverseOutput(text, record);
  }
}
export function awsAnalysisDependencies() {
  const sessions = process.env.SESSIONS_TABLE_NAME, datasetTable = process.env.DATASETS_TABLE_NAME;
  const jobsTable = process.env.ANALYSES_TABLE_NAME, rawBucket = process.env.DATASETS_BUCKET_NAME;
  const resultsBucket = process.env.ANALYSES_BUCKET_NAME, queueUrl = process.env.ANALYSES_QUEUE_URL;
  const origin = process.env.ALLOWED_ORIGIN;
  if (!sessions || !datasetTable || !jobsTable || !rawBucket || !resultsBucket || !queueUrl || !origin) {
    throw new Error('Analysis runtime configuration incomplete');
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return {
    datasets: new DynamoDatasets(client, datasetTable, sessions),
    files: new SignedS3(rawBucket, MODEL_REGION),
    jobs: new DynamoJobs(client, jobsTable),
    queue: new SqsJobQueue(queueUrl),
    results: new S3Results(resultsBucket),
    model: new QwenBedrock(),
    origin,
  };
}
