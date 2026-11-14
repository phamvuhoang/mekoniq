/** Bounded derived caches. Never changes control state, live sweep execution or durable observations. */
import type {ArmPlantState} from '../../../../cell-adapters/src/mock-arm';
export const WORLD_HISTORY_POLICY={mode:'world_durable_v1',limit:16} as const;
export function boundWorldArmHistory(state:ArmPlantState){
 const p=state.historyRetention;if(!p)return;if(p.mode!==WORLD_HISTORY_POLICY.mode||p.limit!==16||![p.droppedTraceSamples,p.droppedPropsSamples,p.droppedDebugSamples].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('WORLD_HISTORY_POLICY_INVALID');
 const trim=<T>(rows:T[]|undefined)=>{if(!rows)return 0;const n=Math.max(0,rows.length-p.limit);if(n)rows.splice(0,n);return n;};
 const e=state.collision?.evidence;if(e){e.droppedIntervals+=trim(e.intervals);const keep=new Set(e.intervals.map(i=>i.worldRevision));if(e.firstFailure)keep.add(e.firstFailure.worldRevision);for(const key of Object.keys(e.worlds))if(!keep.has(key))delete e.worlds[key];}
 p.droppedTraceSamples+=trim(state.tracking?.trace);p.droppedPropsSamples+=trim(state.tracking?.props);p.droppedDebugSamples+=trim(state.trace);
}
