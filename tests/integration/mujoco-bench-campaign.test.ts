// final-fix V07 F0: the bench campaign's recorder and its independent verifier (G-TUNE1: per-run artifacts). Engine-free: the registered campaign is the 16 runs contracts §9 asks for and every
// signal is admitted with the served starting profile. On the real engine (.venv-mujoco; skipped without it): one recorded case verifies, and edits are caught even when the case's own inventory is
// re-made for them (a metric, a removed chunk, another commit, status, signal, trace digest, suggestion, architecture). The full campaign is verified when a recording is given (BENCH_RECORDED_DIR).
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {cp,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import historical from '../../robotics/simulation-mujoco/campaigns/bench-v1.json';
import {BENCH_CAMPAIGN,BENCH_CASES,runBenchCampaign,verifyBenchCampaign} from '../../packages/lab-runtime/src/v2/control/bench-campaign';
import {admitBench,benchCatalog} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {BENCH_AXES} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {cellArtifacts,verifyCellCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
import {mujocoReady,mujocoRoot} from '../support/mujoco-arm';

const root=resolve('.'),COMMIT='0123456789abcdef0123456789abcdef01234567',CASE='J3-step';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8')) as Record<string,any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const write=(p:string,v:unknown)=>writeFile(p,JSON.stringify(v,null,2)+'\n');

test('the registered campaign is one step and one trapezoid per bench axis (16 runs), the starting profile, drive-nominal-v1; every signal is admitted and every run names a declared expectation',async()=>{
 expect(BENCH_CAMPAIGN.id).toBe('bench-v2');expect(BENCH_CASES).toHaveLength(16);expect(new Set(BENCH_CASES.map(c=>c.id)).size).toBe(16);
 for(const axis of BENCH_AXES)expect(BENCH_CASES.filter(c=>c.axis===axis).map(c=>c.signal.kind).sort(),axis).toEqual(['step','trapezoid']);
 const served=await benchCatalog(mujocoRoot);expect(served['MJ-BENCH-WHEEL'].startingProfile.id).toBe('serve-control-v2');
 for(const c of BENCH_CASES){
  expect(Object.keys(BENCH_CAMPAIGN.expectations),c.id).toContain(c.expect);
  await expect(admitBench({schemaVersion:1,scenarioId:c.scenarioId,axis:c.axis,signal:c.signal,driveExperimentId:BENCH_CAMPAIGN.driveExperimentId,controlProfile:served[c.scenarioId].startingProfile},mujocoRoot),c.id).resolves.toMatchObject({axisIds:expect.any(Array)});
 }
 expect(BENCH_CAMPAIGN).toMatchObject({accepted:false,calibration:'not_calibrated',driveExperimentId:'drive-nominal-v1'});
});

test('bench-v1 selects its own run even if bench-v2 drops it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bench-version-')),last=BENCH_CASES.pop()!;
 try{
  await write(join(dir,'campaign.json'),{campaign:historical,sourceCommit:COMMIT,hostArch:'arm64',accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'});
  expect(await verifyBenchCampaign(dir,last.id)).toMatchObject({expectedRuns:1,completedCases:0,missingArtifacts:[last.id]});
 }finally{BENCH_CASES.push(last);await rm(dir,{recursive:true,force:true});}
});

test.each(['','unknown'])('bench refuses an unregistered explicit selector before reading artifacts (%s)',async id=>{
 expect((await verifyBenchCampaign('/missing-campaign',id)).issues).toEqual(['BENCH_CASE_UNREGISTERED']);
});
test.each([{ids:[]},{ids:['unknown']},{ids:['lost-ack','unknown']}])('cell refuses invalid explicit scope before reading artifacts ($ids)',async({ids})=>{
 expect(await verifyCellCampaign('/missing-campaign',ids)).toEqual({expectedRuns:0,completedCases:0,missingArtifacts:[],issues:['CELL_CASE_UNREGISTERED']});
});

describe.skipIf(!mujocoReady)('a recorded bench case on the real engine',()=>{
 let recorded:string;
 beforeAll(async()=>{recorded=join(await mkdtemp(join(tmpdir(),'bench-one-')),'c');await runBenchCampaign({root,out:recorded,sourceCommit:COMMIT,caseId:CASE});},300_000);
 afterAll(async()=>{await rm(join(recorded,'..'),{recursive:true,force:true});});
 const copy=async()=>{const d=join(await mkdtemp(join(tmpdir(),'bench-tamper-')),'c');await cp(recorded,d,{recursive:true});return d;};
 /** After a deliberate edit, the case's own inventory is made to agree with the files again, so that only the deeper checks can catch the edit. */
 const reseal=async(d:string)=>{const dir=join(d,CASE),rec=await json(join(dir,'case.json'));rec.artifacts=await cellArtifacts(dir);await write(join(dir,'case.json'),rec);};
 const issues=async(d:string)=>(await verifyBenchCampaign(d,CASE)).issues.join('|');
 const editReport=async(edit:(r:Record<string,any>)=>void)=>{const d=await copy(),p=join(d,CASE,'report.json'),r=await json(p);edit(r);await write(p,r);await reseal(d);return issues(d);};   // eslint-disable-line @typescript-eslint/no-explicit-any
 test('a recorded case verifies: its trace read back, its metrics and suggestions recomputed, the oracle met',async()=>{
  const v=await verifyBenchCampaign(recorded,CASE);
  expect(v).toMatchObject({expectedRuns:1,completedCases:1,missingArtifacts:[],issues:[]});expect(v.runs[0]).toMatchObject({id:CASE,status:'completed'});
  const c=await json(join(recorded,'campaign.json'));expect(c).toMatchObject({sourceCommit:COMMIT,accepted:false,execution:'actual_mujoco',hostArch:process.arch==='arm64'?'arm64':'x86_64'});
 });
 test('verification recomputes the wheel/body comparison from the recorded wheel tick',async()=>{
  const id='wheels-step',dir=await mkdtemp(join(tmpdir(),'bench-body-')),out=join(dir,'campaign');
  try{
   const record=await runBenchCampaign({root,out,sourceCommit:COMMIT,caseId:id});
   expect(record.issues).toEqual([]);
   const run=join(out,id),p=join(run,'report.json'),report=await json(p);
   expect(report.tuning.wheelMeasurement.comparison).toMatchObject({tick:500,bodyForwardMps:expect.any(Number)});
   report.tuning.wheelMeasurement.comparison.bodyForwardMps+=0.01;await write(p,report);
   const rec=await json(join(run,'case.json'));rec.artifacts=await cellArtifacts(run);await write(join(run,'case.json'),rec);
   expect((await verifyBenchCampaign(out,id)).issues).toContain(id+':BENCH_WHEEL_COMPARISON_NOT_FROM_TRACE');
   const folder=join(run,'run/trace'),manifestFile=join(folder,'manifest.json'),manifest=await json(manifestFile);
   const last=manifest.chunks.at(-1),chunkFile=join(folder,last.path);
   const rows=gunzipSync(await readFile(chunkFile)).toString().trimEnd().split('\n').map(row=>JSON.parse(row));
   delete rows.at(-1).bodyForwardMps;
   const compressed=gzipSync(rows.map(row=>JSON.stringify(row)+'\n').join(''));
   const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
   await writeFile(chunkFile,compressed);last.bytes=compressed.length;last.sha256=sha(compressed);
   await write(manifestFile,manifest);report.tuning.trace.sha256=sha(await readFile(manifestFile));
   delete report.tuning.wheelMeasurement;await write(p,report);
   rec.artifacts=await cellArtifacts(run);await write(join(run,'case.json'),rec);
   expect((await verifyBenchCampaign(out,id)).issues).toEqual([id+':BENCH_WHEEL_COMPARISON_NOT_FROM_TRACE']);
  }finally{await rm(dir,{recursive:true,force:true});}
 },120000);
 test.each(['accepted','schema','cancelled','paused','contradictory'])('verification refuses a resealed invalid tuning result or outer outcome (%s)',async mutation=>{
  expect(await editReport(r=>{
   if(mutation==='accepted')r.tuning.accepted=true;
   else if(mutation==='schema')r.tuning.schemaVersion=2;
   else if(mutation==='contradictory')r.tuning.collision={tick:500,ids:['test']};
   else r.outcome.status=mutation;
  })).toMatch(/BENCH_(RESULT_SCHEMA|STATUS_NOT_THE_RUN)/);
 });
 test('verification refuses a missing run, an edited or removed file (inventory) and a campaign of another identity or commit',async()=>{
  let d=await copy();await rm(join(d,CASE),{recursive:true});expect(await issues(d)).toContain(CASE);
  d=await copy();const chunk=(await readdir(join(d,CASE,'run/trace'))).find(n=>n.endsWith('.ndjson.gz'))!;await rm(join(d,CASE,'run/trace',chunk));expect(await issues(d)).toContain('BENCH_ARTIFACT_INVENTORY');
  d=await copy();let c=await json(join(d,'campaign.json'));c.sourceCommit='f'.repeat(40);await write(join(d,'campaign.json'),c);expect(await issues(d)).toContain('BENCH_CASE_IDENTITY');
  d=await copy();c=await json(join(d,'campaign.json'));c.campaign.seed=8;await write(join(d,'campaign.json'),c);expect(await issues(d)).toContain('BENCH_CAMPAIGN_IDENTITY');
 });
 test('verification catches an edit the inventory was re-made for: a metric, a removed chunk, another commit, status, signal, trace digest, suggestion or architecture',async()=>{
  expect(await editReport(r=>{r.tuning.metrics.riseTimeS.value*=1.01;})).toContain('BENCH_METRICS_NOT_FROM_TRACE');
  expect(await editReport(r=>{r.tuning.metrics.settlingTimeS={available:false,value:null,unit:'s',reason:'NOT_SETTLED'};})).toContain('BENCH_METRICS_NOT_FROM_TRACE');
  let d=await copy();const chunk=(await readdir(join(d,CASE,'run/trace'))).filter(n=>n.endsWith('.ndjson.gz')).sort()[3]!;await rm(join(d,CASE,'run/trace',chunk));await reseal(d);expect(await issues(d)).toContain('BENCH_TRACE_INCOMPLETE');
  d=await copy();const bytes=await readFile(join(d,CASE,'run/trace',chunk));bytes[bytes.length-1]^=0xff;await writeFile(join(d,CASE,'run/trace',chunk),bytes);await reseal(d);expect(await issues(d)).toContain('BENCH_TRACE_INCOMPLETE');
  expect(await editReport(r=>{r.manifest.sourceCommit='f'.repeat(40);})).toContain('BENCH_RUN_IDENTITY');
  expect(await editReport(r=>{r.tuning.status='drive_fault';r.tuning.fault={tick:200,axisId:'xarm-1/J3',code:'OVERSPEED'};})).toMatch(/BENCH_STATUS_NOT_THE_RUN|BENCH_METRICS_NOT_FROM_TRACE/);
  expect(await editReport(r=>{r.tuning.signal.amplitude=0.1;r.bench.request.signal.amplitude=0.1;})).toContain('BENCH_REQUEST_IDENTITY');
  expect(await editReport(r=>{r.tuning.trace.sha256='0'.repeat(64);})).toContain('BENCH_TRACE_NOT_THE_RESULTS');
  expect(await editReport(r=>{r.tuning.suggestions[0].loop.kp+=1;})).toContain('BENCH_SUGGESTIONS_NOT_FROM_INERTIA');
  expect(await editReport(r=>{r.tuning.engine.hostArch=r.tuning.engine.hostArch==='arm64'?'x86_64':'arm64';})).toContain('BENCH_HOSTARCH');
  expect(await editReport(r=>{r.tuning.plant.controlProfileDigest='0'.repeat(64);})).toContain('BENCH_PROFILE_IDENTITY');
  // the bundle's draft is the served starting profile byte for byte
  d=await copy();const p=join(d,CASE,'run/bundle/bench-control.json');await writeFile(p,(await readFile(p,'utf8')).replace('"kp":5000','"kp":5001'));await reseal(d);expect(await issues(d)).toContain('BENCH_PROFILE_IDENTITY');
 });
});

test.skipIf(!process.env.BENCH_RECORDED_DIR)('the recorded bench-v1 campaign is complete and meets its oracle',async()=>{
 const v=await verifyBenchCampaign(process.env.BENCH_RECORDED_DIR!);
 expect(v.issues).toEqual([]);expect(v.expectedRuns).toBe(16);expect(v.completedCases).toBe(16);expect(v.missingArtifacts).toEqual([]);
});
