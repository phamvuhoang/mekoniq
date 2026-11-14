// Support matrix of a campaign fixture, read from the runtime's own health answer (UX-19, SIM-10). The Lab never decides a scenario is
// "available": every row carries the runtime's reason, and no runtime answer is `unknown`, never a guess.
import type {TwinHealth} from './controls';
/** `mock` is absent for a simulation-only scenario (the IR-SIM 2D variants IR-*): it gets no mock row at all, never a row that pretends a mock run exists. */
export interface CampaignEntry {id:string;seed:number;repeat:number;mock?:{backendSetId:string};simulation:{backendSetId:string;requires:string[]}}
export interface CampaignFixture {schemaVersion:1;id:string;revision:number;title:string;note?:string;scenarios:CampaignEntry[]}
export interface SupportRow {scenarioId:string;mode:'mock'|'simulation';backendSetId:string;status:'available'|'unavailable'|'unknown';reasons:string[]}
export interface SetOption {id:string;mode:string;selectable:boolean;reasons:string[]}
/** The capability the runtime must advertise before a portable provider's set is selectable. */
export const PORTABLE_CAPABILITY:Readonly<Record<string,string>>={irsim_2d:'irsim_navigation_v1',webots_3d:'sim3d_navigation_v1',webots_arm:'sim3d_arm_v1',mujoco_arm:'sim3d_arm_contact_v1',mujoco_3d:'sim3d_payload_experiments_v1'};
/** Backend sets the run selector offers. Portable sets (execution.host portable_python, i.e. IR-SIM 2D or Webots 3D) are selectable only when health reports every backend
 * installed, enabled, compatible and reachable and advertises the provider's capability (PORTABLE_CAPABILITY); legacy sets keep their behaviour (always listed and selectable). */
/** Why the set's backends (`required`, default all of them) cannot run: one reason per backend, its first failing condition, then a missing
 * provider capability. A legacy set (not portable_python) is only asked whether each backend is enabled. */
export function setReasons(health:TwinHealth,s:TwinHealth['backendSets'][number],required:readonly string[]=s.backends):string[]{
 const portable=s.execution?.host==='portable_python',reasons:string[]=[];
 for(const id of required){const b=health.backends.find(x=>x.id===id);
  reasons.push(...!portable?(b?.enabled?[]:[`BACKEND_NOT_ENABLED:${id}`]):!b?[`BACKEND_UNKNOWN:${id}`]:!b.installed?[`BACKEND_NOT_INSTALLED:${id}${b.reason?` (${b.reason})`:''}`]:!b.enabled?[`BACKEND_NOT_ENABLED:${id}`]:!b.compatible?[`BACKEND_INCOMPATIBLE:${id}`]:!b.reachable?[`BACKEND_UNREACHABLE:${id}`]:[]);}
 if(portable)for(const [backend,capability] of Object.entries(PORTABLE_CAPABILITY))if(s.backends.includes(backend)&&!health.capabilities?.includes(capability))reasons.push(`CAPABILITY_MISSING:${capability}`);
 return reasons;
}
export function backendSetOptions(health:TwinHealth|null):SetOption[]{
 return (health?.backendSets??[]).filter(s=>['mock','simulation'].includes(s.mode)&&s.access==='simulated').map(s=>{
  if(s.execution?.host!=='portable_python')return {id:s.id,mode:s.mode,selectable:true,reasons:[]};
  const reasons=setReasons(health!,s);
  return {id:s.id,mode:s.mode,selectable:!reasons.length,reasons};
 });
}
export function supportMatrix(health:TwinHealth|null,fixture:CampaignFixture):SupportRow[] {
 return fixture.scenarios.flatMap(s=>(s.mock?['mock','simulation'] as const:['simulation'] as const).map((mode):SupportRow=>{
  const backendSetId=s[mode]!.backendSetId;
  if(!health)return {scenarioId:s.id,mode,backendSetId,status:'unknown',reasons:['RUNTIME_UNREACHABLE']};
  const reasons:string[]=[];
  if(!health.scenarioIds.includes(s.id))reasons.push('SCENARIO_NOT_OFFERED');
  const set=health.backendSets.find(x=>x.id===backendSetId);
  if(!set)reasons.push(`BACKEND_SET_UNKNOWN:${backendSetId}`);
  else for(const id of health.scenarioRequirements?.[s.id]?.[mode]??(mode==='simulation'?s.simulation.requires:set.backends)){
   const b=health.backends.find(x=>x.id===id);
   if(!set.backends.includes(id))reasons.push(`BACKEND_NOT_IN_SET:${id}`);
   else if(!b)reasons.push(`BACKEND_UNKNOWN:${id}`);
   else if(!b.installed)reasons.push(`BACKEND_NOT_INSTALLED:${id}${b.reason?` (${b.reason})`:''}`);
   else if(!b.enabled)reasons.push(`BACKEND_NOT_ENABLED:${id}`);
   else if(!b.compatible)reasons.push(`BACKEND_INCOMPATIBLE:${id}`);
   else if(!b.reachable)reasons.push(`BACKEND_UNREACHABLE:${id}`);
   else if(!b.commissioned)reasons.push(`BACKEND_NOT_COMMISSIONED:${id}`);
  }
  return {scenarioId:s.id,mode,backendSetId,status:reasons.length?'unavailable':'available',reasons};
 }));
}
