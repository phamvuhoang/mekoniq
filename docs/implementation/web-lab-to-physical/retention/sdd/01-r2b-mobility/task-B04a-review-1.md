# B04a review 1

**Spec compliance: Compliant within the B04a task scope.**
**Task quality: Approved, with two minor findings.**

Reviewed source `f0fb70f9733bc6eb103fe8e8972cd45926af918d..681b8adb8ed473f7195062773b23fabc3b922cd5` and Lab `989632ae5b4b6f1cf8feebf57f0cb9301918d231..cbeb5817cd65d53182aa080df3e566ad656d4945`. Source paths below are relative to the authorized source worktree; `Lab:` means its paired authorized Lab worktree.

## Spec compliance

- The requested campaign registry, CLI and shared verifier are present. The original eighteen cases remain, with the required actual cup-fall supplement. Verification reads the artifact inventory, admitted closure, raw navigation/physics and copied SQLite journal rather than `summary.json`; expected faults receive narrowly checked terminal-gap treatment. Evidence: `robotics/simulation-mujoco/campaigns/payload-v1.json:1`, `scripts/lab-mujoco.mjs:11`, `packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts:125`.
- Browser admission is an optional closed seven-value selector; other engineering profiles reject it. Compiler selection retains canonical mechanics, current project provenance, applied speed caps and exact registered physics bytes. Baseline engine version, substeps, controller and stop policy remain unchanged. Evidence: `packages/contracts/schemas/engineering-project.schema.json:32`, `packages/lab-runtime/src/engineering/contracts.ts:99`, `packages/lab-runtime/src/engineering/mujoco-compiler.ts:23`, `robotics/simulation-mujoco/fixtures/serve-payload-v1/registered-physics.json:1`.
- Friction variants have separate numerical/document/file identities and probe IDs. The low coefficient's masking by contact mixing is explicitly disclosed; no dynamics difference or causal conclusion is required merely from changing that input. Actual probe artifacts exist for both variants. Evidence: `robotics/simulation-mujoco/fixtures/serve-payload-v1/drive-contact-low-v1.json:94`, `robotics/simulation-mujoco/fixtures/serve-payload-v1/drive-contact-high-v1.json:94`, `docs/research/2026-11-mujoco-payload-experiments.md:19`.
- The launch-only perturbation integrates force in the existing world, captures the support frame before advancement, clears force in `finally`, and writes an exclusive receipt. Unsupported arm requests are rejected before model creation; no shared arbitrary-force wire API was added. Evidence: `robotics/simulation-mujoco/mujoco_worker/mobile_engine.py:124`, `robotics/simulation-mujoco/mujoco_worker/session.py:127`, `robotics/simulation-mujoco/mujoco_worker/session.py:294`, `packages/lab-runtime/src/v2/navigation2d/worker-client.ts:51`.
- The registered braking tail distinguishes business cancellation from physical completion, binds its policy into manifest/configuration, and prevents interrupted-tail recovery from resuming a world. The real complete/restart/lost-ACK tests exercise one-tick consumers and zero-target tail observations. Evidence: `packages/lab-runtime/src/v2/navigation2d/runner.ts:129`, `packages/lab-runtime/src/v2/navigation2d/runner.ts:340`, `packages/lab-runtime/src/v2/navigation2d/runner.ts:601`, `tests/integration/mujoco-payload-campaign.test.ts:105`.
- Payload projection uses the committed snapshot and admitted geometry/profile identity, publishes map-frame `physics_sim` observations, gives empty loads no payload, and does not invent custody or measured travel distance. Evidence: `packages/lab-runtime/src/v2/navigation2d/runner.ts:254`, `packages/lab-runtime/src/v2/navigation2d/runner.ts:646`, `packages/contracts/generated/lab-v2.ts:1186`, `packages/lab-runtime/src/v2/report.ts:17`.
- Lab changes are limited to the clean source pin and generated contracts; UI/import work remains B04b. The pin names final source `681b8ad`, matching retained export/check logs. Evidence: `Lab:config/source-runtime.lock.json:7`, `Lab:src/shared/engineering.ts:1`, `Lab:src/shared/navigation2d.ts:1`, `.superpowers/sdd/01-r2b-mobility/evidence-B04a/lab-check-source-final.log:5`.

## Strengths

- The independent reader preserves archive immutability by opening SQLite only in owned scratch space, rechecks copied journal hashes, and retains strict unlisted-artifact rejection. The tests inventory successful and failed reads. Evidence: `packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts:163`, `tests/integration/mujoco-payload-campaign.test.ts:64`.
- Fault validation combines raw engine evidence, committed horizon, source unknown events, explicit injected ACK/receipt identity, retry refusal and no false served checks. It does not convert an expected fault into a successful mission. Evidence: `packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts:178`.
- Real-engine tests cover the behavior most likely to be hidden by protocol doubles: falling payload pose/force, committed telemetry, cancellation-tail completion and loss/restart boundaries. Evidence: `tests/integration/mujoco-payload-campaign.test.ts:36`, `robotics/simulation-mujoco/tests/test_mobile.py:500`, `.superpowers/sdd/01-r2b-mobility/evidence-B04a/payload-integration-final.log:9`.

