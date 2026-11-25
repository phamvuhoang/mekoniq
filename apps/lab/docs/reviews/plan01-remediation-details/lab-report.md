# Lab remediation handoff — 2026-11-05

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

Owner: `/root/fix_lab`. All changes are working-tree edits; no staging or commits. Root owns acceptance decisions, generated runtime export/pin, and integration browser execution.

## Implemented

- **R08:** Replay now reduces recorded journal snapshots into historical coffee jobs, steps/measurements, cup ownership and movements, fulfillment served totals, awaiting mission stops, and time/cursors. `TwinWorkspace` uses that projection for scene, inspector, run bar, queue and report summary. Arm joints use the last sample at/before the cursor. Unrecorded cumulative distance/collision metrics are unavailable before the report endpoint. Trace rows are cut at the cursor. Replay blocks runtime actions; saved reports reopen in replay.
- **R09:** Scene/inspector redraw when freshness category, link state or acknowledged pause changes, even with zero new samples. Inspector receives receipt age. Telemetry uses `simTimeNs` plus snapshot sequence for recency, not `seq >= tick`. Replay retains same-time stale samples and does not interpolate through invalid data.
- **R10:** Both Lab `src/reports/compare.ts` and source `packages/lab-runtime/src/v2/comparison.ts` correlate mission/stop/allocation arrivals and confirmations. A partial handoff counts only when the final allocation is confirmed; duplicates do not count twice; cancelled/skipped stops are excluded. Legacy single-robot clearance cannot be reported as pair separation (R11 display guard).
- **QA09b / SYS04:** Immutable reports in IndexedDB, content hashes, model/world/recipe/profile input scope comparison and runtime manifest scope comparison. Report UI can save/open historical evidence, mark stale scope without rewriting it, and retain old report on reset. Runtime not yet compared is explicit.
- **UX05 / UX18:** Reset creates a fresh run at tick zero with original locked inputs, preserves evidence, and archives the old runtime slot. Run speed 1/4/16/64x changes request pacing, always using 25 simulation ticks per auto-run call. AMR speed limit draft `(0, 0.5] m/s` applies only to an explicit new-input run; existing run inputs stay locked. Schema and mirrored type support the new source field.
- **Recovery:** Guarded `canRestoreCup` UI offers explicit correction confirmation, then `restoreCup`; post-dispense uncertainty still requires reconcile/quarantine and rerun. Runtime reclaim proofs are stored separately from reports, stripped from create responses before view storage, and used only after pairing. Reclaimed snapshots retain `view_reconcile` mode; the runtime also enforces it.
- **Other Lab software defects:** Repeated v1 migration rejects `PROJECT_V2_EXISTS`, including a concurrent add guard; synchronous IndexedDB open failure permits retry. Refused SSE with healthy snapshots uses bounded backoff and falls back to polling. Selecting a different preset retains the active run. Common state/entity labels are translated VI/JA/EN; technical trace IDs/reason codes remain verbatim. 3D shapes have an explicit schematic label; footprint overlay remains model geometry. Two mixed food/coffee campaign presets expose the runtime's new scenarios.

## Executed verification

Node `node`.

