// K06 (KSW07): LD19 and WitMotion byte streams replayed by the real sensors worker on the simulated bus, LidarScanV1 conversion, the sensor cases KSN01/03/04/05,
// their evidence streams and the record round trip. Python decoders: tests/hardware/test_bench_sensors.py.
import {chmodSync,cpSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import component from '../../packages/contracts/schemas/engineering-component.schema.json';
import irsim from '../../packages/contracts/schemas/irsim-worker-v1.schema.json';
import {sealBench,type BenchKitV1,type BenchPolicy,type BenchSessionV1} from '../../packages/bench/src/contracts';
import {fakeClock} from '../../packages/bench/src/clock';
import {spawnBenchWorker,type BenchWorker} from '../../packages/bench/src/worker';
import {runCase,startBenchSession,type RunContext} from '../../packages/bench/src/session';
import {benchCase,SENSOR_CASES,toLidarScan,type BenchCase,type CaseTrace} from '../../packages/bench/src/cases/index';
import {readTrace} from '../../packages/bench/src/evidence';
import {assembleBenchRecord,sessionExtra,verifyBenchRecord,writeBenchPart,type PartKind} from '../../packages/bench/src/record';

const PY=process.env.BENCH_PYTHON??'python3';
const dir=mkdtempSync(join(tmpdir(),'bench-sensors-'));
const FIXTURES=fileURLToPath(new URL('../../robotics/bench/fixtures/',import.meta.url));
const fixture=<T>(f:string)=>JSON.parse(readFileSync(join(FIXTURES,f),'utf8')) as T;
const reseal=<T extends {digest:string}>(doc:T,edit:(d:T)=>void):T=>{const {digest:_,...k}=structuredClone(doc);void _;edit(k as T);return sealBench<T>(k as Omit<T,'digest'>);};
const POLICY=reseal(fixture<BenchPolicy>('policy-v1.json'),p=>{p.soakMinutes=0.1;});   // 300 ticks of 20 ms: six seconds
const sim=(extra:Record<string,unknown>={})=>reseal(fixture<BenchKitV1>('kit-sim-v1.json'),k=>{Object.assign(k.simSlave!,{sensorBytes:{lidar:'bytes/ld19-synth.bin',imu:'bytes/wit-synth.bin'}},extra);});
let n=0;
const workers:BenchWorker[]=[];
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.close()));});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

/** The kit is written beside a copy of fixtures/bytes so the relative paths of simSlave.sensorBytes are the ones under test. */
async function rig(extra:Record<string,unknown>={},o:{sensors?:boolean;sensorsPython?:string}={}){
 const kit=sim(extra),d=join(dir,`rig-${++n}`),kitPath=join(d,'kit.json');
 cpSync(join(FIXTURES,'bytes'),join(d,'bytes'),{recursive:true});writeFileSync(kitPath,JSON.stringify(kit));
 const spawn=async(role:'bus'|'sensors')=>{const w=await spawnBenchWorker({role,python:role==='sensors'?o.sensorsPython??PY:PY,kitPath,bus:'sim',readOnly:false,sessionId:`s${n}`,deadlinesMs:{step:5000}});workers.push(w);return w;};
 const bus=await spawn('bus'),sensors=o.sensors===false?undefined:await spawn('sensors');
 const describe=(await bus.request('describe',{},0)).result!,{scan}=await startBenchSession(bus);
 if(sensors){const a=await sensors.request('open',{},0);if(!a.ok)throw new Error(a.error!.code);}
 const ctx:RunContext={worker:bus,sensors,kit,policy:POLICY,clock:fakeClock(),arming:{arm:async()=>true},passed:new Set(),abort:new AbortController().signal};
 return {bus,sensors,kit,ctx,describe,scan};
}
const byId=(id:string)=>SENSOR_CASES.find(c=>c.id===id)!;
const ajv=new Ajv({strict:true});ajv.addSchema(component,'engineering-component.schema.json');ajv.addSchema(irsim);
const validScan=ajv.getSchema('mekoniq.irsim-worker.v1#/definitions/LidarScanV1')!;

