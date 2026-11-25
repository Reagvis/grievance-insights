/** Offline real-browser regression: no AWS, credentials or real documents. */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AssistantLauncher, ChatPanel, useChatStore, type ScopeOption } from '../components/ChatPanel';
import type { ChatRequest, ChatResult, ChatService } from '../services/chat';

const app = document.getElementById('assistant-root')!;
const status = document.getElementById('assistant-browser-result')!;
const root = createRoot(app);
let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions++;
  if (!condition) throw new Error(message);
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 60));
function element<T extends HTMLElement>(selector: string): T {
  const found = app.querySelector<T>(selector);
  check(found, 'Missing ' + selector);
  return found;
}
const A: ScopeOption = { key: 'file:a', label: 'Synthetic A', scope: { kind: 'document', datasetId: 'a' } };
const B: ScopeOption = { key: 'file:b', label: 'Synthetic B', scope: { kind: 'document', datasetId: 'b' } };
const note: ScopeOption = { key: 'note', label: 'Synthetic B record', scope: { kind: 'document', datasetId: 'b', recordId: 'REPEAT', recordIndex: 0 } };
const calls: { req: ChatRequest; finish: (answer: string) => void }[] = [];
const service: ChatService = {
  kind: 'ai', label: 'AI document assistant',
  ask: req => new Promise<ChatResult>(resolve => calls.push({ req, finish: answer => {
    // Deliberately ignore the signal, including the streaming callback.
    req.onDelta?.(answer);
    resolve({ answer, citations: [] });
  } })),
};
function Harness({ scopes, signedIn }: { scopes: ScopeOption[]; signedIn: boolean }) {
  const store = useChatStore();
  const [open, setOpen] = useState(false);
  if (!signedIn) return <p>Signed out</p>;
  return open ? <ChatPanel store={store} service={service} scopes={scopes} knownIds={new Set()}
    unavailableReason={null} onOpenRecord={() => {}} onClose={() => setOpen(false)} />
    : <AssistantLauncher onOpen={() => setOpen(true)} />;
}
function render(scopes = [A, B, note], signedIn = true) {
  flushSync(() => root.render(<Harness scopes={scopes} signedIn={signedIn} />));
}
async function select(key: string) {
  const select = element<HTMLSelectElement>('#chat-scope-select');
  select.value = key;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
async function suggest() {
  element<HTMLButtonElement>('.chat-suggestion').click();
  await settle();
}
async function enter(question: string) {
  const input = element<HTMLTextAreaElement>('#chat-input');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, question);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
}
async function run() {
  render();
  element<HTMLButtonElement>('[aria-label="Open assistant"]').click();
  await settle();
  check(!app.textContent?.match(/Qwen|AI analysis/i), 'Obsolete branding/mode present');
  check(!!app.textContent?.includes('Ask about this document'), 'No welcome');
  check(document.activeElement === element('#chat-input'), 'Composer not focused');
  await suggest();
  check(calls.length === 1, 'Suggestion did not submit');
  check(calls[0].req.scope.kind === 'document' && calls[0].req.scope.datasetId === 'a', 'Wrong source A');
  calls[0].finish('PRIVATE-A synthetic answer');
  await settle();
  check(app.textContent?.includes('PRIVATE-A synthetic answer'), 'Missing A answer');
  await enter('Translate the last answer into Telugu');
  check(calls[1]?.req.messages.some(m => m.content === 'PRIVATE-A synthetic answer'), 'Follow-up lost current history');
  await select('file:b');
  check(calls[1].req.signal?.aborted, 'Old request was not aborted');
  check(!app.textContent?.includes('PRIVATE-A'), 'A history remained after switching');
  await suggest();
  check(calls[2]?.req.scope.kind === 'document' && calls[2].req.scope.datasetId === 'b', 'Wrong source B');
  check(calls[2].req.messages.length === 1, 'A history was sent to B');
  calls[1].finish('LATE-A synthetic answer');
  await settle();
  check(!app.textContent?.includes('LATE-A'), 'Late A reply appeared in B');
  calls[2].finish('PRIVATE-B synthetic answer');
  await settle();
  check(app.textContent?.includes('PRIVATE-B synthetic answer'), 'B answer absent');
  await select('note');
  check(!app.textContent?.includes('PRIVATE-B'), 'File history leaked into record');
  await suggest();
  check(calls[3]?.req.scope.kind === 'document' && calls[3].req.scope.recordId === 'REPEAT', 'Wrong record selector');
  check(calls[3].req.messages.length === 1, 'File history sent to record');
  render([A, B]); // Selected record disappears without a user selection event.
  await settle();
  check(calls[3].req.signal?.aborted, 'Disappearing scope did not abort request');
  calls[3].finish('LATE-RECORD');
  await settle();
  check(!app.textContent?.includes('LATE-RECORD'), 'Disappearing record reply leaked');
  await suggest();
  check(calls[4]?.req.messages.length === 1, 'Fallback retained prior history');
  element<HTMLButtonElement>('[aria-label="Close assistant"]').click();
  await settle();
  check(calls[4].req.signal?.aborted, 'Close failed to abort');
  element<HTMLButtonElement>('[aria-label="Open assistant"]').click();
  await settle();
  calls[4].finish('LATE-CLOSED');
  await settle();
  check(!app.textContent?.includes('LATE-CLOSED'), 'Closed conversation leaked');
  await suggest();
  check(calls[5]?.req.messages.length === 1, 'Reopened Assistant retained history');
  render([A, B], false);
  await settle();
  check(calls[5].req.signal?.aborted, 'Sign-out failed to abort');
  calls[5].finish('LATE-LOGOUT');
  await settle();
  check(!app.textContent?.includes('LATE-LOGOUT') && !app.querySelector('.chat-panel'), 'Signed-out reply leaked');
}
void run().then(() => {
  status.dataset.status = 'passed';
  status.textContent = 'PASS ' + assertions + ' real-browser assistant assertions';
}).catch(error => {
  status.dataset.status = 'failed';
  status.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
});
