import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { massRoboticsObservationCapabilities, observationFrom } from '../../integrations/robot-observation/src/massrobotics';
import { untestedCoverage, vendorProfileProblems, VendorRegistry, type VendorProfile } from '../../packages/robot-adapters/src/vendor/profile';
import { VendorSdkAdapter, type VendorSdk } from '../../packages/robot-adapters/src/vendor/sdk-adapter';
import type { RobotCommand, RobotManifest } from '../../packages/contracts/src/index';
import type { RobotEvent } from '../../packages/robot-adapters/src/contract';
import { catalog } from '../../integrations/core/src/profile';
test('observation-only interoperability never advertises motion capability', () => {
  const capabilities = massRoboticsObservationCapabilities();
  expect(capabilities.commandMotion).toBe(false);
  expect(capabilities.observePose).toBe(true);
});
const evidence = 'docs/implementation/evidence/vendor-x-conformance.md';
const profile = (over: Partial<VendorProfile> = {}, coverage: Partial<VendorProfile['coverage']> = {}): VendorProfile => ({ id: 'vendor-x', sdkName: 'vendorx-sdk', sdkVersion: '4.2.1', firmware: 'fw-9', nativeCommandIdentity: 'provider-assigned', licence: { redistributable: false, reviewRef: 'docs/licences/vendor-x.md' },
  coverage: { ...untestedCoverage(), navigate: { status: 'supported', evidence }, query: { status: 'supported', evidence }, cancel: { status: 'supported', evidence }, stop: { status: 'supported', evidence }, ...coverage }, ...over });
const manifest = (p = profile()): RobotManifest => ({ id: 'vx-1', adapter: 'vendor-sdk', protocolVersion: `${p.sdkName}@${p.sdkVersion}`, firmware: p.firmware, capabilities: ['delivery'], mapId: 'floor-1', mapRevision: 'rev-1', offlineExecution: false, maxLoadMinor: '10000', trays: 1, validation: 'integration_tested', targetKind: 'vendor' });
const command = (over: Partial<RobotCommand> = {}): RobotCommand => ({ schemaVersion: 1, commandId: 'c-1', operationId: 'o', organizationId: 'org', venueId: 'v', robotId: 'vx-1', missionId: 'm-1', stopId: 's', missionRevision: 1, controlEpoch: 1, issuerDeviceId: 'd', issuedAt: '2026-11-04T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
  target: { mapId: 'floor-1', mapRevision: 'rev-1', frame: 'map', locationRef: 'table-1' }, limits: { trays: 1, maxLoadMinor: '10000', speedLimitMps: 0.5 }, ...over }) as RobotCommand;
