import { Bot, Copy, LoaderCircle, MessageSquarePlus, RotateCcw, Send, Square, TriangleAlert, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ChatScope, ChatService, Citation } from '../services/chat';

/* ───────────── Conversation state (memory only: real complaint text is never persisted in the browser) ───────────── */

export type ChatTurn = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  status: 'done' | 'streaming' | 'error' | 'stopped';
  citations?: Citation[];
  error?: string;
  /** Plain-language scope the question was asked against, shown for traceability. */
  scopeLabel?: string;
};
export type Conversation = { id: number; title: string; turns: ChatTurn[] };

export function useChatStore() {
  const nextId = useRef(1);
  const [chats, setChats] = useState<Conversation[]>(() => [{ id: 0, title: 'New chat', turns: [] }]);
  const [activeId, setActiveId] = useState(0);
  const active = chats.find((c) => c.id === activeId) ?? chats[0];

  const newChat = useCallback(() => {
    // Reuse the current chat if it is still empty instead of piling up blank conversations.
    setChats((cs) => {
      const current = cs.find((c) => c.id === activeId);
      if (current && current.turns.length === 0) return cs;
      const id = nextId.current++;
      setActiveId(id);
      return [{ id, title: 'New chat', turns: [] }, ...cs];
    });
  }, [activeId]);

  const patchTurn = useCallback((chatId: number, turnId: number, patch: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => {
    setChats((cs) =>
      cs.map((c) =>
        c.id !== chatId ? c : { ...c, turns: c.turns.map((t) => (t.id !== turnId ? t : { ...t, ...(typeof patch === 'function' ? patch(t) : patch) })) },
      ),
    );
  }, []);

  const addTurns = useCallback((chatId: number, turns: ChatTurn[], title?: string) => {
    setChats((cs) => cs.map((c) => (c.id !== chatId ? c : { ...c, title: c.turns.length === 0 && title ? title : c.title, turns: [...c.turns, ...turns] })));
  }, []);

  const dropTurnsFrom = useCallback((chatId: number, turnId: number) => {
    setChats((cs) => cs.map((c) => (c.id !== chatId ? c : { ...c, turns: c.turns.filter((t) => t.id < turnId) })));
  }, []);

  const turnId = useCallback(() => nextId.current++, []);
  const reset = useCallback(() => {
    setChats([{ id: 0, title: 'New chat', turns: [] }]);
    setActiveId(0);
  }, []);
  return { chats, active, activeId: active.id, setActiveId, newChat, patchTurn, addTurns, dropTurnsFrom, turnId, reset };
}
export type ChatStore = ReturnType<typeof useChatStore>;

/* ───────────── Safe text rendering (no HTML is ever injected) ───────────── */

function inline(text: string, key: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={`${key}${i}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${key}${i}`}>{part}</Fragment>,
  );
}

function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${bi}-${li}-`)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}-`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/* ───────────── Panel ───────────── */

export type ScopeOption = { key: 'all' | 'filtered' | 'note' | 'file' | `file:${string}`; label: string; scope: ChatScope; rowNumbers?: number[] };

type Props = {
  store: ChatStore;
  service: ChatService;
  /** Which scopes the user can choose from right now. First entry is the default. */
  scopes: ScopeOption[];
  knownIds: ReadonlySet<string>;
  /** When set, the assistant is switched off and this explains why (no fake answers). */
  unavailableReason: string | null;
  onOpenRecord: (id: string) => void;
  onClose: () => void;
};

const SUGGESTIONS: Record<'all' | 'filtered' | 'note' | 'file', string[]> = {
  all: ['What are the most common complaint categories?', 'Which complaints have no response yet?', 'What do water supply complaints have in common?'],
  filtered: ['Summarise the issues in these complaints', 'Which of these have no response?'],
  note: ['Summarise this complaint and the response', 'Is there anything the response does not address?'],
  file: ['Summarise this document', 'Draft an email based on this file', 'Extract the key points'], 
};

