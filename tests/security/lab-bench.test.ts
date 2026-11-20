// V06c: a bench run goes through the same session, CSRF, writer and admission gates as every run, and its request is checked before any directory, slot or engine. Engine-free: the runtime's
// worker interpreter does not exist, so anything that tried to start a plant would fail; every refusal here happens before that, and the one run created is never started.
import {afterAll,beforeAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {benchReadiness,createBenchRun} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {sealDriveDocument,type ControlProfileV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {activeRunCount} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {MUJOCO_SLOT,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {mujocoRoot,mujocoTemp,removeMujocoDirs,xarmProject} from '../support/mujoco-arm';
import {restaurant} from '../support/lab-v2';

const runtime:MujocoRuntimeOptions={python:'/nonexistent/python3.11',workerRoot:mujocoRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:'0'.repeat(64),engineVersion:'3.17.0'};
const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true,reason:undefined}:b)};
const doc=<T,>(name:string)=>JSON.parse(readFileSync(join(mujocoRoot,'fixtures/drive-v1',name),'utf8')) as T;
const identity={sourceCommit:'test-commit',schemaHash:'a'.repeat(64)},SET='engineering-mujoco-bench-v1';
const arm=(o:object={})=>({schemaVersion:1,scenarioId:'MJ-BENCH-ARM',axis:'J3',signal:{kind:'step',amplitude:0.1,atTick:10},driveExperimentId:'drive-nominal-v1',controlProfile:doc<ControlProfileV1>('xarm6-control-v1.json'),...o});
const wheel=(o:object={})=>({schemaVersion:1,scenarioId:'MJ-BENCH-WHEEL',axis:'wheels',signal:{kind:'step',amplitude:2,atTick:10},driveExperimentId:'drive-nominal-v1',controlProfile:doc<ControlProfileV1>('serve-control-v1.json'),...o});
/** F6: INVALID_BENCH_REQUEST carries the issues INVALID_RUN_REQUEST carries, element for element */
const refusal=(codes:string[])=>({error:'INVALID_BENCH_REQUEST',reasonCodes:codes,issues:codes.map(code=>({path:'/bench',code,message:'Invalid bench request'}))});
const runRequest=(bench:unknown,o:object={})=>({scenarioId:(bench as {scenarioId?:string})?.scenarioId??'MJ-BENCH-ARM',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:SET,runtimeIdentity:identity,bench,...o});

let g:LabGateway,directory:string,factoryCalls=0;
beforeAll(async()=>{
 directory=await mujocoTemp('lab-bench-sec-');
 g=await startLabGateway({port:0,directory,...identity,v2:{catalog,enabledBackends:['mujoco_arm','mujoco_3d','mock_amr'],portableChecks:benchReadiness(runtime),
  simulationFactory:(input,providers)=>{factoryCalls++;return createBenchRun(input,{...providers,runtime});}}});
});
afterAll(async()=>{await g.close();await removeMujocoDirs();});
async function session(){
 const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});
 const body=await r.json() as {csrfToken:string;sessionId:string};
 const h={cookie:r.headers.get('set-cookie')!.split(';')[0]!,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':body.csrfToken};
 return {sessionId:body.sessionId,call:async(path:string,body?:unknown,headers:Record<string,string>=h)=>{const x=await fetch(g.url+'/lab/v2'+path,{method:body===undefined?'GET':'POST',headers,...body!==undefined?{body:JSON.stringify(body)}:{}});return {status:x.status,body:await x.json() as {error?:string;reasonCodes?:string[];issues?:unknown[];run?:{id:string;runRevision:number};writer?:unknown}};},h};
}
const runDirs=async()=>(await readdir(directory)).filter(n=>/^[0-9a-f-]{36}$/.test(n));

