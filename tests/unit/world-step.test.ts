import {describe,it,expect} from 'vitest';
import {stepWorldOnce} from '../../packages/lab-runtime/src/v2/simulation3d/world-step';
import type {WorldPlantPorts,WorldTickCommand} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {plantDispatcher} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import type {RunManifestInput} from '../../packages/lab-runtime/src/v2/scenario-runner';
const snapshot=(tick:number)=>({tick} as Sim3DSnapshotV1);
function harness(fail?:'step'|'append'|'commit',target=1,ack=1){
 const calls:string[]=[];
 const port:WorldPlantPorts={prepareTick(t){calls.push(`prepare:${t}`);return {targetTick:target,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]};},async step(_command:WorldTickCommand){calls.push('step');if(fail==='step')throw Error('ACK_LOST');return snapshot(ack);},async commit(s){calls.push(`commit:${s.tick}`);if(fail==='commit')throw Error('COMMIT_FAILED');},async close(){calls.push('close');}};
 const append=async(s:Sim3DSnapshotV1)=>{calls.push(`append:${s.tick}`);if(fail==='append')throw Error('DISK_FAILED');};
 return {calls,port,append};
}
describe('shared world tick transaction',()=>{
 it('prepares, steps, durably appends and commits once in order',async()=>{const h=harness();expect(await stepWorldOnce(h.port,0,h.append)).toEqual(snapshot(1));expect(h.calls).toEqual(['prepare:1','step','append:1','commit:1']);});
 it('does not append or commit a lost ACK',async()=>{const h=harness('step');await expect(stepWorldOnce(h.port,0,h.append)).rejects.toThrow('ACK_LOST');expect(h.calls).toEqual(['prepare:1','step']);});
 it('does not commit after a failed durable append',async()=>{const h=harness('append');await expect(stepWorldOnce(h.port,0,h.append)).rejects.toThrow('DISK_FAILED');expect(h.calls).toEqual(['prepare:1','step','append:1']);});
 it('propagates commit failure after the durable append without resending',async()=>{const h=harness('commit');await expect(stepWorldOnce(h.port,0,h.append)).rejects.toThrow('COMMIT_FAILED');expect(h.calls).toEqual(['prepare:1','step','append:1','commit:1']);});
 it('refuses a wrongly prepared tick before stepping',async()=>{const h=harness(undefined,2);await expect(stepWorldOnce(h.port,0,h.append)).rejects.toThrow('WORLD_TARGET_TICK_INVALID');expect(h.calls).toEqual(['prepare:1']);});
 it('refuses an ACK for another tick before appending',async()=>{const h=harness(undefined,1,2);await expect(stepWorldOnce(h.port,0,h.append)).rejects.toThrow('WORLD_ACK_TICK_INVALID');expect(h.calls).toEqual(['prepare:1','step']);});
});
it('dispatches single_world before arm-only and refuses its missing factory',async()=>{
 const catalog:CapabilityCatalog={...defaultCatalog,sets:{cell:{...defaultCatalog.sets['engineering-mujoco-arm-v1']!,execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1],composition:'single_world'}}}};
 let armCalls=0;
 const dispatcher=plantDispatcher(catalog,undefined,undefined,{mujoco_arm:{ports:()=>{armCalls++;throw Error('ARM_ONLY_CALLED');}}});
 await expect(dispatcher({backendSetId:'cell'} as RunManifestInput,{directory:'/unused'})).rejects.toThrow('WORLD_COMPOSITION_UNAVAILABLE');expect(armCalls).toBe(0);
});
