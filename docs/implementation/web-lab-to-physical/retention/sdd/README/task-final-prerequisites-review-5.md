# Spec Compliance

**Verdict: ✅ Spec compliant for final prerequisite correction 5.** No Critical or Important defect found in the supplied two-commit change. **Task quality: Approved**, with the nonblocking reporting/test-output notes below. This is a scoped prerequisite review, not the final whole-branch review, publication approval, or R2b qualification.

Reviewed the complete task brief, including both authorized release-integration and awake-rerun appendices; complete implementer report; and complete supplied `b0fcedec2bc826c4501972f424f3c9798b6b7449..d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6` package in bounded passes. The package includes both `1256cdb` and `d4c3032`, all nine changed files, and surrounding context. Direct byte/hash checks matched:

- Report: 19,464 bytes, SHA-256 `83002a867eb17cde60ed887e2d7a156d5fb67e7bca10ac6aa2683f5becd8404d`.
- Diff package: 71,682 bytes, SHA-256 `1614b90cb7ae26113e11ebab4b10f0c02c0829fa79d3424d62a70175d7eb15fb`.

Lab file references below are relative to the Lab worktree. Evidence references are relative to Source `.superpowers/sdd/README/`, unless prefixed `raw/`. `raw/` means `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-fix5-pqfmcrch/`.

## Requirement findings

### 1. Finite production HTTP observation — PASS

`scripts/production-http-observer.ts:8` establishes a dedicated observer used directly at `scripts/measure-cell-production.ts:58`. It replaces the known unsafe `Response.finished()` dependency with request admission, response headers, and `requestfinished`/`requestfailed` events. Each admitted request has a 90-second deadline, including required JSON observation; `finish()` at helper line 60 freezes admission, waits only for the admitted set, and applies a separate 10-second drain deadline. All terminal paths settle through helper line 13, remove the entry, clear its timer, record actual timing/failure, and resolve its completion promise. Disposal/close/crash at lines 55–59 settles remaining entries and detaches all six listeners. The drain timer is finally-cleared. Late asynchronous JSON completion cannot add a second result: actions/publications check membership before publication, and DELETE/general settlement is membership-guarded centrally.

Helper lines 16–20 allow only an actual `net::ERR_ABORTED` GET of the exact world-display or world-display/scene route to be classified as `optional-read-cancellation`. Those rows remain in the evidence with failure and actual timing. Other failures, deadlines, invalid status/body, and target closure are required-observation errors; this is not a blanket request-failure omission. Completed observations require a 2xx response and finite nonnegative start/end timing. Required action observations additionally validate the response run, action request identity, tick, revision, status, and exact 200 status. Required publications validate 201, export identity, matching run, document type, and nonnegative integer horizon. Missing/invalid observations cannot enter the action/publication success arrays.

`scripts/measure-cell-production.ts:77` drains before closing the browser, writes HTTP evidence, fails on accumulated observer/page errors, and requires exactly one matching publication and release. Line 79 retains the unchanged Source clock checker. Failure disposal/evidence at line 83 and final disposal at line 84 preserve incompleteness. Creation JSON is separately bounded at line 60. The HTTP records preserve action/run/tick and the original observer-clock fields; they do not manufacture `responseEnd` or claim an ACK is an internal commit.

Evidence: `tests/integration/production-http-observer.test.ts:22` exercises real abort-after-headers while the page remains open; line 29 exercises a real unfinished body; line 35 exercises real control/action/publication correlation and listener removal; lines 44–58 cover required invalid responses, failed mutation, and target closure. `tests/unit/production-http-observer.test.ts:7` covers delayed body completion after a drain deadline and zero owned timers/listeners; line 16 covers disposal. `raw/http-red/output.log` shows two semantic pending-versus-settled failures, rather than setup/module failures. The complete final five-file run in `final4-unit.receipt.json` has actual own exit 0/signal null and 49 passes, including both full observer files.

### 2. Actual 1024px paired run bar — PASS

`src/styles/main.css:2369` limits the new spacing/padding/minimum-width rules to 1024–1279 px. It changes available width allocation rather than font size, content, translations, display visibility, or focus behavior. The scenario minimum retains twelve characters, and the problems control explicitly retains a 44px minimum width. Existing phone and wide rules remain unchanged. None of the original paired tests or thresholds are changed by this diff.

