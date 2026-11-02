import {el,field,select,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
import type {JsonObject} from '../../../../packages/contracts/src/index';
/** One line per ingredient: `ingredientId quantity unit unitCostMinor`, e.g. `rice-raw 10 kg 21000` (cost is per ordering unit). */
export function parsePurchaseLines(text:string):JsonObject[] {
 return text.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [ingredientId,quantity,unit,unitCostMinor]=l.split(/\s+/);return {ingredientId:ingredientId!,quantity:quantity??'',...(unit?{unit}:{}),unitCostMinor:unitCostMinor??''};});
}
export function Purchasing(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p);
 const suppliers=list(c,'supplier');
 for(const po of list(c,'purchase').sort((a,b)=>String(b.state.createdAt).localeCompare(String(a.state.createdAt)))){
  const row=summary(po),status=String(po.state.status);
  row.append(el('p',`${String(po.state.supplierId)} · ${(po.state.lines as JsonObject[]).map(l=>`${String(l.ingredientId)} ${String(l.received)}/${String(l.ordered)}${BigInt(String(l.returned))>0n?` (${tr(c,'trả','returned')} ${String(l.returned)})`:''}`).join(' · ')}`,'muted'));
  if(status==='draft'&&can('procurement.approve'))row.append(button(tr(c,'Duyệt đơn mua','Approve order'),()=>act(c,'Purchase.Approve',{purchaseId:po.ref.id},po.version).then(()=>{})));
  if(['approved','partially_received'].includes(status)){
   const number=field(tr(c,'Số phiếu giao của nhà cung cấp','Supplier delivery note no.')),ingredient=select(tr(c,'Nguyên liệu','Ingredient'),(po.state.lines as JsonObject[]).map(l=>({id:String(l.ingredientId),name:String(l.ingredientId)}))),qty=field(tr(c,'Số lượng nhận','Quantity received'),'','number'),unit=field(tr(c,'Đơn vị (trống = đơn vị gốc)','Unit (blank = base unit)'));
   row.append(number.node,ingredient.node,qty.node,unit.node,button(tr(c,'Nhận hàng','Receive goods'),()=>act(c,'Goods.Receive',{purchaseId:po.ref.id,supplierReceipt:number.input.value,ingredientId:ingredient.input.value,quantity:qty.input.value,...(unit.input.value?{unit:unit.input.value}:{})}).then(()=>{})));
   if(can('procurement.approve')){const why=field(tr(c,'Lý do đóng đơn','Reason to close'));row.append(why.node,button(tr(c,'Đóng đơn (không nhận thêm)','Close order (no more deliveries)'),()=>act(c,'Purchase.Close',{purchaseId:po.ref.id,reason:why.input.value},po.version).then(()=>{})));}
  }
  root.append(row);
 }
 for(const receipt of list(c,'goods-receipt').sort((a,b)=>String(b.state.occurredAt).localeCompare(String(a.state.occurredAt))).slice(0,20)){
  const row=summary(receipt);row.append(el('p',`${String(receipt.state.supplierReceipt)} · ${(receipt.state.lines as JsonObject[]).map(l=>`${String(l.ingredientId)} ${String(l.baseQuantity)}${BigInt(String(l.returned))>0n?` (−${String(l.returned)})`:''}`).join(' · ')}`,'muted'));
  const ingredient=(receipt.state.lines as JsonObject[])[0],qty=field(tr(c,'Số lượng trả','Quantity returned'),'','number'),why=field(tr(c,'Lý do trả (bắt buộc)','Return reason (required)'));
  if(ingredient)row.append(qty.node,why.node,button(tr(c,'Trả hàng cho nhà cung cấp','Return to supplier'),()=>act(c,'Goods.Return',{sourceEventId:crypto.randomUUID(),receiptId:receipt.ref.id,ingredientId:String(ingredient.ingredientId),quantity:qty.input.value,reason:why.input.value}).then(()=>{})));
  root.append(row);
 }
 if(can('procurement.write')){
  const id=field(tr(c,'Mã đơn mua','Order id')),supplier=select(tr(c,'Nhà cung cấp','Supplier'),suppliers.map(s=>({id:s.ref.id,name:String(s.state.name??s.ref.id)}))),lines=el('textarea');lines.rows=3;lines.setAttribute('aria-label',tr(c,'Dòng đặt: nguyên liệu số lượng đơn vị giá','Lines: ingredient quantity unit cost'));
  root.append(id.node,supplier.node,lines,button(tr(c,'Tạo đơn mua','Create purchase order'),()=>act(c,'Purchase.Create',{purchaseId:id.input.value,supplierId:supplier.input.value,lines:parsePurchaseLines(lines.value)}).then(()=>{})));
  const sid=field(tr(c,'Mã nhà cung cấp mới','New supplier id')),sname=field(tr(c,'Tên nhà cung cấp','Supplier name'));
  root.append(sid.node,sname.node,button(tr(c,'Thêm nhà cung cấp','Add supplier'),()=>act(c,'Supplier.Upsert',{supplierId:sid.input.value,name:sname.input.value}).then(()=>{})));
 }
 if(!list(c,'purchase').length)root.prepend(el('p',tr(c,'Chưa có đơn mua.','No purchase orders yet.')));
 return panel(tr(c,'Mua hàng và nhận hàng','Purchasing and receiving'),root);
}
