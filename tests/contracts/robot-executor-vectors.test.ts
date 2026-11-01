import { describe, expect, test } from 'vitest';
import { canonicalBytes, hashPayload } from '../../packages/contracts/src/canonical';
import { verifyEs256 } from '../../packages/contracts/src/signing';
import { validateRobotCommand } from '../../packages/contracts/src/validate';
import { createValetudoRig } from '../support/valetudo-rig';
import vectors from '../fixtures/contracts/robot-executor-vectors.json';

// The Python executor (robotics/agent/tests/test_protocol.py) consumes this very file: both runtimes must agree on schema, hash,
// signature and admission verdicts, so a drift on either side fails a test instead of being claimed away.
type Patch = Record<string, unknown> & { $delete?: string[] };
const patched = (base: Record<string, unknown>, patch: Patch) => {
  const out: Record<string, unknown> = { ...structuredClone(base), ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== '$delete')) };
  for (const key of patch.$delete ?? []) delete out[key];
  return out;
};
const base = vectors.baseCommand as Record<string, unknown>;

test('vector clock is the rig clock the admission vectors run on', () => {
  expect(vectors.nowMs).toBe(Date.parse('2026-11-01T00:00:00Z'));
});
test('base command passes the shared schema and has the shared canonical hash', () => {
  expect(validateRobotCommand(base)).toEqual(base);
  expect(hashPayload(base as never)).toBe(vectors.baseHash);
});
describe('invalid commands fail the shared schema', () => {
  for (const c of vectors.invalidCommands) test(c.name, () => expect(() => validateRobotCommand(patched(base, c.patch as Patch))).toThrow());
});
test('signed command vector verifies and any tampering fails', () => {
  const { publicJwk, signature, tampered } = vectors.signed;
  expect(verifyEs256(canonicalBytes(base as never), signature, publicJwk)).toBe(true);
  for (const t of tampered) expect(verifyEs256(canonicalBytes(patched(base, t.patch as Patch) as never), signature, publicJwk), t.name).toBe(false);
});
describe('admission vectors against the TS ValetudoAdapter (protocol emulator)', () => {
  for (const c of vectors.admission) test(c.name, async () => {
    const p = vectors.profile;
    const rig = await createValetudoRig({ profile: { robotId: p.robotId, mapId: p.mapId, mapRevision: p.mapRevision, frame: p.frame } });
    try {
      rig.server.acceptGoto();
      expect(rig.clock.ms).toBe(vectors.nowMs);
      for (const step of c.steps) {
        const command = patched(base, step.command as Patch) as never;
        const expected = step.expect as Record<string, unknown>;
        if (expected.throws) await expect(rig.adapter.execute(command)).rejects.toThrow(String(expected.throws));
        else expect(await rig.adapter.execute(command)).toMatchObject(expected);
      }
    } finally { await rig.close(); }
  });
});
