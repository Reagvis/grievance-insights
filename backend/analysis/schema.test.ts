import { describe, it, expect } from 'vitest';
import type { GrievanceRecord } from '../../src/domain/grievance';
import { aggregate, CATEGORIES, InvalidModelOutput, parseConverseOutput, recordPrompt, validateModelOutput } from './schema';

const complaint = 'మా గ్రామంలో తాగునీటి సరఫరా లేదు.';
const response = 'పై సమస్యను పరిశీలిస్తున్నాము.';
function record(responseText: string | null = response): GrievanceRecord {
  return { id: 'GR-1', complaintText: complaint, responseText, language: 'te', category: null,
    issueType: null, department: null, district: null, submittedAt: null, respondedAt: null,
    status: 'unknown', sourceType: 'csv', isSyntheticDemo: true };
}
function output(responseText: string | null = response) {
  return {
    id: 'GR-1', complaintSummary: 'గ్రామంలో నీరు రావడం లేదు.', category: 'water',
    issueClassification: 'తాగునీటి సరఫరా', requestedAction: 'నీరు సరఫరా చేయాలి.',
    potentiallyUrgent: false, urgencyReason: null, complaintEvidence: 'తాగునీటి సరఫరా లేదు',
    responseSummary: responseText ? 'అధికారులు పరిశీలిస్తున్నామని తెలిపారు.' : null,
    departmentClaim: responseText ? 'పరిశీలిస్తున్నామని తెలిపారు.' : null,
    responseRelevance: responseText ? 'inconclusive' : 'not_applicable',
    responseAssessment: responseText ? 'సమాధానం అంశాన్ని ప్రస్తావించింది, కానీ చర్య పూర్తి అయినట్లు ఆధారం లేదు.' : null,
    responseEvidence: responseText ? 'పరిశీలిస్తున్నాము' : null,
    verifiedOutcome: null, verificationStatus: 'not_verified',
  };
}
describe('grounded Telugu Bedrock model parsing', () => {
  it('extracts a structured Telugu grievance and separate department assessment', () => {
    const result = parseConverseOutput('```json\n' + JSON.stringify(output()) + '\n```', record());
    expect(result.complaintEvidence).toBe('తాగునీటి సరఫరా లేదు');
    expect(result.responseEvidence).toBe('పరిశీలిస్తున్నాము');
    expect(result.verificationStatus).toBe('not_verified');
    expect(result.verifiedOutcome).toBeNull();
    expect(result.responseRelevance).toBe('inconclusive');
    expect(recordPrompt(record())).toContain(complaint);
  });
  it('rejects evidence that is hallucinated or taken from the wrong source', () => {
    expect(() => validateModelOutput({ ...output(), complaintEvidence: 'తాగునీరు ఇప్పటికే అందించారు' }, record())).toThrow(InvalidModelOutput);
    expect(() => validateModelOutput({ ...output(), responseEvidence: complaint }, record())).toThrow(InvalidModelOutput);
    expect(() => validateModelOutput({ ...output(), verifiedOutcome: true }, record())).toThrow(InvalidModelOutput);
  });
  it('accepts a quote that differs from the source only by line breaks and hidden joiners, and stores the source text', () => {
    const wrapped: GrievanceRecord = { ...record(), complaintText: 'మా గ్రామంలో రేషన్\u200c దుకాణంలో స్టాక్\u200c\nలేదని చెబుతున్నారు.', responseText: 'తనిఖీ చేశాము. వచ్చే వారంలో పంపిణీ\nచేస్తాము.' };
    const result = validateModelOutput({ ...output(), complaintEvidence: 'దుకాణంలో స్టాక్ లేదని చెబుతున్నారు', responseEvidence: 'పంపిణీ చేస్తాము' }, wrapped);
    expect(wrapped.complaintText).toContain(result.complaintEvidence);
    expect(result.complaintEvidence).toBe('దుకాణంలో స్టాక్\u200c\nలేదని చెబుతున్నారు');
    expect(result.responseEvidence).toBe('పంపిణీ\nచేస్తాము');
    expect(() => validateModelOutput({ ...output(), complaintEvidence: 'దుకాణంలో స్టాక్ ఉందని చెబుతున్నారు' }, wrapped)).toThrow(InvalidModelOutput);
  });
  it('rejects unsupported categories, missing fields and malformed JSON', () => {
    expect(() => validateModelOutput({ ...output(), category: 'unapproved' }, record())).toThrow();
    expect(() => validateModelOutput({ ...output(), complaintSummary: null }, record())).toThrow();
    expect(() => parseConverseOutput('some random text', record())).toThrow(InvalidModelOutput);
    expect(CATEGORIES).toContain('healthcare');
  });
  it('does not invent a department reply when none exists', () => {
    const absent = record(null);
    const valid = validateModelOutput(output(null), absent);
    expect(valid.responseSummary).toBeNull();
    expect(valid.responseRelevance).toBe('not_applicable');
    expect(() => validateModelOutput(output(), absent)).toThrow(InvalidModelOutput);
    expect(() => validateModelOutput({ ...output(null), responseAssessment: 'పరిశీలించారు' }, absent)).toThrow();
  });
  it('computes categories and statistics from validated outcomes, not from the model', () => {
    const first = record(), second = { ...record(null), id: 'GR-2' };
    const analyses = [
      { id: first.id, analysis: validateModelOutput(output(), first) },
      { id: second.id, failure: 'invalid_model_output' },
    ];
    const report = aggregate('job', 'dataset', [first, second], analyses, '2026-11-12T00:00:00Z');
    expect(report.stats).toMatchObject({ grievances: 2, analyzed: 1, failed: 1,
      withResponses: 1, responsesInconclusive: 1, potentiallyUrgent: 0 });
    expect(report.stats.categoryCounts.water).toBe(1);
    expect(report.categories[0].sourceIds).toEqual(['GR-1']);
    expect(() => aggregate('job','dataset', [first, second], [analyses[0]], '')).toThrow();
  });
});