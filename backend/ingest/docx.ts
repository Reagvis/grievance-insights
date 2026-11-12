import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { IngestError, LIMITS } from './limits';

/**
 * Safe DOCX text extraction.
 *
 * A .docx is an untrusted ZIP of XML. Defences:
 *  - only `[Content_Types].xml` and `word/document.xml` are ever inflated; every other entry is skipped unread;
 *  - inflation is streamed and aborted the moment it passes a hard byte cap, whatever the (forgeable) headers claim;
 *  - entry count, compression ratio and entry names are checked; encrypted entries are rejected;
 *  - DOCTYPE / ENTITY declarations are rejected outright, so no entity expansion can happen;
 *  - the XML is read by a small tag scanner, never handed to an XML engine that could resolve external resources.
 */

const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function readEntries(data: Uint8Array): Map<string, Uint8Array> {
  const wanted = new Set(['[Content_Types].xml', 'word/document.xml']);
  const caps: Record<string, number> = { '[Content_Types].xml': 256 * 1024, 'word/document.xml': LIMITS.docx.documentXmlBytes };
  const found = new Map<string, Uint8Array>();
  let entries = 0;
  let failure: IngestError | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file: UnzipFile) => {
    if (failure) return;
    entries += 1;
    if (entries > LIMITS.docx.entries) {
      failure = new IngestError('The .docx archive has too many entries.', 'limit');
      return;
    }
    const name = file.name;
    if (name.startsWith('/') || name.includes('..') || name.includes('\\') || name.includes('\0')) {
      failure = new IngestError('The .docx archive contains unsafe file names.', 'corrupt');
      return;
    }
    if (!wanted.has(name)) return; // never inflated
    const cap = caps[name];
    const chunks: Uint8Array[] = [];
    let total = 0;
    const compressed = Math.max(1, file.size ?? 1);
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = new IngestError('The .docx archive is corrupt.', 'corrupt');
        return;
      }
      total += chunk.length;
      if (total > cap || (file.size && total / compressed > LIMITS.docx.maxRatio && total > 1024 * 1024)) {
        failure = new IngestError('The .docx archive expands too much and was rejected as unsafe.', 'limit');
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.length;
        }
        found.set(name, out);
      }
    };
    file.start();
  };
  try {
    // Feed in modest slices so a bomb is stopped between slices, not after one giant inflate.
    const SLICE = 64 * 1024;
    for (let at = 0; at < data.length && !failure; at += SLICE) unzip.push(data.subarray(at, Math.min(at + SLICE, data.length)), at + SLICE >= data.length);
  } catch {
    throw failure ?? new IngestError('The .docx file is corrupt or not a valid Word document.', 'corrupt');
  }
  if (failure) throw failure;
  return found;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

export type DocxText = { text: string; paragraphs: number; tables: number };

/** Word body text. Tables become lines "cell | cell"; two-cell rows with a known label become "Label: value". */
export function extractDocxText(data: Uint8Array, isLabel: (label: string) => boolean): DocxText {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw new IngestError('This file is not a .docx (it is not a ZIP archive).', 'content_mismatch');
  const entries = readEntries(data);
  const types = entries.get('[Content_Types].xml');
  const body = entries.get('word/document.xml');
  if (!types || !body) throw new IngestError('This is not a Word document (word/document.xml is missing).', 'content_mismatch');
  const typesXml = new TextDecoder('utf-8').decode(types);
  if (!typesXml.includes(WORD_MAIN)) throw new IngestError('This is not a Word document (unexpected content type).', 'content_mismatch');
  let xml = new TextDecoder('utf-8').decode(body);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new IngestError('The .docx contains unsafe XML declarations and was rejected.', 'invalid_content');
  // Alternate content stores the same text twice (modern + fallback); keep one copy.
  xml = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');

  // Alternative 1: a text run <w:t>…</w:t>. Alternative 2: structural tags. Deleted text (<w:delText>) is deliberately not matched.
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<(\/?)w:(p|tbl|tr|tc|tab|br|cr|noBreakHyphen)(?=[\s/>])[^>]*?(\/?)>/g;
  type Cell = string[];
  const lines: string[] = [];
  let paragraphs = 0;
  let tables = 0;
  // Stack of open table contexts so nested tables don't corrupt their parent's cells.
  const tableStack: Array<{ rows: Cell[][]; row: Cell[] | null; cell: string[] | null }> = [];
  let para: string[] | null = null;
  const sink = (text: string) => {
    if (para) para.push(text);
  };
  const closePara = () => {
    if (!para) return;
    const text = para.join('');
    para = null;
    paragraphs += 1;
    const ctx = tableStack[tableStack.length - 1];
    if (ctx?.cell) ctx.cell.push(text);
    else lines.push(text);
  };
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml))) {
    if (m[1] !== undefined) {
      sink(decodeEntities(m[1]));
      continue;
    }
    const closing = m[2] === '/';
    const tag = m[3];
    const selfClosing = m[4] === '/';
    if (tag === 'p') {
      if (!closing) {
        para = [];
        if (selfClosing) closePara();
      } else closePara();
    } else if (tag === 'tab' && !closing) sink('\t');
    else if ((tag === 'br' || tag === 'cr') && !closing) sink('\n');
    else if (tag === 'noBreakHyphen' && !closing) sink('-');
    else if (tag === 'tbl') {
      if (!closing) tableStack.push({ rows: [], row: null, cell: null });
      else {
        const t = tableStack.pop();
        if (t) {
          tables += 1;
          for (const row of t.rows) {
            const cells = row.map((c) => c.join(' ').replace(/\s+/g, ' ').trim());
            if (cells.every((c) => !c)) continue;
            const text =
              cells.length === 2 && cells[0] && isLabel(cells[0].replace(/[:：]\s*$/, '')) ? cells[0].replace(/[:：]\s*$/, '') + ': ' + cells[1] : cells.filter((c) => c).join(' | ');
            const outer = tableStack[tableStack.length - 1];
            if (outer?.cell) outer.cell.push(text);
            else lines.push(text);
          }
        }
      }
    } else if (tag === 'tr') {
      const t = tableStack[tableStack.length - 1];
      if (t) {
        if (!closing) t.row = [];
        else if (t.row) {
          t.rows.push(t.row);
          t.row = null;
        }
      }
    } else if (tag === 'tc') {
      const t = tableStack[tableStack.length - 1];
      if (t) {
        if (!closing) t.cell = [];
        else if (t.cell) {
          t.row?.push(t.cell);
          t.cell = null;
        }
      }
    }
  }
  closePara();
  const text = lines.join('\n');
  return { text, paragraphs, tables };
}
