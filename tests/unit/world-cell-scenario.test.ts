import {expect,test} from 'vitest';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {resolveBackends} from '../../packages/lab-runtime/src/v2/scenario-matrix';
test('MJ-CELL-BV01 is a two-cup Source scenario confined to the single-world cell set',()=>{
 const s=scenarioRegistry.get('MJ-CELL-BV01');expect(s).toBeDefined();expect(s?.coffee?.orders.map(o=>o.recipe)).toEqual(['espresso','iced-milk-coffee']);
 expect(resolveBackends(s!,'simulation','engineering-mujoco-cell-v1')).toMatchObject({ok:true,required:['mujoco_3d','mujoco_arm','mock_coffee']});
 expect(defaultCatalog.sets['engineering-mujoco-cell-v1']?.execution?.composition).toBe('single_world');
 for(const set of ['mock-default','engineering-mujoco-arm-v1','engineering-mujoco-3d-v1'])expect(resolveBackends(s!,'simulation',set).ok).toBe(false);
});
