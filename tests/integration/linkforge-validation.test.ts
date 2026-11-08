// Real Python compiler + real LinkForge worker (both pinned venvs); skipped with the reason where they are not provisioned.
import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPythonCompiler } from '../../packages/lab-runtime/src/engineering/compiler';
import { createEngineeringService, EngineeringError } from '../../packages/lab-runtime/src/engineering/gateway';
import { createLinkForgeValidator, lockDigestOf, type RobotModelValidator } from '../../packages/lab-runtime/src/engineering/linkforge';
import { validateNavigationDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { engineeringFixture, writeFixtureCatalog } from '../support/engineering';
import { createNavigationCompiler } from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import { navigationFixture } from '../support/navigation2d';

const irPython = resolve('.venv-irsim/bin/python'), simPython = resolve('.venv/bin/python'), lfPython = resolve('.venv-linkforge/bin/python'), workerRoot = resolve('robotics/model-validation');
const ok = (py: string, code: string) => { try { execFileSync(py, ['-c', code], { stdio: 'ignore' }); return true; } catch { return false; } };
const available = existsSync(simPython) && existsSync(lfPython) && existsSync(irPython) && ok(irPython, 'import irsim, yaml, rfc8785') && ok(simPython, 'import rfc8785, jsonschema, referencing, yaml') && ok(lfPython, 'import linkforge.core');
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const lockDigest = () => lockDigestOf(join(workerRoot, 'requirements.lock'));

async function setup(over: { fixture?: string; profile?: boolean; validator?: RobotModelValidator | 'none'; unavailable?: string } = {}) {
  const directory = await temp('lf-'), catalogRoot = await temp('lf-cat-');
  // IR-SIM profile bundles come from the Serve/restaurant fixtures through the portable compiler; profile:false is a legacy native bundle
  const f = over.profile === false ? structuredClone(engineeringFixture('valid')) : structuredClone(navigationFixture((over.fixture ?? 'serve') as never).fixture);
  await writeFixtureCatalog(catalogRoot, f);
  const real = createLinkForgeValidator({ python: lfPython, workerRoot, timeoutMs: 20_000, lockDigest: await lockDigest() });
  const calls = { n: 0 };
  const counting: RobotModelValidator = { identity: real.identity, validate: async (i) => { calls.n += 1; return (over.validator && over.validator !== 'none' ? over.validator : real).validate(i); } };
  const service = createEngineeringService({ directory, catalogRoot, compiler: createPythonCompiler({ python: simPython, simulationRoot: 'robotics/simulation' }),
    compilers: { 'engineering-irsim-2d-v1': createNavigationCompiler({ python: irPython, workerRoot: resolve('robotics/navigation-2d'), descriptionHelperRoot: resolve('robotics/simulation') }) },
    ...(over.validator === 'none' ? { validationUnavailable: over.unavailable ?? 'LINKFORGE_DISABLED' } : { validator: counting }) });
  const receipt = await service.compileEngineeringProject(f.project, 's1');
  if (receipt.state !== 'compiled') throw new Error('FIXTURE_NOT_COMPILED ' + JSON.stringify(receipt.problems));
  return { service, calls, receipt, ref: { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest }, directory };
}
const urdfBlob = async (s: Awaited<ReturnType<typeof setup>>, session = 's1') => {
  const manifest = await s.service.readManifest(session, s.receipt.bundleDigest!);
  return manifest.files.find((x) => x.path === 'robots/amr-1.urdf')!.sha256;
};

test.skipIf(!available)('LF01/G-LF1 path: the compiled Serve-style AMR validates with full parity and the bundle URDF is untouched', async () => {
  const s = await setup();
  const before = await urdfBlob(s);
  const { report, cached } = await s.service.validateRobotModel('s1', s.ref, 'amr-1');
  expect(cached).toBe(false);
  expect(validateNavigationDocument(report)).toMatchObject({ ok: true });
  expect(report).toMatchObject({ execution: 'ran', mode: 'shadow', robotId: 'amr-1' });
  expect(report.result, JSON.stringify(report.issues.filter((i) => i.severity === 'error'))).toBe('pass');
  expect(report.checks.find((c) => c.id === 'LF-PARITY')!.result).toBe('pass');
  expect(report.inputUrdfRef).toMatchObject({ path: 'robots/amr-1.urdf', sha256: before });
  expect(report.nameMapRef).not.toBeNull();
  expect(report.engine!.lockDigest).toBe(await lockDigest());
  expect(await urdfBlob(s)).toBe(before);
});

test.skipIf(!available)('the report is cached by full identity, not re-run, and a changed model is a cache miss', async () => {
  const s = await setup();
  const first = await s.service.validateRobotModel('s1', s.ref, 'amr-1');
  const second = await s.service.validateRobotModel('s1', s.ref, 'amr-1');
  expect(second.cached).toBe(true);
  expect(second.report.reportDigest).toBe(first.report.reportDigest);
  expect(s.calls.n).toBe(1);
  const other = await setup({ fixture: 'wide' });
  const changed = await other.service.validateRobotModel('s1', other.ref, 'amr-1');
  expect(changed.report.physicalModelDigest).not.toBe(first.report.physicalModelDigest);
  expect(other.calls.n).toBe(1);
  expect((await s.service.readValidation('s1', first.report.reportDigest)).reportDigest).toBe(first.report.reportDigest);
});

test.skipIf(!available)('flag off or a missing worker is not_run and never blocks compile; a crash is failed and not cached', async () => {
  const off = await setup({ validator: 'none' });
  const r = (await off.service.validateRobotModel('s1', off.ref, 'amr-1')).report;
  expect(r).toMatchObject({ execution: 'not_run', result: 'inconclusive' });
  expect(r.issues.map((i) => i.code)).toContain('LINKFORGE_DISABLED');
  expect(validateNavigationDocument(r)).toMatchObject({ ok: true });
  const dir = await temp('lf-bad-'), crash = join(dir, 'python');
  await writeFile(crash, '#!/bin/sh\necho boom >&2\nexit 3\n'); await chmod(crash, 0o755);
  const bad = createLinkForgeValidator({ python: crash, workerRoot, timeoutMs: 5000, lockDigest: await lockDigest() });
  const broken = await setup({ validator: bad });
  const failed = (await broken.service.validateRobotModel('s1', broken.ref, 'amr-1')).report;
  expect(failed).toMatchObject({ execution: 'failed', result: 'inconclusive' });
  expect(failed.issues.map((i) => i.code)).toContain('LF_WORKER_FAILED');
  expect((await broken.service.validateRobotModel('s1', broken.ref, 'amr-1')).cached).toBe(false);
  expect(broken.calls.n).toBe(2);
});

test.skipIf(!available)('LF06: a worker that outlives its timeout is killed and reported failed', async () => {
  const dir = await temp('lf-slow-'), slow = join(dir, 'python'), pidFile = join(dir, 'pid');
  await writeFile(slow, `#!/bin/sh\n[ "$1" = "-W" ] && exit 0\necho $$ > ${pidFile}\nsleep 30\n`); await chmod(slow, 0o755);
  execFileSync(slow, ['-W']); // the first exec of a fresh script can take longer than the timeout under macOS provenance checks
  const s = await setup({ validator: createLinkForgeValidator({ python: slow, workerRoot, timeoutMs: 1500, lockDigest: await lockDigest() }) });
  const started = Date.now();
  const report = (await s.service.validateRobotModel('s1', s.ref, 'amr-1')).report;
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(report.execution).toBe('failed');
  expect(report.issues.map((i) => i.code)).toContain('LF_WORKER_TIMEOUT');
  const pid = Number(await readFile(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) { try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 100)); } catch { alive = false; } }
  expect(alive).toBe(false);
});

