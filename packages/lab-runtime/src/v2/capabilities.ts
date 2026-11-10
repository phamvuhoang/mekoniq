// Server-owned backend catalog. Callers pick a set id; they never supply roles, endpoints or backend definitions.
export type Mode='mock'|'simulation'|'hardware';
export type Access='simulated'|'shadow'|'hil'|'live';
export interface BackendCapability {id:string;modes:readonly Mode[];accesses:readonly Access[];installed:boolean;compatible:boolean;reachable:boolean;commissioned:boolean;reason?:string;}
/** Server-owned provider roles of a set. Engineering sets (the ones with scenarioIds) resolve requirements from these roles; legacy sets keep the mode-only formula. */
export interface BackendProviders {amr:string;arm?:string;coffee?:string}
/** Optional execution metadata (workers-runtime §6). Legacy sets omit it and keep their behaviour; it never grants anything by itself. */
export interface BackendExecution {host:'portable_python'|'linux_native';clock:'source_fixed_step'|'native';manualStep:boolean;speedMultipliers:readonly number[]}
export interface BackendSet {mode:Mode;access:Access;backends:readonly string[];providers?:BackendProviders;/** Scenarios this set supports; absent means every scenario the mode supports. */scenarioIds?:readonly string[];execution?:BackendExecution;}
export interface CapabilityCatalog {backends:readonly BackendCapability[];sets:Readonly<Record<string,BackendSet>>;}
export interface AdmissionResult {ok:boolean;reasonCodes:string[];}
const mock=(id:string):BackendCapability=>({id,modes:['mock'],accesses:['simulated'],installed:true,compatible:true,reachable:true,commissioned:true});
const sim=(id:string):BackendCapability=>({id,modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'Simulation provider package is not installed on this host'});
const unbuilt=(id:string):BackendCapability=>({id,modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'Provider not implemented yet (engineering plan C01/C03)'});
/** The portable 2D provider exists only when the operator configured it (MEKONIQ_LAB_IRSIM=1) and a real worker describe/create smoke passed (navigation2d/readiness.ts). */
export const IRSIM_UNCONFIGURED:BackendCapability={id:'irsim_2d',modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'IRSIM_DISABLED: the portable IR-SIM provider is not configured on this runtime (MEKONIQ_LAB_IRSIM=1)'};
/** The Webots 3D provider exists only when the operator configured it (MEKONIQ_LAB_WEBOTS=1), Webots R2025a is installed on the host and a real worker describe passed (simulation3d/readiness.ts). */
export const WEBOTS_UNCONFIGURED:BackendCapability={id:'webots_3d',modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'WEBOTS_DISABLED: the Webots 3D provider is not configured on this runtime (MEKONIQ_LAB_WEBOTS=1)'};
const hw=(id:string,accesses:readonly Access[]):BackendCapability=>({id,modes:['hardware'],accesses,installed:false,compatible:false,reachable:false,commissioned:false,reason:'Native provisioning is outside the local Lab runtime'});
export const defaultCatalog:CapabilityCatalog={
 backends:[mock('mock_amr'),mock('mock_coffee'),mock('mock_arm'),sim('gazebo_nav2'),sim('linuxcnc_sim'),sim('coffee_io_sim'),unbuilt('moveit_gazebo_arm'),unbuilt('engineering_coffee_process'),hw('valetudo_native',['shadow','hil','live']),hw('cell_native',['hil','live']),IRSIM_UNCONFIGURED,WEBOTS_UNCONFIGURED],
 sets:{
  'mock-default':{mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm'],providers:{amr:'mock_amr',arm:'mock_arm',coffee:'mock_coffee'}},
  'mock-amr':{mode:'mock',access:'simulated',backends:['mock_amr'],providers:{amr:'mock_amr'}},
  'simulation-default':{mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim'],providers:{amr:'gazebo_nav2',arm:'linuxcnc_sim',coffee:'coffee_io_sim'}},
  /** Plan 02 name for the coffee-to-table co-simulation set: the same three backends, all required (no partial run). */
  'coffee-simulation':{mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim'],providers:{amr:'gazebo_nav2',arm:'linuxcnc_sim',coffee:'coffee_io_sim'}},
  /** Engineering profiles: one Gazebo world; MoveIt and the process plant replace LinuxCNC/coffee_io_sim, which these sets never use. */
  'engineering-rigid-v1':{mode:'simulation',access:'simulated',backends:['gazebo_nav2'],providers:{amr:'gazebo_nav2'},scenarioIds:['FD01']},
  'engineering-contact-v1':{mode:'simulation',access:'simulated',backends:['gazebo_nav2','moveit_gazebo_arm','engineering_coffee_process'],providers:{amr:'gazebo_nav2',arm:'moveit_gazebo_arm',coffee:'engineering_coffee_process'},scenarioIds:['FD01','BV01']},
  /** Portable 2D navigation: IR-SIM plant stepped by the source runner; no arm or coffee; only the scenarios qualified on it (B04: IR-FD01; C02: the actor, no-path, blocked and two-robot variants). */
  'engineering-irsim-2d-v1':{mode:'simulation',access:'simulated',backends:['irsim_2d'],providers:{amr:'irsim_2d'},scenarioIds:['IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1,4,16,64]}},
  /** Webots 3D: the same fixed-step runner on a rigid-body plant (Serve with casters); WB-FD01 and WB-FD07 are its qualified scenarios. */
  'engineering-webots-3d-v1':{mode:'simulation',access:'simulated',backends:['webots_3d'],providers:{amr:'webots_3d'},scenarioIds:['WB-FD01','WB-FD07'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1,4,16,64]}},
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
