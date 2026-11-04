import { describe, expect, it } from 'vitest';
import { createSampleDataset } from '../data/demoGrievances';
import { BrowserSummaryService } from '../services/runtimeServices';
import { answerQuestion } from '../services/recordAssistant';

const dataset = createSampleDataset();
const options = { scope: 'all' as const, scopeDescription: 'no filters', reportLanguage: 'en' as const, datasetName: dataset.name, isSyntheticData: true };

describe('GitHub Pages browser processing', () => {
  it('generates the same grounded report without an HTTP server', async () => {
    const summary = await new BrowserSummaryService().generate(dataset.records, options);
    expect(summary.processingMode).toBe('browser-local');
    expect(summary.totalRecords).toBe(30);
    expect(summary.includedRecordIds).toEqual(dataset.records.map((record) => record.id));
  });
  it('keeps imported records scoped to the supplied collection', () => {
    const record = { ...dataset.records[0], id: 'IMPORTED-1', isSyntheticDemo: false };
    expect(answerQuestion([record], 'IMPORTED-1').sources.map((source) => source.id)).toEqual(['IMPORTED-1']);
    expect(answerQuestion([record], 'GRV-000111').totalMatches).toBe(0);
  });
  it('supports Telugu search and does not invent matches for unrelated topics', () => {
    const term = 'మందులు';
    expect(answerQuestion(dataset.records, term).totalMatches).toBeGreaterThan(0);
    expect(answerQuestion(dataset.records, 'spaceship complaints').totalMatches).toBe(0);
  });
});
