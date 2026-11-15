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
