# Deferred minor findings for final whole-branch triage

Per-task progress ledgers/review reports remain the exhaustive authority; this index is an aid, not permission to drop earlier findings.

- B02b README wording: resolved in B00R's merge, per task-B00R-report.md22 and current robotics/simulation-mujoco/README.md mobile section. Historical Python-only boundary is identified as historical; current Source provider/readiness is documented. Retain resolved disposition at final review.
- B00R review1 validation noise: resolved historical attempt only. Incorrect standalone touch harness failed; the correct owned mock harness passed7 cases with a clean final log. See task-B00R-review-1.md49 and task-B00R-report.md254–265. Do not erase the failed attempt or repeat it as an open defect.
- B00R review2 documented boundary: owned-process lifecycle helper supports direct local asynchronous roots on Node24.22.2. Future synchronous/subprocess/worker-thread creators require explicit integration and regression proof. Historical global-kill targets remain unknown; no later pass resolves that uncertainty. See task-B00R-review-2.md27.

- B04a-R1-01: source packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts125 — dense verifier; extract coherent validation helpers when warranted. Current behavior reviewed. See01-r2b-mobility/task-B04a-review-1.md.
- B04a-R1-02: source tests/integration/mujoco-payload-campaign.test.ts89 — success PAYLOAD_FALL output; retain artifact or explicit diagnostic-only output. See same review.
- B04b-M1: retained browser-zero-final.log warns NO_COLOR ignored when FORCE_COLOR is set. Resolve the invocation environment in an appropriate future change; no product failure or native rerun solely to clear it. See01-r2b-mobility/task-B04b-review-1.md.
- Controller visual observation (nonblocking, B07 readability): UI-only B04b-navigation-visible-cursor0.png shows generic “Legacy / no native evidence” for an absent arm/controller verification block next to real mobile MuJoCo evidence. Clarify the block's scope when polishing new-provider reports; do not imply no actual engine observation exists. Current B04b I1/I2 fix loop is unchanged.
- Controller visual observation (nonblocking, B07 readability): B04b-navigation-visible-cursor520.png has very compressed assertion-detail text in the narrow desktop sidebar table. Existing region is horizontally scrollable; review readable column sizing/summary and keyboard/touch access in the planned web-report work. Do not alter evidence values or reopen B04b solely for layout.

### B05 review1 — retained minor validation noise
- Legacy fake-arm placement-refusal timed out in finalfocusedinvocation (107pass/1timeout); exactfollowup passed349ms andearlierfull16suitepassed. No functionalregressionproven/no rootcauseassigned. Preservebothlogs; finalwholebranchvalidationwillcoverlegacyboundary. Do notrepeatnativecampaignsolelytoerasefailedattempt.
- Copied vendor NOTICE contains11upstream trailing-whitespacewarnings andisbyte-identicaltolicenseoriginal. Authored-filewhitespacecheckpasses. Preservevendorbytes; reportfullcheckwarningseparately.

### B06 — resolved review and retained scope limits
- I1 concurrent same-H report publication: RESOLVED in Source0624b5a/Lab4fabc5a, independently approved by task-B06-review-2.md. Production fix is in-process arm report publication coalescing, not a global change to writeDurable or a cross-process lock. New B07 export writers must own their concurrency; B09 owns process/data-root exclusion. Do not reopen the resolved report race without a new concrete regression.
- Performance remains B07b work: completed Source development runs achieved.608/.590/.591x end-to-end (includes setup/report/readback/assertions), not measured worker+IPC or production-browser1x. Full qualification is B10. Keep final measured results distinct from the earlier checkpoint CPU projection.
- General navigation robustness remains limited: the refined regression/native fixture proves the retained failure correction; a broader6mm turn-offset model still fails an earlier connector. This is explicitly retained in the B06 report, not covered by the three nominal seeds and not a hardware/calibration claim. Final docs/claims should preserve that scope, without treating it as an unresolved B06 review finding.

- B07a review1 M1 (Minor, deferred): committed retained tests hardcode machine-specific /tmp paths (web-replay-export.test.ts:8, web-replay-capture.test.ts:13, web-replay-gateway.test.ts:15). Need explicit digest-verified retained-input configuration/preparation and clear missing-input failure; portable reader/HTTP tests independently runnable. No silent skip/pass. Evidence valid here; final whole-branch review must triage before merge. Keep outside Important fixround1.

