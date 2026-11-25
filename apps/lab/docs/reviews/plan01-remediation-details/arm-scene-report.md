# ARM03 project scene integration

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

Completed 2026-11-05. Scope is the Plan01 TypeScript mock, not full R-SIM or physical validation. No files staged or committed.

## Behavior

- Added optional, versioned `LabProjectV2.armCollisionProfile`: explicit SI map-from-arm-base position and normalized xyzw quaternion, pinned PUMA model identity/revision, illustrative provenance/reference, fixture height and robot height. Missing profiles preserve legacy execution but report only self/injected-obstacle scope. Invalid units, frame normalization, bounds or model revision are rejected.
- Project `world.obstacles` are rectangular prisms from map z=0 to the declared fixture height. Each prism is transformed through the full inverse base pose; all eight corners form a conservative arm-frame AABB. This supports arbitrary base rotation, not only yaw.
- AMR XY bounds come from the actual compiled asset radius; vertical extent comes from the declared illustrative robot height. Every advance reads current modeled poses. Previous/current XY envelopes conservatively cover the AMR's modeled linear motion during that tick. Missing geometry or poses cannot yield scene clearance and block an attempted arm program.
- `CoffeeDriver` supplies scene context every advance. The checker runs on active arm motion and stationary declared scenes, including a held cup waiting between programs. Project scene refresh preserves separately injected arm-frame obstacles. A detected collision latches the arm and retains modeled custody.
- The manifest contains the exact profile, profile hash, full world, world hash, compiled robot radii and combined scene hash. Source support and the shipped Lab coffee fixture declare base `[2.794821, 0.941325, 1.2]`, fixture height 1 m and robot height 0.7 m. The shipped counter fixture and source BV01 both complete nominal transfers.
- Collision evidence records joint interval endpoints, attachment identity, tick range, checker/model/geometry/tolerance/result and content-hashed geometry snapshots. Identical stationary checks share an interval. The trace is bounded to 4096 intervals; `droppedIntervals` and `coverage.armCollisionTraceComplete` disclose incompleteness. The first blocked sweep retains an independent immutable world/scene snapshot even after scene clearing or trace exhaustion.
- Lab mirrors the profile contract, validates frames, and displays scene scope/revision plus geometry checker revision as illustrative model evidence. Earlier replay cursors do not display future collision evidence. Profile edits now invalidate the saved evidence profile scope while leaving the historical report immutable.

## Red to green

Before scene wiring, the new project fixture and AMR obstruction tests both reached their assertions with no `ARM_COLLISION`; scene coverage/evidence was absent. Six tests failed after the new profile became schema-valid. After integration those cases stop arm motion and retain the cup at the cell.

A separate regression initially failed because an AMR entering a stationary held-cup arm was never checked between programs. It now latches `ARM_COLLISION`. Another initially failed because no immutable failure record survived a changed scene; its final assertion preserves the original geometry pair, attachment, tick and snapshot. The QA09 profile test initially reported fresh evidence after profile revision/frame/height changes; it now reports only the profile scope stale.

## Final validation

Node 24.22.2, with that version first on `PATH`.

- Source: `pnpm exec vitest run tests/integration/lab-v2-arm-scene.test.ts tests/integration/lab-v2-arm-safety-model.test.ts tests/integration/lab-v2-arm-faults.test.ts tests/integration/lab-v2-model.test.ts` — **46 passed**, 4 files, 50.11 s.
- Lab: `pnpm exec vitest run tests/unit/arm-scene-scope.test.ts tests/unit/report-evidence.test.ts tests/integration/project-v2-migration.test.ts tests/unit/workspace-replay-freshness.test.ts` — **35 passed**, 4 files.
- Source and Lab `pnpm typecheck` — passed.
- Source `pnpm contracts:check` — passed after schema generation.
- `git diff --check` in both repositories — passed.

The 17 new source scene tests cover actual fixture/AMR obstruction, cell custody, nominal source and shipped Lab BV01, legacy scope, unknown geometry, injected-obstacle retention, full rotated-frame corner bounds, dynamic robot envelopes, a cup-only fixture obstruction with retained attachment, stationary arm obstruction, immutable failure evidence, bounded/truncated evidence, and invalid declarations.

## Explicit limits

The conservative AABBs may reject motions that detailed geometry would permit. The AMR height and fixture extrusion are declared illustrative model values; they do not claim to match measured mesh geometry. The arm remains an illustrative capsule model with its existing reach-based adaptive sweep bound and conservative uncertain-interval rejection. No torque, grip force, dynamics, sensor validation, calibrated alignment, physical stop performance or complete R-SIM claim is made. A trace with dropped intervals is explicitly incomplete.

## Coordination

`fix_lab` owns the concurrent `controls.ts` mirror and replay filtering changes. Its current reclaim edits are outside this arm scene work. Root owns backend descriptor version alignment, broad regression, runtime packaging and pinning. This task is frozen after this report for independent review.

## AR02 follow-up: inactive project AMRs

Independent review reproduced a BV01 project with two known AMRs and two parking points failing with `ROBOT_GEOMETRY_UNKNOWN`: the scenario activates one AMR, while the scene correctly declares both. The missing boundary was the second robot's modeled pose.

The scene declaration now distinguishes `dynamic` and `static_parked` robots. It extends the same sorted project-entity/parking-point binding used by scenario role resolution to the remaining AMRs and persists each parking ID and static pose in the hashed manifest. Materialization includes these stationary obstacles every tick, and their poses and geometry remain in collision traces. An unused AMR without a parking binding reports `ROBOT_POSE_UNKNOWN`; it is never silently removed from collision coverage. These are explicit illustrative parking poses, not observations of physical robots.

All three new regressions failed before the fix: nominal two-AMR BV01 stopped instead of completing; a parked robot under the arm reported unavailable geometry instead of its collision pair; and an unbound parked robot was misclassified as unknown geometry. They now pass, including retained cell custody for the collision and absence of clearance when parking is unbound.

Final follow-up validation: `pnpm exec vitest run tests/integration/lab-v2-arm-inactive-scene.test.ts tests/integration/lab-v2-arm-scene.test.ts` — **20 passed**, 2 files, 80.32 s while the root integration suite also ran. Source `pnpm typecheck` and `git diff --check` passed. The follow-up changes only scene declaration/materialization, its runtime role-ID input, and the new regression file. No Lab replay or fixture-test edits were made. Frozen again for review.

## Full-preflight regression follow-up

The root preflight recorded three failures before the AR02 fix was loaded: FD02-cups had `TRANSFER_UNKNOWN` at tick 1441 before either load, its cancellation case therefore could not reach `returning`, and the manifest test still required exactly one profile. Reproduction on the AR02-fixed tree passed all three mixed-scenario tests without changing their business assertions. The fixture's unused AMR and second parking point were the same missing-pose boundary already fixed by AR02; no further production change was needed.

The stale manifest assertion now verifies the exact runtime and declared arm-scene profile entries, canonical profile/world/scene hashes, immutable manifest after caller input mutation, and changed profile/configuration hashes for a newly created run with edited profile inputs. The mixed test additionally verifies that scene checking remains enabled, the unused AMR is represented at its static parking pose, and no failure evidence is present before its successful loads. Cargo, handoff and cancellation custody assertions remain intact.

Latest source validation: the mixed, software-gaps, inactive-scene, arm-scene, arm-faults, arm-safety-model and model suites passed **60 tests across 7 files**, 122.94 s. Source `pnpm typecheck` and `git diff --check` passed. This follow-up changes tests and this report only. Frozen for the root's final packaging and full regression run.
