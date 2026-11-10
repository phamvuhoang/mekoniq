// ALG01/02/03/05 (G-ALG1): Robotics Toolbox against arm-kinematics.ts on both PUMA560 tables. The Python checker returns numbers; every comparison and verdict is here.
// A broken or absent checker is never a pass: no interpreter -> not_run, anything else -> fail, each with its reason.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadArmModel} from '../arm/session';
import {hashJson} from '../hash';
import {PUMA560_REFERENCE,PUMA560_SI,forwardKinematics,jacobianCondition,solvePose,toSI,type ArmModelSI} from '../models/arm-kinematics';
import {actorStream} from '../random';
import type {AlgorithmResultV1} from '../navigation2d/contracts';
import {isCheckerError,REPO_ROOT,type AlgorithmChecker,type OracleProfileV1} from './checker';
import {collectResults,fin,type Call,type Outcome} from './results';

type Mat=number[][];
type Metrics=Record<string,number|null>;
interface Table {id:'A'|'B';model:ArmModelSI;golden:{q:number[];T:Mat;name:string}[];nearSingular:number[][]}
const DEG=Math.PI/180;

function matOf(p:{position:readonly number[];quaternionXyzw:readonly number[]}):Mat{
 const [x,y,z,w]=p.quaternionXyzw as [number,number,number,number],[px,py,pz]=p.position as [number,number,number];
 return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),px],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),py],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),pz],[0,0,0,1]];
}
const trErr=(A:Mat,B:Mat)=>Math.hypot(A[0]![3]!-B[0]![3]!,A[1]![3]!-B[1]![3]!,A[2]![3]!-B[2]![3]!);
/** Angle of A^T B from atan2(|skew|, (trace-1)/2): exact for tiny angles where acos loses half its digits. */
function rotErr(A:Mat,B:Mat):number{
 const M=[0,1,2].map(i=>[0,1,2].map(j=>[0,1,2].reduce((s,k)=>s+A[k]![i]!*B[k]![j]!,0)));
 const v=[(M[2]![1]!-M[1]![2]!)/2,(M[0]![2]!-M[2]![0]!)/2,(M[1]![0]!-M[0]![1]!)/2];
 return Math.atan2(Math.hypot(...v),(M[0]![0]!+M[1]![1]!+M[2]![2]!-1)/2);
}
const dhOf=(m:ArmModelSI)=>m.links.map(l=>({a:l.a,alpha:l.alpha,d:l.d,offset:l.thetaOffset}));
const limitsOf=(m:ArmModelSI)=>m.limits.map(l=>[l.min,l.max]);
const tsT=(m:ArmModelSI,q:readonly number[])=>matOf(forwardKinematics(m,q).tcp);
const withinLimits=(m:ArmModelSI,q:readonly number[])=>q.every((v,i)=>v>=m.limits[i]!.min-1e-9&&v<=m.limits[i]!.max+1e-9);

function loadTables():Table[]{
 const goldenA=JSON.parse(readFileSync(join(REPO_ROOT,'tests/fixtures/digital-twin/arm-fk-golden.json'),'utf8')) as {fk:{q:number[];tcp:number[];tcpQ:number[]}[]};
 const dirB=join(REPO_ROOT,'integrations/arm-controller/models/puma560-reference');
 const refs=(JSON.parse(readFileSync(join(dirB,'reference-poses.json'),'utf8')) as {cases:{name:string;kind:string;qDeg:number[]|null;expected:{tcpM?:number[];quaternionXyzw?:number[]}}[]}).cases;
 const withFk=refs.filter(c=>c.qDeg&&c.expected.tcpM&&c.expected.quaternionXyzw);
 return [
  {id:'A',model:PUMA560_SI,golden:goldenA.fk.map((g,i)=>({name:`fk${i}`,q:g.q,T:matOf({position:g.tcp,quaternionXyzw:g.tcpQ})})),nearSingular:[[0.3,-0.5,0.8,0.2,0.001,0.3]]},
  {id:'B',model:loadArmModel(dirB),golden:withFk.map(c=>({name:c.name,q:c.qDeg!.map(d=>d*DEG),T:matOf({position:c.expected.tcpM!,quaternionXyzw:c.expected.quaternionXyzw!})})),nearSingular:refs.filter(c=>c.kind==='near_singularity'&&c.qDeg).map(c=>c.qDeg!.map(d=>d*DEG))},
 ];
}
/** Uniform inside the joint limits narrowed to +-pi, shrunk about their middle by `shrink`. */
function pose(rnd:()=>number,m:ArmModelSI,shrink:number):number[]{
 return m.limits.map(l=>{const lo=Math.max(l.min,-Math.PI),hi=Math.min(l.max,Math.PI),mid=(lo+hi)/2,half=(hi-lo)/2*shrink;return mid+half*(2*rnd()-1);});
}