- B07a scoped review2 O1: unchanged public gateway.ts:119 server.close-before-v2.close means heldresponse can delay reaching internaldownloadabort atv2/gateway.ts:319. NonblockingforcompletedI1–I4requestfixes; currentreportqualifiedinternal-only. Ruling63 makes public-close held-response/pendingIO regression and correct owned shutdown ordering load-bearing B09 drain/stop/data-root work; close beforefinalqualification. See task-B07a-review-2.md, task-B09-brief.md.

- B07b controller measurement follow-up (B10 recorder): frozen browser capture records relative RAF/render timings and HTTP absolute response timings, but not explicit browser timeOrigin/active start/end epoch anchors. Existing achievedRate must be labeled browser-observed cursor pacing. A separately audited unique-matched interior Source-H receipt-span rate is not an exact shared-wall-window commit rate; ambiguous matches/missing absolute boundary gaps remain unavailable. B10 recorder should persist direct shared clock/window anchors and action correlation so final qualification does not infer matching from latency. This is a documented evidence limit, not permission to claim1x or hide a review finding.

- B07b review1 M1 (Minor): successful offline-freeze.log/r70-native-browser.log contain NO_COLOR/FORCE_COLOR conflict; r70-lab-build.log contains unknown npm environment configuration and inconsistent JSON import-attribute warnings. Results remain passing. Normalize owning runner/import usage in B10/final whole-branch triage, with actual attribution for inherited versus new warnings; do not rerun physics just to erase historical logs. Related B04b color-warning item remains linked. See02-r2b-cell-and-web/task-B07b-review-1.md.

- B07b fix1 final390 screenshot observation (cause unverified): /tmp/b07b-fix1/browser-mobile-final/report-replay-fetched-cursor0-390.png has a second header/language-looking stripe near y813–886. New note is readable/fits; final assertions checked overflow/note, not header count, and no final DOM snapshot was retained. Earlier single-header evidence was a separate offline case, so it cannot establish this live report case. Sent to scoped reviewer for any fix-induced mechanism; otherwise B10 final UI/browser qualification should record DOM header count and screenshot together. Do not claim compositor artifact or confirmed product duplication without evidence; no extra campaign solely for a hypothesis.

- B08 review1 M1 (Minor, deferred): mismatched-world fixture has stale report hashes; several world/frame/goal and adjacent physics negative tests leave upstream scene/reference seals stale, so integrity checks mask the semantic/whitelist rejection being claimed. Positive reconstruction is covered; I1 needs coherent fully resealed regressions now. Remaining corruption-versus-semantic negative coverage to triage before merge; see02/task-B08-review-1.md. This is not an extra Important fix-loop item.

- B08 I1 status update: RESOLVED at Source714e37f/Lab4741edf by review3 after two scoped fixes (baseline profile/closed empty-load binding, explicit physical document discriminator). All nine new coherent mutations pass upstream integrity and reach semantic rejection; actual retained X01 readback is byte-identical. This does not resolve original MinorM1 stale-seal tests, which remains for B10/final triage. Do not reopen the completed I1 fix without a new regression.

- B07a scoped-review2 O1 / R63: RESOLVED by B09 implementation at Source3c917ce/Lab538ba45, fulltaskreview1 + scopedreview2. Public g.close stops admission, waits held download/file/SSE journal work and owned runner/worker closure before root-lease release. Protocol held-I/O barriers and separate actual Mac arm child close/reclaim evidence retain distinct scopes; no container proof inferred. B09I1 coldreclaim orphan andI2 missingretainedstate findings were fixed and review2 closed both, no new finding. WEB05/image execution remains open underR76, not a reopened implementation finding.

- L00 review1 test-precision observation (nonblocking, not an additional Important): some inventory negatives also invalidate the provenance seal, so resealing would better isolate the intended refusal reason. Review identifies existing predicates and does not make this a separate blocking finding. Preserve for final triage if not naturally covered by R1 OCI/identity fixes; see03-r3-linux-readiness/task-L00-review-1.md Test and evidence assessment.

### L01 review1 — L01-R1-05 (Minor, deferred to B10/final triage)
The new compatibility reader requires lift>=0.15m for summary/raw assertions, but frozen M00 acceptance is liftMinM0.14m; commanded lift0.15m and measured historical~0.1514m are different quantities. Conservative false rejection for[0.14,0.15); no unsafe acceptance. Preserve historical threshold or record an explicit reviewed stricter-policy ruling at final triage. Exact report:03-r3-linux-readiness/task-L01-review-1.md, scripts/native-sim/mujoco-probe-evidence.mjs lines32/41. Not part of Important fix1 loop; no silent drop.

