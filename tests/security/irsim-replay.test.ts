// EVI03 replay is read-only: an exported IR-FD01 evidence set is imported elsewhere and replayed at every cursor without a worker, a source session or a domain command;
// the reader only opens recorder chunk names inside the recording root.
import {afterAll,afterEach,beforeAll,expect,test,vi} from 'vitest';
import {cp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const spawned=vi.hoisted(()=>({deny:false,attempts:[] as string[]}));
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 const {promisify}=await import('node:util');
 const guard=<F extends (...a:never[])=>unknown>(name:string,f:F):F=>{
  const g=((...a:Parameters<F>)=>{if(spawned.deny){spawned.attempts.push(name);throw new Error(`REPLAY_SPAWN_DENIED:${name}`);}return f(...a);}) as unknown as F;
  const custom=(f as unknown as Record<symbol,F|undefined>)[promisify.custom];
  if(custom)Object.defineProperty(g,promisify.custom,{value:guard(name,custom)}); // keep promisify(execFile) -> {stdout, stderr}
  return g;
 };
 return {...real,spawn:guard('spawn',real.spawn),execFile:guard('execFile',real.execFile),exec:guard('exec',real.exec),fork:guard('fork',real.fork),execFileSync:guard('execFileSync',real.execFileSync),spawnSync:guard('spawnSync',real.spawnSync)};
});
const {navigationMetrics,readNavigationEvidence,replayAt}=await import('../../packages/lab-runtime/src/v2/navigation2d/evidence');
const {navigationScene}=await import('../support/navigation2d');
const {irsimAvailable,irsimBundle,openRun,removeBundles,stepUntil,temp}=await import('../support/irsim-mission');
type Report=Awaited<ReturnType<Awaited<ReturnType<typeof openRun>>['report']>>;