The primary `layout-red2/playwright.json` layout attachment shows the actual 98px bar, 842px outer/826px inner width, scenario 180.484px, connecting chip 122.406px, mode 146px, 24px left-group gaps, 381.594px right contents/gaps, and the separate group gap. This supports genuine width pressure rather than treating a connection-state hypothesis as a proven runtime bug. `layout-red/output.log` is a separate null.outerHTML fixture setup failure; `layout-red2/output.log` is the semantic expected-48/received-98 RED. They are not interchangeable.

`tests/e2e/run-bar-compact.spec.ts:4` uses production markup/CSS. Lines 13–16 verify the 48px row, existing full geometry checks, accessible name, and keyboard focus; lines 17–26 cover VI/JA/EN × live/connecting/failed/lost with complete chip text, no overlap/scroll, twelve scenario characters, and every button at least 44×44. The complete unchanged paired `twin-polish.spec.ts` passed all 10 cases, including its original 1024×700 case. `final3-paired-layout` additionally passed the complete runbar-layout (1), twin-layout (9), and twin-transport (7) files: 27 total, no skipped cases. The compact component plus accessibility evidence is supplementary, not a substitute for that paired flow.

### 3. Public replay release integration — PASS

`src/scenarios/controls.ts:211` retains the captured export target/auth/CSRF and once-only release flag. Lines 212–220 create a fresh cleanup AbortController, impose a 10-second cleanup deadline, consume the response body, require exact 200 with `deleted === true`, and clear the timer in `finally`. Refusal, malformed/incomplete JSON, and timeout remain explicit failures. Cleanup does not use an already-aborted export signal. The surrounding `send` implementation passes this signal directly to fetch and judges authentication loss against the captured target; retargeting cannot rewrite the release URL/auth. The unchanged UI finalizer awaits release before clearing exportBusy, so the recorder's re-enabled-control boundary follows the cleanup attempt.

Helper lines 47–51 validate a DELETE acknowledgment independently and record its run/export identity without depending on when publication JSON finishes. Recorder line 77 joins identities only after drain and requires exactly one successful matching release. This removes the callback-order race without weakening DELETE observation. `tests/unit/production-http-observer.test.ts:22` explicitly holds publication JSON until after DELETE observation and verifies drain waits; retained `release-order-red` shows the former false-invalid behavior. Its two filtered-out tests are not_run in that targeted RED, then included in the final full-file run.

`tests/e2e/replay-release.spec.ts:7` traverses the actual public production runtime implementation, browser, owned HTTP server, admitted manifest and gzip asset. It covers valid/malformed/incomplete/refused/unfinished DELETE responses, aborts the original export signal before cleanup, calls release twice, and requires one DELETE. Final awake evidence is 5/5 with own exit 0/signal null; unfinished cleanup fails as intended at approximately 10.3 seconds under unchanged deadlines. The remote test at `tests/unit/twin-runtime-remote.test.ts:470` preserves its original retarget/auth/idempotence assertions; only the fixture acknowledgment changes from `{}` to Source's real `{deleted:true}`.

### 4. Ownership, truthful evidence, and integration — PASS with explicit validation limits

`scripts/measure-cell-production.ts:40` captures child exit code/signal and startup errors. Line 41 installs owned-child cleanup before waiting for a pairing token: boot failure can therefore reach cleanup even before `gateway` exists. Shutdown first signals that exact child with SIGINT, bounds the wait, escalates only that still-running child to SIGKILL, bounds that wait, and reports timeout/nonzero/signal failure. Lines 43–45 remove the temporary boot stdout listener and keep draining stdout. Lines 83–90 independently attempt browser, preview, and runtime cleanup even when another close fails; cleanup errors and observer incompleteness produce a failed cleanup record/exit instead of successful cleanup prose.

