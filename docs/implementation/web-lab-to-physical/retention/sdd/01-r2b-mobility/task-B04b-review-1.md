# Spec Compliance

**❌ Issues found.** B04b implements the requested native payload journey, but import identity binding and replay cursor visibility are incomplete (Important I1 and I2 below).

**Code quality verdict: Needs fixes.** Two scoped correctness fixes are required; no Critical issue found.

Reviewed Lab `cbeb5817cd65d53182aa080df3e566ad656d4945` → `81d619dc514039c6aea6d0bd88b15159575c5955` using the supplied `review-cbeb581..81d619d.diff`. Source BASE=HEAD `681b8adb8ed473f7195062773b23fabc3b922cd5`; no Source diff reviewed. Paths below are relative to the Lab worktree unless marked otherwise.

## Strengths and requirement checks

- The seven registered experiments, default center load/seed 7/1×, and receipt invalidation are explicit in `src/twin/payload.ts:25`, `:31`, `:35`; current draft/request checks prevent an older successful compile replacing a newer experiment in `src/ui/workspace.ts:270`. The out-of-order case is exercised in `tests/unit/payload-view.test.ts:46`.
- The launcher preserves arm-only default behavior and makes mobile prerequisites opt-in: `scripts/start-irsim.mjs:41`, `:140`. The provided positive arm boot and mobile browser logs support the two paths; no repeat launch was needed.
- Payload geometry is separately adapted, leaving the shared asset compiler alone as the brief's preflight permits. `src/twin/payload.ts:56` validates schemas/document digests and pins mechanics plus admitted load supports/props; `:76` composes canonical link frames. `src/viewer/twin3d.ts:254` uses those links and `:266` uses the payload's cylinder dimensions. `scripts/sync-engineering-contracts.mjs:58` copies source fixture bytes after hash checks.
- The cup is an independent observed payload, not fabricated coffee custody: `src/twin/scene.ts:65`, `src/twin/payload.ts:40`, `:73`. Mobile samples bypass client interpolation in `src/twin/live-playback.ts:17`; replay also holds committed mobile observations and hides missing/gapped payload samples in `src/reports/replay.ts:77`, `:122`.
- `src/reports/physics.ts:5` suppresses future aggregate values; its display retains the B03 interval/zero-target definitions and low-material masking caveat. Imported physics values are explicitly made unavailable rather than trusted as recomputed measurements at `src/reports/navigation2d.ts:131`.
- The initial-clock ruling is implemented at `src/ui/workspace.ts:501`: payload start omits the legacy automatic step. `tests/unit/payload-view.test.ts:104` tests that action boundary; `tests/e2e/mujoco-payload.spec.ts:20` checks actual-provider tick 0, boot identity, and equality to the committed observation.
- The paused-cancellation helper at `src/ui/workspace.ts:504` journals cancel first, guards run/generation/access after awaits, steps at 1× in a 500-tick bound, stops on non-running states/errors, and observes a subsequent Pause. It does not set terminal state or release capacity locally. Focused interruption/attention/error tests are at `tests/unit/payload-view.test.ts:58`, `:64`, `:69`, `:76`.
- The exact terminal cursor is separately supported for this preset, preserving the old step size elsewhere: `src/ui/workspace.ts:325`, `src/ui/transport.ts:24`, `tests/unit/payload-view.test.ts:112`.

## Issues

### Critical (Must Fix)

None found in the reviewed task scope.

### Important (Should Fix)

**I1 — Imported report/physics profile identity is not bound to the scene/load actually rendered.**

References: `src/reports/navigation2d.ts:121`, `:122`, `:127`; `src/twin/payload.ts:56`, `:73`.

The importer correctly validates and loads a scene plus its admitted load/model, and checks payload telemetry against that bundle. Separately, it compares `physicsEvidence.manifest.identity.loadProfileDigest` to `navigation2d.engine.loadProfileRef.sha256`. It never compares the latter report ref to `payloadBundle.scene.engine.loadProfileRef`/`payloadBundle.loadSha256`. A report and its embedded physics manifest can therefore agree on one load identity while their scene, geometry and telemetry describe another. Hashing the embedded manifest does not close this missing cross-reference.

Confirmed with a minimal, in-memory Node 24 probe against the retained public folder `/tmp/mekoniq-b04b-cup-fall-replay-20261114-1022`. Baseline import succeeded. The only mutations were:

```js
const mismatch = structuredClone(report);
mismatch.navigation2d.engine.loadProfileRef.sha256 = 'f'.repeat(64);
mismatch.physicsEvidence.manifest.identity.loadProfileDigest = 'f'.repeat(64);
mismatch.physicsEvidence.manifestSha256 = createHash('sha256')
  .update(JSON.stringify(mismatch.physicsEvidence.manifest)).digest('hex');
// Replace report.json in an in-memory File[]; all other bytes unchanged.
const imported = await importNavigationEvidence(files(mismatch));
```

Observed output:

```text
baseline import: true
mismatched report profile ACCEPTED: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
actual admitted: 0290f280969726aadde1137c502f128738912e4b08c9328b1af4fd6c914ecfc5
```

This violates the brief's file-byte profile identity and import-binding requirements and the report's claim that wrong profile bindings are refused. It is an integrity issue even though imported aggregate physics metrics are correctly downgraded and the path is read-only.

