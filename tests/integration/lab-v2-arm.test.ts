// A05: the LinuxCNC arm adapter speaks arm.command.v1 to the bridge with the lab_simulation lease, keeps accepted apart from completed,
// never resends an unknown, turns bridge status/events into CellReports and TwinSamples (commanded and actual apart, controller_sim origin),
// and plugs into the plant session as a closed-loop controller. A missing bridge is unavailable, never a mock. Double = protocol_double.
import {existsSync,readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import type {JsonObject,JsonValue} from '../../packages/contracts/src/index';
import {hashPayload} from '../../packages/contracts/src/canonical';
import type {CellCommand,CellReport} from '../../packages/cell-adapters/src/contract';
import {LinuxcncArmAdapter,LINUXCNC_SIM,connectArmBackend,connectBridge,loadArmProfile,type ArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {createArmSession,admitPickup,loadArmModel,tsChecker} from '../../packages/lab-runtime/src/v2/arm/session';
import {validateTwinSampleV2} from '../../packages/lab-runtime/src/v2/contracts';
import {createPlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import {ArmBridgeDouble} from '../support/arm-bridge-double';
const RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c',ARM='arm-1',CELL='cell-1';
const PROFILE_PATH='integrations/arm-controller/configs/sim/puma560/profile.json',MODEL_DIR='integrations/arm-controller/models/puma560-reference';
let t=Date.parse('2026-11-05T08:00:00Z');const nowMs=()=>t;
const cmd=(capability:CellCommand['capability'],payload:JsonObject,commandId:string,program:{id:string;hash:string}|null=null,o:{runId?:string;epoch?:number}={}):CellCommand=>({commandId,runId:o.runId??RUN,deviceId:ARM,controlEpoch:o.epoch??1,expiresAt:new Date(t+30000).toISOString(),recipeRevision:null,programRef:program,capability,payloadHash:hashPayload(payload as JsonValue),payload} as CellCommand);
function rig(o:{profile?:ArmProfile}={}){
 const profile=o.profile??loadArmProfile(PROFILE_PATH),double=new ArmBridgeDouble(loadArmProfile(PROFILE_PATH),nowMs);
 const adapter=new LinuxcncArmAdapter({port:double,profile,runId:RUN,cellId:CELL,deviceId:ARM,nowMs});
 const reports:CellReport[]=[];adapter.observe(r=>reports.push(r));
 const pick={id:'cup-pick',hash:profile.programs['cup-pick']!.sha256};
 return {profile,double,adapter,reports,pick};
}
afterEach(()=>{t=Date.parse('2026-11-05T08:00:00Z');});

test('a missing bridge is unavailable with its reason; nothing falls back to the mock arm',async()=>{
 const c=await connectArmBackend({socketPath:join(tmpdir(),'no-such-mekoniq-bridge.sock'),timeoutMs:200});
 expect(c).toMatchObject({backendId:'linuxcnc_sim',available:false,evidence:'none'});expect(c.reasons[0]).toMatch(/^BRIDGE_UNREACHABLE:/);
 expect(LINUXCNC_SIM).toEqual({id:'linuxcnc_sim',version:'1',model:'puma560-reference',dynamics:false});
});

test('the adapter acquires the lab lease, stages and starts an approved program, answers duplicates once and separates accepted from completed',async()=>{
 const {adapter,double,reports,pick}=rig();
 await adapter.open();
 expect(double.owner).toMatchObject({actor:'lab_simulation'});
 expect(await adapter.describe()).toMatchObject({cellId:CELL,deviceIds:[ARM],adapter:'linuxcnc_sim',version:'1',model:'puma560-reference',validation:'simulated',capabilities:['stage_program','start_job','pause_job','resume_job','cancel_job','query_outcome']});
 expect(await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick))).toEqual({accepted:true,unknown:false});
 const run=cmd('start_job',{jobId:'job-1'},'c-run',pick);
 expect(await adapter.execute(run)).toEqual({accepted:true,unknown:false});
 expect(await adapter.execute(run)).toEqual({accepted:true,unknown:false});expect(double.sends).toBe(1);
 expect(double.log.at(-1)).toMatchObject({kind:'arm.command.v1',owner:{actor:'lab_simulation'},command:{commandId:'c-run',capability:'start_job'}});
 expect(await adapter.reconcile('c-run')).toMatchObject({status:'running'});
 expect(reports.map(r=>r.observation?.result)).toEqual(['accepted','accepted']);         // staging and the start are accepted, nothing is completed
 double.finish('c-run','completed',{controlEpoch:1,payloadHash:run.payloadHash,deviceId:ARM,evidence:{gripper:'unknown',objectPresent:null,source:'linuxcnc_sim'}});
 const done=reports.find(r=>r.observation?.result==='completed')!;
 expect(done).toMatchObject({deviceId:ARM,bootId:'ctl-double-1',observation:{commandId:'c-run',result:'completed',payloadHash:run.payloadHash},evidence:{source:'linuxcnc_sim',objectPresent:null}});
 expect(await adapter.reconcile('c-run')).toMatchObject({status:'completed'});
 expect(await adapter.execute(cmd('start_job',{jobId:'job-2'},'c-run',pick))).toEqual({accepted:false,unknown:false,reason:'COMMAND_ID_CONFLICT'});
 await adapter.close();expect(double.owner).toBeNull();
});

test('a lost reply after the send is unknown; a retry of the same id asks and never resends',async()=>{
 const {adapter,double,pick}=rig();await adapter.open();
 await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick));
 double.loseReply=true;
 expect(await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run',pick))).toMatchObject({accepted:false,unknown:true});
 expect(await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run',pick))).toMatchObject({unknown:true});expect(double.sends).toBe(1);
 expect(await adapter.reconcile('c-run')).toMatchObject({status:'running'});
 expect(await adapter.cancel('c-run')).toEqual({acknowledged:true,unknown:false});expect(double.interp).toBe('idle');
});

test('profile, model and run identity are checked before anything is sent',async()=>{
 const tampered=structuredClone(loadArmProfile(PROFILE_PATH));tampered.telemetry.staleMs=999;   // schema-valid, but not the bridge's profile
 const {adapter,double,pick}=rig({profile:tampered});
 await expect(adapter.open()).rejects.toThrow('ARM_OWNER_UNAVAILABLE:PROFILE_MISMATCH');
 const ok=rig();await ok.adapter.open();
 expect(await ok.adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick,{runId:'9f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c'}))).toEqual({accepted:false,unknown:false,reason:'RUN_MISMATCH'});
 expect(await ok.adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-free',{id:'free-text',hash:'1'.repeat(64)}))).toEqual({accepted:false,unknown:false,reason:'PROGRAM_NOT_ALLOWLISTED:free-text'});
 expect(await ok.adapter.execute(cmd('brew',{recipeId:'espresso',cupId:'cup-1'},'c-brew'))).toEqual({accepted:false,unknown:false,reason:'ARM_CAPABILITY_UNSUPPORTED:brew'});
 expect(ok.double.sends).toBe(0);expect(double.log).toHaveLength(1);                     // only the refused acquire reached the tampered double
});

