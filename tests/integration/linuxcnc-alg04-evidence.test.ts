import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createAlgorithmChecker,REPO_ROOT,type AlgorithmChecker} from '../../packages/lab-runtime/src/v2/algorithm/checker';
const api=async()=>import('../../packages/lab-runtime/src/v2/algorithm/linuxcnc-trace');
const sha=(p:string)=>createHash('sha256').update(readFileSync(join(REPO_ROOT,p))).digest('hex');
const base='integrations/arm-controller/';
function fixture(){
 const side=(id:string,deg:number[])=>({sampleId:id,rawDeg:deg,rad:deg.map(x=>x*Math.PI/180)});
 return {schemaVersion:1,kind:'linuxcnc_actual_joint_trace',backend:'linuxcnc_sim',provenance:'controller_sim',evidenceKind:'protocol_double',
 sourceCommit:'a'.repeat(40),controller:{version:'protocol-double',identityMethod:'linux-proc-boot-id-pid-starttime'},
 model:{id:'puma560-reference',manifestSha256:sha(base+'models/puma560-reference/manifest.json'),dhSha256:sha(base+'models/puma560-reference/modified-dh.json'),framesSha256:sha(base+'models/puma560-reference/frames.json'),profileSha256:sha(base+'configs/sim/puma560/profile.json'),baseFrame:'arm_base',tcpFrame:'tcp',toolRevision:'tool-0-notool'},
 units:{rawJoint:'deg',joint:'rad',receiveTime:'ns'},clock:{receive:'host_monotonic',controller:'unavailable'},
 samples:[0,1].map(i=>({sequence:i,epoch:'boot:task:1',receiveMonotonicNs:[String(100+i*100),String(110+i*100)],controllerTime:null,synchrony:'unavailable',actual:side(`a${i}`,[0,0,0,0,0,0]),commanded:side(`c${i}`,[1,0,0,0,0,0])}))};
}
describe('ALG04 independent LinuxCNC actual-joint input',()=>{
 it('provides a strict trace consumer',async()=>{expect((await api()).validateLinuxcncTrace).toBeTypeOf('function');});
 it.each([
  ['mock',(t:ReturnType<typeof fixture>)=>{t.backend='mock';}],
  ['xarm',(t:ReturnType<typeof fixture>)=>{t.model.id='xarm6';}],
  ['degrees-as-radians',(t:ReturnType<typeof fixture>)=>{t.samples[0]!.actual.rad=[90,0,0,0,0,0];}],
  ['wrong DH',(t:ReturnType<typeof fixture>)=>{t.model.dhSha256='0'.repeat(64);}],
  ['wrong frame',(t:ReturnType<typeof fixture>)=>{t.model.baseFrame='world';}],
  ['wrong hash',(t:ReturnType<typeof fixture>)=>{t.model.manifestSha256='0'.repeat(64);}],
  ['empty actual',(t:ReturnType<typeof fixture>)=>{t.samples=[];}],
  ['missing timing',(t:ReturnType<typeof fixture>)=>{t.samples[0]!.receiveMonotonicNs=[];}],
  ['synthetic controller clock',(t:ReturnType<typeof fixture>)=>{t.clock.controller='cycle_time';}],
  ['identical sample IDs',(t:ReturnType<typeof fixture>)=>{t.samples[0]!.actual.sampleId='c0';}],
  ['reversed receipt bracket',(t:ReturnType<typeof fixture>)=>{t.samples[0]!.receiveMonotonicNs=['110','100'];}],
 ])('rejects %s before calling the oracle',async(_name,mutate)=>{
  const f=(await api()).validateLinuxcncTrace;expect(f).toBeTypeOf('function');const t=fixture();mutate(t);expect(()=>f(t)).toThrow();
 });
 it('splits controller epochs without joining trajectory coverage',async()=>{
  const f=(await api()).validateLinuxcncTrace;expect(f).toBeTypeOf('function');const t=fixture();t.samples[1]!.epoch='boot:task:2';
  expect(f(t).segments).toEqual([{epoch:'boot:task:1',from:0,to:0},{epoch:'boot:task:2',from:1,to:1}]);
 });
 it('checks actual poses with RTB, separates raw following delta, and leaves native timing not_run',async()=>{
  const run=(await api()).runLinuxcncAlg04;expect(run).toBeTypeOf('function');
  const real=createAlgorithmChecker({python:join(REPO_ROOT,'.venv-algorithm/bin/python'),root:join(REPO_ROOT,'robotics/algorithm')});
  let oracleInput:unknown;const checker:AlgorithmChecker={call:(op,payload)=>{oracleInput=(payload as {q:unknown}).q;return real.call(op,payload);}};
  const report=await run(checker,fixture());
  expect(oracleInput).toEqual([[0,0,0,0,0,0],[0,0,0,0,0,0]]);
  expect(report.result.caseId).toBe('ALG04');expect(report.result.verdict).toBe('not_run');
  expect(report.result.metrics.maxObservedCommandActualDeltaRad).toBeCloseTo(Math.PI/180,12);
  expect(report.result.metrics.maxFkTranslationResidualM).toBeLessThan(1e-6);
  expect(report.result.reasons).toContain('CONTROLLER_SAMPLE_TIME_UNAVAILABLE');
  expect(report.coverage.interpolatedSamples).toBe(0);
  expect(report.controllerCartesianResidual.status).toBe('not_run');
 });
});

it('public CLI consumes retained trace bytes and preserves source/checker separation',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'l04-cli-'));try{
  const trace=join(tmp,'trace.json'),out=join(tmp,'out');writeFileSync(trace,JSON.stringify(fixture()));
  const r=spawnSync(process.execPath,['scripts/lab-algorithm.mjs','linuxcnc','--trace',trace,'--out',out],{cwd:REPO_ROOT,encoding:'utf8',timeout:30_000});
  expect(r.status,r.stderr).toBe(2);
  expect(existsSync(join(out,'algorithm-results.json')),'retained trace report missing').toBe(true);
  const report=JSON.parse(readFileSync(join(out,'algorithm-results.json'),'utf8'));
  expect(report.results[0].caseId).toBe('ALG04');expect(report.results[0].verdict).toBe('not_run');
  expect(report.inputSha256).toBe(createHash('sha256').update(readFileSync(trace)).digest('hex'));
  expect(report.subjectSourceCommit).toBe('a'.repeat(40));expect(report.checker.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(report.accepted).toBe(false);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});

it('a numerical FK failure stays fail despite unavailable native timing',async()=>{
 const {runLinuxcncAlg04}=await api();
 const real=createAlgorithmChecker({python:join(REPO_ROOT,'.venv-algorithm/bin/python'),root:join(REPO_ROOT,'robotics/algorithm')});
 const skewed:AlgorithmChecker={call:(op,payload)=>{const p=structuredClone(payload) as {dh:{a:number}[]};p.dh[2]!.a+=0.01;return real.call(op,p);}};
 const report=await runLinuxcncAlg04(skewed,fixture());
 expect(report.result.verdict).toBe('fail');expect(report.numericVerdict).toBe('fail');
 expect(report.result.metrics.maxFkTranslationResidualM).toBeGreaterThan(0.009);
 expect(report.result.reasons).toContain('ACTUAL_INPUT_FK_NUMERIC_RESIDUAL_EXCEEDED');
 expect(report.result.reasons).toContain('CONTROLLER_SAMPLE_TIME_UNAVAILABLE');
});
