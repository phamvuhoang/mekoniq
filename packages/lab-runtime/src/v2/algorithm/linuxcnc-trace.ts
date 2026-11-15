// ALG04 consumes retained LinuxCNC actual joints; the oracle never supplies input samples.
// Poll brackets are receive times only. This v1 cannot qualify synchronized following error.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadArmModel} from '../arm/session';
import {forwardKinematics} from '../models/arm-kinematics';
import {hashJson} from '../hash';
import {REPO_ROOT,loadOracleProfile,type AlgorithmChecker} from './checker';
import {collectResults} from './results';
interface Side {sampleId:string;rawDeg:number[];rad:number[]}
interface Sample {sequence:number;epoch:string;receiveMonotonicNs:[string,string];controllerTime:null;synchrony:'unavailable';actual:Side;commanded:Side}
export interface LinuxcncTrace {schemaVersion:1;kind:'linuxcnc_actual_joint_trace';backend:'linuxcnc_sim';provenance:'controller_sim';evidenceKind:'native_capture'|'protocol_double';sourceCommit:string;
 controller:{version:string;identityMethod:'linux-proc-boot-id-pid-starttime'};
 model:{id:string;manifestSha256:string;dhSha256:string;framesSha256:string;profileSha256:string;baseFrame:string;tcpFrame:string;toolRevision:string};
 units:{rawJoint:'deg';joint:'rad';receiveTime:'ns'};clock:{receive:'host_monotonic';controller:'unavailable'};samples:Sample[]}
