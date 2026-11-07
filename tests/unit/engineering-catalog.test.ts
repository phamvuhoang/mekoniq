import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from '../../packages/lab-runtime/src/engineering/catalog';
import { hashJson } from '../../packages/lab-runtime/src/v2/hash';
// @ts-expect-error plain ESM script, no types
import { importVendor } from '../../scripts/import-engineering-vendor.mjs';
import { assumed, boxLink, scalar } from '../support/engineering';
import type { ComponentRevision } from '../../packages/lab-runtime/src/engineering/contracts';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

const actuator = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, kind: 'actuator', id: 'wheel-drive', jointIds: ['axle'], transmission: { ratio: scalar(10, '1'), efficiency: scalar(0.8, '1') }, commandInterface: 'velocity',
  torqueSpeedTable: [{ speed: scalar(0, 'rad/s'), torque: scalar(3, 'N*m') }, { speed: scalar(30, 'rad/s'), torque: scalar(0, 'N*m') }], currentLimit: scalar(10, 'A'), voltageLimit: scalar(24, 'V'), damping: scalar(0.01, 'N*m'), friction: scalar(0.02, 'N*m'), ...over });

interface Opts { mfr?: 'missing' | 'wrong-hash' | 'ok'; doc?: Uint8Array; skipDoc?: boolean; docDigest?: string; model?: unknown; skipModel?: boolean; modelDigest?: string; declared?: string; mesh?: boolean; sku?: string | null; extra?: ComponentRevision[]; quotes?: unknown[]; file?: string }
async function build(o: Opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eng-catalog-')); dirs.push(root);
  for (const d of ['components', 'models', 'documents']) await mkdir(join(root, d));
  const doc = o.doc ?? new TextEncoder().encode('fixture datasheet');
  if (!o.skipDoc) await writeFile(join(root, 'documents', sha(doc)), doc);
  const model = o.model ?? actuator(), modelDigest = o.modelDigest ?? hashJson(model);
  if (!o.skipModel) await writeFile(join(root, 'models', `${hashJson(model)}.json`), JSON.stringify(model));
  const link = boxLink('body', [0.1, 0.1, 0.1], 1);
  if (o.mesh) link.visual.push({ pose: link.visual[0]!.pose, geometry: { kind: 'mesh', blobSha256: sha('mesh-not-written'), scale: [1, 1, 1] }, source: assumed });
  if (o.mfr) link.massKg.source = { kind: 'manufacturer', documentId: o.mfr === 'missing' ? 'no-such-document' : 'datasheet', revision: '1', locator: 'p1', contentSha256: o.mfr === 'wrong-hash' ? 'e'.repeat(64) : sha(doc) };
  const component: ComponentRevision = { schemaVersion: 1, id: 'fixture-motor', revision: '1', identity: { manufacturer: 'fixture', family: 'motor', sku: o.sku === undefined ? null : o.sku, status: 'candidate' }, links: [link], joints: [], ports: [],
    models: [{ kind: 'actuator', id: 'wheel-drive', digest: modelDigest }], documents: [{ id: 'datasheet', url: null, digest: o.docDigest ?? sha(doc), license: 'fixture' }] };
  const all = [component, ...(o.extra ?? [])];
  const entries = [];
  for (const c of all) { const file = `components/${c.id}-${c.identity.sku ?? 'nosku'}.json`; await writeFile(join(root, file), JSON.stringify(c)); entries.push({ file: o.file ?? file, digest: o.declared ?? hashJson(c) }); }
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ schemaVersion: 1, id: 'fixture-catalog', components: entries, quotes: o.quotes ?? [] }));
  return { root, component, digest: hashJson(component) };
}
const blocking = (r: { problems: { code: string; blocking: boolean }[] }) => r.problems.filter((p) => p.blocking).map((p) => p.code);

test('a consistent catalog loads without problems and is keyed by component digest', async () => {
  const { root, digest, component } = await build();
  const r = await loadCatalog(root);
  expect(r.problems).toEqual([]);
  expect(r.components[digest]).toEqual(component);
});

test('missing vendor blob blocks runnable model', async () => {
  const { root } = await build({ skipDoc: true });
  const result = await loadCatalog(root);
  expect(result.problems.some(p => p.code === 'BLOB_UNAVAILABLE' && p.blocking)).toBe(true);
});

test('declared digests are verified: blob bytes, component file and model file', async () => {
  const wrongBlob = await build({ docDigest: sha('something else'), skipDoc: true });
  await writeFile(join(wrongBlob.root, 'documents', sha('something else')), 'tampered bytes');
  expect(blocking(await loadCatalog(wrongBlob.root))).toContain('BLOB_HASH_MISMATCH');
  expect(blocking(await loadCatalog((await build({ declared: 'f'.repeat(64) })).root))).toContain('CATALOG_DIGEST_MISMATCH');
  const m = await build({ modelDigest: 'e'.repeat(64) });
  expect(blocking(await loadCatalog(m.root))).toContain('MODEL_UNAVAILABLE');
});

