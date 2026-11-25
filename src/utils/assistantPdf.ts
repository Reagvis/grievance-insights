import { strToU8 } from 'fflate';
import { pageSize, type Block, type Orientation, type Run } from './assistantDocument';

type SizedRun = Run & { width: number };
type Line = { runs: SizedRun[]; width: number };
export type PdfLine = Line & { x: number; y: number; size: number };
type Box = { x: number; y: number; width: number; height: number; header: boolean };
export type PdfPage = { lines: PdfLine[]; boxes: Box[] };
export type Measure = (run: Run, size: number) => number;
const margin = 54;
const maxPages = 100;
const segmenter = new Intl.Segmenter('te', { granularity: 'grapheme' });

function wrap(runs: Run[], width: number, size: number, measure: Measure): Line[] {
  const lines: Line[] = [];
  let line: Line = { runs: [], width: 0 };
  const flush = () => { lines.push(line); line = { runs: [], width: 0 }; };
  const add = (r: Run) => {
    const prev = line.runs.at(-1);
    if (prev && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic) {
      const joined = { ...prev, text: prev.text + r.text };
      const w = measure(joined, size);
      if (line.width - prev.width + w <= width) {
        line.width += w - prev.width; prev.text = joined.text; prev.width = w; return;
      }
    }
    const w = measure(r, size);
    if (line.runs.length && line.width + w > width) flush();
    line.runs.push({ ...r, width: w }); line.width += w;
  };
  for (const run of runs) {
    for (const token of run.text.match(/\s+|\S+/gu) ?? []) {
      const r = { ...run, text: token };
      if (measure(r, size) <= width) add(r);
      else for (const { segment } of segmenter.segment(token)) {
        const part = { ...run, text: segment };
        if (measure(part, size) > width) throw new Error('A character or table column is too wide for the selected layout. Try landscape.');
        add(part);
      }
    }
  }
  if (line.runs.length || !lines.length) flush();
  return lines;
}

export function layoutAssistantPdf(blocks: Block[], orientation: Orientation, measure: Measure): PdfPage[] {
  const { width, height } = pageSize(orientation);
  const usable = width - 2 * margin;
  const pages: PdfPage[] = [];
  let page: PdfPage;
  let y = margin;
  const next = () => {
    if (pages.length >= maxPages) throw new Error('This answer exceeds the 100-page PDF limit. Export Word or ask for shorter sections.');
    page = { lines: [], boxes: [] }; pages.push(page); y = margin;
  };
  next();
  const ensure = (h: number) => { if (y + h > height - margin) next(); };
  const write = (runs: Run[], size: number, indent = 0, gap = 0) => {
    const step = size * 1.65;
    for (const line of wrap(runs, usable - indent, size, measure)) {
      ensure(step);
      page.lines.push({ ...line, size, x: margin + indent, y: y + size });
      y += step;
    }
    y += gap;
  };
  for (const b of blocks) {
    if (b.kind === 'heading') {
      const size = Math.max(12, 19 - b.level);
      ensure(size * 1.65 + 22);
      write(b.runs.map(r => ({ ...r, bold: true })), size, 0, 5);
    } else if (b.kind === 'paragraph') {
      for (const line of b.lines) write(line, 11);
      y += 7;
    } else if (b.kind === 'list') {
      for (const item of b.items) write([{ text: item.marker + '  ' }, ...item.runs], 11, 12, 2);
      y += 5;
    } else {
      const col = usable / b.rows[0].length;
      if (col < 24) throw new Error('This table has too many columns for PDF. Try landscape or Word.');
      const size = 10, step = 17, pad = 5;
      for (let ri = 0; ri < b.rows.length; ri++) {
        const row = b.rows[ri].map(cell => wrap(cell.map(r => ({ ...r, bold: ri === 0 || r.bold })), col - 2 * pad, size, measure));
        const count = Math.max(...row.map(c => c.length));
        let offset = 0;
        while (offset < count) {
          ensure(step + 2 * pad);
          const take = Math.min(count - offset, Math.floor((height - margin - y - 2 * pad) / step));
          const h = take * step + 2 * pad;
          row.forEach((lines, ci) => {
            const x = margin + col * ci;
            page.boxes.push({ x, y, width: col, height: h, header: ri === 0 });
            lines.slice(offset, offset + take).forEach((line, li) => page.lines.push({
              ...line, x: x + pad, y: y + pad + li * step + size, size,
            }));
          });
          y += h; offset += take;
          if (offset < count) next();
        }
      }
      y += 8;
    }
  }
  return pages;
}

