import type {JsonObject} from '../../../../packages/contracts/src/index';
import {guestCommand} from '../../../../packages/domain/src/service/guest-token';
import {el,field,panel,list,tr,money,button,type ScreenContext} from '../ui';
type Submit=(type:string,payload:JsonObject)=>Promise<void>;
const cart=new Map<string,bigint>();
/** Guest ordering block shared by the kiosk and the robot screen: no modifiers or coupons (items that need options go through staff). */
export function guestOrdering(c:ScreenContext,submit:Submit):HTMLElement {
 const menu=list(c,'catalog').find(s=>s.ref.id==='current'),items=((menu?.state.items??[]) as JsonObject[]).filter(i=>i.available!==false&&!(i.modifierGroups as unknown[]|undefined)?.length);
 const grid=el('div',undefined,'menu-grid'),basket=el('div',undefined,'cart'),root=el('div',undefined,'two-columns');
 const draw=()=>{
  basket.replaceChildren();let total=0n;
  for(const [id,n] of cart){const item=items.find(i=>i.id===id);if(!item){cart.delete(id);continue;}total+=BigInt(String(item.unitMinor))*n;
   const row=el('div',undefined,'cart-line');row.append(el('span',`${String(item.name)} × ${n}`),button(tr(c,'Bớt','Remove'),()=>{if(n>1n)cart.set(id,n-1n);else cart.delete(id);draw();},'quiet'));basket.append(row);}
  const send=button(tr(c,'Gửi món','Send order'),async()=>{await submit('Order.Place',{menuVersion:menu?.state.version??0,items:[...cart].map(([itemId,n])=>({itemId,quantity:String(n)}))});cart.clear();draw();});
  send.disabled=!cart.size;basket.append(el('p',tr(c,'Tạm tính · ','Estimate · ')+money(total),'total'),send);
 };
 for(const item of items){const card=button(String(item.name),()=>{cart.set(String(item.id),(cart.get(String(item.id))??0n)+1n);draw();},'menu-item');card.append(el('span',money(item.unitMinor),'price'));grid.append(card);}
 if(!items.length)grid.append(el('p',tr(c,'Chưa có món tự gọi. Vui lòng gọi nhân viên.','Nothing to self-order yet. Please call staff.')));
 draw();
 const help=el('div');help.append(button(tr(c,'Gọi nhân viên','Call staff'),()=>submit('Guest.CallStaff',{}),'quiet'),button(tr(c,'Yêu cầu thanh toán','Request the bill'),()=>submit('Guest.RequestBill',{}),'quiet'));
 root.append(panel(tr(c,'Thực đơn','Menu'),grid),panel(tr(c,'Món đã chọn','Your order'),basket,help,el('p',tr(c,'Món chỉ được nhận khi nhà hàng xác nhận. Thanh toán luôn do nhân viên thu.','An order counts only once the restaurant confirms it. Staff always take payment.'),'muted')));
 return root;
}
/** Result shown to a guest: accepted, or a plain reason; an expired seating asks for a new code from staff. */
export async function guestSubmit(c:ScreenContext,type:string,payload:JsonObject,onExpired=()=>{}):Promise<void> {
 try{const r=await c.command(type,payload);
  if(r.status==='accepted')c.notify(type==='Guest.PlaceOrder'?tr(c,'Nhà hàng đã nhận món','The restaurant received your order'):tr(c,'Đã báo nhân viên','Staff have been notified'));
  else if(r.code==='SESSION_EXPIRED'||r.code==='GUEST_TOKEN_EXPIRED'){onExpired();c.notify(tr(c,'Phiên bàn đã kết thúc. Nhờ nhân viên cấp mã mới.','This table session has ended. Ask staff for a new code.'),true);}
  else c.notify(r.status==='unknown'?tr(c,'Chưa rõ nhà hàng đã nhận chưa. Vui lòng gọi nhân viên.','Not confirmed by the restaurant yet. Please call staff.'):r.code??r.status,true);
 }catch{c.notify(tr(c,'Không kết nối được nhà hàng. Vui lòng gọi nhân viên.','Cannot reach the restaurant. Please call staff.'),true);}
 await c.refresh();
}
const KEY='mekoniq-kiosk-token';
/** Kiosk: a venue device holding a staff-issued kiosk token. Scope (session/table) comes only from the signed token the venue re-verifies. */
export function Kiosk(c:ScreenContext) {
 const token=localStorage.getItem(KEY);
 if(!token){
  const code=field(tr(c,'Mã kiosk do nhân viên cấp','Kiosk code from staff'));
  return panel(tr(c,'Kiosk gọi món','Ordering kiosk'),code.node,button(tr(c,'Bắt đầu','Start'),async()=>{localStorage.setItem(KEY,code.input.value.trim());await c.refresh();}));
 }
 const submit=async(type:string,payload:JsonObject)=>{let built;try{built=guestCommand(token,type,payload);}catch(error){c.notify(String((error as Error).message),true);return;}await guestSubmit(c,built.type,built.payload,()=>localStorage.removeItem(KEY));};
 return panel(tr(c,'Kiosk gọi món','Ordering kiosk'),guestOrdering(c,submit),button(tr(c,'Kết thúc phiên kiosk','End kiosk session'),async()=>{localStorage.removeItem(KEY);await c.refresh();},'danger'));
}
