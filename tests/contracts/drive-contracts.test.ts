// V02: the drive contract. Negative cases first: every refusal the contract promises, then the fixtures and R2b messages that must keep validating.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {sealDriveDocument,validateControlEvidenceShape,validateControlProfile,validateDriveAxisSnapshotShape,validateDriveCommandShape,validateDriveModel,validateDriveRefs,validateTuningEnvelope} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {ControlProfileV1,DriveModelV1,TuningEnvelopeV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {sealDocument,validateArmCellScene,validateNavigationDocument,validateSim3DRequest,validateSim3DResponse,validateWorldSceneShape,validatePhysicsTickShape,validateWorldEvidenceRecordShape} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {ArmCellSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const FX='robotics/simulation-mujoco/fixtures/';
const read=<T,>(path:string):T=>JSON.parse(readFileSync(FX+path,'utf8')) as T;
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const model=read<DriveModelV1>('drive-v1/serve-drive-nominal-v1.json'),control=read<ControlProfileV1>('drive-v1/serve-control-v1.json'),envelope=read<TuningEnvelopeV1>('drive-v1/tuning-envelope-v1.json');
const reseal=<T extends object>(doc:T)=>sealDriveDocument(doc);
const withAxes=(f:(axes:DriveModelV1['axes'])=>void)=>{const m=clone(model);f(m.axes);return reseal(m);};
const withLoop=(f:(a:ControlProfileV1['axes'][number])=>void,i=0)=>{const c=clone(control);f(c.axes[i]!);return reseal(c);};
const modelCodes=(v:unknown)=>validateDriveModel(v).reasonCodes;
const controlCodes=(v:unknown,m:DriveModelV1=model)=>validateControlProfile(v,m,envelope).reasonCodes;
const ref=(path='serve-drive-nominal-v1.json')=>({id:'serve-drive-nominal-v1',revision:1,sha256:'a'.repeat(64),path});

test('the generated fixtures validate: models, profiles, envelope, oracle',()=>{
 for(const f of ['serve-drive-ideal-v1','serve-drive-nominal-v1','serve-drive-torque-limited-v1','serve-drive-latency-v1','serve-drive-coarse-encoder-v1','xarm6-drive-ideal-v1','xarm6-drive-nominal-v1','xarm6-drive-latency-v1','xarm6-drive-coarse-encoder-v1'])expect(validateDriveModel(read(`drive-v1/${f}.json`)),f).toEqual({ok:true,reasonCodes:[]});
 expect(validateTuningEnvelope(envelope)).toEqual({ok:true,reasonCodes:[]});
 expect(validateControlProfile(control,model,envelope)).toEqual({ok:true,reasonCodes:[]});
 expect(validateControlProfile(read('drive-v1/xarm6-control-v1.json'),read('drive-v1/xarm6-drive-nominal-v1.json'),envelope)).toEqual({ok:true,reasonCodes:[]});
 expect(validateControlEvidenceShape(read('drive-v1/control-oracle-v1.json'))).toBe(true);
});

test('one control profile is declared for every serve drive model: the experiments change the device, not the tuning',()=>{
 for(const f of ['ideal','torque-limited','latency','coarse-encoder'])expect(validateControlProfile(control,read(`drive-v1/serve-drive-${f}-v1.json`),envelope).ok,f).toBe(true);
 expect(controlCodes(control,read('drive-v1/xarm6-drive-nominal-v1.json'))).toContain('AXIS_SET_MISMATCH');
});

test('a drive model is refused for: duplicate axis ids, 17 axes, an unknown mode, countsPerRev <= 0, a brake without torque, a following error on a velocity axis, an unknown field, a wrong digest, a non-finite number',()=>{
 expect(modelCodes(withAxes(a=>{a[1]!.axisId=a[0]!.axisId;}))).toContain('DRIVE_AXIS_DUPLICATE');
 expect(modelCodes(withAxes(a=>{while(a.length<17)a.push({...a[0]!,axisId:`amr-1/extra-${a.length}`});}))).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{(a[0] as {mode:string}).mode='cst';}))).toContain('INVALID_FIELD');
 for(const bad of [0,-4096])expect(modelCodes(withAxes(a=>{a[0]!.encoder.countsPerRev=bad;})),String(bad)).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{a[0]!.brakeTorqueNm=null;}))).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{a[0]!.onDisable='coast';}))).toContain('INVALID_FIELD'); // coast carries no brake torque
 expect(modelCodes(withAxes(a=>{a[0]!.followingError={limitRad:0.5,substeps:100};}))).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{a[0]!.torque={kind:'envelope_ref',scale:1.5};}))).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{a[0]!.torque={kind:'envelope_ref',scale:0};}))).toContain('INVALID_FIELD');
 expect(modelCodes(withAxes(a=>{(a[0] as unknown as Record<string,unknown>).extra=1;}))).toContain('UNKNOWN_FIELD');
 expect(modelCodes({...model,digest:'0'.repeat(64)})).toContain('DIGEST_MISMATCH');
 expect(modelCodes(withAxes(a=>{a[0]!.velocityLimitRadS=Number.NaN;}))).toContain('NON_FINITE_NUMBER');
 expect(modelCodes({...clone(model),sources:undefined})).toContain('FIELD_REQUIRED');
});