Primary failed `raw/diagnostic-capture/http-observations.json` contains DELETE 200 with actual responseEnd -1, DRAIN_DEADLINE, 36 actions and one publication. Its invocation exits 1, and its cleanup/observer summary completes without errors. It remains a failure. Primary final `raw/diagnostic-capture-final/http-observations.json` contains 37 actions, one publication, errors [], and a completed matching DELETE 200 with responseEnd 6.589ms for run `53b44b56-feb1-443b-90f9-e548d5ba7d76` / export `71db45e0-cd31-4000-bf21-60de9f37c8a2`. Final cleanup is completed:true/errors:[]; observer_end has 3226 records, no overflow, and no observer failure. The actual final entrypoint receipt has own exit 0/signal null. This provides real success and failure-path cleanup evidence, but does not fault-inject forced escalation or child boot failure.

`precommit-final-byte-binding.json` explicitly distinguishes the final helper/order-test bytes from the earlier layout/component runs. All nine final files match before/after snapshots of final4-unit, final4-build, and final5-release-awake; final UI/CSS bytes also match the paired layout run. The root handoff audit independently binds these to the final Git blobs, 200 dist members, unchanged pin, and 11 retained original failure members. I used that audit as provenance, not as a substitute for code review. The final package is the full two-commit correction, not merely HEAD~1.

### Binding scope constraints — PASS for this diff

`scripts/measure-cell-production.ts:22` retains the diagnostic-only exception to the 180000ms minimum; line 80 retains accepted:false and the actual 180000ms / 33ms / 15ms / 500ms targets. Actual draw events and RAF measures remain distinct, as do browser-observed Source receipts and internal commits. The supplied diff changes no Source runtime/schema, pin, dependencies, public reader, acceptance gate, native/physical branch, or threshold. The frozen identity/audit records bind Source `981e234b1a0da8c72d220445daaf780b3bf65ae4` / tree `0f00b40f4cdff7ea8acb08db7901b119beee9216` and Lab `d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6` / tree `c6b68cc8e780b59b5f52ad3eb6063d3a5c9041d6`, with empty tracked status and unchanged runtime/schema/portable identities.

The primary final result has active elapsed 5001.800ms, accepted:false, durationMet:false, displayMet:false, and actual render interval p95 200.800ms. Its build hash is `2c1e9f307b7727c074eb160ff396251af295a520fc7884237fd752903975212e`. It establishes integration only. It cannot close the long benchmark, calibration, native, physical, or human-acceptance requirements.

# Strengths

- The helper isolates the specific HTTP lifecycle responsibility without reorganizing runtime behavior. Central membership-guarded settlement makes late completion harmless and preserves diagnostic failure rows (`scripts/production-http-observer.ts:13`).
- Real HTTP/browser regressions cover the failure mode that mocks alone would miss, while small deterministic tests cover protocol-body stalling and callback order (`tests/integration/production-http-observer.test.ts:22`; `tests/unit/production-http-observer.test.ts:22`).
- Release correctness is enforced at both the public runtime and evidence boundary, and the final identity join is order-independent (`src/scenarios/controls.ts:212`; `scripts/measure-cell-production.ts:77`).
- The layout fix spends spacing, preserves labels and touch/focus behavior, and retains original paired tests unchanged (`src/styles/main.css:2369`; `tests/e2e/run-bar-compact.spec.ts:13`).
- Evidence clearly retains failures: original unknown-URL timeout, fixture setup failures, semantic REDs, intermediate DELETE failure, and sleep-overlap release failure remain distinct from later passing invocations.

# Issues

## Critical (Must Fix)

None found in the scoped change.

## Important (Should Fix)

None found in the scoped change.

## Minor (Nice to Have)

1. **Test-output noise obscures useful failures.** `tests/e2e/run-bar-compact.spec.ts:5` opens the normal application with no paired runtime for a component-only fixture; `raw/final3-release-component/output.log` contains repeated ECONNREFUSED health-proxy errors. Release/layout logs also contain repeated NO_COLOR/FORCE_COLOR warnings (for example `raw/final5-release-awake/output.log:1`). These are real output findings, although the paired suite is separately successful and the release file's owned server covers its required boundary. A future fixture/environment cleanup should make the expected disconnected health behavior explicit and select one color setting without hiding unexpected errors. This does not invalidate the observed passing assertions.

2. **Native identity attribution is inaccurate in the implementer report.** `task-final-prerequisites-5-report.md:99` says exact native/portable identities are retained in the unchanged Lab lock/final-identity. The actual lock inside `evidence-final-recording/fix5/final-identity.json` has portableToolsDigest and runtime/schema fields, but no explicit native closure hash. The native identity is attributable to unchanged Source981 and the prior native-closure evidence, as the root audit correctly clarifies. Future handoff prose should use that attribution; do not rewrite historical evidence. This is a provenance-description error, not evidence of changed native bytes or a code defect.

