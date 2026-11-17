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
import {SourceSession} from '../../packages/lab-runtime/src/v2/session';
import {createMockCoffeePorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import type {WorldPortsFactory,WorldFactoryInput} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {RobotAdapter} from '../../packages/robot-adapters/src/contract';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import * as durable from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {openWorldRecorder,prepareWorldAdmission,readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {tick as physicsTick} from '../support/physics';
import {act,cleanupRuns,runDirectory} from '../support/lab-v2';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,readFile:vi.fn(actual.readFile),open:vi.fn(actual.open),rename:vi.fn(actual.rename)};});
const recorders:{finish():Promise<void>}[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(recorders.splice(0).map(r=>r.finish().catch(()=>{})));const actual=await vi.importActual<typeof fs>('node:fs/promises');vi.mocked(fs.readFile).mockImplementation(actual.readFile);vi.mocked(fs.open).mockImplementation(actual.open);vi.mocked(fs.rename).mockImplementation(actual.rename);await cleanupRuns();});
const fx=resolve('robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1');
async function setup(failure?:'append'|'commit'|'source-write'|'direct-source-write'|'lost'|'coffee-commit'|'flush-chunk'|'flush-cleanup'|'actual',reporting=false){
 const project=JSON.parse(await readFile(fx+'/project.json','utf8'));
 const manifest:RunManifestInput={project,scenarioId:'MJ-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'test-world',sourceCommit:'test'};
 const catalog:CapabilityCatalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b),sets:{...defaultCatalog.sets,'test-world':{...defaultCatalog.sets['engineering-mujoco-arm-v1']!,backends:['mujoco_3d','mujoco_arm','mock_coffee'],providers:{amr:'mujoco_3d',arm:'mujoco_arm',coffee:'mock_coffee'},execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1],composition:'single_world'}}}};
 const scene=JSON.parse(await readFile(fx+'/lab-world-scene.json','utf8'));
 const snap=(tick:number):Sim3DSnapshotV1=>({schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(tick+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'assigned',bootId:'engine-boot',seq:String(tick+1),tick,simTimeNs:String(tick*20_000_000),sceneDigest:scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[.35+tick*.001,.48591366218667575,Math.PI/2],bodyVelocity:[.05,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:scene.armCell.arm.homeRad,velocitiesRadS:[0,0,0,0,0,0],collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:[]});
 const fixture=await readWorldFixture(resolve('robotics/simulation-mujoco')),admission=prepareWorldAdmission(fixture.scene,fixture.files);
 const directory=await runDirectory(),evidenceDirectory=join(directory,'actual-world-evidence'),calls:string[]=[],hooks:{afterAppend?:(tick:number)=>Promise<void>}={};let opens=0,committed=snap(0),ctx:WorldFactoryInput['context'];
 const factory:WorldPortsFactory=async input=>{opens++;ctx=input.context;committed={...snap(0),runId:input.runId};
  const adapter={observe:()=>()=>{},describe:async()=>({id:'amr-1'}),requestStop:async()=>({acknowledged:true,physicalStopConfirmed:false}),reconcile:async()=>({status:'unknown'})} as unknown as RobotAdapter;
  const rec=failure==='actual'||failure?.startsWith('flush-')?await openWorldRecorder({directory:evidenceDirectory,admission,runId:input.runId,bootId:'engine-boot',chunkTicks:failure==='actual'?250:2}):undefined;if(rec)recorders.push(rec);
  const coffee=createMockCoffeePorts(input.state,input.context,input.newBootId,reporting?{tracking:{reachTolRad:.01,settleTicks:1,followTolRad:1,followTicks:1}}:{}),advance=coffee.advance;
  if(reporting){const baseReport=coffee.report;coffee.report=()=>({...baseReport(),armPlant:{engine:'webots_3d',control:'position_servo',grip:'event',dynamics:'assumed',calibration:'not_calibrated',tracking:{samples:0,peakRad:Array(6).fill(0),rmsRad:Array(6).fill(0)}},armCell:{waypoints:{digest:'nonnative-report-fixture',table:[]},allowedContacts:[],releaseTimeoutTicks:25,notes:['Nonnative publication seam only']}});coffee.armReportState=async tick=>{const state=structuredClone(input.state.arm);state.tracking!.trace=Array.from({length:tick+1},(_,n)=>({tick:n,actualRad:[...state.q],commandedRad:[...state.q]}));state.tracking!.props=Array.from({length:tick+1},(_,n)=>({tick:n,props:[]}));return {async materialize(){return {state,worldTrace:{method:'world-committed-trace-v1',scope:'all_world_ticks',publicCommittedTick:tick,prefixCovered:true,streamFinalized:false,trackingStatisticsScope:'active_program_ticks',trackingSamples:0,firstTick:0,lastTick:tick,samples:tick+1,reasonCodes:[]},worldSweep:unavailableWorldSweep(tick,['NONNATIVE_PUBLICATION_FIXTURE'])};}};};}
  if(failure==='coffee-commit')coffee.advance=async()=>{await advance();throw Error('COFFEE_COMMIT_FAILED');};return {navigation:{mapId:'lab-world',mapRevision:String(project.world.revision),bindings:Object.fromEntries(project.world.points.map((p:{id:string;x:number;y:number})=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map',x:p.x,y:p.y,yaw:Math.PI/2}]))},robots:new Map([['amr-1',adapter]]),coffee,displayScene:()=>structuredClone(scene),snapshot:()=>committed,
   evidence:rec?{async append(s){const p=physicsTick(s.tick);p.loads=[];p.contacts=[];for(const b of p.base)b.robotId='amr-1';for(const w of p.wheels)w.robotId='amr-1';for(const o of p.odometry)o.robotId='amr-1';await rec.append({...s,physics:p},s.tick?{targetTick:s.tick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]}:null);await hooks.afterAppend?.(s.tick);},fail:rec.fail,finish:rec.finish}:{async append(s){calls.push(`append:${s.tick}`);if(failure==='append'&&s.tick>0)throw Error('DISK_FAILED');},async fail(e){calls.push(`fail:${e.lastCommittedTick}:${e.targetTick}:${e.ackTick}`);},async finish(){calls.push('finish');}},
   world:{prepareTick(targetTick){calls.push(`prepare:${targetTick}`);return {targetTick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]};},async step(c){calls.push(`step:${c.targetTick}`);if(failure==='lost')throw Error('WORKER_LOST');return {...snap(c.targetTick),runId:input.runId};},async commit(s){calls.push(`commit:${s.tick}:${ctx.tick()}:${ctx.nowMs()}`);if(failure==='source-write')await ctx.must('Session.Open',{sessionId:'forbidden',tableId:'table-1'});if(failure==='direct-source-write')await ctx.source.submit('Session.Open',{sessionId:'forbidden',tableId:'table-1'},'forbidden');if(failure==='commit')throw Error('COMMIT_FAILED');committed=s;},async close(){calls.push('close');}}};};
 const scenario=structuredClone(scenarioRegistry.get('MJ-BV01')!);for(const o of scenario.coffee!.orders)o.atTick=[5000,5000];
 const providers={directory,catalog,enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],scenarios:new Map([[scenario.id,scenario]]),worldPorts:factory};
 const open=(reclaimOnly=false,wall?:import('../../packages/lab-runtime/src/v2/pace').WallClock,dir=directory)=>createScenarioRun(manifest,{...providers,directory:dir,reclaimOnly,...wall?{wall}:{}});return {open,calls,hooks,directory,evidenceDirectory,admission,opens:()=>opens,source:()=>ctx.source};
}
/** Names every FileHandle.sync by the path its handle was opened with; `steps` is the world step in flight when it ran. */
async function traceSyncs(h:{calls:string[]},onSync=async(_file:string)=>{}){
 const actual=await vi.importActual<typeof fs>('node:fs/promises'),paths=new WeakMap<object,string>(),syncs:{file:string;steps:number}[]=[];
 vi.mocked(fs.open).mockImplementation(async(...a:Parameters<typeof fs.open>)=>{const f=await actual.open(...a);paths.set(f,String(a[0]));return f;});
 const probe=await actual.open(fx+'/project.json','r'),proto=Object.getPrototypeOf(probe) as {sync():Promise<void>},sync=proto.sync;await probe.close();
 vi.spyOn(proto,'sync').mockImplementation(async function(this:object){await sync.call(this);const file=paths.get(this)??'?';syncs.push({file,steps:h.calls.filter(c=>c.startsWith('step:')).length});await onSync(file);});
 return syncs;
}
const lastWalTick=(text:string)=>text.trim()?(JSON.parse(text.trim().split('\n').at(-1)!) as {snapshot:{tick:number}}).snapshot.tick:-1;
test('a world tick fsyncs at most twice and run.json never carries a tick before its WAL record is synced',async()=>{
 const h=await setup('actual'),actual=await vi.importActual<typeof fs>('node:fs/promises'),wal=join(h.evidenceDirectory,'pending.ndjson'),late:string[]=[];let synced=-1;
 const all=await traceSyncs(h,async file=>{if(file===wal)synced=lastWalTick(await actual.readFile(wal,'utf8'));}),run=await h.open(); // the WAL fd lives across ticks: trace from its open
 try{await run.start();all.length=0;const syncs=all;
  vi.mocked(fs.rename).mockImplementation(async(from,to)=>{if(String(to)===join(h.directory,'run.json')){const cp=JSON.parse(await actual.readFile(from,'utf8'));if(cp.tick>synced||cp.world.snapshot.tick>synced)late.push(`run.json tick ${cp.tick} before synced WAL tick ${synced}`);}return actual.rename(from,to);});
  expect((await act(run,'step',{ticks:10})).tick).toBe(10);
  expect(syncs.filter(s=>s.file===wal).map(s=>s.steps)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  // between two world steps (one full tick period) at most two fsyncs; the action's own run.json commit is amortized over its ticks
  for(let k=1;k<10;k++)expect(syncs.filter(s=>s.steps===k).length,`tick ${k}`).toBeLessThanOrEqual(2);
  expect(syncs.length).toBeLessThanOrEqual(2*10);expect(late).toEqual([]);expect(synced).toBe(10);
 }finally{await run.close();}
});
test('a kill after a tick WAL append, before run.json commits it, reopens as WORLD_RESTART_UNKNOWN at the committed tick',async()=>{
 const h=await setup('actual'),run=await h.open(),killed=await runDirectory();
 h.hooks.afterAppend=async tick=>{if(tick===3)await fs.cp(h.directory,killed,{recursive:true});};
 try{await run.start();await act(run,'step',{ticks:5});}finally{await run.close();}
 expect(lastWalTick(await readFile(join(killed,'actual-world-evidence','pending.ndjson'),'utf8'))).toBe(3);
 const reopened=await h.open(false,undefined,killed);try{const v=await reopened.snapshot();expect(v.tick).toBe(2);expect(v.attention).toContainEqual({reason:'WORLD_RESTART_UNKNOWN',tick:2});expect(await reopened.worldDisplay!()).toMatchObject({tick:2,availability:'stale',reason:'WORLD_RESTART_UNKNOWN'});await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');}finally{await reopened.close();}
});
test('a torn or empty run.json fails closed as RECOVERY_CHECKPOINT_CORRUPT without opening the world',async()=>{
 const h=await setup('actual'),run=await h.open();await run.start();await act(run,'step',{ticks:1});await run.close();
 for(const bytes of ['','{"schemaVersion":2,"runId":']){await fs.writeFile(join(h.directory,'run.json'),bytes);await expect(h.open()).rejects.toThrow('RECOVERY_CHECKPOINT_CORRUPT');await expect(h.open(true)).rejects.toThrow('RECOVERY_CHECKPOINT_CORRUPT');}expect(h.opens()).toBe(1);
});
test('persist() fsyncs run.json before it returns; a kill right after reopens a readable committed checkpoint',async()=>{
 const h=await setup('actual'),run=await h.open(),killed=await runDirectory(),state=run as unknown as {persist():Promise<void>},persist=state.persist.bind(state);let committed:string[]|undefined;
 try{await run.start();const syncs=await traceSyncs(h);
  vi.spyOn(state,'persist').mockImplementation(async()=>{const from=syncs.length;await persist();committed=syncs.slice(from).map(s=>s.file);await fs.cp(h.directory,killed,{recursive:true});});
  await act(run,'step',{ticks:4});
 }finally{await run.close();}
 expect(committed).toContain(join(h.directory,'run.json.tmp'));
 const bytes=await readFile(join(killed,'run.json'),'utf8');expect(bytes.length).toBeGreaterThan(0);expect(JSON.parse(bytes)).toMatchObject({tick:4,world:{snapshot:{tick:4}}});
 const reopened=await h.open(false,undefined,killed);try{expect(await reopened.snapshot()).toMatchObject({tick:4,attention:[{reason:'WORLD_RESTART_UNKNOWN',tick:4}]});}finally{await reopened.close();}
});
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

test('terminal world replays a stored receipt but refuses a new action as WORLD_TERMINAL',async()=>{
 const h=await setup('commit'),run=await h.open();try{const revision=(await run.snapshot()).run.runRevision,started=await run.start();await expect(act(run,'step',{ticks:1})).rejects.toThrow('COMMIT_FAILED');
  expect(await run.action({actionId:'start',expectedRevision:revision,kind:'start',payload:{}})).toEqual(started);
  await expect(act(run,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');}finally{await run.close();}
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

test('Source replay capture uses the same nonmultiple-of-five horizon while a later action proceeds',async()=>{
 const h=await setup(undefined,true),run=await h.open();try{await run.start();await act(run,'step',{ticks:7});expect(typeof run.captureReplay).toBe('function');const p=run.captureReplay!();await act(run,'step',{ticks:1});const c=await p;expect(c.report.outcome.tick).toBe(7);expect((await run.snapshot()).tick).toBe(8);expect(c.report.arm!.worldTrace!.publicCommittedTick).toBe(7);expect(c.world).toBeUndefined();}finally{await run.close();}
});
test('replay capture materialization never holds Source actions while immutable trace publication is blocked',async()=>{
 const h=await setup(undefined,true),run=await h.open(),blocked=publicationGate(),entered=publicationGate(),write=durable.writeDurable;let capture:ReturnType<NonNullable<typeof run.captureReplay>>|undefined;
 vi.spyOn(durable,'writeDurable').mockImplementation(async(dir,name,bytes)=>{if(dir===h.directory&&/^arm-trace-/.test(name)){entered.release();await blocked.promise;}await write(dir,name,bytes);});
 try{await run.start();await act(run,'step',{ticks:7});capture=run.captureReplay!();await entered.promise;const next=act(run,'step',{ticks:1});expect(await Promise.race([next.then(v=>v.tick),new Promise(r=>setTimeout(()=>r('ACTION_BLOCKED_BY_EXPORT'),2000))])).toBe(8);blocked.release();const c=await capture;expect(c.report.outcome.tick).toBe(7);expect((await readArmTrace(h.directory,c.report.arm!)).samples.at(-1)!.tick).toBe(7);}finally{blocked.release();await capture?.catch(()=>{});await run.close();}
});

test('read-only world display clones one committed H/control and keeps action receipts bounded',async()=>{
 const h=await setup(),run=await h.open();try{
  expect(typeof run.worldDisplay).toBe('function');const scene=await run.worldDisplayScene!();expect(scene).toMatchObject({availability:'available',scene:{sceneDigest:expect.any(String)}});scene.scene!.sceneDigest='mutated';expect((await run.worldDisplayScene!()).scene!.sceneDigest).not.toBe('mutated');const zero=await run.worldDisplay!();expect(zero).toMatchObject({tick:0,availability:'valid',control:null,controlReason:'NOT_RECORDED_AT_TICK'});
  await run.start();await act(run,'step',{ticks:7});const a=await run.worldDisplay!();expect(a.tick).toBe(7);expect(a.snapshot!.tick).toBe(7);a.snapshot!.robots[0]!.poseDriveMap[0]=999;expect((await run.worldDisplay!()).snapshot!.robots[0]!.poseDriveMap[0]).not.toBe(999);
  const cp=JSON.parse(await readFile(join(h.directory,'run.json'),'utf8'));expect(Object.values(cp.receipts).every((r:unknown)=>!JSON.stringify(r).includes('worldStep'))).toBe(true);expect(cp.world.committedDisplay.command.targetTick).toBe(7);expect(JSON.stringify(cp.world.committedDisplay).length).toBeLessThan(2048);
 }finally{await run.close();}
 const reopened=await h.open();try{expect(await reopened.worldDisplay!()).toMatchObject({tick:7,availability:'stale',reason:'WORLD_RESTART_UNKNOWN'});}finally{await reopened.close();}
});
test('failed H+1 ACK never becomes a public world display observation or control',async()=>{
 const h=await setup('commit'),run=await h.open();try{await run.start();await expect(act(run,'step',{ticks:1})).rejects.toThrow();expect(await run.worldDisplay!()).toMatchObject({tick:0,availability:'stale',reason:'WORLD_UNKNOWN',snapshot:{tick:0},control:null});}finally{await run.close();}
});

test('display read during action admission retains the previous coherent committed pair',async()=>{const h=await setup(),run=await h.open();const gate=publicationGate(),entered=publicationGate();try{await run.start();const v=await run.snapshot(),action=run.action({actionId:'held-display-step',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:7}},async()=>{entered.release();await gate.promise;});await entered.promise;let read=false;const display=run.worldDisplay!().then(d=>{read=true;return d;});await new Promise<void>(r=>setImmediate(r));expect(read).toBe(true);const d=await display;expect(d).toMatchObject({tick:0,revision:v.run.runRevision,snapshot:{tick:0},view:{tick:0}});gate.release();const after=await action;expect(await run.worldDisplay!()).toMatchObject({tick:7,revision:after.run.runRevision,snapshot:{tick:7},control:{targetTick:7},view:{tick:7}});}finally{gate.release();await run.close();}});

test('explicit world reclaim never respawns and refuses a missing committed world checkpoint',async()=>{
 const h=await setup(),run=await h.open();await run.start();await act(run,'step',{ticks:1});await run.close();
 const reopened=await h.open(true);expect(h.opens()).toBe(1);expect((await reopened.snapshot()).tick).toBe(1);await reopened.close();
 const path=join(h.directory,'run.json'),cp=JSON.parse(await fs.readFile(path,'utf8'));delete cp.world;await fs.writeFile(path,JSON.stringify(cp));
 await expect(h.open(true)).rejects.toThrow('RECOVERY_CHECKPOINT_MISSING');expect(h.opens()).toBe(1);
});
for(const missing of ['snapshot','bootId','sceneDigest','runId','tick','coffee','arm'] as const)test(`explicit world reclaim refuses missing or mismatched ${missing} before resources and persistence`,async()=>{
 const h=await setup(),run=await h.open();await run.start();await act(run,'step',{ticks:1});await run.close();
 const path=join(h.directory,'run.json'),cp=JSON.parse(await fs.readFile(path,'utf8'));
 if(missing==='snapshot')cp.world={};else if(missing==='coffee')delete cp.coffee;else if(missing==='arm')delete cp.coffee.arm;else if(missing==='tick')cp.world.snapshot.tick=0;else delete cp.world.snapshot[missing];
 const bytes=JSON.stringify(cp);await fs.writeFile(path,bytes);const journal=await fs.readFile(join(h.directory,'journal.db')),files=await fs.readdir(h.directory),opening=vi.spyOn(SourceSession,'open');let unexpected:Awaited<ReturnType<typeof h.open>>|undefined;
 try{await expect(h.open(true).then(value=>{unexpected=value;return 'RECOVERY_ACCEPTED';})).rejects.toThrow('RECOVERY_STATE_INVALID');expect(opening).not.toHaveBeenCalled();expect(h.opens()).toBe(1);expect(await fs.readFile(path,'utf8')).toBe(bytes);expect((await fs.readFile(join(h.directory,'journal.db'))).equals(journal)).toBe(true);expect(await fs.readdir(h.directory)).toEqual(files);}finally{opening.mockRestore();await unexpected?.close();}
});

for(const kind of ['pause','cancel'] as const)test(`shared world priority ${kind} stops at held paced boundary, with exact action replay`,async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}});let batch:Promise<unknown>|undefined;
 try{const started=await run.start(),revision=started.run.runRevision;batch=run.action({actionId:'batch',expectedRevision:revision,kind:'step',payload:{ticks:50,pace:{factor:1}}});await entered.promise;
  const raw={actionId:'priority',expectedRevision:revision,kind,payload:{}};const control=run.controlDuringStep?.(raw);expect(control).toBeDefined();release.release();const result=await control!;
  expect(result.tick).toBe(1);expect((await batch as {tick:number}).tick).toBe(1);expect(h.calls.filter(x=>x.startsWith('step:'))).toHaveLength(1);expect(await run.action(raw)).toEqual(result);
 }finally{release.release();await batch;await run.close();}
});
test('paired display publishes only committed tick during a held batch without awaiting its remaining ticks',async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}});let batch:Promise<unknown>|undefined;
 try{const started=await run.start();batch=run.action({actionId:'display-batch',expectedRevision:started.run.runRevision,kind:'step',payload:{ticks:2,pace:{factor:1}}});await entered.promise;
  let published:unknown;const read=run.worldDisplay!().then(x=>{published=x;});await new Promise<void>(r=>setImmediate(r));expect(published).toMatchObject({tick:1,snapshot:{tick:1},view:{tick:1,run:{runRevision:started.run.runRevision}}});release.release();await Promise.all([batch,read]);
 }finally{release.release();await batch;await run.close();}
});