async function alg01(call:Call,tables:Table[],p:OracleProfileV1,seed:number):Promise<Outcome>{
 const metrics:Metrics={goldenPoses:0,seededPoses:0},reasons:string[]=[];let tr=0,rot=0;
 for(const t of tables){
  const rnd=actorStream(seed,`alg01-${t.id}`).next,seeded=Array.from({length:p.seededPoses},()=>pose(rnd,t.model,1)),qs=[...t.golden.map(g=>g.q),...seeded];
  const {T}=await call<{T:Mat[]}>('rtb_fk',{dh:dhOf(t.model),q:qs});
  if(!Array.isArray(T)||T.length!==qs.length){reasons.push(`table ${t.id}: RTB returned ${T?.length} poses for ${qs.length}`);continue;}
  let ttr=0,trot=0;
  qs.forEach((q,i)=>{
   const ts=tsT(t.model,q),pairs:[string,Mat,Mat][]=[['RTB~TS',T[i]!,ts]];
   if(i<t.golden.length)pairs.push(['RTB~golden',T[i]!,t.golden[i]!.T],['TS~golden',ts,t.golden[i]!.T]);
   for(const [what,a,b] of pairs){
    const e=trErr(a,b),r=rotErr(a,b);
    if(!fin(e)||!fin(r)){reasons.push(`table ${t.id} pose ${i} ${what}: non-finite error`);continue;}
    ttr=Math.max(ttr,e);trot=Math.max(trot,r);
    if(e>p.fk.translationM||r>p.fk.rotationRad)reasons.push(`table ${t.id} pose ${i} ${what}: ${e.toExponential(2)} m, ${r.toExponential(2)} rad exceed ${p.fk.translationM} m, ${p.fk.rotationRad} rad`);
   }
  });
  metrics[`table${t.id}.maxTranslationErrorM`]=ttr;metrics[`table${t.id}.maxRotationErrorRad`]=trot;
  tr=Math.max(tr,ttr);rot=Math.max(rot,trot);
  metrics.goldenPoses!+=t.golden.length;metrics.seededPoses!+=seeded.length;
 }
 Object.assign(metrics,{maxTranslationErrorM:tr,maxRotationErrorRad:rot});
 return {pass:reasons.length===0&&metrics.goldenPoses!>0,metrics,reasons:reasons.slice(0,20)};
}

