import { lookup } from 'node:dns/promises';
import { get as httpsGet } from 'node:https';
import { isIP } from 'node:net';
import { extractDocxText } from '../ingest/docx';
import { extractPdfPages } from '../ingest/pdf';
import { EofficeError, bounded } from './schema';
import type { Principal } from './core';

export type DocumentRef = { document_id: string; download_url: string };
export type Material = { document_id: string; title: string; text: string; page_number?: number };
/** The caller is a trusted authorization result, never the user_id from JSON. */
export interface DocumentSource { fetch(document: DocumentRef, principal: Principal, deadline: number): Promise<Material>; }
export type DocumentAccess = {
  allowedHosts: ReadonlySet<string>;
  headers: Readonly<Record<string, string>>;
};
type Address = { address: string; family: 4 | 6 };
type Resolver = (hostname: string) => Promise<readonly Address[]>;
type Transport = (url: URL, ip: Address, headers: Readonly<Record<string, string>>, timeoutMs: number) =>
  Promise<{ bytes: Uint8Array; contentType: string }>;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TEXT = 24000;
function publicIp(address: string): boolean {
  // IPv6, including IPv4-mapped IPv6, is denied until a vetted IPv6 egress policy exists.
  if (isIP(address) !== 4) return false;
  const a = address.split('.').map(Number);
  return a[0] !== 0 && a[0] !== 10 && a[0] !== 127 && a[0] < 224 &&
    !(a[0] === 169 && a[1] === 254) &&
    !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) &&
    !(a[0] === 192 && a[1] === 168) &&
    !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
    !(a[0] === 192 && a[1] === 0 && a[2] === 0) &&
    !(a[0] === 192 && a[1] === 0 && a[2] === 2) &&
    !(a[0] === 192 && a[1] === 88 && a[2] === 99) &&
    !(a[0] === 198 && (a[1] === 18 || a[1] === 19)) &&
    !(a[0] === 198 && a[1] === 51 && a[2] === 100) &&
    !(a[0] === 203 && a[1] === 0 && a[2] === 113);
}
export function safeUrl(input: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new EofficeError(422, 'Invalid document URL.', 'The requested document is unavailable.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !allowedHosts.has(url.hostname.toLowerCase()) || !/^[a-z0-9.-]+$/i.test(url.hostname))
    throw new EofficeError(422, 'Untrusted document URL.', 'The requested document is unavailable.');
  return url;
}
function safeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[a-z0-9-]{1,64}$/i.test(key) ||
      /^(?:host|connection|content-length|transfer-encoding|proxy-authorization|cookie|upgrade)$/i.test(key) ||
      typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value))
      throw new EofficeError(503, 'Invalid protected-file access configuration.', 'Document retrieval is unavailable.');
    result[key] = value;
  }
  return result;
}
/** Node HTTPS does not automatically follow redirects. The address is pinned while TLS verifies the original hostname. */
const pinnedHttpsGet: Transport = (url, ip, headers, timeoutMs) => new Promise((resolve, reject) => {
  const fail = () => reject(new EofficeError(422, 'Protected document fetch failed.', 'The requested document is unavailable.'));
  const req = httpsGet(url, {
    timeout: timeoutMs,
    headers,
    servername: url.hostname,
    lookup: (_host, _opts, callback) => callback(null, ip.address, ip.family),
  }, res => {
    const advertised = res.headers['content-length'];
    const length = advertised === undefined ? 0 : Number(advertised);
    if (res.statusCode !== 200 || !Number.isSafeInteger(length) || length < 0 || length > MAX_FILE) {
      res.destroy();
      fail();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let ended = false;
    res.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_FILE) { res.destroy(); fail(); }
      else chunks.push(chunk);
    });
    res.on('end', () => {
      ended = true;
      resolve({ bytes: Buffer.concat(chunks, total), contentType: String(res.headers['content-type'] ?? '') });
    });
    res.on('close', () => { if (!ended) fail(); });
    res.on('error', fail);
  });
  req.on('timeout', () => req.destroy());
  req.on('error', fail);
});
const defaultResolver: Resolver = hostname => lookup(hostname, { all: true, verbatim: true });
/**
 * No process-global credentials or tenant-wide static headers: access is resolved independently for
 * each authenticated principal. Use no access resolver until the official government protocol arrives.
 * Resolver and transport injection are for deterministic SSRF/network regression tests.
 */
