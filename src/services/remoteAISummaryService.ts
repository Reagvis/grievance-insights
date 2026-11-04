/**
 * RemoteAISummaryService — INTEGRATION CONTRACT ONLY (not connected).
 *
 * This file documents how a production, server-side AI summarizer plugs in. It has no
 * endpoint, no credentials and no simulated responses. Calling `generate` throws.
 *
 * Intended backend pipeline (to be built server-side, not in this prototype):
 *   Ingest → Telugu text extraction / OCR where needed → normalisation →
 *   batch structured extraction per record (issue, requested action, response action,
 *   explicit outcome) → aggregate counts and themes → one-page report →
 *   link every conclusion to source case IDs → human review / evaluation.
 *
 * Contract:
 *   POST <configured endpoint>
 *   Request:  RemoteSummaryRequest (record IDs + texts are sent server-side only after
 *             privacy review; never to third-party analytics)
 *   Response: ConsolidatedSummary with processingMode = 'server-ai'. Every theme and
 *             action must carry the caseIds it was derived from so the UI can link them.
 *
 * To connect: implement `generate` with an authenticated fetch to the approved
 * endpoint, validate the response shape, then pass an instance to <App summaryService>.
 * No UI changes are required — the UI depends only on the SummaryService interface.
 */
import type { GrievanceRecord } from '../domain/grievance';
import type { ConsolidatedSummary, ReportLanguage, SummaryOptions, SummaryService } from '../domain/summary';

export type RemoteSummaryRequest = {
  datasetName: string;
  scope: SummaryOptions['scope'];
  reportLanguage: ReportLanguage;
  records: Array<Pick<GrievanceRecord, 'id' | 'complaintText' | 'responseText' | 'category' | 'department' | 'district' | 'submittedAt' | 'respondedAt' | 'status'>>;
};

export class RemoteAISummaryService implements SummaryService {
  readonly mode = 'server-ai' as const;
  readonly supportedLanguages: readonly ReportLanguage[] = ['en', 'te'];

  async generate(_records: GrievanceRecord[], _options: SummaryOptions): Promise<ConsolidatedSummary> {
    void _records;
    void _options;
    throw new Error('Remote AI summarization is not connected in this prototype.');
  }
}
