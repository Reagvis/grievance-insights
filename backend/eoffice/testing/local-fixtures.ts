import { createEofficeApi, type Event, type Principal } from '../core';
import { EofficeError } from '../schema';
import type { DocumentRef, Material } from '../documents';

/**
 * LOCALHOST-ONLY, SYNTHETIC DATA. These headers select fixtures and faults;
 * they are NOT authentication and MUST NOT be connected to production routes.
 * In particular never read Authorization, cookies, or user_id as credentials.
 */
export const ACTOR_HEADER = 'x-eoffice-smoke-actor';
export const FAULT_HEADER = 'x-eoffice-smoke-fault';
export const SHARED_SESSION = 'synthetic-shared-session';
export const HISTORY_ALPHA = 'synthetic-history-alpha';
export const HISTORY_BETA = 'synthetic-history-beta';

export const ALPHA_REF: DocumentRef = {
  document_id: 'synthetic-policy',
  download_url: 'https://synthetic.invalid/alpha-policy?ticket=private-alpha-secret',
};
export const BETA_REF: DocumentRef = {
  document_id: 'synthetic-policy',
  download_url: 'https://synthetic.invalid/beta-policy?ticket=private-beta-secret',
};
export const SUPPORT_REF: DocumentRef = {
  document_id: 'synthetic-support',
  download_url: 'https://synthetic.invalid/alpha-support?ticket=private-support-secret',
};

export const ALPHA_QUOTE = 'Finance Alpha memorandum records a Procurement allocation cap of 1.2 million.';
export const BETA_QUOTE = 'Finance Beta memorandum records a Travel allocation cap of 2.4 million.';
export const SUPPORT_QUOTE = 'Finance Alpha supporting note requests additional Procurement evidence.';
const alphaPageOne = 'Finance Alpha cover page identifies Procurement as the subject.';
export const ALPHA_MATERIAL: Material = {
  document_id: ALPHA_REF.document_id, title: 'Synthetic Alpha Policy.pdf',
  text: '[Page 1]\n' + alphaPageOne + '\n[Page 2]\n' + ALPHA_QUOTE,
  pages: [{ page_number: 1, text: alphaPageOne }, { page_number: 2, text: ALPHA_QUOTE }],
};
export const BETA_MATERIAL: Material = {
  document_id: BETA_REF.document_id, title: 'Synthetic Beta Policy.pdf',
  text: '[Page 1]\n' + BETA_QUOTE, page_number: 1,
  pages: [{ page_number: 1, text: BETA_QUOTE }],
};
export const SUPPORT_MATERIAL: Material = {
  document_id: SUPPORT_REF.document_id, title: 'Synthetic Alpha Support.txt',
  text: SUPPORT_QUOTE,
};

type Actor = 'alpha' | 'beta';
type Fixture = Readonly<{ actor: Actor; department: string; officer: string;
  ref: DocumentRef; material: Material }>;
const fixtures: readonly Fixture[] = [
  { actor: 'alpha', department: 'synthetic-finance-alpha', officer: 'synthetic-officer-alpha',
    ref: ALPHA_REF, material: ALPHA_MATERIAL },
  { actor: 'beta', department: 'synthetic-finance-beta', officer: 'synthetic-officer-beta',
    ref: BETA_REF, material: BETA_MATERIAL },
  { actor: 'alpha', department: 'synthetic-finance-alpha', officer: 'synthetic-officer-alpha',
    ref: SUPPORT_REF, material: SUPPORT_MATERIAL },
];

const failures = new Set([
  'auth-denied', 'auth-unavailable', 'document-unavailable', 'document-timeout',
  'history-unavailable', 'bad-model-json', 'fabricated-reference',
  'unsupported-number', 'protected-url-leak', 'model-unavailable',
  'model-denied', 'model-timeout',
]);

