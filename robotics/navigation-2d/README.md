# IR-SIM 2D navigation plant worker (`irsim_worker`)

Portable developer-Mac/Linux provider `irsim_2d` for the MEKONIQ Lab (spec: `docs/superpowers/specs/2026-11-08-linkforge-irsim/`). The Python process owns **plant
state only**: one IR-SIM world per run, stepped 20 ms at a time by the source runner (`packages/lab-runtime/src/v2/navigation2d/`), which owns the clock, the
missions, the controller (`grid-diff-v1`) and every velocity. Wire protocol `mekoniq-irsim/1` (NDJSON on stdio, schema `packages/contracts/schemas/irsim-worker-v1.schema.json`).

## Setup (explicit, no run-time install)

```sh
node scripts/bootstrap-portable-simulation.mjs      # creates .venv-irsim and .venv-linkforge from the hash-locked requirements
node scripts/lab-irsim.mjs doctor                   # pinned worker answers describe with the lock digest
```

Pins: `requirements.in` → `requirements.lock` (hashes), CPython 3.11, `ir-sim==2.12.0`. `licenses.json` is the license inventory of exactly those pins, read from the
venv by `node scripts/portable-licenses.mjs` (`--check` in the qualification record). Every file of this directory (minus `tests/`, bytecode) is part of the
`portableSimulationTools` closure the exporter hashes and the Lab importer/launcher verify; `pnpm lab:irsim` refuses a tree that differs from the pinned closure.

The worker is started with `python -I -B -X pycache_prefix=… -c <bootstrap>` (roots added after `site`), a fixed argv and an allow-listed environment. The venv
isolates dependencies; it is **not** an OS sandbox.

## Contents

- `irsim_worker/`: `session.py` (lifecycle created → running ↔ paused → stopped, one `env.step` per accepted step, actors placed per tick), `snapshot.py`
  (typed snapshot: poses in the drive frame, LiDAR `hit|no_return|below_min|invalid`, contacts named by scene id), `scene.py`/`compile.py` (scene → `irsim/world.yaml`
  + name map; the portable compiler entry), `protocol.py`.
- `fixtures/serve-demo-v1/`: the illustrative Serve fixtures (assumed geometry, see each manifest) the Lab and the campaigns compile.
- `campaigns/`: server-owned campaign files for `scripts/lab-irsim.mjs run` (`c02-qualification`, `c02-concurrent`).
- `tests/`: pytest (run with `.venv-irsim/bin/python -m pytest robotics/navigation-2d/tests -q`, `PYTHONPATH=robotics/navigation-2d:robotics/simulation`).

## Limits (recorded with every run)

Planar kinematics only: no dynamics, contact physics, actuator torque, SLAM or hardware behaviour. Collision mode `stop`. LiDAR raycast on the same plane as the
obstacles (`PLANAR_OCCLUSION_NO_HEIGHT_FILTER`). The engine's NumPy generator is seeded once per environment (`irsim-env-seed-v1`), so per-sensor noise streams
are not independent. Cross-platform bitwise repeatability is not qualified. Nothing here is evidence for Gazebo/Nav2, calibration or hardware gates.

Qualification: `node scripts/record-irsim.mjs --out <new dir>` records the campaign, the verification suites and a steady-state measurement into one
`qualification.json` (`linkforge-irsim-qualification/1`); `pnpm test:acceptance -- linkforge-irsim` with `LAB_IRSIM_EVIDENCE_DIR` refuses an inconsistent record.
