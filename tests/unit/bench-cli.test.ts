// K07b: scripts/bench.mjs and scripts/record-bench.mjs as child processes (stdin is a pipe, never a TTY), on the simulated slave with the real clock. Kept few and short
// (one torque case, KCF02); every other flow rule is tested through cli-flow.ts in bench-cli-flow.test.ts. Temp directories live under os.tmpdir().
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchRecordV1,type BenchSessionV1} from '../../packages/bench/src/contracts';
import {HARDWARE_GATES_BENCH} from '../../scripts/bench-qualification.mjs';
import {sourceDirty} from '../../scripts/repo-identity.mjs';

const ROOT=fileURLToPath(new URL('../..',import.meta.url)),FIXTURES=join(ROOT,'robotics/bench/fixtures');
const dir=mkdtempSync(join(tmpdir(),'bench-cli-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(join(FIXTURES,f),'utf8')) as T;
const reseal=<T extends {digest:string}>(doc:T,edit:(d:T)=>void):T=>{const {digest:_,...k}=structuredClone(doc);void _;edit(k as T);return sealBench<T>(k as Omit<T,'digest'>);};
// the real clock paces every tick: a relaxed lateness bound so a loaded host does not fail the one torque case these tests run
const POLICY=reseal(fixture<BenchPolicy>('policy-v1.json'),p=>{p.tickLatenessMaxMs=200;p.soakMinutes=0.1;});
const SOEM=reseal(fixture<BenchKitV1>('kit-sim-v1.json'),k=>{k.bus.backend='soem';k.bus.interface='enx-bench';delete k.simSlave;
 k.sensors.lidar={driver:'ld19',port:'/dev/ttyBENCH-none',baud:230400,profile:k.axes[0]!.profile};});
const SESSION:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'Lan',observer:null,location:'bench',startedAt:'2026-11-27T09:00:00Z',
 declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},instruments:[]};
const f=(name:string,x:unknown)=>{const p=join(dir,name);writeFileSync(p,JSON.stringify(x));return p;};
const KIT=join(FIXTURES,'kit-sim-v1.json');
let P:string,S:string,K_SOEM:string,n=0;
const fresh=(name:string)=>join(dir,`${name}-${++n}`);
/** One CLI run, stdin a pipe; the test hooks only when asked; low CPU priority like the rest of this plan. */
function cli(script:'bench'|'record-bench',args:string[],env:Record<string,string>={}){
 const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('BENCH_TEST_'))) as Record<string,string>;
 const low=process.platform==='darwin'?['taskpolicy','-b','nice','-n','19']:['nice','-n','19'];
 const r=spawnSync(low[0]!,[...low.slice(1),process.execPath,`scripts/${script}.mjs`,...args],{cwd:ROOT,encoding:'utf8',env:{...base,...env} as NodeJS.ProcessEnv,input:'',timeout:120_000});
 return {status:r.status,out:`${r.stdout}${r.stderr}`};
}
const common=()=>['--kit',KIT,'--policy',P,'--session',S];
let identity:string;
beforeAll(()=>{
 P=f('policy.json',POLICY);S=f('session.json',SESSION);K_SOEM=f('kit-soem.json',SOEM);
 identity=fresh('identity');
 const r=cli('bench',['identify',...common(),'--out',identity]);
 expect(r.status,r.out).toBe(0);
},120_000);
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

describe('a session on the simulated slave, end to end',()=>{
 it('identify, run one armed case, record-bench, verify: every hardware gate blocked_external, no G-KSW1, and the summary says it proves nothing about a drive',()=>{
  const conformance=fresh('conformance');
  const run=cli('bench',['run',...common(),'--identity',identity,'--suite','conformance','--case','KCF02','--out',conformance],{BENCH_TEST_ARMING:'1'});
  expect(run.status,run.out).toBe(0);
  expect(run.out).toMatch(/KCF02 tested/);expect(run.out).toMatch(/simulated slave \(protocol_double\).*proves nothing about a drive/);
  expect(run.out).toMatch(/cannot check/);
  const out=fresh('record'),rec=cli('record-bench',['--identity',identity,'--conformance',conformance,'--out',out,'--candidate-id','t-1']);
  if(sourceDirty(ROOT)){expect(rec.status).toBe(1);expect(rec.out).toMatch(/SOURCE_DIRTY/);return;}   // only a clean source tree can be recorded
  expect(rec.status,rec.out).toBe(0);
  const record=JSON.parse(readFileSync(join(out,'bench-record.json'),'utf8')) as BenchRecordV1;
  expect(record.gates['G-KSW1']).toBeUndefined();expect(record.host.testLevel).toBe('protocol_double');expect(record.accepted).toBe(false);
  for(const g of HARDWARE_GATES_BENCH)expect(record.gates[g]).toEqual({status:'blocked_external',accepted:false});
  expect(record.cases.KCF02!.status).toBe('tested');
  const v=cli('bench',['verify','--record',out]);
  expect(v.status,v.out).toBe(0);
  writeFileSync(join(out,'identity/session.json'),'{}');
  const bad=cli('bench',['verify','--record',out]);
  expect(bad.status).toBe(1);expect(bad.out).toMatch(/SIZE_MISMATCH identity\/session.json/);expect(bad.out).toMatch(/SESSION_DECLARATION_MISSING identity\/session.json/);
 },300_000);
 it('stdin not a terminal and no test hook: the torque case is not_run BENCH_NOT_ARMED, exit 1',()=>{
  const out=fresh('conformance'),r=cli('bench',['run',...common(),'--identity',identity,'--suite','conformance','--case','KCF02','--out',out]);
  expect(r.status,r.out).toBe(1);expect(r.out).toMatch(/KCF02 not_run BENCH_NOT_ARMED/);
 },120_000);
});

