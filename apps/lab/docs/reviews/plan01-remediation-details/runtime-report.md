# Runtime remediation work log

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

## Review R06, R07, R11, R12

Implemented localization loss as a latched condition for idle, load/handoff wait, and moving AMRs. New dispatch/reachability rejects stale localization, scripted work suspends, pending confirmations remain blocked, and reconciliation is audit-only. Stale AMRs cannot provide docking evidence or receive a new coffee transfer. There is no fabricated localization recovery.

Telemetry now uses a checkpointed run publication sequence independent of simulation time; same-tick actions emit fresh state, snapshot cursors identify the sample, reconnect gaps use fromSeq/toSeq, and clean reopen does not regress sequence within the provider boot. Lab agent is updating consumers to use simTimeNs for replay/freshness placement.

Plant minSeparationM measures only footprint distance between robot pairs, including stationary pairs, and remains null for one robot. Contact/world-clearance admission remains separate. Lab agent owns matching source/Lab KPI SINGLE_ROBOT availability.

Both SSE streams recheck their pairing authorization before writes and during timers, close when expired even without new samples or under backpressure, and remove intervals/listeners/stream registration on end.

Red evidence: 6/6 new runtime review tests failed against original code: idle loss completed; waiting load/handoff confirmations succeeded (handoff served=1); paused sample stayed valid; adapter reachability accepted stale pose; reported pair distance was ~0.0468 m wall clearance. Expiry regression separately failed with timeout instead of both streams ending. All now pass.

Node 24.22.2 validation:

`node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-runtime-review.test.ts tests/integration/lab-v2-stream.test.ts tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-recovery.test.ts tests/integration/lab-v2-report.test.ts tests/integration/lab-v2-residuals.test.ts`

49 pass, 1 skip (opt-in measurement), 6 files, 27.87 s. Typecheck found one fixture command type omission (fixed), plus concurrently edited lab-human-wait fixtures owned by Lab agent; final typecheck pending.

No commits/staging, operational services, hardware, acceptance edits, or artifact repin performed.

## Expanded software scope

In progress after review fixes: immutable manifest coverage, durable secure reclaim, reorder/delay fault, per-entity speed limit, bounded coffee pickup/interlock waits, mixed food/coffee mission and combined versioned campaign. Lab owns reset UI (fresh immutable run) and run-speed pacing. Coffee agent owns recipe constants, COFFEE_FAULTS and device/domain policies; runtime owns driver implementation below those declarations. Root owns ARM collision/stop and acceptance.

## Expanded scope implementation and integration contract

