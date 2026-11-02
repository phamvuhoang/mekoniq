import {el,field,select,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
const big=(v:unknown)=>BigInt(String(v??'0'));
export function Inventory(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p);
 const items=list(c,'stock-item').sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
 for(const item of items){
  const row=summary(item),negative=big(item.state.onHand)<0n,unit=String(item.state.baseUnit);
  row.append(el('p',`${tr(c,'Tồn','On hand')}: ${String(item.state.onHand)} ${unit} · ${tr(c,'giá trị','value')} ${String(item.state.valueMinor)} ${String(item.state.currency??'VND')}`,negative?'warning':'muted'));
  if(negative)row.append(el('p',tr(c,'Tồn âm: chi phí phần thiếu chưa xác định, cần nhập hàng hoặc kiểm kê.','Negative stock: cost of the shortfall is unknown; receive stock or count it.'),'warning'));
  root.append(row);
 }
 if(!items.length)root.append(el('p',tr(c,'Chưa có nguyên liệu.','No ingredients yet.')));
 if(items.length){
  const ingredient=select(tr(c,'Nguyên liệu hao hụt','Ingredient lost'),items.map(i=>({id:i.ref.id,name:String(i.state.name??i.ref.id)}))),qty=field(tr(c,'Số lượng','Quantity'),'','number'),unit=field(tr(c,'Đơn vị (để trống = đơn vị gốc)','Unit (blank = base unit)')),reason=field(tr(c,'Lý do (bắt buộc)','Reason (required)'));
  root.append(ingredient.node,qty.node,unit.node,reason.node,button(tr(c,'Ghi hao hụt','Record waste'),()=>act(c,'Inventory.RecordWaste',{sourceEventId:crypto.randomUUID(),ingredientId:ingredient.input.value,quantity:qty.input.value,...(unit.input.value?{unit:unit.input.value}:{}),reason:reason.input.value}).then(()=>{})));
 }
 if(can('inventory.write')){
  const id=field(tr(c,'Mã nguyên liệu','Ingredient id')),name=field(tr(c,'Tên','Name')),base=select(tr(c,'Đơn vị gốc','Base unit'),['g','ml','piece'].map(u=>({id:u,name:u})));
  root.append(id.node,name.node,base.node,button(tr(c,'Thêm nguyên liệu','Add ingredient'),()=>act(c,'Ingredient.Upsert',{ingredientId:id.input.value,name:name.input.value,baseUnit:base.input.value}).then(()=>{})));
 }
 return panel(tr(c,'Kho nguyên liệu','Ingredient stock'),root);
}
