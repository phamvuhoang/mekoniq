# R4 closeout fixes Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent reader task and its review; maintain this plan and LEDGER-r4-closeout.md across continuations. Do not repeat completed tasks.

**Goal:** Resolve the remaining R4 technical defects and assemble a truthful, reviewable final qualification; keep deployment and human acceptance explicit.

**Architecture:** WEB09 validates retained workload and the entire playback trajectory. REC06 uses a versioned pick-program target distinct from physical gripper limits, with a measured experiment registered only after a robust recoverable miss exists. Qualification consumes immutable same-tuple artifacts and never turns an absent experiment into a pass.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest, Python/MuJoCo, Playwright, Docker/native Linux CI.

**Spec:** ../05-contracts-and-evidence.md; ../03-r4-perception-recovery-spec.md; ../REVIEW-web09-7bdbc-and-rec06-decisions-2026-11-23.md. User has instructed implementation of all remaining work after reviewing the proposed design.

## Global Constraints

- Work in the existing `r4/virtual-commissioning` branches. Baseline Source 7bdbc1a5, Lab d76909c. Keep unrelated work and historical evidence intact.
- Test changed behavior first; retain red/green proof. A skipped test is not_run.
- All automated records remain accepted:false. No manual invention of process boundaries, outcome, trace, contact, or qualification results.
- WEB09 target stays p95 <=33 ms, at least 60 s active playback, render gaps <=500 ms; explicit seeks remain bounded.
- REC06 keeps physical model limits, cup/stand/friction, full-cell work region +/-20 mm and recovery safety guards. Same revised pick program on initial attempt and retry. No gripHold or pose writes as qualification evidence.
- Native Linux evidence cannot be replaced by Mac emulation. Cloud deployment and human signature require their concrete release/acceptance step.

### Task 1: Complete WEB09 reader validation

**Files:** source/scripts/r4-web09-readback.mjs; source/tests/unit/r4-web09-readback.test.ts; source/docs/operations/r4-qualification.md.
**Consumes:** schema-3 capture and real bench/replay reports. **Produces:** unchanged verifyWeb09Record API, stricter semantics.

- [x] Add failing tests for empty/wrong/duplicate axis sets, missing counters, contradictory mock engine claims, and 20 s cursor freeze followed by catch-up in each pass.
- [x] Update the positive test bench report with genuine engine/backend fields. Compare against retained real bench report in evidence-archive/r4-web09-7bdbc-review-2026-11-23/suites/e2e-perf/screens/web09/bench-report.json.
- [x] Require exactly the wheel workload axes, valid integer counts, valid samples, proper measured/initial sample accounting, and consistent MuJoCo engine/backend identity.
- [x] Validate the per-pass cursor trajectory at 1x, not only endpoints. Use the existing 500 ms gap bound for sustained cursor stalls and a bounded phase-error envelope independent of total run length; preserve normal repeated ticks at render 60 Hz/world 50 Hz. Active duration must be supported by both wall and simulated progress. Do not widen timing limits to accept malformed data.
- [x] Run reader unit tests and the archived real default-reader positive/negative probes; lint/typecheck changed code; retain output and commit Source only. Root will repin Lab after dependent Source work.
- [x] Independent scoped review resolves F01/F02 before marking task complete. Approved at a383360b after completed-state and tick/chunk consistency follow-up; 98 focused tests, two genuine captures, 68 negative probes.

### Task 2: Measure a separately defined pick opening

**Files to inspect:** source/packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts; source/packages/cell-adapters/src/mock-arm.ts; source/packages/lab-runtime/src/v2/perception/pick-rig.ts; source/robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/programs.json; fixture/schema and tests selected from their existing validators.
**Consumes:** existing physical openingMaxM and identical initial/retry pick behavior. **Produces:** bounded measurement matrix, complete configuration/patch identity, trace and run reports in evidence-archive/r4-closeout-2026-11-23.

- [x] Inspect program stages and gripper command conversion, declare a finite opening/offset matrix before running. Distinguish pick approach opening from release/recovery opening and physical max.
- [x] Add tests that legacy programs retain commands and a revised pick program uses its target consistently at first pick/retry while release/recovery remain correct.
- [x] Implement a versioned optional program target; reject invalid/out-of-range values and bind it through program/fixture identity, not an unrestricted request parameter. Task3A approved at e7fd13fe.
- [x] Measure nominal actual aperture and capture region first. Record all outcomes, contacts, support/held facts and applied force/torque; retain executable harness, exact inputs and checksums.
- [x] Test a finite nudge matrix only for nominally valid openings. Selected20mm/capture70/secure0 with4.025N base pulse50substeps passes three diagnostic fullcells; production qualification remains Task3.

### Task 3: Register and qualify the measured REC06 experiment

**Files:** source world-disturbance registry and worker registry; associated world/run schemas, gateway advertised experiments, Lab preset; REC06 recording/readback and engine tests.
**Consumes:** a measured stable operating region from Task 2. **Produces:** registered experiment revision and independently verified full-cell REC06 evidence.

