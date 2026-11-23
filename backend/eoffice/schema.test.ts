import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseSchema, validateExtraction } from './schema';
import { HttpsDocuments, safeUrl, extractDocument } from './documents';
import type { Principal } from './core';

const doc = { document_id: 'doc1', download_url: 'https://a.example.gov/temp/123' };
const a: Principal = { department: 'a', officer: 'officerA', permissions: ['chat'] };
const b: Principal = { department: 'b', officer: 'officerB', permissions: ['chat'] };
const deadline = () => Date.now() + 12000;

describe('schema and secure document boundaries', () => {
  it('rejects unimplemented JSON Schema features', () => {
    expect(() => parseSchema({ type: 'object', properties: { x: { type: 'string', enum: ['a'] } }, required: ['x'] })).toThrow();
  });
  it('preserves nullable optional fields and classifies missing required vs malformed values', () => {
    const schema = parseSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: ['boolean', 'null'] } }, required: ['a'] });
    expect(validateExtraction(schema, { a: 'yes' })).toEqual({ a: 'yes', b: null });
    expect(() => validateExtraction(schema, {})).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => validateExtraction(schema, { a: 123 })).toThrow(expect.objectContaining({ status: 502 }));
  });
  it('permits only allowlisted protected HTTPS URLs', () => {
    const hosts = new Set(['a.example.gov']);
    expect(safeUrl(doc.download_url, hosts).hostname).toBe('a.example.gov');
    for (const bad of ['http://a.example.gov/temp/a', 'https://127.0.0.1/', 'https://a.example.gov.evil.com/', 'https://user:pass@a.example.gov/file', 'https://a.example.gov:8443/f']) {
      expect(() => safeUrl(bad, hosts)).toThrow();
    }
  });
  it('enforces separate per-tenant protected-file headers, hosts and no shared credential cache', async () => {
    const received: string[] = [];
    const getAccess = vi.fn(async (p: Principal) => ({
      allowedHosts: new Set([p.department + '.example.gov']),
      headers: { Authorization: 'token-for-' + p.department },
    }));
    const download = vi.fn(async (url: URL, ip: { address: string }, headers: Readonly<Record<string, string>>, timeoutMs: number) => {
      expect(ip.address).toBe('8.8.8.8');
      expect(timeoutMs).toBeGreaterThan(0);
      received.push(url.hostname + ':' + headers.Authorization);
      return { bytes: new TextEncoder().encode('The policy contains 3 clauses.'), contentType: 'text/plain; charset=utf-8' };
    });
    const source = new HttpsDocuments(getAccess, async () => [{ address: '8.8.8.8', family: 4 }], download);
    for (const p of [a, b, a]) {
      const r = await source.fetch({ ...doc, download_url: 'https://' + p.department + '.example.gov/temp/123' }, p, deadline());
      expect(r.text).toContain('3 clauses');
    }
    expect(received).toEqual(['a.example.gov:token-for-a', 'b.example.gov:token-for-b', 'a.example.gov:token-for-a']);
    expect(getAccess).toHaveBeenCalledTimes(3);
    await expect(source.fetch(doc, b, deadline())).rejects.toMatchObject({ status: 422 });
    expect(download).toHaveBeenCalledTimes(3);
  });
  it('rejects private, loopback, and IPv4-mapped IPv6 DNS answers before downloads', async () => {
    for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '::ffff:8.8.8.8', '203.0.113.1']) {
      const download = vi.fn();
      const source = new HttpsDocuments(
        async () => ({ allowedHosts: new Set(['a.example.gov']), headers: {} }),
        async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        download,
      );
      await expect(source.fetch(doc, a, deadline())).rejects.toMatchObject({ status: 422 });
      expect(download).not.toHaveBeenCalled();
    }
  });
  it('rejects expired synchronous deadlines before network access', async () => {
    const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }]);
    const source = new HttpsDocuments(async () => ({ allowedHosts: new Set(['a.example.gov']), headers: {} }), resolver);
    await expect(source.fetch(doc, a, Date.now() - 1)).rejects.toMatchObject({ status: 503 });
    expect(resolver).not.toHaveBeenCalled();
  });
  it('rejects unsafe credential header values without sending requests', async () => {
    const download = vi.fn();
    const source = new HttpsDocuments(
      async () => ({ allowedHosts: new Set(['a.example.gov']), headers: { Authorization: 'bad\r\nInjected: yes' } }),
      async () => [{ address: '8.8.8.8', family: 4 }],
      download,
    );
    await expect(source.fetch(doc, a, deadline())).rejects.toMatchObject({ status: 503 });
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects oversized, invalid-UTF8, unsupported, or mislabeled files', async () => {
    await expect(extractDocument(doc, new Uint8Array(3 * 1024 * 1024), 'text/plain')).rejects.toThrow();
    await expect(extractDocument(doc, new Uint8Array([1, 2, 3]), 'application/octet-stream')).rejects.toThrow();
    await expect(extractDocument(doc, new Uint8Array([0xff]), 'text/plain')).rejects.toThrow();
    await expect(extractDocument(doc, new TextEncoder().encode('hello'), 'text/plain; charset=latin1')).rejects.toMatchObject({ status: 422 });
    await expect(extractDocument(doc, new TextEncoder().encode('hello'), 'application/pdf')).rejects.toThrow();
  });
  it('reuses the existing searchable PDF parser and rejects OCR-dependent PDFs synchronously', async () => {
    const searchable = readFileSync(new URL('../ingest/fixtures/searchable-english-3page.pdf', import.meta.url));
    const pages = await extractDocument(doc, searchable, 'application/pdf');
    expect(pages.text).toContain('[Page 1]');
    const scanned = readFileSync(new URL('../ingest/fixtures/scanned-telugu-2page.pdf', import.meta.url));
    await expect(extractDocument(doc, scanned, 'application/pdf')).rejects.toMatchObject({ status: 422 });
    const encrypted = readFileSync(new URL('../ingest/fixtures/encrypted.pdf', import.meta.url));
    await expect(extractDocument(doc, encrypted, 'application/pdf')).rejects.toThrow();
  });
});
