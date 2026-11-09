# LinkForge shadow validation worker (`linkforge_worker`)

Stateless Python worker that cross-checks one robot entity's physical model and URDF with `linkforge-core==1.6.0` and reports a `ModelValidationReportV1`
(schema `packages/contracts/schemas/model-validation-report-v1.schema.json`). It runs **shadow**: a failed report never changes the native or mock compiler output,
and IR-SIM runs do not depend on it. Adapter: `packages/lab-runtime/src/engineering/linkforge.ts`; API `POST /lab/v2/engineering/validate`, flag `MEKONIQ_LAB_LINKFORGE=1`.

## Pipeline (spec workers-runtime §1)

MEKONIQ raw checks (finite/units, topology, mass/COM/inertia SPD + triangle inequality, sensor frames) → name map `l_/j_/s_ + sha256(id)` → `read_urdf` on the mapped
copy → **parity** of the parsed model against the input (sets, graph, parameters; `LF_IMPORT_LOSS` / `LF_IMPORT_MUTATION`: the 1.6.0 parser silently repairs
inertia and drops elements, see `docs/research/2026-11-08-linkforge-irsim/`) → `RobotValidator` → optional reference URDF export → immutable report. Pass means
model consistency only, never mechanical strength, stability or safety.

## Setup and pins

`node scripts/bootstrap-portable-simulation.mjs` creates `.venv-linkforge` from `requirements.lock` (CPython 3.11, `linkforge-core==1.6.0`, `PyYAML>=6.0.3`
resolved separately from the native lock). `licenses.json` lists the license of every pin (`node scripts/portable-licenses.mjs --check`). The directory (minus
`tests/`) is part of the `portableSimulationTools` closure; the Lab launcher verifies it and the venv before starting. Tests:
`.venv-linkforge/bin/python -m pytest robotics/model-validation/tests -q`.

Not an OS sandbox: meshes only from the bundle closure, XML ≤ 2 MiB, no DTD/entities/XACRO, no shell, no network.
