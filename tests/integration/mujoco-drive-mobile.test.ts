// V04, mobile: MJ-FD01 through the diff-drive controller and the virtual drive, on the real engine.
import {expect,test} from 'vitest';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sealDriveDocument,type ControlProfileV1,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {act,finish,root,setup,temp,tick,type Step} from '../support/mujoco-drive';

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
