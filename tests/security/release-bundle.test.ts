import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error plain ESM script without types
import { scanDirectory, sbomFromLockfile, defaultPublicDirs } from '../../scripts/release-security.mjs';
test('the scanner finds planted secrets and test-only seams (so a clean result means something)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-')), jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.c2lnbmF0dXJlc2lnbmF0dXJl`;
  writeFileSync(join(dir, 'a.js'), `const k="${jwt('service_role')}";`);
  writeFileSync(join(dir, 'b.js'), 'fetch(url,{headers:{"X-Test-Actor":"owner"}}); const u="postgresql://postgres:hunter2@db:5432/x"; process.env.JOB_HMAC_SECRET');
  writeFileSync(join(dir, 'c.js'), `const anon="${jwt('anon')}";`);
  const rules = (scanDirectory(dir) as { file: string; rule: string }[]).map(f => f.rule + ':' + f.file.split('/').pop());
  expect(rules).toEqual(expect.arrayContaining(['service-role-jwt:a.js', 'dev-actor-header:b.js', 'database-url:b.js', 'server-secret-name:b.js']));
  expect(rules.some(r => r.endsWith(':c.js'))).toBe(false); // the public anon key is meant to be public
});
test('the public bundles of this build carry no secrets and no test-only routes', () => {
  for (const dir of defaultPublicDirs as string[]) expect(scanDirectory(dir), dir).toEqual([]);
  const run = spawnSync(process.execPath, ['scripts/release-security.mjs'], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
});
test('the SBOM lists the locked dependency set', () => {
  const sbom = sbomFromLockfile("packages:\n\n  '@scope/pkg@1.2.3':\n    resolution: {}\n  left-pad@1.3.0:\n    resolution: {}\n  left-pad@1.3.0:\n    resolution: {}\n") as { components: { name: string; version: string }[] };
  expect(sbom.components).toEqual([{ name: '@scope/pkg', version: '1.2.3' }, { name: 'left-pad', version: '1.3.0' }]);
});
