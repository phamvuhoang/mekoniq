'use client';
import {useState} from 'react';
type Report={status:string;statusReason:string|null;basis?:string;columns:string[];rows:Record<string,unknown>[];totals?:Record<string,unknown>;watermark?:{appliedAt:string|null;pending:number}};
const KINDS=[['stock','Kho / Stock'],['food-cost','Giá vốn / Food cost'],['attendance','Chấm công / Attendance']] as const;
/** Cloud view of the same pure reports the tablets compute. Read-only; venue actions go through the venue owner, and tablets keep working without this page. */
export function OperationsReports({venueId}:{venueId:string}){
 const [kind,setKind]=useState<(typeof KINDS)[number][0]>('stock'),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[report,setReport]=useState<Report|null>(null),[message,setMessage]=useState('');
 const url=(format?:string)=>`/v1/reports/${kind}?venueId=${encodeURIComponent(venueId)}&businessDate=${date}${format?`&format=${format}`:''}`;
 async function load(){setMessage('Đang tải / Loading');try{const r=await fetch(url());if(!r.ok){setMessage((await r.json().catch(()=>({}))).code??'Không tải được / Failed');setReport(null);return;}setReport(await r.json());setMessage('');}catch{setMessage('Mất kết nối / Offline');}}
 const stale=report&&report.status!=='current';
 return <section><h1>Vận hành: kho, giá vốn, chấm công / Operations</h1>
  <label>Báo cáo / Report<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
  <label>Ngày kinh doanh / Business date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  <button onClick={load}>Xem / Show</button> {report&&<a href={url('csv')}>CSV</a>}
  <p role="status">{message}</p>
  {report&&<><p>{report.basis}</p>
   <p role={stale?'alert':'status'}>{report.status==='unsynced'?'Chưa có dữ liệu đồng bộ — không phải số 0 / Not synced yet, no figures':stale?`Số liệu có thể chưa đủ (${report.statusReason}) / Figures may be incomplete`:`Đã đồng bộ lúc ${report.watermark?.appliedAt??'—'}`}</p>
   {report.totals&&<p>{Object.entries(report.totals).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>`${k}: ${String(v)}`).join(' · ')}</p>}
   <table><thead><tr>{report.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{report.rows.slice(0,200).map((row,i)=><tr key={i}>{report.columns.map(c=><td key={c}>{row[c]===null||row[c]===undefined?'':String(row[c])}</td>)}</tr>)}</tbody></table></>}
 </section>;
}
