import { useEffect, useState } from 'react';
import type { ChatScope } from '../services/chat';
import { loadAuthorizedChart } from '../services/worksheetCharts';
import { chartRequested, type ChartDecision, type ChartSpec } from '../utils/workbookCharts';

const palette = ['#1d4ed8','#0f766e','#7c3aed','#b45309','#be185d','#475569'];
const svgWidth = 480;
const svgHeight = 215;

function DataGraphic({ chart }: { chart: ChartSpec }) {
  const values = chart.points.map(p => Number(p.exact));
  if (chart.kind === 'pie') {
    const total = values.reduce((sum,n)=>sum+n,0);
    let angle = -Math.PI / 2;
    return <svg viewBox={'0 0 '+svgWidth+' '+svgHeight} className="worksheet-chart-svg" aria-hidden="true">
      {values.map((n,i)=>{
        const delta = 2 * Math.PI * n / total;
        const start = angle, end = angle + delta;
        angle = end;
        const cx = 240, cy = 105, radius = 89;
        const x1 = cx + radius * Math.cos(start), y1 = cy + radius * Math.sin(start);
        const x2 = cx + radius * Math.cos(end), y2 = cy + radius * Math.sin(end);
        const d = 'M '+cx+' '+cy+' L '+x1+' '+y1+' A '+radius+' '+radius+' 0 '+(delta>Math.PI?1:0)+' 1 '+x2+' '+y2+' Z';
        return <path key={i} d={d} fill={palette[i%palette.length]} stroke="#fff" strokeWidth={2}>
          <title>{chart.points[i].label+': '+chart.points[i].exact}</title>
        </path>;
      })}
      <circle cx={240} cy={105} r={42} fill="var(--surface, #fff)"/>
    </svg>;
  }
  const low = Math.min(0,...values), high = Math.max(0,...values);
  const range = high - low || 1;
  const y = (n: number) => 15 + (high-n)/range*155;
  const yZero = y(0);
  const left = 40, width = svgWidth-70;
  const x = (i: number) => left + (i+0.5)*width/values.length;
  return <svg viewBox={'0 0 '+svgWidth+' '+svgHeight} className="worksheet-chart-svg" aria-hidden="true">
    <line x1={left} y1={yZero} x2={left+width} y2={yZero} stroke="var(--line-strong, #94a3b8)" strokeWidth="1"/>
    {chart.kind === 'line'
      ? <>
          <polyline points={values.map((v,i)=>x(i)+','+y(v)).join(' ')}
            fill="none" stroke={palette[0]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
          {values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r={5} fill={palette[0]}>
            <title>{chart.points[i].label+': '+chart.points[i].exact}</title>
          </circle>)}
        </>
      : values.map((v,i)=>{
          const top = Math.min(y(v),yZero), height = Math.max(1,Math.abs(y(v)-yZero));
          const bw = Math.min(40,0.68*width/values.length);
          return <rect key={i} x={x(i)-bw/2} y={top} width={bw} height={height} fill={palette[i%palette.length]} rx={2}>
            <title>{chart.points[i].label+': '+chart.points[i].exact}</title>
          </rect>;
        })}
    {values.map((_,i)=><text key={i} x={x(i)} y={197} textAnchor="middle" fontSize={11} fill="var(--ink-700, #334155)">{i+1}</text>)}
  </svg>;
}

/** SVG never defines the numbers; this source-provenanced table is the accessible alternative. */
export function WorksheetChart({ chart }: { chart: ChartSpec }) {
  return <figure className="worksheet-chart" aria-label={chart.title}>
    <figcaption>
      <strong>{chart.title}</strong>
      <span>{chart.sheetName+' · worksheet '+(chart.sheetIndex+1)+' · '+chart.coveredRows+' of '+chart.sourceRows+' source rows'}</span>
    </figcaption>
    <DataGraphic chart={chart}/>
    <div className="worksheet-chart-table"><table>
      <caption>{'Exact '+chart.measure+' · '+chart.unit+' · grouped by '+chart.dimension}</caption>
      <thead><tr><th scope="col">{chart.dimension}</th><th scope="col">{chart.measure}</th><th scope="col">Source rows</th></tr></thead>
      <tbody>{chart.points.map((p,i)=><tr key={i}>
        <th scope="row"><span className="worksheet-chart-swatch" style={{backgroundColor:palette[i%palette.length]}} aria-hidden="true"/>{p.label}</th>
        <td className="worksheet-chart-number">{p.exact}</td>
        <td><details><summary>{p.rows.length+' row(s)'}</summary><span>{p.rows.join(', ')}</span></details></td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">{chart.total === 'not additive' ? 'Total not applicable' : 'Total included'}</th><td className="worksheet-chart-number">{chart.total}</td><td>{chart.coveredRows+' rows'}</td></tr></tfoot>
    </table></div>
    <p className="worksheet-chart-note">{chart.note}</p>
    <p className="worksheet-chart-export-warning">PDF and Word downloads include the written Assistant answer only; this chart is not included.</p>
  </figure>;
}

type State = { key: string; status: 'loading'|'ready'|'error'; decision?: ChartDecision };
export function WorksheetChartForTurn({ scope, question, answer }: { scope: ChatScope; question: string; answer?: string }) {
  const id = scope.kind === 'document' ? scope.datasetId : '';
  const sheetIndex = scope.kind === 'document' ? scope.sheetIndex : undefined;
  const row = scope.kind === 'document' ? scope.row : undefined;
  const wanted = sheetIndex !== undefined && chartRequested(question,answer);
  const key = id+':'+sheetIndex+':'+row+':'+question;
  const [state,setState] = useState<State | null>(null);
  useEffect(()=>{
    if (!wanted || sheetIndex === undefined || row !== undefined) return;
    const ac = new AbortController();
    setState({key,status:'loading'});
    void loadAuthorizedChart(id,sheetIndex,question,ac.signal)
      .then(decision=>{if(!ac.signal.aborted)setState({key,status:'ready',decision});})
      .catch(()=>{if(!ac.signal.aborted)setState({key,status:'error'});});
    return ()=>ac.abort();
  },[id,sheetIndex,row,wanted,question,key]);
  if (!wanted) return null;
  if (row !== undefined) return <p className="worksheet-chart-note">A chart needs multiple rows. Select Whole worksheet for a complete comparison.</p>;
  if (!state || state.key !== key || state.status === 'loading') return <p className="worksheet-chart-note" role="status">Calculating chart from your private worksheet…</p>;
  if (state.status === 'error') return <p className="worksheet-chart-note" role="status">The worksheet chart could not be loaded. The written answer remains available.</p>;
  if (!state.decision?.chart) return <p className="worksheet-chart-note" role="status">{state.decision?.reason ?? 'No meaningful chart could be created.'}</p>;
  return <WorksheetChart chart={state.decision.chart}/>;
}
