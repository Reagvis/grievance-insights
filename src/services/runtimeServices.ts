import type { GrievanceRecord } from '../domain/grievance';
import type { ConsolidatedSummary, SummaryOptions, SummaryService } from '../domain/summary';
import { LocalApiSummaryService, postApi, type AssistantAnswer } from './localApiService';
import { LocalDemoSummaryService } from './localDemoSummaryService';
import { answerQuestion } from './recordAssistant';

export const AWS_AUTH_ENABLED = import.meta.env.MODE === 'aws';
export const IS_STATIC_BUILD = import.meta.env.MODE === 'pages' || AWS_AUTH_ENABLED;
export const PROCESSOR_LABEL = IS_STATIC_BUILD ? 'Browser processing' : 'Local API';
export const DATA_PRIVACY_HINT = IS_STATIC_BUILD
  ? 'Records stay in this browser and are not uploaded or saved.'
  : 'Records are processed by the local API in memory and are not saved.';

export class BrowserSummaryService implements SummaryService {
  readonly mode = 'browser-local' as const;
  readonly supportedLanguages = ['en'] as const;
  async generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary> {
    const summary = await new LocalDemoSummaryService().generate(records, options);
    return { ...summary, processingMode: this.mode };
  }
}

export const defaultSummaryService = IS_STATIC_BUILD ? new BrowserSummaryService() : new LocalApiSummaryService();

export async function askAssistant(records: GrievanceRecord[], question: string, signal?: AbortSignal): Promise<AssistantAnswer> {
  signal?.throwIfAborted();
  if (IS_STATIC_BUILD) return { ...answerQuestion(records, question), mode: 'browser-local' };
  return postApi('/api/assistant', { records, question }, signal);
}