test('status frames become controller_sim twin samples with commanded and actual apart; a missing pose is unknown with a reason',async()=>{
 const {adapter,double}=rig();await adapter.open();
 const session=createArmSession({model:loadArmModel(MODEL_DIR),checker:tsChecker(),entityId:ARM,runId:RUN,providerId:'linuxcnc_sim',staleMs:500});
 adapter.onStatus(s=>session.ingest(s,'1'));
 double.jointsRad=[0.1,-0.2,0.3,0,0.5,0];double.commandedRad=[0.1,-0.2,0.31,0,0.5,0];double.emitStatus();
 const s=session.samples().at(-1)!;
 expect(validateTwinSampleV2(s).ok).toBe(true);
 expect(s).toMatchObject({entityId:ARM,providerId:'linuxcnc_sim',origin:'controller_sim',frameId:'arm_base',quality:'valid',observed:{jointsRad:[0.1,-0.2,0.3,0,0.5,0],homed:true},commanded:{jointsRad:[0.1,-0.2,0.31,0,0.5,0]},bootId:'ctl-double-1'});
 expect(session.capability()).toMatchObject({closedLoop:true,feedback:'controller_actual'});
 double.emitStatus({actualRad:null});
 const u=session.samples().at(-1)!;expect(validateTwinSampleV2(u).ok).toBe(true);
 expect(u).toMatchObject({quality:'unknown',reasonCodes:['POSE_MISSING'],observed:null});
 expect(session.capability()).toMatchObject({coupling:'closed_loop_controller',closedLoop:false,armController:'linuxcnc_sim',feedback:'none',checker:{engine:'capsule-sweep-v1',available:true}});
 expect(session.trace().map(x=>x.tick)).toEqual([0,1]);
});

