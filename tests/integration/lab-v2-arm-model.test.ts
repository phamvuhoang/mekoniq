import {expect,test} from 'vitest';
import {PUMA560_REFERENCE,PUMA560_REFERENCE_REVISION,PUMA560_SI,armModelRevision,toSI,forwardKinematics,jacobianCondition,solvePose,jointNameForLinuxcnc,MOCK_KINEMATIC,type ArmModelSI,type ArmSourceModel} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {decimal,format,add,subtract,abs,compare,sum,rescale,convertPow10,isZero} from '../../packages/lab-runtime/src/v2/models/exact-quantity';

const rng=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const code=(fn:()=>unknown)=>{try{fn();}catch(e){return (e as {code?:string}).code??(e as Error).message;}return 'NO_THROW';};
const IN=0.0254,A2=17*IN,A3=-0.8*IN,D3=5.9*IN,D4=17*IN,DEG=Math.PI/180;
type Mat=number[][];
// Test-side oracle: Craig eq. 3.6 written element by element. It shares no code with the model under test.
const craig=(alpha:number,a:number,theta:number,d:number):Mat=>{const ct=Math.cos(theta),st=Math.sin(theta),ca=Math.cos(alpha),sa=Math.sin(alpha);return [[ct,-st,0,a],[st*ca,ct*ca,-sa,-sa*d],[st*sa,ct*sa,ca,ca*d],[0,0,0,1]];};
const mul=(A:Mat,B:Mat):Mat=>A.map((_,i)=>B[0]!.map((__,j)=>A[i]!.reduce((s,_v,k)=>s+A[i]![k]!*B[k]![j]!,0)));
const DH:[number,number,number][]=[[0,0,0],[-Math.PI/2,0,0],[0,A2,D3],[-Math.PI/2,A3,D4],[Math.PI/2,0,0],[-Math.PI/2,0,0]];
const oracle=(q:readonly number[],tool=0):Mat=>{let T=DH.reduce((acc,[al,a,d],i)=>mul(acc,craig(al,a,q[i]!,d)),[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]] as Mat);if(tool)T=mul(T,[[1,0,0,0],[0,1,0,0],[0,0,1,tool],[0,0,0,1]]);return T;};
const quatToMat=([x,y,z,w]:readonly number[]):Mat=>[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
// Geodesic angle from the Frobenius distance: ||A-B||_F = 2*sqrt(2)*sin(theta/2). Accurate near 0, unlike acos(trace).
const angleBetween=(A:Mat,B:Mat)=>{let f=0;for(let i=0;i<3;i++)for(let k=0;k<3;k++)f+=(A[i]![k]!-B[i]![k]!)**2;return 2*Math.asin(Math.min(1,Math.sqrt(f)/(2*Math.SQRT2)));};
const expectPose=(pose:{position:readonly number[];quaternionXyzw:readonly number[]},T:Mat,posTol=1e-9,angTol=1e-9)=>{
 for(let i=0;i<3;i++)expect(Math.abs(pose.position[i]!-T[i]![3]!)).toBeLessThan(posTol);
 expect(angleBetween(quatToMat(pose.quaternionXyzw),T)).toBeLessThan(angTol);
};
const target=(q:readonly number[],model=PUMA560_SI)=>{const f=forwardKinematics(model,q);return {position:f.tcp.position,quaternionXyzw:f.tcp.quaternionXyzw};};
// Random in-limit configuration away from singularities (condition filter uses the model's own indicator only to pick inputs).
const inLimits=(r:()=>number,m:ArmModelSI=PUMA560_SI):number[]=>{for(;;){const q=m.limits.map(l=>l.min+0.15*(l.max-l.min)+0.7*(l.max-l.min)*r());if(jacobianCondition(m,q).condition<300)return q;}};
// Hand-derived closed-form golden poses (Craig modified DH; derivations in the F02 report).
const RZERO=[[1,0,0],[0,-1,0],[0,0,-1]],R90=[[0,0,-1],[0,-1,0],[-1,0,0]];

test('source units convert to SI explicitly: inch->m and deg->rad, never silently',()=>{
 expect(PUMA560_REFERENCE.units).toEqual({length:'inch',alpha:'rad',joint:'deg'});
 const m=PUMA560_SI;
 expect(m.links[2]!.a).toBeCloseTo(0.4318,12);expect(m.links[3]!.a).toBeCloseTo(-0.02032,12);expect(m.links[2]!.d).toBeCloseTo(0.14986,12);expect(m.links[3]!.d).toBeCloseTo(0.4318,12);
 expect(m.limits[0]!.max).toBeCloseTo(160*Math.PI/180,12);expect(m.limits[0]!.maxVelocity).toBeCloseTo(120*Math.PI/180,12);
 expect(m.links[1]!.alpha).toBeCloseTo(-Math.PI/2,15);expect(m.units).toBe('SI');
 const bad=(over:object)=>()=>toSI({...PUMA560_REFERENCE,...over} as ArmSourceModel);
 expect(code(bad({units:undefined}))).toBe('UNITS_MISSING');
 expect(code(bad({units:{length:'inch',alpha:'rad'}}))).toBe('UNITS_MISSING');
 expect(code(bad({units:{length:'cubit',alpha:'rad',joint:'deg'}}))).toBe('UNITS_MISSING');
 expect(code(bad({convention:'standard_dh'}))).toBe('CONVENTION_UNSUPPORTED');
 expect(code(bad({joints:PUMA560_REFERENCE.joints.slice(0,5)}))).toBe('MODEL_JOINT_COUNT');
 expect(code(bad({joints:PUMA560_REFERENCE.joints.map((j,i)=>i===0?{...j,min:10,max:-10}:j)}))).toBe('MODEL_LIMITS_INVALID');
});

test('pinned PUMA reference is an illustrative model with a stable revision hash and explicit joint naming',()=>{
 expect(PUMA560_REFERENCE.provenance).toBe('illustrative_reference');expect(PUMA560_REFERENCE.mekoniqRobotCode).toBeNull();expect(PUMA560_REFERENCE.convention).toBe('modified_dh');
 expect(armModelRevision(PUMA560_REFERENCE)).toBe(PUMA560_REFERENCE_REVISION);
 expect(PUMA560_REFERENCE_REVISION).toBe('bd57344faecee29df2d50b8e8535de6936b05da3778eadbf46ad0e5d626650f3');
 expect(PUMA560_SI.revision).toBe(PUMA560_REFERENCE_REVISION);
 expect(armModelRevision({...PUMA560_REFERENCE,joints:PUMA560_REFERENCE.joints.map((j,i)=>i===2?{...j,a:17.1}:j)})).not.toBe(PUMA560_REFERENCE_REVISION);
 // LinuxCNC counts joints from 0: JOINT_4 is J5, the wrist pitch whose home the sample offsets by 0.1 deg to avoid inverse failure.
 expect([0,1,2,3,4,5].map(jointNameForLinuxcnc)).toEqual(['J1','J2','J3','J4','J5','J6']);expect(jointNameForLinuxcnc(4)).toBe('J5');
 expect(code(()=>jointNameForLinuxcnc(6))).toBe('JOINT_INDEX_INVALID');
});

test('FK matches hand-derived closed-form golden poses for each conversion',()=>{
 const T0=[A2+A3,D3,-D4];
 const cases:[string,number[],number[],number[][]][]=[
  ['zero',[0,0,0,0,0,0],T0,RZERO],
  ['q1=90deg',[90*DEG,0,0,0,0,0],[-D3,A2+A3,-D4],[[0,1,0],[1,0,0],[0,0,-1]]],
  ['q2=90deg',[0,90*DEG,0,0,0,0],[-D4,D3,-(A2+A3)],R90],
  ['q3=90deg',[0,0,90*DEG,0,0,0],[A2-D4,D3,-A3],R90],
  ['q5=90deg',[0,0,0,0,90*DEG,0],T0,R90],
 ];
 for(const [,q,p,R] of cases){
  const f=forwardKinematics(PUMA560_SI,q);
  for(let i=0;i<3;i++)expect(Math.abs(f.flange.position[i]!-p[i]!)).toBeLessThan(1e-12);
  expect(angleBetween(quatToMat(f.flange.quaternionXyzw),R)).toBeLessThan(1e-12);
  expect(f.tag).toBe(MOCK_KINEMATIC);
 }
 // Tool offset along flange z: at zero flange z points down, so a 0.1 m tool lowers the TCP by 0.1 m.
 const withTool=forwardKinematics({...PUMA560_SI,toolM:[0,0,0.1]},[0,0,0,0,0,0]);
 expect(withTool.tcp.position[2]).toBeCloseTo(-D4-0.1,12);expect(withTool.flange.position[2]).toBeCloseTo(-D4,12);
 expect(forwardKinematics(PUMA560_SI,[0,0,0,0,0,0]).frames).toHaveLength(6);
});

test('FK agrees with the independent Craig oracle at 200 seeded configurations within 1e-6 m / 1e-6 rad',()=>{
 const r=rng(5);
 for(let n=0;n<200;n++){const q=PUMA560_SI.limits.map(l=>l.min+(l.max-l.min)*r());const f=forwardKinematics(PUMA560_SI,q);expectPose(f.flange,oracle(q),1e-12,1e-12);expectPose(forwardKinematics({...PUMA560_SI,toolM:[0,0,0.07]},q).tcp,oracle(q,0.07),1e-12,1e-12);}
});

test('FK refuses wrong joint vectors and source-unit models',()=>{
 expect(code(()=>forwardKinematics(PUMA560_SI,[0,0,0,0,0]))).toBe('JOINT_COUNT');
 expect(code(()=>forwardKinematics(PUMA560_SI,[0,0,0,0,0,NaN]))).toBe('JOINT_NOT_FINITE');
 expect(code(()=>forwardKinematics(PUMA560_REFERENCE as never,[0,0,0,0,0,0]))).toBe('MODEL_NOT_SI');
});

test('IK from a nearby seed converges inside the fixture tolerance and is deterministic',()=>{
 const r=rng(21);
 for(let n=0;n<60;n++){
  const q=inLimits(r),t=target(q),seed={q:q.map(v=>v+(r()-.5)*0.2),rngSeed:n};
  const s=solvePose(PUMA560_SI,t,seed);
  expect(s.ok,`case ${n}: ${JSON.stringify(s)}`).toBe(true);if(!s.ok)continue;
  expect(s.tag).toBe(MOCK_KINEMATIC);expect(s.residual.positionM).toBeLessThanOrEqual(0.001);expect(s.residual.orientationRad).toBeLessThanOrEqual(0.0087266463);
  expect(s.modelRevision).toBe(PUMA560_REFERENCE_REVISION);expect(s.condition).toBeGreaterThan(1);expect(s.iterations).toBeLessThanOrEqual(200);
  // Verify with the independent oracle, not with the model's own FK.
  expectPose({position:t.position,quaternionXyzw:t.quaternionXyzw},oracle(s.q),0.001,0.0087266463);
  s.q.forEach((v,i)=>{expect(v).toBeGreaterThanOrEqual(PUMA560_SI.limits[i]!.min);expect(v).toBeLessThanOrEqual(PUMA560_SI.limits[i]!.max);});
 }
 const q=inLimits(rng(3)),t=target(q),seed={q:q.map(v=>v+0.1),rngSeed:9};
 expect(JSON.stringify(solvePose(PUMA560_SI,t,seed))).toBe(JSON.stringify(solvePose(PUMA560_SI,t,seed)));
});

test('IK rejects unreachable targets with a structured result, not a clipped success',()=>{
 const q0=[0,0.3,0.3,0.4,0.6,0.2],far=solvePose(PUMA560_SI,{position:[1.5,0,0.3],quaternionXyzw:[0,0,0,1]},{q:q0,rngSeed:1});
 expect(far.ok).toBe(false);if(far.ok)return;
 expect(far.reason).toBe('UNREACHABLE');expect(far.tag).toBe(MOCK_KINEMATIC);expect(far.residual!.positionM).toBeGreaterThan(0.5);
 // A position given in millimetres by mistake is far outside the workspace and is refused the same way.
 expect(solvePose(PUMA560_SI,{position:[412,150,-432],quaternionXyzw:[0,0,0,1]},{q:q0,rngSeed:1})).toMatchObject({ok:false,reason:'UNREACHABLE'});
});

test('wrong units and malformed inputs are rejected before any solving',()=>{
 const q0=[0,0.3,0.3,0.4,0.6,0.2],t=target(q0);
 expect(solvePose(PUMA560_REFERENCE as never,t,{q:q0})).toMatchObject({ok:false,reason:'MODEL_NOT_SI',tag:MOCK_KINEMATIC});
 expect(solvePose(PUMA560_SI,t,{q:[30,45,10,5,20,0]})).toMatchObject({ok:false,reason:'WRONG_UNITS_SUSPECTED'});
 expect(solvePose(PUMA560_SI,t,{q:[0,0,0,0,0]})).toMatchObject({ok:false,reason:'JOINT_COUNT'});
 expect(solvePose(PUMA560_SI,{...t,quaternionXyzw:[0,0,2,0]},{q:q0})).toMatchObject({ok:false,reason:'TARGET_QUATERNION_INVALID'});
 expect(solvePose(PUMA560_SI,{...t,position:[NaN,0,0]},{q:q0})).toMatchObject({ok:false,reason:'TARGET_NOT_FINITE'});
 expect(solvePose(PUMA560_SI,t,{q:[3.5,0,0,0,0,0]})).toMatchObject({ok:false,reason:'SEED_OUT_OF_LIMITS'});
});

test('joint limits are enforced: a target reachable only outside the limits is JOINT_LIMIT',()=>{
 const q=[1.0,0.3,0.3,0.4,0.6,0.2],t=target(q);
 const tight:ArmModelSI={...PUMA560_SI,limits:PUMA560_SI.limits.map((l,i)=>i===0?{...l,min:0,max:0.1}:l)};
 const s=solvePose(tight,t,{q:[0.05,0.3,0.3,0.4,0.6,0.2],rngSeed:2});
 expect(s).toMatchObject({ok:false,reason:'JOINT_LIMIT',tag:MOCK_KINEMATIC});
 expect(solvePose(PUMA560_SI,t,{q:[0.9,0.3,0.3,0.4,0.6,0.2],rngSeed:2}).ok).toBe(true);
});

test('velocity limit rejects a step the joints cannot make in the stated time',()=>{
 const q=[1.0,0.3,0.3,0.4,0.6,0.2],t=target(q),seed=[0.9,0.3,0.3,0.4,0.6,0.2];
 expect(solvePose(PUMA560_SI,t,{q:seed,rngSeed:1,dtS:0.001})).toMatchObject({ok:false,reason:'VELOCITY_LIMIT',joint:'J1'});
 expect(solvePose(PUMA560_SI,t,{q:seed,rngSeed:1,dtS:1}).ok).toBe(true);
});

test('IK keeps branch continuity along a path and selects the wrist branch nearest the seed',()=>{
 const qa=[0.2,-0.6,0.5,-0.8,0.7,0.3],qb=[0.6,-0.3,0.9,-0.2,1.0,0.8];let prev=qa;let worst=0;
 for(let i=1;i<=40;i++){
  const u=i/40,q=qa.map((v,k)=>v+(qb[k]!-v)*u),s=solvePose(PUMA560_SI,target(q),{q:prev,rngSeed:7,dtS:1});
  expect(s.ok,`step ${i}`).toBe(true);if(!s.ok)return;
  worst=Math.max(worst,...s.q.map((v,k)=>Math.abs(v-prev[k]!)));expect(s.maxJointDeltaRad).toBeLessThan(0.1);
  s.q.forEach((v,k)=>expect(Math.abs(v-q[k]!)).toBeLessThan(2e-3));prev=s.q;
 }
 expect(worst).toBeLessThan(0.1);
 // Analytic wrist flip: (q4+pi,-q5,q6+pi) is the same pose. The seed decides which branch comes back.
 const q=[0.3,-0.5,0.8,-1.0,0.9,0.3],flip=[q[0]!,q[1]!,q[2]!,q[3]!+Math.PI,-q[4]!,q[5]!+Math.PI],t=target(q);
 expectPose({position:t.position,quaternionXyzw:t.quaternionXyzw},oracle(flip),1e-9,1e-9);
 const a=solvePose(PUMA560_SI,t,{q:q.map(v=>v+0.05),rngSeed:1}),b=solvePose(PUMA560_SI,t,{q:flip.map(v=>v-0.05),rngSeed:1});
 expect(a.ok&&b.ok).toBe(true);if(!a.ok||!b.ok)return;
 expect(Math.abs(a.q[4]!-0.9)).toBeLessThan(2e-3);expect(Math.abs(b.q[4]!+0.9)).toBeLessThan(2e-3);expect(Math.abs(b.q[3]!-flip[3]!)).toBeLessThan(2e-3);
});

test('near-singular wrist (J5 -> 0, LinuxCNC JOINT_4) is rejected with its condition number',()=>{
 const base=[0.2,-0.5,0.6,0.5,0,0.4];
 const at=(t5:number)=>[...base.slice(0,4),t5,base[5]!];
 const healthy=solvePose(PUMA560_SI,target(at(0.6)),{q:at(0.55),rngSeed:1});expect(healthy.ok).toBe(true);
 for(const t5 of [0.002,0]){
  const s=solvePose(PUMA560_SI,target(at(t5)),{q:at(0.3),rngSeed:1});
  expect(s).toMatchObject({ok:false,reason:'NEAR_SINGULARITY',joint:'J5',tag:MOCK_KINEMATIC});if(s.ok)continue;
  expect(s.condition!).toBeGreaterThan(1000);
 }
 const c=(t5:number)=>jacobianCondition(PUMA560_SI,at(t5)).condition;
 expect(c(0.002)).toBeGreaterThan(10*c(0.6));expect(c(0)).toBeGreaterThan(c(0.002));
});

test('every arm result is tagged mock_kinematic',()=>{
 const q=[0.2,-0.5,0.6,0.5,0.6,0.4];
 expect(forwardKinematics(PUMA560_SI,q).tag).toBe('mock_kinematic');
 expect((solvePose(PUMA560_SI,target(q),{q})as {tag:string}).tag).toBe('mock_kinematic');
 expect((solvePose(PUMA560_SI,target(q),{q:[30,0,0,0,0,0]})as {tag:string}).tag).toBe('mock_kinematic');
});

test('ExactDecimal is fixed-point: exact subtraction, abs, compare and explicit scale conversion',()=>{
 const a=decimal('0.1',3),b=decimal('0.2',3);
 expect(format(add(a,b))).toBe('0.300');expect(0.1+0.2).not.toBe(0.3);
 expect(format(subtract(decimal('1.000',3),decimal('0.999',3)))).toBe('0.001');expect(format(subtract(a,b))).toBe('-0.100');expect(format(abs(subtract(a,b)))).toBe('0.100');
 expect([compare(a,b),compare(b,a),compare(a,decimal('0.100',3))]).toEqual([-1,1,0]);
 expect(format(decimal('-0.00',2))).toBe('0.00');expect(isZero(decimal('-0.00',2))).toBe(true);
 expect(format(decimal('12345678901234567890.123',3))).toBe('12345678901234567890.123');
 expect(format(decimal('7',0))).toBe('7');expect(format(decimal('.5',1))).toBe('0.5');
 // Conservation: 1.000 kg split into 7 allocations by exact remainders sums back to the total with no float drift.
 const total=decimal('1.000',3),parts=[...Array(6)].map(()=>decimal('0.143',3));parts.push(subtract(total,sum(parts)));
 expect(format(sum(parts))).toBe('1.000');expect(format(parts[6]!)).toBe('0.142');
 let drift=decimal('0',3);for(let i=0;i<1000;i++)drift=add(drift,decimal('0.001',3));expect(format(drift)).toBe('1.000');
});

test('ExactDecimal never mixes scales or loses digits silently',()=>{
 expect(code(()=>add(decimal('1.0',1),decimal('1.00',2)))).toBe('SCALE_MISMATCH');
 expect(code(()=>subtract(decimal('1.0',1),decimal('1.00',2)))).toBe('SCALE_MISMATCH');
 expect(code(()=>compare(decimal('1.0',1),decimal('1.00',2)))).toBe('SCALE_MISMATCH');
 expect(code(()=>decimal('0.123',2))).toBe('DECIMAL_LOSSY');
 for(const bad of ['1e3','0.1.2','NaN','','-','1,5',' 1','Infinity','+-1'])expect(code(()=>decimal(bad,3)),bad).toBe('DECIMAL_INVALID');
 expect(code(()=>decimal(1.5 as never,3))).toBe('DECIMAL_INVALID');
 expect(code(()=>decimal('1',-1))).toBe('DECIMAL_SCALE_INVALID');expect(code(()=>decimal('1',1.5))).toBe('DECIMAL_SCALE_INVALID');expect(code(()=>decimal('1',40))).toBe('DECIMAL_SCALE_INVALID');
 const x=decimal('1.250',3);
 expect(format(rescale(x,5,'exact'))).toBe('1.25000');expect(format(rescale(x,2,'exact'))).toBe('1.25');
 expect(code(()=>rescale(decimal('1.255',3),2,'exact'))).toBe('DECIMAL_LOSSY');
 expect(format(rescale(decimal('1.255',3),2,'half_up'))).toBe('1.26');expect(format(rescale(decimal('1.255',3),2,'floor'))).toBe('1.25');
 expect(format(rescale(decimal('-1.255',3),2,'half_up'))).toBe('-1.26');expect(format(rescale(decimal('-1.255',3),2,'floor'))).toBe('-1.26');
 // 250 ml -> 0.000250 m3 is a decimal shift, so it is exact at scale 6 and lossy at scale 4.
 expect(format(convertPow10(decimal('250',0),-6,6,'exact'))).toBe('0.000250');expect(code(()=>convertPow10(decimal('250',0),-6,4,'exact'))).toBe('DECIMAL_LOSSY');
 expect(format(convertPow10(decimal('0.000250',6),6,0,'exact'))).toBe('250');
});
