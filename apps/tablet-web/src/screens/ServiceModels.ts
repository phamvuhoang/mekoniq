import {el,field,select,panel,list,tr,button,act,summary,money,type ScreenContext} from '../ui';
import type {JsonObject} from '../../../../packages/contracts/src/index';
import {buffetStatus} from '../../../../packages/domain/src/pricing/buffet';
/** Buffet timers, weighed-item and combo quotes. Prices come from the coordinator's quote (server-side rules); the clock shown is the wall clock, flags are for the manager. */
export function ServiceModels(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),menu=list(c,'catalog').find(s=>s.ref.id==='current'),items=((menu?.state.items??[]) as JsonObject[]),opt=(xs:JsonObject[])=>xs.map(i=>({id:String(i.id),name:String(i.name??i.id)}));
 const can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p),now=Date.now();
 for(const b of list(c,'buffet').filter(x=>x.state.status==='active')){
  const row=summary(b),st=buffetStatus({plannedEndMs:Number(b.state.plannedEndMs)},now),mins=Math.max(0,Math.round(st.remainingMs/60000));
  row.append(el('p',`${String(b.state.tableId)} · ${String(b.state.guests)} ${tr(c,'khách','guests')} · ${st.expired?tr(c,'đã hết giờ','time is up'):tr(c,`còn ${mins} phút`,`${mins} min left`)}`,st.expired?'warning':'muted'));
  const flags=(b.state.flags as string[]).filter(Boolean);
  if(flags.length)row.append(el('p',tr(c,`Cần xem lại đồng hồ: ${flags.join(', ')} (giá không đổi)`,`Check the clock: ${flags.join(', ')} (price unchanged)`),'warning'));
  row.append(button(tr(c,'Gia hạn','Extend'),()=>act(c,'Buffet.Extend',{buffetId:b.ref.id}).then(()=>{})));
  root.append(row);
 }
 const packages=items.filter(i=>i.buffet);
 if(packages.length&&can('order.write')){
  const sessions=list(c,'session').filter(s=>s.state.status==='open').map(s=>({id:s.ref.id,name:`${s.ref.id} · ${String(s.state.tableId)}`})),pkg=select(tr(c,'Gói buffet','Buffet package'),opt(packages)),ses=select(tr(c,'Phiên bàn','Table session'),sessions),guests=field(tr(c,'Số khách','Guests'),'2','number');
  root.append(ses.node,pkg.node,guests.node,button(tr(c,'Bắt đầu buffet','Start buffet'),()=>{const s=list(c,'session').find(x=>x.ref.id===ses.input.value);return act(c,'Buffet.Start',{sessionId:ses.input.value,tableId:String(s?.state.tableId??''),menuVersion:Number(menu?.state.version),packageItemId:pkg.input.value,guests:Number(guests.input.value)}).then(()=>{});}));
 }
 const out=el('p',undefined,'total');out.setAttribute('role','status');
 const weighed=items.filter(i=>i.weighed);
 if(weighed.length){
  const item=select(tr(c,'Món bán theo cân','Weighed item'),opt(weighed)),mass=field(tr(c,'Khối lượng (g/ml)','Mass (g/ml)'),'','number');
  root.append(item.node,mass.node,button(tr(c,'Tính tiền theo cân','Price by weight'),async()=>{
   const r=await act(c,'WeighedItem.Quote',{itemId:item.input.value,measure:{mass:mass.input.value,source:'manual'}});
   out.textContent=r?.status==='accepted'?`${tr(c,'Thành tiền','Price')}: ${money(r.value.totalMinor,String(r.value.currency))}`:'';
  }),el('p',tr(c,'Nhập tay cần quyền quản lý; chưa có cân được duyệt thì không có chế độ "đọc từ cân".','Keyed weights need manager approval; without an approved scale there is no "read from scale" mode.'),'muted'));
 }
 const combos=items.filter(i=>i.combo);
 if(combos.length){
  const combo=select(tr(c,'Combo','Combo'),opt(combos)),qty=field(tr(c,'Số lượng','Quantity'),'1','number');
  root.append(combo.node,qty.node,button(tr(c,'Xem thành phần combo','Show combo parts'),async()=>{
   const r=await act(c,'Combo.Quote',{comboItemId:combo.input.value,quantity:qty.input.value});
   const parts=((r?.value.lines as JsonObject[]|undefined)?.[0]?.components??[]) as JsonObject[];
   out.textContent=r?.status==='accepted'?parts.map(p=>`${String(p.name)} ×${String(p.quantity)} = ${money(p.shareMinor)}`).join(' · '):'';
  }));
 }
 root.append(out);
 if(!root.children.length||(!packages.length&&!weighed.length&&!combos.length&&!list(c,'buffet').length))root.prepend(el('p',tr(c,'Thực đơn chưa có món buffet, theo cân hoặc combo.','The menu has no buffet, weighed or combo items.'),'muted'));
 return panel(tr(c,'Buffet, combo và món theo cân','Buffet, combos and weighed items'),root);
}