## Findings

### Critical

None.

### Important

None.

### Minor

- **B04a-R1-01 — Dense new campaign verifier makes future changes harder to audit.** `packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts:125`: one function combines input closure validation, journal extraction, coverage interpretation, three fault-specific oracles, nominal metrics and repeat comparison, frequently with several checks on a single line. Current behavior is supported by the evidence, so this is not blocking. Extract cohesive helpers for journal reading, registered input validation and each case assertion, retaining one public shared verifier and the current mutation tests.
- **B04a-R1-02 — Successful integration tests emit a large diagnostic receipt.** `tests/integration/mujoco-payload-campaign.test.ts:89`; retained output `.superpowers/sdd/01-r2b-mobility/evidence-B04a/payload-integration-final.log:4`: unconditional `PAYLOAD_FALL` output dumps run IDs, full poses and force receipt even on success. Keep this in retained artifact evidence or enable it only on failure/explicit diagnostics so routine test output stays clean. This is diagnostic noise, not a failing assertion or physics warning.

## Verification and named outside-diff checks

The supplied diff packages were read once in bounded, non-overlapping segments. No Git commands, suites, campaigns, probes or native workers were rerun. No product/index/HEAD changes or child agents were made.

1. **Risk: changed completion semantics might close the world before the tail is durably represented.** One focused call-site search in `navigation2d/runner.ts` inspected `finished()`, completion-tail, flush and persistence callers outside the supplied hunks. The step/action path calls the completion predicate at tick boundaries and persists after final flushing; reports serialize on the action queue (`runner.ts:561`, `runner.ts:579`, `runner.ts:587`, `runner.ts:649`). This was the sole additional changed-code inspection, justified by the cross-cutting completion contract; no full changed file was reread.
2. **Risk: reported final checks might refer to a superseded campaign or omit failures.** Read retained final verify/integration logs, final identity record, contracts/typecheck/lint logs, Lab check/typecheck logs, Python 56-pass log, the 105-test regression log and later 17-test lifecycle/golden log. Final verify is 19/19 with no issues and all three faults detected/no false served. Final integration is 10/10, no skips. Earlier regression timing is not represented as a final rerun.
3. **Risk: verification could mutate the retained SQLite archive.** Compared the retained before/after inventory files byte-for-byte: identical, SHA256 `8542ed9eedb5b2f7411bf335cf1c547270f005950bc8c7fa4b129153957a3bbb`. Checked the implementation's scratch-copy lifecycle and integration inventory assertions. Did not reopen the retained original journal.
4. **Risk: final fault/tail evidence might be mislabeled or use a different source commit.** Read original final case/checkpoint/trace documents for worker-kill, ACK loss, cup-fall and both braking cases. Each names final source `681b8ad` and `accepted:false`. Kill/loss retain committed tick500 with501 requests, one spawn and retry refusal; fall ends520 with520 requests and retry refusal; braking windows are514→519 and546→551.
5. **Risk: variant probe claims might reference baseline bytes or summary-only output.** Read the retained independent audit, hashed each final probe summary, counted36 raw files per variant, and checked one gzip raw identity/readback and its file hash per variant. Both identify engine3.17.0 and the correct distinct profile file hashes. Summary hashes match the report; the retained audit reports18,000 ticks per variant, finite observations and repeat differences below1e-6. This was artifact inspection, not probe execution or a fresh full72-run recomputation.

## Cannot verify / scope limits

- Full unchanged IR-SIM/Webots regressions, full CI/build, Linux/native hardware, deployment and human qualification acceptance are not established by this review. The diff leaves default request arguments and baseline numerical/profile files intact; available focused regression evidence supports the shared seams. Automatic evidence remains `accepted:false` and `not_calibrated`.
- The B03 interval-metric implementation is unchanged; its `(0,lastTick]` convention was not re-derived from the broader codebase. The retained metrics regression is supporting evidence, not a new independent metric audit.
- B04b browser rendering/import/schema acceptance and B08 comparison remain separate tasks. `PAYLOAD_SPEED_DIFFERENCES` is descriptive and has no comparator here; the report explicitly identifies nested reference expansion still required for B08. No implemented exhaustive counterfactual comparison is credited.
- No full revalidation of all retained raw probe samples was performed; the independent recorded audit and the targeted raw artifact inspection above are the reviewed evidence. No external authenticity signature is implied by internally consistent hashes.

## Assessment

**Task quality: Approved.** The implementation meets this task's bounded experiment, real-engine evidence, fault lifecycle and data-handoff requirements. The remaining findings concern readability and success-log noise; neither undermines the verified B04a behavior.
