import type { GrievanceRecord } from '../domain/grievance';
import { answerQuestion } from './recordAssistant';

/** What the assistant may look at. The server (not the browser) resolves this against the real data. */
export type ChatScope = { kind: 'all' } | { kind: 'records'; recordIds: string[] };

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Citation = { caseId: string; quote?: string };

export type ChatRequest = {
  /** Whole conversation so far, ending with the new user message. */
  messages: ChatMessage[];
  scope: ChatScope;
  signal?: AbortSignal;
  /** Called for each streamed chunk of the answer. */
  onDelta?: (text: string) => void;
};
export type ChatResult = { answer: string; citations: Citation[] };

/**
 * The assistant integration boundary. `kind: 'ai'` = model-backed answers from the server;
 * `kind: 'lookup'` = deterministic record lookup used only in offline demo mode.
 */
export interface ChatService {
  readonly kind: 'ai' | 'lookup';
  readonly label: string;
  ask(req: ChatRequest): Promise<ChatResult>;
}

/** Demo-mode assistant: grounded lookup over the loaded records. Never presented as AI. */
export class LookupChatService implements ChatService {
  readonly kind = 'lookup' as const;
  readonly label = 'Record lookup (not AI)';
  private readonly getRecords: () => GrievanceRecord[];
  constructor(getRecords: () => GrievanceRecord[]) {
    this.getRecords = getRecords;
  }

  async ask(req: ChatRequest): Promise<ChatResult> {
    req.signal?.throwIfAborted();
    const all = this.getRecords();
    const ids = req.scope.kind === 'records' ? new Set(req.scope.recordIds) : null;
    const records = ids ? all.filter((r) => ids.has(r.id)) : all;
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const result = answerQuestion(records, last?.content ?? '');
    req.onDelta?.(result.answer);
    return { answer: result.answer, citations: result.sources.map((s) => ({ caseId: s.id })) };
  }
}
