import type {Snapshot} from '../../../contracts/src/index';
/** Readiness comes from installed/certified state, never a caller-supplied boolean. */
export function runtimeReadiness(snapshots:Snapshot[]):Record<string,boolean> {
 return {
  robot:snapshots.some(s=>s.ref.kind==='robot'&&s.state.driver==='simulator'&&s.state.validation==='simulated'&&typeof s.state.mapId==='string'&&typeof s.state.mapRevision==='string'&&s.state.bindings!==null&&typeof s.state.bindings==='object'&&!Array.isArray(s.state.bindings)&&Object.keys(s.state.bindings??{}).length>0&&s.state.goalState!=='unknown'),
  bank:false,provider:false,printer:false,invoiceProvider:false
 };
}
