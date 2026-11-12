# MuJoCo arm cell (`mujoco_worker`)

The plant of the `mujoco_arm` provider (R2a): UFACTORY xArm 6 + Gripper G2, a nozzle stand, a tray and up to eight cups, in MuJoCo. The engine is the pinned
`mujoco==3.17.0` wheel of `requirements.lock` (spec D35), installed with the rest of the hash-locked Python 3.11 venv `.venv-mujoco`; nothing is installed at run time.

- `fixtures/xarm6-g2-v1/` is the arm (generated from the vendor files, see its README); `physics.json` holds the assumed gains, contact and gripper parameters of spike M00.
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
  rules (`protocol.py`, `session.py`); `engine.py` is the only module that imports `mujoco` (one tick = ctrl, cup placements, re-pin parked cups,
  `mj_step(nstep=substeps)`), `snapshot.py` turns a reading into the snapshot (held cups, `restingOn`, `collisionIds`, `PLANT_UNSTABLE`). The bundle holds
  `arm-cell-scene.json`, `component.json`, `physics.json` and `blobs/`.
- Contacts: `collisionIds` are the union over every substep of the tick (the engine steps one substep at a time); held cups, `restingOn`, the opening and
  every pose are read at the end of the tick. Two arm links, or any gripper part (palm, pads) against an arm link, is `"self"` (with these contact bits pads
  cannot touch arm links; the rule is stated for any model). A MuJoCo bad-state warning (`BADQPOS`/`BADQVEL`/`BADQACC`, after which MuJoCo resets the
  state) is `PLANT_UNSTABLE`.
- `physics.capsuleRadiusM`/`capsuleSegmentsM` are not used here: they are the TS capsule sweep's (ARM03), not the engine's collision.

Friction: MuJoCo combines two geoms of equal `priority` by taking the larger of each coefficient; a geom with a higher `priority` imposes its own. Pads have
`priority 1`, so cup–pad contact uses the pad: `world3d.padFriction` (torsional and rolling from `physics.contact.padFriction`). Every other cup contact is
max(cup, other): the cup has `world3d.propFriction`, the stand, the tray, the floor and the statics have `world3d.supportFriction` (torsional and rolling of all of
these from `physics.contact.propFriction`). So cup–stand and cup–tray are governed by `max(propFriction, supportFriction)`: with the spike's 0.6 and 1.0 that is 1.0,
the value the spike had in effect (its stand and tray carried MuJoCo's default 1.0).

```sh
node scripts/bootstrap-portable-simulation.mjs mujoco
PYTHONDONTWRITEBYTECODE=1 .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q
```
