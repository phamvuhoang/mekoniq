// Review6 A: a terminal the recorder produces at ANY flush (the stop flush of a finished/cancelled run, the flush of a lost plant, the flush at close) reaches the
// checkpoint before its manifest write is attempted, so a crash image whose manifest lists every tick but never got the terminal cannot reopen complete.
// Fault: the manifest rename lands, then the write reports EIO (an fsync after the rename failing), and every later manifest write fails (the terminal's too).
import {afterAll,afterEach,beforeAll,expect,test,vi} from 'vitest';
const fault={armed:false,tripped:false};
vi.mock('node:fs/promises',async(orig)=>{
 const real=await orig<typeof import('node:fs/promises')>();
 const eio=()=>Object.assign(new Error('EIO (injected)'),{code:'EIO'});
 return {...real,
  rename:async(a:Parameters<typeof real.rename>[0],b:Parameters<typeof real.rename>[1])=>{await real.rename(a,b);if(fault.armed&&!fault.tripped&&String(b).endsWith('/evidence/manifest.json')){fault.tripped=true;throw eio();}},
  open:async(p:Parameters<typeof real.open>[0],...r:unknown[])=>{if(fault.tripped&&String(p).endsWith('/evidence/.manifest.json.tmp'))throw eio();return (real.open as (...a:unknown[])=>ReturnType<typeof real.open>)(p,...r);},
 };
});
const {chmod,cp,readFile,rm,writeFile}=await import('node:fs/promises');
const {join}=await import('node:path');
const {act,double,irsimAvailable,irsimBundle,openRun,removeBundles,stepUntil,temp}=await import('../support/irsim-mission');
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';

let bundle:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable)bundle=await irsimBundle();},120_000);
afterAll(removeBundles);
afterEach(async()=>{fault.armed=false;fault.tripped=false;for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0)){await chmod(join(d,'evidence'),0o700).catch(()=>{});await rm(d,{recursive:true,force:true});}});
async function open(dir?:string,over:Parameters<typeof openRun>[2]={}){const d=dir??await temp('irsim-terminal-');if(!dir)dirs.push(d);const run=await openRun(d,bundle,over);runs.push(run);return {run,dir:d};}
const verdict=(r:RunReport)=>{const e=r.navigation2d!,a=(id:string)=>e.assertions.find(x=>x.id===id)!.result;return {status:e.completeness!.status,terminal:e.recording!.terminal,limits:a('EVIDENCE_LIMITS'),contact:a('NO_PHYSICAL_CONTACT')};};
/** The process dies now: copy its directory (the manifest on disk never got the terminal), lift the fault, reopen the copy. */
async function crashImage(dir:string){
 const m=JSON.parse(await readFile(join(dir,'evidence','manifest.json'),'utf8')) as {terminal:string|null};
 expect(m.terminal).toBeNull();
 const image=await temp('irsim-terminal-crash-');dirs.push(image);await cp(dir,image,{recursive:true});
 fault.armed=false;fault.tripped=false;
 return image;
}
const reopenedNeverComplete=async(image:string)=>{
 const {run}=await open(image),v=verdict(await run.report());
 expect(v).toMatchObject({terminal:expect.stringMatching(/^EVIDENCE_WRITE_FAILED/),status:'incomplete',limits:'fail'});expect(v.contact).not.toBe('pass');
};

test.skipIf(!irsimAvailable)('review6 A stop flush: a cancelled run whose final flush failed after the manifest rename reopens incomplete, never complete',async()=>{
 const {run,dir}=await open();
 await run.start();
 await act(run,'step',{ticks:10});
 fault.armed=true;
 await act(run,'cancel');
 const v=await stepUntil(run,x=>x.run.status==='cancelled'||fault.tripped,1,200);
 expect([v.run.status,fault.tripped]).toEqual(['cancelled',true]);// the failure is the stop flush of the finished run
 expect(verdict(await run.report())).toMatchObject({status:'incomplete',limits:'fail'});
 await reopenedNeverComplete(await crashImage(dir));
},240_000);

test.skipIf(!irsimAvailable)('review6 A lost plant: the flush of a plant lost on a step ACK reopens incomplete',async()=>{
 const {run,dir}=await open(undefined,{entry:[double('logged.py')]});
 await run.start();
 await act(run,'step',{ticks:10});
 fault.armed=true;await writeFile(join(dir,'worker','crash-next-step'),'');
 await act(run,'step',{ticks:5});
 expect(fault.tripped).toBe(true);
 await reopenedNeverComplete(await crashImage(dir));
},240_000);

test.skipIf(!irsimAvailable)('review6 A close: the flush at close that fails after the rename leaves a checkpoint that reopens incomplete',async()=>{
 const {run,dir}=await open();
 await run.start();
 await act(run,'step',{ticks:10});
 fault.armed=true;
 await run.close();runs.splice(runs.indexOf(run),1);
 expect(fault.tripped).toBe(true);
 await reopenedNeverComplete(await crashImage(dir));
},240_000);