## L02 full-lint preflight — historical evidence environment/format
Controller observation, not an L02 task-review verdict: `pnpm lint` fails 27 errors across five historical evidence scripts unchanged from L02 BASE and frozen upstream. See `03-r3-linux-readiness/root-L02-historical-lint-audit.json` and retained L02 report/log. Owner B10 final CI tooling; preserve old script bytes and resolve correct environment/CommonJS lint configuration before claiming full CI. L02 changed-file lint still required.

### L03 review2 — L03-R2-01 (Minor, deferred to final whole-branch triage)

Full review: [task-L03-review-2.md](03-r3-linux-readiness/task-L03-review-2.md). Python `robotics/manipulation/native_xarm/mapping.py:85` serializes rounded negative zero as `-0.0`, unlike TypeScript; legal equivalent `<offset>-0</offset>`/`-0e0` is falsely refused. Pinned vendor emits positive zero; no changed-semantics admission or native capability. Normalize rounded zero to positive zero with paired producer/consumer regression when touched. Prepared-code gate passed; this is recorded, not silently discarded.

L03-R1-05 is a separate **unmet native qualification gate**, not a deferred code Minor or completed task. R88 requires actual X1/X2 provenance/expansion/motion/fault/stop/controller-restart and ten X3 contact trials or an observed unsupported result. All remain incomplete/not_run pending the assigned matching host. Full original review and review2 retain the requirement unchanged.

### L04 review1 — L04-R2 (Minor, deferred to final whole-branch triage)

Full review: [task-L04-review-1.md](03-r3-linux-readiness/task-L04-review-1.md).

### Minor — L04-R2: trace admission exceeds the single-call oracle limits

**Location:** `source/packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts:35` and `:59`; supporting existing limits at `source/robotics/algorithm/algorithm_checks/kinematics.py:15` and `source/packages/lab-runtime/src/v2/algorithm/checker.ts:14`.

The validator accepts up to 100,000 samples, then submits all actual joint rows in one `rtb_fk` request. The existing RTB implementation accepts at most 10,000 poses, and the checker transport separately caps requests at 1 MiB. Consequently, inputs accepted as valid by this new consumer can deterministically fail before any FK residual is calculated. For example, a trace with 10,001 short valid joint rows meets the new sample bound but exceeds RTB's row bound. `collectResults` correctly retains the rejection reason, but presents a failed numerical verdict for an unsupported batch size.

The current short terminal sequence is unlikely to reach that size, so this is not a blocker for its ordinary capture. Align the admitted capacity with the actual transport/oracle bounds, or use bounded batches with explicitly aggregated maxima. Test the supported boundary so longer imported traces have predictable behavior. This is distinct from a genuine numerical residual failure.

Recorded per SDD Minor handling; no claim of fixed capacity. Native qualification remains incomplete independently.

## B10 review1 — B10-R1-M1 (Minor, final documentation handoff)

### B10-R1-M1 — One rebased GTM link encodes the current worktree nesting

**Location:** `source/docs/gtm/2026-11-14-web-simulation/01-research-and-evidence.md:66`.

The marketing-site link is rebased to `../../../../../../web/index.html`. It resolves here because the Source worktree sits two levels below the ordinary four-repository workspace. In a fresh normal layout with sibling `source/` and `web/`, this climbs two directories above the intended workspace. The current link audit establishes local existence, not the promised clone handoff portability.

Use an explicit documented checkout-layout reference or stable commit/path provenance for the separately owned web repository, and validate links against that handoff layout. Do not rewrite historical claims or copy a different marketing snapshot under the old attribution. This is nonblocking for prepared executable tooling but should be resolved in final documentation handoff.


Full report: [task-B10-review-1.md](02-r2b-cell-and-web/task-B10-review-1.md). Not part of the Important fix loop; retain the clone-layout limitation until final handoff disposition.

## B10 prepared-tooling review closure (final execution still pending)

