'use client';
import {useCallback,useEffect,useState} from 'react';
import {Menu,money,touch,type GuestMenuItem} from './Menu';
import {Cart} from './Cart';
type View={organizationId:string;venueId:string;tableName:string;expiresAt:string;session:'open'|'expired'|'unknown';orders:{id:string;status:string;currency:string;totalMinor:string;lines:{name:string;quantity:string;cancelledQuantity:string}[]}[];calls:{id:string;kind:string;status:string}[];requests:{operationId:string;type:string;status:string;code:string|null}[]};
type MenuData={version:number;currency:string;items:GuestMenuItem[]};
const labels:Record<string,string>={'Guest.PlaceOrder':'Gọi món / Order','Guest.CallStaff':'Gọi nhân viên / Staff call','Guest.RequestBill':'Yêu cầu thanh toán / Bill request','Guest.ReportIssue':'Báo sự cố / Issue'};
const states:Record<string,string>={pending:'Đang chờ nhà hàng xác nhận / Waiting for the restaurant',accepted:'Nhà hàng đã nhận / Received by the restaurant',rejected:'Nhà hàng từ chối / Declined',unknown:'Chưa rõ, nhân viên sẽ kiểm tra / Unclear, staff will check',unreachable:'Nhà hàng chưa nhận được. Vui lòng báo nhân viên gọi món giúp bạn. / The restaurant did not receive this. Please ask staff to enter it for you.'};
const post=async(path:string,body:object)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.code??'UNAVAILABLE');return data;};
/** Guest table page. Everything is scoped by the signed token; an order shows as pending until the venue's receipt exists. */
export function TableSession({token}:{token:string}){
 const [view,setView]=useState<View|null>(null),[menu,setMenu]=useState<MenuData|null>(null),[cart,setCart]=useState<Record<string,number>>({}),[draftId,setDraftId]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('Đang tải / Loading');
 const load=useCallback(async()=>{
  try{const next=await post('/v1/guest/session',{token}) as View;setView(next);setMessage('');return next;
  }catch(error){setMessage((error as Error).message==='GUEST_TOKEN_EXPIRED'?'Mã bàn đã hết hạn. Nhờ nhân viên cấp mã mới. / This table code expired. Ask staff for a new one.':'Không mở được bàn này. Vui lòng gọi nhân viên. / This table link is not valid. Please ask staff.');return null;}
 },[token]);
 useEffect(()=>{let active=true;
  void load().then(async v=>{if(!v||!active)return;const r=await fetch(`/v1/guest/menu/${encodeURIComponent(v.organizationId)}/${encodeURIComponent(v.venueId)}`);if(r.ok&&active)setMenu(await r.json());});
  const timer=setInterval(()=>{void load();},4000);return()=>{active=false;clearInterval(timer);};
 },[load]);
 async function send(type:string,payload:object,operationId:string){
  setBusy(true);
  try{await post('/v1/guest/commands',{token,type,payload,operationId});await load();return true;}
  catch(error){setMessage(`Chưa gửi được (${(error as Error).message}). Thử lại hoặc gọi nhân viên. / Not sent. Retry or ask staff.`);return false;}
  finally{setBusy(false);}
 }
 async function order(){
  if(!menu)return;const id=draftId??crypto.randomUUID();setDraftId(id); // the same id on retry, so a resend is never a second order
  if(await send('Order.Place',{menuVersion:menu.version,items:Object.entries(cart).filter(([,n])=>n>0).map(([itemId,n])=>({itemId,quantity:String(n)}))},id)){setCart({});setDraftId(null);}
 }
 if(!view)return <main style={{padding:16,maxWidth:720,margin:'auto'}}><p role="status">{message}</p></main>;
 const pendingOrder=view.requests.some(r=>r.type==='Guest.PlaceOrder'&&r.status==='pending');
 return <main style={{padding:16,maxWidth:720,margin:'auto',fontSize:18}}>
  <h1>{view.tableName}</h1>
  <p role="status">{message}</p>
  {view.session==='expired'&&<p>Phiên bàn này đã kết thúc hoặc đã chuyển bàn. Nhờ nhân viên cấp mã mới. / This table session ended or moved. Ask staff for a new code.</p>}
  {view.session==='unknown'&&<p>Đang đồng bộ với nhà hàng. Món gửi lúc này vẫn chờ nhà hàng xác nhận. / Still syncing with the restaurant; anything sent waits for its confirmation.</p>}
  {view.session!=='expired'&&menu&&<>
   <Menu organizationId={view.organizationId} venueId={view.venueId} currency={menu.currency} items={menu.items} onAdd={item=>{setCart(c=>({...c,[item.id]:(c[item.id]??0)+1}));setDraftId(null);}}/>
   <Cart lines={cart} items={menu.items} currency={menu.currency} busy={busy||pendingOrder} onChange={(id,n)=>{setCart(c=>({...c,[id]:Math.max(0,n)}));setDraftId(null);}} onSubmit={()=>void order()}/>
   <section aria-label="Hỗ trợ / Help" style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
    <button style={touch} disabled={busy} onClick={()=>void send('Guest.CallStaff',{},crypto.randomUUID())}>Gọi nhân viên / Call staff</button>
    <button style={touch} disabled={busy} onClick={()=>void send('Guest.RequestBill',{},crypto.randomUUID())}>Yêu cầu thanh toán / Request the bill</button>
    <button style={touch} disabled={busy} onClick={()=>void send('Guest.ReportIssue',{category:'other'},crypto.randomUUID())}>Báo sự cố / Report a problem</button>
   </section>
   <p>Thanh toán luôn do nhân viên xác nhận; yêu cầu thanh toán chỉ báo nhân viên. / Payment is always confirmed by staff; a bill request only notifies them.</p>
  </>}
  <section aria-label="Yêu cầu đã gửi / Sent requests"><h2>Yêu cầu đã gửi / Sent requests</h2>
   {view.requests.length===0?<p>Chưa có / None yet</p>:<ul>{view.requests.map(r=><li key={r.operationId} data-status={r.status}>{labels[r.type]??r.type}: {states[r.status]??r.status}{r.code?` (${r.code})`:''}</li>)}</ul>}
  </section>
  {view.orders.length>0&&<section aria-label="Món của bàn / Table orders"><h2>Món của bàn / Table orders</h2><ul>{view.orders.map(o=><li key={o.id}>{o.lines.map(l=>`${l.name} × ${Number(l.quantity)-Number(l.cancelledQuantity)}`).join(', ')} · {money(o.totalMinor,o.currency)} · {o.status}</li>)}</ul></section>}
 </main>;
}
