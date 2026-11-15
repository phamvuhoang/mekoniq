# B02a implementation report

Status: DONE_WITH_CONCERNS — source slice implemented, verified and committed; controller review/export/Lab pin remain. BASE `26199b8e3cddb3bb7b21b52a7e2c004d89b7ced6`; HEAD `b647429` (`feat: run a payload AMR on the MuJoCo plant`). Only the paired source worktree was edited. No original main checkout, Lab, trial/web, dependency/engine lock, deployment or hardware was changed. Source tracked tree is clean after commit. The concerns below are measured limitations and explicit downstream boundaries, not a claim of qualification.

## Delivered files and behavior

- New `robotics/simulation-mujoco/mujoco_worker/compile_mobile.py`: deterministic canonical primitive MJCF, every link's mass/COM/full inertia, unchanged rigid hierarchy and joint origins, two finite-driven wheel hinges, explicit fixed sphere caster supports, six-DOF free chassis and free payloads, convex obstacle/boundary prisms. Unique generated names avoid entity/link/shape aliases. No equality constraint, hidden chassis restraint, pose reset or payload weld is used for free loads.
- New `drive.py`: `wheel_targets(v_mps,omega_radps,radius_m,separation_m)` with +yaw = left backwards/right forwards; actual-speed interpolated motoring torque envelope and separate braking cap. Wheel target speed and canonical effort limits are enforced.
- New `mobile_engine.py`: real pinned MuJoCo 3.17.0, 10 individual 2 ms substeps, force bounds updated from actual wheel velocity each substep; measured map pose/twist, actual wheel angle/velocity/actuator force/target/saturation, independently integrated wheel odometry, independent engine LiDAR rays, load map/support poses and velocities, canonical signed force/impulse contact aggregates. Bad-state warnings/nonfinite state and contact-capacity overflow fail closed. Native geometric distance checks initial support contact without taking a settling step; deep initial collision penetration is refused.
- `session.py`: routes `navigation-scene.json` into the mobile engine; preserves arm-cell create and stepping. Closed schema admission, safe confined nonsymlink paths, scene/profile/model digests and file byte hashes/sizes are checked before model construction. Mobile-only commands take exactly one explicit velocity; actors, arm/gripper commands and placements are refused before engine mutation. Existing expected/target tick checks, receipts/idempotency and lifecycle apply. Clock drift is fatal. The session grew from the arm path but remains one lifecycle, with explicit mobile helpers rather than a copied state machine.
- `snapshot.py`: separate mobile finite-state check/builder emitting existing Sim3DSnapshotV1 plus optional physics. `protocol.py`: reusable schema validator registry constructor; existing wire schema and ops unchanged. `__main__.py` passes its existing schema-dir argument into the session for exported/portable paths.
- New `tests/test_mobile.py`: **40 real/semantic mobile tests**, including actual MjModel primitive pose/size/mass/COM/principal-frame inertia reconstruction, axes, free DOF/no equality, wheel signs, finite torque/high-speed braking, explicit caster friction, map raycast independence, truth-independent wheel odometry, signed gravity-balanced contact summation, load resting relative to moving support, clock/reset/capacity errors, strict admissions, invalid IDs/ticks, unknown wire input, actual NDJSON worker and raw-artifact/hash coverage.
- New `probe_mobile.py`, `docs/research/2026-11-mujoco-mobility-spike.md`, final/exploratory gzip raw records and summaries. Source raw records are new spike artifacts, not a rewrite of historical qualification evidence.
- Fixture generator and generated `serve-payload-v1` assumptions/profiles/scene/manifest/README updated only for the numerical lock and resulting hashes. Physical model/component/project/world3d bytes remain canonical; load schema/API is unchanged. Worker README describes mobile use and limitations.

## Stable API for B02b/B03

Create uses the EXISTING envelope, without a new robots token:

```json
{"protocol":"mekoniq-sim3d/1","requestId":"create-1","runId":"run-1","expectedTick":0,"op":"create","payload":{"sceneRef":"navigation-scene.json","seed":7}}
```