const OPTS={sensorId:'bench/ld19',frameId:'bench/lidar-clockwise',tick:7,tMonoNs:140_000_000n,rangeMinM:0.03,rangeMaxM:12};
const frame=(startDeg:number,mm=1000)=>({speedDegS:3600,startDeg,endDeg:(startDeg+8.8)%360,sensorMs:0,points:Array.from({length:12},()=>[mm,200] as [number,number])});

describe('toLidarScan',()=>{
 const frames=Array.from({length:30},(_,k)=>frame(k*9.6%360));   // 288 degrees: the sample stream's first thirty frames
 it('30 sample frames give a schema-valid 360-cell scan; cells without a point are null and no_return',()=>{
  const s=toLidarScan(frames,OPTS);
  expect(validScan(s),JSON.stringify(validScan.errors)).toBe(true);
  expect(s.rangesM).toHaveLength(360);expect(s.states).toHaveLength(360);
  expect(s.angleIncrementRad).toBe(2*Math.PI/360);expect(s.angleMinRad).toBe(0);
  expect(s).toMatchObject({sensorId:'bench/ld19',frameId:'bench/lidar-clockwise',tick:7,simTimeNs:'140000000',rangeMinM:0.03,rangeMaxM:12});
  const hits=s.states.filter(x=>x==='hit').length;
  expect(hits).toBeGreaterThan(250);expect(hits).toBeLessThan(300);   // 288 degrees, a point every 0.8 degrees: about one cell in every 1.25
  expect(s.states.at(-1)).toBe('no_return');expect(s.rangesM.at(-1)).toBeNull();   // 359 degrees: nothing there
  expect(s.rangesM.filter((r,i)=>(r===null)!==(s.states[i]!=='hit'))).toEqual([]);
  expect(s.rangesM.find(r=>r!==null)).toBe(1);
 });
 it('a point below rangeMinM is below_min, one beyond rangeMaxM is no_return, a hit beats both in the same cell',()=>{
  const s=toLidarScan([frame(10,20)],OPTS),f=toLidarScan([frame(10,13000)],OPTS);
  expect(s.states[10]).toBe('below_min');expect(s.rangesM[10]).toBeNull();
  expect([f.states[10],f.rangesM[10]]).toEqual(['no_return',null]);
  const t=toLidarScan([frame(10,20),frame(10,13000),frame(10,2000),frame(10,1500)],OPTS);
  expect([t.states[10],t.rangesM[10]]).toEqual(['hit',1.5]);   // the nearest hit
 });
 it('a frame that crosses 360 degrees puts its points on both sides of the seam',()=>{
  const s=toLidarScan([frame(355)],OPTS);
  expect(s.states[355]).toBe('hit');expect(s.states[2]).toBe('hit');expect(s.states[100]).toBe('no_return');
 });
});

