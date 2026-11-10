// scripts/lab-algorithm.mjs: strict argv, an existing output directory is refused, exit 0 only when every check passed, 1 on any fail, 2 on a missing prerequisite.
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM script without types
import { exitCodeFor } from '../../scripts/lab-algorithm.mjs';

const cli = (...args: string[]) => { const r = spawnSync(process.execPath, ['scripts/lab-algorithm.mjs', ...args], { encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const verdicts = (...v: string[]) => v.map((verdict) => ({ verdict }));

test('exit code: any fail is 1, otherwise any not_run (or nothing at all) is 2, otherwise 0', () => {
  expect(exitCodeFor(verdicts('pass', 'pass'))).toBe(0);
  expect(exitCodeFor(verdicts('pass', 'fail'))).toBe(1);
  expect(exitCodeFor(verdicts('pass', 'not_run'))).toBe(2);
  expect(exitCodeFor(verdicts('fail', 'not_run'))).toBe(1);
  expect(exitCodeFor([])).toBe(2);
});

test('argv is strict: no command, missing --out, unknown or duplicate options and a bad seed are usage errors (exit 2)', () => {
  for (const args of [[], ['run'], ['run', '--out'], ['run', '--out', '/tmp/x', '--bogus', '1'], ['run', '--out', '/tmp/x', '--out', '/tmp/y'], ['run', '--out', '/tmp/x', '--seed', 'abc'], ['verify']]) {
    const r = cli(...args);
    expect(r.code, args.join(' ')).toBe(2);
    expect(r.err).toContain('usage:');
  }
});

test('an output directory that already exists is refused before anything runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lab-alg-'));
  try {
    const r = cli('run', '--out', dir);
    expect(r.code).toBe(2);
    expect(r.err).toContain('OUT_EXISTS');
    expect(existsSync(join(dir, 'algorithm-results.json'))).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('without the pinned interpreter every check is not_run, the file says so and the exit code is 2', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'lab-alg-')), out = join(parent, 'out');
  try {
    const r = cli('run', '--out', out, '--python', '/nonexistent/python3.11');
    expect(r.code).toBe(2);
    const doc = JSON.parse(await readFile(join(out, 'algorithm-results.json'), 'utf8')) as { results: { caseId: string; verdict: string }[]; oracleProfileDigest: string; lockDigest: string };
    expect(doc.results.map((x) => x.caseId)).toEqual(['ALG01', 'ALG02', 'ALG03', 'ALG05', 'PID01', 'PID02', 'PID03']);
    expect(new Set(doc.results.map((x) => x.verdict))).toEqual(new Set(['not_run']));
    expect(doc.oracleProfileDigest).toMatch(/^[0-9a-f]{64}$/); expect(doc.lockDigest).toMatch(/^[0-9a-f]{64}$/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