- `node node_modules/vitest/vitest.mjs run` in Lab: **123 passed, 1 skipped**, 19 files, 3.88 s (12:18 local). Skip is not pass. This includes concurrently added root-owned packaging tests.
- Lab `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- Lab `node node_modules/vite/bin/vite.js build`: exit 0. Existing large Three/OrbitControls chunk warning (~502 kB) remains; no build failure.
- Source `node node_modules/vitest/vitest.mjs run tests/unit/lab-human-wait.test.ts tests/integration/lab-v2-report.test.ts`: **9 passed**, 2 files (12:01 local).
- Source `node node_modules/typescript/bin/tsc --noEmit`: exit 0 after coordinated runtime/domain changes (12:18 local).
- `git diff --check`: clean in Lab/source at verification.
- Red/green observed before implementing: the original KPI produced 1 s/1 stop instead of 4 s/2 stops, counted partial/cancelled stops, and exposed single-robot separation (4 failures). Original actual workspace kept final coffee state at cursor0, arm used future sample with negative age, replay range used seq1003 as tick, stale scene stayed observed, and same-time fault telemetry failed recency (5 failures). New reset/speed, repeat migration/sync-open, SSE backoff, preset retention and guarded cup-confirmation tests also failed before fixes.

## Exact coverage tests

| Requirement | File and test title | Current evidence |
|---|---|---|
| R08 | `tests/unit/workspace-replay-freshness.test.ts` — `actual workspace replays BV01 cup/job/measurement/served state at each custody boundary` | Passed actual workspace with synthetic journal at ticks0/10/20/30/40: before brew, after brew, arm, robot, customer. Not a hardware or real-runtime video claim. |
| R08 | same — `arm inspector selects the latest recorded joint sample at or before the cursor` | Passed |
| R07/R08 | same — `replay uses simulation time, keeps same-tick fault samples, and does not interpolate through them` | Passed |
| R09 | same — `scene and inspector repaint when freshness/link changes with zero new samples` | Passed stale, reconnect and acknowledged frozen recovery with one sample total |
| R10/R11 | `tests/unit/report-human-wait.test.ts` and source `tests/unit/lab-human-wait.test.ts` — four tests beginning `human wait correlates overlapping missions...`, `partial handoff waits...`, `cancelled stops are excluded...`, `a single robot has no inter-robot separation...` | Passed both copies |
| QA09b | `tests/unit/report-evidence.test.ts` — `saved reports remain immutable while geometry/world/recipe/profile edits stale only the corresponding scope` | Passed fake-indexeddb persistence/reopen, per-scope edits, tamper rejection, unchanged saved outcome |
| UX05 | `tests/unit/workspace-replay-freshness.test.ts` — `reset creates a new run with the locked inputs at tick zero and preserves the old report` | Passed actual workspace with runtime boundary fixture |
| UX05/UX18 | same — `speed inputs validate positive bounded AMR limits and retain the running project while editing the next run` | Passed |
| UX18 | `tests/unit/core-design-world.test.ts` — `v2 project validates bounded per-AMR speed limits without allowing the field on cell entities` | Passed |
| Recovery | workspace tests — `cup correction requires a recoverable job and explicit confirmation before requesting bound observation` | Passed; cancel sends no request, confirm requests restoreCup |
| SYS01 | `tests/e2e/twin-plan01.spec.ts` — `SYS01: normalized journal/effects are identical at 15/60 FPS and while the browser renderer is frozen` | **Written, not yet executed**; requires new exported runtime. Compares full normalized durable events/effects/metrics, fixed seed/ticks with different pacing and real Chrome frozen lifecycle. Headless Chrome kept `visibilityState=visible`, so test does not fake a hidden property or claim a particular OS background throttling policy. |
| UX05/UX18/QA09b browser | `tests/e2e/twin-inputs.spec.ts` — `UX05/UX18/QA09b: reset, speed-limit draft, saved report reopening and replay remain independent` | **Written, not yet executed**; requires new exported runtime |

## UI performance measurement

Rerunnable harness: `scripts/measure-twin-ui.mjs`.

Executed from Lab:

```sh
node scripts/measure-twin-ui.mjs --duration-ms 60000
```

Optional output flag: `--output <path>`.

Evidence: `docs/implementation/evidence/digital-twin-v2/plan01-ui-performance.json`.

The harness starts Vite on an ephemeral loopback port and uses actual `TwinWorkspace`, scene/inspector and 3D/2D renderers with synthetic 10 Hz visual telemetry: **2 AMRs, 1 arm, 6 drawn tables**. The script declares target thresholds before capture: desktop33 ms, tablet2D50 ms. Host Apple M2 Pro, 16 GiB, macOS Darwin25.5 arm64, Chrome156.0.8078.80, native Metal renderer. Two separate captures >=60 s:

| Profile | Viewport / DPR | p95 frame interval | p95 workspace paint | Samples |
|---|---|---|---|---|
| Desktop3D | 1440×900 /1 | 16.7 ms | 20.3 ms | 3596 frames /600 paints |
| Tablet2D emulated on same Mac | 1024×768 /2 | 16.7 ms | 1.0 ms | 3593 frames /600 paints |

Both measured host profiles met the proposed targets. Desktop recorded one63 ms long task; maximum frame intervals50 ms desktop and133.2 ms tablet-emulated are recorded, not hidden. This is synthetic renderer load, not runtime throughput, physical tablet timing, physics, safety or hardware evidence. Physical tablet timing remains an external NEEDS_HUMAN/device gate if required. Capture predates the final text/control-storage integration cleanup; rerun this exact harness on final committed Lab revision for final-pin evidence.

## Pending integration / reviewer focus

Root must first export/import the clean updated runtime supporting `speedLimitMps`, `restoreCup`/`canRestoreCup`, archive/reclaim and new manifest hashes. Then, with exclusive launcher ports:

```sh
node scripts/test-mock-e2e.mjs --evidence twin-plan01.spec.ts twin-inputs.spec.ts coffee-journey.spec.ts twin-workspace.spec.ts twin-recovery.spec.ts
```

Each spec gets a fresh one-use pairing token. Do not count the two new specs as pass before executing them. Existing coffee/workspace browser selectors were updated for translated Coffee cell/Arm/quarantine labels and also need rerun. The existing coffee journey exercises uncertain mid-brew removal -> confirmed reconcile/quarantine -> fresh corrected run -> served2; safe pre-dispense restore is unit-tested in UI and source-tested by the runtime/coffee agents.

Review the new browser tests and async archive/reclaim boundaries closely. No fixed ports or browser processes remain from this agent. Root-owned offline launcher, packaging scripts, recipe fixture updates and acceptance docs were not overwritten.

## Independent review follow-up (12:34 local)

Two confirmed P2 regressions are fixed. The proof-protected source reclaim response now returns `lockedInput` cloned from the stored run record, after proof verification. Caller-supplied replacement inputs are rejected. Lab validates the response against the reclaimed run identity and uses its exact project, speed limits and seed for the scene, immutable evidence, and reset. Missing or invalid locked inputs block admission and reset; catalog defaults are no longer substituted. A regression uses BV01 width 7 m, AMR limit 0.2 m/s and seed 99, and verifies all three consumers.

Reconciliation now resolves an actual coffee job first, then a known explicit robot identity, then a recorded awaiting-mission or goal-command mapping. The real reclaimed FD01 attention shape (`STOP_REQUESTED`, mission subject plus `robotId`) opens confirmation for the known robot. Unknown subjects remain unresolved and no action is sent until confirmation.

The new campaign cell-process KPI now receives a cursor-filtered copy of the plant log during replay. An actual workspace test checks no-process before acceptance, incomplete while the command is active, and 0.4 s after a cycle accepted at tick 5 and completed at tick 25 (20 ms clock). The original report remains unchanged.

Additional exact tests:

- `tests/unit/workspace-reclaim.test.ts` — `reclaim preserves edited locked project and seed in the scene, immutable evidence and reset request`.
- Same file — `reclaim without locked inputs blocks scene admission, evidence saving and reset instead of using preset defaults`.
- Same file — `a reclaimed mission attention resolves its actual robotId for explicit reconciliation`.
- Same file — `unresolvable attention never offers a fabricated reconciliation subject`.
- Same file — `reconciliation subject prefers the actual coffee job and otherwise requires an explicit mission or command mapping`.
- `tests/unit/workspace-replay-freshness.test.ts` — `replayed cell busy KPI uses only process events at the cursor, without leaking the final duration`.
- Source `tests/integration/lab-v2-stream.test.ts` — `proof-protected reclaim returns the exact stored project, speed limit and nondefault seed, never caller inputs`.

Red/green observed: the first three reclaim workspace tests failed against the old implementation; the source HTTP test failed because `lockedInput` was absent; the new replay test failed because the plant log was dropped. Verification after fixes:

```sh
# Lab: 25 passed across the 3 files
node node_modules/vitest/vitest.mjs run tests/unit/workspace-reclaim.test.ts tests/unit/workspace-replay-freshness.test.ts tests/unit/twin-workspace.test.ts
# Source: 3 passed, 12 excluded by the name filter (not a full stream-suite run)
node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-stream.test.ts -t 'reclaim|archiving'
```

Both repository TypeScript checks and `git diff --check` pass. The source fixture now uses validated project narrowing, resolving its initial unknown-entity type error. Optional `armCollisionScene`, arm collision trace, and `coffee.plantLog` controls types were added for the coordinated scene/KPI work.

At 12:35, a further red/green regression `replay report withholds future arm collision results and keeps undated legacy results until the endpoint` confirmed that raw replay consumers could read the final collision object too early. Replay now returns null before the collision scene tick; older undated collision objects remain unavailable until the final report endpoint. This complements the scene agent's independent inspector guard. Latest Lab command adds `tests/unit/arm-scene-scope.test.ts` to the three files above: **28 passed in 4 files**, then TypeScript passed again. These follow-ups did not run fixed-port browser services, update acceptance rows, or modify offline packaging. No files were staged or committed.

## RL02 waiting-stop re-review follow-up (12:40 local)

The scoped re-review found a separate waiting-stop case: real FD01 seed 42 reaches its first completed navigation at tick 691, then reclaim suspends its scheduled load confirmation without producing `STOP_REQUESTED`. The old reclaim attention had no identities. A source integration regression reproduced this exact tick and failed before the fix. `holdForReclaim` now emits one `RECLAIM_RECONCILIATION_REQUIRED` attention per active robot mission with its robot, mission and command identity. A generic attention remains only when no active robot mission can be identified. Completed runs retain their existing behavior.

The Lab dialog now deduplicates known reconciliation targets and, when more than one exists, requires explicit selection from a labeled selector. Confirm is disabled until selection; an unknown or no-longer-valid target cannot be sent. Single-target confirmation continues to name its robot or job. Reconciliation still audits the native outcome and does not resume motion, replay commands, clear attention, or confirm cargo.

New exact tests:

- Source `tests/integration/lab-v2-reclaim-targets.test.ts` — `reclaim at the actual FD01 first completed navigation exposes the waiting robot for audited reconciliation`. Asserts tick 691, pending load identity, successful audit with native state `completed`, unchanged effects and served 0.
- Same file — `reclaim identifies each active robot separately when two missions exist`. Runs real FD07 and verifies separate `amr-a` / `amr-b` mission targets.
- Lab `tests/unit/workspace-reclaim.test.ts` — `reclaimed waiting-stop attention offers its known robot without requiring a stop-request event`.
- Same file — `multiple known reconciliation targets require an explicit selection and never default to the first robot`. Checks duplicate attention deduplication, no request before selection, unknown-target rejection, and explicit `amr-2` confirmation.

Red/green: both new source tests failed with missing robot identities; the multiple-target workspace test failed because the prior UI selected `amr-1` automatically. After changes:

```sh
# Source: 9 passed, including completed-reclaim and recovery guards
node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-reclaim-targets.test.ts tests/integration/lab-v2-runtime-review.test.ts
# Lab: 28 passed
node node_modules/vitest/vitest.mjs run tests/unit/workspace-reclaim.test.ts tests/unit/workspace-replay-freshness.test.ts tests/unit/twin-workspace.test.ts
```

Both TypeScript checks and repository diff checks passed. Source edits were restricted to `holdForReclaim` and the new test file; no constructor/profile changes were made. No fixed-port services, staging or commits. Edits frozen again for scoped re-review.

## AR03 retained collision replay follow-up (15:53 local)

The final arm review found that the earlier future-scene guard hid an actual retained collision: `firstFailure.tick=20` and a retained interval at 20 became null when the last scene refresh was at tick 100. Three new regression tests reproduced the failure before the fix.

`src/reports/replay.ts` now projects collision evidence by its retained interval/failure times. It clips stationary interval end ticks, includes an independently retained first failure even after trace exhaustion, filters worlds to retained references, and reconstructs the selected result and checker geometry. Scene metadata comes from the recorded failure snapshot or a matching immutable manifest declaration plus the interval's recorded world; future final scene poses/geometry are not borrowed. Evidence identifies its retained tick range and the checked-geometry world scope. Missing world references or a truncated source trace explicitly make history incomplete. Because old traces provide only a final drop total, earlier drop/check totals are null when truncated; at the endpoint the actual source drop total remains available. The historical source report is not changed.

The controls mirror now includes bounded collision evidence and stop events. The inspector shows the recorded blocked result/pair independently of a later scene timestamp and labels incomplete retained history. A further reviewer probe exposed future stop/reset state copied by the original report spread; a separate red/green regression now verifies filtering stop events and reconstructing the observed latch at the cursor. No observed stop before the cursor yields no stop state; later reset is not visible early, and reset retains reconciliation-required state.

New file `tests/unit/replay-arm-collision.test.ts` has six actual projection/inspector tests with a synthetic recorded trace:

- `collision replay exposes the retained trigger at its tick despite a newer final scene, without future geometry`.
- `collision replay clips a stationary interval and does not expose a later failure or final coverage`.
- `truncated replay retains an independently stored first failure and marks missing history explicitly`.
- `retained interval scene uses the immutable declaration and referenced historical geometry only`.
- `missing retained geometry marks history incomplete instead of borrowing the final world`.
- `arm stop replay hides future collision and reset events and reconstructs the observed latch at the cursor`.

Verification: `node node_modules/vitest/vitest.mjs run tests/unit/replay-arm-collision.test.ts tests/unit/workspace-replay-freshness.test.ts tests/unit/arm-scene-scope.test.ts tests/unit/report-replay.test.ts tests/unit/workspace-reclaim.test.ts` — **34 passed**, 5 files. The new six-test file passed again after correcting its synthetic final check count. Lab TypeScript and `git diff --check` passed. No source implementation, fixed-port services, acceptance records, staging or commits were changed. Documentation prepared separately remains unchanged by this fix; final pin/CI/evidence fields remain pending. Edits frozen for the arm reviewer's re-check.


## Performance and SYS01 evidence audit follow-up (2026-11-05, 16:20 local)

The prior performance comparison allowed `workspacePaint.p95Ms=null` to coerce to a passing number, and SYS01 recorded draw counts without checking them. The new pure `scripts/ui-performance-validation.mjs` rejects empty/nonfinite/nonpositive percentiles, short capture/request durations, missing/page-error records, wrong workload/profile, insufficient frame samples, paint counts outside 90–110% of the 10 Hz schedule, and missing actual renders. A legitimate slow capture remains valid measurement but fails its target. Source acceptance independently enforces the same checks. Twelve validator cases ran against the previous comparison: eleven failed before the fix; all twelve now pass.

`measure-twin-ui.mjs` requires at least 60 seconds and verifies each measured paint: native WebGL draw calls with a sized canvas for 3D, or a freshly generated SVG with both AMRs and the arm for 2D. Page errors make evidence invalid. The resulting JSON includes `renderedPaints`, `pageErrors`, validation errors and validity; older captures without those fields are no longer accepted. The final recorder must regenerate them.

SYS01 now asserts actual populated render output, no page errors, meaningful draw counts and measured cadence near configured 15/60 FPS. It records every draw's absolute timestamp. The strengthened first run **failed** because Chrome `Page.setWebLifecycleState(frozen)` continued rendering about 60 frames in its purported frozen interval. Headless/headed and focus/background probes reproduced this; earlier lifecycle-freeze claims are superseded. With the owner's approved correction, the test uses acknowledged CDP `Debugger.pause` to suspend real page JavaScript while independent HTTP requests drive source, then resumes it. The RAF callback is not disabled by the harness. The test and acceptance row are renamed to **debugger-paused**, with no OS background-tab throttling claim.

Fresh pinned-runtime browser verification:

```sh
# Node 24.22.2; temporary evidence output, no checked-in evidence overwritten
LAB_EVIDENCE_DIR=<temporary-directory> node scripts/test-mock-e2e.mjs twin-plan01.spec.ts
```

**1 passed**, 22.9 seconds, against source pin `7e4999033aff1d00ed696f80d26a013f726ec27b`. Exact title: `SYS01: normalized journal/effects are identical at 15/60 FPS and while the browser renderer is debugger-paused`. Measured active rates were 14.99 and 60.00 FPS; resumed/pre-pause segments were 60.04 and 61.00 FPS (timestamp quantization/short segment). There were **zero draws during the 1040 ms acknowledged suspension**, no page errors, and all three normalized reports were identical. This proves backend independence from renderer suspension, not browser-owned Auto-run scheduling during suspension.

Fresh hardened performance harness:

```sh
node scripts/measure-twin-ui.mjs --duration-ms 60000 --output <temporary-output.json>
```

Both host profiles passed: desktop 3D frame p95 **16.8 ms**, paint p95 **19.9 ms**; emulated tablet 2D frame p95 **16.7 ms**, paint p95 **1.4 ms**. Each recorded 600 actual paints over at least 60 seconds with no page errors. This remains synthetic renderer load on the recorded Mac, not physical-tablet or runtime-throughput evidence. Final release evidence remains root-owned and must be regenerated after the evidence tooling commit.

Additional checks: validator plus workspace-replay suite **23 passed**; Lab and source TypeScript checks passed; both repository diff checks passed. The source edit is confined to measurement validation and the SYS01 title/description; the other evidence-identity changes belong to the coordinated arm-scene agent. Fixed launcher ports 4175/4176 and ephemeral measurement services are released. No commits or staging. Changes frozen for independent evidence re-review.
