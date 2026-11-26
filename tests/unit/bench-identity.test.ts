// K07a: the identity cases KID02–KID05 (contracts §6.2), read-only, on what the real bench worker's `scan` read from the simulated slave (protocol_double) and the
// description summary of the simulated slave. Every verdict is re-evaluated from its stored (serialised) trace.
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import type {DescriptionSummary} from '../../packages/lab-runtime/src/engineering/catalog';
import {sealBench,type BenchKitV1,type BenchPolicy} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession,type RunContext} from '../../packages/bench/src/session';
import {BENCH_CASES,benchCase,verdictOf,type CaseTrace} from '../../packages/bench/src/cases/index';
import {IDENTITY_CASES,identityScan,simDescriptions} from '../../packages/bench/src/cases/identity';
import {closuresFor} from '../../packages/bench/src/closures';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-identity-'));
const FIX=new URL('../../robotics/bench/fixtures/',import.meta.url);
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(f,FIX),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),POLICY=fixture<BenchPolicy>('policy-v1.json'),ESI=fixture<DescriptionSummary>('sim-esi.summary.json');
const reseal=(edit:(k:BenchKitV1)=>void)=>{const {digest:_,...k}=structuredClone(KIT);void _;edit(k as BenchKitV1);return sealBench<BenchKitV1>(k);};
let n=0;
const workers:BenchWorker[]=[];
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

/** A read-only worker on a re-sealed kit, scanned with what the identity cases need; the summary is read the way the CLI reads it (beside the kit). */
async function identify(edit:(k:BenchKitV1)=>void=()=>{}){
 const kit=reseal(edit),d=join(dir,`kit-${++n}`),kitPath=join(d,'kit.json');
 mkdirSync(d);writeFileSync(kitPath,JSON.stringify(kit));copyFileSync(new URL('sim-esi.summary.json',FIX),join(d,'sim-esi.summary.json'));
 const w=await spawnBenchWorker({role:'bus',python:PY,kitPath,bus:'sim',readOnly:true,sessionId:'i',deadlinesMs:{step:5000}});workers.push(w);
 const {objects,strings}=identityScan(kit),{scan}=await startBenchSession(w,objects,{strings,scanOnly:true});
 const ctx:RunContext={worker:w,kit,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>{throw new Error('an identity case never asks for torque');}},passed:new Set(),
  abort:new AbortController().signal,scan:scan as RunContext['scan'],descriptions:simDescriptions(kit,kitPath)};
 return {w,kit,ctx};
}
const byId=(id:string)=>IDENTITY_CASES.find(c=>c.id===id)!;
/** Runs every identity case; each stored trace gives the same verdict again. */
async function runAll(ctx:RunContext){
 const out:Record<string,Awaited<ReturnType<typeof runCase>>>={};
 for(const c of IDENTITY_CASES){out[c.id]=await runCase(c,ctx);expect(verdictOf(c,JSON.parse(JSON.stringify(out[c.id]!.trace)) as CaseTrace,ctx.kit,POLICY)).toEqual(out[c.id]!.verdict);}
 return out;
}
/** The stored trace of one case with an edit, re-evaluated (what readback would do). */
const again=(id:string,t:CaseTrace,kit:BenchKitV1,edit:(t:CaseTrace)=>void)=>{const x=structuredClone(t);edit(x);return byId(id).evaluate(x,kit,POLICY);};

