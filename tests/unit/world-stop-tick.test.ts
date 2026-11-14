import {expect,test} from 'vitest';
import {MockArmPlant} from '../../packages/cell-adapters/src/mock-arm';
test('world stop records the actual observed tick without advancing generator time or opening the cup',()=>{
 const state=MockArmPlant.initial('arm-1'),arm=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null);state.holding='cup-1';state.gripper='closed';state.gripperCommandM=0;
 arm.halt('DOCK_OUT_OF_TOLERANCE',undefined,1);expect(state.tick).toBe(0);expect(state.stop!.events.every(e=>e.tick===1)).toBe(true);expect(state.gripperCommandM).toBe(0);expect(state.holding).toBe('cup-1');
});
test('legacy stop tick remains current generator time and invalid world override cannot mutate it',()=>{
 const state=MockArmPlant.initial('arm-1'),arm=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null);arm.halt('LEGACY');expect(state.stop!.events.every(e=>e.tick===0)).toBe(true);const before=structuredClone(state);
 for(const tick of [-1,2,1.5,NaN]){expect(()=>arm.halt('INVALID',undefined,tick)).toThrow('ARM_STOP_TICK_INVALID');expect(state).toEqual(before);}
});
