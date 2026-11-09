// scripts/lab-irsim.mjs + record-irsim.mjs and the campaign loader at the operator boundary (C02): strict argv, a campaign is a server-owned .json inside
// robotics/navigation-2d/campaigns only (no traversal, no symbolic link, no module/shell/YAML path, no unknown field), exit 2 for a missing prerequisite or usage,
// exit 1 for a failed/incomplete campaign, exit 0 only for a verified complete one. No IR-SIM engine runs here.
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {copyFile,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {campaignComplete,judgeRun,loadCampaign,summaryPreview,type RunRecord} from '../../packages/lab-runtime/src/v2/navigation2d/batch';

const cli=(...args:string[])=>{const r=spawnSync(process.execPath,['scripts/lab-irsim.mjs',...args],{encoding:'utf8',timeout:120000});return {code:r.status,out:r.stdout,err:r.stderr};};
const real=JSON.parse(await readFile('robotics/navigation-2d/campaigns/c02-concurrent.json','utf8')) as {runs:Record<string,unknown>[]};
async function root(){const r=await mkdtemp(join(tmpdir(),'irsim-cli-'));await mkdir(join(r,'robotics/navigation-2d/campaigns'),{recursive:true});return r;}
const put=async(r:string,name:string,body:unknown)=>{const p=join(r,'robotics/navigation-2d/campaigns',name);await writeFile(p,typeof body==='string'?body:JSON.stringify(body));return p;};
const code=async(p:Promise<unknown>)=>p.then(()=>'ok',(e:Error&{code?:string})=>`${e.code}: ${e.message}`);

test('campaign loader: a valid server-owned campaign loads frozen; every path outside the allowlisted directory, through a link, or not .json is refused',async()=>{
 const r=await root(),outside=await mkdtemp(join(tmpdir(),'irsim-cli-out-'));
 try{
  const ok=await put(r,'ok.json',{schemaVersion:1,id:'ok',title:'t',runs:real.runs});
  const loaded=await loadCampaign(ok,r);
  expect(loaded.campaign.runs.map(e=>e.scenarioId)).toEqual(['IR-FD01','IR-FD07']);
  expect(loaded.sha256).toBe(createHash('sha256').update(await readFile(ok)).digest('hex'));
  expect(()=>{(loaded.campaign.runs as unknown[]).push({});}).toThrow(TypeError);
  await writeFile(join(outside,'evil.json'),JSON.stringify({schemaVersion:1,id:'ok',title:'t',runs:real.runs}));
  await symlink(join(outside,'evil.json'),join(r,'robotics/navigation-2d/campaigns/link.json'));
  await symlink(outside,join(r,'robotics/navigation-2d/campaigns/dir'));
  await put(r,'c.yaml','runs: []');
  const cases:[string,RegExp][]=[
   [join(r,'robotics/navigation-2d/campaigns/../evil.json'),/CAMPAIGN_PATH_REJECTED/],           // traversal folded outside the directory
   [join(outside,'evil.json'),/CAMPAIGN_PATH_REJECTED/],                                         // absolute path elsewhere
   [join(r,'robotics/navigation-2d/campaigns/link.json'),/CAMPAIGN_PATH_REJECTED.*symbolic link/],  // a link to outside
   [join(r,'robotics/navigation-2d/campaigns/dir/evil.json'),/CAMPAIGN_PATH_REJECTED.*symbolic link/], // a linked directory on the way
   [join(r,'robotics/navigation-2d/campaigns/c.yaml'),/CAMPAIGN_PATH_REJECTED.*\.json/],            // YAML is not a campaign
   [resolve('packages/lab-runtime/src/v2/navigation2d/batch.ts'),/CAMPAIGN_PATH_REJECTED/],         // nor a module
   [join(r,'robotics/navigation-2d/campaigns/missing.json'),/CAMPAIGN_PATH_REJECTED.*does not exist/],
   [join(r,'robotics/navigation-2d/campaigns'),/CAMPAIGN_PATH_REJECTED/],
  ];
  for(const [p,why] of cases)expect(await code(loadCampaign(p,r)),p).toMatch(why);
  const big=await put(r,'big.json',' '.repeat(70*1024));
  expect(await code(loadCampaign(big,r))).toMatch(/CAMPAIGN_TOO_LARGE/);
 }finally{await rm(r,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('campaign loader: exactly the campaign schema; only IR-SIM scenarios on their own fixtures, known assertions, bounded counts',async()=>{
 const r=await root();
 try{
  const e=real.runs[0]!,bad=async(name:string,body:unknown)=>code(loadCampaign(await put(r,`${name}.json`,body),r));
  const c=(runs:unknown[],extra:Record<string,unknown>={})=>({schemaVersion:1,id:'x',title:'t',runs,...extra});
  expect(await bad('top',c([e],{module:'../../x.ts'}))).toMatch(/CAMPAIGN_INVALID.*unknown module/);
  expect(await bad('entry',c([{...e,shell:'rm -rf /'}]))).toMatch(/CAMPAIGN_INVALID.*unknown shell/);
  expect(await bad('missing',c([{...e,policyRef:undefined}]))).toMatch(/CAMPAIGN_INVALID/);
  expect(await bad('legacy',c([{...e,scenarioId:'FD01'}]))).toMatch(/FD01 is not an IR-SIM case/);
  expect(await bad('revision',c([{...e,scenarioRevision:2}]))).toMatch(/revision 2 is not 1/);
  expect(await bad('fixture',c([{...e,fixtureId:'serve-fleet-v1'}]))).toMatch(/fixture serve-fleet-v1 is not one IR-FD01 runs on/);
  expect(await bad('assertion',c([{...e,expectedAssertions:['ZONE_SINGLE_OWNER']}]))).toMatch(/ZONE_SINGLE_OWNER is not an assertion of IR-FD01/);
  expect(await bad('repeatable',c([{...e,repeat:1,expectedAssertions:['REPEATABLE']}]))).toMatch(/REPEATABLE needs repeat >= 2/);
  expect(await bad('seed',c([{...e,seed:1.5}]))).toMatch(/seed must be an integer/);
  expect(await bad('hash',c([{...e,policyRef:{...(e.policyRef as object),hash:'nope'}}]))).toMatch(/policyRef.hash/);
  expect(await bad('many',c(Array.from({length:11},()=>({...e,repeat:20}))))).toMatch(/more than 200 runs/);
  expect(await bad('schema',c([e],{schemaVersion:2}))).toMatch(/CAMPAIGN_INVALID/);
  expect(await bad('notjson','{')).toMatch(/not JSON/);
  // F5: campaign-level checks alone are no verdict: an entry must name at least one oracle of its own run
  expect(await bad('campaignonly',c([{...e,repeat:2,expectedAssertions:['REPEATABLE']}]))).toMatch(/name no oracle of IR-FD01/);
  expect(await bad('noiseonly',c([{...e,fixtureId:'serve-noisy-v1',expectedAssertions:['NOISE_VISIBLE']}]))).toMatch(/name no oracle of IR-FD01/);
  expect(await code(loadCampaign(await put(r,'mixed.json',c([{...e,repeat:2,expectedAssertions:['REPEATABLE','BUSINESS_OUTCOME']}])),r))).toBe('ok');
  // the contention rig and the fault cases are server-owned cases too; an unknown case is refused
  expect(await bad('nocase',c([{...e,scenarioId:'IR-FD01-teleport'}]))).toMatch(/not an IR-SIM case/);
  expect(await code(loadCampaign(await put(r,'rig.json',c([{...e,scenarioId:'IR-RIG-ZONE',fixtureId:'serve-fleet-v1',expectedAssertions:['ZONE_CONTENDED']}])),r))).toBe('ok');
 }finally{await rm(r,{recursive:true,force:true});}
});

test('F4 campaign complete: a failed oracle with complete evidence is never complete; a declared-gap fault case can be; an empty campaign is not',()=>{
 const run=(over:Partial<RunRecord>):RunRecord=>({id:'x',index:0,scenarioId:'IR-FD01',fixtureId:'serve-demo-v1',seed:1,repeat:1,expectedAssertions:['BUSINESS_OUTCOME'],result:'pass',reasons:[],evidenceComplete:true,evidenceAsExpected:true,assertions:[{id:'BUSINESS_OUTCOME',result:'pass'}],...over});
 expect(campaignComplete([run({})])).toBe(true);
 expect(campaignComplete([run({}),run({result:'fail',reasons:['FAIL:BUSINESS_OUTCOME: …'],assertions:[{id:'BUSINESS_OUTCOME',result:'fail'}]})])).toBe(false);
 expect(campaignComplete([run({assertions:[{id:'BUSINESS_OUTCOME',result:'inconclusive'}]})])).toBe(false);
 expect(campaignComplete([run({assertions:[]})])).toBe(false);
 expect(campaignComplete([run({evidenceComplete:false,evidenceAsExpected:true})])).toBe(true);   // IR10: the declared STEP_ACK_LOST gap, judged by its own oracle
 expect(campaignComplete([run({evidenceAsExpected:false})])).toBe(false);
 expect(campaignComplete([run({result:'not_run'})])).toBe(false);
 expect(campaignComplete([])).toBe(false);
});

test('review C02-2 #4 judgeRun: a failing oracle of the case fails the run even when the campaign did not list it; expected ones are reported as before',()=>{
 const rec=():RunRecord=>({id:'x',index:0,scenarioId:'IR-FD01',fixtureId:'serve-demo-v1',seed:1,repeat:1,expectedAssertions:['BUSINESS_OUTCOME','REPEATABLE'],result:'not_run',reasons:[],evidenceComplete:true,evidenceAsExpected:true});
 const entry={scenarioId:'IR-FD01',scenarioRevision:1,fixtureId:'serve-demo-v1',seed:1,repeat:2,policyRef:{id:'p',revision:1,hash:'0'.repeat(64)},expectedAssertions:['BUSINESS_OUTCOME','REPEATABLE']};
 const say=(id:string,result:'pass'|'fail'|'inconclusive')=>({id,result,expected:'e',actual:'a',oracle:'o'});
 let r=rec();judgeRun(r,entry,[say('BUSINESS_OUTCOME','pass'),say('NO_PHYSICAL_CONTACT','pass')],null,[]);
 expect([r.result,r.reasons,r.assertions]).toEqual(['pass',[],[{id:'BUSINESS_OUTCOME',result:'pass'}]]);
 r=rec();judgeRun(r,entry,[say('BUSINESS_OUTCOME','pass'),say('NO_PHYSICAL_CONTACT','fail')],null,[]);
 expect(r.result).toBe('fail');expect(r.reasons).toEqual([expect.stringMatching(/^FAIL:NO_PHYSICAL_CONTACT \(not listed by the campaign\)/)]);
 r=rec();judgeRun(r,entry,[say('BUSINESS_OUTCOME','fail')],'RUN_TIMEOUT:1ms',[]);
 expect(r.result).toBe('fail');expect(r.reasons).toEqual(['RUN_TIMEOUT:1ms',expect.stringMatching(/^FAIL:BUSINESS_OUTCOME/)]);
 r={...rec(),evidenceAsExpected:false};judgeRun(r,entry,[say('BUSINESS_OUTCOME','pass')],null,['GAP']);
 expect(r.reasons).toEqual(['EVIDENCE_NOT_AS_EXPECTED:GAP']);
});

test('summary preview: reasons are bounded for display while the record (and the run.json written from it) keeps every reason in full',()=>{
 const long=Array.from({length:15},(_,i)=>`FAIL:X${i}: ${'detail '.repeat(80)}`);
 const r:RunRecord={id:'001-IR-FD01-serve-demo-v1-s1-r1',index:0,scenarioId:'IR-FD01',fixtureId:'serve-demo-v1',seed:1,repeat:1,expectedAssertions:['BUSINESS_OUTCOME'],result:'fail',reasons:long};
 const before=structuredClone(r),p=summaryPreview(r);
 expect(p.reasons).toHaveLength(10);expect(p.reasons.every(x=>x.length<=200)).toBe(true);expect(p.reasonsTruncated).toBe(true);
 expect(r).toEqual(before);expect(r.reasons[14]!.length).toBeGreaterThan(400);
 expect(summaryPreview({...r,reasons:['short']})).toMatchObject({reasons:['short'],reasonsTruncated:false});
});

test('lab-irsim argv: strict schema, usage errors are exit 2 with a reason code',()=>{
 for(const [args,why] of [[['bogus'],/UNKNOWN_COMMAND/],[['run','--campaign'],/MISSING_VALUE/],[['run','--nope','1'],/UNKNOWN_OPTION/],[['run','x'],/UNEXPECTED_ARGUMENT/],
  [['run','--concurrency','2','--concurrency','1'],/DUPLICATE_OPTION/],[['run','--concurrency','two'],/INVALID_INT/],[['run','--campaign','c02-concurrent','--out','/tmp/never','--concurrency','3'],/INVALID_CONCURRENCY/],
  [['run','--out','/tmp/never'],/MISSING_OPTION:--campaign/],[['verify'],/MISSING_OPTION:--input/]] as [string[],RegExp][]){
  const r=cli(...args);expect(r.code,args.join(' ')).toBe(2);expect(r.err,args.join(' ')).toMatch(why);
 }
});

test('lab-irsim run: a campaign outside the allowlist is refused (exit 2); a missing worker is not_run for every run (exit 2), nothing runs in its place; a used output directory is refused',async()=>{
 const out=await mkdtemp(join(tmpdir(),'irsim-cli-run-'));
 try{
  for(const c of ['../../package.json',resolve('robotics/navigation-2d/fixtures/serve-demo-v1/manifest.json'),'/etc/hosts','no-such-campaign']){const r=cli('run','--campaign',c,'--out',join(out,'x'));expect(r.code,c).toBe(2);expect(r.err,c).toMatch(/NOT_RUN: CAMPAIGN_PATH_REJECTED/);}
  const r=cli('run','--campaign','c02-concurrent','--out',join(out,'np'),'--irsim-python','/nonexistent/python3');
  expect(r.code).toBe(2);expect(r.out).toMatch(/campaign not_run: 2 runs, 0 pass, 0 fail, 2 not_run, complete false/);
  const s=JSON.parse(await readFile(join(out,'np','summary.json'),'utf8')) as {status:string;complete:boolean;runs:{result:string;reasons:string[]}[];reasons:string[]};
  expect(s).toMatchObject({status:'not_run',complete:false});
  expect(s.runs.every(x=>x.result==='not_run'&&x.reasons[0]!.startsWith('PREREQUISITE_MISSING:IRSIM_WORKER_UNAVAILABLE'))).toBe(true);
  expect(existsSync(join(out,'np','runs'))).toBe(false);
  const again=cli('run','--campaign','c02-concurrent','--out',join(out,'np'),'--irsim-python','/nonexistent/python3');
  expect(again.code).toBe(2);expect(again.err).toMatch(/OUT_DIR_NOT_EMPTY/);
  // verify reads the not_run campaign as not_run
  expect(cli('verify','--input',join(out,'np')).code).toBe(2);
 }finally{await rm(out,{recursive:true,force:true});}
});

test('lab-irsim verify: exit 0 only for a finished, complete, all-pass irsim_worker campaign whose files agree; a crash image, a missing run record, a tampered campaign or a protocol double is 1',async()=>{
 const d=await mkdtemp(join(tmpdir(),'irsim-cli-verify-'));
 const write=async(over:Record<string,unknown>,runs:{id:string;rec?:Record<string,unknown>}[]=[{id:'001',rec:{result:'pass',evidenceAsExpected:true}}],campaign='{"x":1}')=>{
  await rm(d,{recursive:true,force:true});await mkdir(d,{recursive:true});await writeFile(join(d,'campaign.json'),campaign);
  await writeFile(join(d,'summary.json'),JSON.stringify({status:'completed',complete:true,campaignSha256:createHash('sha256').update('{"x":1}').digest('hex'),provider:{kind:'irsim_worker'},runs:runs.map(r=>({id:r.id,result:'pass'})),...over}));
  for(const r of runs)if(r.rec){await mkdir(join(d,'runs',r.id),{recursive:true});await writeFile(join(d,'runs',r.id,'run.json'),JSON.stringify(r.rec));}
 };
 try{
  await write({});expect(cli('verify','--input',d).code).toBe(0);
  await write({status:'running',complete:false});expect(cli('verify','--input',d).code).toBe(1);
  await write({},[{id:'001'}]);expect(cli('verify','--input',d).code).toBe(1);
  await write({},[{id:'001',rec:{result:'pass',evidenceAsExpected:false}}]);expect(cli('verify','--input',d).code).toBe(1);
  await write({},undefined,'{"x":2}');expect(cli('verify','--input',d).code).toBe(1);
  await write({provider:{kind:'protocol_double'}});expect(cli('verify','--input',d).code).toBe(1);
  await rm(d,{recursive:true,force:true});expect(cli('verify','--input',d).code).toBe(2);
 }finally{await rm(d,{recursive:true,force:true});}
});

test('record-irsim: a record goes into a new directory only (an existing one is refused before anything runs); --out is required',async()=>{
 const d=await mkdtemp(join(tmpdir(),'irsim-cli-record-'));
 try{
  const r=spawnSync(process.execPath,['scripts/record-irsim.mjs','--out',d],{encoding:'utf8',timeout:60000});
  expect(r.status).toBe(2);expect(r.stderr).toMatch(/OUT_EXISTS/);expect(existsSync(join(d,'irsim-record.json'))).toBe(false);
  const m=spawnSync(process.execPath,['scripts/record-irsim.mjs'],{encoding:'utf8',timeout:60000});
  expect(m.status).toBe(2);expect(m.stderr).toMatch(/MISSING_OPTION:--out/);
 }finally{await rm(d,{recursive:true,force:true});}
});

// ---- the server-owned scenario fixtures a campaign names (no engine: scenes come from the TypeScript compiler) ----
import {actorPoseAt,resolveScenarioFixture,SCENARIO_FIXTURES} from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
import {navigationScene} from '../support/navigation2d';
test('scenario fixtures: resolved deep-frozen and identical per seed; a zone over a standing point, an actor through a solid or clashing ids, or another world are refused',()=>{
 const fleet=navigationScene('fleet'),serve=navigationScene('serve');
 const a=resolveScenarioFixture('IR-FD07',fleet,7),b=resolveScenarioFixture('IR-FD07',fleet,7);
 expect(a).toEqual(b);expect(Object.isFrozen(a.actors[0]!.path[0])).toBe(true);expect(()=>{(a.zones[0]!.polygonM[0] as number[])[0]=0;}).toThrow(TypeError);
 expect(a.actors[0]!.scheduleRef).toMatchObject({id:'IR-FD07/customer-1',revision:1,hash:expect.stringMatching(/^[0-9a-f]{64}$/)});
 const spec=SCENARIO_FIXTURES.get('IR-FD07')!,variant=(over:Partial<typeof spec>)=>()=>resolveScenarioFixture('IR-FD07',fleet,7,{...spec,...over});
 expect(variant({zones:[{id:'z',polygonM:[[1.5,1],[2.5,1],[2.5,2],[1.5,2]],entryPoints:[],exitPoints:[]}]})).toThrow(/ZONE_CONTAINS_STANDING_POINT:z: robot01 start/);
 expect(variant({zones:[{id:'z',polygonM:[[0,0],[2,0],[1,1],[2,2],[0,2]],entryPoints:[],exitPoints:[]}]})).toThrow(/ZONE_NOT_CONVEX/);
 expect(variant({actors:[{id:'p',radiusM:0.25,startTick:[0,0],speedMps:0.5,path:[[3,3],[5,3]]}]})).toThrow(/ACTOR_CROSSES_SOLID:p meets table-01/);
 expect(variant({actors:[{id:'robot02',radiusM:0.25,startTick:[0,0],speedMps:0.5,path:[[5.5,6]]}]})).toThrow(/ID_CLASH:robot02/);
 expect(variant({actors:[{id:'p',radiusM:0.25,startTick:[0,0],speedMps:0.5,path:[[19.9,6]]}]})).toThrow(/ACTOR_OUTSIDE_WORLD/);
 expect(()=>resolveScenarioFixture('IR-FD07',{...fleet,world:{...fleet.world,id:'other-world'}},7)).toThrow(/WORLD_MISMATCH/);
 // a drawn start tick comes from the actor's own PRNG stream: same seed same schedule, another seed another one
 const ranged=(seed:number)=>resolveScenarioFixture('IR-FD03',serve,seed,{...SCENARIO_FIXTURES.get('IR-FD03')!,actors:[{id:'p',radiusM:0.25,startTick:[100,400],speedMps:0.5,path:[[0.45,3.2],[3.2,3.2]]}]}).actors[0]!;
 expect(ranged(3)).toEqual(ranged(3));expect(new Set([1,2,3,4,5,6].map(s=>ranged(s).startTick)).size).toBeGreaterThan(1);
 // the schedule is a pure function of the tick: still before the start, linear at speed, still at the end; asking in any order gives the same pose
 const p=resolveScenarioFixture('IR-FD03',serve,1).actors[0]!;
 expect([actorPoseAt(p,0),actorPoseAt(p,100)]).toEqual([[0.45,3.2,0],[0.45,3.2,0]]);
 expect(actorPoseAt(p,150)[0]).toBeCloseTo(0.95,12);expect(actorPoseAt(p,100000)).toEqual([3.2,0.45,0]);
 expect(actorPoseAt(p,321)).toEqual(actorPoseAt(p,321));
});

// ---- C02 fix pass F3: "clean" means nothing outside the commit can run; the tool trees are stamped before and after ----
const {treeState}=await import('../../scripts/lab-irsim.mjs' as string) as {treeState:(dir:string,exclude?:string[])=>{dirty:boolean;reasons:string[]}};
import {cp as copyTree} from 'node:fs/promises';
test('F3 tree state: an untracked file anywhere, or an ignored file in a tool root that could run, makes the tree dirty; bytecode in __pycache__, pytest caches and tests/ do not',async()=>{
 const repo=await mkdtemp(join(tmpdir(),'irsim-tree-'));
 const git=(...a:string[])=>spawnSync('git',a,{cwd:repo,encoding:'utf8'});
 try{
  await mkdir(join(repo,'robotics/navigation-2d/irsim_worker'),{recursive:true});
  await writeFile(join(repo,'robotics/navigation-2d/irsim_worker/__init__.py'),'');await writeFile(join(repo,'.gitignore'),'*.so\n*.pyc\n__pycache__/\n.pytest_cache/\n');
  git('init','-q');git('add','.');git('-c','user.email=t@t','-c','user.name=t','commit','-qm','init');
  expect(treeState(repo)).toMatchObject({dirty:false,reasons:[]});
  await writeFile(join(repo,'robotics/navigation-2d/sitecustomize.py'),'print("planted")\n');
  expect(treeState(repo)).toMatchObject({dirty:true,reasons:['?? robotics/navigation-2d/sitecustomize.py']});
  await rm(join(repo,'robotics/navigation-2d/sitecustomize.py'));
  for(const f of ['robotics/navigation-2d/irsim_worker/__pycache__/x.cpython-311.pyc','robotics/navigation-2d/.pytest_cache/v/x','robotics/navigation-2d/tests/__pycache__/t.pyc']){await mkdir(dirname(join(repo,f)),{recursive:true});await writeFile(join(repo,f),'x');}
  expect(treeState(repo).dirty).toBe(false);
  await writeFile(join(repo,'robotics/navigation-2d/irsim_worker/evil.so'),'x');
  await writeFile(join(repo,'robotics/navigation-2d/irsim_worker/session.pyc'),'x');   // a loose sourceless module is importable
  expect(treeState(repo).reasons.sort()).toEqual(['ignored-in-tool-root robotics/navigation-2d/irsim_worker/evil.so','ignored-in-tool-root robotics/navigation-2d/irsim_worker/session.pyc']);
  await rm(join(repo,'robotics/navigation-2d/irsim_worker/evil.so'));await rm(join(repo,'robotics/navigation-2d/irsim_worker/session.pyc'));
  // review C02-2 #1: a recorder's own output inside the repo (docs/implementation/evidence is not ignored) is not what makes the tree dirty; anything else still is
  await mkdir(join(repo,'docs/evidence/c1/campaign'),{recursive:true});await writeFile(join(repo,'docs/evidence/c1/campaign/summary.json'),'{}');
  expect(treeState(repo).dirty).toBe(true);
  expect(treeState(repo,['docs/evidence/c1'])).toMatchObject({dirty:false,reasons:[]});
  await writeFile(join(repo,'robotics/navigation-2d/planted.py'),'');
  expect(treeState(repo,['docs/evidence/c1']).reasons).toEqual(['?? robotics/navigation-2d/planted.py']);
 }finally{await rm(repo,{recursive:true,force:true});}
});
test('F3 tool closures: a campaign is refused before it starts when the portable tools differ from the expected pin, and stopped as not_run when they change while it runs',async()=>{
 const out=await mkdtemp(join(tmpdir(),'irsim-cli-pin-'));
 try{
  const r=cli('run','--campaign','c02-concurrent','--out',join(out,'x'),'--expect-portable-digest','0'.repeat(64));
  expect(r.code).toBe(2);expect(r.err).toMatch(/NOT_RUN: TOOL_CLOSURE_MISMATCH: portable tools [0-9a-f]{64}, expected 0{64}/);expect(existsSync(join(out,'x'))).toBe(false);
  // a copy of the tree whose "python" edits a closure file when it is first started (the prerequisite probe), then fails like a missing interpreter
  const copy=join(out,'src');
  for(const d of ['scripts','packages','integrations','robotics','tests/fixtures/digital-twin'])await copyTree(resolve(d),join(copy,d),{recursive:true,verbatimSymlinks:true,filter:(x)=>!/(__pycache__|\.pytest_cache|\/\.venv)/.test(x)});
  await symlink(resolve('node_modules'),join(copy,'node_modules'));await copyFile('package.json',join(copy,'package.json'));
  const fake=join(out,'python');await writeFile(fake,`#!/bin/sh\necho "# edited mid-campaign" >> ${join(copy,'robotics/navigation-2d/requirements.in')}\nexit 1\n`,{mode:0o755});
  const c=spawnSync(process.execPath,[join(copy,'scripts/lab-irsim.mjs'),'run','--campaign','c02-concurrent','--out',join(out,'y'),'--irsim-python',fake],{encoding:'utf8',timeout:120000});
  expect(c.status,c.stderr).toBe(2);expect(c.stderr).toMatch(/NOT_RUN: TOOL_CLOSURE_CHANGED during the campaign: portable [0-9a-f]{64} -> [0-9a-f]{64}/);
  const id=JSON.parse(await readFile(join(out,'y','identity.json'),'utf8')) as {stable:boolean;toolClosures:{before:{portable:string};after:{portable:string}}};
  expect(id.stable).toBe(false);expect(id.toolClosures.before.portable).not.toBe(id.toolClosures.after.portable);
  const s=JSON.parse(await readFile(join(out,'y','summary.json'),'utf8')) as {identity:{toolClosures:{portable:string}}};
  expect(s.identity.toolClosures.portable).toBe(id.toolClosures.before.portable);
  expect(cli('verify','--input',join(out,'y')).code).toBe(2);
 }finally{await rm(out,{recursive:true,force:true});}
},180_000);
