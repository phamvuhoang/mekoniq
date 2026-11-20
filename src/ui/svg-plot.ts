// Inline SVG plots of the Control tab (R4.2 §6.3): plain markup strings, no script and no library. Every plot has a <title> and a <desc>, and plotTable is its
// table alternative. Every recorded point is drawn (no decimation); a non-finite value is a gap the line breaks at, never a point drawn through.
import {tr} from '../i18n';
import {esc} from './icons';
export interface PlotSeries {id:string;label:string;points:readonly (readonly [number,number])[];dashed?:boolean}
const M={l:70,r:12,t:12,b:44};
/** Three significant digits, without trailing zeros. */
export const sig=(v:number)=>{const n=Number(v);return Number.isFinite(n)?Number(n.toPrecision(3)).toString():'—';};
const noData=()=>tr('không có dữ liệu','データなし','no data');
/** `title`: the plot's accessible name (default: the y label); the y label (its unit) stays in the description. */
export function linePlot(series:PlotSeries[],options:{width:number;height:number;xLabel:string;yLabel:string;title?:string;bands?:{from:number;to:number;label:string}[]}):string{
 const {width:W,height:H,xLabel,yLabel,title=yLabel,bands=[]}=options,w=W-M.l-M.r,h=H-M.t-M.b;
 const head=`<svg xmlns="http://www.w3.org/2000/svg" class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`,frame=`<rect class="plot-frame" x="${M.l}" y="${M.t}" width="${w}" height="${h}"/>`;
 let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
 for(const s of series)for(const [x,y] of s.points)if(Number.isFinite(x)&&Number.isFinite(y)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 if(x0>x1)return `${head}<desc>${esc(noData())}</desc>${frame}<text class="plot-empty" x="${W/2}" y="${H/2}" text-anchor="middle">${esc(noData())}</text></svg>`;
 const desc=`${series.map(s=>s.label).join(', ')} · ${xLabel} ${sig(x0)}–${sig(x1)} · ${yLabel} ${sig(y0)}–${sig(y1)}`;
 // a flat line still gets a band to sit in; 6 % headroom keeps the extremes off the frame
 const pad=y1>y0?(y1-y0)*0.06:Math.max(Math.abs(y0)*0.1,1);y0-=pad;y1+=pad;if(x1===x0)x1=x0+1;
 const px=(x:number)=>M.l+(x-x0)/(x1-x0)*w,py=(y:number)=>M.t+(1-(y-y0)/(y1-y0))*h,f=(v:number)=>v.toFixed(1);
 // tick labels: three digits, and a value within 0.1 % of the span from zero is 0 (no -0.000433 beside 2)
 const ticks=(a:number,b:number)=>[a,(a+b)/2,b],tick=(v:number,span:number)=>Math.abs(v)<span*1e-3?'0':sig(v);
 const grid=ticks(y0+pad,y1-pad).map(y=>`<line class="plot-grid" x1="${M.l}" x2="${M.l+w}" y1="${f(py(y))}" y2="${f(py(y))}"/><text class="plot-tick" x="${M.l-6}" y="${f(py(y)+4)}" text-anchor="end">${tick(y,y1-y0)}</text>`).join('')
  +ticks(x0,x1).map((x,i)=>`<text class="plot-tick" x="${f(px(x))}" y="${M.t+h+16}" text-anchor="${['start','middle','end'][i]}">${tick(x,x1-x0)}</text>`).join('');
 const shaded=bands.map(b=>{const a=Math.max(M.l,px(b.from)),e=Math.min(M.l+w,px(b.to));return e>a?`<rect class="plot-band" x="${f(a)}" y="${M.t}" width="${f(Math.max(e-a,1))}" height="${h}"><title>${esc(b.label)}</title></rect>`:'';}).join('');
 const lines=series.map((s,i)=>{
  const runs:string[][]=[[]];for(const [x,y] of s.points){if(Number.isFinite(x)&&Number.isFinite(y))runs.at(-1)!.push(`${f(px(x))},${f(py(y))}`);else if(runs.at(-1)!.length)runs.push([]);}
  return runs.filter(r=>r.length).map(r=>`<polyline class="plot-line plot-s${i}" data-series="${esc(s.id)}" points="${r.join(' ')}"${s.dashed?' stroke-dasharray="5 4"':''}/>`).join('');
 }).join('');
 return `${head}<desc>${esc(desc)}</desc>${shaded}${grid}${frame}${lines}<text class="plot-label" x="${M.l+w}" y="${H-4}" text-anchor="end">${esc(xLabel)}</text></svg>`;
}
/** The table alternative: one column per series, at most `maxRows` evenly spaced rows; a missing value is a dash, never 0. */
export function plotTable(series:{id:string;label:string;points:readonly (readonly [number,number])[]}[],maxRows:number):string{
 const n=Math.max(0,...series.map(s=>s.points.length));
 if(!n)return `<p class="field-help">${esc(noData())}</p>`;
 const step=Math.max(1,Math.ceil(n/maxRows)),rows:number[]=[];for(let i=0;i<n;i+=step)rows.push(i);
 const cell=(v:number|undefined)=>v!==undefined&&Number.isFinite(v)?sig(v):'—';
 return `<table class="eng-table plot-table"><thead><tr><th scope="col">t (s)</th>${series.map(s=>`<th scope="col">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(i=>`<tr><th scope="row">${cell(series.find(s=>s.points[i])?.points[i]![0])}</th>${series.map(s=>`<td>${cell(s.points[i]?.[1])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
