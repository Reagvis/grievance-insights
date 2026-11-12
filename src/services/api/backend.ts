import type { Dataset, GrievanceRecord } from '../../domain/grievance';
import type { ConsolidatedSummary, SummaryOptions, SummaryService } from '../../domain/summary';
import type { ChatRequest, ChatResult, ChatService } from '../chat';
import { ApiError, type ApiClient } from './http';
import { mapComplaint, type ComplaintPage, type HealthInfo } from './wire';

export const PAGE_LIMIT = 500;
/** Hard stop so a misbehaving server (cursor loop) cannot hang the UI forever. */
const MAX_PAGES = 200;

export type LoadProgress = { loaded: number; total: number | null };

export type LiveLoad = { dataset: Dataset; skipped: string[] };

/** GET /health */
export async function fetchHealth(client: ApiClient, signal?: AbortSignal): Promise<HealthInfo> {
  const h = await client.json<Partial<HealthInfo>>('/health', { signal, timeoutMs: 10_000 });
  if (!h || (h.status !== 'ok' && h.status !== 'degraded') || !h.capabilities) {
    throw new ApiError(502, 'The health endpoint returned an unexpected response.');
  }
  return h as HealthInfo;
}

/**
 * GET /complaints (cursor-paged) → every record, validated.
 * The UI searches/filters/aggregates in memory, which stays instant for tens of thousands of notes.
 * If the collection grows far beyond that, move search/filter server-side (see docs/BACKEND_CONTRACT.md).
 */
export async function fetchAllComplaints(
  client: ApiClient,
  opts: { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void; datasetName?: string; now?: () => Date } = {},
): Promise<LiveLoad> {
  const records: GrievanceRecord[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: ComplaintPage = await client.json<ComplaintPage>('/complaints', {
      query: { limit: PAGE_LIMIT, cursor },
      signal: opts.signal,
      timeoutMs: 60_000,
    });
    if (!data || !Array.isArray(data.items)) throw new ApiError(502, 'The complaints endpoint returned an unexpected response.');
    if (typeof data.total === 'number') total = data.total;
    for (const raw of data.items) {
      const { record, problem } = mapComplaint(raw);
      if (!record) {
        skipped.push(problem ?? 'invalid record');
      } else if (seen.has(record.id)) {
        skipped.push(`${record.id}: duplicate id`);
      } else {
        seen.add(record.id);
        records.push(record);
      }
    }
    opts.onProgress?.({ loaded: records.length + skipped.length, total });
    cursor = data.nextCursor ?? null;
    if (!cursor) break;
    if (page === MAX_PAGES - 1) throw new ApiError(502, 'The server returned too many pages. Contact an administrator.');
  }

  const now = (opts.now ?? (() => new Date()))();
  return {
    skipped,
    dataset: {
      id: `live-${now.getTime()}`,
      name: opts.datasetName ?? 'CM Helpline complaints',
      kind: 'live',
      records,
      isSynthetic: records.length > 0 && records.every((r) => r.isSyntheticDemo),
      loadedAt: now.toISOString(),
    },
  };
}

type SummaryWire = Partial<ConsolidatedSummary> & { error?: string };

/** POST /summary. Only the scope is sent — the server owns the data, so 2,000 notes never travel in one request. */
export class HttpSummaryService implements SummaryService {
  readonly supportedLanguages = ['en'] as const;
  mode: SummaryService['mode'];
  private readonly client: ApiClient;

  constructor(client: ApiClient, kind: 'ai' | 'deterministic' = 'ai') {
    this.client = client;
    this.mode = kind === 'ai' ? 'server-ai' : 'server-local';
  }