const dir=join(REPO_ROOT,'integrations/arm-controller/models/puma560-reference');
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function requireValue(ok:unknown,reason:string):asserts ok {if(!ok)throw Error(reason);}
function binding(){
 const manifestSha256=sha(join(dir,'manifest.json'));
 requireValue(manifestSha256==='68f416926d1f5f3fab73a900a9c30667b9a8906da78f9cf78320f73aa2148ef5','PUMA_MANIFEST_BYTES_MISMATCH');
 const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as {hashes:Record<string,string>};
 for(const [name,digest]of Object.entries(manifest.hashes))requireValue(sha(join(dir,name))===digest,'PUMA_MODEL_BYTES_MISMATCH');
 return {id:'puma560-reference',manifestSha256,dhSha256:manifest.hashes['modified-dh.json']!,framesSha256:manifest.hashes['frames.json']!,
  profileSha256:sha(join(dir,'../../configs/sim/puma560/profile.json')),baseFrame:'arm_base',tcpFrame:'tcp',toolRevision:'tool-0-notool'};
}
/** Validate supplied consistency only; a JSON provenance label is never host authentication. */
export function validateLinuxcncTrace(input:unknown){
 const t=input as LinuxcncTrace;
 requireValue(t&&t.schemaVersion===1&&t.kind==='linuxcnc_actual_joint_trace'&&t.backend==='linuxcnc_sim'&&t.provenance==='controller_sim','LINUXCNC_ACTUAL_TRACE_REQUIRED');
 requireValue(['native_capture','protocol_double'].includes(t.evidenceKind)&&/^[a-f0-9]{40}$/.test(t.sourceCommit)&&t.controller?.version&&t.controller.identityMethod==='linux-proc-boot-id-pid-starttime','TRACE_IDENTITY_MISSING');
 requireValue(hashJson(t.model)===hashJson(binding()),'PUMA_MODEL_FRAME_HASH_MISMATCH');
 requireValue(t.units?.rawJoint==='deg'&&t.units.joint==='rad'&&t.units.receiveTime==='ns','TRACE_UNITS_MISMATCH');
 requireValue(t.clock?.receive==='host_monotonic'&&t.clock.controller==='unavailable','CONTROLLER_CLOCK_UNSUPPORTED');
 requireValue(Array.isArray(t.samples)&&t.samples.length>0&&t.samples.length<=100_000,'ACTUAL_SAMPLES_MISSING_OR_TOO_LARGE');
 const segments:{epoch:string;from:number;to:number}[]=[],ids=new Set<string>();let previous=-1n;
 const model=loadArmModel(dir);
 for(const [index,s]of t.samples.entries()){
  requireValue(s&&s.sequence===index&&typeof s.epoch==='string'&&s.epoch.length>0&&s.epoch.length<256,'TRACE_SEQUENCE_OR_EPOCH_INVALID');
  requireValue(Array.isArray(s.receiveMonotonicNs)&&s.receiveMonotonicNs.length===2&&s.receiveMonotonicNs.every(v=>typeof v==='string'&&/^\d{1,30}$/.test(v))&&s.controllerTime===null&&s.synchrony==='unavailable','TRACE_TIMING_MISSING');
  const [a,b]=s.receiveMonotonicNs.map(BigInt) as [bigint,bigint];requireValue(a<=b&&a>previous,'TRACE_RECEIVE_TIME_INVALID');previous=b;
  for(const side of [s.actual,s.commanded]){
   requireValue(side&&typeof side.sampleId==='string'&&side.sampleId.length>0&&!ids.has(side.sampleId),'ACTUAL_OR_COMMANDED_SAMPLE_MISSING');ids.add(side.sampleId);
   requireValue(Array.isArray(side.rawDeg)&&Array.isArray(side.rad)&&side.rawDeg.length===6&&side.rad.length===6,'JOINT_VECTOR_INVALID');
   for(let j=0;j<6;j++){
    const d=side.rawDeg[j]!,r=side.rad[j]!,limit=model.limits[j]!;
    requireValue(typeof d==='number'&&typeof r==='number'&&Number.isFinite(d)&&Number.isFinite(r)&&Math.abs(r-d*Math.PI/180)<=1e-12,'JOINT_DEG_RAD_MISMATCH');
    requireValue(r>=limit.min-1e-9&&r<=limit.max+1e-9,'JOINT_LIMIT_EXCEEDED');
   }
  }
  const last=segments.at(-1);if(last?.epoch===s.epoch)last.to=index;else segments.push({epoch:s.epoch,from:index,to:index});
 }
 return {trace:t,segments};
}
export async function runLinuxcncAlg04(checker:AlgorithmChecker,input:unknown){
 const {trace,segments}=validateLinuxcncTrace(input),model=loadArmModel(dir),{profile}=loadOracleProfile();
 const results=await collectResults({checker,checkerId:'rtb_kinematics',profile:profile.fk,seed:0,inputs:trace,cases:[['ALG04',async call=>{
  const q=trace.samples.map(s=>s.actual.rad);
  const {T}=await call<{T:number[][][]}>('rtb_fk',{dh:model.links.map(l=>({a:l.a,alpha:l.alpha,d:l.d,offset:l.thetaOffset})),q});
  requireValue(Array.isArray(T)&&T.length===q.length,'ORACLE_FK_COUNT_MISMATCH');
  let translation=0,rotation=0,delta=0;
  q.forEach((angles,i)=>{
   const pose=forwardKinematics(model,angles).tcp,m=T[i]!;
   requireValue(m.length===4&&m.every(row=>Array.isArray(row)&&row.length===4&&row.every(v=>typeof v==='number'&&Number.isFinite(v))),'ORACLE_FK_INVALID');
   translation=Math.max(translation,Math.hypot(...pose.position.map((v,j)=>v-m[j]![3]!)));
   const [x,y,z,w]=pose.quaternionXyzw;
   const R=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
   const D=[0,1,2].map(a=>[0,1,2].map(b=>[0,1,2].reduce((sum,k)=>sum+R[k]![a]!*m[k]![b]!,0)));
   rotation=Math.max(rotation,Math.atan2(Math.hypot(D[2]![1]!-D[1]![2]!,D[0]![2]!-D[2]![0]!,D[1]![0]!-D[0]![1]!)/2,(D[0]![0]!+D[1]![1]!+D[2]![2]!-1)/2));
   delta=Math.max(delta,...angles.map((v,j)=>Math.abs(v-trace.samples[i]!.commanded.rad[j]!)));
  });
  const pass=translation<=profile.fk.translationM&&rotation<=profile.fk.rotationRad;
  return {pass,metrics:{actualSamples:q.length,maxObservedCommandActualDeltaRad:delta,maxFkTranslationResidualM:translation,maxFkRotationResidualRad:rotation},reasons:pass?[]:['ACTUAL_INPUT_FK_NUMERIC_RESIDUAL_EXCEEDED']};
 }]]});
 const result=results[0]!;
 // Numerical consistency can pass, but full ALG04 cannot: v1 has no native clock,
 // sample synchrony, independently authenticated host, or qualified motion coverage.
 const numericVerdict=result.verdict;
 if(result.verdict==='pass')result.verdict='not_run';
 result.reasons.push('CONTROLLER_SAMPLE_TIME_UNAVAILABLE','FIELD_SYNCHRONY_UNAVAILABLE','NATIVE_HOST_EXECUTION_NOT_QUALIFIED');
 if(trace.evidenceKind==='protocol_double')result.reasons.push('PROTOCOL_DOUBLE_NOT_NATIVE_EVIDENCE');
 return {schemaVersion:1,accepted:false,result,numericVerdict,traceDigest:hashJson(trace),
  coverage:{segments,interpolatedSamples:0,continuousTrajectoryQualified:false},
  followingError:{status:'not_run',reason:'WITHIN_POLL_DELTA_IS_NOT_TIME_ALIGNED_FOLLOWING_ERROR'},
  controllerCartesianResidual:{status:'not_run',reason:'CONTROLLER_CARTESIAN_DH_TCP_ENDPOINT_NOT_ESTABLISHED'},
  claims:'RTB versus TypeScript FK at independent supplied actual joints; numerical consistency only; no calibrated dynamics or physical feedback'};
}
