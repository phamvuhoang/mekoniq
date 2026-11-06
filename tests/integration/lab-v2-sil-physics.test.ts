// SIM-07/08/10 physics honesty of the SIL orchestrator: an unavailable backend is refused before any effect; a worker claiming `sil` evidence
// without sensor liveness or separation samples can never pass a physics row; measured rows come only from worker events; transfer barriers map
// the clocks; orchestrator-scoped faults fire once and are recorded. The worker is a PROTOCOL DOUBLE: these prove the orchestrator's bookkeeping.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSilScenario,type SilRunOptions} from '../../packages/lab-runtime/src/v2/sil/campaign';
import {startGazeboBackend} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {buildSimulationEvidence} from '../../packages/lab-runtime/src/v2/reports/simulation-evidence';
import {FakeWorkerPort,compiledWorld,type FakeScene} from '../support/sil-rig';
import {corridor,restaurant} from '../support/lab-v2';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const TWO=[{entityId:'amr-a',namespace:'robot_amr_a'},{entityId:'amr-b',namespace:'robot_amr_b'}];
const byId=(r:{assertions:{id:string}[]})=>Object.fromEntries(r.assertions.map(a=>[a.id,a]));
async function run(o:{scenarioId?:'FD01'|'FD07';capability?:{available?:boolean;evidence?:string;reasons?:string[]};scene?:FakeScene;faults?:SilRunOptions['faults'];maxIterations?:number}={}){
 const out=await mkdtemp(join(tmpdir(),'lab-v2-sil-phys-'));dirs.push(out);
 const scenarioId=o.scenarioId??'FD01',robots=scenarioId==='FD07'?TWO:undefined;
 let port!:FakeWorkerPort;
 const result=await runSilScenario({scenarioId,scenarioRevision:1,seed:17,project:scenarioId==='FD07'?corridor():restaurant(),sourceCommit:'test-commit',outDir:out,world:compiledWorld(out,robots),backendSetId:'simulation-default',maxIterations:o.maxIterations??6000,paceMs:0,
  ...o.faults?{faults:o.faults}:{},backendFactory:async(world,runId)=>{port=new FakeWorkerPort({nativeResult:'completed',capability:o.capability,scene:o.scene});port.runId=runId;return startGazeboBackend(world,runId,{port,startupTimeoutMs:0});}});
 const observationAssessment=JSON.parse(await readFile(join(out,'contacts.json'),'utf8')).physicsAssessment;return {out,result,port,assessment:{assertions:observationAssessment}};
}

test('an unavailable backend is refused before any effect: no source journal, no bundle, the reasons in the error',async()=>{
 const out=await mkdtemp(join(tmpdir(),'lab-v2-sil-phys-'));dirs.push(out);
 await expect(runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'t',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:10,paceMs:0,
  backendFactory:async(world,runId)=>startGazeboBackend(world,runId,{startupTimeoutMs:0,port:new FakeWorkerPort({nativeResult:'completed',capability:{available:false,evidence:'none',reasons:['NAV2_NOT_READY:robot_amr_1:LOCALIZATION_UNAVAILABLE']}})})}))
  .rejects.toThrow('BACKEND_UNAVAILABLE:NAV2_NOT_READY:robot_amr_1:LOCALIZATION_UNAVAILABLE');
 expect(await readdir(out)).toEqual([]);
});

test('a worker claiming sil evidence without contact-sensor liveness or separation samples never passes a physics row',async()=>{
 const {result,assessment}=await run({capability:{evidence:'sil'}});
 expect(result.manifest.evidence).toBe('protocol_double');expect(byId(result)['SIM.no-contact']).toMatchObject({result:'not_run',reason:'PHYSICS_EVIDENCE_MISSING'});expect(result.manifest.status).toBe('completed');
 const a=byId(assessment);
 expect(a['SIM.no-contact']).toMatchObject({result:'not_run',reason:'CONTACT_SENSOR_SILENT:amr-1'});
 expect(a['SIM.min-separation']).toMatchObject({result:'not_run',reason:'SINGLE_ROBOT'});
 const two=await run({scenarioId:'FD07',capability:{evidence:'sil'}});
 expect(two.result.manifest.status).toBe('completed');
 expect(byId(two.assessment)['SIM.min-separation']).toMatchObject({result:'not_run',reason:'SEPARATION_NOT_COMPUTED'});
 expect(byId(two.assessment)['SIM.no-contact']).toMatchObject({result:'not_run',reason:'CONTACT_SENSOR_SILENT:amr-a,amr-b'});
 // the evidence record follows: physics not_run, never pass
 const rec=buildSimulationEvidence({schemaHash:'c'.repeat(64),matrixId:'FD07',source:{kind:'sil',manifest:two.result.manifest,assertions:two.result.assertions}}).records;
 expect(rec.find(r=>r.id.endsWith(':physics'))).toMatchObject({result:'not_run',actualFidelity:'business'});
});

