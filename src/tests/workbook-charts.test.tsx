import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorksheetChart, WorksheetChartForTurn } from '../components/WorksheetChart';
import { loadAuthorizedChart } from '../services/worksheetCharts';
import { buildWorkbookChart, chartRequested, exactText, parseDecimal, sumDecimal, type ChartSpec } from '../utils/workbookCharts';
import type { WorkbookCell, Worksheet } from '../domain/workbook';

const textCell = (value: string): WorkbookCell => ({ kind: 'text', value });
const money = (value: string, format = 'builtin:5'): WorkbookCell => ({ kind: 'currency', value, format });
const number = (value: string, format = 'builtin:0'): WorkbookCell => ({ kind: 'number', value, format });
const blank: WorkbookCell = { kind:'blank' };
function worksheet(headings: string[], rows: WorkbookCell[][], index = 0, name = 'Budget'): Worksheet {
  return {
    version:1,
    info:{index,name,rows:rows.length,columns:headings.length,rowNumbers:rows.map((_,i)=>i+2),kind:'table'},
    date1904:false,headers:headings.map(textCell),
    data:rows.map((cells,i)=>({row:i+2,cells}))
  };
}
const get = (sheet: Worksheet, question: string): ChartSpec => {
  const result = buildWorkbookChart(sheet,question);
  if (!result.chart) throw new Error(result.reason);
  return result.chart;
};