test('bench on a run that is not a bench, a bench scenario without bench or off its set, and a bench with a project are 422 BENCH_SCOPE_INVALID',async()=>{
 const {call}=await session();
 for(const body of [
  {scenarioId:'MJ-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:identity,project:xarmProject(),bench:arm()},
  runRequest(undefined),
  runRequest(arm(),{backendSetId:'engineering-mujoco-arm-v1'}),
  runRequest(arm(),{project:xarmProject()}),
  runRequest(arm(),{driveExperimentId:'drive-nominal-v1'}),
  runRequest(arm(),{scenarioId:'MJ-BENCH-WHEEL'}),
 ])expect(await call('/runs',body),JSON.stringify(body).slice(0,120)).toMatchObject({status:422,body:{error:'INVALID_RUN_REQUEST',reasonCodes:['BENCH_SCOPE_INVALID']}});
 expect(factoryCalls).toBe(0);
});
test('an unknown field in bench, in its signal or in the draft profile is 422',async()=>{
 const {call}=await session();
 for(const bench of [arm({extra:1}),arm({signal:{kind:'step',amplitude:0.1,atTick:10,kp:1}}),arm({controlProfile:{...doc<object>('xarm6-control-v1.json'),gcode:'G0'}})])
  expect(await call('/runs',runRequest(bench))).toMatchObject({status:422,body:{error:'INVALID_RUN_REQUEST',reasonCodes:['UNKNOWN_FIELD']}});
 expect(factoryCalls).toBe(0);
});
test('a signal past 500 ticks is refused with one code: TICK_OUT_OF_RANGE',async()=>{
 const {call}=await session();
 for(const signal of [{kind:'hold',ticks:501},{kind:'step',amplitude:0.1,atTick:501},{kind:'step',amplitude:0.1,atTick:500},{kind:'trapezoid',distance:0.1,peakVelocity:0.5,acceleration:2,atTick:501}])
  expect(await call('/runs',runRequest(arm({signal})))).toEqual({status:422,body:{error:'INVALID_RUN_REQUEST',reasonCodes:['TICK_OUT_OF_RANGE'],issues:[{path:'/bench',code:'TICK_OUT_OF_RANGE',message:'Invalid bench request'}]}});
 expect(factoryCalls).toBe(0);
});
test('a draft sealed for another plant is 422 DRIVE_PLANT_MISMATCH, never re-sealed; envelope, amplitude and joint limits are checked against the server plant before any run exists',async()=>{
 const {call}=await session(),before=await runDirs(),calls=factoryCalls;
 const other=sealDriveDocument({...doc<ControlProfileV1>('xarm6-control-v1.json'),plantModelDigest:'c'.repeat(64)});
 const hot=structuredClone(doc<ControlProfileV1>('xarm6-control-v1.json'));hot.axes.find(a=>a.axisId==='xarm-1/J3')!.loop.kp=20000;
 const cases:[unknown,string[]][]=[
  [arm({controlProfile:other}),['DRIVE_PLANT_MISMATCH']],
  [wheel({controlProfile:sealDriveDocument({...doc<ControlProfileV1>('serve-control-v1.json'),plantModelDigest:'c'.repeat(64)})}),['DRIVE_PLANT_MISMATCH']],
  [arm({controlProfile:sealDriveDocument(hot)}),['GAIN_OUT_OF_ENVELOPE']],
  [arm({signal:{kind:'step',amplitude:0.3,atTick:10}}),['AMPLITUDE_NOT_REGISTERED']],
  [arm({axis:'gripper',signal:{kind:'step',amplitude:-0.1,atTick:10}}),['JOINT_LIMIT_EXCEEDED']],   // the gripper rests open at 0 rad, the bottom of its 0..0.85 rad range
  [wheel({signal:{kind:'step',amplitude:0.1,atTick:10}}),['AMPLITUDE_NOT_REGISTERED']],
 ];
 for(const [bench,codes] of cases)expect(await call('/runs',runRequest(bench))).toEqual({status:422,body:refusal(codes)});
 expect(factoryCalls-calls).toBe(cases.length);expect(await runDirs()).toEqual(before);expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
});
test('a signal must end inside the bench after the drive\'s enable sequence: the last tick that fits is admitted, one more is 422 TICK_OUT_OF_RANGE, before any run exists',async()=>{
 const {call}=await session();
 // the nominal drive's 25-substep enable sequence puts signal tick 0 on engine tick 4, so a step at 496 lands on tick 500; the ideal drive boots enabled (signal tick 0 on tick 1)
 // the same code under INVALID_RUN_REQUEST (the schema's atTick bound, test above) carries the same issue element
 const refused=async(bench:unknown)=>{const before=await runDirs();expect(await call('/runs',runRequest(bench))).toEqual({status:422,body:refusal(['TICK_OUT_OF_RANGE'])});expect(await runDirs()).toEqual(before);};
 await refused(arm({signal:{kind:'step',amplitude:0.1,atTick:497}}));
 await refused(wheel({signal:{kind:'hold',ticks:498}}));
 await refused(wheel({driveExperimentId:'drive-ideal-v1',signal:{kind:'trapezoid',distance:5,peakVelocity:2,acceleration:10,atTick:365}}));   // 135 ticks of motion: ends on tick 1+365+135 = 501
 for(const bench of [arm({signal:{kind:'step',amplitude:0.1,atTick:496}}),wheel({signal:{kind:'hold',ticks:497}}),wheel({driveExperimentId:'drive-ideal-v1',signal:{kind:'trapezoid',distance:5,peakVelocity:2,acceleration:10,atTick:364}})])
  expect((await call('/runs',runRequest(bench))).status).toBe(201);
 expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
});
test('another session cannot see or drive a bench run, a reader cannot drive it, and a write needs the CSRF token',async()=>{
 const a=await session(),b=await session();
 const created=await a.call('/runs',runRequest(arm()));expect(created.status,JSON.stringify(created.body)).toBe(201);
 const id=created.body.run!.id,start={actionId:'start',expectedRevision:0,kind:'start',payload:{}};
 expect(await b.call(`/runs/${id}/actions`,start)).toMatchObject({status:404,body:{error:'RUN_NOT_FOUND'}});
 expect(await b.call(`/runs/${id}/report`)).toMatchObject({status:404,body:{error:'RUN_NOT_FOUND'}});
 expect(await b.call(`/runs/${id}`)).toMatchObject({status:404,body:{error:'RUN_NOT_FOUND'}});
 const {['x-csrf-token']:_,...noCsrf}=a.h;void _;
 expect(await a.call(`/runs/${id}/actions`,start,noCsrf)).toMatchObject({status:403,body:{error:'CSRF_INVALID'}});
 expect(await a.call(`/runs/${id}/writer`,{operation:'grant_read',recipientSessionId:b.sessionId,controlEpoch:0})).toMatchObject({status:200});
 expect(await b.call(`/runs/${id}/actions`,start)).toMatchObject({status:409,body:{error:'RUN_WRITER_CONFLICT'}});
 expect((await b.call(`/runs/${id}`)).status).toBe(200);
 const report=await b.call(`/runs/${id}/report`);expect(report.status).toBe(200);expect((report.body as {tuning:unknown}).tuning).toBeNull();   // not run: no result
 expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
});
test('a reverse wheel signal is refused before any run exists: WHEEL_REVERSE_UNSUPPORTED (a negative peak is the schema\'s own refusal); a joint keeps both signs',async()=>{
 const {call}=await session(),before=await runDirs(),calls=factoryCalls;
 for(const signal of [{kind:'step',amplitude:-2,atTick:10},{kind:'step',amplitude:-5,atTick:10},{kind:'trapezoid',distance:-5,peakVelocity:2,acceleration:10,atTick:10}])
  expect(await call('/runs',runRequest(wheel({signal})))).toEqual({status:422,body:refusal(['WHEEL_REVERSE_UNSUPPORTED'])});
 expect(await call('/runs',runRequest(wheel({signal:{kind:'trapezoid',distance:5,peakVelocity:-2,acceleration:10,atTick:10}})))).toMatchObject({status:422,body:{error:'INVALID_RUN_REQUEST'}});
 expect(factoryCalls-calls).toBe(3);expect(await runDirs()).toEqual(before);expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
 expect((await call('/runs',runRequest(arm({signal:{kind:'step',amplitude:-0.1,atTick:10}})))).status).toBe(201);
});
test('the recorded trace (GET /runs/:id/trace) is behind the report\'s gate: owner and readers only, a session required, unknown run 404, GET only; a mission run has none (409 TRACE_UNSUPPORTED)',async()=>{
 const a=await session(),b=await session();
 const created=await a.call('/runs',runRequest(arm()));expect(created.status,JSON.stringify(created.body)).toBe(201);
 const id=created.body.run!.id;
 expect(await b.call(`/runs/${id}/trace`)).toMatchObject({status:404,body:{error:'RUN_NOT_FOUND'}});
 expect((await fetch(`${g.url}/lab/v2/runs/${id}/trace`)).status).toBe(401);
 expect(await a.call(`/runs/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/trace`)).toMatchObject({status:404,body:{error:'RUN_NOT_FOUND'}});
 expect(await a.call(`/runs/${id}/trace`,{})).toMatchObject({status:405,body:{error:'METHOD_NOT_ALLOWED'}});
 // never started: the durable trace holds nothing yet and says so (the verified read, never memory)
 expect(await a.call(`/runs/${id}/trace`)).toEqual({status:200,body:{traces:[{axisId:'xarm-1/J3',dtS:0.002,samples:Array(10).fill(null)}],issues:['TRACE_TAIL_MISSING']}});
 expect((await a.call(`/runs/${id}/writer`,{operation:'grant_read',recipientSessionId:b.sessionId,controlEpoch:0})).status).toBe(200);
 expect((await b.call(`/runs/${id}/trace`)).status).toBe(200);
 const mission=await a.call('/runs',{project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-amr',access:'simulated',runtimeIdentity:identity});expect(mission.status,JSON.stringify(mission.body)).toBe(201);
 expect(await a.call(`/runs/${mission.body.run!.id}/trace`)).toMatchObject({status:409,body:{error:'TRACE_UNSUPPORTED'}});
 expect(activeRunCount(MUJOCO_SLOT)).toBe(0);
});
