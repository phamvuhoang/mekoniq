import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { canonicalMinor } from '../shared/money';
import { fail, records, text, quantity } from '../restaurant-context';
export function lineTotal(unitMinor:string,count:string):string {
  quantity(count);
  try { return canonicalMinor(String(BigInt(canonicalMinor(unitMinor))*BigInt(count))); }
  catch { return fail('INVALID_AMOUNT'); }
}
export function quote(menu:Snapshot,input:JsonObject):JsonObject {
 const items=records(input.items);
 const catalog=menu.state.items as JsonObject[];
 const lines=items.map((item,index)=>{
   const itemId=text(item.itemId); const count=quantity(item.quantity);
   const entry=catalog.find(x=>x.id===itemId) ?? fail('ITEM_NOT_FOUND');
   if(entry.available===false) return fail('ITEM_SOLD_OUT');
   return {itemId,quantity:count,name:entry.name!,stationId:entry.stationId!,unitMinor:entry.unitMinor!,totalMinor:lineTotal(String(entry.unitMinor),count),menuVersion:menu.state.version!,index};
 });
 const total=lines.reduce((sum,line)=>sum+BigInt(line.totalMinor),0n);
 try { canonicalMinor(String(total)); } catch { return fail('INVALID_AMOUNT'); }
 return {menuVersion:menu.state.version!,currency:menu.state.currency!,lines,totalMinor:String(total)};
}