test('a control profile is refused for: a kd on a velocity axis, an unbounded integral, a negative or NaN gain, a gain outside the envelope, a missing axis, a foreign drive model, a wrong digest',()=>{
 expect(controlCodes(withLoop(a=>{a.loop.kd=0.1;}))).toContain('CSV_KD_NONZERO');
 expect(controlCodes(withLoop(a=>{a.loop.ki=1;}))).toContain('INTEGRAL_LIMIT_REQUIRED');
 expect(controlCodes(withLoop(a=>{a.loop.kp=-1;}))).toContain('INVALID_FIELD');
 expect(controlCodes(withLoop(a=>{a.loop.kp=Number.NaN;}))).toContain('NON_FINITE_NUMBER');
 expect(controlCodes(withLoop(a=>{a.loop.kp=21;}))).toContain('GAIN_OUT_OF_ENVELOPE');
 expect(controlCodes(withLoop(a=>{a.loop.ki=1;a.loop.integralLimit=7;}))).toContain('GAIN_OUT_OF_ENVELOPE'); // 7 N m is above the 6 N m brake cap
 expect(controlCodes(withLoop(a=>{a.accelerationLimit=1000;}))).toContain('GAIN_OUT_OF_ENVELOPE');
 expect(controlCodes((()=>{const c=clone(control);c.axes.pop();return reseal(c);})())).toContain('AXIS_SET_MISMATCH');
 expect(controlCodes(reseal({...clone(control),driveModelDigests:['b'.repeat(64)]}))).toContain('DRIVE_MODEL_DIGEST_MISMATCH');
 expect(controlCodes({...control,digest:'0'.repeat(64)})).toContain('DIGEST_MISMATCH');
 expect(controlCodes({...clone(control),extra:true})).toContain('UNKNOWN_FIELD');
 expect(controlCodes(withLoop(a=>{a.loop.slewLimit=0.5;}))).toContain('GAIN_OUT_OF_ENVELOPE'); // a velocity axis allows no slew
});

test('the rule table per mode has its own reason codes, and a field the envelope does not list is not accepted (revision 2)',()=>{
 const arm=read<ControlProfileV1>('drive-v1/xarm6-control-v1.json'),armModel=read<DriveModelV1>('drive-v1/xarm6-drive-nominal-v1.json');
 const armCodes=(f:(a:ControlProfileV1['axes'][number])=>void)=>{const c=clone(arm);f(c.axes[1]!);return validateControlProfile(reseal(c),armModel,envelope).reasonCodes;};
 expect(armCodes(a=>{a.accelerationLimit=5;})).toEqual(expect.arrayContaining(['CSP_ACCELERATION_LIMIT','GAIN_OUT_OF_ENVELOPE']));
 expect(armCodes(a=>{a.loop.integralLimit=2;})).toContain('INTEGRAL_LIMIT_WITHOUT_KI');
 expect(armCodes(a=>{a.loop.ki=100;a.loop.integralLimit=0;})).toContain('INTEGRAL_LIMIT_REQUIRED');
 expect(controlCodes(withLoop(a=>{a.loop.slewLimit=0.5;}))).toContain('CSV_SLEW_LIMIT');
 expect(envelope.revision).toBe(2);
 for(const a of envelope.axes){const csv=a.axisId.startsWith('amr-1/');expect('kd' in a,a.axisId).toBe(!csv);expect('slewLimit' in a,a.axisId).toBe(!csv);expect('accelerationLimit' in a,a.axisId).toBe(csv);expect(a.integralLimit.min,a.axisId).toBeGreaterThan(0);}
 const bad=clone(envelope);bad.axes[0]!.integralLimit.min=0;
 expect(validateTuningEnvelope(reseal(bad)).reasonCodes).toContain('ENVELOPE_BOUND_INVALID');
});