Full review1 plus scoped review2 at Source `ac9b44d` / Lab `47343f9` resolves the assigned retained-input portability defect (B07a M1 / B10 I1), clock/window/action and browser build/case preparation (B10 I2/I4), and WEB05 lifecycle/replay preparation (B10 I3). These are code/portable-test closures, not actual browser/performance/WEB05/native qualification. B10 review1 also records addressed warning normalization, scoped historical lint environment and frozen 0.14 m L01 threshold at their tested scope. Wider B08 negative-fixture precision, earlier Minors, B10 M1 clone-layout link, final 390px observation and all Cannot-verify execution scopes retain their existing final-triage disposition. See both full B10 reviews; this index does not replace them.

## L06 review 1 — L06-R1-M1 (Minor, final triage)

### L06-R1-M1 — The arm64 MuJoCo case reports only an external prerequisite despite its known adapter gap

**Location:** `source/scripts/r3-readback.mjs:18`, `:35`, `:73`.

For `mujoco-linux-arm64`, `DEP-MJ-01` keeps `category:'external'` and reason `ASSIGNED_HOST_CASE_ARTIFACTS_MISSING`. The missing arm64 campaign adapter is added only to the aggregate `capabilities.toolingLimitations`. The per-case row, `blockedNativeCases` and native-gate blocker consequently tell a recipient that this case only lacks host artifacts, although assigning a host cannot supply the absent adapter.

The runbook and aggregate capability are honest, and the native gate does not pass. Still, the brief specifically requires tooling gaps to remain explicit in returned profile/case/level results. Give this case a tooling-and-observation disposition naming the arm64 adapter gap, preserving absent-host prerequisites separately. Add a prepared arm64 assertion that checks the case and gate blocker, not only the aggregate limitation list.


Full report: [task-L06-review-1.md](03-r3-linux-readiness/task-L06-review-1.md). Root read the complete review. This Minor stays outside the I1–I3 fix loop; final handoff must retain a concrete disposition and must not claim a host alone resolves the arm64 adapter gap.

## L06 prepared-tooling review closure

Full review1 and scoped review2 approve prepared tooling at Source `6e5eee9` / Lab `283696b`: I1 exact X1 timestamp representation, I2 independent worker/Source clock origins and I3 retained run inventory are resolved. Review2 has no new findings; M1 per-case arm64 blocker is unchanged and remains final-triage work. This is not final recorder/native/physical execution. Preserve all six Cannot-verify limits and the complete reports; 141 passing related tests do not replace actual native or browser evidence.

## L06-R1-M1 — resolved in separate final prerequisite correction1

Fresh scoped review [task-final-prerequisites-review-1.md](README/task-final-prerequisites-review-1.md) PASS/APPROVE at Source `bab05a5` / Lab `1f9b48d` resolves the diagnostic Minor: arm64 DEP-MJ-01 case, blocked row and native gate explicitly retain both absent host artifacts and absent adapter. Coherent prepared arm64 regression reaches case/gate checks. No arm64 campaign was added and native remains not_run. This is separate from the earlier closed L06 I1–I3 loop. No new findings in this correction; remaining earlier deferred items and all final-execution limits persist.


## Final recording dependency observation — R2b mj-evidence and owned cloud services

Observed by final_recording and confirmed by root from current code at Source2bd66e6: `scripts/sim-extension-r2b.mjs:7` includes `tests/security/payload.test.ts` in `mj-evidence`. That existing suite tests cloud HTTP payload limits/JSON/webhooks/amounts, not only MuJoCo load physics; its beforeAll calls `setupWave02` and auth fixture setup. `tests/support/wave02-db.ts:8` refuses a missing `MEKONIQ_TEST_SERVICE_RECEIPT` before Docker inspect, postgres or migrations, so an owned-service-unavailable run must not borrow the original Supabase namespace. No receipt is supplied in the blocked-service final phase.

Carry this dependency into final handoff and final-review triage. Actual successful payload campaigns alone cannot close all G-MJ1 requirements; preserve the real suite failure/not_run and actual derived case/gate disposition. This is a newly documented dependency/coverage observation, not a demonstrated unsafe admission or a changed table. The full reviewer should assess whether the generic HTTP suite is an intentional extra baseline constraint or misplaced coupling. Root has not removed the suite, weakened acceptance, asserted it passed or run a service operation. R93 keeps real incomplete regression and independent local observations distinct. Do not invent a future actual failure count before execution.


## Final prerequisite review4 — unchanged cold-reclaim session expiry

