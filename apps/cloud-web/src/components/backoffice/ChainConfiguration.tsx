'use client';
import {useCallback,useEffect,useState} from 'react';
type Revision={revision:number;restores:number|null;note:string|null;createdAt:string};
type Target={venueId:string;kind:string;desired:number;effective:number;state:string;code?:string;attempts:number};
type Preview={venueId:string;error?:string;catalog?:{version:number;diff:{itemId:string;field:string}[]}};
async function call(path:string,method='GET',body?:unknown){
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.code??'REQUEST_FAILED');return data;
}
const stateText:Record<string,string>={applied:'Đã áp dụng / Applied',pending:'Chờ chi nhánh xác nhận / Awaiting branch',failed:'Bị từ chối / Rejected',superseded:'Chi nhánh đã có bản mới hơn / Branch is ahead'};
export function ChainConfiguration({venueIds}:{venueIds:string[]}){
 const [revisions,setRevisions]=useState<Revision[]>([]),[selected,setSelected]=useState(0),[targets,setTargets]=useState<Target[]>([]),[preview,setPreview]=useState<Preview[]>([]),[message,setMessage]=useState(''),[chosen,setChosen]=useState<string[]>(venueIds);
 const load=useCallback(async()=>{try{const {revisions:list}=await call('/v1/chain/revisions');setRevisions(list);const rev=selected||list[0]?.revision||0;if(rev){setSelected(rev);setTargets((await call(`/v1/chain/revisions/${rev}/status`)).targets);}}catch(e){setMessage('Không tải được / Failed to load: '+(e as Error).message);}},[selected]);
 useEffect(()=>{void load();},[load]);
 const run=async(label:string,work:()=>Promise<void>)=>{try{await work();setMessage(label);await load();}catch(e){setMessage('Lỗi / Error: '+(e as Error).message);}};
 return <section><h1>Cấu hình chuỗi / Chain configuration</h1><p role="status">{message}</p>
  <p>Đây là bản chuỗi muốn áp dụng. Chi nhánh chỉ thực sự đổi khi nó xác nhận; chi nhánh offline giữ bản cũ và đơn đang chạy giữ giá đã chốt. / This is what the chain wants. A branch changes only when it acknowledges; an offline branch keeps its old version and running orders keep their frozen prices.</p>
  <label>Phiên bản / Revision<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{revisions.map(r=><option key={r.revision} value={r.revision}>r{r.revision}{r.restores?` (từ/from r${r.restores})`:''} {r.note??''}</option>)}</select></label>
  <fieldset><legend>Chi nhánh / Branches</legend>{venueIds.map(v=><label key={v}><input type="checkbox" checked={chosen.includes(v)} onChange={e=>setChosen(e.target.checked?[...chosen,v]:chosen.filter(x=>x!==v))}/>{v}</label>)}</fieldset>
  <button disabled={!selected} onClick={()=>run('Đã xem trước / Previewed',async()=>setPreview((await call(`/v1/chain/revisions/${selected}/preview`,'POST',{venues:chosen})).venues))}>Xem trước / Preview</button>
  <button disabled={!selected||!chosen.length} onClick={()=>run('Đã gửi, chờ chi nhánh xác nhận / Sent, awaiting branches',async()=>{await call(`/v1/chain/revisions/${selected}/publish`,'POST',{venues:chosen});})}>Phát hành / Publish</button>
  <button disabled={!selected} onClick={()=>run('Đã tạo bản mới từ bản cũ / New revision created from the old one',async()=>{await call('/v1/chain/rollback','POST',{expectedRevision:revisions[0]?.revision??0,toRevision:selected,note:'rollback forward'});setSelected(0);})}>Quay lại bản này (tạo bản mới) / Roll back forward</button>
  <ul>{preview.map(p=><li key={p.venueId}>{p.venueId}: {p.error?`không áp dụng được / cannot apply: ${p.error}`:`${p.catalog?.diff.length??0} thay đổi / changes → menu v${p.catalog?.version}`}</li>)}</ul>
  <div className="mq-table" role="region" aria-label="Bảng dữ liệu / Data table" tabIndex={0}><table><thead><tr><th>Chi nhánh / Branch</th><th>Loại / Kind</th><th>Mong muốn / Desired</th><th>Hiệu lực / Effective</th><th>Trạng thái / State</th></tr></thead>
   <tbody>{targets.map(t=><tr key={t.venueId+t.kind}><td>{t.venueId}</td><td>{t.kind}</td><td>{t.desired}</td><td>{t.effective}</td><td>{stateText[t.state]??t.state}{t.code?` · ${t.code}`:''}{t.attempts>1?` · lần/attempt ${t.attempts}`:''}</td></tr>)}</tbody></table></div>
  <button className="quiet" onClick={()=>void load()}>Tải lại / Refresh</button></section>;
}
