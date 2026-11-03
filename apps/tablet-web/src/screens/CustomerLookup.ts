import {el,field,select,panel,list,tr,button,act,summary,money,type ScreenContext} from '../ui';
import {hasConsent} from '../../../../packages/domain/src/customers/consent';
import {normalizePhone} from '../../../../packages/domain/src/customers/profile';
/** Minimal local projection: customers, consent and the points account this venue holds. Works offline; shared chain balances are shown as not spendable here. */
export function CustomerLookup(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),q=field(tr(c,'Tìm theo tên hoặc số điện thoại','Search by name or phone')),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p);
 let digits='';try{digits=normalizePhone(q.input.value);}catch{digits='';}
 const match=(s:{ref:{id:string};state:Record<string,unknown>})=>{const t=q.input.value.trim().toLowerCase();return !t||s.ref.id.toLowerCase().includes(t)||String(s.state.name??'').toLowerCase().includes(t)||(digits!==''&&s.state.phone===digits);};
 const results=el('div',undefined,'screen-grid'),render=()=>{
  results.replaceChildren();
  for(const cust of list(c,'customer').filter(match).slice(0,30)){
   const row=summary(cust),acc=list(c,'loyalty-account').find(a=>a.ref.id===cust.ref.id),chain=acc?.state.scope==='chain',consented=hasConsent(c.snapshots,cust.ref.id,'loyalty','program');
   row.append(el('p',`${String(cust.state.phone??'—')} · ${tr(c,'điểm','points')} ${String(acc?.state.balance??'0')}${acc?.state.tier?` (${String(acc.state.tier)})`:''}${Number(acc?.state.pending??0)>0?` · ${tr(c,'chờ xác nhận','pending')} ${String(acc?.state.pending)}`:''}`,'muted'));
   if(Array.isArray(cust.state.possibleDuplicates)&&cust.state.possibleDuplicates.length)row.append(el('p',tr(c,`Có thể trùng với: ${(cust.state.possibleDuplicates as string[]).join(', ')} (không tự gộp)`,`Possible duplicate of: ${(cust.state.possibleDuplicates as string[]).join(', ')} (never merged automatically)`),'warning'));
   if(chain)row.append(el('p',tr(c,'Điểm dùng chung chuỗi: không tiêu tại đây khi offline.','Chain-wide balance: cannot be spent here while offline.'),'warning'));
   if(cust.state.status==='active'){
    row.append(el('p',consented?tr(c,'Đã đồng ý chương trình khách hàng thân thiết','Loyalty programme consent given'):tr(c,'Chưa đồng ý chương trình','No programme consent'),consented?'muted':'warning'));
    if(!consented&&can('loyalty.write'))row.append(button(tr(c,'Ghi nhận khách đồng ý','Record consent'),()=>act(c,'Consent.Record',{customerId:cust.ref.id,purpose:'loyalty',channel:'program',granted:true,policyVersion:'v1'}).then(()=>{})));
    // Points come from a captured settlement, never from the customer's say-so; the coordinator caps them at the policy rate and refuses a settlement already claimed.
    const paid=list(c,'payment').filter(p=>p.state.status==='captured'&&BigInt(String(p.state.appliedMinor??'0'))>0n).sort((a,b)=>String(b.state.occurredAt).localeCompare(String(a.state.occurredAt))).slice(0,20);
    if(consented&&can('loyalty.write')&&paid.length){
     const pay=select(tr(c,'Thanh toán đã nhận','Captured payment'),paid.map(p=>({id:p.ref.id,name:`${p.ref.id} · ${money(p.state.appliedMinor)}`}))),earn=field(tr(c,'Điểm cộng','Points to award'),'','number');
     const suggest=()=>{const p=paid.find(x=>x.ref.id===pay.input.value);earn.input.value=p?String(BigInt(String(p.state.appliedMinor))/1000n):'';};pay.input.addEventListener('change',suggest);suggest();
     row.append(pay.node,earn.node,button(tr(c,'Cộng điểm từ thanh toán','Award points for payment'),()=>act(c,'Loyalty.Earn',{customerId:cust.ref.id,settlementId:pay.input.value,points:earn.input.value}).then(()=>{})));
    }
    if(consented&&can('loyalty.write')){const pts=field(tr(c,'Điểm đổi','Points to redeem'),'','number');row.append(pts.node,button(tr(c,'Đổi điểm','Redeem points'),()=>act(c,'Loyalty.Redeem',{customerId:cust.ref.id,sourceEventId:crypto.randomUUID(),points:pts.input.value}).then(()=>{})));}
   }
   results.append(row);
  }
  if(!results.children.length)results.append(el('p',tr(c,'Không có khách phù hợp.','No matching customer.'),'muted'));
 };
 q.input.addEventListener('input',render);render();
 root.append(q.node,results);
 if(can('loyalty.write')){const id=field(tr(c,'Mã khách mới','New customer id')),name=field(tr(c,'Tên','Name')),phone=field(tr(c,'Số điện thoại','Phone'));
  root.append(id.node,name.node,phone.node,button(tr(c,'Thêm khách','Add customer'),()=>act(c,'Customer.Upsert',{customerId:id.input.value,name:name.input.value,...(phone.input.value?{phone:phone.input.value}:{})}).then(()=>{})));}
 return panel(tr(c,'Khách hàng và điểm','Customers and points'),root);
}
