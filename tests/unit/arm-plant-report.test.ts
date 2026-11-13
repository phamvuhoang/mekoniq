// Final review I2: what an ARM03 record and the arm block say about the arm. A not-run record names the model of the run's arm plant; on the MuJoCo arm both say that the project's
// arm entity references the Lab's illustrative design asset, not the simulated arm. Mock and Webots records are unchanged (PUMA, no note).
import { expect, test } from 'vitest';
import Ajv from 'ajv';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import armSchema from '../../packages/contracts/schemas/lab-arm-collision-evidence.schema.json';
import { MockArmPlant, type ArmPlantState } from '../../packages/cell-adapters/src/mock-arm';
import { armCollisionRecord, buildArmReport } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import type { ArmPlantReport } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import { PUMA560_SI, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';

const world = { id: 'w', revision: 1, hash: 'a'.repeat(64) }, asset = { id: 'arm-puma-reference', revision: 1, contentHash: 'c'.repeat(64) };
const validate = new Ajv({ strict: true, allErrors: true }).compile(armSchema);
const arm = (plantId?: ArmPlantState['plantId']) => ({ ...MockArmPlant.initial('arm-1'), ...plantId ? { plantId } : {} });

test('a not-run ARM03 record names the model of the run\'s arm plant; only the MuJoCo arm\'s says the asset is the design reference, not the simulated arm', () => {
  for (const [plantId, model] of [[undefined, PUMA560_SI], ['webots_arm', PUMA560_SI], ['mujoco_arm', XARM6_SI]] as const) {
    const r = armCollisionRecord(arm(plantId), world, asset);
    expect(r).toMatchObject({ result: 'not_run', reasonCodes: ['TRACE_EMPTY'], modelRevision: model.revision, assetRef: asset });
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
    if (plantId !== 'mujoco_arm') { expect('assetNote' in r).toBe(false); continue; }
    for (const s of ['arm-puma-reference', 'illustrative design asset', 'not the simulated arm', 'xarm6-g2-v1', XARM6_SI.id, XARM6_SI.revision]) expect(r.assetNote).toContain(s);
  }
});

test('the MuJoCo arm block carries the same statement in its notes; a Webots block has no notes and no note on its record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arm-report-'));
  try {
    const plant = (engine: string) => ({ engine, tracking: { samples: 0, peakRad: [], rmsRad: [] } }) as unknown as ArmPlantReport;
    const cell = { waypoints: { digest: 'd', table: [] }, allowedContacts: [], releaseTimeoutTicks: 200, notes: ['cell note'] };
    const mj = await buildArmReport(arm('mujoco_arm'), plant('mujoco_3d'), directory, world, asset, cell);
    expect(mj.notes).toEqual(['cell note', mj.collision.assetNote]);
    const wb = await buildArmReport(arm('webots_arm'), plant('webots_3d'), directory, world, asset);
    expect(wb.notes).toBeUndefined(); expect(wb.collision.assetNote).toBeUndefined(); expect(wb.collision.modelRevision).toBe(PUMA560_SI.revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