// A small PDF 1.4 writer. All model text is encoded as hex, never interpolated
// into PDF operators, filenames, actions, links, dictionaries or metadata.
type Jpeg = { bytes: Uint8Array; width: number; height: number };
type RenderedPage = { page: PdfPage; image: Jpeg };
const ascii = strToU8;
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of parts) { out.set(a, offset); offset += a.length; }
  return out;
}
const stream = (dict: string, data: Uint8Array) =>
  join([ascii('<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n'), data, ascii('\nendstream')]);
const num = (n: number) => Number(n.toFixed(4)).toString();
const hex = (n: number, digits = 2) => n.toString(16).padStart(digits, '0');
const utf16 = (s: string) => s.split('').map(c => hex(c.charCodeAt(0), 4)).join('');

/** The image supplies shaped visible glyphs; an unpainted Type3 font with
 * ToUnicode supplies searchable/selectable original text (including Telugu).
 * This is not a vector-font PDF. Each page is self-contained and offline.
 */
export function encodeAssistantPdf(pages: RenderedPage[], orientation: Orientation): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error('No pages to export.');
  const { width, height } = pageSize(orientation);
  const objects: Uint8Array[] = [];
  const add = (v: string | Uint8Array) => { objects.push(typeof v === 'string' ? ascii(v) : v); return objects.length; };
  const ref = (n: number) => n + ' 0 R';
  const catalog = add(''), root = add('');
  const blank = add(stream('', ascii('1000 0 d0\n')));
  const kids: number[] = [];
  for (const { page, image } of pages) {
    const characters = Array.from(new Set(page.lines.flatMap(l => Array.from(l.runs.map(r => r.text).join('')))));
    const codes = new Map<string, { font: number; code: number }>();
    const fonts: string[] = [];
    for (let i = 0; i < characters.length; i += 250) {
      const group = characters.slice(i, i + 250);
      const index = fonts.length;
      group.forEach((c, j) => codes.set(c, { font: index, code: j + 1 }));
      let mappings = '';
      for (let j = 0; j < group.length; j += 100) {
        const sub = group.slice(j, j + 100);
        mappings += sub.length + ' beginbfchar\n' + sub.map((c, k) => '<' + hex(j + k + 1) + '> <' + utf16(c) + '>').join('\n') + '\nendbfchar\n';
      }
      const cmap = add(stream('', ascii('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /AnswerUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n' + mappings + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n')));
      const names = group.map((_, j) => '/g' + (j + 1));
      const font = add('<< /Type /Font /Subtype /Type3 /Name /F' + index +
        ' /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ' +
        names.map(n => n + ' ' + ref(blank)).join(' ') + ' >> /Encoding << /Type /Encoding /Differences [1 ' +
        names.join(' ') + '] >> /FirstChar 1 /LastChar ' + group.length + ' /Widths [' +
        group.map(() => '1000').join(' ') + '] /Resources << >> /ToUnicode ' + ref(cmap) + ' >>');
      fonts.push('/F' + index + ' ' + ref(font));
    }
    const img = add(stream('/Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', image.bytes));
    let operators = 'q ' + num(width) + ' 0 0 ' + num(height) + ' 0 0 cm /Im Do Q\n';
    for (const line of page.lines) {
      const chars = Array.from(line.runs.map(r => r.text).join(''));
      if (!chars.length) continue;
      const advance = Math.max(0.01, line.width / chars.length);
      for (let start = 0; start < chars.length;) {
        const font = codes.get(chars[start])!.font;
        let end = start + 1;
        while (end < chars.length && codes.get(chars[end])!.font === font) end++;
        const bytes = chars.slice(start, end).map(c => hex(codes.get(c)!.code)).join('');
        operators += 'BT /F' + font + ' 1 Tf 3 Tr ' + num(advance) + ' 0 0 ' + num(line.size) + ' ' +
          num(line.x + start * advance) + ' ' + num(height - line.y) + ' Tm <' + bytes + '> Tj ET\n';
        start = end;
      }
    }
    const contents = add(stream('', ascii(operators)));
    kids.push(add('<< /Type /Page /Parent ' + ref(root) + ' /MediaBox [0 0 ' + num(width) + ' ' + num(height) +
      '] /Resources << /Font << ' + fonts.join(' ') + ' >> /XObject << /Im ' + ref(img) + ' >> >> /Contents ' + ref(contents) + ' >>'));
  }
  objects[catalog - 1] = ascii('<< /Type /Catalog /Pages ' + ref(root) + ' >>');
  objects[root - 1] = ascii('<< /Type /Pages /Count ' + kids.length + ' /Kids [' + kids.map(ref).join(' ') + '] >>');
  const parts = [ascii('%PDF-1.4\n'), new Uint8Array([37, 226, 227, 207, 211, 10])];
  let offset = parts.reduce((n, p) => n + p.length, 0);
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(offset);
    const part = join([ascii((i + 1) + ' 0 obj\n'), object, ascii('\nendobj\n')]);
    parts.push(part); offset += part.length;
  });
  parts.push(ascii('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' +
    offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root ' + ref(catalog) + ' >>\nstartxref\n' + offset + '\n%%EOF\n'));
  return join(parts);
}
const font = (r: Run, size: number) => (r.italic ? 'italic ' : '') + (r.bold ? '600 ' : '400 ') +
  size + 'px "IBM Plex Sans", "Noto Sans Telugu", sans-serif';

export async function buildAssistantPdf(blocks: Block[], orientation: Orientation, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof document === 'undefined' || !document.fonts) throw new Error('PDF generation requires a browser with local font support.');
  // These OFL fonts are already bundled by tokens.css. Never request remote fonts.
  const loaded = await Promise.all([400, 600].flatMap(weight => [
    document.fonts.load(weight + ' 11px "IBM Plex Sans"', 'Answer'),
    document.fonts.load(weight + ' 11px "Noto Sans Telugu"', 'తెలుగు'),
  ]));
  signal.throwIfAborted();
  if (loaded.some(faces => !faces.length || faces.some(f => f.status !== 'loaded'))) {
    throw new Error('The bundled PDF fonts could not be loaded. Retry or download Word.');
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot render a PDF. Download Word instead.');
  const { width, height } = pageSize(orientation);
  const scale = 3; // 216 dpi; browser shaping, including Telugu conjuncts
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const pages = layoutAssistantPdf(blocks, orientation, (r, size) => {
    ctx.font = font(r, size); return ctx.measureText(r.text).width;
  });
  const rendered: RenderedPage[] = [];
  try {
    for (const page of pages) {
      signal.throwIfAborted();
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
      for (const box of page.boxes) {
        if (box.header) { ctx.fillStyle = '#e9eff5'; ctx.fillRect(box.x, box.y, box.width, box.height); }
        ctx.strokeStyle = '#b7c4d0'; ctx.lineWidth = 0.5; ctx.strokeRect(box.x, box.y, box.width, box.height);
      }
      ctx.fillStyle = '#172333'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'ltr';
      for (const line of page.lines) {
        let x = line.x;
        for (const run of line.runs) {
          ctx.font = font(run, line.size); ctx.fillText(run.text, x, line.y); x += run.width;
        }
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('The browser could not encode a PDF page.')), 'image/jpeg', 0.93));
      signal.throwIfAborted();
      if (blob.type !== 'image/jpeg') throw new Error('JPEG page encoding is unavailable in this browser.');
      rendered.push({ page, image: { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height } });
    }
    signal.throwIfAborted();
    return encodeAssistantPdf(rendered, orientation);
  } finally { canvas.width = canvas.height = 0; }
}
