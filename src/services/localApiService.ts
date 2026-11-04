import type { GrievanceRecord } from '../domain/grievance';
import type { ConsolidatedSummary, SummaryOptions, SummaryService } from '../domain/summary';

export async function postApi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The local API is unavailable. Start the app with npm run dev.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `API request failed (${response.status}).`);
  return data as T;
}

export class LocalApiSummaryService implements SummaryService {
  readonly mode = 'server-local' as const;
  readonly supportedLanguages = ['en'] as const;
  generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary> {
    return postApi('/api/summary', { records, options });
  }
}

export type AssistantAnswer = {
  answer: string;
  mode: 'server-local' | 'browser-local';
  totalMatches: number;
  sources: Array<Pick<GrievanceRecord, 'id' | 'complaintText' | 'responseText'>>;
};