function modelEnvelope(system: string, prompt: string, fault: string): string {
  if (fault === 'bad-model-json') return '{not valid json';
  if (fault === 'fabricated-reference') return JSON.stringify({
    text: 'An invented document was used.',
    used_document_ids: ['nonexistent-source'],
    evidence: [{ document_id: 'nonexistent-source', quote: 'This excerpt is entirely fabricated.' }],
  });

  const source = prompt.split('\nPRIOR_CHAT (untrusted):\n')[0];
  // JSONL escapes newlines in full material.text; distinctive excerpts are
  // unchanged and let the synthetic responder pick only attached sources.
  const used = fixtures.filter(f => source.includes(
    f.material === ALPHA_MATERIAL ? ALPHA_QUOTE
      : f.material === BETA_MATERIAL ? BETA_QUOTE : SUPPORT_QUOTE));
  const cited = used.map(f => ({
    document_id: f.ref.document_id,
    quote: f.material === ALPHA_MATERIAL ? ALPHA_QUOTE
      : f.material === BETA_MATERIAL ? BETA_QUOTE : SUPPORT_QUOTE,
    ...(f.material.pages ? { page_number: f.material === ALPHA_MATERIAL ? 2 : 1 } : {}),
  }));
  const ids = used.map(f => f.ref.document_id);
  const policy = used.find(f => f.material === ALPHA_MATERIAL || f.material === BETA_MATERIAL);
  const amount = policy?.material === ALPHA_MATERIAL ? '1.2' : '2.4';
  const subject = policy?.material === BETA_MATERIAL ? 'Travel' : 'Procurement';
  const grounded = Boolean(policy);

  if (system.startsWith('Extract only')) return JSON.stringify({
    extracted_data: { subject, letter_date: null, approved: null },
    used_document_ids: ids, evidence: cited,
  });

  let text = '';
  if (system.startsWith('Answer the question')) {
    text = grounded ? 'The ' + subject + ' allocation cap is ' + amount + ' million.'
      : prompt.includes('synthetic previous alpha turn') || prompt.includes('synthetic previous beta turn')
        ? 'Authorized synthetic previous context was supplied.'
        : 'No previous conversation context was supplied.';
    // Only cite the supporting note when the narrative actually discusses it.
    if (used.some(f => f.material === SUPPORT_MATERIAL))
      text += ' Additional Procurement supporting evidence was requested.';
  } else if (system.startsWith('Write a concise')) {
    text = grounded ? 'The ' + subject + ' memorandum records a cap of ' + amount + ' million.'
      : 'The supplied synthetic source passage was summarized.';
  } else {
    text = 'Draft: Please provide the ' + subject + ' supporting documents for officer review.';
  }

  if (fault === 'unsupported-number') text = 'The allocation cap is 9.7 million.';
  if (fault === 'protected-url-leak') text = 'Download the file at ' + (policy?.ref.download_url ?? ALPHA_REF.download_url);
  return JSON.stringify({ text, used_document_ids: ids, evidence: cited });
}

/** Construct fresh, deterministic adapters per request. Nothing is cached or
 * persisted, and all document/history lookup is a plain in-memory equality
 * check; no DNS, fetch, Bedrock, file IO, cookies or government services.
 */
export function createLocalSyntheticApi(actorValue: string | undefined, faultValue: string | undefined) {
  const actor = actorValue === 'alpha' || actorValue === 'beta' ? actorValue : undefined;
  const fault = faultValue && failures.has(faultValue) ? faultValue : '';
  const principal: Principal | null = actor ? {
    department: actor === 'alpha' ? 'synthetic-finance-alpha' : 'synthetic-finance-beta',
    officer: actor === 'alpha' ? 'synthetic-officer-alpha' : 'synthetic-officer-beta',
    permissions: ['chat', 'summarize', 'extract', 'draft-reply'],
  } : null;
  return createEofficeApi({
    authorize: async (_event: Event) => {
      if (fault === 'auth-denied') return null;
      if (fault === 'auth-unavailable')
        throw new EofficeError(503, 'PRIVATE_SYNTHETIC_AUTH_DIAGNOSTIC', 'PRIVATE_SYNTHETIC_AUTH_PUBLIC');
      return principal;
    },
    documents: {
      fetch: async (reference, authorized) => {
        if (fault === 'document-timeout') return new Promise<Material>(() => {});
        if (fault === 'document-unavailable') throw new EofficeError(422,
          'PRIVATE_SYNTHETIC_DOCUMENT_DIAGNOSTIC', 'PRIVATE_SYNTHETIC_DOCUMENT_PUBLIC');
        const found = fixtures.find(f => f.department === authorized.department &&
          f.officer === authorized.officer && f.ref.document_id === reference.document_id &&
          f.ref.download_url === reference.download_url);
        if (!found) throw new EofficeError(422, 'Synthetic document unavailable.', 'Document unavailable.');
        return found.material;
      },
    },
    history: async lookup => {
      if (fault === 'history-unavailable') throw new EofficeError(422,
        'PRIVATE_SYNTHETIC_HISTORY_DIAGNOSTIC', 'PRIVATE_SYNTHETIC_HISTORY_PUBLIC');
      if (lookup.sessionId !== SHARED_SESSION) throw new EofficeError(422, 'Wrong synthetic session.', 'History unavailable.');
      if (lookup.reference === HISTORY_ALPHA && lookup.principal.department === 'synthetic-finance-alpha' &&
          lookup.principal.officer === 'synthetic-officer-alpha') return 'synthetic previous alpha turn';
      if (lookup.reference === HISTORY_BETA && lookup.principal.department === 'synthetic-finance-beta' &&
          lookup.principal.officer === 'synthetic-officer-beta') return 'synthetic previous beta turn';
      throw new EofficeError(422, 'Wrong synthetic history owner.', 'History unavailable.');
    },
    model: async (system, prompt) => {
      if (fault === 'model-timeout') return new Promise<string>(() => {});
      if (fault === 'model-unavailable') throw new EofficeError(503,
        'PRIVATE_SYNTHETIC_MODEL_DIAGNOSTIC', 'PRIVATE_SYNTHETIC_MODEL_PUBLIC');
      if (fault === 'model-denied') throw new EofficeError(403,
        'PRIVATE_SYNTHETIC_MODEL_DIAGNOSTIC', 'PRIVATE_SYNTHETIC_MODEL_PUBLIC');
      return modelEnvelope(system, prompt, fault);
    },
  });
}