describe('sensor cases on the replayed sample streams',()=>{
 it('KSN01: scan rate, points per scan, no bad frames; the lidar stream holds raw frames and one LidarScanV1 per turn',async()=>{
  const {ctx,sensors}=await rig();
  const r=await runCase(byId('KSN01'),ctx);
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  const m=Object.fromEntries(r.verdict.measurements.map(x=>[x.id,x]));
  expect(m.scanRateHz!.value).toBeCloseTo(10,1);expect(m.pointsPerScan!.value).toBeCloseTo(450,3);expect(m.badFrameFraction!.value).toBe(0);
  expect(m.scanRateHz!.unit).toBe('Hz');expect(m.scanRateHz!.caseId).toBe('KSN01');
  const lidar=r.trace.lidar!,scans=lidar.filter(x=>'scan' in x);
  expect(lidar.length-scans.length).toBeGreaterThan(2000);   // raw frames: 7.5 a tick
  expect(scans.length).toBeGreaterThan(30);
  expect(r.trace.sensorDropped).toEqual({lidarBytes:0,imuBytes:0});
  expect(r.trace.imu!.length).toBe(600);                      // the IMU is stepped in the same ticks: two samples a tick
  expect(sensors!.tick).toBe(r.trace.ticks.length);
  // every tick of a sensor case asks for no torque
  expect(r.trace.ticks.every(t=>t.driveCommands.every(c=>!c.enable))).toBe(true);
 },60_000);
 it('KSN01 on a stream with 10 % damaged frames fails against the policy ceiling of 1 %',async()=>{
  const {ctx}=await rig({sensorCorruptEvery:10});
  const r=await runCase(byId('KSN01'),ctx);
  expect(POLICY.badFrameFractionMax).toBe(0.01);
  expect(r.verdict.status).toBe('failed');expect(r.verdict.reason).toMatch(/^BAD_FRAME_FRACTION 0\.\d/);
  expect(r.trace.sensorDropped!.lidarBytes).toBeGreaterThan(0);
 },60_000);
 it('KSN03: every stored scan is valid by the existing schema and is the one the raw frames give',async()=>{
  const {ctx}=await rig();
  const r=await runCase(byId('KSN03'),ctx);
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  const scans=r.trace.lidar!.flatMap(x=>'scan' in x?[x.scan]:[]);
  expect(scans.length).toBeGreaterThan(30);expect(scans.every(s=>validScan(s))).toBe(true);
  expect(r.verdict.measurements.find(x=>x.id==='scansValid')).toMatchObject({value:scans.length,unit:'scan'});
  // a scan edited after the run is still schema-valid, but it is no longer what the frames give
  const t=structuredClone(r.trace),row=t.lidar!.find(x=>'scan' in x)! as {scan:{rangesM:(number|null)[]}};
  row.scan.rangesM[0]=3.14;
  expect(byId('KSN03').evaluate(t,ctx.kit,POLICY)).toMatchObject({status:'failed',reason:'SCAN_NOT_FROM_FRAMES'});
 },60_000);
 it('KSN04: gyro bias and noise per axis and the yaw drift rate of a static IMU',async()=>{
  const {ctx}=await rig();
  const r=await runCase(byId('KSN04'),ctx);
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  const ids=r.verdict.measurements.map(x=>x.id);
  expect(ids).toEqual(['gyroBiasXRadS','gyroBiasYRadS','gyroBiasZRadS','gyroNoiseXRadS','gyroNoiseYRadS','gyroNoiseZRadS','yawDriftRadS']);
  for(const x of r.verdict.measurements){expect(Number.isFinite(x.value)).toBe(true);expect(x.n).toBe(600);expect(x.uncertaintyAbs).toBeGreaterThan(0);}
  const noise=r.verdict.measurements.filter(x=>x.id.startsWith('gyroNoise'));
  expect(noise.every(x=>x.value>0&&x.value<0.01)).toBe(true);   // a few counts of 2000/32768 deg/s
  expect(r.verdict.measurements.find(x=>x.id==='yawDriftRadS')!.value).toBeCloseTo(0,9);   // the sample stream's yaw is constant
 },60_000);
 it('KSN04: the yaw drift rate is the slope of yaw against host time, the bias the mean of the gyro',()=>{
  const imu=Array.from({length:600},(_,i)=>({tick:i>>1,tMonoNs:i*10_000_000,sensorTime:null,accelMps2:[0,0,9.8],gyroRadS:[0.01,-0.02,i%2?0.003:-0.003],rpyRad:[0,0,0.001*i*0.01]}));
  const v=byId('KSN04').evaluate({ticks:[],cycles:[],prompts:[],imu},sim(),POLICY),m=Object.fromEntries(v.measurements.map(x=>[x.id,x.value]));
  expect(v.status).toBe('tested');
  expect(m.yawDriftRadS).toBeCloseTo(0.001,9);expect(m.gyroBiasXRadS).toBeCloseTo(0.01,9);expect(m.gyroBiasYRadS).toBeCloseTo(-0.02,9);expect(m.gyroBiasZRadS).toBeCloseTo(0,9);
  expect(m.gyroNoiseXRadS).toBeCloseTo(0,9);expect(m.gyroNoiseZRadS).toBeCloseTo(0.003,3);
 });
 it('KSN05: IMU sample rate and the jitter of the rate second by second',async()=>{
  const {ctx}=await rig();
  const r=await runCase(byId('KSN05'),ctx);
  expect(r.verdict).toMatchObject({status:'tested',reason:null});
  const m=Object.fromEntries(r.verdict.measurements.map(x=>[x.id,x]));
  expect(m.imuSampleRateHz!.value).toBeCloseTo(100,0);expect(m.imuRateJitterHz!.value).toBeCloseTo(0,1);expect(m.imuBadFrameFraction!.value).toBe(0);
 },60_000);
 it('KSN05 with damaged IMU frames fails against the policy ceiling',async()=>{
  const {ctx}=await rig({sensorCorruptEvery:10});
  expect((await runCase(byId('KSN05'),ctx)).verdict).toMatchObject({status:'failed',reason:expect.stringMatching(/^BAD_FRAME_FRACTION/) as string});
 },60_000);
 it('the cases ask for no torque and no earlier case, and do not run without a sensors worker',async()=>{
  expect(SENSOR_CASES.map(c=>[c.id,c.needsTorque,c.requires,c.needsSensors])).toEqual(['KSN01','KSN03','KSN04','KSN05'].map(id=>[id,false,[],true]));
  expect(SENSOR_CASES.map(c=>benchCase(c.id))).toEqual(SENSOR_CASES);
  const {ctx,bus}=await rig({},{sensors:false});
  expect((await runCase(byId('KSN01'),ctx)).verdict).toEqual({status:'not_run',reason:'SENSORS_UNAVAILABLE',measurements:[]});
  expect(bus.tick).toBe(0);
 },30_000);
 it('a stream with no frames fails, it is not an empty pass',async()=>{
  const {ctx}=await rig({sensorBytes:{}});
  expect((await runCase(byId('KSN01'),ctx)).verdict).toMatchObject({status:'failed',reason:'NO_LIDAR_FRAMES'});
  expect((await runCase(byId('KSN04'),ctx)).verdict).toMatchObject({status:'failed',reason:'NO_IMU_SAMPLES'});
 },60_000);
});

