import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, amount, fail, find, record, records, text } from '../restaurant-context';
export function currentMenu(snapshots:Snapshot[]):Snapshot { return find(snapshots,'catalog','current') ?? fail('MENU_UNAVAILABLE'); }
export function validatedItems(value: unknown,snapshots:Snapshot[]):JsonObject[] {
  return records(value as JsonObject[]).map(item=>{
    const id=text(item.id); const stationId=text(item.stationId,'STATION_REQUIRED');
    if(!all(snapshots,'station').some(s=>s.ref.id===stationId)) return fail('STATION_NOT_FOUND');
    return {id,name:text(item.name,'NAME_REQUIRED'),stationId,unitMinor:amount(item.unitMinor),available:item.available!==false,...(item.imageManifestId ? {imageManifestId:text(item.imageManifestId)} : {})};
  }).map((item,_index,items)=>{
    if(items.filter(x=>x.id===item.id).length!==1) return fail('DUPLICATE_ITEM');
    return record(item);
  });
}
