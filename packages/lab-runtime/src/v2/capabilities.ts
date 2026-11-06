// Server-owned backend catalog. Callers pick a set id; they never supply roles, endpoints or backend definitions.
export type Mode='mock'|'simulation'|'hardware';
export type Access='simulated'|'shadow'|'hil'|'live';
export interface BackendCapability {id:string;modes:readonly Mode[];accesses:readonly Access[];installed:boolean;compatible:boolean;reachable:boolean;commissioned:boolean;reason?:string;}
export interface BackendSet {mode:Mode;access:Access;backends:readonly string[];}
export interface CapabilityCatalog {backends:readonly BackendCapability[];sets:Readonly<Record<string,BackendSet>>;}
export interface AdmissionResult {ok:boolean;reasonCodes:string[];}
const mock=(id:string):BackendCapability=>({id,modes:['mock'],accesses:['simulated'],installed:true,compatible:true,reachable:true,commissioned:true});
const sim=(id:string):BackendCapability=>({id,modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'Simulation provider package is not installed on this host'});
const hw=(id:string,accesses:readonly Access[]):BackendCapability=>({id,modes:['hardware'],accesses,installed:false,compatible:false,reachable:false,commissioned:false,reason:'Native provisioning is outside the local Lab runtime'});
export const defaultCatalog:CapabilityCatalog={
 backends:[mock('mock_amr'),mock('mock_coffee'),mock('mock_arm'),sim('gazebo_nav2'),sim('linuxcnc_sim'),sim('coffee_io_sim'),hw('valetudo_native',['shadow','hil','live']),hw('cell_native',['hil','live'])],
 sets:{
  'mock-default':{mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']},
  'mock-amr':{mode:'mock',access:'simulated',backends:['mock_amr']},
  'simulation-default':{mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']},
  /** Plan 02 name for the coffee-to-table co-simulation set: the same three backends, all required (no partial run). */
  'coffee-simulation':{mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']},
  'hardware-shadow':{mode:'hardware',access:'shadow',backends:['valetudo_native']},
  'hardware-hil':{mode:'hardware',access:'hil',backends:['valetudo_native','cell_native']},
  'hardware-live':{mode:'hardware',access:'live',backends:['valetudo_native','cell_native']},
 },
};
const stateCodes:[keyof BackendCapability,string][]=[['installed','BACKEND_NOT_INSTALLED'],['compatible','BACKEND_INCOMPATIBLE'],['reachable','BACKEND_UNREACHABLE'],['commissioned','BACKEND_NOT_COMMISSIONED']];
/** Pure admission: mode, access and backend set must agree, and each backend must report all four states. No fallback between modes. */
export function admitBackend(mode:Mode,backendSet:readonly string[],catalog:CapabilityCatalog,access?:Access):AdmissionResult{
 const codes=new Set<string>();
 if(backendSet.length===0)codes.add('BACKEND_SET_EMPTY');
 const found:BackendCapability[]=[];
 for(const id of backendSet){
  const b=catalog.backends.find(c=>c.id===id);
  if(!b)codes.add('BACKEND_UNKNOWN');
  else if(!b.modes.includes(mode))codes.add('MODE_BACKEND_MISMATCH');
  else found.push(b);
 }
 const effective=access??(mode==='hardware'?undefined:'simulated');
 if(!effective)codes.add('ACCESS_REQUIRED');
 else if(effective!=='simulated'&&mode!=='hardware'||effective==='simulated'&&mode==='hardware')codes.add('ACCESS_MODE_MISMATCH');
 else if(found.some(b=>!b.accesses.includes(effective)))codes.add('ACCESS_MODE_MISMATCH');
 if(codes.size===0)for(const [key,code] of stateCodes)if(found.some(b=>!b[key]))codes.add(code);
 const reasonCodes=[...codes];
 return {ok:reasonCodes.length===0,reasonCodes};
}