test('an integral with its limit, inside the envelope, is accepted on a position axis',()=>{
 const arm=read<ControlProfileV1>('drive-v1/xarm6-control-v1.json'),armModel=read<DriveModelV1>('drive-v1/xarm6-drive-nominal-v1.json');
 const c=clone(arm);c.axes[1]!.loop={...c.axes[1]!.loop,ki:100,integralLimit:2};
 expect(validateControlProfile(reseal(c),armModel,envelope)).toEqual({ok:true,reasonCodes:[]});
 c.axes[1]!.loop.kd=1e6;
 expect(validateControlProfile(reseal(c),armModel,envelope).reasonCodes).toContain('GAIN_OUT_OF_ENVELOPE');
});

test('a tuning envelope with an inverted bound is refused',()=>{
 const e=clone(envelope);e.axes[0]!.kp={min:5,max:1};
 expect(validateTuningEnvelope(reseal(e)).reasonCodes).toContain('ENVELOPE_BOUND_INVALID');
});

test('drive refs come as a pair; a path that escapes the bundle, a URL and a bad digest are refused',()=>{
 const nav=read<{engine:Record<string,unknown>}>('serve-payload-v1/navigation-scene.json');
 expect(validateDriveRefs({engine:{id:'mujoco_3d'}})).toEqual({ok:true,reasonCodes:[]});
 expect(validateDriveRefs({engine:{...nav.engine,driveModelRef:ref()}})).toEqual({ok:false,reasonCodes:['DRIVE_PROFILE_PAIR_REQUIRED']});
 expect(validateDriveRefs({engine:{...nav.engine,controlProfileRef:ref('serve-control-v1.json')}})).toEqual({ok:false,reasonCodes:['DRIVE_PROFILE_PAIR_REQUIRED']});
 expect(validateDriveRefs({engine:{driveModelRef:ref(),controlProfileRef:ref('serve-control-v1.json')}})).toEqual({ok:true,reasonCodes:[]});
 for(const path of ['../drive.json','a/../b.json','https://example.com/d.json','/etc/d.json','d.txt'])expect(validateDriveRefs({engine:{driveModelRef:ref(path),controlProfileRef:ref('c.json')}}),path).toEqual({ok:false,reasonCodes:['DRIVE_REF_INVALID']});
 expect(validateDriveRefs({engine:{driveModelRef:{...ref(),sha256:'xyz'},controlProfileRef:ref('c.json')}}).ok).toBe(false);
 expect(validateDriveRefs({engine:{driveModelRef:{...ref(),extra:1},controlProfileRef:ref('c.json')}}).ok).toBe(false);
});

test('scenes: the optional refs validate on the navigation (mujoco) and world scenes and are refused on the frozen arm-cell scene; scenes without them keep their digest and stay valid',()=>{
 const refs={driveModelRef:ref(),controlProfileRef:ref('serve-control-v1.json')};
 const nav=read<Record<string,unknown> & {engine:Record<string,unknown>}>('serve-payload-v1/navigation-scene.json');
 expect(validateNavigationDocument(nav).ok).toBe(true);
 expect(validateNavigationDocument(sealDocument({...clone(nav),engine:{...nav.engine,...refs}},'sceneDigest')).ok).toBe(true);
 expect(validateNavigationDocument(sealDocument({...clone(nav),engine:{...nav.engine,driveModelRef:{...ref(),path:'../x.json'},controlProfileRef:ref('c.json')}},'sceneDigest')).ok).toBe(false);
 const cell=(engine:Record<string,unknown>)=>sealDocument({schemaVersion:1,sceneDigest:'',arm:{armId:'arm-1',modelId:'xarm6-g2-v1',modelRevision:'a'.repeat(64),baseInMap:{position:[0,0,0.75],quaternionXyzw:[0,0,0,1]},homeRad:[0,-0.6,1.2,0,0.6,0]},statics:[],
  supports:[{id:'nozzle-stand',centerM:[0.4,0,0.8],sizeM:[0.1,0.1,0.1]},{id:'tray',centerM:[0,0.4,0.8],sizeM:[0.2,0.2,0.02]}],props:[{propId:'cup-1',kind:'cup',radiusM:0.035,heightM:0.09,massKg:0.02,provenance:'assumed'}],
  graspFrames:{pick:{position:[0.1,0.2,0.3],quaternionXyzw:[0,0,0,1]},place:{position:[0.1,0.2,0.3],quaternionXyzw:[0,0,0,1]}},allowedContacts:[{a:'gripper',b:'nozzle-stand'}],world3d:{padFriction:1,propFriction:0.6,supportFriction:0.6,provenance:'assumed'},
  engine,engineSeed:7} as unknown as ArmCellSceneV1,'sceneDigest');
 expect(validateArmCellScene(cell({id:'mujoco_3d',timestepMs:2,substeps:10})).ok).toBe(true);
 // arm-cell-scene-v1 is frozen byte for byte by the R2a native adapter (scripts/native-sim/r2a-arm-baseline.json) and MJ-BV01 takes no drive: arm axes get a drive through the world scene
 expect(validateArmCellScene(cell({id:'mujoco_3d',timestepMs:2,substeps:10,driveModelRef:ref('xarm6-drive-nominal-v1.json'),controlProfileRef:ref('xarm6-control-v1.json')})).ok).toBe(false);
 expect(validateArmCellScene(cell({id:'mujoco_3d',timestepMs:2,substeps:10,extraRef:ref()})).ok).toBe(false);
 const world=read<Record<string,unknown>>('coffee-delivery-world-v1/lab-world-scene.json');
 expect(validateWorldSceneShape(world)).toBe(true);
 expect(validateWorldSceneShape({...world,engine:refs})).toBe(true);
 expect(validateWorldSceneShape({...world,engine:{driveModelRef:{...ref(),path:'../x.json'}}})).toBe(false);
});

