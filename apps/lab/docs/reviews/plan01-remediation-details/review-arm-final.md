# Independent ARM scene review

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

Reviewed 2026-11-05 by `review_arm_final`. Scope: new geometric checker, mock arm stop/custody behavior, declared scene transforms and dynamic AMR proxies, bounded evidence, Lab inspector/replay. No implementation files changed by reviewer.

## Verdict

Three important integration findings need closure. Root and implementers were notified with reproductions. The underlying sweep math and scene transformation review did not reveal another concrete false-negative in the declared illustrative model.

### AR01 — Important: source-only CI requires an absent sibling repository

`source/tests/integration/lab-v2-arm-scene.test.ts`, shipped Lab fixture test (original line 43, now lines 45–47).

The added test unconditionally read `../lab/fixtures/twins/coffee-cell-v2.json`. Source CI has no sibling Lab checkout; this caused ENOENT independently of the existing optional-fixture policy. Root has since added the same conditional skip/explicit `LAB_V2_REQUIRE_LAB_FIXTURES=1` failure semantics used elsewhere. Root owns the isolated checkout verification. This review's first focused suite ran with Lab present and therefore did not test the standalone branch.

### AR02 — Important: an unused but valid project AMR blocks every coffee transfer

`source/packages/lab-runtime/src/v2/models/arm-scene.ts:30,48–50`; `scenario-runner.ts:107,139`.

The declaration includes every AMR in the project, while the plant includes only the scenario-selected subset. Consequently a normal two-AMR project running one-AMR BV01 has a declared robot with no plant pose. `materializeArmScene` reports `ROBOT_GEOMETRY_UNKNOWN` despite both assets having known geometry, and the arm latches `ARM_SCENE_GEOMETRY_UNAVAILABLE`.

Direct execution reproduced this with `coffeeProject()`, a copy of its AMR named `amr-2`, and a second parking point at `(0.8, 3.2)`. BV01 seed 42 reached `needs_attention` at tick 1450; active robots were `[amr-1]`, while both declared radii were `0.40697051490249264` m. The original one-AMR fixture completes.

Provide explicit static parked poses for inactive project robots or another explicit modeled treatment; do not silently omit them from collision geometry. Also test an inactive robot parked under the arm, so resolving the nominal case cannot hide an obstacle. `arm_scene` owns the correction.

### AR03 — Important: collision replay discards existing historical evidence

`lab/src/reports/replay.ts:71–77`; `lab/src/twin/coffee-cell.ts:74–81`.

Replay only retains the entire collision object once its **latest** scene tick is at or before the cursor. It does not project the newly recorded intervals or immutable first failure. A collision at tick 20 followed by a final scene snapshot at tick 100 therefore displays no collision evidence at the collision cursor, even though the report has the exact geometry pair and world snapshot.

A direct `openReplayV2(report).project(view, 20)` probe with a retained tick-20 failure/interval and tick-100 scene returned `collision: null`. Project intervals and failure evidence to the cursor; trim interval end ticks and geometry references; exclude future failures and indicate truncated/unrecorded spans honestly. Preserve immutable report contents.

## Independent validation

Node 24.22.2.

- Source: `pnpm exec vitest run tests/integration/lab-v2-arm-scene.test.ts tests/integration/lab-v2-arm-safety-model.test.ts tests/integration/lab-v2-arm-faults.test.ts tests/integration/lab-v2-model.test.ts` — **46 passed**, 4 files, 59.16 s.
- Lab: `pnpm exec vitest run tests/unit/arm-scene-scope.test.ts tests/unit/report-evidence.test.ts tests/integration/project-v2-migration.test.ts tests/unit/workspace-replay-freshness.test.ts` — **35 passed**, 4 files, 366 ms.
- Separate direct tsx probes confirmed AR02 and AR03 as described above; no persistent run state was left by the AR02 probe.

## Model boundaries checked

The checker uses capsule geometry and conservative interval rejection, including attached-cup geometry and relative-link motion bounds. Full inverse base transforms enclose eight corners of each declared prism. AMR current/previous envelopes conservatively cover modeled linear motion in a tick. Stationary held-cup checks, latched stops, retained custody, immutable triggering evidence and bounded trace disclosure are present. Geometry heights and frames remain explicitly illustrative; the reports do not claim calibrated geometry, physical grip, dynamics, sensor validation, or hardware stop performance.

The 3D scene is still a schematic viewer rather than the collision geometry oracle. This review does not treat visual overlap or these passing mock suites as physical acceptance or Linux/controller validation.

## AR01/AR02 re-review

- **AR01 addressed.** The fixture test now skips only when the Lab file is absent and `LAB_V2_REQUIRE_LAB_FIXTURES` is not `1`. Explicit fixture enforcement still performs the read and fails if absent. Code matches the established source-only CI policy. Root owns and reported the isolated checkout red/skip/required-fail experiment; this reviewer did not repeat that experiment.
- **AR02 addressed.** The immutable declaration now records `dynamic` versus `static_parked`, parking identity and the modeled parked pose. All project robots participate in collision geometry. Static bindings use the same sorted entity/parking mapping as scenario roles; they are hashed into the scene identity. Missing parking remains `ROBOT_POSE_UNKNOWN`; it does not invent clearance or omit the object.
- Independent fresh validation: `pnpm exec vitest run tests/integration/lab-v2-arm-inactive-scene.test.ts` — **3 passed**, 19.62 s. The original nominal reproduction now completes; an inactive robot under the arm blocks transfer and retains custody; absent parking blocks clearance.
- **AR03 pending** the Lab replay correction and its scoped re-review.

## AR03 final re-review

**AR03 addressed; no open finding remains in this scoped review.** Replay now projects retained intervals and immutable first failure, clips stationary intervals to the cursor, filters future/unreferenced worlds, and derives scene scope only from recorded scene metadata or the matching immutable declaration. Truncated history exposes unknown earlier counts and incomplete coverage; missing geometry cannot borrow the final world. The inspector shows the retained pair and checker result. Stop state is also reconstructed from cursor-bounded observed/reset events, so a future collision/reset no longer leaks into an earlier cursor.

Independent fresh validation:

- `pnpm exec vitest run tests/unit/replay-arm-collision.test.ts tests/unit/workspace-replay-freshness.test.ts tests/unit/arm-scene-scope.test.ts tests/unit/report-replay.test.ts tests/unit/workspace-reclaim.test.ts` — **34 passed**, 5 files, 611 ms.
- Direct cross-repository probe using an actual BV01 run with a blocking project fixture: the collision occurs at tick **1**, final report tick **1450**. Lab replay at tick 1 now retains `link-3 ↔ fixture:base-blocker`, checker/model/geometry/tolerance and the three modeled stop stages; tick 0 has no collision result. The temporary run was closed and removed.
- The mixed-scenario followup only strengthens test assertions: exact runtime plus arm-scene profiles, profile hash mutation/immutability, and static parked robot scene coverage. Reviewed these assertions; no production change or new finding.

This verdict is scoped to AR01–AR03 and the reviewed model boundaries. Root still owns clean runtime packaging and full CI/browser/acceptance evidence; it does not accept external human/Linux/hardware gates.
