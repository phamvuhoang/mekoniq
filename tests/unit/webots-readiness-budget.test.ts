import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectReadiness } from '../../packages/lab-runtime/src/v2/readiness';
import { SIM3D_WIRE } from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';

afterEach(() => vi.useRealTimers());

// A provider check that never answers, so the only thing under test is who owns the timeout, its budget and its code.
const hang = (seen: { signal?: AbortSignal }) => (_c: unknown, signal: AbortSignal) => { seen.signal = signal; return new Promise<never>(() => {}); };
const run = async (backendSetId: string, scenarioId: string, steps: number[]) => {
  vi.useFakeTimers();
  const seen: { signal?: AbortSignal } = {}, aborted: boolean[] = [];
  const p = collectReadiness({ scenarioId, backendSetId } as never, { enabledBackends: ['irsim_2d', 'webots_3d'], portableChecks: hang(seen) as never });
  for (const ms of steps) { await vi.advanceTimersByTimeAsync(ms); aborted.push(seen.signal?.aborted ?? false); }
  return { snapshot: await p, seen, aborted };
};
const providerRow = (s: Awaited<ReturnType<typeof run>>['snapshot']) => s.checks.find((c) => /provider$/.test(c.id));

test('review R1 #1: a Webots readiness check keeps running past the 15 s IR-SIM budget; when it does time out it says WEBOTS and aborts the smoke', async () => {
  const r = await run('engineering-webots-3d-v1', 'WB-FD01', [16_000, 30_000]);
  expect(r.aborted).toEqual([false, true]); // alive at 16 s, aborted by 46 s
  expect(providerRow(r.snapshot)).toMatchObject({ id: 'webots-provider', reasonCodes: ['WEBOTS_PROBE_TIMEOUT'] });
});
test('review R1 #1: the IR-SIM budget and code are unchanged', async () => {
  const r = await run('engineering-irsim-2d-v1', 'IR-FD01', [16_000]);
  expect(providerRow(r.snapshot)).toMatchObject({ id: 'irsim-provider', reasonCodes: ['IRSIM_PROBE_TIMEOUT'] });
  expect(r.seen.signal?.aborted).toBe(true);
});

test("review R1 #6: the client's create deadline covers the worker's own start and child timeouts, so a slow start is WEBOTS_START_FAILED, not WORKER_TIMEOUT", () => {
  const py = readFileSync(new URL('../../robotics/simulation-3d/webots_worker/engine.py', import.meta.url), 'utf8');
  const n = (name: string) => Number(new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(py)![1]);
  expect(SIM3D_WIRE.deadlinesMs?.create).toBeGreaterThan((n('START_TIMEOUT_S') + n('CHILD_TIMEOUT_S')) * 1000);
});
