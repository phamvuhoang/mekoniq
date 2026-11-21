import {expect,test} from 'vitest';
import record from '../fixtures/tray-physics-record-100.json';
import {studyDriveAxes,studyAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/study-physics';
import {validatePhysicsRecord} from '../../packages/lab-runtime/src/v2/simulation3d/physics-evidence';

// R10: a run on a virtual drive (every tray variant) records the drive snapshots in each physics record; the comparison used to admit none and refused the valid data
test('the drive axes of the run are the study admission: the real tray record with drive snapshots is accepted with them and refused without',()=>{
 const scene={engine:{driveModelRef:{path:'serve-drive-nominal-v1.json'}}},get=(p:string)=>p==='serve-drive-nominal-v1.json'?{axes:[{axisId:'amr-1/wheel-left'},{axisId:'amr-1/wheel-right'}]}:undefined;
 expect(studyDriveAxes(scene as never,get as never)).toEqual(['amr-1/wheel-left','amr-1/wheel-right']);
 expect(studyDriveAxes({engine:{}} as never,get as never)).toBeUndefined();
 const ids=['floor',...new Set(record.contacts.flatMap(c=>[c.a,c.b]))],base={maxAbsRollPitchRad:0.7853981633974483,robotId:'amr-1',props:record.loads.map(l=>({propId:l.propId,supportId:l.supportId})),contactIds:ids,tickMs:20,substeps:10,driveFrameInBase:{xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]}};
 expect(()=>validatePhysicsRecord(record as never,{...base,driveAxes:['amr-1/wheel-left','amr-1/wheel-right']} as never,100)).not.toThrow();
 expect(()=>validatePhysicsRecord(record as never,base as never,100)).toThrow('PHYSICS_OBSERVATION_INVALID');
 expect(typeof studyAdmission).toBe('function');
});
