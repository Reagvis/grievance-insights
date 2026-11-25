import { strToU8, zipSync } from 'fflate';
import { pageSize, type Block, type Orientation, type Run } from './assistantDocument';

const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = (body: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
// Replace XML-invalid characters (including isolated surrogates), not valid Unicode.
const escape = (s: string) => Array.from(s, c => {
  const n = c.codePointAt(0)!;
  return n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) ||
    (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000 ? c : '\ufffd';
}).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fonts = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Noto Sans Telugu" w:eastAsia="Noto Sans Telugu"/>';
function run(r: Run, size = 22, bold = false): string {
  // Word's complex-script flag makes Telugu use the designated CS font, without forcing English into it.
  const chunks = r.text.split(/([\u0c00-\u0c7f\u200c\u200d]+)/u).filter(Boolean);
  return chunks.map(text => {
    const telugu = /[\u0c00-\u0c7f]/u.test(text);
    return '<w:r><w:rPr>' + fonts + (r.bold || bold ? '<w:b/><w:bCs/>' : '') +
      (r.italic ? '<w:i/><w:iCs/>' : '') +
      '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
      (telugu ? '<w:cs/><w:lang w:bidi="te-IN"/>' : '') + '</w:rPr><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>';
  }).join('');
}
function paragraph(lines: Run[][], opts: { level?: number; marker?: string; cell?: boolean; header?: boolean } = {}): string {
  const level = opts.level;
  const size = level ? Math.max(24, 36 - level * 3) : 22;
  const ppr = (level ? '<w:pStyle w:val="Heading' + level + '"/><w:keepNext/><w:keepLines/>' : '') +
    '<w:spacing w:after="' + (opts.cell ? 60 : 140) + '" w:line="300" w:lineRule="auto"/>' +
    (opts.marker ? '<w:ind w:left="360" w:hanging="300"/>' : '');
  const content = lines.map(line => line.map(r => run(r, size, !!level || opts.header)).join('')).join('<w:r><w:br/></w:r>');
  return '<w:p><w:pPr>' + ppr + '</w:pPr>' + (opts.marker ? run({ text: opts.marker + '  ' }, size) : '') + content + '</w:p>';
}

export function buildAssistantDocx(blocks: Block[], orientation: Orientation): Uint8Array {
  const { width, height } = pageSize(orientation);
  const usable = Math.round(width * 20) - 2160;
  const body = blocks.map(b => {
    if (b.kind === 'heading') return paragraph([b.runs], { level: b.level });
    if (b.kind === 'paragraph') return paragraph(b.lines);
    if (b.kind === 'list') return b.items.map(item => paragraph([item.runs], { marker: item.marker })).join('');
    const col = Math.floor(usable / b.rows[0].length);
    const borders = ['top','left','bottom','right','insideH','insideV'].map(side => '<w:' + side + ' w:val="single" w:sz="4" w:color="B7C4D0"/>').join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="' + usable + '" w:type="dxa"/><w:tblBorders>' + borders + '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
      b.rows[0].map(() => '<w:gridCol w:w="' + col + '"/>').join('') + '</w:tblGrid>' +
      b.rows.map((row, i) => '<w:tr>' + (i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + row.map(cell =>
        '<w:tc><w:tcPr><w:tcW w:w="' + col + '" w:type="dxa"/>' + (i === 0 ? '<w:shd w:fill="E9EFF5"/>' : '') +
        '</w:tcPr>' + paragraph([cell], { cell: true, header: i === 0 }) + '</w:tc>').join('') + '</w:tr>').join('') + '</w:tbl>';
  }).join('');
  const section = '<w:sectPr><w:pgSz w:w="' + Math.round(width * 20) + '" w:h="' + Math.round(height * 20) + '"' +
    (orientation === 'landscape' ? ' w:orient="landscape"' : '') + '/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
  const styles = Array.from({ length: 6 }, (_, i) => '<w:style w:type="paragraph" w:styleId="Heading' + (i + 1) +
    '"><w:name w:val="heading ' + (i + 1) + '"/><w:pPr><w:outlineLvl w:val="' + i + '"/></w:pPr></w:style>').join('');
  const parts: Record<string, string> = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="' + rel + '"><Relationship Id="rId1" Type="' + officeRel + '/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': xml('<w:document xmlns:w="' + ns + '"><w:body>' + body + section + '</w:body></w:document>'),
    'word/styles.xml': xml('<w:styles xmlns:w="' + ns + '">' + styles + '</w:styles>'),
    'word/_rels/document.xml.rels': xml('<Relationships xmlns="' + rel + '"><Relationship Id="rId1" Type="' + officeRel + '/styles" Target="styles.xml"/></Relationships>'),
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k,v]) => [k,strToU8(v)])), { level: 6 });
}
