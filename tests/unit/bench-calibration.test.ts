// K07a (KSW09): the KMS01 trials of a `measure` part exported as the calibration dataset of spec B1 §7.5 step 1, then read by the repo's REAL importer
// (scripts/import-calibration-log.mjs). Data from the simulated slave is synthetic, carries `generator`, and can never be exported as measured.
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchSessionV1} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession} from '../../packages/bench/src/session';
import {MEASURE_CASES,lagTrialsOf,type CaseTrace} from '../../packages/bench/src/cases/index';
import {exportCalibration} from '../../packages/bench/src/calibration-export';

const PY=process.env.BENCH_PYTHON??'python3',ROOT=fileURLToPath(new URL('../..',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'bench-calibration-'));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(new URL(`../../robotics/bench/fixtures/${f}`,import.meta.url),'utf8')) as T;
const KIT=fixture<BenchKitV1>('kit-sim-v1.json'),POLICY={...fixture<BenchPolicy>('policy-v1.json'),lagTrials:6};
const SESSION:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'Lan',observer:null,location:'bench',startedAt:'2026-11-27T09:00:00Z',
 declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},
 instruments:[{id:'marker-1',kind:'marker',note:'paint mark on the shaft'}]};
const DIGEST=KIT.digest;
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
let trace:CaseTrace,n=0;
beforeAll(async()=>{
 const w=await spawnBenchWorker({role:'bus',python:PY,kitPath:fileURLToPath(new URL('../../robotics/bench/fixtures/kit-sim-v1.json',import.meta.url)),bus:'sim',readOnly:false,sessionId:'k',deadlinesMs:{step:5000}});
 try{
  await startBenchSession(w);
  const r=await runCase(MEASURE_CASES[0]!,{worker:w,kit:KIT,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(['KCF02','KCF04','KCF01']),abort:new AbortController().signal});
  expect(r.verdict.status).toBe('tested');trace=r.trace;
 }finally{await w.close();}
},60_000);
/** Writes the export to a new directory and runs the real importer on it with low CPU priority; the importer's own exit code and output. */
function importer(x:{sidecar:unknown;files:{name:string;csv:string}[]}){
 const d=join(dir,`export-${++n}`),sidecar=join(d,'sidecar.json');
 mkdirSync(d);writeFileSync(sidecar,JSON.stringify(x.sidecar));for(const f of x.files)writeFileSync(join(d,f.name),f.csv);
 const cmd=[process.execPath,'scripts/import-calibration-log.mjs','--sidecar',sidecar,'--out',join(d,'dataset.json')];
 const low=process.platform==='darwin'?['taskpolicy','-b','nice','-n','19']:['nice','-n','19'];
 const r=spawnSync(low[0]!,[...low.slice(1),...cmd],{cwd:ROOT,encoding:'utf8',timeout:120_000});
 return {status:r.status,stdout:r.stdout,stderr:r.stderr,dataset:r.status===0?JSON.parse(readFileSync(join(d,'dataset.json'),'utf8')) as {trials:{trialId:string;split:string;timesNs:number[];channels:Record<string,number[]>}[];sourceKind:string;clockMapping:unknown}:null};
}
const part=(kit=KIT)=>({results:[{caseId:'KMS01',trace}],session:SESSION,kit,policy:POLICY});