test.skipIf(!available)('authorization and identity: other sessions, bad refs, unknown robots and non-IR-SIM bundles are refused with codes', async () => {
  const s = await setup();
  const code = async (p: Promise<unknown>) => p.then(() => 'OK', (e) => (e as EngineeringError).code + ':' + ((e as EngineeringError).reasonCodes ?? []).join(','));
  expect(await code(s.service.validateRobotModel('intruder', s.ref, 'amr-1'))).toBe('ENGINEERING_BUNDLE_FORBIDDEN:');
  expect(await code(s.service.validateRobotModel('s1', { bundleDigest: 'x' }, 'amr-1'))).toBe('INVALID_ENGINEERING_REF:');
  expect(await code(s.service.validateRobotModel('s1', { ...s.ref, projectDigest: 'f'.repeat(64) }, 'amr-1'))).toBe('ENGINEERING_IDENTITY_MISMATCH:');
  expect(await code(s.service.validateRobotModel('s1', s.ref, 'amr-9'))).toBe('PHYSICAL_MODEL_UNAVAILABLE:UNKNOWN_ROBOT');
  expect(await code(s.service.validateRobotModel('s1', s.ref, '../../etc'))).toBe('INVALID_ROBOT_ID:');
  const legacy = await setup({ profile: false });
  // review2 #3: a bundle compiled by the existing engineering-rigid-v1 path validates with its singleton drive as the binding
  const legacyReport = await legacy.service.validateRobotModel('s1', legacy.ref, 'amr-1');
  expect(legacyReport).toMatchObject({ report: { documentType: 'model-validation-report', robotId: 'amr-1' } });
  expect(await code(s.service.readValidation('intruder', 'f'.repeat(64)))).toBe('NOT_FOUND:');
});

