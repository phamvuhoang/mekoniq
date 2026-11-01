import type {Snapshot} from '../../../contracts/src/index';
import {printerSupport} from '../../../../integrations/printing/src/profile';
import {profileReason} from '../fleet/capabilities';
/** Readiness comes from installed/certified state, never a caller-supplied boolean. robot: the dispatch-profile rule eligibility uses (profileReason). */
export function runtimeReadiness(snapshots:Snapshot[]):Record<string,boolean> {
 return {
  robot:snapshots.some(s=>s.ref.kind==='robot'&&!profileReason(s.state)&&typeof s.state.mapId==='string'&&typeof s.state.mapRevision==='string'&&s.state.bindings!==null&&typeof s.state.bindings==='object'&&!Array.isArray(s.state.bindings)&&Object.keys(s.state.bindings??{}).length>0&&s.state.goalState!=='unknown'),
  bank:false,provider:false,invoiceProvider:false,
  // an installed printer profile that passes printerSupport (network/usb transport, model, ESC/POS profile, validation); never a constant
  printer:snapshots.some(s=>s.ref.kind==='printer'&&printerSupport(s.state).ready)
 };
}
