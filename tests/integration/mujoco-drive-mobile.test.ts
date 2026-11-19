// V04, mobile: MJ-FD01 through the diff-drive controller and the virtual drive, on the real engine.
import {afterEach,expect,test} from 'vitest';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {createFixedStepScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {sealDriveDocument,type ControlProfileV1,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';

const root=resolve('robotics/simulation-mujoco'),dirs:string[]=[],runs:ScenarioRun[]=[];
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-drive-mobile-'));dirs.push(d);return d;};
afterEach(async()=>{for(const r of runs.splice(0))await r.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
interface Step {request:Record<string,unknown>;result:Record<string,unknown>|null}
/** One run of MJ-FD01 on a freshly compiled bundle; `driveExperimentId` and `compilerRoot` choose the drive, every step the worker answers is kept. */
async function setup(o:{driveExperimentId?:string;compilerRoot?:string}={}){
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1',...o.driveExperimentId?{driveExperimentId:o.driveExperimentId}:{}} as typeof f.project;
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:o.compilerRoot??root})}});
 const receipt=await service.compileEngineeringProject(f.project,'owner');expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
 const plant=mujocoMobilePlant(runtime),steps:Step[]=[],spawn=plant.spawn;
 plant.spawn=async s=>{const w=await spawn(s);return {...w,async request(req){const r=await w.request(req);if(req.op==='step')steps.push({request:structuredClone(req.payload) as never,result:r.ok?structuredClone(r.result) as never:null});return r;}};};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'drive-mobile-test',engineering:locked},
  {directory:await temp(),catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});runs.push(run);
 return {run,steps,service,receipt};
}
let ordinal=0;
async function act(run:ScenarioRun,kind:string,payload={}){const v=await run.snapshot();return run.action({actionId:`drive-${++ordinal}`,expectedRevision:v.run.runRevision,kind,payload});}
async function tick(run:ScenarioRun,n:number){let v=await run.snapshot();while(v.tick<n&&v.run.status==='running')v=await act(run,'step',{ticks:Math.min(20,n-v.tick)});return v;}
async function finish(run:ScenarioRun,limit=12000){let v=await run.snapshot();while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<limit){const before=v.tick;v=await act(run,'step',{ticks:250});if(v.tick===before&&v.run.status!=='running')break;}return v;}
const strip=(r:Record<string,unknown>|null)=>{if(!r)return r;const {drives:_d,runId:_r,bootId:_b,sceneDigest:_s,...rest}=r;void _d;void _r;void _b;void _s;return rest;};

test('a project without driveExperimentId compiles to the same bundle as before: no drive file, no ref, no manifest field',async()=>{
 const {service,receipt,run}=await setup();
 const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString());
 expect(scene.engine.driveModelRef).toBeUndefined();expect(scene.files.some((f:{path:string})=>/serve-(drive|control)/.test(f.path))).toBe(false);
 await run.start();await tick(run,5);
 expect((await run.report()).manifest.drive).toBeUndefined();
},60_000);

test('the first run on drive-nominal-v1 starts the drive, serves 1, and its manifest says controller_in_the_loop',async()=>{
 const {run,steps,service,receipt}=await setup({driveExperimentId:'drive-nominal-v1'});
 const scene=JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,'navigation-scene.json')).toString());
 expect(scene.engine.driveModelRef.path).toBe('serve-drive-nominal-v1.json');expect(scene.files.map((f:{path:string})=>f.path)).toContain('serve-control-v1.json');
 await run.start();const v=await finish(run);
 const report=await run.report();
 expect(report.outcome,JSON.stringify(v.attention)).toMatchObject({status:'completed',served:'1'});
 expect(report.manifest.drive).toMatchObject({testLevel:'controller_in_the_loop',experimentId:'drive-nominal-v1',controllers:[{id:'diff-drive-base-v1',revision:1}]});
 expect(report.manifest.drive!.driveModelDigest).toMatch(/^[0-9a-f]{64}$/);
 // the drive was not ready before its enable sequence ended: no wheel moved before both axes were enabled
 const drives=(s:Step)=>(s.result as {drives:{state:string;actualVelocityRadS:number}[]}).drives;
 const enabledAt=steps.findIndex(s=>drives(s).every(d=>d.state==='enabled')),movedAt=steps.findIndex(s=>drives(s).some(d=>Math.abs(d.actualVelocityRadS)>0.01));  // 0.5 mrad of settling is not motion
 expect(enabledAt).toBeGreaterThan(0);expect(movedAt).toBeGreaterThanOrEqual(enabledAt);
 // the wire carried drive commands and no velocities; no command asked for a faultReset
 expect(steps.every(s=>(s.request.velocities as unknown[]).length===0&&(s.request.driveCommands as {faultReset:boolean}[]).every(c=>!c.faultReset))).toBe(true);
},240_000);

