import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { aggregate, validateModelOutput, type RecordOutcome } from '../analysis/schema';
import { analysisForRecord, buildInsights, matchInsightRecords } from '../../src/domain/insights';
import type { AnalysisJob, AnalysisReport } from '../../src/services/analysisApi';
import { ingestDocument } from './index';

/**
 * Records extracted from each new format must drive the existing dashboard unchanged: counts, drill-down to the source
 * records, evidence that is an exact substring of the extracted text, and an export that never claims a verified outcome.
 */
const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (n: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + n, import.meta.url)));
const TE = 'మా గ్రామంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.';
const RESP = 'సంబంధిత విభాగానికి సమస్యను పంపించాము.';
const docx = (() => {
  const p = (t: string) => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + p('Case ID: DX-1') + p('Complaint:') + p(TE) + p('Response:') + p(RESP) + '</w:body></w:document>'),
  });
})();

const inputs: Array<[string, Uint8Array]> = [
  ['a.txt', enc('Case ID: TX-1\nComplaint:\n' + TE + '\nResponse:\n' + RESP)],
  ['a.md', enc('**Case ID:** MD-1\n\n## Complaint\n\n' + TE + '\n\n## Response\n\n' + RESP)],
  ['a.docx', docx],
  ['a.csv', enc('id,complaintText,responseText,status\nCS-1,' + TE + ',' + RESP + ',pending\nCS-2,' + TE + ',,unknown\n')],
  ['a.json', enc(JSON.stringify([{ id: 'JS-1', complaintText: TE, responseText: RESP }]))],
  ['a.jsonl', enc('{"id":"JL-1","complaintText":"' + TE + '"}\n')],
  ['TE-PDF-001.pdf', pdf('searchable-telugu-2page.pdf')],
];

describe('dashboard, drill-down and export over records from every new format', () => {
  for (const [name, bytes] of inputs) {
    it(name, async () => {
      const result = await ingestDocument({ name, bytes });
      if (result.kind !== 'complete') throw new Error('expected a complete extraction');
      const records = result.canonical.records;

      // Mock model: evidence is an exact quote of the extracted text (a paraphrase would be rejected by validateModelOutput).
      const outcomes: RecordOutcome[] = records.map((r) => ({
        id: r.id,
        analysis: validateModelOutput({
          id: r.id, complaintSummary: 'నీటి సరఫరా లేదు.', category: 'water', issueClassification: null, requestedAction: null, potentiallyUrgent: false, urgencyReason: null,
          complaintEvidence: r.complaintText.slice(0, 12), responseSummary: r.responseText ? 'పరిశీలనలో ఉంది.' : null, departmentClaim: null,
          responseRelevance: r.responseText ? 'inconclusive' : 'not_applicable', responseAssessment: r.responseText ? 'ఆధారాలు సరిపోవడం లేదు.' : null,
          responseEvidence: r.responseText ? r.responseText.slice(0, 10) : null, verifiedOutcome: null, verificationStatus: 'not_verified',
        }, r),
      }));
      const report = aggregate('job-1', 'ds-1', records, outcomes, '2026-11-12T00:00:00Z') as unknown as AnalysisReport;
      const job: AnalysisJob = { id: 'job-1', datasetId: 'ds-1', status: 'completed', createdAt: '', startedAt: '', finishedAt: '', processed: records.length, total: records.length, attempt: 0, failureCount: 0, modelId: report.modelId, region: report.region, promptVersion: report.promptVersion, error: null };

      // Dashboard metrics reflect the extracted records.
      const metrics = buildInsights(records, report, job);
      expect(metrics.total).toBe(records.length);

      // Drill-down: the AI category selection returns exactly the source records, and each links back to its analysis.
      const water = matchInsightRecords(records, report, { kind: 'ai-category', value: 'water' });
      expect(water.map((r) => r.id).sort()).toEqual(records.map((r) => r.id).sort());
      for (const r of records) {
        const item = analysisForRecord(report, r);
        expect(item).not.toBeNull();
        expect(r.complaintText).toContain(item!.complaintEvidence); // evidence navigates to, and is inside, the source text
        if (item!.responseEvidence) expect(r.responseText).toContain(item!.responseEvidence);
      }

      // Export ("Export validated AI JSON") is the report serialised as-is: it round-trips and claims nothing verified.
      const exported = JSON.parse(JSON.stringify(report, null, 2)) as AnalysisReport;
      expect(exported).toEqual(report);
      for (const o of exported.outcomes) if (o.analysis) {
        expect(o.analysis.verifiedOutcome).toBeNull();
        expect(o.analysis.verificationStatus).toBe('not_verified');
      }
      expect(exported.outcomes.map((o) => o.id)).toEqual(records.map((r) => r.id));
    });
  }
});