const AI_SUGGESTIONS: Partial<Record<keyof typeof SUGGESTIONS, string[]>> = {
  note: ['Summarise this complaint and the response', 'Draft an official government file noting', 'Suggest practical solutions'],
  file: ['Summarise this document', 'Draft an email based on this file', 'Extract the key points'],
};

type ConversationProps = Props & { scope: ScopeOption; onScopeChange: (key: ScopeOption['key']) => void; onRowChange?: (row: number | undefined) => void };

export function ChatPanel(props: Props) {
  const [scopeKey, setScopeKey] = useState<ScopeOption['key']>(props.scopes[0].key);
  const selected = props.scopes.find(s => s.key === scopeKey) ?? props.scopes[0];
  const [rowSelection, setRowSelection] = useState<{ key: string; row: number } | undefined>();
  const row = rowSelection?.key === selected.key && selected.rowNumbers?.includes(rowSelection.row) ? rowSelection.row : undefined;
  const scope: ScopeOption = selected.scope.kind === 'document' && selected.scope.sheetIndex !== undefined
    ? { ...selected, scope: { ...selected.scope, row }, label: selected.label + (row !== undefined ? ' · row ' + row : '') }
    : selected;
  // Key by the actual selector, not its display key or label. A disappearing
  // file, record change, disabled document or switch back must start fresh.
  const conversationProps = { ...props, scope,
    onScopeChange: (key: ScopeOption['key']) => { setRowSelection(undefined); setScopeKey(key); },
    onRowChange: (row: number | undefined) => setRowSelection(row === undefined ? undefined : { key: selected.key, row }),
  };
  if (scope.scope.kind === 'document') {
    const { datasetId, recordId, recordIndex, sheetIndex, row } = scope.scope;
    const key = JSON.stringify([datasetId, recordId, recordIndex, sheetIndex, row, props.unavailableReason]);
    return <DocumentConversation key={key} {...conversationProps} />;
  }
  return <ChatConversation {...conversationProps} />;
}

function DocumentConversation(props: ConversationProps) {
  // The store belongs to this mounted document scope only. Never reuse the
  // parent (legacy lookup/live chat) store across authorized file selections.
  const store = useChatStore();
  return <ChatConversation {...props} store={store} />;
}

