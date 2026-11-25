import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { unzipSync, strFromU8 } from 'fflate';
import { AssistantAnswer, AssistantAnswerActions } from '../components/AssistantAnswer';
import { canExport, exportName, parseAssistantDocument, requestedOrientation, pageSize } from '../utils/assistantDocument';
import { buildAssistantDocx } from '../utils/assistantDocx';
import { encodeAssistantPdf, layoutAssistantPdf, buildAssistantPdf } from '../utils/assistantPdf';
import { downloadAssistantAnswer, generateAssistantExport } from '../utils/assistantExport';
import { loadNodePdfJs } from '../../backend/ingest/pdf';

const answer = '# Report\n\n**Water** and *roads*: ప్రభుత్వ తెలుగు\n\n- First item\n- Second item\n\n3. Third\n4. Fourth\n\n| Area | Count |\n| --- | --- |\n| తెలుగు | 12 |\n\n<script>alert(1)</script> & <unsafe>';
const turn = { role: 'assistant', status: 'done', content: answer, id: 7 };
const measure = (r: { text: string }, size: number) => Array.from(r.text).length * size * 0.5;
// Valid synthetic 1x1 RGB JPEG; production draws full pages using Canvas.
const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4zNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=='), c => c.charCodeAt(0));
function pdf(text: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  const pages = layoutAssistantPdf(parseAssistantDocument(text), orientation, measure);
  return { pages, bytes: encodeAssistantPdf(pages.map(page => ({ page, image: { bytes: jpeg, width: 1, height: 1 } })), orientation) };
}
describe('Task 23D answer formatting and integrity', () => {
  it('shares safe headings, lists, tables and emphasis with the visible answer', () => {
    expect(parseAssistantDocument(answer).map(b => b.kind)).toEqual(['heading','paragraph','list','list','table','paragraph']);
    const html = renderToStaticMarkup(<AssistantAnswer text={answer}/>);
    expect(html).toContain('<strong>Water</strong>');
    expect(html).toContain('<em>roads</em>');
    expect(html).toContain('<table>');
    expect(html).toContain('value="3"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('exposes accessible actions only for completed nonempty answers and honors explicit layout', () => {
    const html = renderToStaticMarkup(<AssistantAnswerActions turn={turn} question="Use A4 landscape"/>);
    expect(html).toContain('aria-label="Download PDF"');
    expect(html).toContain('aria-label="Download Word (.docx)"');
    expect(html).toContain('value="landscape" selected=""');
    for (const status of ['streaming','error','stopped']) expect(renderToStaticMarkup(<AssistantAnswerActions turn={{...turn,status}} question=""/>)).toBe('');
    expect(canExport({...turn,content:'  '})).toBe(false);
    expect(canExport({...turn,role:'user'})).toBe(false);
    expect(renderToStaticMarkup(<AssistantAnswerActions turn={turn} disabled question=""/>)).not.toContain('Download PDF');
    expect(requestedOrientation('not landscape')).toBe('portrait');
    expect(exportName(NaN,'docx')).toBe('assistant-answer-reply.docx');
  });
  it('produces a real OOXML ZIP with escaped text, Telugu font hints, headings, lists, tables and landscape', () => {
    const bytes = buildAssistantDocx(parseAssistantDocument(answer), 'landscape');
    expect(Array.from(bytes.slice(0,4))).toEqual([80,75,3,4]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml','_rels/.rels','word/_rels/document.xml.rels','word/document.xml','word/styles.xml'].sort());
    const doc = strFromU8(files['word/document.xml']);
    for (const s of ['Heading1','<w:tbl>','3.  ','•  ','<w:b/>','<w:i/>','ప్రభుత్వ తెలుగు','Noto Sans Telugu','w:orient="landscape"','&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;unsafe&gt;']) expect(doc).toContain(s);
    expect(doc).not.toContain('<script>');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).not.toContain('External');
  });
  it('keeps all long Word content', () => {
    const doc = strFromU8(unzipSync(buildAssistantDocx(parseAssistantDocument(Array.from({length: 250}, (_,i) => 'Line ' + i).join('\n\n')), 'portrait'))['word/document.xml']);
    expect(doc).toContain('Line 249');
    expect(doc.match(/<w:p>/g)).toHaveLength(250);
  });
  it('writes genuine PDF objects, page tree, xref and extractable Telugu/English via the existing PDF reader', async () => {
    const { bytes, pages } = pdf(answer);
    expect(new TextDecoder().decode(bytes.slice(0,8))).toBe('%PDF-1.4');
    expect(pages).toHaveLength(1);
    const reader = await loadNodePdfJs();
    const task = reader.getDocument({data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0});
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(1);
      const page = await document.getPage(1);
      const text = (await page.getTextContent()).items.map(i => i.str ?? '').join(' ').normalize('NFC');
      for (const s of ['Report','Water','ప్రభుత్వ తెలుగు','First item','Count','12','<script>alert(1)</script>']) expect(text).toContain(s);
      expect(text).not.toContain('\ufffd');
    } finally { await task.destroy?.(); }
  });
  it('paginates and wraps without dropping the last line or splitting Telugu graphemes', async () => {
    const long = Array.from({length: 180}, (_, i) => 'Entry ' + i + ' — ' + 'ప్రభుత్వ'.repeat(12)).join('\n\n');
    const {pages,bytes} = pdf(long, 'landscape');
    expect(pages.length).toBeGreaterThan(2);
    const size = pageSize('landscape');
    for (const p of pages) for (const l of p.lines) {
      expect(l.y).toBeLessThan(size.height - 54);
      expect(l.x + l.width).toBeLessThanOrEqual(size.width - 54 + 0.001);
    }
    expect(pages.at(-1)?.lines.map(l => l.runs.map(r=>r.text).join('')).join('')).toContain('Entry 179');
    const task = (await loadNodePdfJs()).getDocument({data: bytes,verbosity:0});
    try { expect((await task.promise).numPages).toBe(pages.length); } finally { await task.destroy?.(); }
  });
  it('scopes each download to the supplied answer and suppresses stale results after cancellation', async () => {
    const download = vi.fn();
    const signal = new AbortController().signal;
    const generate = vi.fn(async (text: string) => new Blob([text]));
    await downloadAssistantAnswer('first',1,'docx','portrait',signal,generate,download);
    await downloadAssistantAnswer('second',2,'pdf','landscape',signal,generate,download);
    expect(download.mock.calls.map(c => c[1])).toEqual(['assistant-answer-1.docx','assistant-answer-2.pdf']);
    expect(await download.mock.calls[0][0].text()).toBe('first');
    expect(await download.mock.calls[1][0].text()).toBe('second');
    const ac = new AbortController();
    let finish!: (b: Blob) => void;
    const stale = downloadAssistantAnswer('old document',3,'pdf','portrait',ac.signal,() => new Promise(r=>{finish=r;}),download);
    ac.abort(); finish(new Blob(['old document']));
    await expect(stale).rejects.toMatchObject({name:'AbortError'});
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('propagates generation/download failures instead of false success', async () => {
    const signal = new AbortController().signal;
    await expect(generateAssistantExport('  ','docx','portrait',signal)).rejects.toThrow('no completed answer');
    await expect(buildAssistantPdf(parseAssistantDocument(answer),'portrait',signal)).rejects.toThrow('requires a browser');
    await expect(downloadAssistantAnswer('answer',1,'pdf','portrait',signal,async()=>new Blob(['x']),()=>{throw new Error('blocked');})).rejects.toThrow('blocked');
  });
});
