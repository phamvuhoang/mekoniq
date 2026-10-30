import type { ModuleRegistry } from '../modules';
import { currentMenu, validatedItems } from './menu';
import { quote } from './price-book';
import { created, done, fail, find, handle, record } from '../restaurant-context';
import { stateEvent } from '../modules';
import type {JsonObject} from '../../../contracts/src/index';
export function registerCatalog(registry:ModuleRegistry):void {
 handle(registry,'Catalog.Quote',(c,s)=>done([],quote(currentMenu(s),c.payload)));
 handle(registry,'Catalog.Publish',(c,s)=>{
   const old=find(s,'catalog','current');
   const version=c.payload.version;
   if(!Number.isSafeInteger(version) || Number(version)!==Number(old?.state.version ?? 0)+1) return fail('VERSION_CONFLICT');
   const currency=c.payload.currency ?? old?.state.currency;
   if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)) return fail('INVALID_CURRENCY');
   let rawItems=c.payload.items;
   if(!rawItems && c.payload.prices && old) {
     const prices=record(c.payload.prices);
     const oldItems=old.state.items as JsonObject[];
     if(Object.keys(prices).some(id=>!oldItems.some(item=>item.id===id))) return fail('ITEM_NOT_FOUND');
     rawItems=oldItems.map(item=>({...item,unitMinor:prices[String(item.id)] ?? item.unitMinor!}));
   }
   const state={version:Number(version),menuVersion:Number(version),currency,items:validatedItems(rawItems,s),policyRevision:c.policyRevision,appliedAt:c.recordedAt};
   if(find(s,'catalog-version',String(version))) return fail('IMMUTABLE_VERSION');
   return done([stateEvent('CatalogPublished','catalog','current',state),created('CatalogVersionStored','catalog-version',String(version),state)],{version:Number(version)});
 });
}