function ChatConversation({ store, service, scopes, scope, onScopeChange, onRowChange, knownIds, unavailableReason, onOpenRecord, onClose }: ConversationProps) {
  const { chats, active, setActiveId, newChat, patchTurn, addTurns, dropTurnsFrom, turnId } = store;
  const [draft, setDraft] = useState('');
  const controller = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy = active.turns.some((t) => t.status === 'streaming');
  const disabled = unavailableReason !== null;

  // Layout cleanup invalidates callbacks at unmount, including services
  // that ignore AbortSignal. Old replies cannot patch a replacement store.
  useLayoutEffect(() => () => {
    const pending = controller.current;
    controller.current = null;
    pending?.abort();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [active.turns]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [active.id]);

  const run = useCallback(
    async (chatId: number, history: ChatTurn[], question: string, reuseUserTurn?: ChatTurn) => {
      const user: ChatTurn = reuseUserTurn ?? { id: turnId(), role: 'user', content: question, status: 'done', scopeLabel: scope.label };
      const reply: ChatTurn = { id: turnId(), role: 'assistant', content: '', status: 'streaming' };
      addTurns(chatId, reuseUserTurn ? [reply] : [user, reply], question.slice(0, 48));
      const ac = new AbortController();
      controller.current = ac;
      const messages = [...history.filter((t) => t.status === 'done' && t.content).map((t) => ({ role: t.role, content: t.content })), { role: 'user' as const, content: question }].slice(-12);
      try {
        const result = await service.ask({
          messages,
          scope: scope.scope,
          signal: ac.signal,
          onDelta: (text) => {
            if (controller.current === ac && !ac.signal.aborted) patchTurn(chatId, reply.id, (t) => ({ content: t.content + text }));
          },
        });
        if (controller.current !== ac) return;
        ac.signal.throwIfAborted();
        patchTurn(chatId, reply.id, { content: result.answer, citations: result.citations, status: 'done' });
      } catch (e) {
        if (controller.current !== ac) return;
        if (ac.signal.aborted) {
          patchTurn(chatId, reply.id, (t) => ({ status: 'stopped', content: t.content }));
        } else {
          patchTurn(chatId, reply.id, { status: 'error', error: e instanceof Error ? e.message : 'The assistant could not answer.' });
        }
      } finally {
        if (controller.current === ac) controller.current = null;
      }
    },
    [addTurns, patchTurn, scope, service, turnId],
  );

  const send = (text: string) => {
    const q = text.trim();
    if (!q || busy || disabled || controller.current) return;
    setDraft('');
    void run(active.id, active.turns, q);
  };

  const retry = (reply: ChatTurn) => {
    const idx = active.turns.findIndex((t) => t.id === reply.id);
    const user = active.turns[idx - 1];
    if (!user || user.role !== 'user' || busy || disabled || controller.current) return;
    dropTurnsFrom(active.id, reply.id);
    void run(active.id, active.turns.slice(0, idx - 1), user.content, user);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const suggestionKey = (scope.key.startsWith('file:') ? 'file' : scope.key) as keyof typeof SUGGESTIONS;
  const suggestions = useMemo(() => scope.scope.kind === 'document' && scope.scope.sheetIndex !== undefined ? ['Summarise this worksheet', 'Explain the numeric columns', 'What information is available?'] : service.kind === 'ai' ? (AI_SUGGESTIONS[suggestionKey] ?? SUGGESTIONS[suggestionKey]) : SUGGESTIONS[suggestionKey], [suggestionKey, service.kind, scope.scope]);

  return (
    <aside className="chat-panel" aria-label="Assistant">
      <header className="chat-head">
        <div className="chat-title">
          <span className="chat-avatar" aria-hidden>
            <Bot size={16} />
          </span>
          <div>
            <h2>Assistant</h2>
            <span className="chat-sub">{service.label}</span>
          </div>
        </div>
        <div className="chat-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={newChat} disabled={busy}>
            <MessageSquarePlus size={14} aria-hidden />
            New chat
          </button>
          <button type="button" className="icon-btn" aria-label="Close assistant" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
      </header>

      <div className="chat-ask">
      {chats.length > 1 && (
        <div className="chat-history">
          <label htmlFor="chat-history-select" className="sr-only">
            Conversation
          </label>
          <select id="chat-history-select" className="select" value={active.id} onChange={(e) => setActiveId(Number(e.target.value))} disabled={busy}>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="chat-scroll" role="log" aria-live="polite" aria-label="Conversation">
        {active.turns.length === 0 ? (
          <div className="chat-empty">
            <p className="chat-empty-title">{service.kind === 'ai' ? 'Ask about this document' : 'Ask about the complaints'}</p>
            <p className="chat-empty-text">
              {service.kind === 'ai'
                ? 'Ask questions, create summaries, emails, official notings or draft letters from the selected document. Verify important details before use.'
                : 'This offline mode only looks up records and counts them. It does not reason about the text.'}
            </p>
            {!disabled && (
              <div className="chat-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chat-suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          active.turns.map((t) => (
            <div key={t.id} className={`chat-turn chat-turn--${t.role}`}>
              {t.role === 'user' ? (
                <>
                  <div className="chat-bubble chat-bubble--user">{t.content}</div>
                  {t.scopeLabel && <span className="chat-turn-meta">Asked about: {t.scopeLabel}</span>}
                </>
              ) : (
                <div className="chat-bubble chat-bubble--bot">
                  {t.status === 'streaming' && !t.content && (
                    <span className="chat-typing">
                      <LoaderCircle size={14} className="spin" aria-hidden /> {service.kind === 'ai' ? 'Generating document answer…' : 'Reading the records…'}
                    </span>
                  )}
                  {t.content && <RichText text={t.content} />}
                  {t.status === 'stopped' && <p className="chat-note">Stopped before finishing.</p>}
                  {t.status === 'error' && (
                    <div className="chat-error" role="alert">
                      <TriangleAlert size={15} aria-hidden />
                      <span>{t.error}</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => retry(t)} disabled={busy}>
                        <RotateCcw size={13} aria-hidden />
                        Retry
                      </button>
                    </div>
                  )}
                  {t.status === 'done' && t.citations && t.citations.length > 0 && (
                    <div className="chat-sources">
                      <span className="chat-sources-label">Based on</span>
                      {t.citations.map((c) =>
                        knownIds.has(c.caseId) ? (
                          <button key={c.caseId} type="button" className="case-chip" onClick={() => onOpenRecord(c.caseId)} title={c.quote ?? 'Open this complaint'}>
                            {c.caseId}
                          </button>
                        ) : (
                          <span key={c.caseId} className="case-chip case-chip--unknown" title="This ID is not in the loaded complaints, so it cannot be verified.">
                            {c.caseId} · not found
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {t.status === 'done' && t.content && (
                    <button type="button" className="chat-copy" onClick={() => void navigator.clipboard?.writeText(t.content)} aria-label="Copy answer">
                      <Copy size={12} aria-hidden /> Copy
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <footer className="chat-foot">
        {disabled ? (
          <p className="chat-unavailable" role="status">
            <TriangleAlert size={14} aria-hidden /> {unavailableReason}
          </p>
        ) : (
          <>
            {scopes.length > 1 && (
              <div className="chat-scope">
                <label htmlFor="chat-scope-select">Ask about</label>
                <select id="chat-scope-select" className="select" value={scope.key} onChange={(e) => {
                  onScopeChange(e.target.value as ScopeOption['key']);
                }} disabled={busy && scope.scope.kind !== 'document'}>
                  {scopes.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {scope.scope.kind === 'document' && scope.scope.sheetIndex !== undefined && scope.rowNumbers && (
              <div className="chat-scope">
                <label htmlFor="chat-sheet-row">Worksheet row</label>
                <select id="chat-sheet-row" className="select" value={scope.scope.row ?? ''} onChange={e => onRowChange?.(e.target.value ? Number(e.target.value) : undefined)}>
                  <option value="">Whole worksheet (bounded summary)</option>
                  {scope.rowNumbers.map(row => <option key={row} value={row}>Row {row}</option>)}
                </select>
              </div>
            )}
            <form className="chat-composer" onSubmit={onSubmit}>
              <label htmlFor="chat-input" className="sr-only">
                Your question
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                className="input"
                rows={2}
                value={draft}
                maxLength={4000}
                placeholder={scopes.length === 1 ? `Ask about ${scope.label.toLowerCase()}…` : 'Type your question…'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
              />
              {busy ? (
                <button type="button" className="btn btn-secondary chat-send" onClick={() => controller.current?.abort()} aria-label="Stop answering">
                  <Square size={14} aria-hidden />
                </button>
              ) : (
                <button type="submit" className="btn btn-primary chat-send" disabled={!draft.trim()} aria-label="Send question">
                  <Send size={15} aria-hidden />
                </button>
              )}
            </form>
            <p className="chat-privacy">{scope.scope.kind === 'document'
              ? 'Conversations stay in this tab and are cleared when you change document or complaint, close the Assistant or sign out.'
              : 'Conversations stay in this tab only and are cleared when you close it.'}</p>
          </>
        )}
      </footer>
      </div>
    </aside>
  );
}

export function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="fab" onClick={onOpen} aria-label="Open assistant" id="assistant-launcher">
      <span className="fab-icon" aria-hidden>
        <Bot size={15} />
      </span>
      <span className="fab-label">Assistant</span>
    </button>
  );
}
