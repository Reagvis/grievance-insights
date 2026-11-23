import { EofficeError, isObject } from './schema';
import type { Material } from './documents';

export type SourceEvidence = { document_id: string; quote: string; page_number?: number };
export type SourceReference = { document_id: string; title: string; page_number?: number };

const MAX_EVIDENCE = 16;
const MAX_QUOTE_BYTES = 512;
const failure = (reason: string) => new EofficeError(502, reason, 'AI processing failed.');
const normalize = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
const hasQuote = (source: string, quote: string): boolean => normalize(source).includes(normalize(quote));
const numbers = (text: string): string[] => text.match(/\d+(?:[.,/-]\d+)*/g) ?? [];
/** Require an extracted literal to be a distinct value, not a substring of a
 * longer word or number (for example 7 inside 17, or 'approved' in 'unapproved').
 */
function literalInExcerpt(excerpt: string, value: unknown): boolean {
  const text = normalize(excerpt);
  const literal = normalize(String(value));
  if (!literal) return false;
  let at = text.indexOf(literal);
  while (at >= 0) {
    const before = at ? text[at - 1] : '';
    const after = text[at + literal.length] ?? '';
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
    at = text.indexOf(literal, at + 1);
  }
  return false;
}


/** Enforce a short verbatim source excerpt for every document in an attribution list.
 * These are internal model attestations, not a new public eOffice response field.
 * Exact excerpt checks reduce arbitrary source attribution; they do not prove that
 * the answer's full semantic claim follows from the evidence.
 */
export function verifySourceEvidence(
  raw: unknown, ids: readonly string[], documents: readonly Material[],
): { references: SourceReference[]; quotes: string[] } {
  if (raw === undefined && ids.length === 0) return { references: [], quotes: [] };
  if (!Array.isArray(raw) || raw.length > MAX_EVIDENCE ||
      (ids.length > 0 && raw.length < ids.length) || (ids.length === 0 && raw.length !== 0))
    throw failure('Missing or excessive grounded source evidence.');
  const byId = new Map(documents.map(d => [d.document_id, d]));
  const claimed = new Set(ids);
  const located = new Map<string, Array<number | undefined>>();
  const quotes: string[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || Object.keys(entry).some(k => !['document_id', 'quote', 'page_number'].includes(k)) ||
        typeof entry.document_id !== 'string' || !claimed.has(entry.document_id) ||
        typeof entry.quote !== 'string' || Buffer.byteLength(entry.quote, 'utf8') > MAX_QUOTE_BYTES ||
        entry.quote.trim().length < 12 ||
        (entry.page_number !== undefined && (!Number.isSafeInteger(entry.page_number) || (entry.page_number as number) < 1)))
      throw failure('Invalid source evidence structure.');
    const doc = byId.get(entry.document_id);
    if (!doc) throw failure('Unrecognized source evidence document.');
    const quote = entry.quote as string;
    if (!hasQuote(doc.text, quote)) throw failure('Source evidence was not found in the attributed document.');
    // If the same excerpt occurs in another attached document, source attribution
    // to one of them is ambiguous. Require a more discriminating excerpt.
    if (documents.some(other => other.document_id !== doc.document_id && hasQuote(other.text, quote)))
      throw failure('Evidence does not distinguish the cited document.');
    let page: number | undefined;
    if (doc.pages?.length) {
      const matching = doc.pages.filter(p => hasQuote(p.text, quote));
      if (entry.page_number !== undefined) {
        if (!matching.some(p => p.page_number === entry.page_number))
          throw failure('Cited page does not contain the quoted evidence.');
        page = entry.page_number as number;
      } else if (matching.length === 1) page = matching[0].page_number;
      else if (!matching.length) throw failure('Source evidence crosses or misses PDF page boundaries.');
    } else if (entry.page_number !== undefined) {
      throw failure('Source page cannot be verified for this document.');
    }
    const pages = located.get(doc.document_id) ?? [];
    pages.push(page);
    located.set(doc.document_id, pages);
    quotes.push(quote);
  }
  if (ids.some(id => !located.has(id))) throw failure('Cited document lacks source evidence.');
  const references = ids.map(id => {
    const doc = byId.get(id);
    if (!doc) throw failure('Cited document is not attached.');
    const positions = located.get(id)!;
    // A multi-page answer must not be assigned an arbitrary single page.
    const page = positions.length && positions.every(p => p !== undefined && p === positions[0])
      ? positions[0] : undefined;
    return { document_id: id, title: doc.title, ...(page === undefined ? {} : { page_number: page }) };
  });
  return { references, quotes };
}

/** Bounded, deterministic guard against invented explicit amounts/dates in
 * document-grounded prose. Interpretive claims still need human review.
 */
export function verifyNarrativeNumbers(text: string, evidence: readonly string[], userInput: string): void {
  const allowed = new Set(numbers(evidence.join(' ') + ' ' + userInput));
  // Markdown list ordinals are formatting, not factual amounts or dates.
  const prose = text.replace(/^\s*\d{1,3}[.)]\s+/gm, '');
  for (const token of numbers(prose)) {
    if (!allowed.has(token)) throw failure('A factual number lacks explicit supplied support.');
  }
}

/** Schema validation occurs separately. The supported extraction subset additionally
 * requires each non-null scalar to be explicitly represented in a cited document.
 * No inferred/reformatted dates, amounts or boolean conclusions are accepted.
 */
export function verifyExtractedFacts(
  extracted: Record<string, unknown>, citedQuotes: readonly string[],
): void {
  for (const value of Object.values(extracted)) {
    if (value === null) continue;
    // A cited document containing the value somewhere is insufficient: the
    // model-selected quote must explicitly contain the separate literal value.
    if (!citedQuotes.some(quote => literalInExcerpt(quote, value)))
      throw failure('An extracted value is not explicitly present in cited evidence.');
  }
}

/** Reject protected hosts even if the model rewrites/percent-encodes a URL.
 * Outbound URLs not present in the officer's prompt are not independently
 * trusted, since this module does not enable an authorized knowledge service.
 */
export function verifyNoProtectedLinks(
  output: string, documents: readonly { download_url: string }[], userInput: string,
): void {
  let candidate = output;
  for (let pass = 0; pass < 2; pass++) {
    try { candidate = decodeURIComponent(candidate); }
    catch {
      // Preserve percent-encoded ASCII URLs even when a separate, malformed
      // percent sign elsewhere would make decodeURIComponent reject the string.
      candidate = candidate.replace(/%([0-7][0-9a-f])/gi, (_whole, byte: string) =>
        String.fromCharCode(parseInt(byte, 16)));
    }
  }
  const lower = candidate.toLocaleLowerCase('en-US');
  for (const document of documents) {
    let url: URL;
    try { url = new URL(document.download_url); } catch { continue; }
    if (lower.includes(url.hostname.toLocaleLowerCase('en-US')) ||
        lower.includes(document.download_url.toLocaleLowerCase('en-US')) ||
        (url.pathname.length >= 8 && lower.includes(url.pathname.toLocaleLowerCase('en-US'))) ||
        [...url.searchParams.values()].some(value => value.length >= 6 &&
          lower.includes(value.toLocaleLowerCase('en-US'))))
      throw failure('Protected source address or token appeared in AI output.');
  }
  for (const match of candidate.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    if (!userInput.includes(match[0])) throw failure('AI generated an unverified external URL.');
  }
}
