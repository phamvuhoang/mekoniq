'use client';
import {useState} from 'react';
type Line={venueId:string;status:string;statusReason:string|null;timeZone:string;timeZoneAssumed:boolean;currency:string|null;lagMs:number|null;pending:number;totals:Record<string,string>|null};
type Report={businessDate:string;asOf:string;complete:boolean;incompleteVenueIds:string[];venues:Line[];totalsByCurrency:Record<string,Record<string,string>>};
const status:Record<string,string>={current:'Mới / Current',stale:'Chậm đồng bộ / Lagging',offline:'Offline',unsynced:'Chưa có dữ liệu / No data'};
export function ChainReports(){
 const [date,setDate]=useState(new Date().toISOString().slice(0,10)),[report,setReport]=useState<Report|null>(null),[message,setMessage]=useState('');
 async function load(){setMessage('');const r=await fetch(`/v1/chain/reports?kind=chain-sales&businessDate=${encodeURIComponent(date)}`);const body=await r.json().catch(()=>({}));if(!r.ok){setMessage('Lỗi / Error: '+(body.code??'REQUEST_FAILED'));return;}setReport(body);}
 return <section><h1>Báo cáo chuỗi / Chain report</h1><p role="status">{message}</p>
  <label>Ngày kinh doanh (theo múi giờ từng chi nhánh) / Business date (each branch's own zone)<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  <button onClick={()=>void load()}>Xem / Show</button>{report&&<a href={`/v1/chain/reports?kind=chain-sales&businessDate=${encodeURIComponent(date)}&format=csv`}> CSV</a>}
  {report&&<><p role={report.complete?'status':'alert'}>{report.complete?'Đủ dữ liệu / Complete':`Thiếu hoặc chậm / Incomplete: ${report.incompleteVenueIds.join(', ')}`} · {report.asOf}</p>
   <table><thead><tr><th>Chi nhánh / Branch</th><th>Nguồn / Source</th><th>Trễ / Lag</th><th>Tiền tệ / Currency</th><th>Doanh thu / Sales</th><th>Ròng / Net</th></tr></thead>
    <tbody>{report.venues.map(v=><tr key={v.venueId}><td>{v.venueId}</td><td>{status[v.status]??v.status}{v.statusReason?` · ${v.statusReason}`:''}{v.timeZoneAssumed?' · UTC?':''}</td><td>{v.lagMs===null?'—':Math.round(v.lagMs/60000)+' ph/min'}{v.pending?` · ${v.pending} chờ/pending`:''}</td><td>{v.currency??'?'}</td><td>{v.totals?.salesTotalMinor??'—'}</td><td>{v.totals?.netMinor??'—'}</td></tr>)}</tbody></table>
   <h2>Tổng hợp theo tiền tệ / Totals by currency</h2><ul>{Object.entries(report.totalsByCurrency).map(([c,t])=><li key={c}>{c}: {t.salesTotalMinor} (ròng/net {t.netMinor})</li>)}</ul>
   <p>Chi nhánh thiếu dữ liệu không được tính là 0 và không nằm trong tổng. / A branch with no data is not counted as zero and is left out of the totals.</p></>}
 </section>;
}