export class HttpsDocuments implements DocumentSource {
  constructor(
    private readonly accessFor: (principal: Principal) => Promise<DocumentAccess>,
    private readonly resolveHost: Resolver = defaultResolver,
    private readonly download: Transport = pinnedHttpsGet,
  ) {}
  async fetch(document: DocumentRef, principal: Principal, deadline: number): Promise<Material> {
    const access = await this.accessFor(principal);
    const url = safeUrl(document.download_url, access.allowedHosts);
    const timeoutMs = Math.min(8000, deadline - Date.now());
    if (timeoutMs < 1) throw new EofficeError(503, 'Document retrieval deadline expired.', 'Document retrieval timed out.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let addresses: readonly Address[];
    try {
      addresses = await Promise.race([
        this.resolveHost(url.hostname).catch(() => [] as Address[]),
        new Promise<readonly Address[]>(resolve => {
          timer = setTimeout(() => resolve([]), timeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    if (!addresses.length || !addresses.every(entry => entry.family === 4 && publicIp(entry.address)))
      throw new EofficeError(422, 'Document host resolves to a blocked address.', 'The requested document is unavailable.');
    const remaining = Math.min(8000, deadline - Date.now());
    if (remaining < 1) throw new EofficeError(503, 'Document download deadline expired.', 'Document retrieval timed out.');
    const result = await this.download(url, addresses[0], safeHeaders(access.headers), remaining);
    try { return await extractDocument(document, result.bytes, result.contentType); }
    catch (error) {
      if (error instanceof EofficeError) throw error;
      throw new EofficeError(422, 'Document extraction failed.', 'The requested document is unreadable.');
    }
  }
}
/** Extracts bounded UTF-8 text only. No original files reach Bedrock, and no temporary file is stored. */
export async function extractDocument(document: DocumentRef, bytes: Uint8Array, contentType: string): Promise<Material> {
  if (!bytes.length || bytes.length > MAX_FILE) throw new EofficeError(422, 'Document exceeds supported size.', 'The requested document is unsupported.');
  const mime = contentType.split(';')[0].toLowerCase().trim();
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];
  if ((mime === 'text/plain' || mime === 'text/markdown') && charset && charset.toLowerCase() !== 'utf-8')
    throw new EofficeError(422, 'Unsupported text charset.', 'The requested document is unsupported.');
  let text: string;
  let page_number: number | undefined;
  if (mime === 'text/plain' || mime === 'text/markdown') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = extractDocxText(bytes, () => false).text;
  } else if (mime === 'application/pdf') {
    const pages = await extractPdfPages(bytes);
    if (pages.pages.some(p => p.kind !== 'text'))
      throw new EofficeError(422, 'PDF requires OCR outside synchronous scope.', 'The document cannot be processed synchronously.');
    text = pages.pages.map(p => '[Page ' + p.page + ']\n' + p.text).join('\n');
    page_number = pages.pages.length === 1 ? 1 : undefined;
  } else throw new EofficeError(422, 'Unsupported document type.', 'The document format is unsupported.');
  if (!bounded(text, MAX_TEXT))
    throw new EofficeError(422, 'Empty or excessively long extracted document.', 'The document exceeds synchronous processing limits.');
  return { document_id: document.document_id, title: document.document_id, text, ...(page_number ? { page_number } : {}) };
}
export const documentLimits = { maxFileBytes: MAX_FILE, maxTextBytes: MAX_TEXT };