test('pure assessment of protocol-double worker observations: liveness + clearance pass, a reported contact fails, an overlap fails',async()=>{
 const clear=await run({scenarioId:'FD07',capability:{evidence:'sil'},scene:{robots:TWO,liveness:true,gapM:0.42}});
 const a=byId(clear.assessment);
 expect(a['SIM.no-contact']).toMatchObject({result:'pass',detail:expect.stringContaining('0 contacts')});
 expect(a['SIM.min-separation']).toMatchObject({result:'pass',detail:expect.stringContaining('0.42')});
 const telemetry=JSON.parse(await readFile(join(clear.out,'telemetry.json'),'utf8'));
 expect(telemetry.samples.length).toBeGreaterThan(0);expect(Object.keys(telemetry.sampleCounts).sort()).toEqual(['amr-a','amr-b']);
 const contacts=JSON.parse(await readFile(join(clear.out,'contacts.json'),'utf8'));
 expect(contacts).toMatchObject({available:false,evidence:'protocol_double',contacts:[],liveness:{'amr-a':expect.any(Number),'amr-b':expect.any(Number)},separation:{samples:expect.any(Number),min:{gapM:0.42,a:'amr-a',b:'amr-b'}}});
 const hit=await run({scenarioId:'FD07',capability:{evidence:'sil'},scene:{robots:TWO,liveness:true,gapM:0.42,contacts:[{pair:['robot_amr_a','wall-north'],point:[1,2,0],normal:[1,0,0],depthM:0.002,robot:'amr-a'}]}});
 expect(byId(hit.assessment)['SIM.no-contact']).toMatchObject({result:'fail',detail:expect.stringContaining('1 contacts')});
 const overlap=await run({scenarioId:'FD07',capability:{evidence:'sil'},scene:{robots:TWO,liveness:true,gapM:0}});
 expect(byId(overlap.assessment)['SIM.min-separation']).toMatchObject({result:'fail',reason:'FOOTPRINT_OVERLAP'});
 const rec=buildSimulationEvidence({schemaHash:'c'.repeat(64),matrixId:'FD07',source:{kind:'sil',manifest:clear.result.manifest,assertions:clear.result.assertions}}).records;
 expect(rec.find(r=>r.id.endsWith(':physics'))).toMatchObject({result:'not_run',actualFidelity:'business'});
});

test('every load/handoff confirmation opens a transfer barrier the worker acks with both clocks; records are part of the bundle',async()=>{
 const {out,result,port}=await run({scene:{robots:[{entityId:'amr-1',namespace:'robot_amr_1'}],liveness:true}});
 expect(result.manifest.status).toBe('completed');
 const barriers=JSON.parse(await readFile(join(out,'barriers.json'),'utf8')) as {barrierId:string;status:string;participants:string[];acks:{participant:string;simTimeNs:string|null;clockNs:string}[];skewNs:string|null}[];
 expect(barriers.length).toBe(2);                                                   // load at the kitchen, handoff at the table; standby is no transfer
 for(const b of barriers){expect(b.status).toBe('complete');expect(b.participants).toEqual(['amr-1']);expect(b.acks[0]).toMatchObject({participant:'amr-1',simTimeNs:expect.stringMatching(/^\d+$/)});}
 expect(port.barriers.map(b=>b.barrierId)).toEqual(barriers.map(b=>b.barrierId));
 const manifest=JSON.parse(await readFile(join(out,'run-manifest.json'),'utf8'));
 expect(manifest.outputs.map((o:{path:string})=>o.path)).toContain('barriers.json');
 expect(manifest.outputs.map((o:{path:string})=>o.path)).toContain('faults.json');
});

test('orchestrator-scoped faults fire once at their iteration and are recorded; a map change refuses the next goal with a reason',async()=>{
 const {out,result}=await run({faults:[{atTick:3,faultId:'duplicate-observation',entityId:'amr-1'},{atTick:0,faultId:'blocker-on',entityId:'chair'},{atTick:40,faultId:'map-changed',entityId:'amr-1'}],maxIterations:400});
 const faults=JSON.parse(await readFile(join(out,'faults.json'),'utf8')) as {faultId:string;scope:string;iteration?:number;applied:unknown;outcome?:string}[];
 expect(faults.filter(f=>f.scope==='orchestrator').map(f=>[f.faultId,f.applied])).toEqual([['duplicate-observation',true],['map-changed',true]]);
 expect(faults.find(f=>f.faultId==='blocker-on')).toMatchObject({scope:'worker',applied:'deferred_to_worker'});
 const dup=String(faults.find(f=>f.faultId==='duplicate-observation')!.outcome);                                 // a replay is refused or re-recorded: it never advances a mission, cargo or delivery
expect(dup).toMatch(/^(rejected:|accepted:)/);for(const t of ['MissionArrived','MissionStopAdvanced','CargoLoaded','DeliveryHandedOff','MissionCompleted','RobotGoalCompleted'])expect(dup).not.toContain(t);
 expect(result.manifest.status).toBe('needs_attention');
 expect(result.assertions.find(a=>a.id==='SIM.progress-or-reason')).toMatchObject({result:'pass',detail:expect.stringContaining('MAP_MISMATCH')});
 await expect(run({faults:[{atTick:1,faultId:'nope'}]})).rejects.toThrow('FAULT_SCHEDULE_INVALID');
});
