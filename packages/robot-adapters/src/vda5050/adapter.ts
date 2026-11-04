import type { RobotCommand, RobotManifest } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import type { NativeExecutionState, ResolvedTarget, RobotAdapter, RobotEvent, TargetBinding } from '../contract';
import { connectionTopic, parseConnection, type ConnectionState } from './connection';
import { instantAction, instantActionsTopic } from './instant-actions';
import { buildOrder, orderTopic, VDA_VERSION, type Identity } from './orders';
import { orderFinished, stateTopic, validateState, type VdaState } from './state';
/** The broker side. The production transport is the native executor's MQTT client on the venue LAN (journal before I/O); this port is what the protocol layer needs and what the emulator rig provides. */
export interface Vda5050Transport {
  publish(topic: string, message: string, options: { retain: false; qos: 1 }): Promise<void>;
  subscribe(topic: string, handler: (message: string, meta: { retained: boolean }) => void): () => void;
}
type Tracked = { command: RobotCommand; hash: string; orderId: string; update: number; targetNodeId: string; issuedAtMs: number; status: NativeExecutionState['status']; evidence: Record<string, unknown>; acked: boolean; rejected?: string; cancelActionId?: string; cancelled?: boolean };
export type Vda5050Options = { identity: Identity; interfaceName?: string; now?: () => number; ackTimeoutMs?: number };
/**
 * VDA 5050 2.0.0 over a broker. Honest boundaries:
 *  - exactly version 2.0.0 (messages of any other version are dropped, counted in `rejectedMessages`);
 *  - the state of the vehicle decides everything: completion needs the SAME orderId and orderUpdateId, the last node = the target, nothing left to traverse, not driving, all actions finished;
 *  - publishing an order is not acceptance (it waits for the vehicle's state to carry the order) and `startPause` is a request, never a safety stop (`physicalStopConfirmed` is always false);
 *  - retained, duplicate, out-of-order and other-vehicle messages never complete anything;
 *  - this is protocol conformance against an emulator. It says nothing about a given vehicle until its factsheet and a supervised run exist (validation stays `integration_tested`).
 */
