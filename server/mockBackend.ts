/**
 * DEVELOPMENT MOCK of the production backend contract (docs/BACKEND_CONTRACT.md), served under /api/v1.
 *
 * It exists so the live-mode frontend can be exercised end to end before the real service is available.
 * It serves synthetic records, a deterministic "summary" and a deterministic lookup "assistant", and
 * announces itself as `mode: "mock"` in /health so the UI shows a visible "mock backend" notice.
 * It is NOT an AI service and must never be deployed.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createExpandedDataset } from '../src/data/demoGrievances';
import type { GrievanceRecord } from '../src/domain/grievance';
import { buildConsolidatedSummary } from '../src/services/localDemoSummaryService';
import { answerQuestion } from '../src/services/recordAssistant';

let cache: GrievanceRecord[] | null = null;
const records = () => (cache ??= createExpandedDataset().records);

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > 8 * 1024 * 1024) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(b);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handleMockBackend(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<void> {
  try {
    const path = pathname.replace(/^\/api\/v1/, '');
    const all = records();

    if (path === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        mode: 'mock',
        version: 'dev-mock',
        dataset: { name: 'Development mock data', updatedAt: new Date().toISOString(), isSynthetic: true },
        capabilities: { chat: true, summary: 'deterministic' },
      });
    }

    if (path === '/complaints' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 500));
      const offset = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
      const slice = all.slice(offset, offset + limit);
      const next = offset + limit < all.length ? String(offset + limit) : null;
      return sendJson(res, 200, {
        total: all.length,
        nextCursor: next,
        items: slice.map((r) => ({
          id: r.id,
          complaintText: r.complaintText,
          responseText: r.responseText,
          category: r.category,
          issueType: r.issueType,
          department: r.department,
          district: r.district,
          submittedAt: r.submittedAt,
          respondedAt: r.respondedAt,
          status: r.status,
          language: r.language,
          isSynthetic: true,
        })),
      });
    }

    if (path === '/summary' && req.method === 'POST') {
      const b = await body(req);
      const scope = b.scope as { kind?: string; recordIds?: unknown } | undefined;
      let subset = all;
      if (scope?.kind === 'filtered') {
        if (!Array.isArray(scope.recordIds) || scope.recordIds.length === 0) return sendJson(res, 400, { error: 'recordIds is required for a filtered scope.' });
        const want = new Set(scope.recordIds.map(String));
        subset = all.filter((r) => want.has(r.id));
      } else if (scope?.kind !== 'all') {
        return sendJson(res, 400, { error: 'scope.kind must be "all" or "filtered".' });
      }
      if (subset.length === 0) return sendJson(res, 400, { error: 'No records match this scope.' });
      const summary = buildConsolidatedSummary(subset, {
        scope: scope.kind === 'all' ? 'all' : 'filtered',
        scopeDescription: 'server scope',
        reportLanguage: 'en',
        datasetName: 'Development mock data',
        isSyntheticData: true,
      });
      summary.processingMode = 'server-local';
      return sendJson(res, 200, summary);
    }

    if (path === '/chat' && req.method === 'POST') {
      const b = await body(req);
      const messages = Array.isArray(b.messages) ? (b.messages as Array<{ role?: string; content?: string }>) : [];
      const last = [...messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
      if (!last?.content) return sendJson(res, 400, { error: 'Send at least one user message.' });
      const scope = b.scope as { kind?: string; recordIds?: unknown } | undefined;
      const pool =
        scope?.kind === 'records' && Array.isArray(scope.recordIds)
          ? all.filter((r) => new Set(scope.recordIds as unknown[]).has(r.id))
          : all;
      const result = answerQuestion(pool, last.content);
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const words = result.answer.split(/(\s+)/);
      for (let i = 0; i < words.length; i += 6) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ type: 'delta', text: words.slice(i, i + 6).join('') })}\n\n`);
        await wait(25);
      }
      res.write(`data: ${JSON.stringify({ type: 'done', citations: result.sources.map((s) => ({ caseId: s.id })) })}\n\n`);
      return void res.end();
    }

    return sendJson(res, 404, { error: 'API endpoint not found.' });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'The mock backend could not process this request.' : (e as Error).message });
    else res.end();
  }
}
