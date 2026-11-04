import type { RobotCommand, RobotManifest } from '../../../contracts/src/index';
import type { NativeExecutionState, ResolvedTarget, RobotAdapter, RobotEvent, TargetBinding } from '../contract';
import { vendorProfileProblems, type Operation, type VendorProfile } from './profile';
/** The vendor's SDK as far as this adapter is concerned. Optional methods exist only if the SDK has them; the profile's coverage decides which ones may be used at all. */
export interface VendorSdk {
  navigate(goal: { goalId?: string; locationRef: string; mapId: string; speedLimitMps?: number }): Promise<{ goalId: string }>;
  query?(goalId: string): Promise<{ state: 'running' | 'succeeded' | 'cancelled' | 'failed' | 'unknown' }>;
  cancel?(goalId: string): Promise<{ ok: boolean }>;
  stop?(): Promise<{ ok: boolean }>;
  onEvent(listener: (e: { goalId: string; kind: 'succeeded' | 'failed' | 'cancelled' | 'progress' }) => void): () => void;
}
type Goal = { command: RobotCommand; goalId: string; status: NativeExecutionState['status']; evidence: Record<string, unknown> };
/**
 * A vendor-SDK adapter for ONE profile (exact SDK + version + firmware). It translates only operations the profile marks `supported` — anything else is refused with UNSUPPORTED_OPERATION —
 * and it never completes a mission on its own say-so: completion comes from the SDK (event or query) tied to the native goal id. An SDK that cannot be asked afterwards makes an ambiguous
 * execution `unknown` (needs attention), never `completed`. A lower control epoch than one already seen is refused.
 */