test('a controller restart turns the running job unknown, drops the lease and never resumes',async()=>{
 const {adapter,double,reports,pick}=rig();await adapter.open();
 await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick));await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run',pick));
 double.reboot('ctl-double-2');
 expect(reports.at(-1)).toMatchObject({bootId:'ctl-double-2',observation:{commandId:'c-run',result:'outcome_unknown',reasonCodes:['OBSERVER_REBOOT']}});
 expect(await adapter.reconcile('c-run')).toMatchObject({status:'unknown'});
 expect(await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run-2',pick))).toEqual({accepted:false,unknown:false,reason:'ARM_OWNER_LOST'});
 expect(double.sends).toBe(1);expect(double.interp).toBe('idle');
});

test('the plant session with the LinuxCNC arm reports a closed-loop controller coupling and one controller per joint',async()=>{
 const {adapter,double}=rig();await adapter.open();
 const session=createArmSession({model:loadArmModel(MODEL_DIR),checker:tsChecker(),entityId:ARM,runId:RUN,providerId:'linuxcnc_sim',staleMs:500});
 adapter.onStatus(s=>session.ingest(s,'1'));
 const plant=createPlantSession({runId:RUN,cellId:CELL,armId:ARM,nowMs,receiver:()=>null,dock:()=>({robotId:'amr-1',errorM:3,moving:false,localizationValid:true,bootId:'b'}),traySensor:()=>false,arm:{adapter,session}});
 expect(plant.capability()).toMatchObject({coupling:'closed_loop_controller',closedLoop:false,feedback:'none',armController:'linuxcnc_sim'});   // wired, no frame yet: no feedback claim
 double.emitStatus();
 expect(plant.capability()).toMatchObject({coupling:'closed_loop_controller',closedLoop:true,feedback:'controller_actual',armController:'linuxcnc_sim',jointAuthority:expect.arrayContaining([{joint:'J1',controller:'linuxcnc_sim'}]),checker:{engine:'capsule-sweep-v1'},provenance:'controller_sim'});
 expect(plant.adapters.map(a=>a.constructor.name)).toEqual(['CoffeeIoSimAdapter','LinuxcncArmAdapter']);
 expect(plant.report()).toMatchObject({coupling:'closed_loop_controller',arm:{provider:'linuxcnc_sim',samples:1}});
});

test('coffee pickup admission follows the shared fixture: ACKs are not completion, lost grip or cancel never serves',()=>{
 const fx=JSON.parse(readFileSync('integrations/arm-controller/tests/fixtures/coffee-handoff.json','utf8')) as {order:string[];cases:{name:string;inputs:Parameters<typeof admitPickup>[0];expected:ReturnType<typeof admitPickup>}[]};
 expect(fx.cases.length).toBeGreaterThanOrEqual(16);
 for(const c of fx.cases){const got=admitPickup(c.inputs);expect(got,c.name).toEqual(c.expected);expect(got.reasonCodes,c.name).toEqual([...got.reasonCodes].sort((a,b)=>fx.order.indexOf(a)-fx.order.indexOf(b)));}
});

test('every envelope carries a request id the reply echoes; over the socket a late reply never answers the next request',async()=>{
 const {adapter,double,pick}=rig();await adapter.open();await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick));
 const ids=double.log.map(m=>m.requestId);expect(ids.every(id=>typeof id==='string'&&id.length>0)).toBe(true);expect(new Set(ids).size).toBe(ids.length);
 // a bridge that answers the FIRST request late: FIFO matching would hand reply B to request A; requestId correlation keeps each with its own
 const sock=join(mkdtempSync(join(tmpdir(),'arm-order-')),'b.sock');
 const server=createServer(c=>{let buf='';const pending:string[]=[];c.on('data',(d:Buffer)=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);pending.push(m.requestId);
  if(pending.length===2){const [first,second]=pending.splice(0);c.write(JSON.stringify({schemaVersion:1,kind:'arm.reply.v1',requestId:second,commandId:'B',status:'rejected',lifecycle:'none',duplicate:false,reasonCodes:['SECOND']})+'\n');
   setTimeout(()=>c.write(JSON.stringify({schemaVersion:1,kind:'arm.reply.v1',requestId:first,commandId:'A',status:'accepted',lifecycle:'none',duplicate:false,reasonCodes:['FIRST']})+'\n'),20);}}});});
 await new Promise<void>(r=>server.listen(sock,r));
 try{
  const port=await connectBridge(sock,2000),base=loadArmProfile(PROFILE_PATH);
  const env=(id:string)=>({schemaVersion:1,kind:'arm.command.v1',requestId:id,machineId:base.machineId,controllerEpoch:1,owner:{token:'',actor:'lab_simulation'},leaseId:'',expected:{profileHash:'0'.repeat(64),modelManifestSha256:base.model.manifestSha256},reconcile:{commandId:id}}) as never;
  const [a,b]=await Promise.all([port.send(env('A')),port.send(env('B'))]);
  expect((a as {commandId:string}).commandId).toBe('A');expect((b as {commandId:string}).commandId).toBe('B');
  await port.close();
 }finally{server.close();}
});