describe('a sensors worker that is lost',()=>{
 it('ends a torque case abnormally: SENSOR_WORKER_LOST, quick stop, disarmed, and the bus worker still stops the axes',async()=>{
  const {ctx,sensors,kit}=await rig();
  const hold:BenchCase={id:'T',needsTorque:true,requires:[],evaluate:()=>({status:'tested',reason:null,measurements:[]}),
   script:()=>({ticks:40,commandsAt:k=>kit.axes.map(a=>({axisId:a.axisId,seq:k+1,mode:'csv' as const,target:1,enable:true,quickStop:false,faultReset:false}))})};
  let killed=false;
  const c2:RunContext={...ctx,onTick:t=>{if(t.tick===10&&!killed){killed=true;process.kill(sensors!.pid!,'SIGKILL');}}};
  const r=await runCase(hold,c2);
  expect(r.verdict).toEqual({status:'failed',reason:'SENSOR_WORKER_LOST',measurements:[]});
  expect(killed).toBe(true);expect(c2.disarmed).toBe(true);
  // the quick stop and the stop sequence ran on the bus worker alone: the last tick asks for nothing and every power stage is off
  expect(r.trace.ticks.some(t=>t.driveCommands.every(c=>c.quickStop))).toBe(true);
  expect(r.trace.ticks.at(-1)!.driveCommands.every(c=>!c.enable)).toBe(true);
  expect(r.trace.ticks.at(-1)!.vendor.every(v=>(v.statusword&0x02)===0)).toBe(true);
 },60_000);
});

describe('the sensors wire',()=>{
 it('a step result whose droppedBytes is not a count is WORKER_PROTOCOL and the worker is lost',async()=>{
  const wrapper=join(dir,'mangle.sh');   // the worker's stdout goes through a line filter that turns every droppedBytes:0 into -1
  writeFileSync(wrapper,`#!/bin/sh\n'${PY}' "$@" | '${PY}' -c 'import sys\nfor l in sys.stdin:\n print(l.rstrip().replace("\\"droppedBytes\\":0", "\\"droppedBytes\\":-1"), flush=True)'\n`);chmodSync(wrapper,0o755);
  const {sensors}=await rig({},{sensorsPython:wrapper});
  await expect(sensors!.request('step',{commands:[]},0)).rejects.toMatchObject({code:'WORKER_PROTOCOL',outcome:'unknown'});
  await expect(sensors!.request('step',{commands:[]},0)).rejects.toMatchObject({code:'WORKER_LOST',outcome:'not_sent'});
 },30_000);
 it('the sensors role refuses the bus ops and drive commands, and describes itself',async()=>{
  const {sensors}=await rig();
  expect((await sensors!.request('describe',{},0)).result).toMatchObject({role:'sensors',backend:'sim',sensors:{lidar:true,imu:true}});
  for(const op of ['scan','configure','start','silence'] as const)expect((await sensors!.request(op,{},0)).error?.code).toBe('BENCH_ORDER_VIOLATION');
  expect((await sensors!.request('imuConfigure',{baud:115200,rateHz:100,algorithm:'6axis'},0)).result).toEqual({baud:115200,rateHz:100,algorithm:'6axis'});
  const bad=await sensors!.request('step',{commands:[{axisId:'amr-1/wheel-left',seq:1,mode:'csv',target:1,enable:true,quickStop:false,faultReset:false}]},0);
  expect(bad.error?.code).toBe('BENCH_ORDER_VIOLATION');
  expect((await sensors!.request('stop',{},0)).ok).toBe(true);
  await sensors!.close();
  expect(sensors!.stderr.trim().split('\n').at(-1)).toBe('{"event": "stopped"}');
 },30_000);
});

