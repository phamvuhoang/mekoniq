# Webots 3D plant (`webots_worker`)

The 3D plant behind the shared fixed-step runner. Webots R2025a is a **host install** (never bundled, never installed by a launcher); this directory holds only the code
that talks to it and a hash-locked Python 3.11 venv (`.venv-webots`, `requirements.lock`).

- `webots_worker/compile.py` writes the world (`.wbt`) from a `NavigationSceneV1` (engine `webots_3d`, with `world3d`) and the `RobotPhysicalModelV1` of each robot. Pure and deterministic: same inputs, same bytes. It maps links, joints, inertia and sensors one to one and never goes through URDF. It refuses a model without mass or inertia, a joint other than fixed/continuous, mesh geometry, a path that leaves the bundle, a time step that does not divide 20 ms, a missing `world3d`, and a two-wheel base without a support point ahead of and behind the axle (`NO_THIRD_CONTACT`, it would tip over in 3D).
- `fixtures/serve-3d-v1/` is the Serve robot plus two passive ball casters (`assumed`: 0.035 m radius, 0.15 kg each, mounted so they touch the floor plane the wheels touch) and `world3d.json` (heights and frictions, `assumed`). Regenerate with `pnpm exec tsx scripts/export-sim3d-fixtures.ts`. `robotics/navigation-2d/fixtures/serve-demo-v1` is untouched; IR-SIM keeps using it.
- Wheels are velocity motors named `left_wheel_motor`/`right_wheel_motor` (`..._sensor` for the position sensors) with the joint's velocity and effort limits; the drive's torque-speed curve is not in the physical model, so the torque limit is constant. Every physical value is `assumed`: results are `not_calibrated`.
- The robot links carry collision shapes only (no visual `Shape`), so a Webots LiDAR does not see the robots' own bodies. Whether the other robot must be visible to it is decided in W06/W07 against the engine.

## The arm (R1.1)

A `create` with `arms: [{armId, sceneRef: "arm-scene.json"}]` builds an arm-only world instead (no AMR, no navigation scene): the bundle holds `arm-scene.json` (`ArmScene3DV1`, sealed) and
`arm-component.json` (the `arm-ref-3d-v1` component, whose digest the scene names as `arm.modelRevision`); `seed` must reduce to the scene's `engineSeed` (`engine_seed`: the low 31 bits, a
`WorldInfo.randomSeed` is an SFInt32). `compile_arm_world` writes nested `HingeJoint`s with `J<i>_motor` / `J<i>_sensor` devices; `arm_controller.py` is the extern controller that sets each
joint's target position and reports positions and velocities.

- Every `step` carries one explicit `jointTargets` entry for the arm (like an AMR's velocities, idle is the current pose). A target outside a joint's limits is `JOINT_TARGET_OUT_OF_RANGE`, a wrong
  count or arm id is `JOINT_TARGET_SHAPE` (neither is fatal; the tick does not move and the engine is not called). `velocities` on an arm run, or `jointTargets` on an AMR run, is `INVALID_REQUEST`.
- A joint angle or speed that is not finite, or an angle more than 0.05 rad outside its limits, is `PLANT_UNSTABLE` (fatal).
- `collisionIds` of the snapshot's arm are named from the world-frame contact points of the links: a static obstacle's id, `floor`, or `engine:unattributed` (Webots reports the tracked solid of a
  contact, never what it touched, so an arm link against another link is unattributed too).
- Webots and its controllers run without `USER`, so their per-run state is in `/tmp/webots/default/<port>`; `engine._tmp_dir` is that directory and `close()` removes it.

## Qualification (R1 and R1.1)

`scripts/sim-extension-qualification.mjs` holds both tables (`r1`: WB/ALG/PID/INT11/INT12/REG01; `r1.1`: WA01–WA08, INT13, INT14, REG02) and `scripts/record-sim-extension.mjs --release r1|r1.1` writes
the record (`accepted:false`, a gate is `tested` at most). R1.1 has no campaign: its engine evidence is the suites that drive the real Webots. REG02 holds only when the R1 record, the IR-SIM record and the
mock regression are of the same commit as the R1.1 record, the R1 record's gates are all `tested`, and the IR-SIM record and mock regression are the bytes the R1 record names. Record in this order, each exit 0
before the next, outside both repositories (about 3 hours; Webots takes the screen):

```sh
(cd ../lab && node scripts/record-regression.mjs --suite physical-robot-lab --out $S/regression)
node scripts/record-irsim.mjs --out $S/candidate-N --candidate-id candidate-N
node scripts/record-sim-extension.mjs --release r1 --out $S/r1-candidate-N --candidate-id r1-candidate-N --irsim-record $S/candidate-N --mock-regression $S/regression
node scripts/record-sim-extension.mjs --release r1.1 --out $S/r11-candidate-01 --candidate-id r11-candidate-01 --r1-record $S/r1-candidate-N --mock-regression $S/regression
```

Not to be inferred from these gates: grip force, a cup slipping or tipping, a real arm's load, human safety, LinuxCNC/MoveIt behaviour, a product arm.

```sh
node scripts/bootstrap-portable-simulation.mjs webots
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=robotics/simulation-3d .venv-webots/bin/python -m pytest robotics/simulation-3d/tests -q
```
