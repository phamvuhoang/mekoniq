// SIM-10 / SIM-08: the SIL scenario orchestrator drives a registry scenario (orders, confirmations, parking) through the real source domain
// with a gazebo_nav2 backend, paces by iteration, ingests worker telemetry/contacts and writes a hashed run bundle whose assertions separate
// business pass from physics evidence. Here the backend is a PROTOCOL DOUBLE: business assertions run for real, physics rows stay not_run.
import {afterEach,expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSilScenario} from '../../packages/lab-runtime/src/v2/sil/campaign';
import {startGazeboBackend} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {FakeWorkerPort,compiledWorld} from '../support/sil-rig';
import {restaurant} from '../support/lab-v2';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function run(nativeResult:'completed'|'accepted'|'aborted',o:{seed?:number;maxIterations?:number}={}){
 const out=await mkdtemp(join(tmpdir(),'lab-v2-sil-run-'));dirs.push(out);
 let port:FakeWorkerPort|undefined;
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:o.seed??17,project:restaurant(),sourceCommit:'test-commit',outDir:out,
  world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:o.maxIterations??4000,paceMs:0,
  backendFactory:async(world,runId)=>{port=new FakeWorkerPort({nativeResult});return startGazeboBackend(world,runId,{port});}});
 return {out,result,port:port!};
}

test('FD01 over a protocol double: business assertions pass from the journal, physics rows are not_run, the bundle is hashed and labelled',async()=>{
 const {out,result,port}=await run('completed');
 expect(result.manifest).toMatchObject({schemaVersion:1,mode:'simulation',access:'simulated',backendSetId:'simulation-default',backends:['gazebo_nav2'],scenario:{id:'FD01',revision:1},seed:17,
  evidence:'protocol_double',backendCapability:{backendId:'gazebo_nav2',available:true,step:false},world:{inputHash:'a'.repeat(64),manifestHash:'b'.repeat(64)},status:'completed'});
 expect(result.manifest.runId).toMatch(/^[0-9a-f-]{36}$/);expect(result.manifest.sourceCommit).toBe('test-commit');expect(result.manifest.prng).toMatchObject({algorithm:'xoshiro128**'});
 expect(result.business).toMatchObject({served:'1',missions:{completed:2,needsAttention:0,open:0}}); // the delivery and the parking standby
 const byId=Object.fromEntries(result.assertions.map(a=>[a.id,a]));
 expect(byId['FD01.served-after-handoff']).toMatchObject({result:'pass'});
 expect(byId['FD01.arrival-from-observation']).toMatchObject({result:'pass',detail:expect.stringContaining('3')});
 expect(byId['FD01.parked-not-charging']).toMatchObject({result:'pass'});
 expect(byId['SIM.no-contact']).toMatchObject({result:'not_run',reason:'PHYSICS_EVIDENCE_MISSING'});
 expect(byId['SIM.progress-or-reason']).toMatchObject({result:'pass'});
 // what the worker was asked, in order: three legs, each once; nothing after the park
 expect(port.executeCalls).toBe(3);
 // the bundle: manifest + journal + effects + telemetry + contacts + assertions, each hashed into the manifest
 const manifest=JSON.parse(await readFile(join(out,'run-manifest.json'),'utf8'));
 expect(manifest.outputs.map((o:{path:string})=>o.path).sort()).toEqual(['assertions.json','barriers.json','contacts.json','effects.json','faults.json','journal.json','telemetry.json']);
 for(const o of manifest.outputs)expect(sha(await readFile(join(out,o.path)))).toBe(o.sha256);
 const telemetry=JSON.parse(await readFile(join(out,'telemetry.json'),'utf8'));
 expect(telemetry).toMatchObject({source:'gazebo_nav2 worker events',samples:[],sampleCounts:{}});
 expect(JSON.parse(await readFile(join(out,'contacts.json'),'utf8'))).toMatchObject({available:false,reason:'PHYSICS_EVIDENCE_MISSING',evidence:'protocol_double',contacts:[],physicsAssessment:expect.arrayContaining([expect.objectContaining({id:'SIM.no-contact',result:'not_run'})])});
 const journal=JSON.parse(await readFile(join(out,'journal.json'),'utf8')) as {events:{type:string}[]}[];
 const types=journal.flatMap(j=>j.events.map(e=>e.type));
 expect(types.filter(t=>t==='MissionArrived')).toHaveLength(3);expect(types.indexOf('CargoLoaded')).toBeLessThan(types.indexOf('DeliveryHandedOff'));
 // the same inputs over the same double produce the same canonical business outcome (digest); run ids differ
 const again=await run('completed');
 expect(again.result.manifest.businessDigest).toBe(result.manifest.businessDigest);
 expect(again.result.manifest.runId).not.toBe(result.manifest.runId);
});

test('a goal that never completes leaves the run with an explicit failure reason, never a pass',async()=>{
 const {result}=await run('accepted',{maxIterations:300});
 expect(result.manifest.status).toBe('timeout');
 expect(result.assertions.find(a=>a.id==='SIM.progress-or-reason')).toMatchObject({result:'fail',reason:'NO_PROGRESS:ITERATION_LIMIT'});
 expect(result.assertions.find(a=>a.id==='FD01.served-after-handoff')).toMatchObject({result:'fail'});
 expect(result.business.served).toBe('0');
});

test('an aborted goal needs attention: no arrival, no delivery, reason recorded',async()=>{
 const {result}=await run('aborted');
 expect(result.manifest.status).toBe('needs_attention');
 expect(result.business.missions.needsAttention).toBe(1);
 expect(result.assertions.find(a=>a.id==='SIM.progress-or-reason')).toMatchObject({result:'pass',detail:expect.stringContaining('NAV2_ABORTED')});
 expect(result.assertions.find(a=>a.id==='FD01.served-after-handoff')).toMatchObject({result:'fail'});
});

test('a scenario the AMR-only backend set cannot run is refused before any effect',async()=>{
 const out=await mkdtemp(join(tmpdir(),'lab-v2-sil-run-'));dirs.push(out);
 await expect(runSilScenario({scenarioId:'BV01',scenarioRevision:1,seed:1,project:restaurant(),sourceCommit:'t',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:10,paceMs:0,
  backendFactory:async(world,runId)=>startGazeboBackend(world,runId,{port:new FakeWorkerPort({nativeResult:'completed'})})})).rejects.toThrow('BACKEND_MISSING:linuxcnc_sim,coffee_io_sim');
 await expect(runSilScenario({scenarioId:'NOPE',scenarioRevision:1,seed:1,project:restaurant(),sourceCommit:'t',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:10,paceMs:0,
  backendFactory:async(world,runId)=>startGazeboBackend(world,runId,{port:new FakeWorkerPort({nativeResult:'completed'})})})).rejects.toThrow('SCENARIO_UNSUPPORTED');
});
