import {randomBytes,randomUUID} from 'node:crypto';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {admitBackend,defaultCatalog,type CapabilityCatalog,type Access} from './capabilities';
import {classifyField,validateProjectV2,validateRunRequestV2,validateActionV2,type Issue} from './contracts';
import {collectReadiness,type ReadinessProbe,type NativeReadinessChecks} from './readiness';
import {requirementsByBackendSet,resolveBackends} from './scenario-matrix';
import {scenarioRegistry} from './scenario-registry';
import {createScenarioRun,type ScenarioRun,type RunManifestInput,type RunProviders} from './scenario-runner';
import {serveRunStream,STREAM_DEFAULTS,type StreamOptions} from './event-stream';
import {findReclaim,proofHash,saveReclaim} from './reclaim-store';
import {ENGINEERING_CAPABILITY,EngineeringError,type EngineeringService,type LockedEngineering} from '../engineering/gateway';
/** Hooks into the v1 gateway so v2 shares its pairing token, body parser and response helper without importing it. */
export interface V2Deps {
 sourceCommit:string;schemaHash:string;now:()=>number;catalog?:CapabilityCatalog;
 /** Parent directory for per-run journals; each run gets a fresh server-chosen subdirectory. */
 directory:string;
 /** Backends whose execution has been switched on. Schema-only builds enable none, so every run is denied before any backend starts. */
 enabledBackends?:readonly string[];
 pairingValid(token:unknown):boolean;spendPairing():void;same(a:string,b:string):boolean;
 readBody(request:IncomingMessage,limit?:number):Promise<Record<string,unknown>>;send(response:ServerResponse,status:number,data:unknown):void;
 /** SSE timing and the resumable business-event window (tests shorten them). */
 stream?:Partial<StreamOptions>;
 readinessProbes?:Readonly<Record<string,ReadinessProbe>>;
 nativeChecks?:NativeReadinessChecks;
 /** Readiness of portable (portable_python) sets, from portableSimulationFromOptions; native sets never consult it. */
 portableChecks?:NativeReadinessChecks;
 /** Server-owned and dispatched by backend set (navigation2d/readiness.ts): portable sets run IR-SIM, native sets the native factory, anything else is refused. */
 simulationFactory?:(input:RunManifestInput,providers:RunProviders)=>Promise<ScenarioRun>;
 /** Present only when this runtime can admit engineering bundles; its absence is what makes ENGINEERING_CAPABILITY_REQUIRED a hard refusal. */
 engineering?:EngineeringService;
}
const COOKIE='mekoniq_lab_session_v2';
// Local demo pairing may only drive simulations and read-only shadow; hil/live belong to native provisioning.
const PAIRING_ACCESS:readonly Access[]=['simulated','shadow'];
const UUID='[0-9a-f-]{36}';
const codesOf=(issues:Issue[])=>[...new Set(issues.map(i=>i.code))];
const statusOf=(m:string)=>m==='BACKEND_EXECUTION_DISABLED'?501:m==='RUN_CLOSED'?410:/CONFLICT|MISMATCH|ENGINEERING_CLOSURE_MISSING|INVALID_STATE|PAUSED|NOT_PENDING|DURATION_EXCEEDED|^IRSIM_CAPACITY$/.test(m)?409:/^(INVALID_|SCENARIO_|BACKEND_|ACTION_LIMIT|MODE_|FAULT_SCHEDULE_UNSUPPORTED$)/.test(m)?422:500;
export function createV2Gateway(deps:V2Deps){
 const catalog=deps.catalog??defaultCatalog,enabled=new Set(deps.enabledBackends??[]);
 const sessions=new Map<string,{csrf:string;expiresAt:number}>();
 // Runs are owned by the v2 pairing session that created them; another session sees 404, exactly as for an unknown id.
 const runs=new Map<string,{owner:string;run:ScenarioRun;directory:string;readOnly?:boolean;archiving?:boolean;input:RunManifestInput}>();let creating=0;
 const reclaiming=new Set<string>();
 const streams=new Set<ServerResponse>(),streamOptions={...STREAM_DEFAULTS,...deps.stream};
 const token=()=>randomBytes(32).toString('base64url');
 const deny=(response:ServerResponse,status:number,error:string,reasonCodes:string[],issues?:Issue[])=>deps.send(response,status,{error,reasonCodes,...issues?{issues}:{}});
 const failed=(response:ServerResponse,e:unknown)=>{const m=e instanceof Error?e.message:'RUNTIME_FAILURE',status=statusOf(m.split(':')[0]!);return deny(response,status,status===500&&m!=='SIMULATED_CRASH'?'RUNTIME_FAILURE':m.split(':')[0]!,m.includes(':')?m.split(':')[1]!.split(','):[]);};
const engineeringFailed=(response:ServerResponse,e:unknown)=>e instanceof EngineeringError?deny(response,e.status,e.code,e.reasonCodes):failed(response,e);
 const bundleFile=deps.engineering?(digest:string,path:string)=>deps.engineering!.bundleFile(digest,path):undefined;
 const readinessOptions=()=>({catalog,enabledBackends:[...enabled],now:deps.now,probes:deps.readinessProbes,nativeChecks:deps.nativeChecks,portableChecks:deps.portableChecks});
 const handle=async function handle(request:IncomingMessage,response:ServerResponse,path:string,origin:string|undefined){
  const method=request.method,{send}=deps,sub=path.slice('/lab/v2'.length);
  if(method==='GET'&&sub==='/health')return send(response,200,{
   protocolMajor:2,protocolMajors:[1,2],sourceCommit:deps.sourceCommit,schemaHash:deps.schemaHash,
   backends:catalog.backends.map(b=>({id:b.id,modes:b.modes,accesses:b.accesses,installed:b.installed,compatible:b.compatible,reachable:b.reachable,commissioned:b.commissioned,enabled:enabled.has(b.id)&&b.installed,...b.reason?{reason:b.reason}:{}})),
   backendSets:Object.entries(catalog.sets).map(([id,s])=>({id,mode:s.mode,access:s.access,backends:s.backends,...s.execution?{execution:structuredClone(s.execution)}:{}})),scenarioIds:[...scenarioRegistry.keys()],scenarioRequirements:Object.fromEntries([...scenarioRegistry].map(([id,def])=>[id,{mock:resolveBackends(def,'mock').required,simulation:resolveBackends(def,'simulation').required}])),scenarioRequirementsByBackendSet:requirementsByBackendSet(catalog,{engineering:!!deps.engineering}),features:{polling:true,sse:true,readiness:true},
   // a capability is advertised only when the server can execute it now: irsim_navigation_v1 needs the live portable provider and engineering bundles
   capabilities:[...deps.engineering?[ENGINEERING_CAPABILITY]:[],...deps.engineering&&enabled.has('irsim_2d')&&catalog.backends.some(b=>b.id==='irsim_2d'&&b.installed&&b.reachable)?['irsim_navigation_v1']:[],...deps.engineering&&enabled.has('webots_3d')&&catalog.backends.some(b=>b.id==='webots_3d'&&b.installed&&b.reachable)?['sim3d_navigation_v1']:[]],
  });
  if(method==='POST'&&!origin)return deny(response,403,'ORIGIN_REQUIRED',[]);
  if(method==='POST'&&sub==='/sessions'){
   const b=await deps.readBody(request),extra=Object.keys(b).filter(k=>k!=='token');
   if(extra.length){const issues=extra.map(k=>({path:'',code:classifyField(k),message:`Property "${k}" is not allowed`}));return deny(response,422,'INVALID_SESSION_REQUEST',codesOf(issues),issues);}
   if(!deps.pairingValid(b.token))return deny(response,401,'PAIRING_INVALID',[]);
   for(const [id,s]of sessions)if(deps.now()>=s.expiresAt)sessions.delete(id);
   if(sessions.size>=10)return deny(response,429,'SESSION_LIMIT',[]);
   deps.spendPairing();const id=token(),csrf=token();sessions.set(id,{csrf,expiresAt:deps.now()+3600000});
   response.setHeader('Set-Cookie',`${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/lab/v2; Max-Age=3600`);
   // The principal is assigned by the server; nothing in the request can choose it.
   return send(response,201,{csrfToken:csrf,principal:{kind:'local_pairing',controlOwner:'lab_simulation',accesses:PAIRING_ACCESS}});
  }
  const sessionId=new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.cookie??'')?.[1]??'',session=sessions.get(sessionId);
  if(!session||deps.now()>=session.expiresAt)return deny(response,401,'SESSION_REQUIRED',[]);
  const engineeringRoute=/^\/engineering\/(?:(compile|validate)|bundles\/([^/]+)\/manifest|blobs\/([^/]+)|validations\/([^/]+))$/.exec(sub);
  if(engineeringRoute){
   if(!deps.engineering)return deny(response,400,'ENGINEERING_CAPABILITY_REQUIRED',['ENGINEERING_CAPABILITY_REQUIRED']);
   const [,action,manifestDigest,blobDigest,validationDigest]=engineeringRoute;
   if(action==='validate'){
    if(method!=='POST')return deny(response,405,'METHOD_NOT_ALLOWED',[]);
    if(!deps.same(String(request.headers['x-csrf-token']??''),session.csrf))return deny(response,403,'CSRF_INVALID',[]);
    const body=await deps.readBody(request,64*1024),extra=Object.keys(body).filter(k=>!['engineeringRef','robotId'].includes(k));
    if(extra.length||!body.engineeringRef||typeof body.robotId!=='string'){const issues=extra.map(k=>({path:'',code:classifyField(k),message:`Property "${k}" is not allowed`}));return deny(response,422,'INVALID_ENGINEERING_REQUEST',codesOf(issues),issues);}
    try{return send(response,200,await deps.engineering.validateRobotModel(sessionId,body.engineeringRef,body.robotId));}catch(e){return engineeringFailed(response,e);}
   }
   if(action==='compile'){
    if(method!=='POST')return deny(response,405,'METHOD_NOT_ALLOWED',[]);
    if(!deps.same(String(request.headers['x-csrf-token']??''),session.csrf))return deny(response,403,'CSRF_INVALID',[]);
    const body=await deps.readBody(request,2*1024*1024),extra=Object.keys(body).filter(k=>k!=='project');
    if(extra.length||!body.project||typeof body.project!=='object'){const issues=extra.map(k=>({path:'',code:classifyField(k),message:`Property "${k}" is not allowed`}));return deny(response,422,'INVALID_ENGINEERING_REQUEST',codesOf(issues),issues);}
    try{return send(response,200,await deps.engineering.compileEngineeringProject(body.project as never,sessionId));}catch(e){return engineeringFailed(response,e);}
   }
   if(method!=='GET')return deny(response,405,'METHOD_NOT_ALLOWED',[]);
   const digest=manifestDigest??blobDigest??validationDigest;
   if(!/^[0-9a-f]{64}$/.test(digest!))return deny(response,404,'NOT_FOUND',[]);
   try{
    if(validationDigest)return send(response,200,await deps.engineering.readValidation(sessionId,validationDigest));
    if(manifestDigest)return send(response,200,await deps.engineering.readManifest(sessionId,manifestDigest));
    const bytes=await deps.engineering.readBlob(sessionId,blobDigest!);
    response.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-length':bytes.length});
    return void response.end(Buffer.from(bytes));
   }catch(e){return engineeringFailed(response,e);}
  }
  if(sub==='/readiness'){
   const params=new URL(request.url??'/','http://127.0.0.1').searchParams;
   let context:{scenarioId:string;backendSetId:string;project?:unknown;engineering?:{bundleDigest:string;projectDigest:string}};
   let engineeringChecked=false;
   if(method==='GET'){
    if([...params.keys()].some(k=>!['scenarioId','backendSetId'].includes(k))||['scenarioId','backendSetId'].some(k=>params.getAll(k).length!==1||!/^[A-Za-z0-9_.:-]{1,200}$/.test(params.get(k)??'')))return deny(response,400,'INVALID_READINESS_QUERY',[]);
    context={scenarioId:params.get('scenarioId')!,backendSetId:params.get('backendSetId')!};
   }else if(method==='POST'){
    if(!deps.same(String(request.headers['x-csrf-token']??''),session.csrf))return deny(response,403,'CSRF_INVALID',[]);
    const body=await deps.readBody(request);
    if(params.size||Object.keys(body).some(k=>!['scenarioId','backendSetId','project','engineeringRef'].includes(k))||['scenarioId','backendSetId'].some(k=>typeof body[k]!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(body[k] as string))||!Object.hasOwn(body,'project')&&!Object.hasOwn(body,'engineeringRef'))return deny(response,400,'INVALID_READINESS_QUERY',[]);
    context={scenarioId:body.scenarioId as string,backendSetId:body.backendSetId as string,project:body.project};
    if(Object.hasOwn(body,'engineeringRef')){
     // the project is the bundle's locked projection; a supplied one can only be checked for equality against it
     if(!deps.engineering)return deny(response,400,'ENGINEERING_CAPABILITY_REQUIRED',['ENGINEERING_CAPABILITY_REQUIRED']);
     try{const locked=await deps.engineering.admitRun(sessionId,body.engineeringRef,context.backendSetId,body.project);context.project=locked.runtimeProjection.project;context.engineering=locked.ref;engineeringChecked=true;}catch(e){return engineeringFailed(response,e);}
    }
   }else return deny(response,405,'METHOD_NOT_ALLOWED',[]);
   const readinessSet=Object.hasOwn(catalog.sets,context.backendSetId)?catalog.sets[context.backendSetId]:undefined;
   if(readinessSet?.scenarioIds&&!(method==='POST'&&context.project!==undefined&&engineeringChecked))return deny(response,422,'ENGINEERING_REF_REQUIRED',['ENGINEERING_REF_REQUIRED']);
   return send(response,200,await collectReadiness(context,readinessOptions()));
  }
  const route=sub==='/projects/validate'?{allow:'POST',name:'validate'}:sub==='/runs'?{allow:'POST',name:'create'}:undefined;
  const runRoute=new RegExp(`^/runs/(${UUID})(?:/(actions|report|events|telemetry|reclaim|archive))?$`).exec(sub);
  const runAllow=runRoute?({actions:'POST',reclaim:'POST',archive:'POST'}as Record<string,string>)[runRoute[2]??'']??'GET':undefined;
  if(!route&&!runRoute)return deny(response,404,'NOT_FOUND',[]);
  if(method!==(route?.allow??runAllow))return deny(response,405,'METHOD_NOT_ALLOWED',[]);
  if(method==='POST'&&!deps.same(String(request.headers['x-csrf-token']??''),session.csrf))return deny(response,403,'CSRF_INVALID',[]);
  if(route?.name==='validate'){
   const result=validateProjectV2(await deps.readBody(request));
   return result.ok?send(response,200,{ok:true}):deny(response,422,'INVALID_PROJECT',codesOf(result.issues),result.issues);
  }
  if(route?.name==='create'){
   const result=validateRunRequestV2(await deps.readBody(request));
   if(!result.ok)return deny(response,422,'INVALID_RUN_REQUEST',codesOf(result.issues),result.issues);
   const r=result.value;
   let engineering:LockedEngineering|undefined;
   if(!PAIRING_ACCESS.includes(r.access))return deny(response,403,'CAPABILITY_DENIED',['ACCESS_NOT_GRANTED']);
   if(r.runtimeIdentity.sourceCommit!==deps.sourceCommit||r.runtimeIdentity.schemaHash!==deps.schemaHash)return deny(response,409,'CONTRACT_MISMATCH',['CONTRACT_MISMATCH']);
   if(r.engineeringRef){
     // Engineering never falls back to a preset: no capability, wrong mode or an unauthorised/mismatched bundle is a refusal.
     if(!deps.engineering)return deny(response,400,'ENGINEERING_CAPABILITY_REQUIRED',['ENGINEERING_CAPABILITY_REQUIRED']);
     if(r.mode!=='simulation')return deny(response,422,'ENGINEERING_MODE_INVALID',['MODE_BACKEND_MISMATCH']);
     try{engineering=await deps.engineering.admitRun(sessionId,r.engineeringRef,r.backendSetId,r.project);}catch(e){return engineeringFailed(response,e);}
   }
   const project=engineering?engineering.runtimeProjection.project:r.project!;
   const set=Object.hasOwn(catalog.sets,r.backendSetId)?catalog.sets[r.backendSetId]:undefined;
   if(!set)return deny(response,422,'BACKEND_UNAVAILABLE',['BACKEND_SET_UNKNOWN']);
   if(set.mode!==r.mode)return deny(response,422,'BACKEND_UNAVAILABLE',['MODE_BACKEND_MISMATCH']);
   // The set's access is server-owned; the claimed (and already granted) access must equal it, so a shadow grant can never carry a hil/live set.
   if(set.access!==r.access)return deny(response,422,'BACKEND_UNAVAILABLE',['ACCESS_MODE_MISMATCH']);
   // engineering sets run a compiled bundle only: no ref means no run, never the caller's raw project
   if(set.scenarioIds&&!r.engineeringRef)return deny(response,422,'ENGINEERING_REF_REQUIRED',['ENGINEERING_REF_REQUIRED']);
   const scenario=scenarioRegistry.get(r.scenarioId);
   if(!scenario)return deny(response,422,'SCENARIO_UNSUPPORTED',[]);
   const resolution=r.mode==='hardware'?undefined:resolveBackends(scenario,r.mode,r.backendSetId,catalog);
   if(resolution&&!resolution.ok)return deny(response,422,'BACKEND_UNAVAILABLE',resolution.reasonCodes);
   const required=resolution?resolution.required:set.backends;
   if(!required.every(id=>set.backends.includes(id)))return deny(response,422,'BACKEND_UNAVAILABLE',['SCENARIO_BACKEND_MISSING']);
   const admission=admitBackend(r.mode,required,catalog,r.access);
   if(!admission.ok)return deny(response,422,'BACKEND_UNAVAILABLE',admission.reasonCodes);
   // Contract admission and execution availability are separate; native runs require a server-owned factory.
   if((set.mode!=='mock'&&!(set.mode==='simulation'&&deps.simulationFactory))||!required.every(b=>enabled.has(b)))return deny(response,501,'BACKEND_UNAVAILABLE',['BACKEND_EXECUTION_DISABLED']);
   const readiness=await collectReadiness({scenarioId:r.scenarioId,backendSetId:r.backendSetId,project,...engineering?{engineering:engineering.ref}:{}},readinessOptions());
   if(!readiness.canStart)return deny(response,422,'BACKEND_UNAVAILABLE',readiness.checks.flatMap(c=>c.reasonCodes));
   // Expired sessions free active slots. Their durable checkpoints can later be reclaimed with local ownership proof.
   for(const [id,e]of runs){const s=sessions.get(e.owner);if(!s||deps.now()>=s.expiresAt){runs.delete(id);await e.run.close().catch(()=>{});}}
   if(runs.size+creating>=20)return deny(response,429,'RUN_LIMIT',[]);
   creating++;const directory=join(deps.directory,randomUUID());let run:ScenarioRun|undefined;
   try{
    const input:RunManifestInput={project,scenarioId:r.scenarioId,scenarioRevision:r.scenarioRevision,seed:r.seed,mode:r.mode,access:r.access,backendSetId:r.backendSetId,sourceCommit:deps.sourceCommit,...engineering?{engineering}:{}};
    run=await (input.mode==='simulation'?deps.simulationFactory!:createScenarioRun)(input,{directory,catalog,enabledBackends:[...enabled],...engineering?{assets:engineering.runtimeProjection.assets as never,bundleFile}:{}});
    const reclaimToken=token();await saveReclaim(directory,{runId:run.id,proofHash:proofHash(reclaimToken),schemaHash:deps.schemaHash,input});
    // the run → bundle association is durable before the client hears about the run
    if(engineering)await deps.engineering!.bindRun(run.id,engineering.ref);
    const view=await run.snapshot();runs.set(run.id,{owner:sessionId,run,directory,input});return send(response,201,{...view,reclaimToken});
   }catch(e){await run?.close().catch(()=>{});if(r.mode==='mock')await rm(directory,{recursive:true,force:true});return failed(response,e);}
   finally{creating--;}
  }
  const entry=runs.get(runRoute![1]!),kind=runRoute![2];
  if(kind==='reclaim'){
   const body=await deps.readBody(request),id=runRoute![1]!;
   if(Object.keys(body).some(k=>k!=='proof')||typeof body.proof!=='string'||body.proof.length>200)return deny(response,422,'INVALID_RECLAIM',[]);
   const stored=await findReclaim(deps.directory,id);
   if(!stored||!deps.same(proofHash(body.proof),stored.record.proofHash))return deny(response,404,'RUN_NOT_FOUND',[]);
   if(stored.record.schemaHash!==deps.schemaHash||stored.record.input.sourceCommit!==deps.sourceCommit)return deny(response,409,'CONTRACT_MISMATCH',['CONTRACT_MISMATCH']);
   if(reclaiming.has(id)||entry?.archiving)return deny(response,409,'RECLAIM_CONFLICT',[]);
   if(!entry&&runs.size+creating>=20)return deny(response,429,'RUN_LIMIT',[]);
   reclaiming.add(id);if(!entry)creating++;let reopened:ScenarioRun|undefined;
   try{
    const factory=stored.record.input.mode==='simulation'?deps.simulationFactory:createScenarioRun;if(!factory)throw new Error('BACKEND_EXECUTION_DISABLED');
    const locked=stored.record.input.engineering;
    const run=entry?.run??(reopened=await factory(stored.record.input,{directory:stored.directory,catalog,enabledBackends:[...enabled],...locked?{assets:locked.runtimeProjection.assets as never}:{}}));
    // a verified proof restores read access to this run's bundle for the new session; it never confers control
    if(locked&&deps.engineering)await deps.engineering.grantRun(sessionId,locked.ref);
    const closure=locked&&deps.engineering?await deps.engineering.verifyClosure(locked.ref.bundleDigest):null;
    const view=await run.holdForReclaim();
    if(entry){entry.owner=sessionId;entry.readOnly=true;entry.input=stored.record.input;}else runs.set(id,{owner:sessionId,run,directory:stored.directory,readOnly:true,input:stored.record.input});
    // Only the proof-protected record supplies reset/evidence inputs; the caller cannot substitute a project or seed.
    return send(response,200,{...view,controlAccess:'view_reconcile',lockedInput:structuredClone(stored.record.input),...closure?{engineeringClosure:{status:closure.length?'missing':'ok',problems:closure}}:{}});
   }catch(e){await reopened?.close().catch(()=>{});return failed(response,e);}finally{reclaiming.delete(id);if(!entry)creating--;}
  }
  if(kind==='actions'){
   const action=validateActionV2(await deps.readBody(request));
   if(!action.ok)return deny(response,422,'INVALID_ACTION',codesOf(action.issues),action.issues);
   if(!entry||entry.owner!==sessionId)return deny(response,404,'RUN_NOT_FOUND',[]);
   if(entry.archiving||reclaiming.has(runRoute![1]!))return deny(response,409,'RUN_ARCHIVE_CONFLICT',[]);
   if(entry.readOnly&&action.value.kind!=='reconcile')return deny(response,403,'RECLAIM_READ_ONLY',['VIEW_RECONCILE_ONLY']);
   const beforeExecute=action.value.kind==='start'||action.value.kind==='resume'?async()=>{
    // the bundle a run was created from must still be whole before any motion is started or resumed
    if(entry.input.engineering&&deps.engineering&&(await deps.engineering.verifyClosure(entry.input.engineering.ref.bundleDigest)).length)throw new Error('ENGINEERING_CLOSURE_MISSING');
    const readiness=await collectReadiness({scenarioId:entry.input.scenarioId,backendSetId:entry.input.backendSetId,project:entry.input.project,...entry.input.engineering?{engineering:entry.input.engineering.ref}:{},runId:entry.run.id},readinessOptions());
    if(!readiness.canStart)throw new Error(`BACKEND_UNAVAILABLE:${readiness.checks.flatMap(c=>c.reasonCodes).join(',')}`);
   }:undefined;
   try{return send(response,200,await entry.run.action(action.value,beforeExecute));}catch(e){return failed(response,e);}
  }
  if(!entry||entry.owner!==sessionId)return deny(response,404,'RUN_NOT_FOUND',[]);
  if(kind==='archive'){
   const body=await deps.readBody(request);if(Object.keys(body).length)return deny(response,422,'INVALID_ARCHIVE',[]);
   if(entry.archiving||reclaiming.has(runRoute![1]!))return deny(response,409,'RUN_ARCHIVE_CONFLICT',[]);
   entry.archiving=true;
   try{
    const report=await entry.run.report(),view=await entry.run.snapshot();
    await writeFile(join(entry.directory,`archive-${view.run.runRevision}.json`),JSON.stringify(report),{mode:0o600,flag:'wx'}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
    await entry.run.close();runs.delete(entry.run.id);return send(response,200,{archived:true,runId:entry.run.id,eventCursor:view.run.eventCursor});
   }catch(e){entry.archiving=false;return failed(response,e);}
  }
  if(kind==='events'||kind==='telemetry'){streams.add(response);return serveRunStream(kind,entry.run,request,response,streamOptions,new URL(request.url??'/','http://127.0.0.1'),()=>streams.delete(response),()=>sessions.get(sessionId)===session&&deps.now()<session.expiresAt&&runs.get(entry.run.id)===entry&&entry.owner===sessionId&&!entry.archiving);}
  try{return send(response,200,kind==='report'?{...await entry.run.report(),schemaHash:deps.schemaHash,protocolMajor:2}:{...await entry.run.snapshot(),...entry.readOnly?{controlAccess:'view_reconcile'}:{}});}catch(e){return failed(response,e);}
 };
 return Object.assign(handle,{
  /** Ends open SSE connections so the HTTP server can close. */
  endStreams(){for(const r of streams)r.end();streams.clear();},
  close:async()=>{await Promise.all([...runs.values()].map(x=>x.run.close().catch(()=>{})));runs.clear();}});
}
