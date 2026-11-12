import { describe, expect, it, vi } from 'vitest';
import { DynamoJobs } from './aws';

describe('DynamoDB analysis job expressions', () => {
  it('aliases the reserved cursor attribute while checkpointing', async () => {
    const send = vi.fn(async (_command: { input: Record<string, unknown> }) => ({}));
    const jobs = new DynamoJobs({ send } as never, 'jobs');

    await expect(jobs.checkpoint('job-1', 0, false)).resolves.toBe(true);

    const input = send.mock.calls[0][0].input;
    expect(input.UpdateExpression).toBe('SET #cursor = :next ADD failureCount :failed');
    expect(input.ConditionExpression).toBe('#s = :running AND #cursor = :expected');
    expect(input.ExpressionAttributeNames).toMatchObject({ '#cursor': 'cursor' });
  });

  it('aliases reserved attributes in the completion condition', async () => {
    const send = vi.fn(async (_command: { input: Record<string, unknown> }) => ({}));
    const jobs = new DynamoJobs({ send } as never, 'jobs');

    await jobs.complete('job-1', 'analyses/job-1/report.json', '2026-11-12T00:00:00.000Z');

    const input = send.mock.calls[0][0].input;
    expect(input.ConditionExpression).toBe('#s = :running AND #cursor = #total');
    expect(input.ExpressionAttributeNames).toMatchObject({ '#cursor': 'cursor', '#total': 'total' });
  });
});
