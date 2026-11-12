// Test helper (M04): an ArmCellSceneV1 from the xarm6-g2-v1 fixture with the arm base at the map origin, and the bundle the MuJoCo worker loads. It mirrors
// robotics/simulation-mujoco/tests/scene_fixture.py; the TypeScript scene builder (M06) replaces it. supportFriction 1.0 is test data (see scene_fixture.py).
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sealDocument, validateArmCellScene, type ArmCellSceneV1 } from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

export const XARM6_FX = resolve('robotics/simulation-mujoco/fixtures/xarm6-g2-v1');
const load = async <T>(name: string) => JSON.parse(await readFile(join(XARM6_FX, name), 'utf8')) as T;

type Pose = { position: [number, number, number]; quaternionXyzw: [number, number, number, number] };
type Layout = { cup: { radiusM: number; heightM: number; emptyMassKg: number; drinkMassKg: number }; grasp: { pick: Pose; place: Pose }; nozzleStand: { centerM: number[]; sizeM: number[] }; tray: { centerM: number[]; sizeM: number[] } };

export async function armCellScene(propIds: string[] = ['cup-1'], engineSeed = 0): Promise<ArmCellSceneV1> {
  const [layout, physics, programs, manifest] = await Promise.all([load<Layout>('cell-layout.json'), load<{ contact: { padFriction: number[]; propFriction: number[] } }>('physics.json'),
    load<{ programs: { waypoints: Record<string, number[]> } }>('programs.json'), load<{ modelRevision: string }>('manifest.json')]);
  const { cup, grasp } = layout;
  const scene = sealDocument({ schemaVersion: 1, sceneDigest: '',
    arm: { armId: 'xarm-1', modelId: 'xarm6-g2-v1', modelRevision: manifest.modelRevision, baseInMap: { position: [0, 0, 0], quaternionXyzw: [0, 0, 0, 1] }, homeRad: programs.programs.waypoints.home! },
    statics: [], supports: [{ id: 'nozzle-stand', ...layout.nozzleStand }, { id: 'tray', ...layout.tray }],
    props: propIds.map((propId) => ({ propId, kind: 'cup', radiusM: cup.radiusM, heightM: cup.heightM, massKg: cup.emptyMassKg + cup.drinkMassKg, provenance: 'assumed' })),
    graspFrames: { pick: grasp.pick, place: grasp.place },
    allowedContacts: (['gripper', 'held_prop'] as const).flatMap((a) => (['nozzle-stand', 'tray'] as const).map((b) => ({ a, b }))),
    world3d: { padFriction: physics.contact.padFriction[0]!, propFriction: physics.contact.propFriction[0]!, supportFriction: 1.0, provenance: 'assumed' },
    engine: { id: 'mujoco_3d', timestepMs: 2, substeps: 10 }, engineSeed } as unknown as ArmCellSceneV1, 'sceneDigest');
  const checked = validateArmCellScene(scene);
  if (!checked.ok) throw new Error(`ARM_CELL_SCENE_INVALID: ${JSON.stringify(checked.issues[0])}`);
  return scene;
}

/** <dir>/arm-cell-scene.json, component.json, physics.json and blobs/: what `create` reads. */
export async function writeArmCellBundle(dir: string, scene: ArmCellSceneV1) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'arm-cell-scene.json'), JSON.stringify(scene));
  for (const f of ['component.json', 'physics.json']) await cp(join(XARM6_FX, f), join(dir, f));
  await cp(join(XARM6_FX, 'blobs'), join(dir, 'blobs'), { recursive: true });
}
