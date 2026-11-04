import { expect, test } from 'vitest';
import { createVdaRig } from '../support/vda-rig';
import { Vda5050Adapter } from '../../packages/robot-adapters/src/vda5050/adapter';
import { buildOrder, validateOrder } from '../../packages/robot-adapters/src/vda5050/orders';
import { currentOrderState, validateState, orderFinished } from '../../packages/robot-adapters/src/vda5050/state';
import { instantAction, validateInstantActions } from '../../packages/robot-adapters/src/vda5050/instant-actions';
import { parseConnection } from '../../packages/robot-adapters/src/vda5050/connection';
import { catalog, loadEnabledProfiles } from '../../integrations/core/src/profile';
test('state for an older order update cannot complete the current mission', async () => {
  const rig = await createVdaRig({ version: '2.0.0' });
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 2 });
    rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1' });
    expect(rig.completedEvents()).toHaveLength(0);
    rig.state({ orderId: 'o-1', orderUpdateId: 2, lastNodeId: 'table-1', driving: false });
    expect(rig.completedEvents()).toHaveLength(1); // the right update, arrived, nothing left to traverse
  } finally { await rig.close(); }
});
test('a version this build has no pinned schema for is a failing prerequisite, never a guess', async () => {
  await expect(createVdaRig({ version: '3.0.0' })).rejects.toThrow('PREREQUISITE');
  const rig = await createVdaRig();
  try { expect(() => new Vda5050Adapter({ ...rig.manifest, protocolVersion: '3.0.0' }, rig.transport, { identity: rig.identity })).toThrow('UNSUPPORTED_PROTOCOL_VERSION'); } finally { await rig.close(); }
});
test('an order is a schema-valid graph from where the vehicle is to the named node, with the speed limit and no retain', async () => {
  const rig = await createVdaRig();
  try {
    const { result } = await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1, node: 'table-4' });
    expect(result).toMatchObject({ accepted: true, unknown: false, nativeGoalId: 'o-1#1' });
    const [order] = rig.orders();
    expect(validateOrder(order)).toEqual([]);
    expect(order).toMatchObject({ version: '2.0.0', orderId: 'o-1', orderUpdateId: 1, manufacturer: 'acme', serialNumber: 'agv-1' });
    expect(order!.nodes.map(n => [n.nodeId, n.sequenceId])).toEqual([['dock', 0], ['table-4', 2]]);
    expect(order!.edges[0]).toMatchObject({ sequenceId: 1, startNodeId: 'dock', endNodeId: 'table-4', maxSpeed: 0.8 });
    expect(rig.published.every(p => p.retain === false)).toBe(true); // a command must never be replayed to a vehicle that connects later
    expect(rig.events.map(e => e.type)).toEqual(['accepted']);
    expect(await rig.adapter.reconcile('cmd-o-1-1')).toMatchObject({ status: 'executing' });
  } finally { await rig.close(); }
});
test('completion needs the same order, update and target node, nothing left to traverse, not driving, actions finished; a duplicate completion is silent', async () => {
  const rig = await createVdaRig();
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1', driving: true, nodeStates: [], edgeStates: [] });
    rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'dock', driving: false });
    rig.state({ orderId: 'o-9', orderUpdateId: 1, lastNodeId: 'table-1', driving: false });
    rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1', driving: false, actionStates: [{ actionId: 'a', actionStatus: 'RUNNING' }] });
    expect(rig.completedEvents()).toHaveLength(0);
    rig.arrive(); rig.arrive(); rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1' });
    expect(rig.completedEvents()).toHaveLength(1);
    expect(await rig.adapter.reconcile('cmd-o-1-1')).toMatchObject({ status: 'completed', evidence: { lastNodeId: 'table-1' } });
  } finally { await rig.close(); }
});
test('an order update of the same mission starts at the vehicle\'s node and sequence; a stale or repeated update is refused before anything is sent', async () => {
  const rig = await createVdaRig();
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 }); rig.arrive();
    const next = await rig.startOrder({ orderId: 'o-1', orderUpdateId: 2, node: 'table-2' });
    expect(next.result.accepted).toBe(true);
    const update = rig.orders()[1]!;
    expect(update).toMatchObject({ orderId: 'o-1', orderUpdateId: 2 });expect(update.nodes[0]).toMatchObject({ nodeId: 'table-1', sequenceId: 2 });expect(update.nodes[1]).toMatchObject({ nodeId: 'table-2', sequenceId: 4 });
    expect(validateOrder(update)).toEqual([]);
    const before = rig.orders().length;
    expect((await rig.startOrder({ orderId: 'o-1', orderUpdateId: 2, node: 'table-9', commandId: 'dup-2' })).result).toMatchObject({ accepted: false, reason: 'STALE_ORDER_UPDATE' });
    expect((await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1, node: 'table-9', commandId: 'old-1' })).result).toMatchObject({ accepted: false, reason: 'STALE_ORDER_UPDATE' });
    expect(rig.orders()).toHaveLength(before);
    // the older update's late state does not complete the newer command, and a newer update supersedes the older one as unknown
    rig.state({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1' });
    expect(rig.completedEvents()).toHaveLength(1); // only the first (already completed) one
    expect(await rig.adapter.execute(next.command)).toMatchObject({ accepted: true }); // same command again = the same order, nothing re-sent
    expect(rig.orders()).toHaveLength(before);
    await expect(rig.adapter.execute({ ...next.command, target: { ...next.command.target, locationRef: 'elsewhere' } })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  } finally { await rig.close(); }
});
test('the vehicle can refuse an order; an unanswered order is unknown, not accepted; nothing is sent when not connected', async () => {
  const rig = await createVdaRig();
  try {
    rig.ackOrders = false;
    const silent = await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    expect(silent.result).toMatchObject({ accepted: false, unknown: true, reason: 'NO_STATE_ACK' });expect(await rig.adapter.reconcile(silent.command.commandId)).toMatchObject({ status: 'unknown' });
    rig.ackOrders = true; rig.publishFails = true;
    expect((await rig.startOrder({ orderId: 'o-2', orderUpdateId: 1 })).result).toMatchObject({ accepted: false, unknown: true, reason: 'PUBLISH_FAILED' });
    rig.publishFails = false;
    const before = rig.published.length;
    rig.connection('OFFLINE');
    expect((await rig.startOrder({ orderId: 'o-3', orderUpdateId: 1 })).result).toMatchObject({ accepted: false, unknown: false, reason: 'NOT_CONNECTED' });
    expect(rig.published).toHaveLength(before);
    expect(await rig.adapter.estimateReachability(await rig.adapter.resolveTarget({ waypointId: 'w', mapId: 'floor-1', mapRevision: 'rev-1', frame: 'map', locationRef: 'table-1' }))).toMatchObject({ reachable: false });
  } finally { await rig.close(); }
});
test('a fatal error or failed action fails the mission; an order error is a rejection', async () => {
  const rig = await createVdaRig();
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });rig.failOrder();
    expect(rig.events.map(e => e.type)).toContain('failed');expect(await rig.adapter.reconcile('cmd-o-1-1')).toMatchObject({ status: 'failed' });
    const bad = await rig.startOrder({ orderId: 'o-2', orderUpdateId: 1, node: 'bad node!' });
    expect(bad.result).toMatchObject({ accepted: false, unknown: false });
  } finally { await rig.close(); }
});
test('cancel is an instant action: finished = cancelled, failed = not cancelled, unanswered = unknown; stop is a pause request and never a confirmed stop', async () => {
  const rig = await createVdaRig({ ackTimeoutMs: 30 });
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    expect(await rig.adapter.cancel('cmd-o-1-1')).toEqual({ acknowledged: true, unknown: false });expect(rig.events.map(e => e.type)).toContain('cancelled');
    const action = rig.published.find(p => p.topic.endsWith('/instantActions'))!;expect(validateInstantActions(JSON.parse(action.message))).toEqual([]);expect(JSON.parse(action.message).instantActions[0].actionType).toBe('cancelOrder');
    await rig.startOrder({ orderId: 'o-2', orderUpdateId: 1 });rig.cancelResult = 'FAILED';
    expect(await rig.adapter.cancel('cmd-o-2-1')).toEqual({ acknowledged: false, unknown: false });
    await rig.startOrder({ orderId: 'o-3', orderUpdateId: 1 });rig.cancelResult = 'WAITING';
    expect(await rig.adapter.cancel('cmd-o-3-1')).toEqual({ acknowledged: false, unknown: true });
    expect(await rig.adapter.cancel('never-sent')).toEqual({ acknowledged: false, unknown: true });
    expect(await rig.adapter.requestStop('operator')).toEqual({ acknowledged: true, physicalStopConfirmed: false });
    expect(JSON.parse(rig.published.at(-1)!.message).instantActions[0].actionType).toBe('startPause');
    await expect(rig.adapter.requestStop('')).rejects.toThrow('STOP_REASON_REQUIRED');
  } finally { await rig.close(); }
});
test('duplicate, out-of-order, retained, foreign-vehicle, wrong-version and malformed state messages complete nothing', async () => {
  const rig = await createVdaRig();
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    const arrived = { orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1' };
    const done = rig.stateOf({ ...arrived, headerId: 500 });
    rig.retainedState(arrived);
    rig.raw(JSON.stringify(rig.stateOf(arrived, { manufacturer: 'acme', serialNumber: 'agv-2' }))); // another vehicle's state on our topic
    rig.sendState({ ...arrived, version: '3.0.0' });
    rig.raw('{not json');rig.raw(JSON.stringify({ ...rig.stateOf(arrived), driving: 'yes' }));
    expect(rig.completedEvents()).toHaveLength(0);
    rig.raw(JSON.stringify(done)); rig.raw(JSON.stringify(done)); // delivered twice
    rig.raw(JSON.stringify({ ...done, headerId: 10, timestamp: new Date(rig.clock.ms - 5000).toISOString() })); // arrives late
    expect(rig.completedEvents()).toHaveLength(1);
    expect(rig.adapter.rejectedMessages).toMatchObject({ retained: 1, 'foreign-vehicle': 1, 'invalid-state': 2, 'invalid-json': 1, duplicate: 1, 'out-of-order': 1 });
  } finally { await rig.close(); }
});
test('broker reconnect: a broken connection makes a running mission unknown, never complete; fresh state resumes it; a controller reboot is never taken as completion', async () => {
  const rig = await createVdaRig();
  try {
    await rig.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    rig.connection('CONNECTIONBROKEN');
    expect(await rig.adapter.reconcile('cmd-o-1-1')).toMatchObject({ status: 'unknown', evidence: { connection: 'CONNECTIONBROKEN' } });
    rig.connection('ONLINE');rig.arrive();
    expect(rig.completedEvents()).toHaveLength(1);
    await rig.startOrder({ orderId: 'o-2', orderUpdateId: 1, node: 'table-2' });
    rig.reboot(); rig.state({ orderId: '', orderUpdateId: 0, lastNodeId: 'dock' }); // header ids restarted: the vehicle lost its order
    expect(await rig.adapter.reconcile('cmd-o-2-1')).toMatchObject({ status: 'unknown', evidence: { rebooted: true } });
    expect(rig.completedEvents()).toHaveLength(1);
    // the old state, replayed by the broker after the reconnect, is history
    const events = rig.events.length;rig.retainedState({ orderId: 'o-2', orderUpdateId: 1, lastNodeId: 'table-2' });expect(rig.events).toHaveLength(events);
  } finally { await rig.close(); }
});
test('vehicles are isolated by manufacturer and serial: topics differ and a neighbour\'s messages are ignored', async () => {
  const a = await createVdaRig({ identity: { manufacturer: 'acme', serialNumber: 'agv-1' } }), b = await createVdaRig({ identity: { manufacturer: 'acme', serialNumber: 'agv-2' } });
  try {
    await a.startOrder({ orderId: 'o-1', orderUpdateId: 1 });
    expect(a.published.every(p => p.topic.startsWith('uagv/v2/acme/agv-1/'))).toBe(true);expect(b.published).toHaveLength(0);
    const neighbour = { manufacturer: 'acme', serialNumber: 'agv-2' };
    a.rawConnection(JSON.stringify({ headerId: 9, timestamp: new Date(a.clock.ms).toISOString(), version: '2.0.0', ...neighbour, connectionState: 'OFFLINE' })); // misrouted onto agv-1's topic
    a.raw(JSON.stringify(a.stateOf({ orderId: 'o-1', orderUpdateId: 1, lastNodeId: 'table-1' }, neighbour)));
    expect((await a.adapter.estimateReachability({ kind: 'vendor', mapId: 'floor-1', mapRevision: 'rev-1', locationRef: 'table-1' })).reachable).toBe(true); // agv-2 going offline did not touch agv-1
    expect(a.completedEvents()).toHaveLength(0);expect(a.adapter.rejectedMessages['foreign-vehicle']).toBe(2);
  } finally { await a.close(); await b.close(); }
});
test('the adapter claims no more than it has earned and the profile is an emulator profile', async () => {
  const rig = await createVdaRig();
  try {
    expect(rig.adapter.executor).toBe('native'); // production mutations go through the native executor's journal
    expect((await rig.adapter.describe()).validation).toBe('integration_tested');
    expect(() => new Vda5050Adapter({ ...rig.manifest, validation: 'hardware_validated' }, rig.transport, { identity: rig.identity })).toThrow('VALIDATION_LEVEL_NOT_EARNED');
    expect(() => new Vda5050Adapter({ ...rig.manifest, validation: 'venue_approved' }, rig.transport, { identity: rig.identity })).toThrow('VALIDATION_LEVEL_NOT_EARNED');
    const profile = catalog.find(p => p.id === 'vda5050-2.0.0')!;expect(profile).toMatchObject({ kind: 'robot-protocol', mode: 'simulation', version: '2.0.0' });
    expect(loadEnabledProfiles(catalog, 'release').some(p => p.kind === 'robot-protocol')).toBe(false);
    await expect(rig.adapter.resolveTarget({ waypointId: 'w', mapId: 'other', mapRevision: 'rev-1', frame: 'map', locationRef: 'n' })).rejects.toThrow('MAP_MISMATCH');
    await expect(rig.adapter.resolveTarget({ waypointId: 'w', mapId: 'floor-1', mapRevision: 'rev-1', frame: 'map', x: 1, y: 2 })).rejects.toThrow('INVALID_TARGET'); // coordinates are not VDA nodes
  } finally { await rig.close(); }
});
test('message validators reject what the standard forbids', () => {
  const command = { schemaVersion: 1, commandId: 'c', operationId: 'o', organizationId: 'x', venueId: 'v', robotId: 'agv-1', missionId: 'm-1', stopId: 's', missionRevision: 1, controlEpoch: 1, issuerDeviceId: 'd', issuedAt: '', expiresAt: '', target: { locationRef: 'n2' }, limits: { trays: 1, maxLoadMinor: '1' } };
  const { order } = buildOrder({ manufacturer: 'm', serialNumber: 's', headerId: 0, now: new Date('2026-11-04T00:00:00Z'), command: command as never, currentNodeId: 'n1', currentSequenceId: 0 });
  expect(validateOrder(order)).toEqual([]);
  expect(validateOrder({ ...order, version: '2.1.0' })).toContain('version');
  expect(validateOrder({ ...order, nodes: [{ ...order.nodes[0]!, sequenceId: 1 }, order.nodes[1]] }).join()).toMatch(/even/);
  expect(validateOrder({ ...order, edges: [{ ...order.edges[0]!, sequenceId: 2 }] }).join()).toMatch(/odd/);
  expect(validateOrder({ ...order, edges: [{ ...order.edges[0]!, endNodeId: 'ghost' }] }).join()).toMatch(/unknown node/);
  expect(validateOrder({ ...order, edges: [] }).join()).toMatch(/connect/);
  expect(() => buildOrder({ manufacturer: 'm', serialNumber: 's', headerId: 0, now: new Date(), command: { ...command, target: {} } as never, currentNodeId: 'n1', currentSequenceId: 0 })).toThrow('TARGET_NODE_REQUIRED');
  expect(validateState({ not: 'a state' }).length).toBeGreaterThan(0);expect(validateInstantActions({ version: '2.0.0', instantActions: [] })).toContain('instantActions');
  expect(parseConnection({ version: '2.0.0', manufacturer: 'a', serialNumber: 'b', connectionState: 'ONLINE', headerId: 0, timestamp: 't' })).toBeDefined();expect(parseConnection({ version: '2.0.0', manufacturer: 'a', serialNumber: 'b', connectionState: 'GONE', headerId: 0, timestamp: 't' })).toBeUndefined();
  expect(currentOrderState({ id: 'o', update: 2 }, { orderId: 'o', orderUpdateId: 2 })).toBe(true);expect(currentOrderState({ id: 'o', update: 2 }, { orderId: 'o', orderUpdateId: 1 })).toBe(false);
  expect(instantAction({ manufacturer: 'm', serialNumber: 's', headerId: 1, now: new Date(), actionType: 'stateRequest', actionId: 'a' }).instantActions[0]!.blockingType).toBe('NONE');
  expect(orderFinished({ nodeStates: [], edgeStates: [], driving: false, lastNodeId: 't', actionStates: [] } as never, 't')).toBe(true);
});
