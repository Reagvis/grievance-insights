import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { validateDataset, type DatasetStore, type Metadata, type PrivateObjects } from '../datasets/core';
import { createAnalysisApi, type Job, type JobQueue, type JobStore, type ResultObjects } from './core';
import { aggregate, recordPrompt, validateModelOutput, type RecordOutcome, type Report } from './schema';

const jobId = '82345678-abcd-4f12-9abc-123456789abc';
const when = '2026-11-12T00:00:00.000Z';
const origin = 'https://telangana-gov-pilot.reagvis.com';
const credential = 'X'.repeat(43);
const hash = createHash('sha256').update(credential).digest('hex');

function testEvent(cursor: number): APIGatewayProxyEventV2 {
  return {
    headers: { origin }, cookies: ['__Host-grievance_session=' + credential],
    requestContext: { http: { method: 'GET', path: '/api/analyses/' + jobId + '/results' } },
    queryStringParameters: { cursor: String(cursor) }, isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function resultApi(report: Report, readReport: ResultObjects['readReport']) {
  const dataset: Metadata = {
    id: jobId, name: 'long-ids.csv', key: 'raw/' + jobId + '/source.csv',
    format: 'csv', status: 'ready', createdAt: when, bytes: 0, recordCount: report.stats.grievances,
    ownerId: 'admin', uploadExpiresAt: 0,
  };
  const job: Job = {
    id: jobId, datasetId: jobId, ownerId: 'admin', status: 'completed',
    createdAt: when, startedAt: when, finishedAt: when, expiresAt: 1900000000,
    total: report.stats.grievances, cursor: report.stats.grievances, failureCount: report.stats.failed,
    attempt: 0, generation: 0, error: null, resultsKey: 'analyses/' + jobId + '/report.json',
    modelId: 'qwen.qwen3-32b-v1:0', region: 'ap-south-1', promptVersion: 'te-grievance-response-v1',
  };
  const datasets = {
    session: vi.fn(async (value: string) => value === hash ? { userId: 'admin', expiresAt: 1900000000 } : undefined),
    get: vi.fn(async () => dataset),
  } as unknown as DatasetStore;
  const jobs = { get: vi.fn(async () => job) } as unknown as JobStore;
  const results = { readReport } as ResultObjects;
  const files = {} as PrivateObjects;
  const queue = {} as JobQueue;
  return createAnalysisApi(datasets, files, jobs, queue, results, origin, () => new Date(when));
}

describe('2 MiB whole-report paging regression with accepted long source IDs', () => {
  it('returns every full category source ID and every nontrivial outcome, with byte-bounded pages', async () => {
    const longId = (i: number) => 'GR-' + String(i).padStart(4, '0') + '-' + 'A'.repeat(1490);
    const rows = Array.from({ length: 2000 }, (_, i) =>
      longId(i) + ',నీరు లేదు,పరిశీలిస్తున్నాము');
    const input = new TextEncoder().encode('id,complaintText,responseText\n' + rows.join('\n'));
    expect(input.length / 1024 ** 2).toBeGreaterThan(3);
    expect(input.length / 1024 ** 2).toBeLessThan(4);
    const started = performance.now();
    const records = validateDataset('long-ids.csv', 'csv', input);
    expect(records).toHaveLength(2000);
    expect(Buffer.byteLength(recordPrompt(records[0]), 'utf8')).toBeLessThan(12 * 1024);
    const outcomes: RecordOutcome[] = records.map((record, i) => ({
      id: record.id,
      analysis: validateModelOutput({
        id: record.id,
        category: 'water',
        complaintSummary: 'నీటి సరఫరా లేకపోవడంతో ఇబ్బందులు ఉన్నాయి. ' + 'అ'.repeat(650 + i % 3),
        issueClassification: 'తాగునీటి సమస్య ' + 'అ'.repeat(350),
        requestedAction: 'నీటి సరఫరా పునరుద్ధరించాలని అభ్యర్థన ' + 'అ'.repeat(400),
        potentiallyUrgent: false, urgencyReason: null,
        complaintEvidence: 'నీరు లేదు',
        responseSummary: 'పరిశీలన కొనసాగుతోంది ' + 'అ'.repeat(400),
        departmentClaim: 'సమస్యను పరిశీలిస్తున్నట్లు పేర్కొన్నారు. ' + 'అ'.repeat(350),
        responseRelevance: 'inconclusive',
        responseAssessment: 'నిజమైన పరిష్కారానికి స్వతంత్ర ఆధారాలు లేవు. ' + 'అ'.repeat(700),
        responseEvidence: 'పరిశీలిస్తున్నాము',
        verifiedOutcome: null, verificationStatus: 'not_verified',
      }, record),
    }));
    const report: Report = { ...aggregate(jobId, jobId, records, outcomes, when), generation: 0 };
    expect(report.categories).toHaveLength(1);
    expect(report.categories[0].sourceIds).toEqual(records.map(r => r.id));
    const sourceIdsBytes = Buffer.byteLength(JSON.stringify(report.categories[0].sourceIds));
    expect(sourceIdsBytes).toBeGreaterThan(2 * 1024 * 1024);
    const serialized = JSON.stringify(report);
    const sourceReportBytes = Buffer.byteLength(serialized);
    expect(sourceReportBytes).toBeGreaterThan(8 * 1024 * 1024);
    let reportReads = 0;
    let readBytes = 0;
    const readReport = vi.fn(async () => {
      reportReads++;
      readBytes += sourceReportBytes;
      // Deliberately simulate the current S3Results full GET and JSON parse per page.
      return JSON.parse(serialized) as Report;
    });
    const handler = resultApi(report, readReport);
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    let cursor: number | null = 0;
    const assembledIds: string[] = [];
    const assembledMembers: string[] = [];
    let pageCount = 0, largestPageBytes = 0;
    const pageStarted = performance.now();
    while (cursor !== null && pageCount < 100) {
      const response = await handler(testEvent(cursor));
      expect(response.statusCode).toBe(200);
      const byteLength = Buffer.byteLength(response.body ?? '', 'utf8');
      expect(byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
      largestPageBytes = Math.max(byteLength, largestPageBytes);
      const page = JSON.parse(response.body ?? '{}') as {
        report: Report; nextCursor: number | null;
      };
      expect(page.report.categories).toHaveLength(1);
      expect(page.report.categories[0].count).toBe(2000);
      const outcomeIds = page.report.outcomes.map(o => o.id);
      const memberIds = page.report.categories[0].sourceIds;
      expect(memberIds).toEqual(outcomeIds);
      expect(memberIds.every(id => records.findIndex(r => r.id === id) >= 0)).toBe(true);
      assembledIds.push(...outcomeIds);
      assembledMembers.push(...memberIds);
      if (page.nextCursor !== null) {
        expect(page.nextCursor).toBe(cursor + outcomeIds.length);
        expect(page.nextCursor).toBeGreaterThan(cursor);
      }
      cursor = page.nextCursor;
      pageCount++;
      if (pageCount % 3 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    expect(assembledIds).toEqual(records.map(r => r.id));
    expect(assembledMembers).toEqual(report.categories[0].sourceIds);
    expect(pageCount).toBeGreaterThanOrEqual(20);
    expect(reportReads).toBe(pageCount);
    console.info('analysis_report_page_benchmark', JSON.stringify({
      sourceCsvMiB: +(input.length / 1024 ** 2).toFixed(2),
      reportMiB: +(sourceReportBytes / 1024 ** 2).toFixed(2),
      sourceIdsMiB: +(sourceIdsBytes / 1024 ** 2).toFixed(2),
      pageCount, largestPageMiB: +(largestPageBytes / 1024 ** 2).toFixed(2),
      reportS3Reads: reportReads,
      reportReadMiB: +(readBytes / 1024 ** 2).toFixed(2),
      amplification: +(readBytes / sourceReportBytes).toFixed(1),
      rssBaselineMiB: +(baselineRss / 1024 ** 2).toFixed(1),
      rssPeakMiB: +(peakRss / 1024 ** 2).toFixed(1),
      rssDeltaMiB: +((peakRss - baselineRss) / 1024 ** 2).toFixed(1),
      buildMs: Math.round(pageStarted - started), pagingMs: Math.round(performance.now() - pageStarted),
    }));
  }, 120000);
});
