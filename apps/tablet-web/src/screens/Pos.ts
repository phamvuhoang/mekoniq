import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,field,select,panel,list,tr,money,button,act,type ScreenContext} from '../ui';
import {priceByMass} from '../../../../packages/domain/src/pricing/weighed';
type Pick={groupId:string;optionId:string};
type CartLine={itemId:string;quantity:string;modifiers:Pick[];measure?:JsonObject};
type Draft={tableId:string;lines:CartLine[];discountIds:string[];operationId:string;quote?:JsonObject;stale:boolean};
const fresh=(tableId=''):Draft=>({tableId,lines:[],discountIds:[],operationId:crypto.randomUUID(),stale:false});
let draft=fresh();
const sameLine=(a:CartLine,b:CartLine)=>!a.measure&&!b.measure&&a.itemId===b.itemId&&JSON.stringify(a.modifiers)===JSON.stringify(b.modifiers);
/** Unsent edits survive a re-render and a VERSION_CONFLICT: a conflict only records which newer version was found. */
type Edit={quantity:string;reason:string;target:string};
const edits=new Map<string,Edit>(),conflicts=new Map<string,number>();
const edit=(key:string):Edit=>{let e=edits.get(key);if(!e){e={quantity:'1',reason:'',target:''};edits.set(key,e);}return e;};
async function amend(c:ScreenContext,key:string,type:string,payload:JsonObject,version:number){
 const result=await act(c,type,payload,version);
 if(result?.status==='accepted'){edits.delete(key);conflicts.delete(key);}
 else if(result?.code==='VERSION_CONFLICT'){conflicts.set(key,version);await c.refresh();}
}
const staleNote=(c:ScreenContext,key:string,version:number)=>conflicts.has(key)&&version>conflicts.get(key)!?el('p',tr(c,`Đã có bản mới hơn (v${version}) do thiết bị khác ghi. Bản nháp của bạn được giữ: kiểm tra rồi gửi lại.`,`A newer version (v${version}) was written by another device. Your draft is kept: review it, then send again.`),'offline-banner'):undefined;
function tables(c:ScreenContext):HTMLElement {
 const box=el('div',undefined,'screen-grid'),nameOf=(id:string)=>String(list(c,'table').find(t=>t.ref.id===id)?.state.name??id);
 const open=list(c,'session').filter(s=>s.state.status==='open'),orders=list(c,'order');
 for(const session of open){
  const row=el('article',undefined,'record'),frozen=Boolean(session.state.frozenBillId);
  row.append(el('strong',nameOf(String(session.state.tableId))),el('span',frozen?tr(c,'Đã in tạm tính','Bill prepared'):tr(c,'Đang phục vụ','Open'),'badge'));
  const note=staleNote(c,'s'+session.ref.id,session.version);if(note)row.append(note);
  const move=edit('move'+session.ref.id),freeTables=list(c,'table').filter(t=>!t.state.activeSessionId).map(t=>({id:t.ref.id,name:String(t.state.name??t.ref.id)}));
  const to=select(tr(c,'Chuyển sang bàn','Move to table'),freeTables,move.target);to.input.addEventListener('change',()=>{move.target=to.input.value;});
  const others=open.filter(o=>o!==session).map(o=>({id:o.ref.id,name:nameOf(String(o.state.tableId))})),merge=edit('merge'+session.ref.id),into=select(tr(c,'Gộp vào bàn','Merge into table'),others,merge.target);into.input.addEventListener('change',()=>{merge.target=into.input.value;});
  const other=()=>open.find(o=>o.ref.id===into.input.value);
  const moveButton=button(tr(c,'Chuyển bàn','Move'),()=>amend(c,'s'+session.ref.id,'Session.Move',{sessionId:session.ref.id,toTableId:to.input.value},session.version)),mergeButton=button(tr(c,'Gộp bàn','Merge'),()=>amend(c,'s'+session.ref.id,'Session.Merge',{sourceSessionId:session.ref.id,targetSessionId:into.input.value,expectedSourceVersion:session.version,expectedTargetVersion:other()?.version??0},session.version),'quiet');
  moveButton.disabled=frozen||!freeTables.length;mergeButton.disabled=frozen||!others.length;
  row.append(to.node,moveButton,into.node,mergeButton);
  for(const order of orders.filter(o=>o.state.sessionId===session.ref.id&&o.state.status==='open')){
   const key='o'+order.ref.id,orderNote=staleNote(c,key,order.version);if(orderNote)row.append(orderNote);
   const fired=(order.state.courses??{}) as Record<string,string>; // course >1 waits until Order.SendCourse fires it
   for(const course of [...new Set(((order.state.lines as JsonObject[]|undefined)??[]).map(l=>Number(l.course??1)).filter(n=>n>1&&fired[String(n)]!=='fired'))].sort())row.append(button(tr(c,`Gọi món đợt ${course}`,`Fire course ${course}`),()=>amend(c,key,'Order.SendCourse',{orderId:order.ref.id,course},order.version),'quiet'));
   for(const line of (order.state.lines as JsonObject[]|undefined)??[]){
    const active=BigInt(String(line.quantity))-BigInt(String(line.cancelledQuantity??'0'));if(active<=0n)continue;
    const e=edit('l'+line.id),qty=field(tr(c,'Số lượng hủy','Quantity to cancel'),e.quantity,'number'),why=field(tr(c,'Lý do','Reason'),e.reason);qty.input.min='1';qty.input.max=String(active);qty.input.step='1';
    qty.input.addEventListener('input',()=>{e.quantity=qty.input.value;});why.input.addEventListener('input',()=>{e.reason=why.input.value;});
    row.append(el('p',`${String(line.name)} × ${String(active)}${line.cancelledQuantity&&line.cancelledQuantity!=='0'?` (${tr(c,'đã hủy','cancelled')} ${String(line.cancelledQuantity)})`:''}`),qty.node,why.node,button(tr(c,'Hủy món','Cancel item'),()=>amend(c,key,'Order.Amend',{lineId:String(line.id),cancelQuantity:qty.input.value,reason:why.input.value},order.version),'danger'));
   }
  }
  box.append(row);
 }
 if(!box.children.length)box.append(el('p',tr(c,'Chưa có bàn nào đang phục vụ.','No open tables.')));
 return box;
}
export function Pos(c:ScreenContext) {
 const root=el('div',undefined,'two-columns'),menu=list(c,'catalog').find(s=>s.ref.id==='current');
 const options=list(c,'table').map(t=>({id:t.ref.id,name:String(t.state.name??t.ref.id)}));
 const table=select(tr(c,'Bàn','Table'),options,draft.tableId);draft.tableId=table.input.value;
 table.input.addEventListener('change',()=>{draft.tableId=table.input.value;});
 const cart=el('div',undefined,'cart'),grid=el('div',undefined,'menu-grid'),chooser=el('div',undefined,'modifier-chooser'),quoteBox=el('div',undefined,'server-quote');
 const items=(Array.isArray(menu?.state.items)?menu.state.items:[]) as JsonObject[];
 const mayDiscount=c.session.permissions.includes('*')||c.session.permissions.includes('discount.apply');
 const coupons=(mayDiscount?((menu?.state.pricing as JsonObject|undefined)?.discounts??[]):[]) as JsonObject[]; // the server enforces discount.apply and the discount feature; hiding is only UX
 const payload=(extra:JsonObject={}):JsonObject=>({tableId:table.input.value,menuVersion:menu?.state.version??0,items:draft.lines.map(l=>({itemId:l.itemId,quantity:l.quantity,...(l.modifiers.length?{modifiers:l.modifiers}:{}),...(l.measure?{measure:l.measure}:{})})),...(draft.discountIds.length?{discountIds:draft.discountIds}:{}),...extra});
 const changeCart=()=>{draft.quote=undefined;draft.operationId=crypto.randomUUID();renderCart();};
 const noteStale=(code?:string)=>{if(code!=='STALE_QUOTE')return false;draft.stale=true;draft.operationId=crypto.randomUUID();c.notify(tr(c,'Thực đơn đã thay đổi. Kiểm tra giỏ rồi bấm "Tính giá" để xác nhận lại.','The menu changed. Review the cart and press "Get price" to re-confirm.'),true);return true;};
 const getQuote=button(tr(c,'Tính giá','Get price'),async()=>{
   if(!draft.lines.length)return;
   try{const r=await c.command('Catalog.Quote',payload());
     if(r.status==='accepted'){draft.quote=r.value;draft.stale=false;}
     else if(!noteStale(r.code))c.notify(r.code??r.status,true);
   }catch(error){c.notify(error instanceof Error?error.message:'UNAVAILABLE',true);}
   renderCart();
 },'quiet');
 const orderButton=button(tr(c,'Gửi bếp','Send to kitchen'),async()=>{
   if(!draft.lines.length)return;
   const tableId=table.input.value;
   const session=list(c,'session').find(s=>s.state.tableId===tableId&&s.state.status==='open');
   let sessionId=session?.ref.id;
   if(!sessionId){sessionId='session-'+crypto.randomUUID();const opened=await act(c,'Session.Open',{sessionId,tableId},undefined,draft.operationId+'-session');if(opened?.status!=='accepted')return;}
   const result=await act(c,'Order.Place',payload({sessionId}),undefined,draft.operationId);
   if(result?.status==='accepted'){draft=fresh(tableId);await c.refresh();}
   else if(noteStale(result?.code)){await c.refresh();}
 });
 const renderQuote=()=>{
   quoteBox.replaceChildren();const q=draft.quote;if(!q)return;
   const currency=String(q.currency);
   for(const line of (q.lines as JsonObject[])){
     const row=el('div',undefined,'quote-line');row.append(el('span',`${String(line.name)} × ${String(line.quantity)}`),el('strong',money(line.subtotalMinor,currency)));quoteBox.append(row);
     for(const m of (line.modifiers as JsonObject[])??[])quoteBox.append(el('small',`  + ${String(m.name)} (${money(m.priceMinor,currency)})`,'muted'));
   }
   const part=(label:string,value:unknown)=>{if(BigInt(String(value))!==0n)quoteBox.append(el('p',`${label}: ${money(value,currency)}`));};
   part(tr(c,'Giảm giá','Discount'),q.discountMinor);part(tr(c,'Phí dịch vụ','Service charge'),q.serviceMinor);part(tr(c,'Thuế','Tax'),q.taxMinor);part(tr(c,'Thuế đã gồm trong giá','Tax included'),q.taxIncludedMinor);
   quoteBox.append(el('p',tr(c,'Giá từ máy chủ · ','Server price · ')+money(q.totalMinor,currency),'total'));
 };
 const renderCart=()=>{
   cart.replaceChildren();let estimate=0n;
   draft.lines.forEach((line,index)=>{
     const item=items.find(i=>i.id===line.itemId);if(!item)return;
     const row=el('div',undefined,'cart-line'),detail=line.modifiers.map(p=>{const o=(((item.modifierGroups as JsonObject[]|undefined)??[]).find(g=>g.id===p.groupId)?.options as JsonObject[]|undefined)?.find(x=>x.id===p.optionId);return String(o?.name??p.optionId);});
     if(line.measure)detail.push(`${String(line.measure.mass)} ${String((item.weighed as JsonObject).unit)}`);
     row.append(el('span',String(item.name)+(detail.length?` (${detail.join(', ')})`:'')),el('strong',line.quantity));
     row.append(button(tr(c,'Bớt ','Remove ')+String(item.name),()=>{const left=BigInt(line.quantity)-1n;if(left>0n)line.quantity=String(left);else draft.lines.splice(index,1);changeCart();},'quiet'));
     cart.append(row);estimate+=line.measure?BigInt(priceByMass(String(item.unitMinor),String(line.measure.mass),String((item.weighed as JsonObject).unitMass))):BigInt(String(item.unitMinor))*BigInt(line.quantity);
   });
   if(coupons.length){const box=el('div',undefined,'coupons');for(const coupon of coupons){const label=el('label'),input=el('input');input.type='checkbox';input.checked=draft.discountIds.includes(String(coupon.id));input.addEventListener('change',()=>{draft.discountIds=input.checked?[...draft.discountIds,String(coupon.id)]:draft.discountIds.filter(id=>id!==coupon.id);changeCart();});label.append(input,el('span',String(coupon.name)));box.append(label);}cart.append(box);}
   cart.append(el('p',tr(c,'Tạm tính (chưa gồm tùy chọn, thuế, phí) · ','Estimate (before options, tax, fees) · ')+money(estimate),'total'),getQuote);
   if(draft.stale)cart.append(el('p',tr(c,'Thực đơn đã đổi: cần xác nhận lại giá.','Menu changed: re-confirm the price.'),'muted'));
   getQuote.disabled=!draft.lines.length;
   orderButton.disabled=!draft.lines.length||draft.stale||!table.input.value||Boolean(c.session.pendingOperations?.some(p=>p.type==='Order.Place'&&p.tableId===table.input.value));
   renderQuote();
 };
 const addLine=(line:CartLine)=>{const existing=draft.lines.find(l=>sameLine(l,line));if(existing)existing.quantity=String(BigInt(existing.quantity)+1n);else draft.lines.push(line);chooser.replaceChildren();changeCart();};
 const choose=(item:JsonObject)=>{
   chooser.replaceChildren();const picks=new Map<string,string[]>();
   chooser.append(el('h3',String(item.name)));
   for(const group of item.modifierGroups as JsonObject[]){
     const opts=group.options as JsonObject[],label=el('fieldset'),single=Number(group.max)===1;label.append(el('legend',String(group.name)+(Number(group.min)>0?' *':'')));picks.set(String(group.id),[]);
     for(const option of opts){
       const wrap=el('label'),input=el('input');input.type=single?'radio':'checkbox';input.name='mod-'+String(group.id);input.disabled=option.available===false;
       input.addEventListener('change',()=>{const now=single?[String(option.id)]:[...picks.get(String(group.id))!.filter(id=>id!==option.id),...(input.checked?[String(option.id)]:[])];picks.set(String(group.id),now);});
       wrap.append(input,el('span',`${String(option.name)}${group.kind==='size'?' · ':' +'}${money(option.priceMinor)}`));label.append(wrap);
     }
     chooser.append(label);
   }
   chooser.append(button(tr(c,'Thêm vào giỏ','Add to cart'),()=>addLine({itemId:String(item.id),quantity:'1',modifiers:[...picks].flatMap(([groupId,ids])=>ids.map(optionId=>({groupId,optionId})))})),button(tr(c,'Hủy','Cancel'),()=>{chooser.replaceChildren();},'quiet'));
 };
 // A weighed item enters the cart with the weight the manager keyed (there is no approved scale to read); the measure travels to Order.Place, which prices it and checks weighed.manual.
 const weigh=(item:JsonObject)=>{
   chooser.replaceChildren();const mass=field(`${String(item.name)} · ${tr(c,'khối lượng','weight')} (${String((item.weighed as JsonObject).unit)})`,'','number');mass.input.min='1';mass.input.step='1';
   chooser.append(mass.node,button(tr(c,'Thêm vào giỏ','Add to cart'),()=>{const m=mass.input.value;if(!/^[1-9][0-9]{0,11}$/.test(m)){c.notify(tr(c,'Nhập khối lượng là số nguyên dương.','Enter the weight as a positive whole number.'),true);return;}chooser.replaceChildren();addLine({itemId:String(item.id),quantity:'1',modifiers:[],measure:{mass:m,source:'manual'}});}),button(tr(c,'Hủy','Cancel'),()=>{chooser.replaceChildren();},'quiet'));
 };
 for(const item of items){const card=button(String(item.name),()=>{if(item.weighed){weigh(item);return;}if((item.modifierGroups as unknown[]|undefined)?.length)choose(item);else addLine({itemId:String(item.id),quantity:'1',modifiers:[]});},'menu-item');card.append(el('span',money(item.unitMinor),'price'));card.disabled=item.available===false;grid.append(card);}
 if(!items.length)grid.append(el('p',tr(c,'Chưa có thực đơn được áp dụng tại nhà hàng.','No menu has been applied to this venue.')));
 root.append(panel(tr(c,'Thực đơn','Menu'),grid,chooser),panel(tr(c,'Đơn mới','New order'),table.node,cart,quoteBox,orderButton,el('p',tr(c,'Giỏ được giữ đến khi nhà hàng xác nhận. Giá cuối cùng do bộ điều phối tính.','The cart stays until restaurant acceptance. The coordinator calculates final prices.'),'muted')));renderCart();const page=el('div');page.append(root,panel(tr(c,'Bàn đang phục vụ','Open tables'),tables(c)));return page;
}