test('the adapter renews its lease before expiry and, after losing it, reconciles its own commands without an owner',async()=>{
 vi.useFakeTimers();
 try{
  const {adapter,double,pick,profile}=rig();await adapter.open();
  const renewsBefore=double.log.filter(m=>m.renew).length;
  await vi.advanceTimersByTimeAsync(profile.lease.ttlMs-profile.lease.renewBeforeMs+5);
  expect(double.log.filter(m=>m.renew).length).toBe(renewsBefore+1);expect(double.owner).not.toBeNull();
  await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick));await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run',pick));
  double.expireLease();                                                                      // the bridge dropped the lease with the job in flight
  expect(await adapter.reconcile('c-run')).toMatchObject({status:'unknown'});                // asked through the ownerless reconcile shape, not query_outcome
  expect(double.log.at(-1)!.reconcile).toEqual({commandId:'c-run'});
  expect(await adapter.execute(cmd('start_job',{jobId:'job-2'},'c-run-2',pick))).toEqual({accepted:false,unknown:false,reason:'ARM_OWNER_LOST'});
  await adapter.open();expect(double.owner).not.toBeNull();                                  // an explicit re-acquire works once the bridge no longer requires reconciliation
  await adapter.close();
 }finally{vi.useRealTimers();}
});

test('status frames with reconcile state and lifecycle events reach the domain as reports',async()=>{
 const {adapter,double,reports,pick}=rig();await adapter.open();
 await adapter.execute(cmd('stage_program',{profileId:'puma560-sim-1'},'c-stage',pick));await adapter.execute(cmd('start_job',{jobId:'job-1'},'c-run',pick));
 double.emitEvent('owner_revoked',null,['OPERATOR']);double.emitEvent('outcome_unknown','c-run',['REVOKED']);
 expect(reports.at(-1)).toMatchObject({observation:{commandId:'c-run',result:'outcome_unknown',reasonCodes:['REVOKED']}});
 double.emitStatus({reconcileRequired:true,unknownCommands:['c-run']});
 expect(reports.at(-1)).toMatchObject({status:{status:'fault',reasonCodes:['RECONCILE_REQUIRED']}});
});

const PY=resolve('.venv/bin/python'),pyOk=existsSync(PY)&&spawnSync(PY,['-c','import jsonschema, referencing'],{encoding:'utf8'}).status===0;
test.skipIf(!pyOk)('the real Python bridge service (fake controller) accepts the adapter end to end over its Unix socket',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'arm-bridge-')),sock=join(dir,'bridge.sock');
 const child=spawn(PY,['tests/fake_service.py','--socket',sock,'--journal',join(dir,'journal.jsonl')],{cwd:'integrations/arm-controller',stdio:['ignore','pipe','inherit']});
 try{
  await new Promise<void>((ok,fail)=>{child.stdout.once('data',()=>ok());child.once('exit',c=>fail(new Error(`fake service exit ${c}`)));});
  const cap=await connectArmBackend({socketPath:sock,timeoutMs:3000});
  expect(cap).toMatchObject({backendId:'linuxcnc_sim',available:true,evidence:'controller_sim',machineId:'puma560-sim-1'});
  const adapter=new LinuxcncArmAdapter({port:cap.port!,profile:loadArmProfile(PROFILE_PATH),runId:RUN,cellId:CELL,deviceId:ARM,nowMs:()=>Date.now()});
  await adapter.open();
  const pick={id:'cup-pick',hash:loadArmProfile(PROFILE_PATH).programs['cup-pick']!.sha256},now=Date.now();
  const stage={...cmd('stage_program',{profileId:'puma560-sim-1'},'py-stage',pick),expiresAt:new Date(now+30000).toISOString()},run={...cmd('start_job',{jobId:'job-1'},'py-run',pick),expiresAt:new Date(now+30000).toISOString()};
  expect(await adapter.execute(stage)).toEqual({accepted:true,unknown:false});
  expect(await adapter.execute(run)).toEqual({accepted:true,unknown:false});
  expect(await adapter.execute(run)).toEqual({accepted:true,unknown:false});
  expect(await adapter.reconcile('py-run')).toMatchObject({status:'running'});
  expect(await adapter.execute({...run,payloadHash:hashPayload({jobId:'other'}),payload:{jobId:'other'}} as CellCommand)).toEqual({accepted:false,unknown:false,reason:'COMMAND_ID_CONFLICT'});
  await adapter.close();
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
},20000);
