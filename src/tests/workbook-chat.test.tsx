import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel, useChatStore } from '../components/ChatPanel';
import { DocumentChatService } from '../services/documentChat';
import { formatFromName, CONTENT_TYPE } from '../domain/sourceFormats';
import { mergeComplaints } from '../services/allComplaints';
import type { RemoteDataset } from '../services/datasetApi';

afterEach(() => vi.unstubAllGlobals());
describe('pilot worksheet client', () => {
  it('recognizes only the approved Excel extension', () => {
    expect(formatFromName('Budget.XLSX')).toBe('xlsx');
    expect(formatFromName('macro.xlsm')).toBeNull();
    expect(formatFromName('legacy.xls')).toBeNull();
    expect(CONTENT_TYPE.xlsx).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  it('does not manufacture complaints for an empty canonical workbook index', () => {
    const dataset: RemoteDataset = { id: 'a', name: 'Budget.xlsx', format: 'xlsx', status: 'ready', bytes: 100, recordCount: 0, error: null, createdAt: '',
      sheets: [{ index: 0, name: 'Budget', rows: 2, columns: 3, kind: 'table', rowNumbers: [2, 3] }] };
    const merged = mergeComplaints([{ dataset, records: [] }]);
    expect(merged.records).toEqual([]);
    expect(merged.recordsByDataset.has('a')).toBe(true);
  });
  it('renders separate sheet and physical row choices', () => {
    function Panel() {
      const store = useChatStore();
      return <ChatPanel store={store} service={new DocumentChatService(() => undefined)}
        scopes={[
          { key: 'file:a:sheet:0', label: 'Budget.xlsx / Jan', scope: { kind: 'document', datasetId: 'a', sheetIndex: 0 }, rowNumbers: [2, 3] },
          { key: 'file:a:sheet:1', label: 'Budget.xlsx / Feb', scope: { kind: 'document', datasetId: 'a', sheetIndex: 1 }, rowNumbers: [2] },
        ]} knownIds={new Set()} unavailableReason={null} onOpenRecord={() => {}} onClose={() => {}} />;
    }
    const html = renderToStaticMarkup(<Panel />);
    expect(html).toContain('Budget.xlsx / Jan');
    expect(html).toContain('Budget.xlsx / Feb');
    expect(html).toContain('Worksheet row');
    expect(html).toContain('Row 3');
    expect(html).toContain('Summarise this worksheet');
  });
  it('sends worksheet and row selectors, never worksheet cells or other file IDs', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ answer: 'Synthetic summary', citations: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new DocumentChatService(() => undefined);
    const messages = [{ role: 'user' as const, content: 'Summarise' }];
    await service.ask({ scope: { kind: 'document', datasetId: 'a', sheetIndex: 1, row: 3 }, messages });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/datasets/a/chat');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ messages, sheetIndex: 1, row: 3 });
  });
});