Scoped review4 approves the priority-control fix at Source981e234/Lab b0fcede with no new breakage. It records a nonblocking out-of-scope observation: `packages/lab-runtime/src/v2/gateway.ts:323–334` checks the requester session before asynchronous factory/hold/epoch work and does not visibly recheck immediately before installing the read-only owner. Expiry in that interval may still complete read-only reclaim. This is pre-existing code-reading evidence, not a demonstrated unauthorized mutation or a correction4 regression.

Keep the distinction from the new priority path, which checks after token waiting and at execution. Final whole-branch review must assess reclaim-expiry policy and disposition this concrete observation; no silent fix or acceptance claim. Root continues reviewed local recordings, with cost of a mistaken deferral being a later confirmed policy defect requiring the final fix wave and appropriate evidence refresh. Full [review4](README/task-final-prerequisites-review-4.md) and [root dispositions](README/root-final-prerequisites-4-review-dispositions.md) are authoritative; this index is navigation only.


## Final recording observation — inherited JUnit scrubber produces invalid XML

At current Source981e234, official IR-SIM output `suites/lf-py.xml`, `cmp-py.xml` and `parity-py.xml` contains literal `hostname="<host>"`; standard ElementTree refuses each at column210/209. Raw headers retain34/40/9tests respectively with0failures/errors/skips. These counts are header observations, not proof that the stored files are valid XML. Full root evidence: [root-final-981-junit-observation.json](README/root-final-981-junit-observation.json); implementer preserves its independent observation and every actual suite receipt/log.

`scripts/record-irsim.mjs:48,61` scrubs XML with plain text replacements; the entire script is byte-identical to frozen upstream11d25b. `scripts/record-sim-extension.mjs:131,148` has the same unchanged scrub behavior. The unchanged pytest summary in `scripts/irsim-qualification.mjs:48–51` reads numeric header attributes with regex, and public readback checks exact result hash plus re-derived counts at135–140; it does not establish well-formed JUnit. Literal angle-bracket replacements can also affect other XML attribute/text contexts.

Root disposition: inherited format/interoperability defect, not a demonstrated new test failure or unsafe admission. Continue actual recording/public readback unchanged and disclose the limitation. Do not repair/unescape historical artifacts, label them parseable JUnit, or treat the observation as permission to weaken gates. ONE final whole-branch reviewer must assess actual consumer/contract impact and concrete severity; it is not silently fixed or accepted as valid. A blocking finding can require the final repair wave and appropriately refreshed evidence. Full reason/cost Ruling remains in the root progress ledger.


## Final recording layout observation — inherited in-tree upstream guard

Current R1 recorder completed successfully at Source981e234/Lab b0fcede; public acceptance then recorded11pass/1fail because `tests/acceptance/sim-extension.acceptance.test.ts:18,62–66` looks for `docs/implementation/evidence/linkforge-irsim/irsim/qualification.json`. The actual fresh external upstream exists and exactly equals the carried IR-SIM bytes/hash. R1.1/R2a lineage checks use analogous fixed in-tree roots. Root verified these guard segments are unchanged from frozen11d25b; the current acceptance file also contains separately reviewed R2b/R3 additions. Full16file original/snapshot proof and exact failure: [root-final-981-r1-layout-handoff-audit.json](README/root-final-981-r1-layout-handoff-audit.json).

Root authorized unchanged acceptance in an isolated exact Source/Lab producer checkout, staging real upstream directories byte-for-byte into absent expected paths. Record actual code/dependencies/cwd and data-only staging dirtiness; it is a fixture-layout readback, not clean producer execution. Keep the original external-layout failure and all raw inputs. Final handoff must document the exact reproduction layout and actual staged outcomes; this is not an arbitrary-output-layout portability fix. R93 partial R2a remains incomplete and must still fail assertions requiring tested gates/screenshots. No status/threshold/code/artifact edit, historical overwrite or campaign rerun was authorized. Root reason/cost Ruling is in the progress ledger; whole-branch review should assess the retained disposition and documented reproduction boundary.


## Final recording — paired1024 runbar layout assertion

