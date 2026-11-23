import { lookup } from 'node:dns/promises';
import { get as httpsGet } from 'node:https';
import { extractDocxText } from '../ingest/docx';
import { extractPdfPages } from '../ingest/pdf';
import { EofficeError, bounded } from './schema';

export type DocumentRef = { document_id: string; download_url: string };
export type Material = { document_id: string; title: string; text: string; page_number?: number };
export interface DocumentSource { fetch(document: DocumentRef): Promise<Material>; }
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TEXT = 24000;
function publicIp(address: string): boolean {
  if (address.includes(':')) {
    const ip = address.toLowerCase();
    return !(/^(::|::1$|fc|fd|fe[89ab]|ff|2001:db8)/.test(ip) || ip.startsWith('::ffff:'));
  }
  const a = address.split('.').map(Number);
  return a.length === 4 && a.every(x => Number.isInteger(x) && x >= 0 && x <= 255) &&
    a[0] !== 0 && a[0] !== 10 && a[0] !== 127 && a[0] < 224 &&
    !(a[0] === 169 && a[1] === 254) && !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) &&
    !(a[0] === 192 && a[1] === 168) && !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
    !(a[0] === 192 && a[1] === 0) && !(a[0] === 198 && (a[1] === 18 || a[1] === 19));
}
export function safeUrl(input: string, allowedHosts: Set<string>): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new EofficeError(422, 'Invalid document URL.', 'The requested document is unavailable.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedHosts.has(url.hostname.toLowerCase()) ||
      !/^[a-z0-9.-]+$/i.test(url.hostname)) throw new EofficeError(422, 'Untrusted document URL.', 'The requested document is unavailable.');
  return url;
}
/** TLS connection is DNS-pinned to the vetted public address; redirects are forbidden. */
export class HttpsDocuments implements DocumentSource {
  constructor(private readonly allowedHosts: Set<string>, private readonly requestHeaders: () => Record<string, string> = () => ({})) {}
  async fetch(document: DocumentRef): Promise<Material> {
    const url = safeUrl(document.download_url, this.allowedHosts);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || !addresses.every(entry => publicIp(entry.address))) throw new EofficeError(422, 'Document host resolves to a blocked address.', 'The requested document is unavailable.');
    const chosen = addresses[0];
    const data = await new Promise<{ bytes: Uint8Array; contentType: string }>((resolve, reject) => {
      const fail = () => reject(new EofficeError(422, 'Protected document fetch failed.', 'The requested document is unavailable.'));
      const req = httpsGet(url, {
        timeout: 10000,
        headers: this.requestHeaders(),
        lookup: (_host, _opts, cb) => cb(null, chosen.address, chosen.family),
      }, res => {
        if (res.statusCode !== 200 || Number(res.headers['content-length'] ?? 0) > MAX_FILE) {
          res.destroy();
          fail();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_FILE) { res.destroy(); fail(); }
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({
          bytes: Buffer.concat(chunks, size),
          contentType: String(res.headers['content-type'] ?? ''),
        }));
        res.on('error', fail);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', fail);
    });
    try { return await extractDocument(document, data.bytes, data.contentType); }
    catch (error) {
      if (error instanceof EofficeError) throw error;
      throw new EofficeError(422, 'Document extraction failed.', 'The requested document is unreadable.');
    }
  }
}
/** Validated bytes from a trusted, DNS-pinned HTTPS transport. No file persistence. */
export async function extractDocument(document: DocumentRef, bytes: Uint8Array, contentType: string): Promise<Material> {
  if (!bytes.length || bytes.length > MAX_FILE) throw new EofficeError(422, 'Document exceeds supported size.', 'The requested document is unsupported.');
  const mime = contentType.split(';')[0].toLowerCase().trim();
  let text: string;
  let page_number: number | undefined;
  if (mime === 'text/plain' || mime === 'text/markdown') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = extractDocxText(bytes, () => false).text;
  } else if (mime === 'application/pdf') {
    const pages = await extractPdfPages(bytes);
    if (pages.pages.some(p => p.kind !== 'text')) throw new EofficeError(422, 'PDF requires OCR outside synchronous scope.', 'The document cannot be processed synchronously.');
    text = pages.pages.map(p => '[Page ' + p.page + ']\n' + p.text).join('\n');
    page_number = pages.pages.length === 1 ? 1 : undefined;
  } else throw new EofficeError(422, 'Unsupported document type.', 'The document format is unsupported.');
  if (!bounded(text, MAX_TEXT)) throw new EofficeError(422, 'Empty or excessively long extracted document.', 'The document exceeds synchronous processing limits.');
  return { document_id: document.document_id, title: document.document_id, text, ...(page_number ? { page_number } : {}) };
}
export const documentLimits = { maxFileBytes: MAX_FILE, maxTextBytes: MAX_TEXT };
