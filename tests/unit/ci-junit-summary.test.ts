// The macos-engines job is red or green on this check: every case of its manifest accounted for by name.
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Status = 'pass' | 'skip' | 'fail';
const body = { pass: '', skip: '<skipped/>', fail: '<failure/>' };
function check(cases: Record<string, Status>, ...flags: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-junit-'));
  try {
    const xml = Object.entries(cases).map(([name, s]) => `<testcase name="${name}">${body[s]}</testcase>`).join('');
    writeFileSync(join(dir, 'r.xml'), `<testsuites><testsuite name="f" tests="0" failures="0" errors="0" skipped="0">${xml}</testsuite></testsuites>`);
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ required: ['f > a'], physicalMac: ['f > lidar'] }));
    return spawnSync('python3', ['-I', 'scripts/ci-junit-summary.py', join(dir, 'r.xml'), '--expect', join(dir, 'm.json'), ...flags]).status;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('hosted job: green only when required cases pass, physical-Mac cases are skipped and nothing else is there', () => {
  expect(check({ a: 'pass', lidar: 'skip' })).toBe(0);
  const red: Record<string, Status>[] = [{ a: 'skip', lidar: 'skip' }, { a: 'fail', lidar: 'skip' }, { lidar: 'skip' }, { a: 'pass' }, { a: 'pass', lidar: 'pass' }, { a: 'pass', lidar: 'skip', extra: 'pass' }];
  for (const cases of red) expect(check(cases), JSON.stringify(cases)).toBe(1);
});

test('physical Mac: green only when every physical-Mac case passes and nothing failed', () => {
  expect(check({ a: 'skip', lidar: 'pass' }, '--physical-mac')).toBe(0);
  const red: Record<string, Status>[] = [{ lidar: 'skip' }, { lidar: 'fail' }, { a: 'pass' }, { a: 'fail', lidar: 'pass' }];
  for (const cases of red) expect(check(cases, '--physical-mac'), JSON.stringify(cases)).toBe(1);
});
