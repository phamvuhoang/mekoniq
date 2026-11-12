// M07b: MJ-BV01 through the HTTP gateway. Readiness (engine-free, runs everywhere): the MuJoCo arm set is an arm plant set like the Webots arm's, so no separate gripper provider is
// asked for, and the mock and Webots readiness rows are exactly what they were. Real engine (skips without .venv-mujoco): a run created, stepped and reported over HTTP with a session.
// Worker double (skips without .venv-mujoco): a lost worker's stop names why.
import { afterEach, describe, expect, test } from 'vitest';
import { join, resolve } from 'node:path';
import { collectReadiness } from '../../packages/lab-runtime/src/v2/readiness';
import { defaultCatalog } from '../../packages/lab-runtime/src/v2/capabilities';
import { XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import type { RunReport } from '../../packages/lab-runtime/src/v2/report';
import { stepUntil } from '../support/lab-v2';
import { coffeeProject } from '../support/lab-v2';
import { mujocoGateway, mujocoReady, mujocoTemp, mujocoWorkers, openMujocoRun, removeMujocoDirs, xarmProject } from '../support/mujoco-arm';

const gateways: LabGateway[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); await removeMujocoDirs(); });
const installed = (id: string) => ({ ...defaultCatalog, backends: defaultCatalog.backends.map((b) => b.id === id ? { ...b, installed: true, compatible: true, reachable: true, reason: undefined } : b) });
const rows = (r: { checks: { id: string; status: string; reasonCodes: string[] }[] }) => r.checks.map((c) => [c.id, c.status, c.reasonCodes]);
const PLACEHOLDER = (id: string) => [id, 'unknown', ['IRSIM_PROVIDER_UNAVAILABLE']];

