import {afterEach,expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import {readArmTrace,readArmProps} from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import {unavailableWorldSweep} from '../../packages/lab-runtime/src/v2/simulation3d/world-sweep';
import {join,resolve} from 'node:path';
import {createScenarioRun,type RunManifestInput} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {MockPlant} from '../../packages/lab-runtime/src/v2/backends/mock-amr';
import {createMockCoffeePorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import type {WorldPortsFactory,WorldFactoryInput} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {RobotAdapter} from '../../packages/robot-adapters/src/contract';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import * as durable from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {openWorldRecorder,prepareWorldAdmission,readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {tick as physicsTick} from '../support/physics';
import {act,cleanupRuns,runDirectory} from '../support/lab-v2';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,readFile:vi.fn(actual.readFile)};});
afterEach(async()=>{vi.restoreAllMocks();vi.mocked(fs.readFile).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).readFile);await cleanupRuns();});
const fx=resolve('robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1');
async function setup(failure?:'append'|'commit'|'source-write'|'direct-source-write'|'lost'|'coffee-commit'|'flush-chunk'|'flush-cleanup',reporting=false){
 const project=JSON.parse(await readFile(fx+'/project.json','utf8'));
 const manifest:RunManifestInput={project,scenarioId:'MJ-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'test-world',sourceCommit:'test'};
 const catalog:CapabilityCatalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b),sets:{...defaultCatalog.sets,'test-world':{...defaultCatalog.sets['engineering-mujoco-arm-v1']!,backends:['mujoco_3d','mujoco_arm','mock_coffee'],providers:{amr:'mujoco_3d',arm:'mujoco_arm',coffee:'mock_coffee'},execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1],composition:'single_world'}}}};
 const scene=JSON.parse(await readFile(fx+'/lab-world-scene.json','utf8'));
 const snap=(tick:number):Sim3DSnapshotV1=>({schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(tick+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'assigned',bootId:'engine-boot',seq:String(tick+1),tick,simTimeNs:String(tick*20_000_000),sceneDigest:scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[.35+tick*.001,.48591366218667575,Math.PI/2],bodyVelocity:[.05,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:scene.armCell.arm.homeRad,velocitiesRadS:[0,0,0,0,0,0],collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:[]});
 const fixture=await readWorldFixture(resolve('robotics/simulation-mujoco')),admission=prepareWorldAdmission(fixture.scene,fixture.files);
 const directory=await runDirectory(),evidenceDirectory=join(directory,'actual-world-evidence'),calls:string[]=[];let opens=0,committed=snap(0),ctx:WorldFactoryInput['context'];
 const factory:WorldPortsFactory=async input=>{opens++;ctx=input.context;committed={...snap(0),runId:input.runId};
  const adapter={observe:()=>()=>{},describe:async()=>({id:'amr-1'}),requestStop:async()=>({acknowledged:true,physicalStopConfirmed:false}),reconcile:async()=>({status:'unknown'})} as unknown as RobotAdapter;
  const rec=failure?.startsWith('flush-')?await openWorldRecorder({directory:evidenceDirectory,admission,runId:input.runId,bootId:'engine-boot',chunkTicks:2}):undefined;
  const coffee=createMockCoffeePorts(input.state,input.context,input.newBootId,reporting?{tracking:{reachTolRad:.01,settleTicks:1,followTolRad:1,followTicks:1}}:{}),advance=coffee.advance;
  if(reporting){const baseReport=coffee.report;coffee.report=()=>({...baseReport(),armPlant:{engine:'webots_3d',control:'position_servo',grip:'event',dynamics:'assumed',calibration:'not_calibrated',tracking:{samples:0,peakRad:Array(6).fill(0),rmsRad:Array(6).fill(0)}},armCell:{waypoints:{digest:'nonnative-report-fixture',table:[]},allowedContacts:[],releaseTimeoutTicks:25,notes:['Nonnative publication seam only']}});coffee.armReportState=async tick=>{const state=structuredClone(input.state.arm);state.tracking!.trace=Array.from({length:tick+1},(_,n)=>({tick:n,actualRad:[...state.q],commandedRad:[...state.q]}));state.tracking!.props=Array.from({length:tick+1},(_,n)=>({tick:n,props:[]}));return {async materialize(){return {state,worldTrace:{method:'world-committed-trace-v1',scope:'all_world_ticks',publicCommittedTick:tick,prefixCovered:true,streamFinalized:false,trackingStatisticsScope:'active_program_ticks',trackingSamples:0,firstTick:0,lastTick:tick,samples:tick+1,reasonCodes:[]},worldSweep:unavailableWorldSweep(tick,['NONNATIVE_PUBLICATION_FIXTURE'])};}};};}
  if(failure==='coffee-commit')coffee.advance=async()=>{await advance();throw Error('COFFEE_COMMIT_FAILED');};return {navigation:{mapId:'lab-world',mapRevision:String(project.world.revision),bindings:Object.fromEntries(project.world.points.map((p:{id:string;x:number;y:number})=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map',x:p.x,y:p.y,yaw:Math.PI/2}]))},robots:new Map([['amr-1',adapter]]),coffee,snapshot:()=>committed,
   evidence:rec?{async append(s){const p=physicsTick(s.tick);p.loads=[];p.contacts=[];for(const b of p.base)b.robotId='amr-1';for(const w of p.wheels)w.robotId='amr-1';for(const o of p.odometry)o.robotId='amr-1';await rec.append({...s,physics:p},s.tick?{targetTick:s.tick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]}:null);},fail:rec.fail,finish:rec.finish}:{async append(s){calls.push(`append:${s.tick}`);if(failure==='append'&&s.tick>0)throw Error('DISK_FAILED');},async fail(e){calls.push(`fail:${e.lastCommittedTick}:${e.targetTick}:${e.ackTick}`);},async finish(){calls.push('finish');}},
   world:{prepareTick(targetTick){calls.push(`prepare:${targetTick}`);return {targetTick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]};},async step(c){calls.push(`step:${c.targetTick}`);if(failure==='lost')throw Error('WORKER_LOST');return {...snap(c.targetTick),runId:input.runId};},async commit(s){calls.push(`commit:${s.tick}:${ctx.tick()}:${ctx.nowMs()}`);if(failure==='source-write')await ctx.must('Session.Open',{sessionId:'forbidden',tableId:'table-1'});if(failure==='direct-source-write')await ctx.source.submit('Session.Open',{sessionId:'forbidden',tableId:'table-1'},'forbidden');if(failure==='commit')throw Error('COMMIT_FAILED');committed=s;},async close(){calls.push('close');}}};};
 const scenario=structuredClone(scenarioRegistry.get('MJ-BV01')!);for(const o of scenario.coffee!.orders)o.atTick=[5000,5000];
 const providers={directory,catalog,enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],scenarios:new Map([[scenario.id,scenario]]),worldPorts:factory};
 const open=()=>createScenarioRun(manifest,providers);return {open,calls,directory,evidenceDirectory,admission,opens:()=>opens,source:()=>ctx.source};
}
test('world path never constructs/advances mock AMR and commits actual pose with target observation time',async()=>{
 const h=await setup();vi.spyOn(MockPlant.prototype,'advance').mockImplementation(()=>{throw Error('MOCK_ADVANCE_FORBIDDEN');});
 const run=await h.open();try{await run.start();const v=await act(run,'step',{ticks:1});expect(((await h.source().read('robot','amr-1')).state.bindings as Record<string,{yaw:number}>)['coffee-pickup']!.yaw).toBe(Math.PI/2);expect(v.tick).toBe(1);expect(v.entities[0]!.pose.x).toBe(.351);expect(h.calls).toContain(`commit:1:1:${Date.parse('2026-11-01T00:00:00Z')+20}`);expect(h.calls.slice(0,4)).toEqual(['append:0','prepare:1','step:1','append:1']);}finally{await run.close();}
});
for(const failure of ['append','commit','source-write','direct-source-write','lost','coffee-commit'] as const)test(`world ${failure} failure keeps old public clock, latches and never retries or respawns`,async()=>{
 const h=await setup(failure),run=await h.open();await run.start();const watermark=(await run.journal()).at(-1)?.sequence??'0';
 await expect(act(run,'step',{ticks:1})).rejects.toThrow();const v=await run.snapshot();expect(v.tick).toBe(0);expect(v.entities[0]!.pose.x).toBe(.35);expect(v.entities[0]!.quality).toBe('stale');
 if(failure==='source-write'||failure==='direct-source-write'){const added=(await run.journal()).filter(e=>BigInt(e.sequence)>BigInt(watermark));expect(JSON.stringify(added)).not.toContain('forbidden');expect(JSON.stringify(added)).not.toContain('CupTransferred');}
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');expect(h.calls.filter(c=>c.startsWith('step:'))).toHaveLength(1);expect(h.calls).toContain(`fail:0:1:${failure==='lost'?'null':'1'}`);await run.close();
 const reopened=await h.open();try{expect(h.opens()).toBe(1);expect((await reopened.snapshot()).entities[0]!.pose.x).toBe(.35);await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');}finally{await reopened.close();}
});

for(const failure of ['flush-chunk','flush-cleanup'] as const)test(`actual recorder ${failure} failure preserves Source horizon and close prefix`,async()=>{
 const h=await setup(failure),run=await h.open();await run.start();const write=durable.writeDurable;let injected=false;
 vi.spyOn(durable,'writeDurable').mockImplementation(async(dir,name,bytes)=>{if(dir===h.evidenceDirectory&&!injected&&(failure==='flush-chunk'?name.endsWith('.ndjson.gz'):name==='pending.ndjson'&&bytes==='')){injected=true;throw Error('ACTUAL_RECORDER_FAILED');}return write(dir,name,bytes);});
 try{await expect(act(run,'step',{ticks:1})).rejects.toThrow('ACTUAL_RECORDER_FAILED');const v=await run.snapshot();expect(v.tick).toBe(0);expect(v.entities[0]!.pose.x).toBe(.35);expect(v.entities[0]!.quality).toBe('stale');
  const cp=JSON.parse(await readFile(join(h.directory,'run.json'),'utf8'));expect(cp.tick).toBe(0);expect(cp.world.pending).toMatchObject({targetTick:1,stage:'acked',ackTick:1,command:{targetTick:1}});expect(cp.world.snapshot.tick).toBe(0);
  const manifest=JSON.parse(await readFile(join(h.evidenceDirectory,'manifest.json'),'utf8'));expect(manifest.gaps).toEqual([{targetTick:1,lastCommittedTick:0,ackTick:1,reason:'ACTUAL_RECORDER_FAILED'}]);
  await expect(act(run,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');expect(h.calls.filter(c=>c.startsWith('step:'))).toHaveLength(1);expect(h.calls.some(c=>c.startsWith('commit:'))).toBe(false);
 }finally{await run.close();}
 const read=await readWorldEvidence(h.evidenceDirectory,h.admission);expect(read.records.map(r=>r.snapshot.tick)).toEqual([0,1]);expect(read.issues).not.toContain('WORLD_EVIDENCE_ORDER');expect(read.complete).toBe(false);
 const reopened=await h.open();try{expect(h.opens()).toBe(1);expect((await reopened.snapshot()).tick).toBe(0);await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');}finally{await reopened.close();}
});

function publicationGate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
test('two same-H report materializations coalesce trace and props publication while Source actions progress',async()=>{
 const h=await setup(undefined,true),run=await h.open(),traceBlocked=publicationGate(),propsBlocked=publicationGate(),traceReads=publicationGate(),propsReads=publicationGate(),actualRead=(await vi.importActual<typeof fs>('node:fs/promises')).readFile,actualWrite=durable.writeDurable;const reads={trace:0,props:0},writes={trace:0,props:0};let reports:ReturnType<typeof run.report>[]=[];
 vi.mocked(fs.readFile).mockImplementation(async(...args)=>{try{return await actualRead(...args);}catch(e){const file=String(args[0]),kind=/arm-props-trace-[a-f0-9]{64}\.json$/.test(file)?'props':/arm-trace-[a-f0-9]{64}\.json$/.test(file)?'trace':null;if(kind&&(e as NodeJS.ErrnoException).code==='ENOENT'&&file.startsWith(h.directory)){if(++reads[kind]===2)(kind==='trace'?traceReads:propsReads).release();}throw e;}});
 vi.spyOn(durable,'writeDurable').mockImplementation(async(dir,name,bytes)=>{if(dir===h.directory&&/^arm-(?:props-)?trace-/.test(name)){const kind=name.startsWith('arm-props-')?'props':'trace';writes[kind]++;await (kind==='trace'?traceBlocked:propsBlocked).promise;}await actualWrite(dir,name,bytes);});
 try{await run.start();await act(run,'step',{ticks:2});reports=[run.report(),run.report()];await traceReads.promise;await new Promise<void>(r=>setImmediate(r));expect(writes.trace).toBe(1);
  const action=act(run,'step',{ticks:1});expect(await Promise.race([action.then(v=>v.tick),new Promise(r=>setTimeout(()=>r('ACTION_BLOCKED_BY_REPORT'),2000))])).toBe(3);
  traceBlocked.release();await propsReads.promise;await new Promise<void>(r=>setImmediate(r));expect(writes.props).toBe(1);propsBlocked.release();const [a,b]=await Promise.all(reports);expect(a.outcome.tick).toBe(2);expect(b.outcome.tick).toBe(2);expect(a.arm!.trace).toEqual(b.arm!.trace);expect(a.arm!.props).toEqual(b.arm!.props);for(const report of [a,b]){expect((await readArmTrace(h.directory,report.arm!)).samples.map(s=>s.tick)).toEqual([0,1,2]);expect((await readArmProps(h.directory,report.arm!)).samples.map(s=>s.tick)).toEqual([0,1,2]);}
 }finally{traceBlocked.release();propsBlocked.release();await Promise.allSettled(reports);await run.close();}
});