describe('refusals of bench.mjs',()=>{
 it('bad usage exits 2 before anything starts; there is no flag around a gate',()=>{
  const conformance=fresh('conformance'),base=['run',...common(),'--suite','conformance','--out',conformance];
  let r=cli('bench',base);expect(r.status).toBe(2);expect(r.out).toMatch(/MISSING_OPTION --identity/);
  for(const flag of ['--yes','--force','--no-arm','--skip-identity']){r=cli('bench',[...base,'--identity',identity,flag,'x']);expect(r.status,flag).toBe(2);expect(r.out).toMatch(`INVALID_OPTION ${flag}`);}
  r=cli('bench',[...base,'--identity',identity,'--bus','soem']);expect(r.status).toBe(2);expect(r.out).toMatch(/BENCH_BUS_MISMATCH/);
  r=cli('bench',['run','--kit',K_SOEM,'--policy',P,'--session',S,'--identity',identity,'--suite','conformance','--out',conformance],{BENCH_TEST_ARMING:'1'});
  expect(r.status).toBe(2);expect(r.out).toMatch(/the soem bus arrives with the first hardware session/);
  r=cli('bench',['identify',...common(),'--out',join(ROOT,'.bench-out')]);expect(r.status).toBe(2);expect(r.out).toMatch(/OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES/);
  r=cli('bench',['identify',...common(),'--out',identity]);expect(r.status).toBe(2);expect(r.out).toMatch(/OUT_EXISTS/);
 },120_000);
 it('run with the identity part of other serials: exit 1 BENCH_IDENTITY_CHANGED',()=>{
  const d=fresh('kit');mkdirSync(d);cpSync(join(FIXTURES,'sim-esi.summary.json'),join(d,'sim-esi.summary.json'));
  const other=join(d,'kit.json');writeFileSync(other,JSON.stringify(reseal(fixture<BenchKitV1>('kit-sim-v1.json'),k=>{Object.assign(k.simSlave!,{serials:['SIM-0007','SIM-0008']});})));
  const r=cli('bench',['run','--kit',other,'--policy',P,'--session',S,'--identity',identity,'--suite','conformance','--case','KCF02','--out',fresh('conformance')],{BENCH_TEST_ARMING:'1'});
  expect(r.status,r.out).toBe(1);expect(r.out).toMatch(/BENCH_IDENTITY_CHANGED/);
 },120_000);
});

describe('refusals of record-bench.mjs',()=>{
 it('an existing output, an output inside a repository, a missing or unknown option',()=>{
  let r=cli('record-bench',['--identity',identity,'--out',dir,'--candidate-id','t']);expect(r.status).toBe(1);expect(r.out).toMatch(/OUT_EXISTS/);
  r=cli('record-bench',['--identity',identity,'--out',join(ROOT,'.bench-record'),'--candidate-id','t']);expect(r.status).toBe(1);expect(r.out).toMatch(/OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES/);
  r=cli('record-bench',['--identity',identity,'--out',fresh('record')]);expect(r.status).toBe(2);expect(r.out).toMatch(/MISSING_OPTION --candidate-id/);
  r=cli('record-bench',['--identity',identity,'--compare',identity,'--out',fresh('record'),'--candidate-id','t']);expect(r.status).toBe(2);expect(r.out).toMatch(/INVALID_OPTION --compare/);
 },60_000);
});

describe('doctor',()=>{
 it('never throws: one {id, ok, detail} line per check, exit 1 while a check fails; the soem checks are linux only on this host',()=>{
  let r=cli('bench',['doctor']);
  const lines=(o:string)=>o.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x) as {id:string;ok:boolean;detail:string});
  let checks=lines(r.out);
  expect(checks.map(c=>c.id)).toEqual(['node','python','worker','venv']);
  expect(checks.find(c=>c.id==='node')!.ok).toBe(true);expect(checks.find(c=>c.id==='worker')!.ok).toBe(true);
  const venv=checks.find(c=>c.id==='venv')!;
  if(!venv.ok)expect(venv.detail).toMatch(/expected before the first hardware session/);
  expect(r.status).toBe(checks.every(c=>c.ok)?0:1);expect(r.out).not.toMatch(/\n\s+at /);
  r=cli('bench',['doctor','--kit',K_SOEM]);checks=lines(r.out);
  expect(checks.map(c=>c.id)).toEqual(['node','python','worker','venv','kit','nic','cap_net_raw','serial_ports','ftdi_latency','kernel']);
  expect(r.status).toBe(1);expect(r.out).not.toMatch(/\n\s+at /);
  if(process.platform!=='linux')for(const id of ['nic','cap_net_raw','ftdi_latency','kernel'])expect(checks.find(c=>c.id===id)).toMatchObject({ok:false,detail:'linux only'});
  expect(checks.find(c=>c.id==='serial_ports')).toMatchObject({ok:false,detail:expect.stringMatching(/ttyBENCH-none/)});
 },120_000);
});
