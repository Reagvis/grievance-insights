import type { CaseStatus, GrievanceRecord } from './grievance';

export type SummaryScope = 'all' | 'filtered';
export type ProcessingMode = 'demo-local' | 'browser-local' | 'server-local' | 'server-ai';
export type ReportLanguage = 'en' | 'te';

export type CategoryMetric = {
  category: string;
  count: number;
  /** Share of the included records, rounded to one decimal place. */
  percentage: number;
  withResponse: number;
  resolved: number;
  /** Most frequent structured issue types inside the category (if recorded). */
  topIssueTypes: Array<{ issueType: string; count: number }>;
  exampleCaseIds: string[];
};

export type ReportedAction = {
  /** `fact` = deterministic count statement; `excerpt` = verbatim response text. */
  kind: 'fact' | 'excerpt';
  text: string;
  caseIds: string[];
  /** For excerpts: the category of the source record. */
  category?: string;
};

export type ConsolidatedSummary = {
  title: string;
  datasetName: string;
  scope: SummaryScope;
  /** Human-readable description of the filters when scope is `filtered`. */
  scopeDescription: string;
  includedRecordIds: string[];
  generatedAt: string;
  processingMode: ProcessingMode;
  reportLanguage: ReportLanguage;
  isSyntheticData: boolean;
  totalRecords: number;
  withResponseCount: number;
  resolvedCount: number;
  pendingCount: number;
  inProgressCount: number;
  unknownStatusCount: number;
  missingResponseCount: number;
  missingDateCount: number;
  uncategorizedCount: number;
  dateSpan: { from: string; to: string } | null;
  categories: CategoryMetric[];
  executiveOverview: string;
  themes: Array<{ title: string; detail: string; caseIds: string[] }>;
  reportedActions: ReportedAction[];
  priorityObservations: string[];
  limitations: string[];
};

export type SummaryOptions = {
  scope: SummaryScope;
  scopeDescription: string;
  reportLanguage: ReportLanguage;
  datasetName: string;
  isSyntheticData: boolean;
  /** Dataset-level caveats from the data adapter, carried into the limitations section. */
  datasetNotes?: string[];
};

/**
 * The integration boundary. The UI depends only on this interface, so a server-side
 * LLM implementation can replace the local demo processor without UI changes.
 */
export interface SummaryService {
  readonly mode: ProcessingMode;
  readonly supportedLanguages: readonly ReportLanguage[];
  generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary>;
}

export const STATUS_ORDER: readonly CaseStatus[] = ['resolved', 'in_progress', 'pending', 'unknown'];