export class Vda5050Adapter implements RobotAdapter {
  readonly executor = 'native' as const;
  private tracked = new Map<string, Tracked>();
  private listeners = new Set<(e: RobotEvent) => void>();
  private lastState?: VdaState;
  private connection: ConnectionState | 'UNKNOWN' = 'UNKNOWN';
  private headerId = 0;
  private bootEpoch = 1;
  private eventCounter = 0n;
  private readonly now: () => number;
  private readonly ns: string;
  private unsubscribe: (() => void)[] = [];
  /** Messages dropped, by reason — diagnostics for the operator and for the conformance suite. */
  readonly rejectedMessages: Record<string, number> = {};
  constructor(private manifest: RobotManifest, private transport: Vda5050Transport, private options: Vda5050Options) {
    if (manifest.validation === 'hardware_validated' || manifest.validation === 'venue_approved') throw new Error('VALIDATION_LEVEL_NOT_EARNED');
    if (manifest.protocolVersion !== VDA_VERSION) throw new Error('UNSUPPORTED_PROTOCOL_VERSION');
    this.now = options.now ?? Date.now;
    this.ns = options.interfaceName ?? 'uagv';
    this.unsubscribe.push(transport.subscribe(stateTopic(this.ns, options.identity), (m, meta) => this.onState(m, meta.retained)));
    this.unsubscribe.push(transport.subscribe(connectionTopic(this.ns, options.identity), m => this.onConnection(m)));
  }
  close(): void { for (const u of this.unsubscribe) u(); this.unsubscribe = []; }
  private drop(reason: string): void { this.rejectedMessages[reason] = (this.rejectedMessages[reason] ?? 0) + 1; }
  private emit(type: RobotEvent['type'], t: Tracked, payload: Record<string, unknown> = {}): void {
    const event: RobotEvent = { type, id: `vda-${t.command.commandId}-${++this.eventCounter}`, commandId: t.command.commandId, bootId: `vda-boot-${this.bootEpoch}`, sequence: String(this.eventCounter), observedAt: new Date(this.now()).toISOString(), payload: { robotId: this.manifest.id, orderId: t.orderId, orderUpdateId: t.update, ...payload } as RobotEvent['payload'] };
    for (const l of this.listeners) l(event);
  }
  private onConnection(raw: string): void {
    let message; try { message = parseConnection(JSON.parse(raw)); } catch { message = undefined; }
    if (!message) return this.drop('invalid-connection');
    if (message.manufacturer !== this.options.identity.manufacturer || message.serialNumber !== this.options.identity.serialNumber) return this.drop('foreign-vehicle');
    this.connection = message.connectionState;
    if (message.connectionState !== 'ONLINE') for (const t of this.tracked.values()) if (t.status === 'executing') { t.status = 'unknown'; t.evidence = { ...t.evidence, connection: message.connectionState }; this.emit('unknown', t, { connection: message.connectionState }); }
  }
  private onState(raw: string, retained: boolean): void {
    if (retained) return this.drop('retained'); // a broker replaying an old state is history, not news
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return this.drop('invalid-json'); }
    if (validateState(parsed).length) return this.drop('invalid-state');
    const s = parsed as VdaState;
    if (s.manufacturer !== this.options.identity.manufacturer || s.serialNumber !== this.options.identity.serialNumber) return this.drop('foreign-vehicle');
    const last = this.lastState;
    if (last) {
      if (s.headerId === last.headerId && s.timestamp === last.timestamp) return this.drop('duplicate');
      if (s.headerId <= last.headerId) {
        if (Date.parse(s.timestamp) <= Date.parse(last.timestamp)) return this.drop('out-of-order');
        this.bootEpoch++; // header ids restart at a controller boot: nothing it did before is vouched for any more
        for (const t of this.tracked.values()) if (t.status === 'executing') { t.status = 'unknown'; t.evidence = { ...t.evidence, rebooted: true }; this.emit('unknown', t, { rebooted: true }); }
      }
    }
    this.lastState = s;
    if (this.connection === 'UNKNOWN') this.connection = 'ONLINE';
    for (const t of this.tracked.values()) this.apply(t, s);
    const fatal = s.errors.some(e => e.errorLevel === 'FATAL'), eStop = s.safetyState.eStop !== 'NONE';
    if (s.paused) for (const t of this.tracked.values()) if (t.status === 'executing') this.emit('stop_state', t, { paused: true });
    if (fatal || eStop || s.safetyState.fieldViolation) for (const t of this.tracked.values()) if (t.status === 'executing') this.emit('safety_state', t, { eStop: s.safetyState.eStop, fieldViolation: s.safetyState.fieldViolation, fatal });
  }
  private apply(t: Tracked, s: VdaState): void {
    if (['completed', 'cancelled', 'failed'].includes(t.status) && !t.cancelActionId) return;
    if (t.cancelActionId) {
      const a = s.actionStates.find(x => x.actionId === t.cancelActionId);
      if (a?.actionStatus === 'FINISHED' && !t.cancelled) { t.cancelled = true; t.status = 'cancelled'; this.emit('cancelled', t); return; }
      if (a?.actionStatus === 'FAILED') t.evidence = { ...t.evidence, cancelFailed: a.resultDescription ?? true };
    }
    if (s.orderId !== t.orderId) return; // another order (or none): says nothing about this command
    if (s.orderUpdateId < t.update) return; // an older update's state can never complete a newer one
    if (s.orderUpdateId > t.update) { if (t.status === 'executing') { t.status = 'unknown'; t.evidence = { ...t.evidence, superseded: s.orderUpdateId }; this.emit('unknown', t, { superseded: s.orderUpdateId }); } return; }
    if (new Date(s.timestamp).getTime() < t.issuedAtMs) return this.drop('older-than-order');
    const err = s.errors.find(e => e.errorType.startsWith('order') && e.errorLevel === 'FATAL') ?? s.errors.find(e => e.errorLevel === 'FATAL');
    const failed = s.actionStates.find(a => a.actionStatus === 'FAILED' && a.actionId !== t.cancelActionId);
    if (!t.acked) { if (err && err.errorType.startsWith('order')) { t.rejected = err.errorType; t.status = 'failed'; this.emit('rejected', t, { reason: err.errorType }); return; } t.acked = true; t.status = 'executing'; this.emit('accepted', t); }
    if (err || failed) { t.status = 'failed'; t.evidence = { ...t.evidence, error: err?.errorType ?? failed?.resultDescription ?? 'action-failed' }; this.emit('failed', t, { reason: t.evidence.error }); return; }
    if (orderFinished(s, t.targetNodeId)) { t.status = 'completed'; t.evidence = { ...t.evidence, lastNodeId: s.lastNodeId, orderUpdateId: s.orderUpdateId }; this.emit('completed', t, { lastNodeId: s.lastNodeId }); }
    else if (t.status === 'unknown' && this.connection === 'ONLINE') { t.status = 'executing'; }
  }
  async describe(): Promise<RobotManifest> { return structuredClone(this.manifest); }
  async resolveTarget(target: TargetBinding): Promise<ResolvedTarget> {
    if (target.mapId !== this.manifest.mapId || target.mapRevision !== this.manifest.mapRevision) throw new Error('MAP_MISMATCH');
    if (!target.locationRef || !/^[A-Za-z0-9_.:-]{1,64}$/.test(target.locationRef)) throw new Error('INVALID_TARGET'); // a VDA target is a node of the vehicle's own graph
    return { kind: 'vendor', mapId: target.mapId, mapRevision: target.mapRevision, locationRef: target.locationRef };
  }
  async estimateReachability(target: ResolvedTarget) {
    const s = this.lastState;
    if (this.connection !== 'ONLINE' || !s) return { reachable: false, reason: 'NOT_CONNECTED' };
    if (target.mapId !== this.manifest.mapId || target.mapRevision !== this.manifest.mapRevision) return { reachable: false, reason: 'MAP_MISMATCH' };
    if (s.operatingMode !== 'AUTOMATIC') return { reachable: false, reason: 'NOT_AUTOMATIC' };
    if (s.errors.some(e => e.errorLevel === 'FATAL') || s.safetyState.eStop !== 'NONE') return { reachable: false, reason: 'VEHICLE_FAULT' };
    return { reachable: true, reason: 'OK' };
  }
  executionHold(): string | undefined { return this.connection === 'ONLINE' && this.lastState ? undefined : 'VDA_NOT_CONNECTED'; }
  private async waitFor(done: () => boolean): Promise<boolean> {
    const deadline = Date.now() + (this.options.ackTimeoutMs ?? 5000);
    while (!done()) { if (Date.now() >= deadline) return false; await new Promise(r => setTimeout(r, 5)); }
    return true;
  }
  async execute(command: RobotCommand) {
    const hash = hashPayload(command as never), old = this.tracked.get(command.commandId);
    if (old) { if (old.hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT'); return { accepted: !old.rejected && old.status !== 'failed', nativeGoalId: `${old.orderId}#${old.update}`, unknown: old.status === 'unknown' }; }
    if (command.robotId !== this.manifest.id) return { accepted: false, unknown: false, reason: 'ROBOT_MISMATCH' };
    if (Date.parse(command.expiresAt) <= this.now()) return { accepted: false, unknown: false, reason: 'EXPIRED_COMMAND' };
    if (command.target.mapId !== this.manifest.mapId || command.target.mapRevision !== this.manifest.mapRevision) return { accepted: false, unknown: false, reason: 'MAP_MISMATCH' };
    const s = this.lastState;
    if (this.connection !== 'ONLINE' || !s) return { accepted: false, unknown: false, reason: this.connection !== 'ONLINE' ? 'NOT_CONNECTED' : 'NO_STATE' }; // nothing was sent
    if (s.operatingMode !== 'AUTOMATIC') return { accepted: false, unknown: false, reason: 'NOT_AUTOMATIC' };
    const prior = [...this.tracked.values()].filter(t => t.orderId === command.missionId);
    if (prior.some(t => t.update >= command.missionRevision)) return { accepted: false, unknown: false, reason: 'STALE_ORDER_UPDATE' };
    const isUpdate = prior.length > 0 || s.orderId === command.missionId;
    let built;
    try { built = buildOrder({ ...this.options.identity, headerId: this.headerId++, now: new Date(this.now()), command, currentNodeId: s.lastNodeId, currentSequenceId: isUpdate ? s.lastNodeSequenceId : 0 }); }
    catch (e) { return { accepted: false, unknown: false, reason: (e as Error).message }; }
    const t: Tracked = { command: structuredClone(command), hash, orderId: built.order.orderId, update: built.order.orderUpdateId, targetNodeId: built.targetNodeId, issuedAtMs: this.now(), status: 'sending', evidence: {}, acked: false };
    this.tracked.set(command.commandId, t);
    try { await this.transport.publish(orderTopic(this.ns, this.options.identity), JSON.stringify(built.order), { retain: false, qos: 1 }); }
    catch { t.status = 'unknown'; return { accepted: false, unknown: true, reason: 'PUBLISH_FAILED' }; } // may or may not have left the machine
    if (!await this.waitFor(() => t.acked || t.rejected !== undefined)) { t.status = 'unknown'; return { accepted: false, unknown: true, reason: 'NO_STATE_ACK', nativeGoalId: `${t.orderId}#${t.update}` }; }
    if (t.rejected) return { accepted: false, unknown: false, reason: t.rejected };
    return { accepted: true, nativeGoalId: `${t.orderId}#${t.update}`, unknown: false };
  }
  async cancel(commandId: string) {
    const t = this.tracked.get(commandId);
    if (!t || this.connection !== 'ONLINE') return { acknowledged: false, unknown: true };
    if (t.status === 'completed') return { acknowledged: false, unknown: false };
    t.cancelActionId = `cancel-${t.orderId}-${t.update}`;
    try { await this.transport.publish(instantActionsTopic(this.ns, this.options.identity), JSON.stringify(instantAction({ ...this.options.identity, headerId: this.headerId++, now: new Date(this.now()), actionType: 'cancelOrder', actionId: t.cancelActionId })), { retain: false, qos: 1 }); }
    catch { return { acknowledged: false, unknown: true }; }
    if (await this.waitFor(() => t.cancelled === true || t.evidence.cancelFailed !== undefined)) return { acknowledged: t.cancelled === true, unknown: false };
    return { acknowledged: false, unknown: true };
  }
  async requestStop(reason: string) {
    if (!reason) throw new Error('STOP_REASON_REQUIRED');
    try { await this.transport.publish(instantActionsTopic(this.ns, this.options.identity), JSON.stringify(instantAction({ ...this.options.identity, headerId: this.headerId++, now: new Date(this.now()), actionType: 'startPause', actionId: `pause-${this.now()}` })), { retain: false, qos: 1 }); }
    catch { return { acknowledged: false, physicalStopConfirmed: false }; }
    return { acknowledged: true, physicalStopConfirmed: false }; // a pause request: the E-stop stays a hardware matter
  }
  observe(listener: (e: RobotEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async reconcile(commandId: string): Promise<NativeExecutionState> {
    const t = this.tracked.get(commandId);
    if (!t) return { status: 'unknown', evidence: { reason: 'NEVER_SENT_OR_FORGOTTEN' } };
    return { status: t.status, evidence: { ...t.evidence, orderId: t.orderId, orderUpdateId: t.update, lastNodeId: this.lastState?.lastNodeId ?? null, connection: this.connection } as never };
  }
}
