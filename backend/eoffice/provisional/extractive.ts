import type { Model, StrictDocumentChat } from '../core';
import type { Material } from '../documents';
import type { SourceEvidence } from '../grounding';
import { EofficeError } from '../schema';

const REFUSAL = 'I can only answer from authorized documents supplied with this request.';
const STOP = new Set([
  'a','an','the','is','are','was','were','what','which','who','when','where','why',
  'how','can','could','would','should','do','does','did','tell','me','about','please',
  'give','show','this','that','these','those','it','in','on','at','by','to','for',
  'with','from','of','and','or','as','under','according','document','documents',
  'attached','source','my','our','your','i','you','they','their','his','her',
]);
const tokenize = (text: string): string[] =>
  (text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => word.length >= 3 && !STOP.has(word));
function candidates(material: Material): Array<{ quote: string; page_number?: number }> {
  const chunks = material.pages?.map(p => ({ text: p.text, page: p.page_number })) ??
    [{ text: material.text, page: undefined }];
  const result: Array<{ quote: string; page_number?: number }> = [];
  for (const chunk of chunks) {
    // Choose entire source sentences/lines; never silently truncate file text.
    for (const line of chunk.text.split(/\n|(?<=[.!?])\s+/u)) {
      const quote = line.trim().replace(/^\[Page \d+\]\s*/, '');
      if (quote.length < 12 || Buffer.byteLength(quote, 'utf8') > 512 ||
          /(?:https?:\/\/|bearer\s+|authorization\s*:|password|api.?key|secret|token\s*[:=]|ignore\s+(?:previous|all)|system\s+prompt)/iu.test(quote))
        continue;
      result.push({ quote, ...(chunk.page ? { page_number: chunk.page } : {}) });
      if (result.length >= 32) return result;
    }
  }
  return result;
}
function evidenceFor(doc: Material, excerpt: { quote: string; page_number?: number }): SourceEvidence {
  return { document_id: doc.document_id, quote: excerpt.quote,
    ...(excerpt.page_number === undefined ? {} : { page_number: excerpt.page_number }) };
}
type Choice = { doc: Material; excerpt: { quote: string; page_number?: number }; score: number };
function choose(question: string, documents: readonly Material[]): Choice | null {
  const terms = [...new Set(tokenize(question))];
  if (!terms.length || terms.length > 30) return null;
  let best: Choice | null = null;
  for (const doc of documents) {
    for (const excerpt of candidates(doc)) {
      const words = new Set(tokenize(excerpt.quote));
      const hits = terms.filter(term => words.has(term)).length;
      const coverage = hits / terms.length;
      // Unsupported/off-topic clauses must not be answered merely because a
      // single incidental word overlaps a document.
      if (hits < Math.min(2, terms.length) || coverage < 0.5) continue;
      const score = hits * 10 + coverage;
      if (!best || score > best.score) best = { doc, excerpt, score };
    }
  }
  return best;
}
function envelope(text: string, selection?: Choice): string {
  return JSON.stringify({
    text,
    used_document_ids: selection ? [selection.doc.document_id] : [],
    evidence: selection ? [evidenceFor(selection.doc, selection.excerpt)] : [],
  });
}
/** No provider/model call, no web search and no history. The ONLY factual
 * narrative is a verbatim excerpt from a current authorized document; every
 * citation/page is revalidated by core before the HTTP response.
 */
export const strictDocumentChat: StrictDocumentChat = async (question, documents) => {
  const match = choose(question, documents);
  return match ? envelope('Document excerpt: ' + match.excerpt.quote, match) : envelope(REFUSAL);
};

