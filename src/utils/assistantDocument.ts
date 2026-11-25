/** Shared safe subset of Markdown used by the answer and both export formats. */
export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Block =
  | { kind: 'paragraph'; lines: Run[][] }
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'list'; ordered: boolean; items: { marker: string; runs: Run[] }[] }
  | { kind: 'table'; rows: Run[][][] };

export function inlineRuns(text: string): Run[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter(Boolean).map(part =>
    part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true }
      : part.startsWith('*') && part.endsWith('*') && part.length > 2 ? { text: part.slice(1, -1), italic: true }
        : { text: part });
}
const heading = /^(#{1,6})\s+(.+)$/;
const list = /^\s*([-*•]|\d+[.)])\s+(.+)$/;
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
const tableStart = (lines: string[], i: number) => {
  if (!lines[i]?.includes('|') || !lines[i + 1]?.includes('|')) return false;
  const a = cells(lines[i]), b = cells(lines[i + 1]);
  return a.length >= 2 && a.length === b.length && b.every(s => /^:?-{3,}:?$/.test(s));
};

export function parseAssistantDocument(answer: string): Block[] {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const h = heading.exec(lines[i]);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length, runs: inlineRuns(h[2]) });
      i++; continue;
    }
    if (tableStart(lines, i)) {
      const first = cells(lines[i]);
      const rows = [first.map(inlineRuns)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && cells(lines[i]).length === first.length) {
        rows.push(cells(lines[i++]).map(inlineRuns));
      }
      blocks.push({ kind: 'table', rows }); continue;
    }
    const item = list.exec(lines[i]);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const items: { marker: string; runs: Run[] }[] = [];
      while (i < lines.length) {
        const m = list.exec(lines[i]);
        if (!m || /^\d/.test(m[1]) !== ordered) break;
        items.push({ marker: ordered ? m[1] : '•', runs: inlineRuns(m[2]) }); i++;
      }
      blocks.push({ kind: 'list', ordered, items }); continue;
    }
    const paragraph: Run[][] = [inlineRuns(lines[i++])];
    while (i < lines.length && lines[i].trim() && !heading.test(lines[i]) && !list.test(lines[i]) && !tableStart(lines, i)) {
      paragraph.push(inlineRuns(lines[i++]));
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

export type Orientation = 'portrait' | 'landscape';
export type ExportFormat = 'pdf' | 'docx';
export type ExportTurn = { id: number; role: string; status: string; content: string };
export function canExport(turn: ExportTurn): boolean {
  return turn.role === 'assistant' && turn.status === 'done' && !!turn.content.trim();
}
export function exportName(id: number, format: ExportFormat): string {
  return 'assistant-answer-' + (Number.isSafeInteger(id) && id >= 0 ? id : 'reply') + '.' + format;
}
export function requestedOrientation(question: string): Orientation {
  return /\blandscape\b/i.test(question) && !/\b(?:no|not|avoid)\s+landscape\b/i.test(question) ? 'landscape' : 'portrait';
}
export function pageSize(orientation: Orientation) {
  return orientation === 'landscape' ? { width: 841.89, height: 595.28 } : { width: 595.28, height: 841.89 };
}
