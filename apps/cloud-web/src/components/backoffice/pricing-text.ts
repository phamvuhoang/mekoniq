// Line formats of the MenuEditor textareas. Every field a profile can hold must be representable here, or republishing would drop it.
export type TaxProfile={id:string;name:string;rateBps:number;inclusive:boolean};
export type Coupon={id:string;name:string;kind:'percent'|'fixed';valueBps?:number;amountMinor?:string;itemIds?:string[]};
const rows=(t:string)=>t.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>l.split(',').map(x=>x.trim()));
export const taxText=(taxes:TaxProfile[])=>taxes.map(t=>[t.id,t.name,t.rateBps,t.inclusive?'inclusive':'exclusive'].join(',')).join('\n');
export const parseTax=(t:string):TaxProfile[]=>rows(t).map(([id,name,rate,mode])=>({id:id!,name:name!,rateBps:Number(rate),inclusive:mode==='inclusive'}));
/** id,name,percent|fixed,value[,itemId|itemId...] ; the optional last column limits the coupon to those items. */
export const couponText=(coupons:Coupon[])=>coupons.map(d=>[d.id,d.name,d.kind,d.kind==='percent'?d.valueBps:d.amountMinor,...(d.itemIds?.length?[d.itemIds.join('|')]:[])].join(',')).join('\n');
export const parseCoupons=(t:string):Coupon[]=>rows(t).map(([id,name,kind,value,items])=>({id:id!,name:name!,...(kind==='percent'?{kind:'percent' as const,valueBps:Number(value)}:{kind:'fixed' as const,amountMinor:value}),...(items?{itemIds:items.split('|').map(x=>x.trim()).filter(Boolean)}:{})}));
export const taxIdsOf=(t:string)=>rows(t).map(([id])=>id!);