- [x] Bind the measured program/experiment revisions and exact force/trigger to receipts; preserve v1 and default legacy behavior. Task3B approved at2f261fd4, including durable pre-send checkpoints/private intents; final full campaign remains Task3C.
- [x] Add test-first admission/worker/engine cases: three full-cell seeds, known first miss, facts present, bounded recovery, retry lifted, served 2; fixed_program refusal and existing five faults unchanged. Task3C records11/11 actual cases at eceb7681.
- [x] Add recorder/reader with missing/corrupt/incorrect identity/outcome negative tests. Replace REC06 hardcoded notRun only when that reader exists. Closed rec-campaign-engine remains separate from REC01–05; CLI is mj-cell-recovery-v2 and R4 input is --recovery-campaign.
- [x] Review implementation and measured evidence before proceeding to final qualification. Task3C approved at3e51dab7 after one fix round;167focused tests, full11/11 readback and immutable public seed42 proof pass. Final-tuple recording remains Task5.

### Task 4: Produce WEB10 and remaining artifact readers

**Files:** lab/public/replays/belief-recovery; catalog; tests/e2e/replay-offline.spec.ts; relevant source replay readers; optional calibration self-test recorder.

- [x] Export a real full-cell REC06 seed-42 replay and add it to catalog with not_calibrated/accepted:false provenance. Task4B approved at Source44f38603/Lab695465c0; original manifest d7c0671b and historical producer eceb7681 preserved.
- [x] Verify offline views show attempts and recovery, assets match hashes, and no runtime mutation is available. Real row-click reaches1620 with zero runtime requests; plain saved-report ghost and supported-backend selection regressions are fixed. Fresh final-tuple suite remains Task5.
- [x] Complete optional CAL artifact recorder/readback; approved at812d94bf with real synthetic self-test. No measured calibration is claimed; final-tuple recording remains.

### Task 4C: Clear the deferred evidence/display defects

- [x] Correct the study endpoint for fixed_program and belief to the same first-cup grasp outcome; derive it from retained program/plant evidence, not eventual serving. Approved at79d233a8. Audit found four prior fixed drops occurred during place after successful lift; old comparative claim is superseded.
- [x] Bind the requested rig birth offset to retained physical birth evidence rather than trusting only rig-run.json. Approved native pre-step witness, with default wirebytes preserved.
- [ ] Re-record the full92runs at the final tuple; preserve old archive bytes.
- [x] Derive estimated z from declared support/cup geometry, never measured truth z; retain truth only for estimator x/y and scoring. Task4C2 approved atb10b1126.
- [x] Refuse ghost display from incomplete/corrupt belief evidence and enforce the actual profile's maxAgeTicks at cursor, including dropouts; align WEB09 reader. Task4B also fixes portable hot/cold policy lookup and preserves admission through saved-report projection; covered live prefixes remain available.
- [x] Verify actual belief identity and recompute attempt x/y error from native props at the decision tick; reject missing/modified belief and scalar score forgeries reproduced on native evidence. Task4C3 Source approved at6c088193, including native descent binding and null study score before verified commitment; Lab consumer remains Task4B.
- [x] Keep a known exhausted no-cup grip distinct from an unknown command while retaining the latch and existing unknown/drop safety behavior. NativeREC02+independent proof approved atb10b1126; recovery current-facts guard also covers every continuation through retry commit.
- [x] Focused tests and independent review; no changed acceptance thresholds or invented measured calibration. Task4B fix round1 approved with all5findings addressed,40Source/40Lab focused tests,870Lab tests and7clean production-browser cases; final broad review remains before freeze.

### Task 5: Freeze tuple and record the final chain

**Files:** source/Lab lock and generated schemas; existing CI/native/container/qualification scripts; new immutable evidence directory.

- [ ] Address the final whole-branch review's6Important/5Minor findings in one coordinated fix pass and scoped re-review: stale-belief recovery guard, saved study envelope/summary integrity, frozen suite coverage, actual owned SourceCI execution, cancellation/cleanup/restoration, strict local closeout profile, plus the deferred reader/helper/color/docs issues. Original draft has never been executed.
- [x] Implement/review the CLD03 recorder and native-tested-image retention before freezing. Task5A approved at d27533d9 after one fix round; local ARM64 production-container diagnostic passed,158focused fix tests pass. Native image upload/load and actualCloudsmoke remain below; candidate double-read minor is on the final-review list.
- [ ] Complete focused/required CI checks, commit Source; export/import runtime, sync contracts and commit Lab pin. Review both repos clean.
- [ ] Run CLD01 and native CLD02 on the exact Source commit using the registered workflow/host; retain native host/image/test roster proof. Push only the qualification branch if needed, never main as a shortcut.
- [ ] Record all required prior regression records and R4 candidate on that frozen tuple; read back every gate with the actual guard. Preserve historic records per repository policy.
- [ ] Prepare the exact candidate/image/service/rollback package for CLD03. Deploy only at the concrete release step after authorization; never sign acceptance on behalf of a human.
- [ ] Update handover/status/ledger with final commits, tests, measured gate statuses and any external step still required. Do not call R4 complete while a closing gate is untested.
