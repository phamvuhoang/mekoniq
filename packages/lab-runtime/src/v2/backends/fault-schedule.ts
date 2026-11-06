// Fault injection for simulation runs (SIM-07): a closed catalog of typed injectors resolved by id with a checked payload. Nothing here takes a
// topic, endpoint, file, script or shell string; a scenario's fault schedule fires each entry once at its tick.
import type {JsonObject} from '../../../../contracts/src/index';
import {classifyField} from '../contracts';
export const SIL_FAULTS=['blocker-on','blocker-off','pedestrian-cross','sensor-stale','sensor-drop','disconnect','reboot','localization-lost','map-changed','duplicate-observation','reorder-observation'] as const;
export type SilFault=typeof SIL_FAULTS[number];
/** Who applies a fault: the worker touches the world (scene actors, blockers, a kidnapped robot); the orchestrator its own observation/telemetry/link path. */
export const WORKER_FAULTS=['blocker-on','blocker-off','pedestrian-cross','localization-lost'] as const;
export const ORCHESTRATOR_FAULTS=SIL_FAULTS.filter(f=>!(WORKER_FAULTS as readonly string[]).includes(f));
type FieldKind='id'|'number'|'string'|'boolean';
export interface FaultInjector {faultId:string;scope:'run'|'entity';fields:Record<string,FieldKind>;inject(target:string|null,payload:JsonObject):void}
export type FaultResolution={ok:true;injector:FaultInjector}|{ok:false;reasonCodes:string[]};
const ID=/^[A-Za-z0-9_.:-]{1,200}$/;
const typed:Record<FieldKind,(v:unknown)=>boolean>={id:v=>typeof v==='string'&&ID.test(v),number:v=>typeof v==='number'&&Number.isFinite(v),string:v=>typeof v==='string'&&v.length>0&&v.length<=200,boolean:v=>typeof v==='boolean'};
export function createFaultRegistry(){
 const injectors=new Map<string,FaultInjector>();
 return {
  register(injector:FaultInjector){if(!ID.test(injector.faultId))throw new Error('FAULT_ID_INVALID');if(injectors.has(injector.faultId))throw new Error('FAULT_DUPLICATE');injectors.set(injector.faultId,injector);},
  ids(){return [...injectors.keys()];},
  resolve(faultId:string,payload:JsonObject):FaultResolution{
   const injector=injectors.get(faultId);
   if(!injector)return {ok:false,reasonCodes:['FAULT_UNKNOWN']};
   for(const key of Object.keys(payload))if(!Object.hasOwn(injector.fields,key)){const code=classifyField(key);return {ok:false,reasonCodes:[code==='UNKNOWN_FIELD'?`UNKNOWN_FIELD:${key}`:code]};}
   for(const [key,kind] of Object.entries(injector.fields)){
    if(payload[key]===undefined)return {ok:false,reasonCodes:[`FIELD_REQUIRED:${key}`]};
    if(!typed[kind](payload[key]))return {ok:false,reasonCodes:[`INVALID_FIELD:${key}`]};
   }
   return {ok:true,injector};
  },
 };
}
export interface FaultEntry {atTick:number;faultId:string;entityId?:string;payload?:JsonObject}
/** A validated schedule: entries sorted by tick, each fired exactly once by `due(tick)` (late ticks still fire what is due). */
export function scheduleFaults(entries:readonly FaultEntry[],registry:ReturnType<typeof createFaultRegistry>){
 const issues:{index:number;reasonCodes:string[]}[]=[],valid:(FaultEntry&{payload:JsonObject;fired:boolean;index:number})[]=[];
 entries.forEach((e,index)=>{
  const codes:string[]=[];
  if(!Number.isSafeInteger(e.atTick)||e.atTick<0)codes.push('INVALID_TICK');
  if(e.entityId!==undefined&&!ID.test(e.entityId))codes.push('INVALID_ENTITY');
  const r=registry.resolve(e.faultId,e.payload??{});if(!r.ok)codes.push(...r.reasonCodes);
  if(codes.length)issues.push({index,reasonCodes:codes});else valid.push({...e,payload:e.payload??{},fired:false,index});
 });
 valid.sort((a,b)=>a.atTick-b.atTick||a.index-b.index);
 return {issues,entries:valid.map(({fired:_f,...e})=>e),
  due(tick:number){const out:(FaultEntry&{payload:JsonObject})[]=[];for(const e of valid)if(!e.fired&&e.atTick<=tick){e.fired=true;const entry={...e};delete (entry as Partial<typeof e>).fired;delete (entry as Partial<typeof e>).index;out.push(entry);}return out;}};
}