const dirs:string[]=[];
afterEach(async()=>{spawned.deny=false;for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
let exported:{report:Report;root:string}|undefined,exportDir:string|undefined;
afterAll(async()=>{if(exportDir)await rm(exportDir,{recursive:true,force:true});await removeBundles();});
beforeAll(async()=>{
 if(!irsimAvailable)return;
 const b=await irsimBundle(),dir=await temp('irsim-replay-run-');dirs.push(dir);
 const run=await openRun(dir,b);
 try{await run.start();await stepUntil(run,v=>v.run.status==='completed');
  // export: the report JSON and the evidence chunks, copied to a fresh place; the run directory is gone afterwards
  const out=await temp('irsim-replay-export-');exportDir=out;
  await writeFile(join(out,'report.json'),JSON.stringify(await run.report()));await cp(join(dir,'evidence'),join(out,'evidence'),{recursive:true});
  exported={report:JSON.parse(await readFile(join(out,'report.json'),'utf8')) as Report,root:join(out,'evidence')};
 }finally{await run.close();await rm(dir,{recursive:true,force:true});}
},240_000);
/** Live irsim_worker processes on this host (the probe itself is allowed through the guard). */
/** The import: the exported document's artifacts and its recording block (gaps, terminal, last tick), read against the scene of the same fixture (same models, policy, world). */
const imported=(root:string,e:NonNullable<Report['navigation2d']>)=>readNavigationEvidence(root,{chunks:e.artifacts,...e.recording},{scene:{...navigationScene('serve'),sceneDigest:e.sceneDigest}});
const workers=()=>{const deny=spawned.deny;spawned.deny=false;try{return execFileSync('pgrep',['-f','irsim_worker'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).length;}catch{return 0;}finally{spawned.deny=deny;}};

test.skipIf(!irsimAvailable)('EVI03 import and replay every cursor: no process, no worker, no source session; business events and scans only at or before the cursor',async()=>{
 const {report,root}=exported!,e=report.navigation2d!;
 const before=workers();
 spawned.deny=true;
 const read=await imported(root,e);
 expect(read.complete).toBe(true);
 // the artifacts alone do not say how the recording ended: never complete
 const bare=await readNavigationEvidence(root,{chunks:e.artifacts},{scene:{...navigationScene('serve'),sceneDigest:e.sceneDigest}});
 expect([bare.complete,bare.reasons]).toEqual([false,['EVIDENCE_END_UNKNOWN']]);
 const horizon=e.clock.tickHorizon;
 for(let t=0;t<=horizon;t++){
  const at=replayAt(read,t,{events:report.businessEvents,epochMs:e.clock.businessEpochMs});
  expect(at.available).toBe(true);
  expect(at.scans.every(s=>s.tick<=t)).toBe(true);
  expect(at.controls.every(c=>c.tick<=t)).toBe(true);
  expect(at.events.every(x=>Date.parse(x.at)<=e.clock.businessEpochMs+t*20)).toBe(true);
  if(t%5===0)expect(at.scans.map(s=>s.tick)).toEqual([t]);
 }
 const last=replayAt(read,horizon,{events:report.businessEvents,epochMs:e.clock.businessEpochMs});
 expect(last.events).toHaveLength(report.businessEvents.length);
 expect(replayAt(read,0,{events:report.businessEvents,epochMs:e.clock.businessEpochMs}).events.length).toBeLessThan(report.businessEvents.length);
 expect(spawned.attempts).toEqual([]);
 expect(workers()).toBeLessThanOrEqual(before);
 // the guard is live: any process start during replay would have failed the test above
 const {spawn}=await import('node:child_process');
 expect(()=>spawn('true')).toThrow('REPLAY_SPAWN_DENIED:spawn');spawned.attempts.length=0;
},120_000);

test.skipIf(!irsimAvailable)('EVI03 metrics from the imported evidence equal the report; the replay modules import no executor, session, dispatcher or worker client',async()=>{
 const {report,root}=exported!,e=report.navigation2d!;
 spawned.deny=true;
 const scene=navigationScene('serve');
 // the exported run used the compiled scene of the same fixture: same models, policy and world
 expect(e.modelDigests).toEqual(scene.robots.map(r=>r.model.modelDigest));
 const m=navigationMetrics({...scene,sceneDigest:e.sceneDigest},await imported(root,e));
 expect({distanceM:m.distanceM,collisionEpisodes:m.collisionEpisodes,minClearanceM:m.minClearanceM}).toEqual({distanceM:report.metrics.distanceM,collisionEpisodes:report.metrics.navigation!.collisionEpisodes,minClearanceM:report.metrics.navigation!.minClearanceM});
 const source=await readFile(resolve('packages/lab-runtime/src/v2/navigation2d/evidence.ts'),'utf8'),imports=[...source.matchAll(/from '([^']+)'/g)].map(x=>x[1]);
 expect(imports.filter(i=>/child_process|worker-client|session|dispatch|scenario-runner|runner|gateway|sqlite/.test(i!))).toEqual([]);
 expect(spawned.attempts).toEqual([]);
});

test.skipIf(!irsimAvailable)('EVI03 confinement: traversal, absolute paths and a symlink out of the import root are refused, never followed',async()=>{
 const {report,root}=exported!,e=report.navigation2d!;
 spawned.deny=true;
 const outside=await temp('irsim-replay-outside-');dirs.push(outside);
 const victim=e.artifacts.trajectory[0]!;
 // a valid chunk placed outside the root: following any of these would verify
 await cp(join(root,victim.path),join(outside,victim.path));
 const swap=(path:string)=>({chunks:{...e.artifacts,trajectory:[{...victim,path},...e.artifacts.trajectory.slice(1)]}});
 for(const path of [`../${victim.path}`,join(outside,victim.path),`sub/${victim.path}`]){
  const r=await readNavigationEvidence(root,{...swap(path),...e.recording});
  expect(r.issues.map(i=>i.code),path).toEqual(['EVIDENCE_PATH_REJECTED']);expect(r.complete).toBe(false);
 }
 const linked=await temp('irsim-replay-linked-');dirs.push(linked);
 await cp(root,linked,{recursive:true});await rm(join(linked,victim.path));await symlink(join(outside,victim.path),join(linked,victim.path));
 const r=await imported(linked,e);
 expect(r.issues).toEqual([expect.objectContaining({code:'EVIDENCE_PATH_REJECTED',path:victim.path})]);
 expect(spawned.attempts).toEqual([]);
});