Current Source981/Lab b0f unchanged supplemental twin-polish executes10cases:9pass/1fail/0skip, own1. `lab/tests/e2e/twin-polish.spec.ts:180` observes48px wide runbar and98px at1024×700. Actual PNG shows VI mock coffee/needs_attention/connecting runtime chip and two rows with controls visible. Cause remains unresolved; a transient connection-state width effect is only a hypothesis. Test, run-bar renderer and default PWconfig are byte-identical to frozenLab a744; the whole66373B upstream CSS prefix is unchanged, with appended rules scoped to replay/cell/phone/study. That static comparison is not an executed upstream reproduction. Earlier broadmock skipped all10cases and is not contrary passing evidence.

Root verified all original/copy default artifacts and receipts in [root triage](README/root-final-981-twin-polish-triage.json); complete failure and untouched raw JSON are retained. Ruling permits independent recordings to continue and carries this failed requirement into ONE whole-branch review; it is not fixed, waived or passed. Reviewer must assess actual scope/severity and corrective need. No assertion/threshold relaxation or retry was made.

### Updated disposition — actual1024 run bar and recorder liveness

The earlier final-only layout deferral is superseded prospectively by the explicit final-prerequisite5 Ruling in README/progress.md. Fresh scoped implementation now covers diagnosis/fix of actual1024paired run-bar failure together with proven aborted-response observer liveness defect; no fix or pass is claimed yet. Preserve original failures, negative download diagnostic, abort RED, incomplete SIGALRM producer and all their actual tuple/ownreceipts. The ONE final whole-branch reviewer must read full correction5 report/review and disposition; it is not exempted from final net review. Root brief README/final-prerequisites-5-brief.md.

## Final prerequisite5 scoped review disposition

Read fullREADME/task-final-prerequisites-review-5.md19487B/d0365596 and README/root-final-prerequisites-5-review-dispositions.md. NoCritical/Important; observer/layout/release requirementsPASS. MinorM1 componenthealthproxy/colorwarnings parked forONEfinaltriagewithcost/nohiddenassertionfailure. MinorM2 nativehashinLablock attribution correctedprospectively byrootaudit/disposition; preserveoriginalreportandcorrectedfuturedocs. Forcedcleanupboot/escalationunobserved,5sonlybenchmarklimits,originalURLunknown/sleepfailedrow remainexplicit. Prioractual1024failure nowhasreviewedcorrection atd4c3032, notretroactivepass atb0.


## Final production performance observation — awaiting whole-branch triage

Actual Source981e234/Labd4c3032 production capture completed185s with own0/cleanuptrue but did not meet required display/pause/rate/active-drawing outcomes: achieved0.47188883x, actual render interval p95300.2ms, worker IPC4.837ms, last-step receipt upper bound2797.283ms, public CAPTURE_ACTIVE_DRAWING_DURATION (fullCellDrawing14615.1ms versus activeCell184975.84ms). Production browser1+replay5 passing does not close these independent requirements. Root audit README/root-final-981-d4-production-performance-audit.json retains the exact metric semantics and own receipts; all accepted:false.

README/root-final-981-d4-web-performance-code-observation.md records a bounded static read of the100ms normal world refresh timer, exact-horizon reconciliation, exclusion of shared-world/MuJoCo poses from client interpolation, and five-tick paced cell step. Actual render CPU p950.5ms is distinct from the300.2ms interval; no complete bottleneck or new causal proof is claimed. No code, threshold, input or historical outcome was altered. Final whole-branch review must assess these unmet requirements and the camera/complete-cell visual observation against the actual spec, without treating this entry as an accepted deferral or prior severity verdict. Any correction must preserve authoritative shared horizons, custody, unknown-ACK handling, reduced motion, replay isolation and truthful measured rate. Current native/prepared success cannot compensate for web-experience targets.


### Later current validation of the twin-polish wrap observation

At Source981e234/Labd4c3032, after the separately approved correction5, the complete unchanged fresh supplemental twin-polish file passes10/10 with no skips. Root independently checked raw Playwright cases and own receipt in README/root-final-981-d4-r2a-supplement-audit.json (114571B, SHA9fc031a76f6d047f556bf8c4d409379576285aac194ad4eb3392397d4eebb394). This closes the previously observed1024px wrap at this new tested scope; oldb0 ninepass/onefail and original/copy location deviation remain preserved, not retagged or waived. It does not resolve the separate actual display/rate/pause/active-drawing shortcomings or promote the genuine partial R2a qualification.

