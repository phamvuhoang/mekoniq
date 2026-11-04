import type { ModuleRegistry } from '../modules';
import type { Snapshot } from '../../../contracts/src/index';
import { all, changed, created, done, fail, find, handle, note, text } from '../restaurant-context';
/**
 * Who dispatches a robot. A robot with no `control-owner` record is dispatched by this platform (every existing venue). During a cutover from the old (trial) system a robot gets a
 * record `{owner:'trial'}` and this platform will not send it anything until the old dispatcher is FENCED (a person attests, with evidence, that it can no longer send commands) and the
 * hand-over is activated. Exactly one dispatcher at a time; never an automatic takeover on a timeout.
 */
export const productionControls = (s: Snapshot[], robotId: string): boolean => (find(s, 'control-owner', robotId)?.state.owner ?? 'production') === 'production';
const FINAL = ['completed', 'cancelled', 'failed'];
export function registerDispatcherCutover(registry: ModuleRegistry): void {
  // Dispatcher.Hold {robotId}: put a robot under the OLD dispatcher's control record before the cutover starts (a robot the trial system still drives).
  handle(registry, 'Dispatcher.Hold', (c, s) => {
    const robotId = text(c.payload.robotId), existing = find(s, 'control-owner', robotId);
    if (!find(s, 'robot', robotId)) return fail('NOT_FOUND');
    if (existing) return done([], { robotId, owner: String(existing.state.owner), duplicate: true });
    if (all(s, 'mission').some(m => m.state.robotId === robotId && !FINAL.includes(String(m.state.status)))) return fail('ROBOT_HAS_ACTIVE_MISSION');
    return done([created('DispatcherHeld', 'control-owner', robotId, { owner: 'trial', fenced: false, heldBy: c.actorRef, heldAt: c.recordedAt })], { robotId });
  });
  // Dispatcher.Fence {robotId,evidenceRef}: a manager attests, with evidence, that the old dispatcher can no longer command this robot (flows stopped, credentials revoked, broker closed to it).
  handle(registry, 'Dispatcher.Fence', (c, s) => {
    const robotId = text(c.payload.robotId), rec = find(s, 'control-owner', robotId) ?? fail('NOT_FOUND');
    if (rec.state.owner !== 'trial') return fail('NOT_HELD_BY_OLD_DISPATCHER');
    const evidenceRef = note(c.payload.evidenceRef, 'EVIDENCE_REQUIRED');
    if (rec.state.fenced === true) return done([], { robotId, duplicate: true });
    return done([changed('DispatcherFenced', rec, { fenced: true, evidenceRef, fencedBy: c.actorRef, fencedAt: c.recordedAt })], { robotId });
  });
  // Dispatcher.Activate {robotId,newOwner:'production',trialReconciled:true}: only after the old dispatcher is fenced AND its bills/missions/loads were reconciled (explicit statement).
  handle(registry, 'Dispatcher.Activate', (c, s) => {
    const robotId = text(c.payload.robotId), rec = find(s, 'control-owner', robotId) ?? fail('NOT_FOUND');
    if (c.payload.newOwner !== 'production') return fail('INVALID_OWNER');
    if (rec.state.owner === 'production') return done([], { robotId, duplicate: true });
    if (rec.state.fenced !== true) return fail('OLD_OWNER_NOT_FENCED');
    if (c.payload.trialReconciled !== true) return fail('TRIAL_NOT_RECONCILED');
    return done([changed('DispatcherActivated', rec, { owner: 'production', activatedBy: c.actorRef, activatedAt: c.recordedAt })], { robotId, owner: 'production' });
  });
  // Dispatcher.Return {robotId}: back-out. Production dispatch stops FIRST (no active mission may remain), then the old dispatcher may be unfenced by its owner. No money is touched: nothing restores an old financial snapshot.
  handle(registry, 'Dispatcher.Return', (c, s) => {
    const robotId = text(c.payload.robotId), rec = find(s, 'control-owner', robotId);
    if (!find(s, 'robot', robotId)) return fail('NOT_FOUND');
    if (rec?.state.owner === 'trial') return done([], { robotId, duplicate: true });
    if (all(s, 'mission').some(m => m.state.robotId === robotId && !FINAL.includes(String(m.state.status)))) return fail('ROBOT_HAS_ACTIVE_MISSION'); // finish or cancel and reconcile loads first
    const events = rec ? [changed('DispatcherReturned', rec, { owner: 'trial', fenced: false, returnedBy: c.actorRef, returnedAt: c.recordedAt })] : [created('DispatcherReturned', 'control-owner', robotId, { owner: 'trial', fenced: false, returnedBy: c.actorRef, returnedAt: c.recordedAt })];
    return done(events, { robotId, owner: 'trial' });
  });
}