describe('the record round trip (KSW06 with the sensors streams)',()=>{
 const SESSION:BenchSessionV1={schemaVersion:1,documentType:'bench-session',operator:'op',observer:null,location:'bench',startedAt:'2026-11-26T09:00:00Z',
  declarations:{estopCutsMotorPower:true,estopTestedToday:true,motorsClamped:true,shaftLoad:'bare',powerWiredBy:'An',mainsQualified:null,readManualSections:['3.2']},instruments:[]};
 const write=async(kind:PartKind,r:Awaited<ReturnType<typeof rig>>,results:{caseId:string;trace:CaseTrace;verdict:RunVerdict}[])=>{
  const d=join(dir,`part-${kind}-${++n}`);await writeBenchPart(d,kind,{session:SESSION,kit:r.kit,policy:POLICY,results,extra:sessionExtra(r.describe,r.scan)});return d;
 };
 type RunVerdict=Awaited<ReturnType<typeof runCase>>['verdict'];
 it('writes lidar and imu chunks through the one reader, assembles, reads back, and a flipped chunk byte is caught',async()=>{
  const a=await rig();
  const identity=await write('identity',a,[]);
  const b=await rig();
  const results=[];
  for(const c of SENSOR_CASES)results.push({caseId:c.id,...await runCase(c,b.ctx)});
  expect(results.map(x=>x.verdict.status)).toEqual(['tested','tested','tested','tested']);
  const sensors=await write('sensors',b,results);
  const files=readdirSync(join(sensors,'cases/KSN01')).sort();
  expect(files.filter(f=>/^lidar-000000-[0-9a-f]{8}\.ndjson\.gz$/.test(f))).toHaveLength(1);
  expect(files.some(f=>/^imu-000000-[0-9a-f]{8}\.ndjson\.gz$/.test(f))).toBe(true);
  const back=await readTrace(join(sensors,'cases/KSN01'));
  expect(back.lidar).toEqual(results[0]!.trace.lidar);expect(back.imu).toEqual(results[0]!.trace.imu);expect(back.sensorDropped).toEqual({lidarBytes:0,imuBytes:0});
  const out=join(dir,`record-${++n}`),record=await assembleBenchRecord({identity,sensors},out,{candidateId:'k06',sourceCommit:'abc1234'});
  expect(record.cases.KSN01).toMatchObject({status:'tested',session:'sensors'});
  expect(record.cases.KSN01!.artifacts.some(p=>p.includes('/lidar-'))).toBe(true);
  expect(record.measurements.map(x=>x.id)).toContain('scanRateHz');
  expect(await verifyBenchRecord(out)).toEqual({ok:true,issues:[]});
  // a flipped byte in a stored stream is a part manifest mismatch (the verdict itself is recomputed from these streams on readback, as for every case)
  const bad=join(dir,`tamper-${++n}`);cpSync(out,bad,{recursive:true});
  const chunk=readdirSync(join(bad,'sensors/cases/KSN04')).find(f=>f.startsWith('imu-'))!,p=join(bad,'sensors/cases/KSN04',chunk),buf=readFileSync(p);
  buf[buf.length>>1]^=0x01;writeFileSync(p,buf);
  const v=await verifyBenchRecord(bad);expect(v.ok).toBe(false);expect(v.issues.map(i=>i.code)).toContain('PART_MANIFEST_MISMATCH');
 },180_000);
});