# Cannot verify / validation boundaries

- Forced SIGKILL escalation and exported-child boot failure are implemented in recorder lines 40–45 but were not fault-injected. Code review supports the ownership/finite-wait design; only actual successful and failed-observation recorder cleanup was demonstrated. No claim of execution coverage for those branches is made.
- A complete >=180-second final-subject campaign, full performance target attainment, native/physical/calibration gates, Webots/Docker admission, and human acceptance are outside this task and remain unverified here. The short record explicitly fails duration/display targets.
- The original Source981/Lab b0f 20-minute capture's pending URL remains unknown. Neither the abort reproduction nor the fresh intermediate DELETE identifies it retrospectively. The negative direct-download result is not converted into a positive reproduction.
- The retained final4-release invocation remains 4 passes/1 timeout, own exit 1, roughly 1005 seconds wall time. The dispatch/root sleep audit documents its 992-second host-sleep overlap. I verified the failed receipt/log and the separate awake 5/5 receipt/log; I did not re-query host state. This review does not reinterpret the failed invocation as bounded success.
- Source/native identities and full immutable-evidence retention are based on the supplied frozen identity and independently recorded root provenance audit; no Git or native execution was performed by this reviewer. The nine-file diff itself contains no contrary scope change.

# Evidence checks and outside-diff disclosure

Read and hash-checked primary receipt logs for final4-unit, final5-release-awake, final3-paired-layout, final3-release-component, final4-build, final3-typecheck, final3-source-pin, both production diagnostics, and selected semantic/setup failure receipts (http-red, layout-red/layout-red2, release-red, release-order-red, final4-release). The observed final results are 49 unit/integration passes; 27 paired passes; 15 component/release/accessibility passes; 5 awake release passes; successful type/build/pin checks; and successful short exact-entrypoint integration. Counts overlap by design and are not summed as independent tests. Final4-build includes full `tsc --noEmit`, so the later script/helper bytes have final type validation. Build and unit logs are clean; browser output noise is reported above.

Focused outside-diff source checks were limited to named interactions:

1. **Captured-target and cleanup cancellation propagation:** read only `src/scenarios/controls.ts:137–202` surrounding send/request/run/auth helpers, because those helper definitions were outside the supplied hunk. Fetch receives the independent cleanup signal; target-sensitive authentication handling does not retarget the captured release. The read extended through adjacent method definitions in the same bounded excerpt; no broader search followed.
2. **Recorder boundary versus actual UI release:** read `src/ui/workspace.ts:175–193`, specifically exportWorld lines 184–188, to verify exportBusy is cleared after awaiting release, and that download is the generated blob path. This supports the recorder waiting for the export control before drain.
3. **New observation rows versus unchanged public clock validation:** read `source/scripts/browser-capture-clock.mjs` to check compatibility of preserved action correlation fields and optional diagnostic rows. The checker correlates successful action IDs/run/tick/times; optional unrelated response rows do not become action successes. The same file retains long-duration/drawing/worker/receipt qualification checks.

No changed file was separately reread in full; the supplied diff was the code-review source. A small script derived precise final line references from the supplied hunks. Evidence JSON was inspected for primary outcomes, layout geometry, and identity/check bindings. No suite reruns, browser/engine/native/cloud launches, private database reads, code fixes, Git mutations, helpers, or reviewers were used. The only written file is this requested review report.

# Nonblocking out-of-scope observations for final whole-branch triage

No additional entirely untouched-code defect is raised by this review. The unchanged authority, long qualification, and native/physical boundaries above remain the responsibility of the later recording/final-review phases; this approval does not discharge them.

# Assessment

**Spec compliance: Approved for the scoped prerequisite task. Task quality: Approved.** The correction addresses the demonstrated request-liveness and width-pressure failures, enforces consumed/validated release cleanup without a callback-order race, and has meaningful real-boundary and final-entrypoint evidence. Residual validation limits and two minor evidence/test-output issues do not require another implementation cycle before the controller decides whether to resume the separately authorized recording phase.