test('an ideal drive reproduces the run without a drive: the physics of 300 ticks is bit-identical',async()=>{
 const plain=await setup();await plain.run.start();await tick(plain.run,300);await plain.run.close();   // one live MuJoCo worker at a time
 const ideal=await setup({driveExperimentId:'drive-ideal-v1'});await ideal.run.start();await tick(ideal.run,300);
 expect(plain.steps.length).toBe(300);expect(ideal.steps.length).toBe(300);
 for(const [i,s] of plain.steps.entries())expect(JSON.stringify(strip(ideal.steps[i]!.result)),`tick ${i+1}`).toBe(JSON.stringify(strip(s.result)));
 expect((ideal.steps[10]!.result as {drives:unknown[]}).drives).toHaveLength(2);
},240_000);

test('pausing a drive run for two wall seconds at 64x pacing raises no drive fault',async()=>{
 const {run,steps}=await setup({driveExperimentId:'drive-nominal-v1'});await run.start();
 let v=await act(run,'step',{ticks:40,pace:{factor:64}});
 v=await act(run,'pause');await new Promise(r=>setTimeout(r,2000));v=await act(run,'resume');
 v=await act(run,'step',{ticks:40,pace:{factor:64}});
 const last=steps.at(-1)!.result as {drives:{fault:string|null;state:string}[]};
 expect(v.attention).toEqual([]);expect(last.drives.map(d=>d.fault)).toEqual([null,null]);expect(steps.length).toBe(80);
},120_000);

/** A scratch worker root: the fixtures the compiler reads, with the nominal AMR drive replaced by `edit` of it (re-sealed, the profile re-declared). Nothing is registered. */
async function scratchRoot(edit:(m:DriveModelV1)=>void){
 const dir=await temp(),fx=join(dir,'fixtures');await mkdir(join(fx,'xarm6-g2-v1'),{recursive:true});
 await cp(join(root,'fixtures/serve-payload-v1'),join(fx,'serve-payload-v1'),{recursive:true});await cp(join(root,'fixtures/xarm6-g2-v1/cell-layout.json'),join(fx,'xarm6-g2-v1/cell-layout.json'));
 await cp(join(root,'fixtures/drive-v1'),join(fx,'drive-v1'),{recursive:true});
 const mp=join(fx,'drive-v1/serve-drive-nominal-v1.json'),cpth=join(fx,'drive-v1/serve-control-v1.json');
 const m=JSON.parse(await readFile(mp,'utf8')) as DriveModelV1;edit(m);const sealed=sealDriveDocument(m);
 const c=JSON.parse(await readFile(cpth,'utf8')) as ControlProfileV1;
 await writeFile(mp,JSON.stringify(sealed,null,2)+'\n');await writeFile(cpth,JSON.stringify(sealDriveDocument({...c,driveModelDigests:[sealed.digest]}),null,2)+'\n');
 return dir;
}

test('CIL05: a wheel drive rated below the cruise speed trips OVERSPEED mid-mission; the run needs attention, serves 0 and never asks for a faultReset',async()=>{
 const compilerRoot=await scratchRoot(m=>{for(const a of m.axes)a.velocityLimitRadS=2;});   // cruise is 0.5 m/s = 5.6 rad/s
 const {run,steps}=await setup({driveExperimentId:'drive-nominal-v1',compilerRoot});
 await run.start();const v=await finish(run,3000);
 const report=await run.report();
 expect(v.run.status).toBe('needs_attention');expect(v.attention.map(a=>a.reason)).toContain('DRIVE_FAULT');
 expect(report.outcome.served).toBe('0');
 const faultTick=steps.findIndex(s=>(s.result as {drives:{fault:string|null}[]}).drives.some(d=>d.fault==='OVERSPEED'));
 expect(faultTick).toBeGreaterThan(5);   // mid-mission: after the enable sequence and some motion
 const commands=steps.flatMap(s=>s.request.driveCommands as {faultReset:boolean;enable:boolean}[]);
 expect(commands.length).toBeGreaterThan(faultTick);expect(commands.every(c=>!c.faultReset)).toBe(true);
 const after=steps.slice(faultTick+1);   // the controller keeps holding: zero wheel targets while the drive stays faulted
 expect(after.length).toBeGreaterThan(0);expect(after.every(s=>(s.request.driveCommands as {target:number}[]).every(c=>c.target===0))).toBe(true);
},240_000);