const request=(op:string,payload:Record<string,unknown>)=>({protocol:'mekoniq-sim3d/1',requestId:'r1',runId:'run-a',expectedTick:0,op,payload});
const step=(over:Record<string,unknown>={})=>request('step',{targetTick:1,velocities:[],actorUpdates:[],...over});
const command={axisId:'amr-1/wheel-left',seq:3,mode:'csv',target:1.5,enable:true,quickStop:false,faultReset:false};
const axis={axisId:'amr-1/wheel-left',state:'enabled',fault:null,commandSeq:3,positionRad:1,velocityRadS:2,torqueNm:0.5,tick:7,targetApplied:2,actualPositionRad:1.0004,actualVelocityRadS:2.01,saturatedSubsteps:0,followingErrorRad:null};
const snapshot=(over:Record<string,unknown>={})=>({protocol:'mekoniq-sim3d/1',requestId:'r1',runId:'run-a',bootId:'boot-a',tick:0,ok:true,result:{schemaVersion:1,runId:'run-a',bootId:'boot-a',tick:0,simTimeNs:'0',seq:'0',sceneDigest:'f'.repeat(64),robots:[],...over}});

test('the wire: a step may carry driveCommands and a snapshot drives and driveTrace; messages without them are unchanged',()=>{
 expect(validateSim3DRequest(step()).ok).toBe(true);
 expect(validateSim3DRequest(step({driveCommands:[command]})).ok).toBe(true);
 expect(validateSim3DRequest(step({driveCommands:[{...command,mode:'cst'}]})).ok).toBe(false);
 expect(validateSim3DRequest(step({driveCommands:[{...command,extra:1}]})).ok).toBe(false);
 expect(validateSim3DRequest(step({driveCommands:Array.from({length:17},()=>command)})).ok).toBe(false);
 expect(validateSim3DResponse(snapshot()).ok).toBe(true);
 expect(validateSim3DResponse(snapshot({drives:[axis]})).ok).toBe(true);
 expect(validateSim3DResponse(snapshot({drives:[axis],driveTrace:[{axisId:axis.axisId,dtS:0.002,samples:[{target:1,actual:0.9,feedback:null,torqueNm:0.1}]}]})).ok).toBe(true);
 expect(validateSim3DResponse(snapshot({drives:[{...axis,state:'running'}]})).ok).toBe(false);
 expect(validateSim3DResponse(snapshot({drives:[{...axis,saturatedSubsteps:101}]})).ok).toBe(false);
 expect(validateDriveCommandShape(command)).toBe(true);
 expect(validateDriveAxisSnapshotShape({...axis,positionRad:null,velocityRadS:null})).toBe(true);
 expect(validateDriveAxisSnapshotShape({...axis,fault:'JAMMED'})).toBe(false);
});

