### Spec Compliance

- ❌ Issues found: concurrent reports of the same committed world prefix can reject during evidence publication. This is an Important report-concurrency defect in the newly deferred materialization path; see I1.
- The remaining inspected B06 scope is consistent with the brief: one shared native world; Source-controlled lifecycle/custody; independently evaluated correlated observations; strict dock/receipt windows; serialized Source capture with deferred full-history reconstruction; bounded hot history; versioned world-only navigation; native registered disturbances; honest unknown/lost outcomes; immutable evidence references; and the final Source/Lab runtime pin.
- ⚠️ Cannot verify later-task performance/browser acceptance, B10 final qualification, Linux/native-host behavior, hardware/calibration or human acceptance from this review. Those remain explicitly deferred. The retained nominal evidence measures about 0.59–0.61 simulated seconds per end-to-end wall second, not 1x. Broader turn-offset robustness is not established by three nominal seeds. All qualification claims remain `accepted:false` and `not_calibrated`.

### Strengths

- The action boundary captures report state and immutable evidence references before releasing the Source queue; expensive history materialization then proceeds outside it (`packages/lab-runtime/src/v2/scenario-runner.ts:531`, `packages/lab-runtime/src/v2/scenarios/coffee.ts:299`). This is the correct separation for preserving action progress without mixing report horizons; I1 concerns publication concurrency after capture.
- Full world traces reconstruct every committed observation, distinguish active-program tracking statistics from all-world coverage, and separately expose prefix/publication completeness (`packages/lab-runtime/src/v2/simulation3d/world-arm-report.ts:17`). A failed or unavailable archive cannot silently become a complete trace. The world sweep explicitly validates admitted context and evaluates native contacts separately from geometric checks (`packages/lab-runtime/src/v2/simulation3d/world-sweep.ts:21`).
- The handoff policy uses consecutive fresh observed windows rather than a commanded pose alone (`packages/lab-runtime/src/v2/simulation3d/handoff-policy.ts:17`). The fault evidence preserves the distinction between last Source custody and unknown/lost physical custody: worker loss and lost ACK retain committed tick 1700 and sent/unacknowledged tick 1701; the fall records physical loss rather than manufacturing a successful delivery (`.superpowers/sdd/02-r2b-cell-and-web/evidence-B06/native-freeze04-faults.log:61`).
- Native evidence and final packaging identity are kept separate and reconcilable. The three nominal and five fault assertions passed on freeze04; the final package records all 73 frozen inputs unchanged, while literal embedded commit replacement explains the runtime-byte difference (`.superpowers/sdd/02-r2b-cell-and-web/evidence-B06/final-integration-summary.json:28`, `packaging-ruling54-runtime-equivalence.json:2`). The final Lab check identifies Source `c49d5bf`, the expected schema hash and protocols 1/2 (`lab-check-source-committed.log:5`, in the same evidence directory).
- The manifest-bound change is narrow and symmetric: Source rejects oversized serialized output before emission; Lab rejects input above 256 KiB before installation mutation. Boundary tests cover above the former 64 KiB limit, the exact cap, and cap+1. The retained logs report 4 Source checks passed with the optional clean-worktree check not_run, and 7 Lab checks passed (`source-manifest-bound-green.log:4`, `lab-manifest-bound-green.log:5`, in the same evidence directory).

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

**I1 — Simultaneous reports at the same horizon race on the same temporary evidence file.**

