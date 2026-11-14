import {expect,test} from 'vitest';
import {validateRunRequestV2,validateActionV2} from '../../packages/lab-runtime/src/v2/contracts';
import {worldExperiment} from '../../packages/lab-runtime/src/v2/simulation3d/world-disturbance';
const request=(id:string,backendSetId='engineering-mujoco-cell-v1',mode='simulation')=>({worldExperimentId:id,backendSetId,mode,access:'simulated',scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,project:{},runtimeIdentity:{sourceCommit:'test',schemaHash:'a'.repeat(64)}});
test('only registered launch selections pass their exact shared-world mode and scenario boundary',()=>{for(const id of ['world-nominal-v1','world-dock-drift-v1','world-cup-fall-v1']){expect(validateRunRequestV2({...request(id),project:undefined,engineeringRef:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)}}).ok).toBe(true);expect(()=>worldExperiment(request(id))).not.toThrow();}for(const [id,set,mode]of [['world-cup-fall-v1','mock-default','mock'],['world-dock-drift-v1','engineering-mujoco-arm-v1','simulation'],['other','engineering-mujoco-cell-v1','simulation']])expect(()=>worldExperiment(request(id!,set!,mode!))).toThrow();expect(worldExperiment(request('world-cup-fall-v1'))).toEqual({presetId:'world-cup-fall-v1',cupId:'cup-1'});expect(()=>worldExperiment({...request('world-cup-fall-v1'),scenarioId:'MJ-BV01'})).toThrow();});

test('wire admission refuses browser force/target fields, old providers and same-run selection edits',()=>{
 const base={...request('world-cup-fall-v1'),project:undefined,engineeringRef:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)}};
 for(const extra of [{forceMapN:[30,0,30]},{cupId:'cup-2'},{physicsOverride:{}},{targetTick:501}])expect(validateRunRequestV2({...base,...extra}).ok).toBe(false);
 for(const [mode,set]of [['mock','mock-default'],['simulation','engineering-mujoco-arm-v1'],['simulation','engineering-mujoco-mobile-v1'],['simulation','engineering-webots-3d-v1']])expect(validateRunRequestV2({...base,mode,backendSetId:set}).ok).toBe(false);
 expect(validateActionV2({actionId:'change',expectedRevision:0,kind:'setWorldExperiment',payload:{worldExperimentId:'world-cup-fall-v1'}}).ok).toBe(false);
});