test('the wire, bench (V06b): create may carry payload.bench with two refs and 1-2 axes, a readback the effective inertia of the traced axes',()=>{
 const create=(over:Record<string,unknown>={})=>request('create',{sceneRef:'navigation-scene.json',seed:7,...over});
 const bench={driveModelRef:ref(),controlProfileRef:{...ref('serve-control-v1.json'),id:'serve-control-v1'},axisIds:['amr-1/wheel-left','amr-1/wheel-right']};
 expect(validateSim3DRequest(create()).ok).toBe(true);
 expect(validateSim3DRequest(create({bench})).ok).toBe(true);
 for(const bad of [{...bench,axisIds:['amr-1/a','amr-1/b','amr-1/c']},{...bench,axisIds:[]},{...bench,axisIds:['amr-1/a','amr-1/a']},{...bench,extra:1},{axisIds:bench.axisIds,driveModelRef:bench.driveModelRef},true])expect(validateSim3DRequest(create({bench:bad})).ok).toBe(false);
 const model=(over:Record<string,unknown>={})=>snapshot({model:{robots:[],...over}});
 const inertia={axisId:'xarm-1/J3',valueKgM2:0.71,basis:'mass_matrix_diagonal',provenance:'assumed'};
 expect(validateSim3DResponse(model()).ok).toBe(true);
 expect(validateSim3DResponse(model({effectiveInertiaKgM2:[inertia,{...inertia,axisId:'xarm-1/gripper'}]})).ok).toBe(true);
 for(const bad of [[{...inertia,basis:'guess'}],[{...inertia,provenance:'measured'}],[{...inertia,valueKgM2:0}],[inertia,inertia,inertia],[]])expect(validateSim3DResponse(model({effectiveInertiaKgM2:bad})).ok).toBe(false);
});

test('evidence records: a mobile tick may carry drives, a cell record driveCommands and drives; the R2b shapes still reject nothing they accepted',()=>{
 const tick={schemaVersion:1,tick:1,simTimeNs:'20000000',contacts:[],loads:[],wheels:[],odometry:[],base:[]};
 expect(validatePhysicsTickShape(tick)).toBe(true);
 expect(validatePhysicsTickShape({...tick,drives:[axis]})).toBe(true);
 expect(validatePhysicsTickShape({...tick,drives:[{...axis,state:'x'}]})).toBe(false);
 const record={snapshot:{schemaVersion:1,runId:'run-a',bootId:'boot-a',tick:1,simTimeNs:'20000000',seq:'1',sceneDigest:'f'.repeat(64),robots:[]},command:null,interactions:[]};
 expect(validateWorldEvidenceRecordShape(record)).toBe(true);
 expect(validateWorldEvidenceRecordShape({...record,drives:[axis]})).toBe(true);
 expect(validateWorldEvidenceRecordShape({...record,command:{targetTick:1,velocities:[],actorUpdates:[],driveCommands:[command]}})).toBe(true);
 expect(validateWorldEvidenceRecordShape({...record,drives:[{...axis,tick:-1}]})).toBe(false);
});

test('V07pre: loop and limits may come from a bench run (tuned_in_simulation: run, scenario, trace sha256, source commit); a malformed tuned source, a tuned controller source or an engineering kind with bench fields is refused',()=>{
 const tuned={kind:'tuned_in_simulation',benchRunId:'3f2b1c4d-0000-4000-8000-000000000001',scenarioId:'MJ-BENCH-WHEEL',traceSha256:'d'.repeat(64),sourceCommit:'e'.repeat(40)};
 const withSources=(s:object)=>reseal({...clone(control),sources:{...control.sources,...s}});
 expect(validateControlProfile(withSources({loop:tuned,limits:{...tuned,scenarioId:'MJ-BENCH-ARM'}}),model,envelope)).toEqual({ok:true,reasonCodes:[]});
 expect(validateControlProfile(withSources({loop:tuned}),model,envelope)).toEqual({ok:true,reasonCodes:[]});   // one member tuned, the others as they were
 const {benchRunId:_,...noRun}=tuned;void _;
 for(const bad of [{...tuned,traceSha256:'D'.repeat(64)},{...tuned,traceSha256:'d'.repeat(63)},{...tuned,sourceCommit:'e'.repeat(39)},{...tuned,sourceCommit:'E'.repeat(40)},{...tuned,scenarioId:'MJ-BV01'},{...tuned,benchRunId:''},
  {...tuned,locator:'x'},noRun,{...tuned,kind:'assumed'},{...control.sources.loop,kind:'tuned_in_simulation'}])
  for(const member of ['loop','limits'])expect(validateControlProfile(withSources({[member]:bad}),model,envelope).ok,`${member} ${JSON.stringify(bad)}`).toBe(false);
 expect(validateControlProfile(withSources({controller:tuned}),model,envelope).ok).toBe(false);
});
