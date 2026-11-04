import { Vda5050Adapter, type Vda5050Transport } from '../../packages/robot-adapters/src/vda5050/adapter';
import { VDA_VERSION, validateOrder, type VdaOrder } from '../../packages/robot-adapters/src/vda5050/orders';
import type { VdaState } from '../../packages/robot-adapters/src/vda5050/state';
import type { RobotCommand, RobotManifest } from '../../packages/contracts/src/index';
import type { RobotEvent } from '../../packages/robot-adapters/src/contract';
type Handler = (message: string, meta: { retained: boolean }) => void;
/**
 * VDA 5050 rig: an in-memory broker (publish/subscribe by exact topic, no retained flag honoured for commands) and a small vehicle emulator speaking 2.0.0. It is an EMULATOR:
 * `rig.emulated` is always true and nothing here is evidence about a real vehicle or broker.
 */
export async function createVdaRig(options: { version?: string; identity?: { manufacturer: string; serialNumber: string }; ackTimeoutMs?: number } = {}) {
  const version = options.version ?? VDA_VERSION;
  if (version !== VDA_VERSION) throw new Error(`PREREQUISITE: no VDA 5050 ${version} profile (a pinned official schema, a factsheet and a trace are required first)`);
  const identity = options.identity ?? { manufacturer: 'acme', serialNumber: 'agv-1' }, clock = { ms: Date.parse('2026-11-04T08:00:00Z') };
  const subs = new Map<string, Set<Handler>>(), published: { topic: string; message: string; retain: boolean }[] = [];
  let publishFails = false, ackOrders = true, header = 1, last: Partial<VdaState> = {};
  const deliver = (topic: string, message: string, retained = false) => { for (const h of subs.get(topic) ?? []) h(message, { retained }); };
  const transport: Vda5050Transport = {
    async publish(topic, message, o) { if (publishFails) throw new Error('BROKER_DOWN'); published.push({ topic, message, retain: o.retain }); vehicleReceives(topic, message); },
    subscribe(topic, handler) { const set = subs.get(topic) ?? new Set(); set.add(handler); subs.set(topic, set); return () => set.delete(handler); },
  };
  const topic = (name: string, who = identity) => `uagv/v2/${who.manufacturer}/${who.serialNumber}/${name}`;
  const manifest: RobotManifest = { id: 'agv-1', adapter: 'vda5050', protocolVersion: VDA_VERSION, firmware: 'emulator', capabilities: ['delivery'], mapId: 'floor-1', mapRevision: 'rev-1', offlineExecution: true, maxLoadMinor: '20000', trays: 2, validation: 'integration_tested', targetKind: 'vendor' };
  const adapter = new Vda5050Adapter(manifest, transport, { identity, now: () => clock.ms, ackTimeoutMs: options.ackTimeoutMs ?? 40 });
  const events: RobotEvent[] = []; adapter.observe(e => events.push(e));
  const stateOf = (over: Partial<VdaState> = {}, who = identity): VdaState => ({ headerId: header++, timestamp: new Date(clock.ms).toISOString(), version: VDA_VERSION, manufacturer: who.manufacturer, serialNumber: who.serialNumber, orderId: '', orderUpdateId: 0, lastNodeId: 'dock', lastNodeSequenceId: 0, driving: false, operatingMode: 'AUTOMATIC',
    nodeStates: [], edgeStates: [], actionStates: [], errors: [], batteryState: { batteryCharge: 80, charging: false }, safetyState: { eStop: 'NONE', fieldViolation: false }, ...over });
  const sendState = (over: Partial<VdaState> = {}, who = identity, retained = false) => { const s = stateOf(over, who); if (who === identity && !retained) last = s; deliver(topic('state', who), JSON.stringify(s), retained); return s; };
  let currentOrder: VdaOrder | undefined;
  function vehicleReceives(t: string, message: string) {
    const m = JSON.parse(message) as Record<string, unknown>;
    if (t === topic('order')) {
      currentOrder = m as unknown as VdaOrder;
      if (!ackOrders) return;
      const problems = validateOrder(m);
      if (problems.length) { sendState({ errors: [{ errorType: 'orderError', errorLevel: 'FATAL', errorDescription: problems.join(';') }], orderId: String(m.orderId), orderUpdateId: Number(m.orderUpdateId) }); return; }
      const nodes = currentOrder.nodes, edges = currentOrder.edges, here = nodes[0]!;
      sendState({ orderId: currentOrder.orderId, orderUpdateId: currentOrder.orderUpdateId, lastNodeId: here.nodeId, lastNodeSequenceId: here.sequenceId, driving: true, nodeStates: nodes.slice(1).map(n => ({ nodeId: n.nodeId, sequenceId: n.sequenceId, released: true })), edgeStates: edges.map(e => ({ edgeId: e.edgeId, sequenceId: e.sequenceId, released: true })) });
    } else if (t === topic('instantActions')) {
      const action = (m.instantActions as { actionType: string; actionId: string }[])[0]!;
      if (action.actionType === 'cancelOrder') again({ actionStates: [{ actionId: action.actionId, actionType: 'cancelOrder', actionStatus: cancelResult }], nodeStates: [], edgeStates: [], driving: false });
      if (action.actionType === 'startPause') again({ paused: true, driving: false });
    }
  }
  let cancelResult: 'FINISHED' | 'FAILED' | 'WAITING' = 'FINISHED';
  const again = (over: Partial<VdaState> = {}) => { const { headerId: _h, timestamp: _t, ...rest } = last; void _h; void _t; return sendState({ ...rest, ...over }); };
  const command = (over: Partial<RobotCommand> & { orderId?: string; orderUpdateId?: number; node?: string } = {}): RobotCommand => ({ schemaVersion: 1, commandId: over.commandId ?? `cmd-${over.orderId ?? 'o-1'}-${over.orderUpdateId ?? 1}`, operationId: 'op-1', organizationId: 'org', venueId: 'venue', robotId: 'agv-1', missionId: over.orderId ?? 'o-1', stopId: 'stop-1',
    missionRevision: over.orderUpdateId ?? 1, controlEpoch: 1, issuerDeviceId: 'coordinator', issuedAt: new Date(clock.ms).toISOString(), expiresAt: new Date(clock.ms + 600000).toISOString(),
    target: { waypointId: 'wp', mapId: 'floor-1', mapRevision: 'rev-1', frame: 'map', kind: 'vendor', locationRef: over.node ?? 'table-1' }, limits: { trays: 2, maxLoadMinor: '20000', speedLimitMps: 0.8 }, ...(over.limits ? { limits: over.limits } : {}) } as RobotCommand);
  const rig = {
    emulated: true as const, adapter, identity, manifest, events, published, clock, command, topic, transport,
    /** the vehicle powers up and says so */
    async online() { deliver(topic('connection'), JSON.stringify({ headerId: 0, timestamp: new Date(clock.ms).toISOString(), version: VDA_VERSION, ...identity, connectionState: 'ONLINE' })); sendState(); },
    connection(state: 'ONLINE' | 'OFFLINE' | 'CONNECTIONBROKEN', who = identity) { deliver(topic('connection', who), JSON.stringify({ headerId: header++, timestamp: new Date(clock.ms).toISOString(), version: VDA_VERSION, ...who, connectionState: state })); },
    /** plan helper: dispatch an order (orderId, orderUpdateId) through the adapter */
    async startOrder(o: { orderId: string; orderUpdateId: number; node?: string; commandId?: string }) { const c = command(o); return { command: c, result: await adapter.execute(c) }; },
    state: (over: Partial<VdaState> = {}) => sendState(over), sendState, stateOf,
    retainedState: (over: Partial<VdaState> = {}) => sendState(over, identity, true),
    raw: (message: string) => deliver(topic('state'), message),
    rawConnection: (message: string) => deliver(topic('connection'), message),
    arrive() { const o = currentOrder!; return sendState({ orderId: o.orderId, orderUpdateId: o.orderUpdateId, lastNodeId: o.nodes.at(-1)!.nodeId, lastNodeSequenceId: o.nodes.at(-1)!.sequenceId, driving: false, nodeStates: [], edgeStates: [] }); },
    failOrder: () => again({ errors: [{ errorType: 'navigationError', errorLevel: 'FATAL', errorDescription: 'blocked' }] }),
    orders: () => published.filter(p => p.topic === topic('order')).map(p => JSON.parse(p.message) as VdaOrder),
    completedEvents: () => events.filter(e => e.type === 'completed'),
    set ackOrders(v: boolean) { ackOrders = v; }, set publishFails(v: boolean) { publishFails = v; }, set cancelResult(v: 'FINISHED' | 'FAILED' | 'WAITING') { cancelResult = v; },
    advance(ms: number) { clock.ms += ms; },
    reboot() { header = 0; clock.ms += 60000; },
    async close() { adapter.close(); },
  };
  await rig.online();
  return rig;
}
