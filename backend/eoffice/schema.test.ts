import { describe, expect, it } from 'vitest';
import { parseSchema, validateExtraction } from './schema';
import { safeUrl, extractDocument } from './documents';
describe('schema and secure ingestion boundaries', () => {
  it('rejects unimplemented JSON Schema features', () => {
    expect(() => parseSchema({ type: 'object', properties: { x: { type: 'string', enum: ['a'] } }, required: ['x'] })).toThrow();
  });
  it('rejects missing required values and preserves optional null', () => {
    const schema = parseSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: ['boolean', 'null'] } }, required: ['a'] });
    expect(validateExtraction(schema, { a: 'yes' })).toEqual({ a: 'yes', b: null });
    expect(() => validateExtraction(schema, {})).toThrow();
  });
  it('only permits allowlisted HTTPS hosts', () => {
    const hosts = new Set(['eoffice.example.gov']);
    expect(safeUrl('https://eoffice.example.gov/temp/a', hosts).hostname).toBe('eoffice.example.gov');
    for (const bad of ['http://eoffice.example.gov/temp/a', 'https://127.0.0.1/', 'https://eoffice.example.gov.evil.com/', 'https://user:pass@eoffice.example.gov/file']) {
      expect(() => safeUrl(bad, hosts)).toThrow();
    }
  });
  it('rejects oversized files and invalid file formats', async () => {
    const ref = { document_id: 'doc1', download_url: 'https://eoffice.example.gov/temp/x' };
    await expect(extractDocument(ref, new Uint8Array(3 * 1024 * 1024), 'text/plain')).rejects.toThrow();
    await expect(extractDocument(ref, new Uint8Array([1,2,3]), 'application/octet-stream')).rejects.toThrow();
  });
});
