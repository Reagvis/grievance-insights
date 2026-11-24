import { vi } from 'vitest';
import {
  createEofficeApi, type Event, type HistoryLookup, type Model, type Principal,
} from '../core';
import type { DocumentRef, Material } from '../documents';
import { unprocessable } from '../schema';

/**
 * Offline API Gateway v2 integration fixture. All principals are bound to the
 * event object via a WeakMap by the test, NOT obtained from a user-controlled
 * HTTP header/body. This is a mock trust boundary, never a government auth API.
 * No network, persisted chat state, filesystem or provider calls.
 */
export type ScopedDocument = Readonly<{
  department: string; officer: string; material: Material;
}>;
export type ScopedHistory = Readonly<{
  reference: string; sessionId: string;
  department: string; officer: string; text: string;
}>;

export function createMockEofficeHarness(options: {
  documents?: readonly ScopedDocument[];
  histories?: readonly ScopedHistory[];
  enableHistory?: boolean;
  model: Model;
}) {
  const bound = new WeakMap<Event, Principal>();
  const authorize = vi.fn(async (event: unknown): Promise<Principal | null> =>
    bound.get(event as Event) ?? null);
  const documentFetch = vi.fn(async (
    reference: DocumentRef, principal: Principal, _deadline: number,
  ): Promise<Material> => {
    const match = options.documents?.find(d =>
      d.department === principal.department &&
      d.officer === principal.officer &&
      d.material.document_id === reference.document_id);
    if (!match) throw unprocessable('Authorized test document unavailable.');
    return match.material;
  });
  const resolveHistory = vi.fn(async (lookup: HistoryLookup): Promise<string> => {
    const match = options.histories?.find(h =>
      h.reference === lookup.reference &&
      h.sessionId === lookup.sessionId &&
      h.department === lookup.principal.department &&
      h.officer === lookup.principal.officer);
    if (!match) throw unprocessable('History is unavailable for the authorized session.');
    return match.text;
  });
  const model = vi.fn(options.model);
  const handler = createEofficeApi({
    authorize, model, documents: { fetch: documentFetch },
    ...(options.enableHistory ? { history: resolveHistory } : {}),
  });
  function issue(
    task: string,
    payload: Record<string, unknown>,
    principal?: Principal,
    overrides: Partial<Event> = {},
  ): Event {
    const event: Event = {
      rawPath: '/api/v1/ai/' + task,
      requestContext: { http: { method: 'POST' } },
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      ...overrides,
    };
    if (principal) bound.set(event, principal);
    return event;
  }
  return { handler, issue, authorize, documentFetch, resolveHistory, model };
}
