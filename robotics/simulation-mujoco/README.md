# MuJoCo mobile and arm cell worker (`mujoco_worker`)

The plant of the `mujoco_arm` provider (R2a): UFACTORY xArm 6 + Gripper G2, a nozzle stand, a tray and up to eight cups, in MuJoCo. The engine is the pinned
`mujoco==3.17.0` wheel of `requirements.lock` (spec D35), installed with the rest of the hash-locked Python 3.11 venv `.venv-mujoco`; nothing is installed at run time.

- `fixtures/xarm6-g2-v1/` is the arm (generated from the vendor files, see its README); `physics.json` holds the assumed gains, contact and gripper parameters of spike M00.
  Its `coffee-cell-project.json` keeps the Lab's arm entity, whose `assetRef` is the Lab's illustrative design asset `arm-puma-reference` (the design catalog has no
  xArm asset): that asset is not the simulated arm. The simulated arm is this fixture's model (`xarm6-reference`, `modelRevision` of `manifest.json`); a MuJoCo run's
  ARM03 record (`assetNote`) and arm block notes say so.
- `mujoco_worker/compile.py` writes the MJCF of a cell from an `ArmCellSceneV1`, `component.json`, `physics.json` and the `blobs/` directory, and returns the names
  it gave (`names`), the only place later code learns them. Pure and deterministic: XML built with ElementTree (fixed order), numbers written as `repr(float)` (shortest
  round-trip text, `-0.0` as `0.0`), no clock, the only absolute path is the blob directory passed in. It refuses (`CompileError(code)`) a link mass ≤ 0
  (`MASS_INVALID`), a missing inertia (`INERTIA_MISSING`), a joint other than revolute/fixed or arm joints that are not one chain (`JOINT_UNSUPPORTED`), more than 8 arm
  joints (`ARM_TOO_MANY_JOINTS`), a missing or altered mesh blob (`MESH_BLOB_MISSING`, `MESH_BLOB_MISMATCH`), a `homeRad` of the wrong length or outside the limits
  (`ARM_HOME_OUT_OF_RANGE`), a cup that is not a cup or has a non-positive size or mass (`PROP_INVALID`), and any other missing or malformed value (`INPUT_INVALID`).
- Model: arm links collide through their vendor meshes (MuJoCo uses the convex hull), adjacent links are excluded, non-adjacent links collide; the gripper collides
  only through the assumed palm and pad boxes of `physics.json` (its meshes are visual only and are not compiled). Position actuators `J<i>_act` and `grip_act` on the
  drive joint; the other gripper joints follow it through `equality/joint` (the `mimic` table). Cups are free cylinders, parked at `z = -10 - n` with contacts off;
  the worker places them (and must reset geom and body contact bits, see `compile.py`). Keyframe `home` = `homeRad`, gripper open.
- `python -m mujoco_worker` is the plant worker (M04): `mekoniq-sim3d/1` NDJSON on stdio with the Webots worker's envelope, ops, ACK, clock, priming and idempotency
  rules (`protocol.py`, `session.py`); `engine.py` owns the arm engine (one tick = ctrl, cup placements, re-pin parked cups,
  then `substeps` single `mj_step` calls, one substep at a time), `snapshot.py` turns a reading into the snapshot (held cups, `restingOn`, `collisionIds`, `PLANT_UNSTABLE`). The bundle holds
  `arm-cell-scene.json`, `component.json`, `physics.json` and `blobs/`.
- Contacts: `collisionIds` are the union over every substep of the tick (the engine steps one substep at a time); held cups, `restingOn`, the opening and
  every pose are read at the end of the tick. Two arm links, or any gripper part (palm, pads) against an arm link, is `"self"` (with these contact bits pads
  cannot touch arm links; the rule is stated for any model). A MuJoCo bad-state warning (`BADQPOS`/`BADQVEL`/`BADQACC`, after which MuJoCo resets the
  state) is `PLANT_UNSTABLE`.
- `physics.capsuleRadiusM`/`capsuleSegmentsM` are not used here: they are the TS capsule sweep's (ARM03), not the engine's collision.
  ARM03 also uses a conservative gripper capsule extending behind the TCP to the palm's back face, with the palm's xy half-diagonal as its radius.
  For the pinned fixture it encloses the palm and both pads from open to closed; the geometry remains assumed.
- `arm-drop` is unsupported on this contact plant: both scheduled and immediate injections are refused before being recorded. Cup-loss tests use physical contact faults.