describe('identity cases on the simulated slave, read-only',()=>{
 it('KID02–KID05 are registered, read-only, need nothing before them, and all pass on the matching slave; nothing is sent',async()=>{
  expect(IDENTITY_CASES.map(c=>c.id)).toEqual(['KID02','KID03','KID04','KID05']);
  for(const c of IDENTITY_CASES){expect(benchCase(c.id)).toBe(c);expect(c.needsTorque).toBe(false);expect(c.requires).toEqual([]);}
  expect(BENCH_CASES.filter(c=>c.id.startsWith('KID'))).toHaveLength(4);
  const {w,ctx}=await identify(),r=await runAll(ctx);
  for(const id of ['KID02','KID03','KID04','KID05'])expect(r[id]!.verdict,id).toMatchObject({status:'tested',reason:null,measurements:[]});
  expect(r.KID02!.verdict.observed).toEqual({'/devices/amr-1/wheel-left':'SIM-FW 1.0.0','/devices/amr-1/wheel-right':'SIM-FW 1.0.0'});
  expect(r.KID04!.verdict.observed).toMatchObject({'/pdo/amr-1/wheel-left/remapNeeded':'false','/pdo/amr-1/wheel-left/default':'rx 6040:00,60FF:00; tx 6041:00,6064:00,606C:00'});
  expect(r.KID05!.verdict.observed).toMatchObject({'/modes/amr-1/wheel-left':'pv,csv'});
  expect(w.tick).toBe(0);expect(Object.values(r).every(x=>x.trace.ticks.length===0&&x.trace.cycles.length===0)).toBe(true);
  expect(ctx.disarmed).toBeFalsy();
  // the closure of the firmware row takes KID02's answer at its path
  expect(closuresFor([{ruleId:'UNVERIFIED_FIRMWARE',path:'/devices/amr-1/wheel-left',detail:'x'}],new Map([['KID02',r.KID02!.verdict]]),ctx.kit))
   .toEqual([{ruleId:'UNVERIFIED_FIRMWARE',path:'/devices/amr-1/wheel-left',result:'confirmed',caseId:'KID02',observed:'SIM-FW 1.0.0'}]);
 },30_000);
 it('KID04 reports a remap when the slave boots with another mapping than the kit plans (the AC kit has no 60FF in its default RxPDO)',async()=>{
  const {ctx}=await identify(k=>{k.simSlave!.defaultRxPdo=['6040:00'];}),r=await runCase(byId('KID04'),ctx);
  expect(r.verdict.status).toBe('tested');
  expect(r.verdict.observed).toMatchObject({'/pdo/amr-1/wheel-left/default':'rx 6040:00; tx 6041:00,6064:00,606C:00','/pdo/amr-1/wheel-left/remapNeeded':'true'});
 },30_000);
 it('KID05: a slave whose 6502h lacks the kit mode fails; a description that lacks it fails too',async()=>{
  const {ctx}=await identify(k=>{k.simSlave!.supportedModes=0x80;}),r=await runCase(byId('KID05'),ctx);   // csp only
  expect(r.verdict).toMatchObject({status:'failed',reason:'MODE_NOT_SUPPORTED amr-1/wheel-left csv (6502h 0x00000080)'});
  const ok=await runCase(byId('KID05'),(await identify()).ctx);
  expect(again('KID05',ok.trace,ctx.kit,t=>{t.descriptions!['amr-1/wheel-right']={...ESI,supportedModes:['pv']};})).toMatchObject({status:'failed',reason:'DESCRIPTION_MODE_MISSING amr-1/wheel-right csv'});
 },30_000);
 it('KID02 fails on a slave that is not the kit\'s, a duplicate serial, a description that disagrees; without the firmware string it is not_run',async()=>{
  const {ctx}=await identify(k=>{k.axes[1]!.expect.productCode='0x00000002';});
  expect((await runCase(byId('KID02'),ctx)).verdict).toMatchObject({status:'failed',reason:'IDENTITY_MISMATCH amr-1/wheel-right productCode'});
  expect((await runCase(byId('KID02'),(await identify(k=>{k.simSlave!.serials=['SIM-0001','SIM-0001'];})).ctx)).verdict).toMatchObject({status:'failed',reason:'SERIAL_DUPLICATE'});
  const good=await runCase(byId('KID02'),(await identify()).ctx),kit=KIT;
  expect(again('KID02',good.trace,kit,t=>{t.descriptions!['amr-1/wheel-left']={...ESI,revision:'0x00000002'};})).toMatchObject({status:'failed',reason:'DESCRIPTION_MISMATCH amr-1/wheel-left revision'});
  expect(again('KID02',good.trace,kit,t=>{t.scan!.slaves.pop();})).toMatchObject({status:'failed',reason:'SLAVE_COUNT 1 on the bus, 2 in the kit'});
  expect(again('KID02',good.trace,kit,t=>{t.scan!.slaves.reverse();for(const [i,s] of t.scan!.slaves.entries())s.position=i+1;})).toMatchObject({status:'failed',reason:'SLAVE_ORDER amr-1/wheel-left at position 1'});
  expect(again('KID02',good.trace,kit,t=>{for(const s of t.scan!.slaves)s.strings={};})).toMatchObject({status:'not_run',reason:'FIRMWARE_NOT_READ amr-1/wheel-left'});
  expect(again('KID02',good.trace,kit,t=>{delete t.descriptions;})).toMatchObject({status:'not_run',reason:'DESCRIPTION_SUMMARY_MISSING amr-1/wheel-left'});
  expect(again('KID02',good.trace,kit,t=>{delete t.scan;})).toMatchObject({status:'not_run',reason:'SCAN_NOT_RECORDED'});
 },30_000);
 it('KID03: every relied-on object must be read and described with the access and PDO mapping the kit uses it for',async()=>{
  const r=await runCase(byId('KID03'),(await identify()).ctx),kit=KIT,without=(o:string)=>({...ESI,objects:ESI.objects.filter(x=>`${x.index}:${x.subindex.toString(16).padStart(2,'0').toUpperCase()}`!==o)});
  const edit=(o:string,f:Partial<DescriptionSummary['objects'][number]>)=>({...ESI,objects:ESI.objects.map(x=>x.index===o?{...x,...f}:x)});
  expect(again('KID03',r.trace,kit,t=>{t.descriptions!['amr-1/wheel-left']=without('60FF:00');})).toMatchObject({status:'failed',reason:'OBJECT_NOT_IN_DESCRIPTION amr-1/wheel-left 60FF:00'});
  expect(again('KID03',r.trace,kit,t=>{t.descriptions!['amr-1/wheel-left']=edit('60FF',{pdoMappable:false});})).toMatchObject({status:'failed',reason:'RX_NOT_MAPPABLE amr-1/wheel-left 60FF:00'});
  expect(again('KID03',r.trace,kit,t=>{t.descriptions!['amr-1/wheel-left']=edit('6040',{access:'ro'});})).toMatchObject({status:'failed',reason:'RX_NOT_MAPPABLE amr-1/wheel-left 6040:00'});
  expect(again('KID03',r.trace,kit,t=>{t.descriptions!['amr-1/wheel-left']=edit('606C',{pdoMappable:false});})).toMatchObject({status:'failed',reason:'TX_NOT_MAPPABLE amr-1/wheel-left 606C:00'});
  expect(again('KID03',r.trace,kit,t=>{delete t.scan!.slaves[0]!.objects['6064:00'];})).toMatchObject({status:'not_run',reason:'OBJECT_NOT_READ amr-1/wheel-left 6064:00'});
  // a kit SDO write needs a writable object
  const sdo=reseal(k=>{k.axes[0]!.sdoWrites=[{object:'605A:00',value:2,bytes:2,why:'t',source:k.limits.source}];});
  expect(again('KID03',r.trace,sdo,t=>{t.descriptions!['amr-1/wheel-left']=edit('605A',{access:'ro'});})).toMatchObject({status:'failed',reason:'SDO_NOT_WRITABLE amr-1/wheel-left 605A:00'});
  expect(identityScan(sdo).objects).toEqual(['6040:00','6041:00','605A:00','6064:00','606C:00','60FF:00','6502:00']);
 },30_000);
 it('simDescriptions reads the summary beside the kit, for every axis, and refuses a path that leaves the kit directory',()=>{
  const d=join(dir,'desc');mkdirSync(d);copyFileSync(new URL('sim-esi.summary.json',FIX),join(d,'sim-esi.summary.json'));
  expect(simDescriptions(KIT,join(d,'kit.json'))).toEqual({'amr-1/wheel-left':ESI,'amr-1/wheel-right':ESI});
  for(const bad of ['../sim-esi.summary.json','/etc/passwd',''])
   expect(()=>simDescriptions(reseal(k=>{k.simSlave!.descriptionSummary=bad;}),join(d,'kit.json'))).toThrow(/DESCRIPTION_SUMMARY_PATH/);
  expect(simDescriptions(reseal(k=>{delete k.simSlave!.descriptionSummary;}),join(d,'kit.json'))).toEqual({});
 });
});
