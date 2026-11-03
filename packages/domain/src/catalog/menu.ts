import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, amount, fail, find, record, records, text } from '../restaurant-context';
import { validatedAvailability } from './availability';
import { validatedModifierGroups } from './modifier';
import { validatedModels } from './models';
export function currentMenu(snapshots:Snapshot[]):Snapshot { return find(snapshots,'catalog','current') ?? fail('MENU_UNAVAILABLE'); }
export function validatedItems(value: unknown,snapshots:Snapshot[],pricing?:JsonObject):JsonObject[] {
  return records(value as JsonObject[]).map(item=>{
    const id=text(item.id); const stationId=text(item.stationId,'STATION_REQUIRED');
    if(!all(snapshots,'station').some(s=>s.ref.id===stationId)) return fail('STATION_NOT_FOUND');
    const groups=validatedModifierGroups(item.modifierGroups), availability=validatedAvailability(item.availability);
    if(item.taxProfileId!==undefined&&!(pricing?.taxProfiles as JsonObject[]|undefined)?.some(t=>t.id===item.taxProfileId)) return fail('TAX_PROFILE_NOT_FOUND');
    return {id,name:text(item.name,'NAME_REQUIRED'),stationId,unitMinor:amount(item.unitMinor),available:item.available!==false,...(item.imageManifestId ? {imageManifestId:text(item.imageManifestId)} : {}),...(groups.length ? {modifierGroups:groups} : {}),...(item.taxProfileId!==undefined ? {taxProfileId:text(item.taxProfileId)} : {}),...(availability ? {availability} : {}),...(item.weighed!==undefined?{weighed:item.weighed}:{}),...(item.combo!==undefined?{combo:item.combo}:{}),...(item.buffet!==undefined?{buffet:item.buffet}:{})};
  }).map((item,_index,items)=>{
    if(items.filter(x=>x.id===item.id).length!==1) return fail('DUPLICATE_ITEM');
    const { weighed: _w, combo: _c, buffet: _b, ...plain } = item; void [_w, _c, _b];
    return record({ ...plain, ...validatedModels(item, items) });
  });
}
