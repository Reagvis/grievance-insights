import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentChatService } from '../services/documentChat';

const datasetId = '12345678-abcd-4f12-9abc-123456789abc';
const scope = { kind: 'document' as const, datasetId, recordId: 'ORIGINAL-1', recordIndex: 2 };
afterEach(() => vi.unstubAllGlobals());

describe('signed-in document assistant client', () => {
  it('sends only a server-resolved document selector and message history', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      answer: 'A formal draft letter.', citations: [{ caseId: 'ORIGINAL-1' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const received: string[] = [];
    const service = new DocumentChatService((_datasetId, id) => id === 'ORIGINAL-1' ? 'ORIGINAL-1 (document.docx)' : undefined);
    const messages = [{ role: 'user' as const, content: 'Summarise' }, { role: 'assistant' as const, content: 'Overview' },
      { role: 'user' as const, content: 'Now draft a letter' }];
    const result = await service.ask({ scope, messages, onDelta: text => received.push(text) });
    expect(result.answer).toBe('A formal draft letter.');
    expect(result.citations).toEqual([{ caseId: 'ORIGINAL-1 (document.docx)' }]);
    expect(received).toEqual(['A formal draft letter.']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/datasets/' + datasetId + '/chat');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(String(init.body))).toEqual({ messages, recordId: 'ORIGINAL-1', recordIndex: 2 });
  });
  it('does not pretend the demo lookup is Qwen and fails closed on malformed replies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      answer: 'Untrusted answer', citations: 'not an array',
    }), { status: 200 })));
    const service = new DocumentChatService(() => undefined);
    await expect(service.ask({ scope, messages: [{ role: 'user', content: 'Draft a noting' }] }))
      .rejects.toThrow('invalid answer');
    await expect(service.ask({ scope: { kind: 'all' }, messages: [{ role: 'user', content: 'Draft a noting' }] }))
      .rejects.toThrow('Open a document');
  });
});


describe('document Assistant branding and cancellation', () => {
  it('uses neutral operator-facing labels', async () => {
    const service = new DocumentChatService(() => undefined);
    expect(service.label).toBe('AI document assistant');
    await expect(service.ask({ scope: { kind: 'all' }, messages: [{ role: 'user', content: 'Question' }] }))
      .rejects.toThrow('Open a document or complaint to use the Assistant.');
  });

  it('ignores an old fetch response even if the transport disregards the abort signal', async () => {
    const ac = new AbortController();
    const delta = vi.fn();
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const service = new DocumentChatService(() => undefined);
    const request = service.ask({ scope, messages: [{ role: 'user', content: 'Summarise' }], signal: ac.signal, onDelta: delta });
    ac.abort();
    resolve(new Response(JSON.stringify({ answer: 'Previous file text', citations: [] }), { status: 200 }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(delta).not.toHaveBeenCalled();
  });
});
