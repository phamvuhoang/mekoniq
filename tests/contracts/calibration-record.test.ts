// V15: the identification plan and the calibration record contracts. Every refusal first, then the document that must validate.
import {expect,test} from 'vitest';
import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {validateCalibrationRecord,validateIdentificationPlan} from '../../packages/lab-runtime/src/engineering/calibration-record';

const d=(c:string)=>c.repeat(64);
const plan=(o:Record<string,unknown>={})=>sealDriveDocument({schemaVersion:1,documentType:'identification-plan',id:'plan-j3',revision:1,datasetDigest:d('a'),baseDriveModelDigest:d('b'),plantModelDigest:d('c'),
 parameters:[{path:'armatureKgM2[2]',initial:0.1,lower:0.05,upper:0.3,unit:'kg*m^2'},{path:'jointDynamics.damping',initial:1,lower:0.2,upper:3,unit:'N*m*s/rad'}],
 objective:{channels:['position'],weights:{position:1}},optimizer:{method:'bounded_least_squares',maxIterations:20,tolerance:1e-8,relativeStep:1e-3,maxJacobianCondition:1e6},...o});
const result={status:'pass',reasons:[],residuals:{position:{samples:10,meanAbs:1e-4,maxAbs:2e-4,withinTolerance:true}},domain:{position:{min:0,max:0.1}},calibratedCapabilities:['actuator'],invalidatedBy:null};
const record=(o:Record<string,unknown>={})=>sealDriveDocument({schemaVersion:1,documentType:'calibration-record',planDigest:d('1'),datasetDigest:d('a'),configDigest:d('c'),baseDriveModelDigest:d('b'),fitDigest:d('f'),sourceKind:'measured',
 fitted:[{path:'armatureKgM2[2]',value:0.13,atBound:false,unit:'kg*m^2',standardError:0.002}],convergence:{iterations:5,converged:true,objectiveInitial:1,objectiveFinal:1e-6,jacobianCondition:12},
 validation:result,domain:{position:{min:0,max:0.1}},produced:[{document:'arm_physics',id:'xarm6-physics',revision:2,digest:d('9')}],reasonCodes:[],toolSelfTest:false,accepted:false,...o});

test('a plan that is within the registry, the bounds and the limits validates',()=>{
 expect(validateIdentificationPlan(plan())).toEqual({ok:true,reasonCodes:[]});
});
test('a plan is refused for 13 parameters, a path outside the registry, lower >= upper, an initial outside the bounds, a repeated path and a wrong digest',()=>{
 const many=Array.from({length:13},(_,k)=>({path:`armatureKgM2[${k%6}]`,initial:0.1,lower:0.05,upper:0.3,unit:'kg*m^2'}));
 expect(validateIdentificationPlan(plan({parameters:many})).reasonCodes).toContain('TOO_MANY_PARAMETERS');
 expect(validateIdentificationPlan(plan({parameters:[{path:'contact.condim',initial:3,lower:1,upper:6,unit:'1'}]})).reasonCodes).toContain('PARAMETER_PATH_UNREGISTERED');
 expect(validateIdentificationPlan(plan({parameters:[{path:'jointDynamics.damping',initial:1,lower:2,upper:2,unit:'N*m*s/rad'}]})).reasonCodes).toContain('BOUNDS_INVALID');
 expect(validateIdentificationPlan(plan({parameters:[{path:'jointDynamics.damping',initial:5,lower:0.2,upper:3,unit:'N*m*s/rad'}]})).reasonCodes).toContain('INITIAL_OUT_OF_BOUNDS');
 const dup=[{path:'jointDynamics.damping',initial:1,lower:0.2,upper:3,unit:'u'},{path:'jointDynamics.damping',initial:1,lower:0.2,upper:3,unit:'u'}];
 expect(validateIdentificationPlan(plan({parameters:dup})).reasonCodes).toContain('PARAMETER_DUPLICATE');
 expect(validateIdentificationPlan({...plan(),revision:2}).reasonCodes).toContain('DIGEST_MISMATCH');
 expect(validateIdentificationPlan({...plan(),extra:1}).reasonCodes).toContain('UNKNOWN_FIELD');
 expect(validateIdentificationPlan(plan({parameters:[{path:'jointDynamics.damping',initial:NaN,lower:0.2,upper:3,unit:'u'}]})).reasonCodes).toContain('NON_FINITE_NUMBER');
});
test('a plan names the channels its objective weighs, each with a positive weight',()=>{
 expect(validateIdentificationPlan(plan({objective:{channels:['position'],weights:{}}})).reasonCodes).toContain('OBJECTIVE_WEIGHT_MISSING');
 expect(validateIdentificationPlan(plan({objective:{channels:['position'],weights:{position:1,torque:1}}})).reasonCodes).toContain('OBJECTIVE_WEIGHT_UNDECLARED');
 expect(validateIdentificationPlan(plan({objective:{channels:['position'],weights:{position:0}}})).reasonCodes).toContain('INVALID_FIELD');
});

test('a passing, converged, measured record with a produced revision validates',()=>{
 expect(validateCalibrationRecord(record())).toEqual({ok:true,reasonCodes:[]});
});
test('a record is never accepted, and its digest must match its bytes',()=>{
 expect(validateCalibrationRecord({...record(),accepted:true}).ok).toBe(false);
 expect(validateCalibrationRecord({...record(),configDigest:d('d')}).reasonCodes).toContain('DIGEST_MISMATCH');
});
test('a record that did not pass, touched a bound, did not converge, came from synthetic data or was the tool self-test produces nothing',()=>{
 const produced=[{document:'drive_model',id:'x',revision:2,digest:d('9')}];
 const bad:Record<string,unknown>[]=[{sourceKind:'synthetic'},{toolSelfTest:true,sourceKind:'synthetic'},
  {fitted:[{path:'jointDynamics.damping',value:3,atBound:true,unit:'u',standardError:null}]},{convergence:{iterations:20,converged:false,objectiveInitial:1,objectiveFinal:0.5,jacobianCondition:3}},
  {validation:{...result,status:'fail',reasons:['RESIDUAL_EXCEEDS_TOLERANCE:position']}},{validation:{...result,status:'not_run'}}];
 for(const o of bad)expect(validateCalibrationRecord(record({...o,produced})).ok,JSON.stringify(o).slice(0,60)).toBe(false);
 // the same records with nothing produced are valid documents: a failed record is a record
 for(const o of bad)expect(validateCalibrationRecord(record({...o,produced:[]})),JSON.stringify(o).slice(0,60)).toEqual({ok:true,reasonCodes:[]});
 // the tool self-test cannot claim measured data
 expect(validateCalibrationRecord(record({toolSelfTest:true,sourceKind:'measured',produced:[]})).ok).toBe(false);
});
test('an unbounded condition number is null in JSON, not Infinity',()=>{
 expect(validateCalibrationRecord(record({convergence:{iterations:1,converged:true,objectiveInitial:1,objectiveFinal:1,jacobianCondition:null},produced:[]})).ok).toBe(true);
 expect(validateCalibrationRecord(record({convergence:{iterations:1,converged:true,objectiveInitial:1,objectiveFinal:1,jacobianCondition:Infinity},produced:[]})).reasonCodes).toContain('NON_FINITE_NUMBER');
});