describe('exportCalibration (KSW09)',()=>{
 it('one CSV per trial and axis, time_ns,command,encoder in rad/s from the sample before the signal, splits alternating in trial order; the real importer takes it',()=>{
  const x=exportCalibration(part(),{sourceKind:'synthetic',configDigest:DIGEST}),s=x.sidecar;
  expect(s).toMatchObject({sourceKind:'synthetic',deviceId:KIT.id,configDigest:DIGEST,clockDomain:'wall',clockOffsetNs:0,units:{command:'rad/s',encoder:'rad/s'}});
  expect(s.generator).toMatch(/simulated slave/);expect(s.attestation).toBeUndefined();
  expect(s.policy).toEqual({channels:{encoder:{absoluteTolerance:0.05,relativeTolerance:0.05}},minTrialsPerCondition:3,maxClockGapNs:20_000_000,capabilities:{encoder:'actuator'}});
  const trials=lagTrialsOf(trace,KIT,POLICY)!;
  expect(s.trials).toHaveLength(trials.length*KIT.axes.length);expect(x.files).toHaveLength(s.trials.length);
  expect(s.trials.map(t=>t.split)).toEqual(trials.flatMap(t=>KIT.axes.map(()=>t.split)));
  expect(trials.map(t=>t.split)).toEqual(['tune','validation','tune','validation','tune','validation']);
  expect(s.trials[0]).toEqual({trialId:'KMS01-00:amr-1/wheel-left',split:'tune',condition:'step-2',file:'KMS01-00-amr-1-wheel-left.csv',axisId:'amr-1/wheel-left',signal:{kind:'step',amplitude:2,atTick:5}});
  const csv=x.files[0]!.csv.trim().split('\n'),cpt=20/KIT.bus.cycleMs;
  expect(csv[0]).toBe('time_ns,command,encoder');expect(csv).toHaveLength(1+trials[0]!.ticks*cpt+1);
  const rows=csv.slice(1).map(l=>l.split(',').map(Number));
  expect(rows[0]![0]).toBe(0);expect(rows.every((r,i)=>i===0||(r[0]!-rows[i-1]![0]!)===KIT.bus.cycleMs*1e6)).toBe(true);
  expect(rows.slice(0,1+5*cpt).every(r=>r[1]===0)).toBe(true);expect(rows.slice(1+5*cpt).every(r=>r[1]===2)).toBe(true);   // at rest, then the step of the signal
  expect(Math.abs(rows[0]![2]!)).toBeLessThan(0.05);expect(rows.at(-1)![2]).toBeCloseTo(2,2);
  const r=importer(x);
  expect(r.status,r.stderr).toBe(0);
  expect(r.dataset).toMatchObject({sourceKind:'synthetic',clockMapping:{domain:'wall',offsetNs:0}});
  expect(r.dataset!.trials.map(t=>t.trialId)).toEqual(s.trials.map(t=>t.trialId));
 },120_000);
 it('data from the simulated bus can never be exported as measured: SYNTHETIC_CANNOT_BE_MEASURED',()=>{
  expect(()=>exportCalibration(part(),{sourceKind:'measured',configDigest:DIGEST})).toThrow(expect.objectContaining({code:'SYNTHETIC_CANNOT_BE_MEASURED'}));
 });
 it('a measured export (a real bus) carries the attestation of the session and no generator; the importer refuses a measured sidecar without attestation',()=>{
  const {digest:_,simSlave:__,...k}=structuredClone(KIT);void _;void __;
  const real=sealBench<BenchKitV1>({...k,bus:{...k.bus,backend:'soem',interface:'enp3s0'}} as Omit<BenchKitV1,'digest'>);
  const x=exportCalibration(part(real),{sourceKind:'measured',configDigest:real.digest});
  expect(x.sidecar.generator).toBeUndefined();
  expect(x.sidecar.attestation).toEqual({operator:'Lan',instrument:`${real.id}/marker-1`,recordedAt:'2026-11-27T09:00:00Z'});
  expect(importer(x).status).toBe(0);
  // the importer's own rule, on a sidecar built by hand: measured without attestation is refused
  const {attestation:___,...bare}=x.sidecar as CalibrationSidecar;void ___;
  const r=importer({sidecar:bare,files:x.files});
  expect(r.status).toBe(1);expect(r.stderr).toContain('ATTESTATION_REQUIRED');
 },120_000);
 it('a part without a KMS01 trace, or with axes that never enabled, has nothing to export',()=>{
  expect(()=>exportCalibration({...part(),results:[]},{sourceKind:'synthetic',configDigest:DIGEST})).toThrow(expect.objectContaining({code:'NO_CALIBRATION_TRIALS'}));
  const off={...structuredClone(trace),ticks:trace.ticks.map(t=>({...t,feedback:t.feedback.map(f=>({...f,state:'disabled' as const}))}))};
  expect(()=>exportCalibration({...part(),results:[{caseId:'KMS01',trace:off}]},{sourceKind:'synthetic',configDigest:DIGEST})).toThrow(expect.objectContaining({code:'NO_CALIBRATION_TRIALS'}));
 });
});