The robot ID comes from the scene. Nonempty `arms` is refused for mobile-only create. Scene engine remains `{id:'mujoco_3d',version:'3.17.0',timestepMs:2,substeps:10,physicsProfileRef,loadProfileRef}`. All declared scene.files are byte-verified; refs must be in those verified files. `load.modelRef` locates the physical model (do not assume a filename in the provider). Main snapshot sceneDigest is the navigation scene digest. For a different load, update the scene's loadProfileRef to its exact id/revision/path/byte SHA and reseal sceneDigest; no fixture-wide digest can stand in for the per-load main scene.

Start/pause/resume/getState/stop preserve existing semantics (`stop.payload.reason` is required by the existing wire schema). One step payload:

```json
{"targetTick":1,"velocities":[{"robotId":"amr-1","vMps":0.2,"omegaRadps":0.4}],"actorUpdates":[]}
```

No unsupported interactions are silently ignored. Priming is one zero-target tick: snapshot tick 0/time 0, engine time 0.02 s. Thereafter engine time `(tick+1)*0.02`, source snapshot/physics time `tick*20_000_000` ns. One accepted request calls one engine tick; exact idempotent replay returns the stored ACK without stepping. Seed is a run identity input; this admitted model has no stochastic engine process, no sensor noise and no actors. It does not invent an engine RNG stream.

`compile_mobile(scene,physical_models,load_profile,physics)->(mjcf,names)` takes parsed admitted documents, with physical_models keyed by robotId. The session is the byte-admission boundary; direct compilation checks semantic/profile identities and physical support/clock/axis/effort/speed assumptions before constructing the MjModel. `MobileEngine(scene,physical_models,load_profile,physics)` then owns model/data; `step(v,w)->reading`, `read()->reading`, `readback()->Sim3DModelReadbackV1`, `close()` releases references. Engine `step` itself refuses wheel targets beyond canonical speed before touching controls/time.

Names are internal generated symbols, never wire IDs: `names.links[canonicalLinkId]=BODY_i`; `names.joints[canonicalJointId]=WHEEL_i`; `names.geoms[(linkId,shapeIndex)]=GEOM_i`; `base`, ordered `wheelJoints` and `actuators`; `props[propId]=PROP_i`; `supports[supportId]=profile support`; `statics[worldId]=STATIC_i`; `tags[geomName]=canonical contact ID`; `expected` is the finite set of admitted expected pairs. Consumers should use names rather than infer index/order. Contact IDs are `floor`, `<robotId>/<linkId>/c<shapeIndex>`, `prop/<propId>`, `static/<worldId>`. Contact a<b lexically, force is ON b. Multiple points are summed per pair/substep before peak calculation; samples counts substeps, max10. Every substep contributes normal/map impulse; >256 pairs is fatal, never truncated. Expected pairs are wheel/caster-floor and declared free prop-support parent colliders. All other contacts remain unexpected.

Wire snapshot uses generated B01 types exactly: one `robots` state, `arms:[]`, legacy-format props (`position`, xyzw, restingOn) and `physics` `{schemaVersion:1,tick,simTimeNs,contacts,loads,wheels,odometry,base}`. Base/load physics poses use `positionM`, xyzw. Wheel angle/velocity/torque/target are left/right ordered; saturatedSubsteps counts substeps where either wheel's requested servo effort clips. Odometry yaw is deliberately unwrapped; wrap residual differences. Scans use existing LidarScanV1 with actual sample tick/time and 5-tick cadence; cached scans retain their own older sample tick. Ranges are actual MuJoCo rays with robot geom group1 excluded, with null/no_return and null/below_min states. `getState.model.robots` contains actual link masses/world positions, actual cylinder radius/separation/world wheel axes; detailed geometry/inertia parity is exercised against MjModel in Python, not added to the wire schema.

Loads retain the declared support as their coordinate reference, with independently transformed poseInSupport even if contact is lost. `props.restingOn` is separate measured final-state contact plus small relative linear velocity. It is NOT B03's sustained receiver/support-polygon oracle; do not use one contact tick as proof of delivery.

## Numerical lock and measurement

