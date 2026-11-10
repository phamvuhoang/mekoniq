// Review Focus #5: an absent venv, a hung or noisy Python and hostile input never produce a pass.
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AlgorithmCheckerError, createAlgorithmChecker, loadOracleProfile } from '../../packages/lab-runtime/src/v2/algorithm/checker';
import { runKinematicsCases } from '../../packages/lab-runtime/src/v2/algorithm/kinematics-cases';

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const doubles = resolve('tests/support/algorithm_doubles');
const code = async (p: Promise<unknown>) => { try { await p; return 'resolved'; } catch (e) { return e instanceof AlgorithmCheckerError ? e.code : `other:${String(e)}`; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a missing interpreter is CHECKER_NOT_INSTALLED and every kinematics case is not_run, never a pass', async () => {
  const checker = createAlgorithmChecker({ python: '/nonexistent/python3.11', root: resolve('robotics/algorithm') });
  expect(await code(checker.call('rtb_fk', { dh: [], q: [] }))).toBe('CHECKER_NOT_INSTALLED');
  const rs = await runKinematicsCases(checker, loadOracleProfile().profile, 1);
  expect(rs.map((r) => r.verdict)).toEqual(['not_run', 'not_run', 'not_run', 'not_run']);
  for (const r of rs) expect(r.reasons.join()).toContain('CHECKER_NOT_INSTALLED');
});

test('a hung checker is killed at the deadline (CHECKER_TIMEOUT) and its process is gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alg-sec-')); dirs.push(dir);
  const pidFile = join(dir, 'pid');
  const checker = createAlgorithmChecker({ python: 'python3', root: doubles, timeoutMs: 200, entry: [join(doubles, 'sleep.py'), pidFile] });
  expect(await code(checker.call('rtb_fk', {}))).toBe('CHECKER_TIMEOUT');
  const pid = Number(await readFile(pidFile, 'utf8'));
  await new Promise((r) => setTimeout(r, 200));
  expect(alive(pid)).toBe(false);
});

test('two JSON lines, junk and a non-zero exit are CHECKER_PROTOCOL', async () => {
  for (const script of ['two_lines.py', 'junk.py', 'crash.py']) {
    const checker = createAlgorithmChecker({ python: 'python3', root: doubles, timeoutMs: 5000, entry: [join(doubles, script)] });
    expect(await code(checker.call('rtb_fk', {})), script).toBe('CHECKER_PROTOCOL');
  }
});

test('an ok:false answer is CHECKER_REJECTED and an oversized request never reaches Python', async () => {
  const rejecting = createAlgorithmChecker({ python: 'python3', root: doubles, timeoutMs: 5000, entry: [join(doubles, 'reject.py')] });
  expect(await code(rejecting.call('rtb_fk', {}))).toBe('CHECKER_REJECTED');
  const never = createAlgorithmChecker({ python: '/nonexistent/python3.11', root: doubles });
  expect(await code(never.call('rtb_fk', { q: Array(400_000).fill([0]) }))).toBe('CHECKER_REJECTED');
});
