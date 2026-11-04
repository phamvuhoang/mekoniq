'use client';
import {useEffect,useState} from 'react';
import {Menu,money,touch,type GuestMenuItem} from './Menu';
const text:Record<string,string>={received:'Đã nhận yêu cầu, đang chờ nhà hàng xác nhận / Request received, waiting for the restaurant',accepted:'Nhà hàng đã nhận đơn / The restaurant accepted your order',rejected:'Nhà hàng không nhận đơn / The restaurant could not take this order',expired:'Yêu cầu đã hết hạn / The request expired'};
/** Sandbox web checkout. "Received" is shown as exactly that: the order exists only once the restaurant accepts it. The price here is an estimate; the restaurant prices from its own menu. */
export function OnlineCheckout({organizationId,venueId,currency,items}:{organizationId:string;venueId:string;currency:string;items:GuestMenuItem[]}){
 const [lines,setLines]=useState<Record<string,number>>({}),[sent,setSent]=useState<{externalId:string;status:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=`/v1/channels/web-sandbox/${encodeURIComponent(organizationId)}/${encodeURIComponent(venueId)}/orders`;
 useEffect(()=>{if(!sent||['accepted','rejected','expired'].includes(sent.status))return;
  const timer=setInterval(async()=>{const r=await fetch(`${base}/${encodeURIComponent(sent.externalId)}`);if(r.ok){const b=await r.json();setSent(s=>s&&{...s,status:b.status});}},5000);return()=>clearInterval(timer);},[sent,base]);
 const chosen=Object.entries(lines).filter(([,n])=>n>0),estimate=chosen.reduce((sum,[id,n])=>sum+BigInt(items.find(i=>i.id===id)?.unitMinor??'0')*BigInt(n),0n);
 async function submit(){setBusy(true);setError('');try{
  const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currency,items:chosen.map(([itemId,n])=>({itemId,quantity:String(n)}))})}),b=await r.json().catch(()=>({}));
  if(!r.ok)setError(b.code==='PROVIDER_NOT_ENABLED'?'Chưa mở đặt món trực tuyến / Online ordering is not open':b.code==='RATE_LIMITED'?'Nhà hàng đang bận, thử lại sau / The restaurant is busy, try again later':'Không gửi được / Could not send: '+(b.code??'error'));
  else setSent({externalId:b.externalId,status:b.status});
 }finally{setBusy(false);}}
 if(sent)return <section role="status"><p><strong>{text[sent.status]??sent.status}</strong></p><p>Mã / Reference: {sent.externalId}</p></section>;
 return <section><p role="note">Bản thử nghiệm, chưa phải đặt món thật. / Sandbox: this is not a live ordering channel.</p>
  <Menu organizationId={organizationId} venueId={venueId} currency={currency} items={items} onAdd={i=>setLines(l=>({...l,[i.id]:(l[i.id]??0)+1}))}/>
  <p>Tạm tính / Estimate: {money(String(estimate),currency)}</p>{error&&<p role="alert">{error}</p>}
  <button style={touch} disabled={busy||chosen.length===0} onClick={()=>void submit()}>Gửi yêu cầu / Send request</button></section>;
}