test('missing mesh blob and missing model dependency are blocking', async () => {
  expect(blocking(await loadCatalog((await build({ mesh: true })).root))).toContain('BLOB_UNAVAILABLE');
  expect(blocking(await loadCatalog((await build({ skipModel: true })).root))).toContain('MODEL_UNAVAILABLE');
});

test('models are schema-checked: an actuator without a torque-speed table is rejected, not defaulted', async () => {
  const bad = actuator(); delete (bad as Record<string, unknown>).torqueSpeedTable;
  const r = await loadCatalog((await build({ model: bad })).root);
  expect(blocking(r)).toContain('MODEL_INVALID');
});

test('same family with different SKU never merges and a candidate SKU stays null', async () => {
  const base = await build({ sku: 'A-1' });
  const other = { ...base.component, identity: { ...base.component.identity, sku: 'B-2' } };
  const b = await build({ sku: 'A-1', extra: [other] });
  const r = await loadCatalog(b.root);
  const skus = Object.values(r.components).map((c) => c.identity.sku).sort();
  expect(skus).toEqual(['A-1', 'B-2']);
  expect(Object.values((await loadCatalog((await build()).root)).components)[0]!.identity.sku).toBeNull();
});

test('price comes only from a valid quotation; zero is never a default', async () => {
  const { root, digest } = await build({ quotes: [{ componentDigest: 'a'.repeat(64), amount: 0, currency: 'USD', quotedOn: '2026-11-01', documentId: 'q' }] });
  const r = await loadCatalog(root);
  expect(blocking(r)).toContain('PRICE_QUOTE_INVALID');
  expect(r.quotes[digest]).toBeUndefined();
  const ok = await build();
  const good = await build({ quotes: [{ componentDigest: ok.digest, amount: 120.5, currency: 'USD', quotedOn: '2026-11-01', documentId: 'q' }] });
  expect((await loadCatalog(good.root)).quotes[good.digest]).toEqual({ amount: 120.5, currency: 'USD', quotedOn: '2026-11-01' });
});

test('catalog entries cannot escape the catalog root', async () => {
  const r = await loadCatalog((await build({ file: '../outside.json' })).root);
  expect(blocking(r)).toContain('CATALOG_PATH_INVALID');
});

test('the shipped reference catalog is self-consistent and its external candidates stay unready', async () => {
  const r = await loadCatalog('robotics/catalog');
  expect(r.problems.filter((p) => p.blocking)).toEqual([]);
  const byId = Object.fromEntries(Object.values(r.components).map((c) => [c.id, c]));
  for (const id of ['ufactory-xarm6', 'ufactory-gripper-g2', 'slamtec-rplidar-s2', 'orientalmotor-blv-r', 'eversys-cameo', 'phidgets-frc4115']) {
    expect(byId[id], id).toBeDefined();
    expect(byId[id]!.identity.status).toBe('candidate');
    expect(byId[id]!.identity.sku).toBeNull();
  }
  expect(Object.keys(r.quotes)).toEqual([]);
  expect(byId['amr-chassis-ref']!.links.every((l) => l.inertialSource.kind === 'assumed')).toBe(true);
});

test('vendor import accepts only allowlisted https hosts, matching checksums and in-root destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eng-import-')); dirs.push(root);
  const bytes = new TextEncoder().encode('urdf bytes');
  const fetchImpl = async () => new Response(bytes);
  const entry = { url: 'https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/0123456789abcdef/README.md', sha256: sha(bytes), license: 'BSD-3-Clause', commit: '0123456789abcdef', documentId: 'xarm-readme' };
  const ok = await importVendor({ root, sources: [entry], fetchImpl });
  expect(ok.imported[0].sha256).toBe(sha(bytes));
  expect(ok.imported[0].file).toBe(`documents/${sha(bytes)}`);
  await expect(importVendor({ root, sources: [{ ...entry, sha256: 'a'.repeat(64) }], fetchImpl })).rejects.toThrow(/IMPORT_HASH_MISMATCH/);
  await expect(importVendor({ root, sources: [{ ...entry, url: 'https://evil.example/x' }], fetchImpl })).rejects.toThrow(/IMPORT_HOST_FORBIDDEN/);
  await expect(importVendor({ root, sources: [{ ...entry, url: 'http://raw.githubusercontent.com/x' }], fetchImpl })).rejects.toThrow(/IMPORT_HOST_FORBIDDEN/);
  await expect(importVendor({ root, sources: [{ ...entry, license: '' }], fetchImpl })).rejects.toThrow(/IMPORT_LICENSE_REQUIRED/);
  await expect(importVendor({ root, sources: [{ ...entry, commit: 'main' }], fetchImpl })).rejects.toThrow(/IMPORT_COMMIT_REQUIRED/);
});

test('a manufacturer or measured source must point at a document the component declares, with the same content hash', async () => {
  expect((await loadCatalog((await build({ mfr: 'ok' })).root)).problems).toEqual([]);
  const missing = await loadCatalog((await build({ mfr: 'missing' })).root);
  expect(blocking(missing)).toContain('PROVENANCE_UNRESOLVED');
  expect(blocking(await loadCatalog((await build({ mfr: 'wrong-hash' })).root))).toContain('PROVENANCE_UNRESOLVED');
});