for(const reason of ['SESSION_REQUIRED','RUN_WRITER_CONFLICT'])test(`shared world control revalidates ${reason} and never truncates the batch on refusal`,async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}});let batch:Promise<unknown>|undefined;
 try{const v=await run.start();batch=run.action({actionId:'guard-batch',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:2,pace:{factor:1}}});await entered.promise;
  const control=run.controlDuringStep!({actionId:'guard-pause',expectedRevision:v.run.runRevision,kind:'pause',payload:{}},async()=>{throw Error(reason);})!.catch(e=>(e as Error).message);release.release();expect(await control).toBe(reason);expect((await batch as {tick:number}).tick).toBe(2);expect((await run.worldDisplay!()).view!.run.status).toBe('running');expect(run.controlDuringStep!({kind:'pause'})).toBeUndefined();
 }finally{release.release();await batch;await run.close();}
});
for(const lifecycle of ['close','reclaim'])test(`shared world ${lifecycle} waits for attached control and batch completion`,async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}});let batch:Promise<unknown>|undefined;
 try{const v=await run.start();batch=run.action({actionId:'lifecycle-batch',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:2,pace:{factor:1}}});await entered.promise;
  const pause=run.controlDuringStep!({actionId:'lifecycle-pause',expectedRevision:v.run.runRevision,kind:'pause',payload:{}})!;let settled=false;const end=(lifecycle==='close'?run.close():run.holdForReclaim()).then(()=>{settled=true;});await new Promise<void>(r=>setImmediate(r));expect(settled).toBe(false);expect(h.calls).not.toContain('close');release.release();expect((await pause).tick).toBe(1);expect((await batch as {tick:number}).tick).toBe(1);await end;
  if(lifecycle==='close')await expect(run.worldDisplay!()).rejects.toThrow('RUN_CLOSED');else expect((await run.worldDisplay!()).view!.controlAccess).toBe('view_reconcile');
 }finally{release.release();await batch;await run.close();}
});