- **New call sites:** `packages/lab-runtime/src/v2/beverage/arm-plant-report.ts:61`–64, particularly the existence-check followed by `writeDurable` at line 63; `packages/lab-runtime/src/v2/scenarios/coffee.ts:299`–302; `packages/lab-runtime/src/v2/scenario-runner.ts:531`–534.
- **Dependency:** `packages/lab-runtime/src/v2/navigation2d/evidence.ts:72`–75 uses the fixed temporary path `.${name}.tmp`, opens it with `w`, then renames it. That helper is unchanged, but B06 introduces concurrent callers for identical content-addressed destinations by releasing the report capture queue before materialization.
- **Trigger:** two first report requests capture the same H and produce identical trace bytes. Both can observe the final hash-named file as absent and enter `writeDurable` for that same name. Both open/write the same temporary inode. After the first rename succeeds, the second rename rejects with `ENOENT`. This also applies to the props file if the trace already exists. Different hashes/destination names do not share the temporary path.
- **Impact:** the failure propagates through `buildArmReport`, the captured materializer and `ScenarioRunner.report()`, rejecting an otherwise valid whole report request. This is not a demonstrated Source transaction, custody or final-evidence corruption: the isolated identical-content probe retained the correct final hash. It is a user-visible reporting failure under a supported asynchronous API and should be fixed before approval.
- **Focused verification:** after the initial diff review, one isolated nonnative probe executed the actual unchanged helper body extracted from `evidence.ts`. It used a fresh `/tmp` directory, identical bytes, confirmed both destination reads initially returned ENOENT, and coordinated both writers immediately before rename to exercise the concrete interleaving. Result: one fulfilled, one rejected with `{code:"ENOENT",syscall:"rename"}`; both final hash reads matched the expected digest. The control with distinct destination names produced two fulfilled results. Temporary files were removed. This was a helper-level probe plus inspection of the uncaught call chain, not a native/public-run campaign.
- **Fix:** make content-addressed publication safe for concurrent writers, for example with unique temporary files and atomic publication plus hash verification, or deduplicate/serialize publication per destination outside the Source action queue. Preserve the requirement that full materialization does not block Source actions. Add a deterministic regression with two same-H report materializations, verifying both promises resolve and both trace/props references remain readable with matching hashes; retain the existing different-H reference stability check.

#### Minor (Nice to Have)

None found that warrants a change request. Retained successful final validation logs inspected for warnings/errors did not reveal a new unexplained failure; historical red/diagnostic runs are intentionally retained and are not treated as current failures.

### Validation and scope

- Reviewed Source `9f68476f784cfe58bf7eaa66969656b9e3d266f9..c49d5bfea6087811ace89874c092d0d62001eead` and Lab `da6f6084c9df9d523f28eefde90355fd7c7c58d0..b11768f581cb310993123e8e3d2da3390d1fad82` from their supplied full diff packages. Both diffs were read once in bounded contiguous passes, without silently omitting truncated hunks. Checklist below covers every diff file.
- Read the dispatch brief and implementer report. Inspected the final integration/runtime-equivalence evidence, selected campaign result fields, and retained final/focused validation logs. The campaign summary's large file inventories were not independently rehashed; no claim is made that all retained raw artifacts were independently replayed or revalidated.
- Retained results inspected: 220/220 focused checks before the final controller ramp; 42/42 final affected controller checks; 116 Python checks; 5 normal native readiness/report/reopen checks; 3 nominal seeds and 5 fault assertions. Evidence: `evidence-B06/focused-pre-freeze04.log:47`, `world-v4-final-controller-regression.log:21`, `python-final-v4.log:3`, `native-readiness-final-v4.log:11`, `native-freeze04-nominal.log:202`, `native-freeze04-faults.log:61`, all beneath this report's directory. Existing passing suites were not rerun.
- Exactly one named dependency risk prompted additional source inspection: whether concurrent immutable-report writers can safely publish an identical destination. Inspected the unchanged `writeDurable` implementation and, with parent authorization, only the relevant new call sites/materializer chain for propagation and exact citations. No general changed-file recrawl or second implementation review was performed.
- No product files, retained run/report artifacts, native processes, cloud resources, commits or pins were modified. Only this ignored review report was written; the authorized isolated probe used and removed a new temporary directory.

### Reviewed-file checklist

Source:

- [x] `docs/research/2026-11-mujoco-cell-source.md`
- [x] `packages/cell-adapters/src/mock-arm.ts`
- [x] `packages/contracts/generated/lab-v2.ts`
- [x] `packages/contracts/generated/navigation2d.ts`
- [x] `packages/contracts/schemas/lab-transfer-evidence.schema.json`
- [x] `packages/contracts/schemas/lab-world-scene-v1.schema.json`
- [x] `packages/contracts/schemas/sim3d-worker-v1.schema.json`
- [x] `packages/contracts/schemas/twin-sample-v2.schema.json`
- [x] `packages/contracts/schemas/world-evidence-v1.schema.json`
- [x] `packages/lab-runtime/src/v2/beverage/arm-plant-report.ts`
- [x] `packages/lab-runtime/src/v2/beverage/coffee-ports.ts`
- [x] `packages/lab-runtime/src/v2/beverage/cup-ledger.ts`
- [x] `packages/lab-runtime/src/v2/capabilities.ts`
- [x] `packages/lab-runtime/src/v2/navigation2d/contracts.ts`
- [x] `packages/lab-runtime/src/v2/navigation2d/controller.ts`
- [x] `packages/lab-runtime/src/v2/navigation2d/readiness.ts`
- [x] `packages/lab-runtime/src/v2/report.ts`
- [x] `packages/lab-runtime/src/v2/scenario-matrix.ts`
- [x] `packages/lab-runtime/src/v2/scenario-registry.ts`
- [x] `packages/lab-runtime/src/v2/scenario-runner.ts`
- [x] `packages/lab-runtime/src/v2/scenarios/coffee.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/handoff-policy.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/mujoco.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-arm-report.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-control.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-disturbance.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-evidence.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-history.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-ports.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-readiness.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-scene.ts`
- [x] `packages/lab-runtime/src/v2/simulation3d/world-sweep.ts`
- [x] `packages/lab-runtime/src/v2/twin-projection.ts`
- [x] `robotics/simulation-mujoco/campaigns/mj-cell-bv01-v1.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/NOTICE`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/README.md`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/arm-component.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/arm-physics.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/empty-load.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/handoff-policy.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/lab-world-scene.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/manifest.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/mobile-drive.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/mobile-physical.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/programs.json`
- [x] `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json`
- [x] `robotics/simulation-mujoco/mujoco_worker/session.py`
- [x] `robotics/simulation-mujoco/mujoco_worker/world_engine.py`
- [x] `robotics/simulation-mujoco/tests/test_world.py`
- [x] `scripts/export-lab-runtime.mjs`
- [x] `scripts/lab-runtime-audit.mjs`
- [x] `tests/integration/lab-runtime-artifact.test.ts`
- [x] `tests/integration/mujoco-cell-bv01.test.ts`
- [x] `tests/integration/mujoco-cell-faults.test.ts`
- [x] `tests/integration/mujoco-cell-readiness.test.ts`
- [x] `tests/integration/mujoco-world-rig.test.ts`
- [x] `tests/security/mujoco-world-authority.test.ts`
- [x] `tests/support/mujoco-cell.ts`
- [x] `tests/unit/arm-plant-report.test.ts`
- [x] `tests/unit/world-bootstrap.test.ts`
- [x] `tests/unit/world-cell-scenario.test.ts`
- [x] `tests/unit/world-control.test.ts`
- [x] `tests/unit/world-evidence.test.ts`
- [x] `tests/unit/world-handoff-policy.test.ts`
- [x] `tests/unit/world-history.test.ts`
- [x] `tests/unit/world-navigation-preflight.test.ts`
- [x] `tests/unit/world-report-files.test.ts`
- [x] `tests/unit/world-stop-tick.test.ts`
- [x] `tests/unit/world-sweep.test.ts`
- [x] `tests/unit/world-twin-projection.test.ts`

Lab:

- [x] `config/source-runtime.lock.json`
- [x] `scripts/runtime-artifact.mjs`
- [x] `src/shared/engineering-schemas/twin-sample-v2.schema.json`
- [x] `src/shared/engineering.ts`
- [x] `src/shared/navigation2d.ts`
- [x] `tests/integration/runtime-artifact.test.ts`

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The inspected behavior and retained evidence substantially satisfy B06, with the documented later-task and qualification limits preserved. I1 is a concrete new concurrent-report publication failure and needs a focused fix and regression before approval; the evidence does not call for another native campaign solely to resolve this filesystem race.