Fix: cross-bind the report engine/profile refs to the validated scene's corresponding refs before accepting/persisting the folder, and bind physics identity to that same admitted identity. Check the other duplicated engine/policy refs at the same seam so a parallel mismatch is not left open. Add a focused malformed-folder regression with internally consistent report+physics hashes but unchanged scene/load/telemetry; keep the valid retained folder import passing.

**I2 — Navigation aggregate visibility is only evaluated on full render, not on replay scrub.**

References: `src/ui/report-panel.ts:79`; `src/ui/workspace.ts:608`, `:658`, `:661`; unchanged focused call path `src/ui/workspace.ts:175` and `:190`.

`reportPanel()` correctly chooses a final navigation panel versus an earlier-cursor placeholder. However, `scrubbed()` updates only replay body, controller verification, payload physics and payload timeline, then calls `tick()`. `tick()` updates the scene, inspector, run/object/identity/next blocks and report summary; it never replaces the navigation panel/placeholder.

Concrete affected journey: import/open the real cup-fall recording (opened at terminal tick 520 by `twin-open-evidence`), then drag the cursor to 0 while Report remains open. The final navigation panel remains in the DOM, including `0..520` coverage, final assertion results and `105 of 105` publications. Those exact values are present in the retained recording. The reverse transition is also wrong: enter live replay at tick 0, scrub to the final tick, and its initial placeholder remains until some unrelated full render.

This is established by the update path, without another browser/native run. The existing browser checks at `tests/e2e/mujoco-payload.spec.ts:28` and `:37` assert only physics/replay-body visibility; they do not check navigation on either boundary crossing.

Fix: give the cursor-dependent navigation region a stable update target and update it from the same scrub projection/full-report policy, or otherwise refresh that region during scrub while preserving range focus. Add forward and backward cursor assertions, including a report opened directly at its terminal tick. Do not change the legacy provider policy incidentally.

### Minor (Nice to Have)

**M1 — Retained browser validation has environment-warning noise.** `../source/.superpowers/sdd/01-r2b-mobility/evidence-B04b/browser-zero-final.log` contains `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` Resolve the conflicting environment settings in an appropriate future launcher/test invocation. This is not a product failure and does not justify repeating the native journey solely to remove the warning.

## Verification and evidence inspected

- Read repository AGENTS instructions, reviewer template, B04b brief and report. Read the supplied package in bounded sections; no Git re-derivation or repository crawl. The large physical-model JSON output was truncated by tool display limits; recovered its link/visual/joint/drive structure compactly from that package. Also recovered the cut sync-script hunk. No product files were edited.
- Read existing logs: `evidence-B04b/focused-final.log` (14 files/98 tests), `clock-controls-final.log` (3 files/25 tests), `launcher-final.log` (1 file/6 tests), `typecheck-final.log`, `source-check-final.log`, `sync-check-final.log`, and `browser-zero-final.log` (1 actual-provider browser test passed). These are implementer runs, not reviewer reruns. Earlier 98-test coverage predates the final clock/cursor-only correction; the final 25-test and browser runs cover that correction.
- Ran the focused I1 Node probe and the secondary claim-boundary inspection noted below, using `typescript.transpileModule` in an in-memory CommonJS loader to load the checked-in TypeScript. Read public replay files into `File` objects with `webkitRelativePath`, made the three mutations above in memory, and called `importNavigationEvidence`. No test suite, browser, runtime, native campaign, process search/signal, or deployment was run. No replay bytes were changed.
- Named outside-diff checks: (a) import cross-binding risk — existing `navigationEvidenceView`/`identityMismatches` in `src/reports/navigation2d.ts:32`, confirming those checks do not compare the scene's engine refs; (b) stale response and scrub ownership risk — `current`, `tick`, `leave`, `act`, and existing paced-step paths in `src/ui/workspace.ts:66`, `:175`, `:399`, `:438`, `:526`; (c) alternate import/claim boundary — `src/reports/report-shape.ts:1`, `src/reports/verification.ts:1`, `src/reports/engineering-view.ts:1`. A secondary calibration inspection found the actual retained report has no `engineeringEvidence` block; no additional finding is asserted from that check. `package.json` was read only to choose an available in-memory probe loader.

## Cannot verify from this diff / scope limits

- The Source engine numerical correctness, durable recorder semantics and actual hardware/native qualification are prior-task responsibilities; Source has no diff here. B05 full-cell, B07 offline catalogue/live stress and B10 broad qualification are not claimed or required by this task review.
- I did not independently rerun browser/a11y/native suites or visually reinspect the final PNGs. The controller supplied that it had inspected the six final matching/fault captures and initial tick-0 identity; the retained browser log and checked-in assertions support that evidence, but full touch-device/screen-reader/WEB04/performance qualification remains not_run.
- The I2 UI defect was verified by tracing the DOM update path and the retained report's actual values, not by a new live browser reproduction.

## Assessment

**Spec compliance: Issues found. Task quality: Needs fixes.** The native observation/rendering, initial-clock behavior, bounded paused cancellation and physics metric downgrade are well scoped. Close the report-to-scene profile binding and update navigation visibility on scrub, then run focused regressions for those two cases before task approval.