test.skipIf(!available)('the HTTP routes: validate needs a session and CSRF, takes exactly {engineeringRef, robotId}, and reports are readable only by an owner of the bundle', async () => {
  const { startLabGateway } = await import('../../packages/lab-runtime/src/gateway');
  const s = await setup();
  const g = await startLabGateway({ port: 0, directory: await temp('lf-gw-'), sourceCommit: 'c', schemaHash: 'a'.repeat(64), v2: { engineering: s.service } });
  try {
    const pair = async () => { const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) }); return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) }; };
    const owner = await pair(), stranger = await pair();
    const post = (h: Record<string, string>, body: unknown) => fetch(g.url + '/lab/v2/engineering/validate', { method: 'POST', headers: h, body: JSON.stringify(body) });
    // the bundle was compiled by session "s1" in setup(); sessions of the gateway are different ids, so grant the bundle to `owner` the way a run proof would
    await s.service.store.grantBundle(decodeURIComponent(owner.cookie.split('=')[1]!), s.receipt.bundleDigest!);
    expect((await fetch(g.url + '/lab/v2/engineering/validate', { method: 'POST', headers: { origin: owner.origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await post({ ...owner, 'x-csrf-token': 'wrong' }, { engineeringRef: s.ref, robotId: 'amr-1' })).status).toBe(403);
    expect((await post(owner, { engineeringRef: s.ref, robotId: 'amr-1', python: '/bin/sh' })).status).toBe(422);
    expect((await post(stranger, { engineeringRef: s.ref, robotId: 'amr-1' })).status).toBe(403);
    const ok = await post(owner, { engineeringRef: s.ref, robotId: 'amr-1' });
    expect(ok.status).toBe(200);
    const { report } = await ok.json();
    expect(report).toMatchObject({ execution: 'ran', robotId: 'amr-1' });
    const read = (h: Record<string, string>) => fetch(g.url + '/lab/v2/engineering/validations/' + report.reportDigest, { headers: { cookie: h.cookie! } });
    expect((await read(owner)).status).toBe(200);
    expect((await read(stranger)).status).toBe(404);
  } finally { await g.close(); }
});

test.skipIf(!available)('runtime options: an unusable LinkForge interpreter leaves engineering up and validation reports why', async () => {
  const { engineeringFromOptions } = await import('../../packages/lab-runtime/src/engineering/runtime-options');
  const directory = await temp('lf-opt-'), catalogRoot = await temp('lf-opt-cat-'), f = structuredClone(navigationFixture('serve').fixture);
  await writeFixtureCatalog(catalogRoot, f);
  const base = { directory, catalogRoot, simulationRoot: resolve('robotics/simulation'), python: simPython, portable: { python: irPython, workerRoot: resolve('robotics/navigation-2d') } };
  for (const [linkforge, code] of [[undefined, 'LINKFORGE_DISABLED'], [{ python: '/nonexistent/python', workerRoot }, 'LF_WORKER_UNAVAILABLE']] as const) {
    const service = (await engineeringFromOptions({ ...base, directory: await temp('lf-opt-run-'), linkforge }))!;
    const receipt = await service.compileEngineeringProject(f.project, 's');
    expect(receipt.state).toBe('compiled');
    const r = (await service.validateRobotModel('s', { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest }, 'amr-1')).report;
    expect(r.execution).toBe('not_run');
    expect(r.issues.map((i) => i.code)).toContain(code);
  }
  const live = (await engineeringFromOptions({ ...base, directory: await temp('lf-opt-live-'), linkforge: { python: lfPython, workerRoot } }))!;
  const receipt = await live.compileEngineeringProject(f.project, 's');
  expect((await live.validateRobotModel('s', { bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest }, 'amr-1')).report.execution).toBe('ran');
});