describe('readiness of the arm plant sets (no engine)', () => {
  test('MJ-BV01 on the MuJoCo arm set asks for no gripper provider: its grip is contact inside the plant', async () => {
    const r = await collectReadiness({ scenarioId: 'MJ-BV01', backendSetId: 'engineering-mujoco-arm-v1', project: xarmProject() }, { catalog: installed('mujoco_arm'), enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', 'mujoco_arm'] });
    expect(r.checks.map((c) => c.id)).not.toContain('gripper'); expect(r.checks.flatMap((c) => c.reasonCodes)).not.toContain('GRIP_PROVIDER_UNAVAILABLE');
    // with the provider's own rows (as the MuJoCo readiness answers them) the run can start
    const ready = await collectReadiness({ scenarioId: 'MJ-BV01', backendSetId: 'engineering-mujoco-arm-v1', project: xarmProject() }, { catalog: installed('mujoco_arm'), enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', 'mujoco_arm'],
      portableChecks: async () => ['profile', 'model', 'fixture', 'clock', 'runner'].map((id) => ({ id, status: 'ready' as const, reasonCodes: [], evidenceRef: null })) });
    expect(ready.canStart).toBe(true);
  });
  test('the mock BV01 and the Webots WB-BV01 readiness rows are exactly what they were', async () => {
    expect(rows(await collectReadiness({ scenarioId: 'BV01', backendSetId: 'mock-default', project: coffeeProject() }, { enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm'] }))).toEqual([
      ['scenario', 'ready', []], ['backend-set', 'ready', []], ['host', 'ready', []], ['protocol', 'ready', []], ['model', 'ready', []], ['clock', 'ready', []], ['fixture', 'ready', []], ['profile', 'ready', []],
      ['world', 'ready', []], ['backend:mock_amr', 'ready', []], ['backend:mock_coffee', 'ready', []], ['backend:mock_arm', 'ready', []], ['runner', 'ready', []]]);
    expect(rows(await collectReadiness({ scenarioId: 'WB-BV01', backendSetId: 'engineering-webots-arm-v1', project: coffeeProject() }, { catalog: installed('webots_arm'), enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', 'webots_arm'] }))).toEqual([
      ['scenario', 'ready', []], ['backend-set', 'ready', []], ['host', 'ready', []], ['protocol', 'ready', []], PLACEHOLDER('model'), PLACEHOLDER('clock'), PLACEHOLDER('fixture'), PLACEHOLDER('profile'),
      ['world', 'ready', []], ['backend:mock_amr', 'ready', []], ['backend:webots_arm', 'ready', []], ['backend:mock_coffee', 'ready', []], ['runner', 'blocked', ['IRSIM_RUNNER_UNAVAILABLE']]]);
  });
});

describe.skipIf(!mujocoReady)('MJ-BV01 over HTTP on the real engine', () => {
  test('created with a session through POST /runs, stepped with step actions to completed, the report fetched over HTTP carries the evidence', async () => {
    const gw = await mujocoGateway(), d = await mujocoTemp('mj-http-'), sim = gw.sim;
    const g = await startLabGateway({ port: 0, directory: join(d, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { catalog: sim.catalog, enabledBackends: ['mock_amr', 'mock_coffee', 'mock_arm', ...sim.enabledBackends], simulationFactory: sim.simulationFactory, ...sim.readinessChecks ? { portableChecks: sim.readinessChecks } : {} } });
    gateways.push(g);
    const paired = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) });
    const h = { cookie: paired.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await paired.json()).csrfToken) };
    const post = async (path: string, body: unknown) => { const r = await fetch(g.url + '/lab/v2' + path, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as { run: { id: string; runRevision: number; status: string }; tick: number } }; };
    const created = await post('/runs', { project: xarmProject(), scenarioId: 'MJ-BV01', scenarioRevision: 1, seed: 42, mode: 'simulation', access: 'simulated', backendSetId: 'engineering-mujoco-arm-v1', runtimeIdentity: { sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64) } });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const url = `/runs/${created.body.run.id}`; let rev = created.body.run.runRevision as number, n = 0;
    const act = async (kind: string, payload: Record<string, unknown>) => { const r = await post(`${url}/actions`, { actionId: `a-${++n}`, expectedRevision: rev, kind, payload }); expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200); rev = r.body.run.runRevision; return r.body; };
    let view = await act('start', {});
    while (['running', 'ready', 'paused'].includes(view.run.status)) { if (view.tick > 6000) throw new Error(`STEP_LIMIT at ${view.tick}`); view = await act('step', { ticks: 100 }); }
    const report = await (await fetch(g.url + '/lab/v2' + url + '/report', { headers: { cookie: h.cookie } })).json() as RunReport;
    console.log('MJ-BV01 http', JSON.stringify({ tick: view.tick, status: view.run.status, coverage: report.coverage, scene: report.arm?.collision.coverage, robotAsset: report.manifest.assets.find((a) => a.id === 'service-robot-asset')}));
    expect(view.run.status).toBe('completed'); expect(report.outcome).toMatchObject({ status: 'completed', served: '2', tick: 4800 });
    expect(report.manifest).toMatchObject({ scenario: { id: 'MJ-BV01' }, backendSetId: 'engineering-mujoco-arm-v1', calibration: { status: 'not_calibrated' } });
    expect(report.arm!.armPlant).toMatchObject({ engine: 'mujoco_3d', grip: 'contact', calibration: 'not_calibrated' });
    expect(report.arm!.collision).toMatchObject({ id: 'ARM03', result: 'pass', modelRevision: XARM6_SI.revision });
    for (const c of report.coffee!.cups) for (const m of c.movements.filter((m) => m.from.kind === 'arm' || m.to.kind === 'arm')) expect(((m.evidence?.giver ?? m.evidence) as Record<string, unknown>).grip).toBe('contact');
    // the project's robot (service-robot-asset@1) is in the server asset catalog, so a gateway run resolves it: the arm scene holds the robot and ARM03 swept against it every tick
    expect(report.manifest.assets.find((a) => a.id === 'service-robot-asset')).toMatchObject({ resolved: true });
    expect(report.coverage).toMatchObject({ armSceneCollision: true, armCollisionTraceComplete: true });
    const scene = report.coffee!.armTrace.collision!.scene!; expect(scene.available).toBe(true); expect(scene.world.map((o) => o.id)).toContain('robot:amr-1');
    await g.close(); gateways.splice(0); await new Promise((r) => setTimeout(r, 300));
    expect(mujocoWorkers()).toEqual([]);
  }, 600_000);
});

const double = resolve('tests/support/mujoco_doubles/fake_cell_plant.py');
describe.skipIf(!mujocoReady)('a lost worker says why (worker double)', () => {
  // the double's arm reaches every target at once; its pick finds no cup (no contacts), so the run is in its first cup-pick near tick 1450
  for (const [mode, at, reason, detail] of [['unstable', 1450, 'PLANT_UNSTABLE', /bad state \(fake\)/], ['quit', 1450, 'WORKER_LOST', /^WORKER_EXITED: worker exited/]] as const)
    test(`${mode}: the stop is ${reason} with the cause in its detail, the outcome unknown, readable in the run report`, async () => {
      const gw = await mujocoGateway({ entry: [double, mode, String(at)] }), { run } = await openMujocoRun(gw);
      try {
        await run.start(); const view = await stepUntil(run, undefined, 50, 20_000), report = await run.report(), stop = report.coffee!.armTrace.stop!;
        console.log('M07b loss', mode, JSON.stringify({ tick: view.tick, status: view.run.status, stop: { reason: stop.reason, detail: stop.detail }, attention: report.attention.map((a) => a.reason) }));
        expect(stop).toMatchObject({ latched: true, reason }); expect(stop.detail).toMatch(detail);
        expect(view.run.status).toBe('needs_attention'); expect(report.attention.map((a) => a.reason)).toContain('TRANSFER_UNKNOWN');
      } finally { await run.close(); }
      expect(mujocoWorkers()).toEqual([]);
    }, 120_000);
});