async function alg02(call:Call,tables:Table[],p:OracleProfileV1,seed:number):Promise<Outcome>{
 const metrics:Metrics={poses:0,tsSolved:0,rtbSolved:0,limitViolations:0,tsToRtbMaxTranslationM:0,tsToRtbMaxRotationRad:0,rtbToTsMaxTranslationM:0,rtbToTsMaxRotationRad:0},reasons:string[]=[];
 for(const t of tables){
  const rnd=actorStream(seed,`alg02-${t.id}`).next,m=t.model,targets:Mat[]=[],starts:number[][]=[],ts:ReturnType<typeof solvePose>[]=[];
  for(let k=0;k<p.ikPoses;k++){
   let qTrue=pose(rnd,m,0.7);for(let tries=0;tries<50&&jacobianCondition(m,qTrue).condition>100;tries++)qTrue=pose(rnd,m,0.7);
   const start=qTrue.map((v,i)=>Math.min(m.limits[i]!.max,Math.max(m.limits[i]!.min,v+0.3*(rnd()-0.5)))),target=forwardKinematics(m,qTrue).tcp;
   targets.push(matOf(target));starts.push(start);ts.push(solvePose(m,{position:target.position,quaternionXyzw:target.quaternionXyzw},{q:start,rngSeed:seed}));
  }
  const rtb=(await call<{solutions:{ok:boolean;q:number[];reason?:string}[]}>('rtb_ik',{dh:dhOf(m),T:targets,q0:starts,limits:limitsOf(m)})).solutions;
  const tsSolved=ts.flatMap((s,k)=>s.ok?[{k,q:s.q}]:[]),rtbSolved=rtb.flatMap((s,k)=>s.ok?[{k,q:s.q}]:[]);
  const viaRtb=tsSolved.length?(await call<{T:Mat[]}>('rtb_fk',{dh:dhOf(m),q:tsSolved.map(s=>s.q)})).T:[];
  tsSolved.forEach((s,i)=>{
   const e=trErr(viaRtb[i]!,targets[s.k]!),r=rotErr(viaRtb[i]!,targets[s.k]!);
   metrics.tsToRtbMaxTranslationM=Math.max(metrics.tsToRtbMaxTranslationM!,e);metrics.tsToRtbMaxRotationRad=Math.max(metrics.tsToRtbMaxRotationRad!,r);
   if(!(e<=p.ikTsToRtb.translationM&&r<=p.ikTsToRtb.rotationRad))reasons.push(`table ${t.id} pose ${s.k}: TS solution seen by RTB is off by ${e} m, ${r} rad`);
   if(!withinLimits(m,s.q)){metrics.limitViolations!++;reasons.push(`table ${t.id} pose ${s.k}: TS solution outside the joint limits`);}
  });
  rtbSolved.forEach(s=>{
   const back=tsT(m,s.q),e=trErr(back,targets[s.k]!),r=rotErr(back,targets[s.k]!);
   metrics.rtbToTsMaxTranslationM=Math.max(metrics.rtbToTsMaxTranslationM!,e);metrics.rtbToTsMaxRotationRad=Math.max(metrics.rtbToTsMaxRotationRad!,r);
   if(!(e<=p.ikRtbToTs.translationM&&r<=p.ikRtbToTs.rotationRad))reasons.push(`table ${t.id} pose ${s.k}: RTB solution seen by TS is off by ${e} m, ${r} rad`);
   if(!withinLimits(m,s.q)){metrics.limitViolations!++;reasons.push(`table ${t.id} pose ${s.k}: RTB solution outside the joint limits`);}
  });
  metrics.poses!+=p.ikPoses;metrics.tsSolved!+=tsSolved.length;metrics.rtbSolved!+=rtbSolved.length;
  for(const [side,n] of [['TS',tsSolved.length],['RTB',rtbSolved.length]] as const)if(n<p.ikSolvedFractionMin*p.ikPoses)reasons.push(`table ${t.id}: ${side} solved ${n}/${p.ikPoses}, below ${p.ikSolvedFractionMin}`);
 }
 return {pass:reasons.length===0,metrics,reasons:reasons.slice(0,20)};
}

/** Central differences of the TS forward kinematics: the 6xn base-frame geometric Jacobian [v; w]. */
function fdJacobian(m:ArmModelSI,q:readonly number[],h=1e-6):Mat{
 const J:Mat=[[],[],[],[],[],[]];
 q.forEach((_,i)=>{
  const qp=[...q],qm=[...q];qp[i]!+=h;qm[i]!-=h;
  const fp=forwardKinematics(m,qp).tcp,fm=forwardKinematics(m,qm).tcp,Rp=matOf(fp),Rm=matOf(fm);
  for(let k=0;k<3;k++)J[k]![i]=(fp.position[k]!-fm.position[k]!)/(2*h);
  const D=[0,1,2].map(a=>[0,1,2].map(b=>[0,1,2].reduce((s,c)=>s+Rp[a]![c]!*Rm[b]![c]!,0)));
  J[3]![i]=(D[2]![1]!-D[1]![2]!)/2/(2*h);J[4]![i]=(D[0]![2]!-D[2]![0]!)/2/(2*h);J[5]![i]=(D[1]![0]!-D[0]![1]!)/2/(2*h);
 });
 return J;
}
const frob=(J:Mat)=>Math.sqrt(J.reduce((s,r)=>s+r.reduce((a,v)=>a+v*v,0),0));

