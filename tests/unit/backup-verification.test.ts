import {test, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM script boundary
import {verifyBackup} from '../../scripts/backup-verify.mjs';

test('backup verification rejects a one-bit change for every possible original byte, including X', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-byte-check-'));
  try {
    for (let original = 0; original < 256; original++) {
      const bytes = Buffer.alloc(201, 32); bytes[100] = original;
      const manifest = {schema: 'mekoniq-backup-1', createdAt: '2026-11-05T00:00:00Z', appCommit: 'fixture', migrations: [],
        files: [{path: 'public.sql', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}],
        auth: {users: []}, storage: {readyAssets: 0, objects: []}, rowCounts: {}};
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(dir, 'public.sql'), bytes);
      expect(verifyBackup(dir).ok).toBe(true);
      bytes[100] = original ^ 1;
      writeFileSync(join(dir, 'public.sql'), bytes);
      expect(verifyBackup(dir).reasons).toEqual(['corrupt public.sql (sha256)']);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
