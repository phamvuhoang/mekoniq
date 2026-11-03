import {el,field,select,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
import type {JsonObject} from '../../../../packages/contracts/src/index';
export function Stocktake(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p);
 const reasons=[['count_correction',tr(c,'Sửa số đếm','Count correction')],['waste',tr(c,'Hao hụt','Waste')],['spoilage',tr(c,'Hư hỏng','Spoilage')]].map(([id,name])=>({id:id!,name:name!}));
 for(const sheet of list(c,'stocktake').sort((a,b)=>String(b.state.openedAt).localeCompare(String(a.state.openedAt)))){
  const row=summary(sheet),status=String(sheet.state.status),items=sheet.state.items as JsonObject[];
  row.append(el('p',tr(c,'Số đếm là chênh lệch so với tồn tại thời điểm mở phiếu; bán/nhập sau đó vẫn được giữ.','Counts are differences against stock at the checkpoint; sales and receipts since then are kept.'),'muted'));
  for(const item of items){
   const line=el('p',`${String(item.ingredientId)} · ${tr(c,'tại thời điểm mở','at checkpoint')} ${String(item.atCheckpoint)}${item.counted!==undefined?` · ${tr(c,'đếm','counted')} ${String(item.counted)} · Δ ${String(item.delta)}${item.applied?` · ${tr(c,'đã áp dụng','applied')}`:''}`:''}`,item.needsReview?'warning':'muted');
   row.append(line);
   if(item.needsReview)row.append(el('p',tr(c,'Đồng hồ thiết bị không đáng tin: quản lý phải xác nhận xem lại.','Device clock not trusted: the approver must acknowledge a review.'),'warning'));
   if(status==='open'){
    const qty=field(tr(c,`Đã đếm ${String(item.ingredientId)}`,`Counted ${String(item.ingredientId)}`),'','number'),why=select(tr(c,'Lý do','Reason'),reasons);
    row.append(qty.node,why.node,button(tr(c,'Ghi số đếm','Save count'),()=>act(c,'Stocktake.Count',{stocktakeId:sheet.ref.id,ingredientId:String(item.ingredientId),counted:qty.input.value,reasonCode:why.input.value},sheet.version).then(()=>{})));
   }
  }
  if(status==='open'&&can('inventory.approve')){const review=el('input');review.type='checkbox';const lab=el('label');lab.append(review,el('span',tr(c,'Đã xem lại số đếm có đồng hồ không đáng tin','I reviewed counts with an untrusted clock')));row.append(lab,button(tr(c,'Duyệt phiếu kiểm kê','Approve stocktake'),()=>act(c,'Stocktake.Approve',{stocktakeId:sheet.ref.id,...(review.checked?{acknowledgeReview:true}:{})},sheet.version).then(()=>{})));}
  if(status==='approved'&&can('inventory.approve'))row.append(button(tr(c,'Áp dụng điều chỉnh vào tồn kho','Apply adjustments to stock'),()=>act(c,'Stocktake.Apply',{stocktakeId:sheet.ref.id},sheet.version).then(()=>{})));
  root.append(row);
 }
 const id=field(tr(c,'Mã phiếu kiểm kê','Stocktake id'));
 root.append(id.node,button(tr(c,'Mở phiếu kiểm kê (tất cả nguyên liệu)','Open stocktake (all ingredients)'),()=>act(c,'Stocktake.Open',{stocktakeId:id.input.value}).then(()=>{})));
 return panel(tr(c,'Kiểm kê kho','Stocktake'),root);
}