async function alg03(call:Call,tables:Table[],p:OracleProfileV1,seed:number):Promise<Outcome>{
 const metrics:Metrics={poses:0,maxNormalizedJacobianError:0,maxConditionRelativeError:0,maxConditionRelativeErrorAboveLimit:0,singularFlagMismatch:0,singularFlaggedBoth:1},reasons:string[]=[];
 for(const t of tables){
  const rnd=actorStream(seed,`alg03-${t.id}`).next,m=t.model,
   qs=[...t.golden.map(g=>g.q),...Array.from({length:p.ikPoses},()=>pose(rnd,m,1)),...t.nearSingular],nearFrom=qs.length-t.nearSingular.length;
  const {J,cond}=await call<{J:Mat[];cond:(number|null)[]}>('rtb_jacobian',{dh:dhOf(m),q:qs});
  qs.forEach((q,i)=>{
   const fd=fdJacobian(m,q),err=frob(J[i]!.map((r,a)=>r.map((v,b)=>v-fd[a]![b]!)))/Math.max(frob(fd),1);
   const ts=jacobianCondition(m,q).condition,rtbFlag=cond[i]===null||cond[i]!>p.singularConditionMax,tsFlag=ts>p.singularConditionMax;
   metrics.poses!++;
   if(!fin(err)||err>p.jacobian.normalized)reasons.push(`table ${t.id} pose ${i}: Jacobian differs from finite differences by ${err}`);else metrics.maxNormalizedJacobianError=Math.max(metrics.maxNormalizedJacobianError!,err);
   if(rtbFlag!==tsFlag){metrics.singularFlagMismatch!++;reasons.push(`table ${t.id} pose ${i}: singular flag RTB ${rtbFlag} vs TS ${tsFlag} (cond ${cond[i]} vs ${ts})`);}
   if(fin(cond[i])&&fin(ts)){
    // jacobianCondition takes the eigenvalues of J^T J, so its relative error grows like eps*cond^2. Above singularConditionMax the number is not used (such a pose is
    // refused as NEAR_SINGULARITY): only the flag has to agree there, and the error is recorded without a gate.
    const rel=Math.abs(cond[i]!-ts)/ts,gated=cond[i]!<=p.singularConditionMax&&ts<=p.singularConditionMax,key=gated?'maxConditionRelativeError':'maxConditionRelativeErrorAboveLimit';
    metrics[key]=Math.max(metrics[key]??0,rel);
    if(gated&&rel>p.jacobian.conditionRelative)reasons.push(`table ${t.id} pose ${i}: condition number differs by ${rel} (relative)`);
   }
   if(i>=nearFrom&&!(rtbFlag&&tsFlag)){metrics.singularFlaggedBoth=0;reasons.push(`table ${t.id} near-singular pose ${i} was not flagged by both sides`);}
  });
 }
 return {pass:reasons.length===0,metrics,reasons:reasons.slice(0,20)};
}

