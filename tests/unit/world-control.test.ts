import {expect,test} from 'vitest';
import {resolve} from 'node:path';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {validateWorldControl} from '../../packages/lab-runtime/src/v2/simulation3d/world-control';
const idle={version:1 as const,program:null,attachmentProxyPropId:null,movementInterlocked:false,stopLatched:false};
test('admitted world control requires exact phase/program/waypoint and movement interlock',async()=>{
 const f=await readWorldFixture(resolve('robotics/simulation-mujoco'),'coffee-delivery-cell-v1');f.scene.controlContextVersion=1;
 expect(()=>validateWorldControl(idle,f.scene,f.files)).not.toThrow();
 expect(()=>validateWorldControl(undefined,f.scene,f.files)).toThrow('WORLD_CONTROL_INVALID');
 const active={...idle,movementInterlocked:true,program:{commandId:'c',transferId:'t',cupId:'cup-1',sourceEventId:'entry:0',payloadHash:'0'.repeat(64),controlEpoch:1,programId:'cup-place' as const,stage:0,waypoint:'high'}};
 expect(()=>validateWorldControl(active,f.scene,f.files)).not.toThrow();
 for(const patch of [{movementInterlocked:false},{program:{...active.program,waypoint:'pick'}},{program:{...active.program,stage:9}},{program:{...active.program,cupId:'other'}},{attachmentProxyPropId:'unknown'}])expect(()=>validateWorldControl({...active,...patch},f.scene,f.files)).toThrow('WORLD_CONTROL_INVALID');
 const old=structuredClone(f.scene);delete old.controlContextVersion;expect(()=>validateWorldControl(idle,old,f.files)).toThrow('WORLD_CONTROL_INVALID');
});
test('world sweep geometry derives only from admitted world bytes and matches the reviewed B05 arm proxy exactly',async()=>{
 const {worldArmGeometry}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-control'),{readXArmFixture}=await import('../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene'),{mujocoProgramSet}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports');
 const root=resolve('robotics/simulation-mujoco'),f=await readWorldFixture(root,'coffee-delivery-cell-v1'),reviewed=mujocoProgramSet(readXArmFixture(root),{gripSettleTicks:1,dropTicks:1,liftMinM:.01},[]);expect(worldArmGeometry(f.scene,f.files)).toEqual(reviewed.collision!.geometry);
});
