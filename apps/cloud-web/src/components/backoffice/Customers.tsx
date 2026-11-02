'use client';
import {useCallback,useEffect,useState} from 'react';
import {readRecords,sendCommand,type VenueRecord} from './venue-api';
/** Customer data is personal data: shown only to customer.read, merges and erasures are requests the venue owner records with a reason. */
export function Customers({venueId}:{venueId:string}){
 const [customers,setCustomers]=useState<VenueRecord[]>([]),[accounts,setAccounts]=useState<Record<string,VenueRecord>>({}),[message,setMessage]=useState(''),[q,setQ]=useState(''),[reason,setReason]=useState(''),[mergeTo,setMergeTo]=useState('');
 const load=useCallback(async()=>{try{setCustomers(await readRecords(venueId,'customer'));setAccounts(Object.fromEntries((await readRecords(venueId,'loyalty-account')).map(a=>[a.id,a])));}catch{setMessage('Không tải được / Failed to load');}},[venueId]);
 useEffect(()=>{void load();},[load]);
 async function run(type:string,payload:Record<string,unknown>){const r=await sendCommand(venueId,type,payload);setMessage(r.status==='pending'?'Đã gửi nhà hàng, chờ xác nhận / Sent to the venue, awaiting acceptance':r.status==='accepted'?'Đã áp dụng / Applied':`Từ chối / Rejected: ${r.code??r.status}`);}
 const shown=customers.filter(c=>!q||`${c.id} ${String(c.state.name)} ${String(c.state.phone??'')}`.toLowerCase().includes(q.toLowerCase()));
 return <section><h1>Khách hàng và tích điểm / Customers and loyalty</h1><p role="status">{message}</p>
  <p>Dữ liệu đồng bộ từ nhà hàng. Điểm dùng chung chuỗi chỉ tiêu được khi có kết nối; tại nhà hàng khi offline chỉ ghi điểm chờ xác nhận.</p>
  <label>Tìm / Search<input value={q} onChange={e=>setQ(e.target.value)}/></label><label>Lý do (gộp/xóa) / Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label><label>Gộp vào mã / Merge into<input value={mergeTo} onChange={e=>setMergeTo(e.target.value)}/></label>
  <table><thead><tr><th>ID</th><th>Tên / Name</th><th>Trạng thái / Status</th><th>Điểm / Points</th><th>Thao tác / Actions</th></tr></thead><tbody>{shown.map(c=><tr key={c.id}><td>{c.id}</td><td>{String(c.state.name)}</td><td>{String(c.state.status)}{Array.isArray(c.state.possibleDuplicates)&&c.state.possibleDuplicates.length>0?` · trùng SĐT có thể / possible duplicate: ${(c.state.possibleDuplicates as string[]).join(', ')}`:''}</td><td>{String(accounts[c.id]?.state.balance??'0')} ({String(accounts[c.id]?.state.tier??'—')})</td>
   <td>{c.state.status==='active'&&<><button onClick={()=>run('Customer.Merge',{sourceId:c.id,targetId:mergeTo,reason})}>Gộp / Merge</button> <button onClick={()=>run('Customer.Erase',{customerId:c.id,reason})}>Xóa dữ liệu / Erase</button></>}</td></tr>)}</tbody></table>
  <button onClick={()=>void load()}>Tải lại / Refresh</button></section>;
}
