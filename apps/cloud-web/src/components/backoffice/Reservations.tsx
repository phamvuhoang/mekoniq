'use client';
import {useCallback,useEffect,useState} from 'react';
import {readRecords,sendCommand,type VenueRecord} from './venue-api';
/** Booking requests from the cloud are asks to the venue: they stay "requested" until the venue's own calendar accepts them. Guest names are personal data (reservation.write only). */
export function Reservations({venueId}:{venueId:string}){
 const [bookings,setBookings]=useState<VenueRecord[]>([]),[waiting,setWaiting]=useState<VenueRecord[]>([]),[message,setMessage]=useState(''),[draft,setDraft]=useState({tableId:'',startsAt:'',endsAt:'',partySize:'2',name:'',deposit:'0'});
 const load=useCallback(async()=>{try{setBookings(await readRecords(venueId,'booking'));setWaiting((await readRecords(venueId,'waitlist')).filter(w=>w.state.status==='waiting'));}catch{setMessage('Không tải được / Failed to load');}},[venueId]);
 useEffect(()=>{void load();},[load]);
 async function run(type:string,payload:Record<string,unknown>){const r=await sendCommand(venueId,type,payload);setMessage(r.status==='pending'?'Đã gửi nhà hàng — CHƯA đảm bảo bàn cho đến khi nhà hàng xác nhận / Sent — the table is NOT guaranteed until the venue confirms':r.status==='accepted'?'Đã xử lý / Done':`Từ chối / Rejected: ${r.code??r.status}`);}
 return <section><h1>Đặt bàn / Reservations</h1><p role="status">{message}</p>
  <p>Đây là bản nhà hàng đã đồng bộ. Yêu cầu đặt bàn từ đây chỉ là đề nghị gửi nhà hàng; nhà hàng kiểm tra lịch bàn thật rồi mới xác nhận.</p>
  <fieldset><legend>Yêu cầu đặt bàn / Booking request</legend>
   <label>Bàn / Table<input value={draft.tableId} onChange={e=>setDraft({...draft,tableId:e.target.value})}/></label><label>Bắt đầu (giờ UTC, ISO) / Starts (UTC ISO)<input placeholder="2026-03-10T11:00:00.000Z" value={draft.startsAt} onChange={e=>setDraft({...draft,startsAt:e.target.value})}/></label><label>Kết thúc / Ends<input value={draft.endsAt} onChange={e=>setDraft({...draft,endsAt:e.target.value})}/></label>
   <label>Số khách / Guests<input value={draft.partySize} onChange={e=>setDraft({...draft,partySize:e.target.value})}/></label><label>Tên / Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>Cọc yêu cầu (VND) / Deposit required<input value={draft.deposit} onChange={e=>setDraft({...draft,deposit:e.target.value})}/></label>
   <button onClick={()=>run('Booking.Create',{bookingId:crypto.randomUUID(),tableId:draft.tableId,startsAt:draft.startsAt,endsAt:draft.endsAt,partySize:Number(draft.partySize),name:draft.name,depositRequiredMinor:draft.deposit,channel:'cloud'})}>Gửi yêu cầu / Send request</button></fieldset>
  <div className="mq-table" role="region" aria-label="Bảng dữ liệu / Data table" tabIndex={0}><table><thead><tr><th>Bàn/Table</th><th>Giờ/Time</th><th>Khách/Guest</th><th>Trạng thái/Status</th><th/></tr></thead><tbody>{bookings.map(b=><tr key={b.id}><td>{String(b.state.tableId)}</td><td>{String(b.state.startsAt)} → {String(b.state.endsAt)}</td><td>{String(b.state.name)} ({String(b.state.partySize)})</td><td>{String(b.state.status)}{b.state.provisional?' · tạm / provisional':''}</td>
   <td>{['requested','confirmed'].includes(String(b.state.status))&&<button className="danger" onClick={()=>run('Booking.Cancel',{bookingId:b.id,reason:'cancelled from back office',expectedVersion:b.version})}>Hủy / Cancel</button>}</td></tr>)}</tbody></table></div>
  <h2>Danh sách chờ / Waitlist ({waiting.length})</h2><ol>{waiting.map(w=><li key={w.id}>{String(w.state.name)} · {String(w.state.partySize)}</li>)}</ol>
  <button className="quiet" onClick={()=>void load()}>Tải lại / Refresh</button></section>;
}
