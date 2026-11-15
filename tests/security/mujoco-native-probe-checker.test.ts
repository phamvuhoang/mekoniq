import {beforeAll,afterAll,expect,test} from 'vitest';
import {readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {checkerFixture} from '../fixtures/native-handoff-checker';
let fixture:Awaited<ReturnType<typeof checkerFixture>>;
beforeAll(async()=>{fixture=await checkerFixture();},30000);
afterAll(async()=>{if(fixture)await rm(fixture.root,{recursive:true,force:true});});
const run=(args:string[])=>spawnSync(process.execPath,args,{cwd:fixture.root,encoding:'utf8',timeout:30000});
test.each(['probe','prepare','supplement'])('audits before imported helper execution through %s',async entry=>{
 const path=join(fixture.root,'scripts/native-sim/mujoco-probe-evidence.mjs'),original=await readFile(path);
 try{
  await writeFile(path,Buffer.concat([Buffer.from('throw Error("DIRTY_HELPER_EXECUTED");\n'),original]));
  const args=entry==='probe'?['scripts/native-sim/mujoco-probe.mjs','--verify','/missing']:entry==='prepare'?['scripts/native-sim/prepare-mujoco-r2a.mjs','--runtime-cache','/missing','--lab','/missing','--out','/missing']:['--input-type=module','-e','const m=await import("./scripts/native-sim/mujoco-probe.mjs");await m.readMujocoProbeSupplement("/missing")'];
  const r=run(args);expect(r.status).not.toBe(0);expect(r.stderr).toContain('CHECKER_CHECKOUT_DIRTY');expect(r.stderr).not.toContain('DIRTY_HELPER_EXECUTED');
 }finally{await writeFile(path,original);}
});
test('cached poisoned reference in caller cannot replace freshly audited supplement reference',async()=>{
 const out=await mkdtemp(join(tmpdir(),'L01-cached-reference-'));
 try{
  const code=`import {readFile,writeFile} from 'node:fs/promises';
const p='./scripts/native-sim/r2a-arm-baseline.json',b=await readFile(p),ref=JSON.parse(b);
await writeFile(p,JSON.stringify({...ref,subject:{...ref.subject,sourceCommit:'0'.repeat(40)}}));
let m;try{await import(p,{with:{type:'json'}});m=await import('./scripts/native-sim/mujoco-probe.mjs');}finally{await writeFile(p,b);}
const {checkedCheckerIdentity}=await import('./scripts/native-checker-bootstrap.mjs');const checker=await checkedCheckerIdentity();
await writeFile(${JSON.stringify(join(out,'manifest.json'))},JSON.stringify({schemaVersion:1,kind:'mujoco-native-probe',qualification:'not_run',DEP_MJ_01:'not_run',accepted:false,subject:ref.subject,checker,artifacts:[]}));
console.log(JSON.stringify(await m.readMujocoProbeSupplement(${JSON.stringify(out)})));`;
  const r=run(['--input-type=module','-e',code]);expect(r.stderr).toBe('');expect(r.status).toBe(0);expect(JSON.parse(r.stdout).status).toBe('not_run');
 }finally{await rm(out,{recursive:true,force:true});}
});

test.each(['verify','read','copy','run','prepare'])('post-audit refuses a checker mutation during %s',async operation=>{
 const prepare=operation==='prepare',path=join(fixture.root,'scripts/native-sim/'+(prepare?'prepare-mujoco-r2a':'mujoco-probe')+'-core.mjs'),original=await readFile(path),reference=join(fixture.root,'scripts/native-sim/r2a-arm-baseline.json'),before=await readFile(reference);
 const name=({verify:'verifyMujocoProbe',read:'readMujocoProbeSupplement',copy:'copyMujocoProbeSupplement',run:'runMujocoProbe',prepare:'prepareR2aHandoff'} as const)[operation as 'verify'|'read'|'copy'|'run'|'prepare'];
 try{
  // Deliberately committed portable assessment double; mutate a tracked reference only in the test snapshot.
  await writeFile(path,`import {appendFile} from 'node:fs/promises';export async function ${name}(){await appendFile(new URL('./r2a-arm-baseline.json',import.meta.url),'\\n');return {passed:true,prepared:true};}\n`);
  fixture.git('add','.');fixture.git('-c','user.name=Protocol test','-c','user.email=protocol@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Portable post-check mutation double');
  const module=prepare?'prepare-mujoco-r2a':'mujoco-probe';
  const expression=operation==='run'||prepare?'{}':operation==='copy'?'"/missing","/missing"':'"/missing"';
  const r=run(['--input-type=module','-e',`const m=await import('./scripts/native-sim/${module}.mjs');console.log(await m.${name}(${expression}));`]);
  expect(r.status).not.toBe(0);expect(r.stderr).toContain('CHECKER_CHECKOUT_DIRTY');expect(r.stdout).not.toContain('passed');
 }finally{
  await writeFile(path,original);await writeFile(reference,before);fixture.git('add','.');fixture.git('-c','user.name=Protocol test','-c','user.email=protocol@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Restore portable assessment');
 }
});
