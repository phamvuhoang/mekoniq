import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,select,panel,list,tr,money,button,act,type ScreenContext} from '../ui';
type Draft={tableId:string;items:Record<string,string>;operationId:string};
let draft:Draft={tableId:'',items:{},operationId:crypto.randomUUID()};
export function Pos(c:ScreenContext) {
 const root=el('div',undefined,'two-columns'),menu=list(c,'catalog').find(s=>s.ref.id==='current');
 const options=list(c,'table').map(t=>({id:t.ref.id,name:String(t.state.name??t.ref.id)}));
 const table=select(tr(c,'Bàn','Table'),options,draft.tableId);draft.tableId=table.input.value;
 table.input.addEventListener('change',()=>{draft.tableId=table.input.value;});
 const cart=el('div',undefined,'cart'),grid=el('div',undefined,'menu-grid');
 const items=(Array.isArray(menu?.state.items)?menu.state.items:[]) as JsonObject[];
 const orderButton=button(tr(c,'Gửi bếp','Send to kitchen'),async()=>{
   const chosen=Object.entries(draft.items).filter(([,n])=>BigInt(n)>0n).map(([itemId,quantity])=>({itemId,quantity}));
   if(!chosen.length)return;
   const tableId=table.input.value;
   const session=list(c,'session').find(s=>s.state.tableId===tableId&&s.state.status==='open');
   let sessionId=session?.ref.id;
   if(!sessionId){sessionId='session-'+crypto.randomUUID();const opened=await act(c,'Session.Open',{sessionId,tableId},undefined,draft.operationId+'-session');if(opened?.status!=='accepted')return;}
   const result=await act(c,'Order.Place',{sessionId,tableId,menuVersion:menu?.state.version??0,items:chosen},undefined,draft.operationId);
   if(result?.status==='accepted'){draft={tableId,items:{},operationId:crypto.randomUUID()};await c.refresh();}
 });
 const renderCart=()=>{
   cart.replaceChildren();let total=0n;
   for(const [id,quantity] of Object.entries(draft.items)){
     const item=items.find(i=>i.id===id);if(!item||quantity==='0')continue;
     const row=el('div',undefined,'cart-line');row.append(el('span',String(item.name)),el('strong',quantity));
     row.append(button(tr(c,'Bớt ','Remove ')+String(item.name),()=>{draft.items[id]=String(BigInt(draft.items[id]!)-1n);renderCart();},'quiet'));
     cart.append(row);total+=BigInt(String(item.unitMinor))*BigInt(quantity);
   }
   cart.append(el('p',tr(c,'Tạm tính · ','Estimate · ')+money(total),'total'));orderButton.disabled=total===0n||!table.input.value||Boolean(c.session.pendingOperations?.some(p=>p.type==='Order.Place'&&p.tableId===table.input.value));
 };
 for(const item of items){const card=button(String(item.name),()=>{draft.items[String(item.id)]=String(BigInt(draft.items[String(item.id)]??'0')+1n);renderCart();},'menu-item');card.append(el('span',money(item.unitMinor),'price'));card.disabled=item.available===false;grid.append(card);}
 if(!items.length)grid.append(el('p',tr(c,'Chưa có thực đơn được áp dụng tại nhà hàng.','No menu has been applied to this venue.')));
 root.append(panel(tr(c,'Thực đơn','Menu'),grid),panel(tr(c,'Đơn mới','New order'),table.node,cart,orderButton,el('p',tr(c,'Giỏ được giữ đến khi nhà hàng xác nhận. Giá cuối cùng do bộ điều phối tính.','The cart stays until restaurant acceptance. The coordinator calculates final prices.'),'muted')));renderCart();return root;
}