type PromptDocument = { document_id: string; text: string };
function parsePrompt(prompt: string): { docs: PromptDocument[]; user: string; schema: unknown } {
  const prefix = 'SOURCE_DOCUMENTS (untrusted JSONL):\n';
  const historyDelim = '\nPRIOR_CHAT (untrusted):\n';
  const schemaDelim = '\nEXTRACTION_SCHEMA:\n';
  const userDelim = '\nUSER_INPUT:\n';
  if (!prompt.startsWith(prefix) || !prompt.includes(historyDelim) ||
      !prompt.includes(schemaDelim) || !prompt.includes(userDelim))
    throw new EofficeError(502, 'Unexpected bounded model input.', 'AI processing failed.');
  const source = prompt.slice(prefix.length, prompt.indexOf(historyDelim));
  const schemaStart = prompt.indexOf(schemaDelim) + schemaDelim.length;
  const userStart = prompt.indexOf(userDelim, schemaStart);
  const schemaRaw = prompt.slice(schemaStart, userStart);
  const docs: PromptDocument[] = [];
  try {
    for (const line of source.split('\n').filter(Boolean)) {
      const record: unknown = JSON.parse(line);
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw Error();
      const value = record as Record<string, unknown>;
      if (typeof value.document_id !== 'string' || typeof value.text !== 'string') throw Error();
      docs.push({ document_id: value.document_id, text: value.text });
    }
    if (docs.length > 4) throw Error();
    return { docs, user: prompt.slice(userStart + userDelim.length),
      schema: schemaRaw ? JSON.parse(schemaRaw) : undefined };
  } catch { throw new EofficeError(502, 'Invalid model input envelope.', 'AI processing failed.'); }
}
function firstSource(docs: PromptDocument[]): { doc: PromptDocument; quote: string } | undefined {
  for (const doc of docs) {
    const lines = candidates({ document_id: doc.document_id,
      title: 'internal', text: doc.text });
    if (lines.length) return { doc, quote: lines[0].quote };
  }
  return undefined;
}
function extractionValue(prop: unknown, property: string, docs: PromptDocument[]): {
  value: string | number | null; source?: PromptDocument; quote?: string
} {
  const types = typeof (prop as { type?: unknown }).type === 'string'
    ? [(prop as { type: string }).type]
    : (prop as { type?: unknown }).type;
  if (!Array.isArray(types)) return { value: null };
  if (types.includes('boolean')) return { value: null };
  for (const doc of docs) {
    for (const excerpt of candidates({ document_id: doc.document_id, title: 'internal', text: doc.text })) {
      const match = excerpt.quote.match(new RegExp('(?:^|\\s)' + property + '\\s*:\\s*([^;]+)', 'iu'));
      if (!match) continue;
      const literal = match[1].trim().replace(/[.!?]+$/, '');
      if (!literal) continue;
      if (types.includes('string')) return { value: literal, source: doc, quote: excerpt.quote };
      // Number(...) accepts hex, exponents, infinity-like text, whitespace,
      // leading zeros and plus prefixes that are NOT literal canonical values.
      // Require an unambiguous base-10 representation, without coercion.
      const canonicalNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(literal) &&
        literal !== '-0' && !/^(-?)0\d/.test(literal);
      const canonicalInteger = /^-?(?:0|[1-9]\d*)$/.test(literal) && literal !== '-0';
      if (!canonicalNumber) continue;
      const number = Number(literal);
      if (Number.isFinite(number) &&
          ((types.includes('integer') && canonicalInteger && Number.isSafeInteger(number)) ||
           (types.includes('number') && !Number.isNaN(number))))
        return { value: number, source: doc, quote: excerpt.quote };
    }
  }
  return { value: null };
}
/** Deliberate offline UAT subset: extract-only exact source passages and
 * deterministic drafting. This is NOT a semantic summarizer or production LLM.
 * Inference backend approval/retention is a separate stage.
 */
export const deterministicTaskModel: Model = async (system, prompt, _tokens, _timeout) => {
  const { docs, user, schema } = parsePrompt(prompt);
  if (system.startsWith('Extract only')) {
    const fields: Record<string, unknown> = {};
    const citations: Array<{ document_id: string; quote: string }> = [];
    const seen = new Set<string>();
    const properties = schema && typeof schema === 'object' &&
      'properties' in schema ? (schema as { properties: Record<string, unknown> }).properties : {};
    for (const [property, definition] of Object.entries(properties)) {
      const found = extractionValue(definition, property, docs);
      fields[property] = found.value;
      if (found.source && found.quote) {
        const key = JSON.stringify([found.source.document_id, found.quote]);
        if (!seen.has(key)) {
          // The core accepts a maximum of 16 evidence items. Failing loudly
          // is safer than silently dropping support for required fields.
          if (citations.length >= 16)
            throw new EofficeError(502, 'Extraction evidence exceeds supported limit.', 'AI processing failed.');
          citations.push({ document_id: found.source.document_id, quote: found.quote });
          seen.add(key);
        }
      }
    }
    return JSON.stringify({
      extracted_data: fields,
      used_document_ids: [...new Set(citations.map(citation => citation.document_id))],
      evidence: citations,
    });
  }
  const source = firstSource(docs);
  if (system.startsWith('Write a concise')) {
    if (source) return JSON.stringify({
      text: source.quote, used_document_ids: [source.doc.document_id],
      evidence: [{ document_id: source.doc.document_id, quote: source.quote }],
    });
    // For §2.2 text-only summary, user_input is the only provided source.
    const raw = user.replace(/^\s*(?:source text|source|document text)\s*:\s*/i, '').trim();
    const excerpt = raw.split('\n')[0]?.trim() ?? '';
    const text = excerpt.length > 0 && Buffer.byteLength(excerpt, 'utf8') <= 512
      ? excerpt : 'Unable to safely summarize the supplied source text.';
    return envelope(text);
  }
  // Drafts are proposals, not official communications or model-generated facts.
  if (source && system.startsWith('Write a proposed')) {
    return JSON.stringify({
      text: 'Draft for officer review:\nThe supplied document states: "' + source.quote +
        '"\nPlease verify all details before approval.',
      used_document_ids: [source.doc.document_id],
      evidence: [{ document_id: source.doc.document_id, quote: source.quote }],
    });
  }
  return envelope('Draft for officer review: Please provide the requested details. Verify facts before issuing a reply.');
};