Friction: MuJoCo combines two geoms of equal `priority` by taking the larger of each coefficient; a geom with a higher `priority` imposes its own. Pads have
`priority 1`, so cup–pad contact uses the pad: `world3d.padFriction` (torsional and rolling from `physics.contact.padFriction`). Every other cup contact is
max(cup, other): the cup has `world3d.propFriction`, the stand, the tray, the floor and the statics have `world3d.supportFriction` (torsional and rolling of all of
these from `physics.contact.propFriction`). So cup–stand and cup–tray are governed by `max(propFriction, supportFriction)`: with the spike's 0.6 and 1.0 that is 1.0,
the value the spike had in effect (its stand and tray carried MuJoCo's default 1.0).

In the Lab, `pnpm lab:mujoco` (`lab/`) starts the pinned runtime with this worker (provider `mujoco_arm`, scenario `MJ-BV01`); the container image is `deploy/lab-runtime/`.
The [implementation evidence index](../../docs/implementation/README.md) names the current qualification records and their gate and acceptance status. Keep candidate-specific updates in that index:
this README belongs to the pinned portable tool closure, so editing it after a recording would invalidate the Lab's pin.

The B02a mobile worker path takes `create.payload={sceneRef:'navigation-scene.json',seed:7}`; robot identity comes from the scene, with no new create-envelope fields.
`compile_mobile.py` builds canonical primitive colliders, every link's mass/COM/full inertia, two wheel hinges, a free chassis and free payload cylinders.
`mobile_engine.py` advances ten 2 ms substeps per logical tick, updates the velocity servo torque envelope from actual wheel speed, and reads map pose/twist,
wheel-angle odometry, engine LiDAR raycasts, payload support-relative poses and force/impulse contact aggregates. The create priming step is tick zero;
engine time is `(tick+1)*20ms`, while snapshot time is `tick*20ms`, as in the arm worker.

The bundle must contain every hashed `scene.files` input and the load/physics profile refs. Admission checks schemas, safe paths, byte hashes, document digests,
model/projection IDs, physical support geometry, finite torque/speed limits, initial penetration and the closed numerical lock before stepping. This slice admits
one differential AMR, one noiseless LiDAR, convex extruded world obstacles, fixed sphere caster supports, and up to eight cylinder payloads. Actors, arm commands
and interaction placements are refused in the mobile-only world. Canonical robot parts intentionally overlap, so robot self-contact is masked; world and payload
contacts remain active. Chassis roll/pitch are unconstrained. Caster-floor friction uses explicit pairs; floor-wheel friction uses MuJoCo's componentwise max.

`fixtures/serve-payload-v1/drive-contact-profile.json` freezes numerical inputs before measurement; its result is recorded separately, preventing a hash cycle.
See `docs/research/2026-11-mujoco-mobility-spike.md` and `probe_mobile.py` for the bounded probe, raw records and observed slip/odometry differences. These are
uncalibrated software measurements. B02a originally stopped at the Python worker boundary. The integrated Source mobile provider below now supplies runtime readiness and shared arm/mobile engine capacity; campaign and durable payload evidence remain subsequent work.

```sh
node scripts/bootstrap-portable-simulation.mjs mujoco
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q
```

### Source mobile provider

`MEKONIQ_LAB_MUJOCO=1` now exposes the arm provider plus the mobile `mujoco_3d` plant when an engineering bundle service is configured. Mobile uses `engineering-mujoco-3d-v1` and `MJ-FD01`; the compiler accepts one registered canonical Serve AMR and selects the center load server-side. The existing arm-only CLI options remain sufficient for R2a.

Mobile CLI configuration additionally needs `--engineering-catalog`, `--engineering-simulation`, and a usable `--engineering-python` interpreter with yaml/rfc8785/jsonschema/referencing (the provisioned `.venv-irsim/bin/python` is suitable). `--mujoco-worker` supplies the reviewed fixture/profile closure. No native compiler fallback is used for a missing mobile compiler. The eventual B09 mobile image must ship this actual engineering closure and helper dependencies or implement a separately explicit portable-only mode.

See `docs/research/2026-11-mujoco-mobile-provider-integration.md` for the mobile controller ramp, cached LiDAR publication semantics, stop policy, input hashes and real mission result. Physics and policy assumptions remain `not_calibrated`; durable payload evidence is subsequent B03 work.
