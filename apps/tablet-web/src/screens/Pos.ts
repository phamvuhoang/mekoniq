import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,select,panel,list,tr,money,button,act,type ScreenContext} from '../ui';
type Pick={groupId:string;optionId:string};
type CartLine={itemId:string;quantity:string;modifiers:Pick[]};
type Draft={tableId:string;lines:CartLine[];discountIds:string[];operationId:string;quote?:JsonObject;stale:boolean};
const fresh=(tableId=''):Draft=>({tableId,lines:[],discountIds:[],operationId:crypto.randomUUID(),stale:false});
let draft=fresh();
const sameLine=(a:CartLine,b:CartLine)=>a.itemId===b.itemId&&JSON.stringify(a.modifiers)===JSON.stringify(b.modifiers);
export function Pos(c:ScreenContext) {
 const root=el('div',undefined,'two-columns'),menu=list(c,'catalog').find(s=>s.ref.id==='current');
 const options=list(c,'table').map(t=>({id:t.ref.id,name:String(t.state.name??t.ref.id)}));
 const table=select(tr(c,'Bàn','Table'),options,draft.tableId);draft.tableId=table.input.value;
 table.input.addEventListener('change',()=>{draft.tableId=table.input.value;});
 const cart=el('div',undefined,'cart'),grid=el('div',undefined,'menu-grid'),chooser=el('div',undefined,'modifier-chooser'),quoteBox=el('div',undefined,'server-quote');
 const items=(Array.isArray(menu?.state.items)?menu.state.items:[]) as JsonObject[];
 const mayDiscount=c.session.permissions.includes('*')||c.session.permissions.includes('discount.apply');
 const coupons=(mayDiscount?((menu?.state.pricing as JsonObject|undefined)?.discounts??[]):[]) as JsonObject[]; // the server enforces discount.apply and the discount feature; hiding is only UX
 const payload=(extra:JsonObject={}):JsonObject=>({tableId:table.input.value,menuVersion:menu?.state.version??0,items:draft.lines.map(l=>({itemId:l.itemId,quantity:l.quantity,...(l.modifiers.length?{modifiers:l.modifiers}:{})})),...(draft.discountIds.length?{discountIds:draft.discountIds}:{}),...extra});
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
     row.append(el('span',String(item.name)+(detail.length?` (${detail.join(', ')})`:'')),el('strong',line.quantity));
     row.append(button(tr(c,'Bớt ','Remove ')+String(item.name),()=>{const left=BigInt(line.quantity)-1n;if(left>0n)line.quantity=String(left);else draft.lines.splice(index,1);changeCart();},'quiet'));
     cart.append(row);estimate+=BigInt(String(item.unitMinor))*BigInt(line.quantity);
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
 for(const item of items){const card=button(String(item.name),()=>{if((item.modifierGroups as unknown[]|undefined)?.length)choose(item);else addLine({itemId:String(item.id),quantity:'1',modifiers:[]});},'menu-item');card.append(el('span',money(item.unitMinor),'price'));card.disabled=item.available===false;grid.append(card);}
 if(!items.length)grid.append(el('p',tr(c,'Chưa có thực đơn được áp dụng tại nhà hàng.','No menu has been applied to this venue.')));
 root.append(panel(tr(c,'Thực đơn','Menu'),grid,chooser),panel(tr(c,'Đơn mới','New order'),table.node,cart,quoteBox,orderButton,el('p',tr(c,'Giỏ được giữ đến khi nhà hàng xác nhận. Giá cuối cùng do bộ điều phối tính.','The cart stays until restaurant acceptance. The coordinator calculates final prices.'),'muted')));renderCart();return root;
}
