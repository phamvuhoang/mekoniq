import {el,field,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
import {ineligible} from '../../../../packages/domain/src/promotions/rules';
import {venueZone} from '../../../../packages/domain/src/reporting/report';
/** Promotions and vouchers as this tablet knows them (cached rules/quota: nothing here calls a server). Redeeming uses the same commands the coordinator enforces. */
export function PromotionStatus(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),{timeZone}=venueZone(c.snapshots),at=new Date().toISOString();
 for(const p of list(c,'promotion').sort((a,b)=>Number(b.state.priority)-Number(a.state.priority))){
  const row=summary(p),why=p.state.status==='active'?ineligible(p.state,{at,timeZone,itemIds:[],channel:'pos',venueId:c.session.venueId}):'retired';
  row.append(el('p',`${p.state.kind==='percent'?`${Number(p.state.valueBps)/100}%`:String(p.state.amountMinor)} · ${tr(c,'ưu tiên','priority')} ${String(p.state.priority)}${p.state.exclusionGroup?` · ${tr(c,'nhóm loại trừ','exclusion group')} ${String(p.state.exclusionGroup)}`:''}${p.state.requiresVoucher?` · ${tr(c,'cần voucher','needs voucher')}`:''}`,'muted'));
  if(why&&why!=='items')row.append(el('p',tr(c,`Hiện không áp dụng (${why})`,`Not applicable now (${why})`),'warning'));
  root.append(row);
 }
 for(const v of list(c,'voucher')){
  const row=summary(v),shared=v.state.scope==='shared',slot=(v.state.escrow as Record<string,{count:number}>|undefined)?.[c.session.venueId];
  row.append(el('p',shared?`${tr(c,'Dùng chung · hạn mức riêng cho nhà hàng này','Shared · this venue allocation')}: ${slot?.count??0}`:`${tr(c,'Còn','Remaining')} ${String(v.state.remaining)}/${String(v.state.limit)}`,shared&&!slot?.count?'warning':'muted'));
  if(shared&&!slot?.count)row.append(el('p',tr(c,'Voucher dùng chung không dùng được khi offline nếu chưa được cấp hạn mức riêng.','A shared voucher cannot be spent offline without an exclusive allocation.'),'warning'));
  root.append(row);
 }
 const voucher=field(tr(c,'Mã voucher','Voucher id')),bill=field(tr(c,'Mã hóa đơn','Bill id')),customer=field(tr(c,'Khách (nếu voucher giới hạn theo khách)','Customer (for per-customer limits)'));
 root.append(voucher.node,bill.node,customer.node,button(tr(c,'Dùng voucher cho hóa đơn','Redeem for bill'),()=>act(c,'Voucher.Redeem',{voucherId:voucher.input.value,billId:bill.input.value,...(customer.input.value?{customerId:customer.input.value}:{})}).then(()=>{})));
 if(!list(c,'promotion').length&&!list(c,'voucher').length)root.prepend(el('p',tr(c,'Chưa có khuyến mãi hoặc voucher.','No promotions or vouchers yet.')));
 return panel(tr(c,'Khuyến mãi và voucher','Promotions and vouchers'),root);
}
