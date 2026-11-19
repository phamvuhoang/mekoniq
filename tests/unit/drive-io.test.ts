import {expect,test} from 'vitest';
import {splitDriveSnapshot,validateDriveRefs} from '../../packages/lab-runtime/src/v2/control/drive-io';

test('a scene with a drive model but no control profile is refused',()=>{
 const scene={engine:{id:'mujoco_3d',driveModelRef:{id:'serve-drive-nominal-v1',revision:1,sha256:'a'.repeat(64),path:'serve-drive-nominal-v1.json'}}};
 expect(validateDriveRefs(scene)).toEqual({ok:false,reasonCodes:['DRIVE_PROFILE_PAIR_REQUIRED']});
});
test('the controller view carries no true state',()=>{
 const axis={axisId:'amr-1/wheel-left',state:'enabled',fault:null,commandSeq:3,positionRad:1,velocityRadS:2,torqueNm:0.5,tick:7,
  targetApplied:2,actualPositionRad:1.0004,actualVelocityRadS:2.01,saturatedSubsteps:0,followingErrorRad:null} as const;
 const {feedback,evidence}=splitDriveSnapshot([axis]);
 expect(Object.keys(feedback[0]!).sort()).toEqual(['axisId','commandSeq','fault','positionRad','state','tick','torqueNm','velocityRadS']);
 expect(evidence[0]).toEqual(axis);
 expect(evidence[0]).not.toBe(axis); // the recorder gets its own copy
});
test('measured values stay null when the feedback is invalid: nothing is filled in',()=>{
 const axis={axisId:'xarm-1/J1',state:'fault',fault:'FEEDBACK_LOSS',commandSeq:9,positionRad:null,velocityRadS:null,torqueNm:null,tick:1,targetApplied:0,actualPositionRad:0.3,actualVelocityRadS:0,saturatedSubsteps:0,followingErrorRad:null} as const;
 const {feedback}=splitDriveSnapshot([axis]);
 expect(feedback[0]).toMatchObject({positionRad:null,velocityRadS:null,torqueNm:null,fault:'FEEDBACK_LOSS'});
});
