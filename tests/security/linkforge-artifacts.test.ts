import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createLinkForgeValidator } from '../../packages/lab-runtime/src/engineering/linkforge';
import { createValidationStore } from '../../packages/lab-runtime/src/engineering/validation-store';
import { documentDigest, sealDocument } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import { engineeringFixture } from '../support/engineering';

const lfPython = resolve('.venv-linkforge/bin/python'), workerRoot = resolve('robotics/model-validation');
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
void engineeringFixture;

test('validation store: artifacts are content-addressed, reports are verified on read, and a tampered file is not served', async () => {
  const store = createValidationStore(await temp('vs-'));
  const ref = await store.putArtifact(new TextEncoder().encode('hello'));
  expect(ref.sha256).toBe(sha('hello'));
  expect(Buffer.from((await store.readArtifact(ref.sha256))!).toString()).toBe('hello');
  expect(await store.readArtifact('../../etc/passwd')).toBeNull();
  const report = sealDocument({ schemaVersion: 1, documentType: 'model-validation-report', reportDigest: '', physicalModelDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), robotId: 'amr-1', execution: 'not_run', result: 'inconclusive', mode: 'shadow', engine: null,
    checks: [], issues: [], nameMapRef: null, inputUrdfRef: null, referenceUrdfRef: null, referenceSrdfRef: null, assumptions: [], limitations: [] }, 'reportDigest') as never;
  const digest = (report as { reportDigest: string }).reportDigest;
  expect(documentDigest(report, 'reportDigest')).toBe(digest);
  await store.putReport({ bundleDigest: 'c'.repeat(64), cacheKey: null, report });
  expect((await store.readReport(digest))!.bundleDigests).toEqual(['c'.repeat(64)]);
  expect(await store.readReport('../x')).toBeNull();
  await writeFile(join(store.root, 'reports', `${digest}.json`), '{"bundleDigests":["c"],"report":{"reportDigest":"x"}}');
  expect(await store.readReport(digest)).toBeNull();
});

test.skipIf(!existsSync(lfPython))('the worker only reads inside the bundle root: traversal, absolute paths and symlinks are rejected and the report says so', async () => {
  const root = await temp('lf-sec-'), outside = await temp('lf-out-');
  await writeFile(join(outside, 'secret.urdf'), '<robot name="x"/>');
  await mkdir(join(root, 'robots'));
  await symlink(join(outside, 'secret.urdf'), join(root, 'robots', 'link.urdf'));
  const f = engineeringFixture('valid'); void f;
  const validator = createLinkForgeValidator({ python: lfPython, workerRoot, timeoutMs: 15_000, lockDigest: '1'.repeat(64) });
  const model = { schemaVersion: 1, documentType: 'robot-physical-model', modelDigest: 'a'.repeat(64), inputs: { assemblyDigest: 'b'.repeat(64) }, robotId: 'amr-1', baseFrameId: 'a', links: [], joints: [], drive: null, sensors: [], assumptions: [] } as never;
  for (const path of ['../' + outside.split('/').pop() + '/secret.urdf', '/etc/passwd', 'robots/link.urdf', 'http://example.com/a.urdf']) {
    const report = await validator.validate({ model, urdf: { path, sha256: sha('x'), bytes: 1 }, bundleRoot: root });
    expect(report.issues.map((i) => i.code), path).toContain('PATH_REJECTED');
    expect(report.result).not.toBe('pass');
  }
});

test('review2 #9: concurrent writes of one report for many bundles keep every ownership link', async () => {
  const store = createValidationStore(await temp('vs-'));
  const report = sealDocument({ schemaVersion: 1, documentType: 'model-validation-report', reportDigest: '', physicalModelDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), robotId: 'amr-1', execution: 'not_run', result: 'inconclusive', mode: 'shadow', engine: null,
    checks: [], issues: [], nameMapRef: null, inputUrdfRef: null, referenceUrdfRef: null, referenceSrdfRef: null, assumptions: [], limitations: [] }, 'reportDigest') as never;
  const owners = Array.from({ length: 10 }, (_, i) => i.toString(16).repeat(64));
  await Promise.all(owners.map((bundleDigest) => store.putReport({ bundleDigest, cacheKey: null, report })));
  expect((await store.readReport((report as { reportDigest: string }).reportDigest))!.bundleDigests).toEqual(owners);
});