Engine pin unchanged: MuJoCo3.17.0/Python3.11.15, arm64/macOS. Profile byte SHA `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`; document digest `1ef1c4de61894e35e89fbbc8cb534c184ef66944e40fed60dedf496f81956480`; numerical-input SHA `c29fe1c6cde3923b31a1b5093d81f3c552bf3c5a3f394c674c0e528079f0396f`. `requiresB02MeasurementLock:false`, closed `measurementLock.status:'locked_not_calibrated'`, probeId `b02a-locked`, 1e-6 m/rad repeat tolerances. Numerical-input fingerprint covers tick/timestep/substeps, integrator/solver, gain/brake/curve/contact/numerics and is rechecked at admission. The result references the exact pre-frozen input bytes; input profiles do not hash a future result, avoiding a cycle.

Final unchanged values: gain2 Nm s/rad; brake6 Nm; motoring (0,6),(10,6),(20,0) rad/s,Nm; target ±20rad/s, canonical effort6Nm. implicitfast/Newton/iterations100/tolerance1e-8; timestep2ms×10; gravity[0,0,-9.81]; condim6; solref[.02,1]; solimp[.9,.95,.001]. Generic friction[.6,.005,.0001], floor sliding.8, wheel-floor max-mixing=.8, explicit caster-floor[.02,.02,0,0,0]. Other engine defaults remain those of pinned3.17.0. Fixed spheres stay fixed; these are sliding supports, not invented swivel joints. No numerical tuning or geometry change was required.

Final **36 runs**, four 10s cases × empty/center/offset ×3 repeats, every500ticks retained (18,000 final ticks). Full10s hold; straight/circle/stop include initial2s hold, 1s ramp, bounded motion then stop. Exact command policy, observed p95 per case/repeat and measured metrics are in the research document/summary. Actual final clocks match `(tick+1)*.02`. All final runs finite; repeat compares chassis AND every payload pose at EVERY TICK, not only endpoints. Maximum position-coordinate difference0m; quaternion-angle numerical delta9.884312124119402e-8rad, below1e-6. Largest observed cup shift.0044081466m (offset stop); tilt.0009638446rad (center stop). Circle odometry residual up to.137062537m/.269900454rad is preserved as observed drag/slip. No truth correction. This is not calibrated payload safety/localization/braking performance.

Final artifacts: `docs/research/mujoco-mobility-spike/b02a-locked/summary.json`, SHA `d0e2453711b4f676de5d546ccb29247d1339bc65592f32b6338c93917b1174f5`, indexes all36 gzip file byte hashes/sizes and repeats. Every identity record embeds the exact locked profile, actual per-load sealed scene, compiled sceneDigest, byte input hashes and actual model readback. Every tick includes command, clock, actual chassis pose/twist, wheel/odometry/load/contact records. LiDAR arrays are omitted from these bounded raw probes and covered by an independent engine-geometry mutation test. Hash/tick/clock/profile-closure tests read all final raw records. Final raw≈12MB compressed; total with exploration≈24MB.

Exploratory `b02a-initial/` is preserved unchanged and explicitly **not admitted/not lock-closing**: direct-engine runs used the correct actual empty/offset profiles but retained a center-load scene ref. Discovery produced a negative profile-identity test and per-load sealing, followed by the full final rerun after the numerical lock was frozen. Its summary's finite/repeat checks do not qualify its inconsistent scene identity. Do not use it for B03 qualification.

## RED/GREEN and validation evidence

Commands ran only in paired source. Python prefix for all tests/probes: `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`; long commands wrapped in `perl -e 'alarm N; exec @ARGV'`. Node PATH prepended `$HOME/.nvm/versions/node/v24.22.2/bin` (pnpm10.32.1).

Meaningful RED observations before corresponding implementation:

