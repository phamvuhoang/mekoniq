// lab:webots boundary: the same checks as lab:irsim (the pinned tool closure, each venv against its lock) plus the host Webots: missing or not R2025a, the launcher exits
// with a code before it opens a port or starts a process, and `lab:mock` / `lab:irsim` are untouched. Webots itself is a host install the launcher never installs.
import {freePort} from '../support/free-port';
import { afterEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error CLI JavaScript boundary
import { checkWebotsHealth, irsimOptions } from '../../scripts/start-irsim.mjs';

const lab = fileURLToPath(new URL('../../', import.meta.url)), launcher = join(lab, 'scripts/start-irsim.mjs');
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async () => { const d = await mkdtemp(join(tmpdir(), 'webots-launcher-')); dirs.push(d); return d; };
const listening = (port: number) => new Promise<boolean>((ok) => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); ok(true); }); s.once('error', () => ok(false)); });
async function run(args: string[]) {
  const [ui,runtime]=await Promise.all([freePort(),freePort()]);
  const p = spawn(process.execPath, [launcher, '--ui-port', String(ui), '--runtime-port', String(runtime), ...args], { cwd: lab, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 90_000);
  const exit = await new Promise<number>((r) => p.once('exit', (c) => r(c ?? 1)));
  clearTimeout(timer);
  return { exit, out, err, ui, runtime };
}
const b = (id: string, on: boolean) => ({ id, modes: ['simulation'], accesses: ['simulated'], installed: on, compatible: on, reachable: on, enabled: on, commissioned: true });
const lock = { sourceCommit: 'c'.repeat(40), schemaHash: 'a'.repeat(64) };

test('checkWebotsHealth wants a live webots_3d and webots_arm and their capabilities, and the rest of the runtime exactly the mock backends', () => {
  const mock = ['mock_amr', 'mock_coffee', 'mock_arm'].map((id) => ({ ...b(id, true), modes: ['mock'] }));
  const health = { protocolMajors: [1, 2], sourceCommit: lock.sourceCommit, schemaHash: lock.schemaHash, capabilities: ['engineering_bundle_v1', 'sim3d_navigation_v1', 'sim3d_arm_v1'], backends: [...mock, b('irsim_2d', false), b('webots_3d', true), b('webots_arm', true)] };
  expect(() => checkWebotsHealth(health, lock)).not.toThrow();
  expect(() => checkWebotsHealth({ ...health, backends: [...mock, b('irsim_2d', false), { ...b('webots_3d', false), reason: 'WEBOTS_NOT_INSTALLED: x' }, b('webots_arm', true)] }, lock)).toThrow(/WEBOTS_PROVIDER_UNAVAILABLE:WEBOTS_NOT_INSTALLED/);
  expect(() => checkWebotsHealth({ ...health, backends: [...mock, b('irsim_2d', false), b('webots_3d', true)] }, lock)).toThrow(/WEBOTS_PROVIDER_UNAVAILABLE:not offered/); // a runtime without the arm provider
  expect(() => checkWebotsHealth({ ...health, capabilities: ['engineering_bundle_v1'] }, lock)).toThrow('CAPABILITY_MISSING:sim3d_navigation_v1');
  expect(() => checkWebotsHealth({ ...health, capabilities: ['engineering_bundle_v1', 'sim3d_navigation_v1'] }, lock)).toThrow('CAPABILITY_MISSING:sim3d_arm_v1');
  expect(() => checkWebotsHealth({ ...health, backends: [...mock, b('irsim_2d', true), b('webots_3d', true), b('webots_arm', true)] }, lock)).toThrow(/NON_MOCK_BACKEND_ENABLED:irsim_2d/);
});

test('--provider webots selects the Webots tools and keeps the IR-SIM defaults for the engineering helper', () => {
  const o = irsimOptions(['--provider', 'webots', '--webots-home', '/x/Webots.app', '--webots-python', '/x/py', '--ui-port', '4175']);
  expect(o).toMatchObject({ provider: 'webots', webotsHome: '/x/Webots.app', webotsPython: '/x/py' });
  expect(o.rest).toEqual(['--ui-port', '4175']);
  expect(irsimOptions([]).provider).toBe('irsim');
  expect(() => irsimOptions(['--provider', 'gazebo'])).toThrow(/INVALID_PROVIDER/);
});

test('without Webots at the configured home the launcher exits WEBOTS_NOT_INSTALLED before any port is opened', async () => {
  const d = await temp();
  const r = await run(['--provider', 'webots', '--webots-home', join(d, 'Webots.app'), '--data-dir', join(d, 'runs')]);
  expect(r.exit, r.err).toBe(1); expect(r.err).toContain('WEBOTS_NOT_INSTALLED'); expect(r.out).not.toMatch(/Ready in/);
  expect(await listening(r.ui)).toBe(false); expect(await listening(r.runtime)).toBe(false);
}, 120_000);

test('a Webots that is not R2025a exits WEBOTS_VERSION_MISMATCH before any port is opened', async () => {
  const d = await temp(), exe = join(d, 'Webots.app/Contents/MacOS/webots');
  await mkdir(join(d, 'Webots.app/Contents/MacOS'), { recursive: true });
  await writeFile(exe, '#!/bin/sh\necho "Webots version: R2025b"\n'); await chmod(exe, 0o755);
  const r = await run(['--provider', 'webots', '--webots-home', join(d, 'Webots.app'), '--data-dir', join(d, 'runs')]);
  expect(r.exit, r.err).toBe(1); expect(r.err).toContain('WEBOTS_VERSION_MISMATCH'); expect(r.out).not.toMatch(/Ready in/);
  expect(await listening(r.ui)).toBe(false); expect(await listening(r.runtime)).toBe(false);
}, 120_000);