const head=(s:string)=>s.split(/[:\s]/)[0]!;
async function alg05(call:Call,tables:Table[],p:OracleProfileV1):Promise<Outcome>{
 const metrics:Metrics={subCases:0,rejectedByBoth:0},reasons:string[]=[],fails:string[]=[];
 const both=(name:string,t:Table,ts:string|null,rtb:string|null)=>{
  metrics.subCases!++;
  if(ts&&rtb){metrics.rejectedByBoth!++;reasons.push(`${name}:TS:${ts}(${t.id})`,`${name}:RTB:${rtb}(${t.id})`);}
  else fails.push(`${name}(${t.id}): TS ${ts??'NOT_REJECTED'}, RTB ${rtb??'NOT_REJECTED'}`);
 };
 const rejected=async(f:()=>Promise<unknown>):Promise<string|null>=>{try{await f();return null;}catch(e){return isCheckerError(e)?head(e.detail):(e as {code?:string}).code??head(String((e as Error).message));}};
 for(const t of tables){
  const m=t.model,safe=m.limits.map(l=>Math.min(l.max,Math.max(l.min,0)));
  // beyond reach: 2 m from the base is outside a ~0.9 m arm
  const far={position:[2,0,0] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]},tsFar=solvePose(m,far,{q:safe});
  const rtbFar=(await call<{solutions:{ok:boolean;reason?:string}[]}>('rtb_ik',{dh:dhOf(m),T:[matOf(far)],q0:[safe],limits:limitsOf(m)})).solutions[0]!;
  both('beyond-reach',t,tsFar.ok?null:tsFar.reason,rtbFar.ok?null:rtbFar.reason??'IK_FAILED');
  // a start beyond a joint limit
  const over=[...safe];over[2]=m.limits[2]!.max+0.2;const tgt=forwardKinematics(m,safe).tcp,T=[matOf(tgt)];
  const tsOver=solvePose(m,{position:tgt.position,quaternionXyzw:tgt.quaternionXyzw},{q:over}),rtbOver=(await call<{solutions:{ok:boolean;reason?:string}[]}>('rtb_ik',{dh:dhOf(m),T,q0:[over],limits:limitsOf(m)})).solutions[0]!;
  both('over-limit',t,tsOver.ok?null:tsOver.reason,rtbOver.ok?null:rtbOver.reason??'IK_FAILED');
  // a corrupt table: one joint missing / a non-number in a row (JSON turns NaN into null)
  const broken=await rejected(async()=>{toSI({...PUMA560_REFERENCE,joints:PUMA560_REFERENCE.joints.slice(0,5)});});
  const short=await rejected(()=>call('rtb_fk',{dh:dhOf(m).slice(0,5),q:[safe]})),nan=await rejected(()=>call('rtb_fk',{dh:dhOf(m).map((r,i)=>i===1?{...r,a:Number.NaN}:r),q:[safe]}));
  both('corrupt-dh',t,broken,short&&nan?`${short}+${nan}`:null);
  // a pose the wrist cannot resolve
  const q=t.nearSingular[0]!,near=forwardKinematics(m,q).tcp,tsNear=solvePose(m,{position:near.position,quaternionXyzw:near.quaternionXyzw},{q:q.map((v,i)=>Math.min(m.limits[i]!.max,Math.max(m.limits[i]!.min,v+0.02)))});
  const {cond}=await call<{cond:(number|null)[]}>('rtb_jacobian',{dh:dhOf(m),q:[q]});
  both('near-singular',t,tsNear.ok?null:tsNear.reason,cond[0]===null||cond[0]!>p.singularConditionMax?'SINGULAR_FLAGGED':null);
 }
 return {pass:fails.length===0&&metrics.subCases!>0,metrics,reasons:[...fails,...(fails.length?[]:reasons)]};
}

/** Runs ALG01, ALG02, ALG03 and ALG05 (ALG04 needs a running LinuxCNC bridge and belongs to R3). */
export async function runKinematicsCases(checker:AlgorithmChecker,profile:OracleProfileV1,seed:number):Promise<AlgorithmResultV1[]>{
 const tables=loadTables();
 return collectResults({checker,checkerId:'rtb_kinematics',profile,seed,inputs:tables.map(t=>({id:t.id,revision:t.model.revision,golden:hashJson(t.golden)})),cases:[
  ['ALG01',c=>alg01(c,tables,profile,seed)],['ALG02',c=>alg02(c,tables,profile,seed)],['ALG03',c=>alg03(c,tables,profile,seed)],['ALG05',c=>alg05(c,tables,profile)]]});
}
