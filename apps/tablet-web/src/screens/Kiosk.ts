import type {JsonObject} from '../../../../packages/contracts/src/index';
import {decodeGuestToken,guestCommand} from '../../../../packages/domain/src/service/guest-token';
import {el,field,panel,list,tr,money,button,type ScreenContext} from '../ui';
type Submit=(type:string,payload:JsonObject,operationId?:string)=>Promise<boolean>;
export type GuestDraft={key:string;lines:Map<string,bigint>;operationId:string};
const blank=(key:string):GuestDraft=>({key,lines:new Map(),operationId:crypto.randomUUID()});
let draft=blank('');
/**
 * The cart belongs to one seating: keyed by kiosk token id or robot+session, it is dropped when the key changes (new code, robot at another
 * table, kiosk ended). Its operation id is stable until the cart changes, so a retry after an unknown result can never place a second order.
 */
export function guestDraft(key:string):GuestDraft{if(draft.key!==key)draft=blank(key);return draft;}
export function endGuestDraft(){draft=blank('');}
/** Guest ordering block shared by the kiosk and the robot screen: no modifiers or coupons (items that need options go through staff). */
export function guestOrdering(c:ScreenContext,key:string,submit:Submit):HTMLElement {
 const menu=list(c,'catalog').find(s=>s.ref.id==='current'),items=((menu?.state.items??[]) as JsonObject[]).filter(i=>i.available!==false&&!(i.modifierGroups as unknown[]|undefined)?.length);
 const cart=guestDraft(key),changed=()=>{cart.operationId=crypto.randomUUID();draw();};
 const grid=el('div',undefined,'menu-grid'),basket=el('div',undefined,'cart'),root=el('div',undefined,'two-columns');
 const draw=()=>{
  basket.replaceChildren();let total=0n;
  for(const [id,n] of cart.lines){const item=items.find(i=>i.id===id);if(!item){cart.lines.delete(id);continue;}total+=BigInt(String(item.unitMinor))*n;
   const row=el('div',undefined,'cart-line');row.append(el('span',`${String(item.name)} × ${n}`),button(tr(c,'Bớt','Remove'),()=>{if(n>1n)cart.lines.set(id,n-1n);else cart.lines.delete(id);changed();},'quiet'));basket.append(row);}
  const send=button(tr(c,'Gửi món','Send order'),async()=>{
   // Only an accepted order empties the cart; on rejection or an unknown result the selection and its operation id stay for a retry.
   if(await submit('Order.Place',{menuVersion:menu?.state.version??0,items:[...cart.lines].map(([itemId,n])=>({itemId,quantity:String(n)}))},cart.operationId)){cart.lines.clear();cart.operationId=crypto.randomUUID();}
   draw();
  });
  send.disabled=!cart.lines.size;basket.append(el('p',tr(c,'Tạm tính · ','Estimate · ')+money(total),'total'),send);
 };
 for(const item of items){const card=button(String(item.name),()=>{cart.lines.set(String(item.id),(cart.lines.get(String(item.id))??0n)+1n);changed();},'menu-item');card.append(el('span',money(item.unitMinor),'price'));grid.append(card);}
 if(!items.length)grid.append(el('p',tr(c,'Chưa có món tự gọi. Vui lòng gọi nhân viên.','Nothing to self-order yet. Please call staff.')));
 draw();
 const help=el('div');help.append(button(tr(c,'Gọi nhân viên','Call staff'),()=>submit('Guest.CallStaff',{}).then(()=>{}),'quiet'),button(tr(c,'Yêu cầu thanh toán','Request the bill'),()=>submit('Guest.RequestBill',{}).then(()=>{}),'quiet'));
 root.append(panel(tr(c,'Thực đơn','Menu'),grid),panel(tr(c,'Món đã chọn','Your order'),basket,help,el('p',tr(c,'Món chỉ được nhận khi nhà hàng xác nhận. Thanh toán luôn do nhân viên thu.','An order counts only once the restaurant confirms it. Staff always take payment.'),'muted')));
 return root;
}
/** Result shown to a guest: accepted (true), or a plain reason (false); an expired seating asks for a new code from staff. */
export async function guestSubmit(c:ScreenContext,type:string,payload:JsonObject,operationId?:string,onExpired=()=>{}):Promise<boolean> {
 let accepted=false;
 try{const r=await c.command(type,payload,undefined,operationId);accepted=r.status==='accepted';
  if(accepted)c.notify(type==='Guest.PlaceOrder'?tr(c,'Nhà hàng đã nhận món','The restaurant received your order'):tr(c,'Đã báo nhân viên','Staff have been notified'));
  else if(r.code==='SESSION_EXPIRED'||r.code==='GUEST_TOKEN_EXPIRED'){onExpired();c.notify(tr(c,'Phiên bàn đã kết thúc. Nhờ nhân viên cấp mã mới.','This table session has ended. Ask staff for a new code.'),true);}
  else c.notify(r.status==='unknown'?tr(c,'Chưa rõ nhà hàng đã nhận chưa. Vui lòng gọi nhân viên.','Not confirmed by the restaurant yet. Please call staff.'):r.code??r.status,true);
 }catch{c.notify(tr(c,'Không kết nối được nhà hàng. Vui lòng gọi nhân viên.','Cannot reach the restaurant. Please call staff.'),true);}
 await c.refresh();
 return accepted;
}
const KEY='mekoniq-kiosk-token';
/** Kiosk: a venue device holding a staff-issued kiosk token. Scope (session/table) comes only from the signed token the venue re-verifies. */
export function Kiosk(c:ScreenContext) {
 const token=localStorage.getItem(KEY);
 if(!token){
  const code=field(tr(c,'Mã kiosk do nhân viên cấp','Kiosk code from staff'));
  return panel(tr(c,'Kiosk gọi món','Ordering kiosk'),code.node,button(tr(c,'Bắt đầu','Start'),async()=>{localStorage.setItem(KEY,code.input.value.trim());await c.refresh();}));
 }
 const end=()=>{localStorage.removeItem(KEY);endGuestDraft();};
 const submit=async(type:string,payload:JsonObject,operationId?:string)=>{let built;try{built=guestCommand(token,type,payload);}catch(error){c.notify(String((error as Error).message),true);return false;}return guestSubmit(c,built.type,built.payload,operationId,end);};
 let tokenId='';try{tokenId=String(decodeGuestToken(token).id);}catch{/* an unreadable code is refused by guestCommand on send */}
 return panel(tr(c,'Kiosk gọi món','Ordering kiosk'),guestOrdering(c,'kiosk:'+tokenId,submit),button(tr(c,'Kết thúc phiên kiosk','End kiosk session'),async()=>{end();await c.refresh();},'danger'));
}