  async generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary> {
    const ids = records.map((r) => r.id);
    const scope = options.scope === 'all' ? { kind: 'all' } : { kind: 'filtered', recordIds: ids };
    const s = await this.client.json<SummaryWire>('/summary', {
      body: { scope, language: options.reportLanguage },
      timeoutMs: 180_000,
    });
    if (!s || typeof s.totalRecords !== 'number' || !Array.isArray(s.includedRecordIds) || !Array.isArray(s.categories)) {
      throw new ApiError(502, 'The summary service returned an incomplete report. Nothing was shown to avoid a misleading result.');
    }
    // Coverage check: the report must describe exactly the scope that was requested.
    if (s.totalRecords !== ids.length || s.includedRecordIds.length !== ids.length) {
      throw new ApiError(
        502,
        `The summary covered ${s.totalRecords.toLocaleString('en-IN')} records but ${ids.length.toLocaleString('en-IN')} were requested, so it was discarded. Try again or contact an administrator.`,
      );
    }
    if (options.scope === 'filtered') {
      const requested = new Set(ids);
      if (!s.includedRecordIds.every((id) => requested.has(id))) {
        throw new ApiError(502, 'The summary included records outside the selected scope, so it was discarded.');
      }
    }
    const mode = s.processingMode === 'server-ai' || s.processingMode === 'server-local' ? s.processingMode : this.mode;
    return {
      ...(s as ConsolidatedSummary),
      scope: options.scope,
      scopeDescription: options.scopeDescription,
      datasetName: options.datasetName,
      reportLanguage: options.reportLanguage,
      isSyntheticData: options.isSyntheticData,
      processingMode: mode,
      generatedAt: typeof s.generatedAt === 'string' ? s.generatedAt : new Date().toISOString(),
    };
  }
}

/** Parse a UTF-8 server-sent-events body. Decoding is streaming-safe so multi-byte Telugu is never split. */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const flush = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) onData(data);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const m = /\r?\n\r?\n/.exec(buffer)!;
      flush(buffer.slice(0, idx));
      buffer = buffer.slice(idx + m[0].length);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}

/** POST /chat — streams when the server answers with text/event-stream, otherwise reads one JSON answer. */
export class HttpChatService implements ChatService {
  readonly kind = 'ai' as const;
  readonly label = 'AI assistant';
  private readonly client: ApiClient;
  constructor(client: ApiClient) {
    this.client = client;
  }

  async ask(req: ChatRequest): Promise<ChatResult> {
    const response = await this.client.request('/chat', {
      body: { messages: req.messages, scope: req.scope, language: 'auto' },
      signal: req.signal,
      timeoutMs: 120_000,
      raw: true,
    });
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream') && response.body) {
      let answer = '';
      let citations: ChatResult['citations'] = [];
      let failure: string | null = null;
      await readSse(response.body, (data) => {
        let evt: { type?: string; text?: string; citations?: ChatResult['citations']; message?: string };
        try {
          evt = JSON.parse(data);
        } catch {
          return;
        }
        if (evt.type === 'delta' && typeof evt.text === 'string') {
          answer += evt.text;
          req.onDelta?.(evt.text);
        } else if (evt.type === 'done') {
          if (Array.isArray(evt.citations)) citations = evt.citations;
        } else if (evt.type === 'error') {
          failure = typeof evt.message === 'string' ? evt.message : 'The assistant failed while answering.';
        }
      });
      if (failure) throw new ApiError(502, failure);
      if (!answer.trim()) throw new ApiError(502, 'The assistant returned an empty answer.');
      return { answer, citations: cleanCitations(citations) };
    }
    const data = (await response.json()) as { answer?: unknown; citations?: unknown };
    if (typeof data.answer !== 'string' || !data.answer.trim()) throw new ApiError(502, 'The assistant returned an empty answer.');
    req.onDelta?.(data.answer);
    return { answer: data.answer, citations: cleanCitations(data.citations) };
  }
}

function cleanCitations(value: unknown): ChatResult['citations'] {
  if (!Array.isArray(value)) return [];
  const out: ChatResult['citations'] = [];
  for (const c of value) {
    if (c && typeof c === 'object' && typeof (c as { caseId?: unknown }).caseId === 'string') {
      const quote = (c as { quote?: unknown }).quote;
      out.push({ caseId: (c as { caseId: string }).caseId, quote: typeof quote === 'string' ? quote : undefined });
    }
  }
  return out;
}