export class VendorSdkAdapter implements RobotAdapter {
  readonly executor = 'native' as const;
  private goals = new Map<string, Goal>();
  private listeners = new Set<(e: RobotEvent) => void>();
  private maxEpoch = 0;
  private counter = 0n;
  private off: () => void;
  constructor(private manifest: RobotManifest, private sdk: VendorSdk, readonly profile: VendorProfile, private now: () => number = Date.now) {
    const problems = vendorProfileProblems(profile); if (problems.length) throw new Error('VENDOR_PROFILE_INVALID: ' + problems.join('; '));
    if (manifest.validation === 'hardware_validated' || manifest.validation === 'venue_approved') throw new Error('VALIDATION_LEVEL_NOT_EARNED');
    if (manifest.protocolVersion !== `${profile.sdkName}@${profile.sdkVersion}` || manifest.firmware !== profile.firmware) throw new Error('UNSUPPORTED_VENDOR_VERSION');
    this.off = sdk.onEvent(e => this.onSdkEvent(e));
  }
  close(): void { this.off(); }
  private allowed(op: Operation): boolean { return this.profile.coverage[op].status === 'supported'; }
  private emit(type: RobotEvent['type'], g: Goal, payload: Record<string, unknown> = {}): void {
    this.counter++;
    const event: RobotEvent = { type, id: `vendor-${g.command.commandId}-${this.counter}`, commandId: g.command.commandId, bootId: 'vendor-boot-1', sequence: String(this.counter), observedAt: new Date(this.now()).toISOString(), payload: { robotId: this.manifest.id, goalId: g.goalId, ...payload } as RobotEvent['payload'] };
    for (const l of this.listeners) l(event);
  }
  private onSdkEvent(e: { goalId: string; kind: string }): void {
    const g = [...this.goals.values()].find(x => x.goalId === e.goalId); // an event for a goal we did not start says nothing about any command
    if (!g || ['completed', 'cancelled', 'failed'].includes(g.status)) return;
    if (e.kind === 'succeeded') { g.status = 'completed'; this.emit('completed', g); }
    else if (e.kind === 'failed') { g.status = 'failed'; this.emit('failed', g); }
    else if (e.kind === 'cancelled') { g.status = 'cancelled'; this.emit('cancelled', g); }
    else this.emit('progress', g);
  }
  async describe(): Promise<RobotManifest> { return structuredClone(this.manifest); }
  async resolveTarget(target: TargetBinding): Promise<ResolvedTarget> {
    if (target.mapId !== this.manifest.mapId || target.mapRevision !== this.manifest.mapRevision) throw new Error('MAP_MISMATCH');
    if (!target.locationRef) throw new Error('INVALID_TARGET');
    return { kind: 'vendor', mapId: target.mapId, mapRevision: target.mapRevision, locationRef: target.locationRef };
  }
  async estimateReachability(target: ResolvedTarget) { const ok = this.allowed('navigate') && target.mapId === this.manifest.mapId && target.mapRevision === this.manifest.mapRevision; return { reachable: ok, reason: ok ? 'OK' : this.allowed('navigate') ? 'MAP_MISMATCH' : 'UNSUPPORTED_OPERATION' }; }
  async execute(command: RobotCommand) {
    if (!this.allowed('navigate')) return { accepted: false, unknown: false, reason: 'UNSUPPORTED_OPERATION' };
    const old = this.goals.get(command.commandId); if (old) return { accepted: old.status !== 'failed', nativeGoalId: old.goalId, unknown: old.status === 'unknown' };
    if (command.controlEpoch < this.maxEpoch) return { accepted: false, unknown: false, reason: 'STALE_EPOCH' };
    if (command.robotId !== this.manifest.id) return { accepted: false, unknown: false, reason: 'ROBOT_MISMATCH' };
    if (Date.parse(command.expiresAt) <= this.now()) return { accepted: false, unknown: false, reason: 'EXPIRED_COMMAND' };
    if (command.target.mapId !== this.manifest.mapId || command.target.mapRevision !== this.manifest.mapRevision) return { accepted: false, unknown: false, reason: 'MAP_MISMATCH' };
    this.maxEpoch = command.controlEpoch;
    const callerSupplied = this.profile.nativeCommandIdentity === 'caller-supplied';
    // a goal id WE choose is known before any I/O: if the answer is lost the robot may still be moving, and it must stay queryable, cancellable and able to report completion
    const g: Goal = { command: structuredClone(command), goalId: callerSupplied ? command.commandId : '', status: 'sending', evidence: {} };
    this.goals.set(command.commandId, g);
    try {
      const speed = command.limits.speedLimitMps;
      const made = await this.sdk.navigate({ ...(callerSupplied ? { goalId: command.commandId } : {}), locationRef: String(command.target.locationRef), mapId: String(command.target.mapId), ...(speed !== undefined ? { speedLimitMps: speed } : {}) });
      g.goalId = made.goalId;
      if (g.status === 'sending') { g.status = 'executing'; this.emit('accepted', g); } // an event that raced the answer may already have finished the goal
      return { accepted: true, nativeGoalId: g.goalId, unknown: false };
    } catch { g.status = 'unknown'; g.evidence = { sendFailed: true }; return { accepted: false, unknown: true, reason: 'SDK_CALL_FAILED' }; } // the SDK may have started it
  }
  async cancel(commandId: string) {
    const g = this.goals.get(commandId);
    if (!g || !this.allowed('cancel') || !this.sdk.cancel || !g.goalId) return { acknowledged: false, unknown: !g || !!g.goalId || g.status === 'unknown' };
    try { const r = await this.sdk.cancel(g.goalId); return { acknowledged: r.ok, unknown: false }; } catch { return { acknowledged: false, unknown: true }; }
  }
  async requestStop(reason: string) {
    if (!reason) throw new Error('STOP_REASON_REQUIRED');
    if (!this.allowed('stop') || !this.sdk.stop) return { acknowledged: false, physicalStopConfirmed: false };
    try { return { acknowledged: (await this.sdk.stop()).ok, physicalStopConfirmed: false }; } catch { return { acknowledged: false, physicalStopConfirmed: false }; }
  }
  observe(listener: (e: RobotEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async reconcile(commandId: string): Promise<NativeExecutionState> {
    const g = this.goals.get(commandId);
    if (!g) return { status: 'unknown', evidence: { reason: 'NEVER_SENT_OR_FORGOTTEN' } };
    if (['completed', 'cancelled', 'failed'].includes(g.status)) return { status: g.status, evidence: { goalId: g.goalId } as never };
    if (this.allowed('query') && this.sdk.query && g.goalId) {
      try {
        const q = await this.sdk.query(g.goalId);
        if (q.state === 'succeeded') { g.status = 'completed'; this.emit('completed', g); } else if (q.state === 'failed') { g.status = 'failed'; this.emit('failed', g); } else if (q.state === 'cancelled') { g.status = 'cancelled'; this.emit('cancelled', g); } else if (q.state === 'running') g.status = 'executing';
        else g.status = 'unknown';
      } catch { g.status = 'unknown'; }
    } else g.status = g.status === 'sending' ? 'unknown' : g.status === 'executing' ? 'unknown' : g.status; // cannot be asked: an in-flight goal is "needs attention", not "probably done"
    return { status: g.status, evidence: { goalId: g.goalId, queryable: this.allowed('query') && !!this.sdk.query } as never };
  }
}
