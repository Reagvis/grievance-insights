import type { ChatRequest, ChatResult, ChatService } from './chat';
import { signalAuthExpired } from './authApi';

/**
 * Signed-in, document-scoped Qwen chat. The browser sends only operator messages
 * and an authorized file/record selector; the server reads trusted source text
 * from its private S3 index and enforces ownership.
 */
export class DocumentChatService implements ChatService {
  readonly kind = 'ai' as const;
  readonly label = 'Qwen AI · document questions & drafts';
  private readonly resolveId: (datasetId: string, originalId: string) => string | undefined;
  constructor(resolveId: (datasetId: string, originalId: string) => string | undefined) {
    this.resolveId = resolveId;
  }

  async ask(req: ChatRequest): Promise<ChatResult> {
    if (req.scope.kind !== 'document') throw new Error('Open a document or complaint to ask Qwen.');
    const scope = req.scope;
    const response = await fetch('/api/datasets/' + encodeURIComponent(scope.datasetId) + '/chat', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: req.messages,
        ...(scope.recordId ? { recordId: scope.recordId } : {}),
        ...(scope.recordIndex !== undefined ? { recordIndex: scope.recordIndex } : {}),
      }),
      signal: req.signal,
    });
    if (response.status === 401) {
      signalAuthExpired();
      throw new Error('Your administrator session expired. Please sign in again.');
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: unknown };
      throw new Error(typeof error.error === 'string' ? error.error : 'The AI could not answer. Please retry.');
    }
    const body = await response.json() as { answer?: unknown; citations?: unknown };
    if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 20_000 ||
        !Array.isArray(body.citations) || body.citations.length > 40) {
      throw new Error('The AI service returned an invalid answer.');
    }
    const citations = body.citations.flatMap(value => {
      if (!value || typeof value !== 'object' || !('caseId' in value) || typeof value.caseId !== 'string') return [];
      const merged = this.resolveId(scope.datasetId, value.caseId);
      return merged ? [{ caseId: merged }] : [];
    });
    // Converse is a one-shot response; onDelta provides the same UI contract as
    // the streaming live backend without falsely claiming token-level streaming.
    req.onDelta?.(body.answer);
    return { answer: body.answer, citations };
  }
}