for(const outcome of ['allow','SESSION_REQUIRED','RUN_WRITER_CONFLICT','ACTION_CONFLICT'] as const)test(`stored Pause replay after Resume leaves a different 50-tick batch intact: ${outcome}`,async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}});let batch:Promise<import('../../packages/lab-runtime/src/v2/scenario-runner').RunView>|undefined;
 try{
  const started=await run.start(),pause={actionId:'stored-pause',expectedRevision:started.run.runRevision,kind:'pause',payload:{}},stored=await run.action(pause),storedBytes=JSON.stringify(stored),resumed=await act(run,'resume');
  const next={actionId:'different-batch',expectedRevision:resumed.run.runRevision,kind:'step',payload:{ticks:50,pace:{factor:1}}};batch=run.action(next);await entered.promise;
  const authorize=vi.fn(async()=>{if(outcome==='SESSION_REQUIRED'||outcome==='RUN_WRITER_CONFLICT')throw Error(outcome);});
  const replay=run.controlDuringStep!(outcome==='ACTION_CONFLICT'?{...pause,expectedRevision:resumed.run.runRevision}:pause,authorize)!;
  const observed=replay.then(value=>({value,error:null}),error=>({value:null,error:(error as Error).message}));release.release();const result=await observed;
  expect(authorize).toHaveBeenCalledTimes(outcome==='ACTION_CONFLICT'?0:1);if(outcome==='allow')expect(JSON.stringify(result.value)).toBe(storedBytes);else expect(result.error).toBe(outcome);
  const completed=await batch;expect(completed).toMatchObject({tick:50,run:{runRevision:resumed.run.runRevision+1,status:'running'}});expect(h.calls.filter(x=>x.startsWith('step:'))).toHaveLength(50);
  expect(await run.snapshot()).toEqual(completed);expect(await run.action(next)).toEqual(completed);expect(JSON.stringify(await run.action(pause))).toBe(storedBytes);expect(h.calls.filter(x=>x.startsWith('step:'))).toHaveLength(50);
 }finally{release.release();await batch;await run.close();}
});
for(const checkpoint of [1,2])test(`a newly begun priority Pause with uncertain checkpoint ${checkpoint} still ends the batch conservatively`,async()=>{
 const h=await setup(),entered=publicationGate(),release=publicationGate();let now=0,armed=false,writes=0;
 const run=await h.open(false,{now:()=>now,sleep:async ms=>{entered.release();await release.promise;now+=ms;}}),state=run as unknown as {persist():Promise<void>},persist=state.persist.bind(state);let batch:Promise<import('../../packages/lab-runtime/src/v2/scenario-runner').RunView>|undefined;
 vi.spyOn(state,'persist').mockImplementation(async()=>{await persist();if(armed&&++writes===checkpoint)throw Error('PERSIST_ACK_UNKNOWN');});
 try{const started=await run.start();batch=run.action({actionId:'uncertain-batch',expectedRevision:started.run.runRevision,kind:'step',payload:{ticks:50,pace:{factor:1}}});await entered.promise;
  const control=run.controlDuringStep!({actionId:'uncertain-pause',expectedRevision:started.run.runRevision,kind:'pause',payload:{}},async()=>{armed=true;})!.catch(e=>(e as Error).message);release.release();expect(await control).toBe('PERSIST_ACK_UNKNOWN');const completed=await batch;
  expect(completed).toMatchObject({tick:1,run:{status:checkpoint===1?'running':'needs_attention'}});expect(h.calls.filter(x=>x.startsWith('step:'))).toHaveLength(1);expect((await run.snapshot()).tick).toBe(1);if(checkpoint===2)expect(completed.attention).toContainEqual({reason:'ACTION_INTERRUPTED',tick:1});
 }finally{release.release();await batch;await run.close();}
});