Final scoped review N1: Important, OPEN pending explicit bounded repair; actual oldPause replay truncates later shared-world step. Unchanged navigation2d/runner.ts:539/624 analogue is unverified/out-of-scope deferred; no reproduction or repair claimed. See README/final-scoped-review-dispositions.md for complete rulings and costs.

Navigation replay scope update after N1 GREEN: unchanged lab-run-controls.test.ts:142 actually passed using real IR-SIM runner; it explicitly expects cached Pause to yield a different2tick batch atH0/unpaused. Distinct from exact held50tick world repro. Existing navigation policy stays untouched/out-of-scope; do not claim all-runner replay repair. Complete observation/ruling/cost in README/root-n1-navigation-coverage-observation.md.

## Post-N1 recording at Source 0d46403 / Lab 7c97b20 — current unresolved observations

This is a prospective recording disposition, not a rewrite of earlier findings or review tuples. The bounded N1 shared-world receipt/control-start correction was addressed by its existing reviewer's follow-up; see [the full N1 review](README/task-final-n1-review.md) and [root disposition](README/final-n1-review-dispositions.md). The earlier OPEN wording above describes its pre-repair snapshot. The unchanged navigation policy/covering-test observation remains out of scope. Historical whole-branch/scoped/N1 verdicts do not close the subsequent current failures below.

- Current 185-second capture: unchanged public assessment is invalid/meetsTargets:false with `CAPTURE_PAUSE_CORRELATION`, `CAPTURE_STREAM_GAP`, `CAPTURE_RENDER_PROGRESSION`, despite individual p95/bound measurements in budget. Measured rate 0.366375x is distinct from selected 1x. The root [residual observation](README/root-post-n1-capture-residual-observations.json) correlates a progression gap with recorded persistence waits and notes uncalibrated browser/network clock origins; it does not assign full OS/storage causation or an offline clock offset. No recapture, durability weakening or threshold correction was applied.
- Complete mock: actual Source unit result 1092 passed / 2 failed and engineering result 714 passed / 2 failed / 5 not_run. Child-output fixtures received empty output rather than retained/started; native-provider transport-double tests retained an amr-delay `STACK_TRACE_ERROR` and awaiting_operator rather than observed_transition. These are four unresolved actual assertions, not classified as flaky or proof of a real Linux/device restart failure. Full mock guard is 40 passed / 1 failed / 0 skipped. No retry or new product fix/review wave.
- R1 legacy Webots journey: actual browser expected `Simulation · not calibrated` after Run but retained `Simulation · not run` through its unchanged five-second assertion; no underlying admission cause proven. The separate fleet case passed. R1 own 1 has 16 tested / 2 failed (INT11 and REG01) / 1 not_run (ALG04), with G-INT2/G-REG1 not_run. Actual R1.1 and R2a admissions refused missing/untested current lineage; normal full R2b admission refused the absent current partial. No current R1.1/R2a/R2b candidate was invented; independent passing table/study inputs do not replace that lineage.
- R1 retention gap: the referenced journey failure PNG and error-context Markdown were already absent at first inspection after the next internal spec reused the owned default directory. The owner scheduled default preservation after the complete recorder and did not capture those two files before reuse; deletion instant unobserved, original bytes/hash unknown. Failed JSON/log and six pre-Run assembly screenshots survive, but are not substitutes. Later surviving-default copies do not prove full attachment retention; no reconstruction or retry was used. This is distinct from the five explicitly excluded private originals.
- Current browser artifact readback: the functional same-build closed case passed, but public `verifyBrowserArtifacts` returns `WEB_BROWSER_INVOCATION`. The normal producer records explicit `--output <owned browser-artifacts>` while the unchanged reader compares exact argv without it. Other invocation/result-hash/metadata fields match. Original args and hashes remain untouched; no normalization, guard change or new browser run was used to obtain acceptance.

The actual independent payload 19-case/cell eight-case campaigns, corrected physical row, official IR-SIM, 27 available R2a table rows and real three-engine semantic study retain their own passing scopes. `rt-container`, native/physical/hardware/HTTPS and missing dependent candidate scopes remain actual not_run/blocked states; six R3 records are prepared only, image:null/nativeReady:false/accepted:false. The complete [new recording report](README/task-post-n1-final-recording-report.md) and its phase metadata carry all original exits, assertions, gaps and source/checker boundaries. Root explicitly kept this closure to required evidence/readable publication with concerns, without another engineering fix/review wave. No all-quality-gates-closed or release acceptance claim follows.