/** An emulated vendor SDK (our model, not any vendor's). */
function fakeSdk(options: { query?: boolean; cancel?: boolean } = {}) {
  const listeners = new Set<(e: { goalId: string; kind: 'succeeded' | 'failed' | 'cancelled' | 'progress' }) => void>(), goals = new Map<string, string>(), calls = { navigate: 0, query: 0, cancel: 0 };
  let n = 0, failNavigate = false;
  const sdk: VendorSdk = {
    async navigate(g) { calls.navigate++; if (failNavigate) throw new Error('SDK_TIMEOUT'); const goalId = g.goalId ?? `vx-goal-${++n}`; goals.set(goalId, 'running'); return { goalId }; },
    ...(options.query === false ? {} : { async query(id: string) { calls.query++; return { state: (goals.get(id) ?? 'unknown') as 'running' | 'succeeded' | 'cancelled' | 'failed' | 'unknown' }; } }),
    ...(options.cancel === false ? {} : { async cancel(id: string) { calls.cancel++; goals.set(id, 'cancelled'); return { ok: true }; } }),
    onEvent(l) { listeners.add(l); return () => listeners.delete(l); },
  };
  return { sdk, calls, emit: (goalId: string, kind: 'succeeded' | 'failed' | 'cancelled' | 'progress') => { if (kind !== 'progress') goals.set(goalId, kind); for (const l of listeners) l({ goalId, kind }); }, set: (id: string, s: string) => goals.set(id, s), failNavigate: () => { failNavigate = true; } };
}
test('a profile is exact and earns "supported" with evidence; licence review and reconcilability are required', () => {
  expect(vendorProfileProblems(profile())).toEqual([]);
  expect(vendorProfileProblems(profile({}, { navigate: { status: 'supported' } })).join()).toMatch(/without conformance evidence/);
  expect(vendorProfileProblems(profile({ sdkVersion: '' })).join()).toMatch(/exact SDK/);
  expect(vendorProfileProblems(profile({ licence: { redistributable: null, reviewRef: null } })).join()).toMatch(/licence/);
  expect(vendorProfileProblems(profile({ nativeCommandIdentity: 'none' }, { query: { status: 'untested' } })).join()).toMatch(/cannot be reconciled/);
  const registry = new VendorRegistry<string>();
  registry.register(profile(), 'adapter-A');
  expect(registry.resolve('vendorx-sdk', '4.2.1', 'fw-9')).toBe('adapter-A');
  expect(() => registry.resolve('vendorx-sdk', '4.2.2', 'fw-9')).toThrow('UNSUPPORTED_VENDOR_VERSION'); // no "compatible family"
  expect(() => registry.resolve('vendorx-sdk', '4.2.1', 'fw-10')).toThrow('UNSUPPORTED_VENDOR_VERSION');
  expect(() => registry.register(profile(), 'again')).toThrow('DUPLICATE_VENDOR_ADAPTER');
  expect(() => registry.register(profile({}, { navigate: { status: 'supported' } }), 'x')).toThrow('VENDOR_PROFILE_INVALID');
  expect(catalog.find(p => p.id === 'vendor-sdk')).toMatchObject({ status: 'draft', mode: 'sandbox' }); // no named vendor is enabled
});
test('navigation: accepted with the SDK goal id; completion only from the SDK for that goal; a foreign goal event is ignored', async () => {
  const f = fakeSdk(), events: RobotEvent[] = [], adapter = new VendorSdkAdapter(manifest(), f.sdk, profile());
  adapter.observe(e => events.push(e));
  expect(await adapter.execute(command())).toEqual({ accepted: true, nativeGoalId: 'vx-goal-1', unknown: false });
  expect(await adapter.execute(command())).toMatchObject({ accepted: true, nativeGoalId: 'vx-goal-1' }); expect(f.calls.navigate).toBe(1); // idempotent
  f.emit('some-other-goal', 'succeeded'); expect(events.map(e => e.type)).toEqual(['accepted']);
  f.emit('vx-goal-1', 'succeeded'); f.emit('vx-goal-1', 'succeeded');
  expect(events.map(e => e.type)).toEqual(['accepted', 'completed']);
  expect(await adapter.reconcile('c-1')).toMatchObject({ status: 'completed' });
  expect((await adapter.describe()).validation).toBe('integration_tested');
  adapter.close();
});
test('an SDK that cannot be asked afterwards makes an in-flight goal unknown (needs attention), never completed; one that can, tells the truth', async () => {
  const blind = fakeSdk({ query: false }), p = profile({}, { query: { status: 'untested' }, }), a = new VendorSdkAdapter(manifest(p), blind.sdk, { ...p, nativeCommandIdentity: 'caller-supplied' });
  await a.execute(command());
  expect(await a.reconcile('c-1')).toMatchObject({ status: 'unknown', evidence: { queryable: false } });
  const f = fakeSdk(), b = new VendorSdkAdapter(manifest(), f.sdk, profile());
  await b.execute(command({ commandId: 'c-2' }));
  expect(await b.reconcile('c-2')).toMatchObject({ status: 'executing' });
  f.set('vx-goal-1', 'succeeded'); expect(await b.reconcile('c-2')).toMatchObject({ status: 'completed' });
  const g = fakeSdk(); const c = new VendorSdkAdapter(manifest(), g.sdk, profile()); await c.execute(command({ commandId: 'c-3' })); g.set('vx-goal-1', 'unknown');
  expect(await c.reconcile('c-3')).toMatchObject({ status: 'unknown' });
  const broken = fakeSdk(); broken.failNavigate(); const d = new VendorSdkAdapter(manifest(), broken.sdk, profile());
  expect(await d.execute(command({ commandId: 'c-4' }))).toMatchObject({ accepted: false, unknown: true, reason: 'SDK_CALL_FAILED' }); // may have started
  expect(await d.reconcile('c-4')).toMatchObject({ status: 'unknown' });
});
test('only supported operations are translated; the rest are refused explicitly, never improvised', async () => {
  const f = fakeSdk(), p = profile({}, { cancel: { status: 'unsupported' }, stop: { status: 'untested' } }), a = new VendorSdkAdapter(manifest(p), f.sdk, p);
  await a.execute(command());
  expect(await a.cancel('c-1')).toEqual({ acknowledged: false, unknown: true }); expect(f.calls.cancel).toBe(0); // it may still be driving: unknown, not "cancelled"
  expect(await a.requestStop('operator')).toEqual({ acknowledged: false, physicalStopConfirmed: false });
  const none = profile({}, { navigate: { status: 'untested' } }), b = new VendorSdkAdapter(manifest(none), f.sdk, none);
  expect(await b.execute(command())).toMatchObject({ accepted: false, reason: 'UNSUPPORTED_OPERATION' });
  expect(await b.estimateReachability({ kind: 'vendor', mapId: 'floor-1', mapRevision: 'rev-1', locationRef: 'x' })).toMatchObject({ reachable: false, reason: 'UNSUPPORTED_OPERATION' });
  const ok = new VendorSdkAdapter(manifest(), f.sdk, profile()); await ok.execute(command({ commandId: 'c-9' }));
  expect(await ok.cancel('c-9')).toEqual({ acknowledged: true, unknown: false });
  expect(await ok.requestStop('operator')).toEqual({ acknowledged: false, physicalStopConfirmed: false }); // the fake SDK has no stop(): a profile claim without the SDK method cannot act
});
test('epoch, map, robot and expiry guards; no hardware claims; version must match the profile exactly', async () => {
  const f = fakeSdk(), a = new VendorSdkAdapter(manifest(), f.sdk, profile());
  expect(await a.execute(command({ controlEpoch: 3 }))).toMatchObject({ accepted: true });
  expect(await a.execute(command({ commandId: 'c-old', controlEpoch: 2 }))).toMatchObject({ accepted: false, reason: 'STALE_EPOCH' });
  expect(await a.execute(command({ commandId: 'c-map', controlEpoch: 3, target: { mapId: 'floor-2', mapRevision: 'rev-1', locationRef: 't' } }))).toMatchObject({ accepted: false, reason: 'MAP_MISMATCH' });
  expect(await a.execute(command({ commandId: 'c-r', controlEpoch: 3, robotId: 'other' }))).toMatchObject({ accepted: false, reason: 'ROBOT_MISMATCH' });
  expect(await a.execute(command({ commandId: 'c-x', controlEpoch: 3, expiresAt: '2020-01-01T00:00:00Z' }))).toMatchObject({ accepted: false, reason: 'EXPIRED_COMMAND' });
  expect(f.calls.navigate).toBe(1);
  expect(() => new VendorSdkAdapter({ ...manifest(), validation: 'hardware_validated' }, f.sdk, profile())).toThrow('VALIDATION_LEVEL_NOT_EARNED');
  expect(() => new VendorSdkAdapter({ ...manifest(), protocolVersion: 'vendorx-sdk@4.2.2' }, f.sdk, profile())).toThrow('UNSUPPORTED_VENDOR_VERSION');
  await expect(a.resolveTarget({ waypointId: 'w', mapId: 'floor-1', mapRevision: 'rev-9', frame: 'map', locationRef: 'x' })).rejects.toThrow('MAP_MISMATCH');
});
test('observation export is read-only: neutral record, no inbound path, and the RMF boundary names MEKONIQ as the only dispatcher', () => {
  expect(observationFrom({ id: 'r1', observedAt: 't', x: 1, y: 2, yaw: 0.5, mapId: 'm', status: 'moving', battery: 80 })).toEqual({ robotId: 'r1', observedAt: 't', pose: { x: 1, y: 2, yaw: 0.5, mapId: 'm' }, operationalState: 'moving', batteryPercent: 80 });
  expect(observationFrom({ id: 'r1', observedAt: 't', status: 'weird', battery: 500 })).toEqual({ robotId: 'r1', observedAt: 't' }); // nothing invented
  const source = readFileSync('integrations/robot-observation/src/massrobotics.ts', 'utf8');
  expect(source).not.toMatch(/subscribe|onCommand|execute\(|navigate|dispatch/);
  expect(Object.keys(massRoboticsObservationCapabilities())).not.toContain('commandDispatch');
  const doc = readFileSync('docs/integrations/rmf-boundary.md', 'utf8');
  expect(doc).toMatch(/sole dispatcher/i); expect(doc).toMatch(/not supported/);
});
