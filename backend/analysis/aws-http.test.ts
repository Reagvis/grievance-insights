import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { QwenBedrock, S3Results, SqsJobQueue } from './aws';
import { AwsServiceError, canonicalAwsPath, signedAwsRequest } from './aws-http';
import { inferWithRetry } from './core';

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const id = '12345678-abcd-4f12-9abc-123456789abc';
const record = { id: 'GR-1', complaintText: 'మా ఊరిలో నీరు లేదు', responseText: null } as GrievanceRecord;

beforeEach(() => {
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-only');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-only');
  vi.stubEnv('AWS_SESSION_TOKEN', 'test-temporary-token-only');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('AWS service-specific HTTP failures (all requests mocked)', () => {
  it('uses Bedrock SigV4 double encoding while preserving S3 object paths', () => {
    expect(canonicalAwsPath('/model/qwen.qwen3-32b-v1%3A0/converse', 'bedrock'))
      .toBe('/model/qwen.qwen3-32b-v1%253A0/converse');
    expect(canonicalAwsPath('/raw/example%20file.json', 's3')).toBe('/raw/example%20file.json');
  });
  it.each([
    [404, 'AWS.SimpleQueueService.NonExistentQueue'],
    [403, 'AccessDeniedException'],
    [429, 'ThrottlingException'],
    [503, 'ServiceUnavailableException'],
  ])('SQS SendMessage HTTP %i must reject rather than report delivery', async (status, errorName) => {
    const fetcher = vi.fn().mockResolvedValue(json(status, { __type: 'com.amazonaws.sqs#' + errorName }));
    vi.stubGlobal('fetch', fetcher);
    await expect(new SqsJobQueue('https://sqs.ap-south-1.amazonaws.com/123456789012/test.fifo').send(id, 0))
      .rejects.toMatchObject({ status, name: errorName });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe('POST');
  });
  it('rejects 2xx SQS response without a SendMessage acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, {})));
    await expect(new SqsJobQueue('https://sqs.ap-south-1.amazonaws.com/123456789012/test.fifo').send(id, 0))
      .rejects.toThrow('SQS did not acknowledge');
  });
  it('accepts a verified 2xx SendMessage acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { MessageId: 'server-supplied-message-id' })));
    await expect(new SqsJobQueue('https://sqs.ap-south-1.amazonaws.com/123456789012/test.fifo').send(id, 0))
      .resolves.toBeUndefined();
  });
  it('rejects Bedrock model-not-found (404) as a service error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { __type: 'ResourceNotFoundException' })));
    await expect(new QwenBedrock().analyze(record))
      .rejects.toMatchObject({ status: 404, name: 'ResourceNotFoundException' });
  });
  it('retries Bedrock throttling through the existing inference retry boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(429, { __type: 'com.amazonaws.bedrock#ThrottlingException' }));
    vi.stubGlobal('fetch', fetcher);
    const sleep = vi.fn(async () => {});
    await expect(inferWithRetry(new QwenBedrock(), record, sleep))
      .rejects.toMatchObject({ status: 429, name: 'ThrottlingException' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it('logs private, job-attributable token counts without complaint text', async () => {
    const usage = { inputTokens: 120, outputTokens: 35, totalTokens: 155 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { stopReason: 'max_tokens', usage })));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(new QwenBedrock().analyze(record, {
      jobId: id, attempt: 3, generation: 2, recordIndex: 42,
    })).rejects.toThrow();
    const line = String(info.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'analysis_bedrock_usage', jobId: id, attempt: 3, generation: 2, recordIndex: 42,
      inputTokens: 120, outputTokens: 35, totalTokens: 155,
    });
    expect(line).not.toContain(record.complaintText);
    expect(line).not.toContain('test-secret-only');
  });
  it('rejects Bedrock 404 even with an empty or non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    await expect(new QwenBedrock().analyze(record))
      .rejects.toMatchObject({ status: 404, name: 'ResourceNotFoundException' });
  });
  it('S3 missing GET is a permissible absent checkpoint, not a success payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { Code: 'NoSuchKey' })));
    expect(await new S3Results('test-results').readRecord(id, 0)).toBeNull();
  });
  it('S3 conditional PUT conflict is handled idempotently, without object overwrites', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 412 }));
    vi.stubGlobal('fetch', fetcher);
    const result = { id: 'GR-1', failure: 'invalid_model_output' };
    await expect(new S3Results('test-results').writeRecord(id, 0, result)).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0][1].headers['if-none-match']).toBe('*');
  });
  it('does not tolerate S3 404 PUT or 412 GET (only the intended operations)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { Code: 'NoSuchBucket' })));
    await expect(new S3Results('test-results').writeRecord(id, 0, { id: 'GR-1', failure: 'invalid_model_output' }))
      .rejects.toBeInstanceOf(AwsServiceError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(412, { Code: 'PreconditionFailed' })));
    await expect(signedAwsRequest('s3', 'ap-south-1', 'GET', 'https://test-results.s3.ap-south-1.amazonaws.com/test'))
      .rejects.toMatchObject({ status: 412 });
  });
});