- **QA-02b immutable manifest:** every project entity asset is represented, including unresolved arm/cell assets; SHA-256 canonical JSON algorithm is named. Added designHash, adapterHash, effective configuration hash/revision, recipe id/revision/hash, AMR/process/arm model hashes, illustrative profile revision/hash and explicit not_calibrated/null calibration metadata. Arm hash covers kinematics, motion parameters, choreography, collision geometry, capsule-sweep engine and tolerance. Project and supplied scenario definitions are cloned at run creation; mutating a provider object cannot change a locked run.
- **UX-18 speed:** optional `project.entities[].speedLimitMps` must be positive and <=0.5 m/s. Mission admission receives the most conservative applicable selected limit; generated commands carry limits.speedLimitMps and the plant respects command, entity, and illustrative model bounds. Food, coffee, queued and parking missions use the same path. No runtime update mutates a locked run.
- **SYS03:** `reorder-observations` retains an actual accepted observation until the later actual result and delivers it out of order; `delay-observation` delays an actual observation by 2 s simulated time. Boot/sequence/event identity remains original. A reorder injected mid-goal delays the terminal observation rather than waiting indefinitely for an event that cannot occur. Source handles late events without serving twice or issuing another effect.
- **BV07 timeout:** COFFEE_POLICY revision1 fixes 30 s transient-interlock and 120 s pickup wait budgets (illustrative). A timeout records attention, holds the workload, and calls the real Coffee.CancelJob disposition, retaining poured/unknown cups and irreversible consumption. A blocked dock never becomes receiver evidence or cargo loaded. Restoring missing cups is narrowly allowed before any device command/dispense: `restoreCup {subjectId:jobId}` checks both source pending state and plant removed/empty/no-command state, emits bound cup observation and drains through source. UI sees `canRestoreCup`; an unsafe request fails before changing run state.
- **SYS02 reclaim:** create response returns `reclaimToken` once, outside run/report data. Only its SHA-256 hash is stored in an owner-only reclaim metadata file. `POST /runs/:id/reclaim {proof:token}` requires pairing, CSRF, matching source/schema and proof; wrong/missing runs remain indistinguishable. Existing AMR/cell execution becomes unknown/held, no effect is resent, and every snapshot/action response says `controlAccess:'view_reconcile'`. Gateway and persisted runtime deny motion/start/step/restore actions after reclaim. Completed evidence remains completed. No proof is exported in reports.
- **Explicit archival/cap:** `POST /runs/:id/archive {}` saves a revision-named report beside its durable journal/checkpoint and closes/removes the active run slot. Old owner reads then return404; proof reclaim works after re-pair/restart subject to active quota. Archived history is preserved, never erased by reset. Expired sessions likewise close active runs while retaining reclaim evidence. Lab resets save immutable evidence then archive the old run before creating a new run.
- **FD02-cups revision1:** food and one identified coffee allocation share one mission, with independent kitchen/cell load stops and one cup owner. Only cell pickup loads are withheld for transfer evidence; kitchen loads remain normal human/scripted confirmation. Source allocation coffeeJobIds bind the exact cup, courtesy of the domain fix. Cancellation after loading keeps the cup on the AMR while the job is returning, with no handoff recorded.
- **CAMPAIGN-FD02-FD07-BV01-BV03 revision1:** concurrent two-table food plus two queued coffee recipes, two AMRs and corridor contention. This new campaign explicitly ends after all customer handoffs (`park:false`); FD01, FD07 and FD02-cups separately cover return to parking. A diagnostic variant with a table inside the corridor correctly hit NO_PATH; another variant with return-to-bay queued behind sequential coffee work correctly expired the old parking command. Neither failure was ignored or converted to completion. The published new workload puts both drinks at table0 (BV01 ordering), keeps two food destinations and verifies4 served,2AMR observations,2distinct cups, and reservation contention.
- **ARM integration:** ARM fault allowlist includes following-error, stop, estop, reset, collision; report includes collision/stop traces. armCollisionChecker is true only after actual model checks. Parent owns the checker/stop implementation and its focused geometric regressions.
- **Parent-owned minors:** legacy CoffeeState.trays migration and prediction-unit mismatch diagnostics were implemented/validated by root; no overlap in those edits.

## Final verification

Broad Node24 gate (8 files):

`node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-runtime-review.test.ts tests/integration/lab-v2-software-gaps.test.ts tests/integration/lab-v2-mixed.test.ts tests/integration/lab-v2-stream.test.ts tests/integration/lab-v2-contracts.test.ts tests/integration/lab-v2-recovery.test.ts tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-report.test.ts`

**72 pass,1 skip,58.27 s.** Skip is the opt-in real measurement, not a pass. This gate ran before the last two narrow restore/reclaim evidence-preservation edge refinements; the affected three-file rerun is recorded below when complete. Earlier compatibility gate with coffee job/transfer/recovery: **68 pass,1 skip,40.56 s** (overlapping evidence, not added to totals).

Additional red evidence for expanded work: speed-limited project rejected before schema/plant support; manifest fields absent; observation faults rejected; persistent warmup had no bounded escalation; pickup stalled; reclaim proof absent/archive404; mixed scenario unsupported; mutated provider changed scripted wait into human wait; unsafe restore and completed reclaim changed completed into needs_attention. Corresponding regressions now exercise real source/plant/gateway paths.

Typecheck, generated-contract check, focused ESLint and git diff whitespace check passed. No operational services/hardware/native adapters were started; gateway tests use temporary directories and ephemeral loopback ports. No commit/staging or acceptance ledger edits performed. Root owns final whole-repository gates, clean artifact export/import, browser runs, evidence approval and acceptance status.

## Pending root follow-up after runtime freeze

Fresh review found the arm checker uses only self/injected geometry without a mapped cell/world profile. Root is adding optional versioned `armCollisionProfile` (map-frame base and arm-frame fixtures/geometry), then mapping project obstacles and AMR positions into collisionWorld before model advance. Until that integration is verified, legacy projects without a profile prove only self/injected collision coverage. Runtime agent is not editing source schemas, scenario-runner, CoffeeDriver or TS report during root's integration. Final acceptance must use the new profile-aware fixture/evidence, not infer full world collision from the prior check count.

Final affected-file rerun after both edge refinements:

`node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-runtime-review.test.ts tests/integration/lab-v2-software-gaps.test.ts tests/integration/lab-v2-stream.test.ts`

**28 pass,1 skip,3 files,53.75 s** (host contention during concurrent gates; not a performance benchmark). Final `tsc --noEmit`, focused ESLint, and `git diff --check`: exit0. These results precede root's armCollisionProfile/world-mapping follow-up above. Runtime implementation is frozen for root integration/export.