afterEach(()=>vi.unstubAllGlobals());
describe('Task 23C exact, source-grounded worksheet charts',()=>{
  it('sums floating-looking decimals exactly without JS floating-point errors, preserving row provenance',()=>{
    const sheet = worksheet(['Category','Amount'],[
      [textCell('Water'),money('0.10')],
      [textCell('Roads'),money('-0.40')],
      [textCell('Water'),money('0.20')],
      [textCell('Roads'),money('0.10')],
    ]);
    const chart = get(sheet,'Compare categories and amounts');
    expect(chart.kind).toBe('bar');
    expect(chart.points).toEqual([
      {label:'Roads', exact:'-0.30', rows:[3,5]},
      {label:'Water', exact:'0.30', rows:[2,4]},
    ]);
    expect(chart.total).toBe('0.00');
    expect(chart.coveredRows).toBe(4);
    expect(chart.excludedRows).toBe(0);
    expect(chart.sheetIndex).toBe(0);
    expect(chart.unit).toContain('currency');
    expect(exactText(sumDecimal(parseDecimal('0.1')!,parseDecimal('0.2')!))).toBe('0.3');
  });
  it('selects a chronological line trend, sorts months and preserves negative measures',()=>{
    const sheet = worksheet(['Month','Spend'],[
      [textCell('March'),money('-0.30')],
      [textCell('January'),money('0.10')],
      [textCell('February'),money('0.20')]
    ],3,'Quarterly');
    const chart = get(sheet,'Show monthly trend');
    expect(chart.kind).toBe('line');
    expect(chart.sheetIndex).toBe(3);
    expect(chart.sheetName).toBe('Quarterly');
    expect(chart.points.map(p=>[p.label,p.exact,p.rows])).toEqual([
      ['January','0.10',[3]],['February','0.20',[4]],['March','-0.30',[2]]
    ]);
    expect(chart.total).toBe('0.00');
  });
  it('uses a pie for positive shares with an explicit exact denominator',()=>{
    const sheet = worksheet(['Category','Revenue'],[
      [textCell('Roads'),number('10')],
      [textCell('Water'),number('20')],
      [textCell('Water'),number('30')]
    ]);
    const chart = get(sheet,'Show share by category');
    expect(chart.kind).toBe('pie');
    expect(chart.points).toEqual([
      {label:'Roads',exact:'10',rows:[2]},
      {label:'Water',exact:'50',rows:[3,4]}
    ]);
    expect(chart.total).toBe('60');
    expect(chart.note).toContain('denominator');
  });
  it('uses category row counts only when no numeric measures are available',()=>{
    const sheet = worksheet(['Category','Description'],[
      [textCell('A'),textCell('first')],[textCell('B'),textCell('second')],
      [textCell('A'),textCell('third')]
    ]);
    const chart = get(sheet,'Compare categories');
    expect(chart.measure).toBe('Row count');
    expect(chart.points.map(p=>p.exact)).toEqual(['2','1']);
    expect(chart.total).toBe('3');
  });
  it('rejects 13 categories, mixed units and non-meaningful single-group data instead of truncating',()=>{
    const many = worksheet(['Category','Value'],Array.from({length:13},(_,i)=>[textCell('C'+i),number('1')]));
    expect(buildWorkbookChart(many,'Compare categories').reason).toMatch(/More than 12/);
    const mixed = worksheet(['Category','Amount'],[[textCell('A'),money('2')],[textCell('B'),number('3')]]);
    expect(buildWorkbookChart(mixed,'Compare categories').reason).toMatch(/mixes/);
    const single = worksheet(['Category','Amount'],[[textCell('A'),money('2')]]);
    expect(buildWorkbookChart(single,'Compare categories').reason).toMatch(/At least two/);
  });
  it('refuses unsafe plotting precision instead of converting exact 16-digit integers to floats',()=>{
    const sheet = worksheet(['Category','Amount'],[
      [textCell('A'),money('9007199254740993.10')],
      [textCell('B'),money('0.20')]
    ]);
    expect(buildWorkbookChart(sheet,'Compare categories').reason).toMatch(/precision/);
    expect(parseDecimal('9007199254740993.10')).toEqual({units:900719925474099310n,scale:2});
  });
  it('tracks excluded sparse rows explicitly and never treats bad calendar labels as series values',()=>{
    const sheet = worksheet(['Month','Amount'],[
      [textCell('January'),number('3')],[textCell('invalid month'),number('7')],
      [textCell('February'),number('2')],[blank,number('6')]
    ]);
    const chart = get(sheet,'Show monthly trend');
    expect(chart.points.map(p=>p.label)).toEqual(['January','February']);
    expect(chart.coveredRows).toBe(2);
    expect(chart.excludedRows).toBe(2);
    expect(chart.note).toMatch(/2 row/);
  });
  it('never silently totals repeated percentage rows or mixes percentages with currency',()=>{
    const percentage = (n: string): WorkbookCell => ({kind:'percent',value:n,format:'builtin:9'});
    const sheet = worksheet(['Category','Rate'],[
      [textCell('A'),percentage('0.1')],[textCell('A'),percentage('0.2')],[textCell('B'),percentage('0.3')]
    ]);
    expect(buildWorkbookChart(sheet,'Compare rates').reason).toMatch(/Repeated percentages/);
  });
  it('does not add independent percentages without a common denominator',()=>{
    const percent = (n: string): WorkbookCell => ({kind:'percent',value:n,format:'builtin:9'});
    const sheet = worksheet(['Category','Rate'],[
      [textCell('A'),percent('0.25')],[textCell('B'),percent('0.40')]
    ]);
    const chart = get(sheet,'Show share by category');
    expect(chart.kind).toBe('bar');
    expect(chart.points.map(p=>p.exact)).toEqual(['25.00','40.00']);
    expect(chart.total).toBe('not additive');
    expect(chart.note).toContain('common denominator');
  });
  it('rejects impossible calendar days rather than charting them as actual dates',()=>{
    const sheet = worksheet(['Date','Amount'],[
      [textCell('2026-01-15'),number('1')],
      [textCell('2026-02-30'),number('80')],
      [textCell('2026-03-02'),number('4')]
    ]);
    const chart = get(sheet,'Show monthly trend');
    expect(chart.points.map(p=>p.label)).toEqual(['2026-01','2026-03']);
    expect(chart.total).toBe('5');
    expect(chart.excludedRows).toBe(1);
  });
  it('renders safe SVG and accessible exact-value table with privacy source and export omission notice',()=>{
    const chart = get(worksheet(['Category','Count'],[
      [textCell('<script>alert(1)</script>'),number('7')],[textCell('తెలుగు'),number('11')]
    ]),'Compare categories');
    const html = renderToStaticMarkup(<WorksheetChart chart={chart}/>);
    expect(html).toContain('<svg');
    expect(html).toContain('<table');
    expect(html).toContain('తెలుగు');
    expect(html).toContain('Exact Count');
    expect(html).toContain('Source rows');
    expect(html).toContain('not included');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('18');
  });
  it('supports Telugu chart requests, and only shows per-turn chart inside a selected worksheet',()=>{
    expect(chartRequested('నెలవారీ చార్ట్ చూపించు')).toBe(true);
    expect(chartRequested('Draft a government letter')).toBe(false);
    expect(chartRequested('Show a chart', 'I can help with the selected document or this conversation about it. Please ask a related question.')).toBe(false);
    const scoped = renderToStaticMarkup(<WorksheetChartForTurn scope={{kind:'document',datasetId:'file-a',sheetIndex:0}} question="Show a chart"/>);
    expect(scoped).toContain('Calculating chart');
    expect(renderToStaticMarkup(<WorksheetChartForTurn scope={{kind:'document',datasetId:'file-a',sheetIndex:0,row:2}} question="Show a chart"/>)).toContain('Whole worksheet');
    expect(renderToStaticMarkup(<WorksheetChartForTurn scope={{kind:'document',datasetId:'file-a',recordId:'R-1'}} question="Show a chart"/>)).toBe('');
    expect(renderToStaticMarkup(<WorksheetChartForTurn scope={{kind:'all'}} question="Show a chart"/>)).toBe('');
  });
  it('requires the private owner-checked worksheet API, rejects cross-user 404 and mismatched sheet identity',async()=>{
    const sheet = worksheet(['Category','Value'],[[textCell('A'),number('4')],[textCell('B'),number('5')]]);
    const unauthorized = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({error:'Worksheet not found.'}),{status:404}));
    vi.stubGlobal('fetch',unauthorized);
    const ac = new AbortController();
    await expect(loadAuthorizedChart('private-A',0,'Compare categories',ac.signal)).rejects.toThrow('Worksheet not found');
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(unauthorized.mock.calls[0][0]).toBe('/api/datasets/private-A?sheet=0');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({
      dataset:{id:'private-B',format:'xlsx',status:'ready',sheets:[sheet.info]},worksheet:sheet
    }),{status:200})));
    await expect(loadAuthorizedChart('private-A',0,'Compare categories',ac.signal)).rejects.toThrow('Worksheet changed');
    const stopped=new AbortController();stopped.abort();
    await expect(loadAuthorizedChart('private-A',0,'Compare categories',stopped.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('loads one matching worksheet via same-origin credentials and never sends cells or a model request',async()=>{
    const sheet = worksheet(['Category','Amount'],[[textCell('A'),number('2')],[textCell('B'),number('5')]],1,'Private');
    const fetcher = vi.fn(async (_url:string,_init:RequestInit)=>new Response(JSON.stringify({
      dataset:{id:'private-A',name:'file.xlsx',format:'xlsx',status:'ready',sheets:[sheet.info]},worksheet:sheet
    }),{status:200}));
    vi.stubGlobal('fetch',fetcher);
    const ac=new AbortController();
    const result=await loadAuthorizedChart('private-A',1,'Compare categories',ac.signal);
    expect(result.chart?.total).toBe('7');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/datasets/private-A?sheet=1');
    expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'same-origin',cache:'no-store',signal:ac.signal});
  });
});
