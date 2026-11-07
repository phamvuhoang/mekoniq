import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLabGateway, type LabGateway } from '../../packages/lab-runtime/src/gateway';
import { createEngineeringService } from '../../packages/lab-runtime/src/engineering/gateway';
import { createBundleStore } from '../../packages/lab-runtime/src/engineering/bundle-store';
import { engineeringFixture, testCompiler, writeFixtureCatalog } from '../support/engineering';

const roots: string[] = [], gateways: LabGateway[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const g of gateways.splice(0)) await g.close(); for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); roots.push(d); return d; };

async function boot() {
  const directory = await temp('eng-sec-'), catalogRoot = await temp('eng-sec-cat-'), f = engineeringFixture('valid');
  await writeFixtureCatalog(catalogRoot, f);
  const g = await startLabGateway({ port: 0, directory: join(directory, 'runs'), sourceCommit: 'test-commit', schemaHash: 'a'.repeat(64), v2: { engineering: createEngineeringService({ directory: join(directory, 'engineering'), catalogRoot, compiler: testCompiler }) } });
  gateways.push(g);
  const pair = async () => { const r = await fetch(g.url + '/lab/v2/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:4175', 'content-type': 'application/json' }, body: JSON.stringify({ token: g.issuePairingToken() }) }); return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: 'http://127.0.0.1:4175', 'content-type': 'application/json', 'x-csrf-token': String((await r.json()).csrfToken) }; };
  return { g, f, directory, pair };
}
const compile = (g: LabGateway, h: Record<string, string>, body: unknown) => fetch(g.url + '/lab/v2/engineering/compile', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('compile enforces origin, CSRF, strict body shape and the 2 MiB limit', async () => {
  const { g, f, pair } = await boot(); const h = await pair();
  const { origin: _origin, ...noOrigin } = h; void _origin;
  expect((await compile(g, noOrigin, { project: f.project })).status).toBe(403);
  expect((await compile(g, { ...h, 'x-csrf-token': 'wrong' }, { project: f.project })).status).toBe(403);
  for (const extra of ['endpoint', 'plugin', 'operator', 'script']) {
    const r = await compile(g, h, { project: f.project, [extra]: 'x' });
    expect(r.status, extra).toBe(422);
  }
  expect((await compile(g, h, { project: f.project, endpoint: 'http://x' }).then((r) => r.json())).reasonCodes).toContain('ENDPOINT_FORBIDDEN');
  const huge = JSON.stringify({ project: f.project, pad: 'x'.repeat(2 * 1024 * 1024 + 10) });
  expect((await compile(g, h, huge)).status).toBe(413);
});

test('blob and manifest paths accept only sha-256 digests', async () => {
  const { g, pair } = await boot(); const h = await pair();
  for (const bad of ['..%2F..%2Fetc%2Fpasswd', '../x', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '/x']) {
    expect((await fetch(g.url + `/lab/v2/engineering/blobs/${bad}`, { headers: { cookie: h.cookie! } })).status, bad).toBe(404);
    expect((await fetch(g.url + `/lab/v2/engineering/bundles/${bad}/manifest`, { headers: { cookie: h.cookie! } })).status, bad).toBe(404);
  }
  expect((await fetch(g.url + `/lab/v2/engineering/blobs/${'a'.repeat(64)}`)).status).toBe(401);
});

test('a blob is served only to a session that owns a bundle containing it, and tampered bytes are never served', async () => {
  const { g, f, directory, pair } = await boot(); const owner = await pair(), other = await pair();
  const receipt = await (await compile(g, owner, { project: f.project })).json();
  const manifest = await (await fetch(g.url + `/lab/v2/engineering/bundles/${receipt.bundleDigest}/manifest`, { headers: { cookie: owner.cookie! } })).json();
  const digest = manifest.files[0].sha256 as string;
  expect((await fetch(g.url + `/lab/v2/engineering/blobs/${digest}`, { headers: { cookie: other.cookie! } })).status).toBe(403);
  expect((await fetch(g.url + `/lab/v2/engineering/blobs/${'a'.repeat(64)}`, { headers: { cookie: owner.cookie! } })).status).toBe(403);
  await writeFile(join(directory, 'engineering', 'blobs', digest), 'tampered');
  const tampered = await fetch(g.url + `/lab/v2/engineering/blobs/${digest}`, { headers: { cookie: owner.cookie! } });
  expect(tampered.status).toBe(409);
  expect((await tampered.json()).error).toBe('ENGINEERING_BLOB_CORRUPT');
});

test('store authorisation: another session never reads, grants are per bundle, and a partial publish is invisible', async () => {
  const dir = await temp('eng-store-'); const store = createBundleStore(dir);
  const files = [{ path: 'scene.json', bytes: new TextEncoder().encode('{}') }];
  const { bundleDigest } = await store.publish('s1', files, { projectDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), sceneDigest: 'c'.repeat(64), profile: 'engineering-rigid-v1', compilerVersion: 't' });
  expect(await store.authorizeBundle('s1', bundleDigest)).toBe(true);
  expect(await store.authorizeBundle('different-session', bundleDigest)).toBe(false);
  await store.grantBundle('s2', bundleDigest);
  expect(await store.authorizeBundle('s2', bundleDigest)).toBe(true);
  expect(await store.authorizeBundle('s2', 'f'.repeat(64))).toBe(false);
  expect(await readdir(join(dir, 'bundles'))).toEqual([bundleDigest]);
  await expect(store.publish('s1', [{ path: '../escape.json', bytes: new Uint8Array() }], { projectDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), sceneDigest: 'c'.repeat(64), profile: 'engineering-rigid-v1', compilerVersion: 't' })).rejects.toThrow(/BUNDLE_PATH_INVALID/);
  expect(await readdir(join(dir, 'bundles'))).toEqual([bundleDigest]);
});

test('concurrent publishes of the same bundle all succeed with the same digest', async () => {
  const dir = await temp('eng-race-'); const store = createBundleStore(dir);
  const files = [{ path: 'scene.json', bytes: new TextEncoder().encode('{"a":1}') }, { path: 'bom.json', bytes: new TextEncoder().encode('[]') }];
  const meta = { projectDigest: 'a'.repeat(64), assemblyDigest: 'b'.repeat(64), sceneDigest: 'c'.repeat(64), profile: 'engineering-rigid-v1', compilerVersion: 't' };
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.publish(`s${i}`, files, meta)));
  expect(new Set(results.map((r) => r.bundleDigest)).size).toBe(1);
  expect(await readdir(join(dir, 'bundles'))).toEqual([results[0]!.bundleDigest]);   // no stray staging directories either
  for (let i = 0; i < 12; i++) expect(await store.authorizeBundle(`s${i}`, results[0]!.bundleDigest)).toBe(true);
});
