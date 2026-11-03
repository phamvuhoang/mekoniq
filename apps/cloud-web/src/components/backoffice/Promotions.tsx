'use client';
import {useCallback,useEffect,useState} from 'react';
import {readRecords,sendCommand,type VenueRecord} from './venue-api';
export function Promotions({venueId}:{venueId:string}){
 const [promos,setPromos]=useState<VenueRecord[]>([]),[vouchers,setVouchers]=useState<VenueRecord[]>([]),[message,setMessage]=useState(''),[draft,setDraft]=useState({id:'',name:'',kind:'percent',value:'',priority:'0',group:''}),[voucher,setVoucher]=useState({id:'',promotionId:'',limit:'1',scope:''});
 const load=useCallback(async()=>{try{setPromos(await readRecords(venueId,'promotion'));setVouchers(await readRecords(venueId,'voucher'));}catch{setMessage('Không tải được / Failed to load');}},[venueId]);
 useEffect(()=>{void load();},[load]);
 async function run(type:string,payload:Record<string,unknown>){const r=await sendCommand(venueId,type,payload);setMessage(r.status==='pending'?'Đã gửi nhà hàng, chờ xác nhận (không phải đã áp dụng) / Sent to the venue, awaiting acceptance':r.status==='accepted'?'Đã áp dụng / Applied':`Từ chối / Rejected: ${r.code??r.status}`);}
 return <section><h1>Khuyến mãi và voucher / Promotions and vouchers</h1><p role="status">{message}</p>
  <p>Số liệu là bản nhà hàng đã đồng bộ; thay đổi chỉ có hiệu lực sau khi nhà hàng xác nhận. Voucher dùng chung không dùng được khi offline nếu chưa được cấp hạn mức riêng cho nhà hàng.</p>
  <fieldset><legend>Khuyến mãi mới / New promotion</legend>
   <label>Mã / Id<input value={draft.id} onChange={e=>setDraft({...draft,id:e.target.value})}/></label><label>Tên / Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label>Loại / Kind<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value})}><option value="percent">% (bps)</option><option value="fixed">VND</option></select></label>
   <label>Giá trị / Value<input value={draft.value} onChange={e=>setDraft({...draft,value:e.target.value})}/></label><label>Ưu tiên / Priority<input value={draft.priority} onChange={e=>setDraft({...draft,priority:e.target.value})}/></label><label>Nhóm loại trừ / Exclusion group<input value={draft.group} onChange={e=>setDraft({...draft,group:e.target.value})}/></label>
   <button onClick={()=>run('Promotion.Publish',{promotionId:draft.id,name:draft.name,kind:draft.kind,...(draft.kind==='percent'?{valueBps:Number(draft.value)}:{amountMinor:draft.value}),priority:Number(draft.priority),...(draft.group?{exclusionGroup:draft.group}:{})})}>Phát hành / Publish</button></fieldset>
  <ul>{promos.map(p=><li key={p.id}>{p.id} · {String(p.state.name)} · {String(p.state.status)} · r{String(p.state.revision)} · ưu tiên/priority {String(p.state.priority)}</li>)}</ul>
  <fieldset><legend>Voucher mới / New voucher</legend>
   <label>Mã / Id<input value={voucher.id} onChange={e=>setVoucher({...voucher,id:e.target.value})}/></label><label>Khuyến mãi / Promotion<input value={voucher.promotionId} onChange={e=>setVoucher({...voucher,promotionId:e.target.value})}/></label>
   <label>Số lần dùng / Uses<input value={voucher.limit} onChange={e=>setVoucher({...voucher,limit:e.target.value})}/></label><label>Phạm vi (trống = nhà hàng này, shared = dùng chung) / Scope<input value={voucher.scope} onChange={e=>setVoucher({...voucher,scope:e.target.value})}/></label>
   <button onClick={()=>run('Voucher.Issue',{voucherId:voucher.id,limit:Number(voucher.limit),...(voucher.promotionId?{promotionId:voucher.promotionId}:{}),...(voucher.scope?{scope:voucher.scope}:{})})}>Phát hành voucher / Issue</button></fieldset>
  <ul>{vouchers.map(v=><li key={v.id}>{v.id} · còn/remaining {String(v.state.remaining)}/{String(v.state.limit)} · {String(v.state.scope)}</li>)}</ul>
  <button onClick={()=>void load()}>Tải lại / Refresh</button></section>;
}