- Initial `... .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_mobile.py -q`: collection failed on missing drive, then missing mobile_engine, before those modules were added. First actual engine/compiler/drive set then7passed.
- Mobile semantic/session set: **8failed/13passed**; unsupported mobile create and outside-support mutation did not raise before routing/load semantics implementation. Green after implementation.
- Closed numerical lock set: **3failed/29passed**; lock stilltrue and arbitrary nested numerics/measurementLock fields reached the engine factory. Green after frozen closed profile/fingerprint admission.
- `-k canonical_wheel_speed`: DID NOT RAISE before actuator target-speed validation; green after canonical ctrl range and pre-mutation refusal. A misspelled XML attribute was caught in the focused test and corrected to `ctrllimited` before recording final probes.
- `-k direct_compiler_refuses`: DID NOT RAISE for mismatched load ID before direct compiler identity check; green after check and corrected per-load probe scenes.
- `-k self_intersecting`: DID NOT RAISE for a pentagram support before convex/simple half-plane admission. Namespace duplicate test also tightened deterministic early refusal.
- `-k geometry_quaternion`: chassis collider quaternion[0,0,0,2] DID NOT RAISE before explicit unit-quaternion rejection instead of XML-loader normalization. Initial test selected a caster already validated by support checks; corrected the test target, observed RED, restored fix, GREEN.
- Self-review initial-support guard caused **14failed/68passed** in a full run (preserved `python-support-guard-red.log`): exact zero-gap box/cylinder produced no contact before stepping. Systematic diagnosis showed `mj_geomDistance=0` for valid support and0.1m for floating support while both had no cup contact record. Corrected admission to native geometric distance without stepping; final full suite passed. No contact margin/geometry/numerical tuning was used as a workaround.
- Real NDJSON test caught an early invented robots create token; corrected production/test to the existing schema (`sceneRef,seed` only), and supplied the existing required stop reason. Final real worker passes, with no stdout noise.

Final checks (all exit0, no skips):

1. `perl ... alarm300 ... .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q`: **83passed in8.42s**. Log `.superpowers/sdd/01-r2b-mobility/evidence-B02a/python-head.log`. Final focused mobile: **40passed in2.35s**, `mobile-final.log`.
2. `perl ... alarm600 ... pnpm exec vitest run tests/contracts/mujoco-payload.test.ts tests/unit/payload-fixture.test.ts tests/integration/mujoco-arm-worker.test.ts tests/integration/mujoco-arm-bv01.test.ts`: **4files/24tests passed**. Includes deterministic fixture regeneration twice and comparison with committed bytes, real arm worker readback/clock, and two-cup BV01 plus tamper verification. Log `typescript-regression.log`.
3. `pnpm contracts:check`: `Contract generation matches schema.`; `pnpm typecheck`: exit0; `pnpm lint`: exit0, no exclusions or ESLint config edits. Logs `contracts-check.log`, `typecheck.log`, `lint-final.log`.
4. Normal lint initially reported157errors solely inside B01's ignored generated runtime-export/runtime.mjs. Controller moved that intact export to `/tmp/mekoniq-r2b-b01-export-26199b8-20261114`; normal lint then passed. Original failure retained in `lint.log`; no source lint failure was hidden.
5. `git diff --check` and staged check pass; engine requirements lock and physical-model byte diff empty. No __pycache__/.pytest_cache/MUJOCO_LOG under the tool tree. Intentional warning tests run in temporary cwd. Initial root MUJOCO_LOG was preserved in ignored evidence-B02a and removed from the tree.
6. Final probe: `perl ... alarm240 ... .venv-mujoco/bin/python robotics/simulation-mujoco/probe_mobile.py --out docs/research/mujoco-mobility-spike/b02a-locked`; exit0. Every raw hash/profile identity/tick/clock revalidated by the final Python tests.

## Self-review, concerns and next slice

Read the staged implementation/fixture/docs diff and checked input admission order, free DOFs/no equality, actual inertia frame reconstruction, actuator directional caps, canonical force-on-b sign, per-substep summation/counts, sensor self-filter, independent odometry, final-state support observation, no-step getters and receipt immutability. Independent velocity-frame diagnostic also verified mjOBJ_BODY returns COM linear velocity and the current correction recovers the free-body origin velocity exactly; no dynamics code change was needed.

B02b still owns TypeScript provider, runtime bundle admission/catalog/readiness/CLI, shared MuJoCo arm/mobile slot, runner identity/seed integration and profile stop policy. No mobile backend is advertised here. B03 owns durable physics/interactions streams, metrics/window/coverage/quota readers, faults and the actual campaign. Keep actors empty in this admitted slice; supporting actors/noisy sensors/nonconvex obstacles/other wheel axes needs an explicit physical-model extension, not a fake fallback. Current one-noiseless-LiDAR/canonical differential-drive/convex-world constraints are explicit refusals.

