// PID01-03 (G-ALG2): pid-v1 against the independent Python reference. The plant is the Serve drive, derived from the exported fixture:
//   gain = omega_max / tau_max,  tau = J / b,  b = tau_max / omega_max,  J = (robot mass / 2) * wheelRadius^2   (one wheel's share of the mass, reflected to the wheel)
// Every number is an `assumed` fixture value, so the result says nothing about the real drive. pid-v1 is not used by any plant yet (design D09).
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareEngineeringCompileInput,resolveAssembly} from '../../engineering/assembly';
import {projectPhysicalModel} from '../../engineering/physical-model';
import {pidInit,pidStep,type PidConfig} from '../control/pid';
import {hashJson} from '../hash';
import {NAVIGATION_SCHEMA_HASH,type AlgorithmResultV1} from '../navigation2d/contracts';
import {actorStream} from '../random';
import {REPO_ROOT,type AlgorithmChecker,type OracleProfileV1} from './checker';
import {collectResults,fin,type Call,type Outcome} from './results';

export interface ServePlant {gain:number;tauS:number;outLimit:number;massKg:number;wheelRadiusM:number}
export function servePlant(root=REPO_ROOT):ServePlant{
 const dir=join(root,'robotics/navigation-2d/fixtures/serve-demo-v1'),read=(f:string)=>JSON.parse(readFileSync(join(dir,f),'utf8')) as Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
 const project=read('serve-project.json'),catalog=read('serve-components.json'),{resolved,problems}=resolveAssembly(project as never,catalog.components,{models:catalog.models});
 if(!resolved)throw new Error(`SERVE_FIXTURE_UNRESOLVED: ${problems.map(p=>p.code).join(', ')}`);
 const input=prepareEngineeringCompileInput(project as never,resolved,[]),robotId=input.project.runtimeProject.entities.map(e=>e.id).sort()[0]!,model=projectPhysicalModel(input,robotId,NAVIGATION_SCHEMA_HASH);
 const actuator=Object.values(catalog.models).find((m:any)=>m.kind==='actuator') as {torqueSpeedTable:{speed:{value:number};torque:{value:number}}[]}|undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
 if(!actuator||!model.drive)throw new Error('SERVE_FIXTURE_NO_DRIVE');
 const table=actuator.torqueSpeedTable,tauMax=table[0]!.torque.value,wMax=table.at(-1)!.speed.value,r=model.drive.wheelRadiusM.value,mass=model.links.reduce((s,l)=>s+l.massKg.value,0);
 const b=tauMax/wMax,J=mass/2*r*r;
 return {gain:wMax/tauMax,tauS:J/b,outLimit:tauMax,massKg:mass,wheelRadiusM:r};
}

interface Loop {gain:number;tauS:number;delaySteps:number}
interface Trace {y:number[];u:number[];integral:number[]}
/** The exact ZOH first-order plant with a pure delay, driven by pid-v1. The controller sees y[k]+noise[k]. */
function simulate(c:PidConfig,pl:Loop,r:number[],d:number[],noise:number[]):Trace&{clamped:number}{
 const a=Math.exp(-c.dtS/pl.tauS),queue=Array<number>(pl.delaySteps).fill(0),out:Trace&{clamped:number}={y:[],u:[],integral:[],clamped:0};
 let y=0,s=pidInit();
 r.forEach((sp,k)=>{
  const step=pidStep(c,s,sp,y+noise[k]!);
  if(step.saturated&&step.state.integral===s.integral)out.clamped++;
  s=step.state;out.y.push(y);out.u.push(step.u);out.integral.push(s.integral);
  queue.push(step.u);y=a*y+(1-a)*pl.gain*queue.shift()!+d[k]!;
 });
 return out;
}
const maxDiff=(a:readonly number[],b:readonly number[])=>a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i]!)),0);
/** Last index where |y-r| leaves the band; the loop has settled one sample later. */
const settle=(y:number[],r:number[],from:number,band:number)=>{let last=from-1;for(let k=from;k<y.length;k++)if(Math.abs(y[k]!-r[k]!)>band)last=k;return last+1-from;};
const overshoot=(y:number[],target:number)=>Math.max(0,(Math.max(...y)-target)/Math.abs(target));
interface Reply {y:number[];u:number[];integral:number[];linear:number[]|null}
const ask=(call:Call,c:PidConfig,pl:Loop,r:number[],d:number[],noise:number[])=>call<Reply>('pid_response',{config:c,plant:pl,setpoint:r,disturbance:d,noise});
const DT=0.02,filterHz=10;
const cfg=(over:Partial<PidConfig>,limit:number):PidConfig=>({kp:1,ki:0,kd:0,dtS:DT,derivativeFilterHz:filterHz,outMin:-limit,outMax:limit,...over});

