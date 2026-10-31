import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { all, fail } from '../restaurant-context';
export function selectRobot(snapshots:Snapshot[],targets:string[],trays:number,requested?:string,capability='delivery',allowBusy=false):Snapshot {
 const candidates=all(snapshots,'robot').filter(r=>{
  const state=r.state,bindings=(state.bindings ?? {}) as JsonObject;
  if(requested && requested!=='any' && r.ref.id!==requested) return false;
  if(state.driver!=='simulator'||state.validation!=='simulated'||!(allowBusy?['idle','busy']:['idle']).includes(String(state.availability))) return false;
  if(state.safetyState && state.safetyState!=='clear') return false;
  if(Number(state.battery)<Number(state.minBattery ?? 20)||Number(state.trays)<trays) return false;
  if(!((state.capabilities ?? []) as string[]).includes(capability)) return false;
  return targets.every(target=>{
   const binding=bindings[target] as JsonObject|undefined;
   return binding && binding.mapId===state.mapId && binding.mapRevision===state.mapRevision;
  });
 });
 if(!candidates.length) return fail('NO_CAPABLE_ROBOT');
 return candidates.sort((a,b)=>Number(a.state.availability!=='idle')-Number(b.state.availability!=='idle')||Number(b.state.battery)-Number(a.state.battery)||a.ref.id.localeCompare(b.ref.id))[0]!;
}