The sliding-caster approximation and observed circle odometry discrepancy must remain limitations. `restingOn` is an instantaneous relative-contact observation, not a delivery oracle. Numerical lock is input identity; B03 must verify final result/hash closure separately. These source tests and probes do not close G-MJ1 by themselves, any native/device gate, cell sweep or human acceptance; all artifacts remain accepted:false/not_calibrated. Controller handles independent review, clean export and Lab pin after this source commit. No push/deployment was performed.

## Fix round 1 — admit LiDAR references before priming

Controller review finding: a schema-valid, resealed projected LiDAR ID could be absent from the physical model. Resolution was deferred to `scan()` after the create priming substeps, so `StopIteration` became `WORKER_FAILED` after the engine had already reached 0.02 s. Duplicate physical sensor IDs were also ambiguous instead of explicitly refused. Verified this was a real admission-order defect; the review request required no scope clarification.

Fix commit: `eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc` (`fix: admit mobile LiDAR references before priming`), parent `b647429a993215f5167bd30fa6ea0f30dcde65a0`. Source tracked tree clean after commit. Four Python files only; no JS/TS, schema, engine pin, fixture/profile or probe bytes changed. No Lab/export/pin or deployment. Existing 36 locked probes were not rerun because numerical and valid-sensor behavior are unchanged.

`compile_mobile.resolve_lidar(navigation_model, physical_model)` now enforces the admitted one-noiseless-LiDAR constraint, resolves its ID to exactly one physical sensor, and raises typed `CompileError` codes `SENSOR_REFERENCE_UNKNOWN` or `SENSOR_REFERENCE_AMBIGUOUS` otherwise. The session calls it after schema/hash/model admission and before invoking the engine factory, translating CompileError into a nonfatal typed WorkerError. Direct compiler semantics also call it before building the MJCF; MobileEngine caches the resolved projection/physical sensor before constructing MjModel. `scan()` uses that cached admitted pair, removing the deferred `next()` failure after physics advances.

Tests were added before the production fix. The four new parameterized cases cover missing/ambiguous IDs through direct compilation and fully schema-valid/resealed session bundles. The ambiguous case reseals modelDigest, physical byte hash, load modelRef/digest/byte hash, nested navigation model digest and main sceneDigest, so it exercises reference semantics rather than stale-hash rejection. The session regressions require the exact typed refusal, no engine factory invocation, state `new`, tick/seq/substeps all zero, and engine/scene/snapshot all None. Direct regressions require typed CompileError with the matching code.

Exact RED command:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 60; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_mobile.py -k 'lidar_reference or resolves_lidar' -q
```

RED output: **4 failed, 40 deselected in 0.51 s**. Direct compiler did not raise; session cases reached the sentinel engine factory and returned WORKER_FAILED instead of a typed sensor refusal. Log: `evidence-B02a/fix-round1-red.log`. Same command after implementation: **4 passed, 40 deselected in 0.43 s**, exit 0; log `fix-round1-green.log`.

Final focused verification:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 120; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_mobile.py robotics/simulation-mujoco/tests/test_session.py -q
```

**69 passed in 4.67 s**, exit 0, no skips (44 mobile plus 25 session tests). Log: `evidence-B02a/fix-round1-python.log`. This includes the valid independent raycast, mobile NDJSON protocol, actual sensor cadence/output, wheel/contact behavior and legacy arm session tests.

Relevant real arm regression, with Node 24.22.2 PATH prepended:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-worker.test.ts
```

**1 file / 3 tests passed**, exit 0 (2.33 s). Log: `evidence-B02a/fix-round1-arm-worker.log`. The first arm invocation overlapped the Python mobile subprocess test: its global `pgrep` cleanup assertion saw that unrelated live worker, producing 2 passed / 1 failed. The process had exited by inspection; the sequential arm rerun passed without code changes. The concurrency diagnosis is preserved in `fix-round1-arm-concurrent.log`. These process-global cleanup tests must run sequentially with other real worker tests.

`git diff --check` and staged diff check pass. Explicit `git diff --exit-code` for fixtures, requirements.lock and the raw spike artifacts was empty. Normal lint was not rerun because this fix changes only Python, as directed; the normal source lint result from B02a remains recorded above. Self-review confirmed the new check precedes factory invocation/model construction, the direct compiler shares the same semantic check, and valid scan geometry/physics is unchanged. No additional review finding was broadened into this fix. Controller scoped re-review remains.