async function pid01(call:Call,plant:ServePlant,p:OracleProfileV1):Promise<Outcome>{
 const N=300,r=Array<number>(N).fill(1),zero=Array<number>(N).fill(0),pl:Loop={gain:plant.gain,tauS:plant.tauS,delaySteps:0},reasons:string[]=[];
 const metrics:Record<string,number|null>={maxSampleError:0,maxLinearError:0,overshootDelta:0,settlingTimeDeltaS:0,overshootPi:0};
 for(const [name,over] of [['P',{kp:2}],['PI',{kp:1.2,ki:3}],['PID',{kp:1.5,ki:2,kd:0.05}]] as const){
  const c=cfg(over,1e6),ts=simulate(c,pl,r,zero,zero),py=await ask(call,c,pl,r,zero,zero);
  const e=Math.max(maxDiff(ts.y,py.y),maxDiff(ts.u,py.u),maxDiff(ts.integral,py.integral));
  metrics.maxSampleError=Math.max(metrics.maxSampleError!,e);
  if(!(e<=p.pid.sample))reasons.push(`${name}: pid-v1 and the reference differ by ${e}`);
  if(name!=='PID'){
   if(!py.linear)reasons.push(`${name}: the reference gave no linear solution for an unsaturated loop`);
   else{const l=Math.max(maxDiff(py.y,py.linear),maxDiff(ts.y,py.linear));metrics.maxLinearError=Math.max(metrics.maxLinearError!,l);if(!(l<=p.pid.sample))reasons.push(`${name}: the loop differs from the linear solution by ${l}`);}
  }
  const tsOs=overshoot(ts.y,1),pyOs=overshoot(py.y,1),tsSet=settle(ts.y,r,0,0.02)*DT,pySet=settle(py.y,r,0,0.02)*DT;
  metrics.overshootDelta=Math.max(metrics.overshootDelta!,Math.abs(tsOs-pyOs));metrics.settlingTimeDeltaS=Math.max(metrics.settlingTimeDeltaS!,Math.abs(tsSet-pySet));
  if(name==='PI')metrics.overshootPi=tsOs;
 }
 return {pass:reasons.length===0,metrics,reasons};
}

async function pid02(call:Call,plant:ServePlant,p:OracleProfileV1):Promise<Outcome>{
 const N=400,drop=150,r=Array.from({length:N},(_,k)=>k<drop?10:0.5),zero=Array<number>(N).fill(0),pl:Loop={gain:plant.gain,tauS:plant.tauS,delaySteps:0},c=cfg({kp:2,ki:6},plant.outLimit),reasons:string[]=[];
 const ts=simulate(c,pl,r,zero,zero),py=await ask(call,c,pl,r,zero,zero),e=Math.max(maxDiff(ts.y,py.y),maxDiff(ts.u,py.u),maxDiff(ts.integral,py.integral));
 const maxAbsU=Math.max(...ts.u.map(Math.abs),...py.u.map(Math.abs)),tsRec=settle(ts.y,r,drop,0.05)*DT,pyRec=settle(py.y,r,drop,0.05)*DT;
 if(!(e<=p.pid.sample))reasons.push(`pid-v1 and the reference differ by ${e} (first at sample ${ts.y.findIndex((v,k)=>Math.abs(v-py.y[k]!)>p.pid.sample||Math.abs(ts.integral[k]!-py.integral[k]!)>p.pid.sample)})`);
 if(!(maxAbsU<=plant.outLimit))reasons.push(`output left the limit: ${maxAbsU} > ${plant.outLimit}`);
 if(!(ts.clamped>0))reasons.push('the integral was never clamped: the case did not saturate');
 if(!(Math.abs(tsRec-pyRec)<=p.pid.sample))reasons.push(`recovery time differs: ${tsRec} s vs ${pyRec} s`);
 return {pass:reasons.length===0,metrics:{maxAbsU,maxSampleError:e,integralClampedSteps:ts.clamped,recoveryTimeS:tsRec,recoveryTimeDeltaS:Math.abs(tsRec-pyRec)},reasons};
}

async function pid03(call:Call,plant:ServePlant,p:OracleProfileV1,seed:number):Promise<Outcome>{
 const N=400,rnd=actorStream(seed,'pid03-noise').next,gauss=()=>Math.sqrt(-2*Math.log(1-rnd()))*Math.cos(2*Math.PI*rnd());
 const r=Array.from({length:N},(_,k)=>k<20?0:1),noise=Array.from({length:N},()=>0.01*gauss()),load=Array.from({length:N},(_,k)=>k<200?0:0.005);
 const pl:Loop={gain:plant.gain,tauS:plant.tauS,delaySteps:3},c=cfg({kp:1,ki:2,kd:0.02},plant.outLimit),ts=simulate(c,pl,r,load,noise),py=await ask(call,c,pl,r,load,noise);
 const e=Math.max(maxDiff(ts.y,py.y),maxDiff(ts.u,py.u),maxDiff(ts.integral,py.integral)),reasons:string[]=[];
 if(!(e<=p.pid.sample))reasons.push(`pid-v1 and the reference differ by ${e}`);
 if(!ts.y.every(fin))reasons.push('the trace is not finite');
 return {pass:reasons.length===0,metrics:{maxSampleError:e,noiseStddev:0.01,delaySteps:3},reasons};
}

/** Runs PID01, PID02 and PID03 against `plant` (default: the Serve drive from the exported fixture). */
export async function runPidCases(checker:AlgorithmChecker,profile:OracleProfileV1,seed:number,plant=servePlant()):Promise<AlgorithmResultV1[]>{
 return collectResults({checker,checkerId:'pid_reference',profile,seed,inputs:{plant:hashJson(plant)},cases:[
  ['PID01',c=>pid01(c,plant,profile)],['PID02',c=>pid02(c,plant,profile)],['PID03',c=>pid03(c,plant,profile,seed)]]});
}
