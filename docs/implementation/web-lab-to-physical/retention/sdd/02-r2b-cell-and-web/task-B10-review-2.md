# B10 fix1 — independent scoped review 2

**Scoped prepared-tooling spec verdict: PASS.**

**Scoped prepared-tooling quality verdict: APPROVE.** I1–I4 are resolved at the prepared producer/reader boundary. No new Critical, Important or Minor finding was identified in this fix or its immediate integration. This is not completion of parent B10, final CI/recording, WEB05, native/host qualification or physical acceptance.

Reviewed Source `09b06bee0559c31087d478e5a4c4f28e4832a3cd` → `ac9b44dc1bf01bce2406b6f91ac3e141c043c739` and Lab `d12c04a467ef084a991cfb17ff280d55f0c49dc2` → `47343f930b712dd6ac64ed7cd874de3c0aca2188`. Independent final HEAD/status reads matched both dispatched heads and clean trees.

## Scope and method

Read the requirements brief, complete original review, fix dispatch, original implementer report and complete appended fix handoff. Read both complete supplied fix packages in bounded passes: Source 80,713 bytes / 14 paths, SHA256 `c1ff6a8ac36658788d0d7066f6fc2606c751f681edbb6d0d2a22a233c37537d7`; Lab 54,827 bytes / 7 paths, SHA256 `229b98f1075db9da740195f8ddb04c03ae6379c5c282656ecf90b5f345c7720d`. All added/changed implementation, tests, runbook text and retention semantics were assessed. No replacement diff or broader history crawl was generated.

Focused dependency reads addressed named integration risks only: the unchanged clock correlation function used by the stricter assessor; the wire observer's request/ACK fields and clock domain; the renderer's actual event timestamp/tick shape; digest admission for the newly declared retained input; and the scenario runner's completed-to-reclaimed state transition. The runner still sets `WORLD_RESTART_UNKNOWN`, suspended/reclaimed state and read-only `needs_attention` on reopen. No Source authority was weakened to satisfy the new replay checks.

Read the root handoff's identity, closure, preservation, receipt and byte-attribution summaries, the retained helper/copy map and I1 helpers/attribution, and relevant retained RED/GREEN log results. Root's audit is attributed byte/receipt/export/pin consistency evidence, not behavioral approval, authenticated execution or host provenance. Exact historical copy rows rely on that audit; historical behavior was not reapproved.

No suites, Docker/native/cloud/physical operations, browser campaigns or SQLite engine opens were performed. No helper/reviewer was spawned and no implementation/evidence was changed. Only this report was written.

## Finding dispositions

### B10-R1-I1 — Resolved

`tests/security/web-replay-export.test.ts` now admits `cell-nominal-export` through `retainedInput` and reads `manifest.json` from that admitted directory. The hard-coded historical read is removed. The catalog declares the third input with original-path provenance, run identity, byte count and SHA256; the runbook names all three acquisition inputs and the new catalog digest. The unchanged admission helper checks the configured catalog digest and exact directory inventory before the test consumes the expected manifest.

The historical expected manifest remains 26,525 bytes, SHA256 `b3eb6e7cc0e6c2287092c358e02ab3c860e76e5bc828a5ed41bae4e83bbebaea`. The copy map distinguishes this exact historical copy from authored test helpers. No historical producer identity was converted to a current qualification identity.

The retained I1 RED shows the old nominal comparison passing despite the undeclared input; the refusal wrapper correctly failed. Missing-input and wrong-byte GREEN wrappers observed `RETAINED_INPUT_MISSING:cell-nominal-export` and `RETAINED_ARTIFACT_HASH:cell-nominal-export`. These are intentional child failures at admission, not skipped/passing test cases. The declared-corpus run passed the four actual files / 30 tests, including the independent synthetic replay reader. The original-path trap covers the three original locations without moving shared evidence. Its `NODE_OPTIONS` attribution is explicitly post-execution because the original receipt omitted that field; it is not contemporaneous serialized proof. That evidence limitation does not leave a hidden fallback in the reviewed code.

### B10-R1-I2 — Resolved

`scripts/browser-capture-clock.mjs:assessCapture` now derives active/full-cell drawing duration from ordered RAF samples rather than accepting summary values. It requires observed step progression, valid tick increments, unique successful action/response correlation, a unique pause action, and agreement of final/stable/post-export paused run and horizon. Render events are bounded to the browser window and run/tick identity. Worker observations require request/run/tick/success identity, Node-origin/epoch agreement, matching action intervals, active-window coverage and complete bounded tick coverage. Before/after rows remain separately classified; trailing rows are not silently moved into the active window.

The Lab producer converts exported worker epochs with `atEpochMs - performance.timeOrigin`, uses the explicit browser window for event-loop/IO partitioning, retains the pause views and action identity, and waits for pending response observers. The inspected wire observer emits the request/ACK/tick fields consumed by the assessor; renderer events use browser performance timestamps. Missing observations cannot become a successful zero-duration/zero-latency result. A nonnegative zero last-step receipt bound remains legitimate when actual observed steps precede the click. The 33 ms render, 15 ms worker and 500 ms last-step receipt targets are unchanged, and no new UI-latency budget was introduced. Receipts and wire ACKs remain observer boundaries, not internal Source commit timestamps.

The final complete fixture includes genuine progression within its synthetic observation model and a separated trailing worker row. Coverage retains the exact reviewer bypass and twelve independent mutations, plus missing-stream and existing-budget assertions. The RED observed all thirteen bypass assertions fail against the old reader. The final 17-test clock scope replaces the obsolete summary-only positive and explicitly verifies that a long pause-to-UI interval alone does not introduce an unrequested target.

### B10-R1-I3 — Resolved

The mandatory directory collector delegates WEB05 to `scripts/web05-readback.mjs`. Standalone, publication-response and opened-package manifests must agree. The opened report is bound to the observed post-reclaim report for the finished run; run/source manifest, completed horizon, served count and business-event continuity are separately bound to the original completed report. The final implementation correctly permits recovery/finalization metadata to change during reopen instead of requiring equality with the pre-archive completed state.

The reader binds retained image inspect/config identity and revision, running container image and mounted named volume, health Source/schema, the same active run across crash/recovery, required running/needs_attention states, nonempty unchanged chunk hashes, contender refusal, kill/start success, read-only reclaim, 403 resume refusal and zero remaining workers. Referenced command/HTTP observations have unique identities and ordered boundaries. Fixed read-only chunk/worker programs bind the command being measured. The producer retains actual command results and HTTP observations and redacts known credential/proof fields at collection; authorization headers are not retained.

The synthetic tests open a valid complete replay before each semantic mutation and reseal the outer inventory. They cover an unrelated valid replay, wrong opened-report Source, image/run/health/volume mismatch, empty chunks, failed ownership/crash/restart/recovery and observation-order/invocation errors. The public directory path is exercised without an inventory failure masking the group verdict. The final transition positive includes the completed-to-needs_attention change and stream finalization. Its targeted RED specifically failed with `WEB05_REPLAY_REPORT_BINDING`; the subsequent final 19-test WEB05 scope passed. This establishes prepared reader behavior, not actual container outcomes.

### B10-R1-I4 — Resolved

`scripts/browser-evidence-readback.mjs` now requires the separate invocation's clean Source/Lab/runtime/schema identities and exact dist inventory/digest to match the long capture's final build. Before/after identities, own command/argv/exit/result hash, reporter invocation ID, a closed required case and bounded execution times are checked. Aggregate passing statistics are insufficient: the exact cell test/file/title/test ID, one expected passing result, zero retry and zero flaky/skipped/unexpected results are required.

The Lab producer fingerprints actual dist bytes, refuses symlinks/empty builds/dirty or mismatched checkouts, and records the invocation into Playwright metadata. The required case records its own run/test/invocation, DOM and screenshot hashes and capture times. The reader binds those artifacts together and checks the 390 px viewport/header observation and PNG dimensions. The separate browser flow may retain its own run ID while using the same admitted build as the benchmark. The simultaneous DOM/screenshot preparation is preserved; no actual stripe diagnosis is inferred.

The complete browser fixture passes the web-group boundary and public reader; resealed negatives reject another Lab revision at the same Source pin, another dist build, an unrelated passing test, crossed DOM/screenshot identities, failed required results, dirty Source and an absent invocation. The initial RED's last case used an unsupported invocation version; the final test now removes the invocation artifact. This change is disclosed rather than described as identical historical RED coverage.

## Test adequacy and retained limitations

The new tests materially improve the prior summary-shaped positives: WEB05 first admits replay bytes, both browser and WEB05 rebuild inventories and call the public reader, and each complete positive reaches its intended tested group. Other deliberately absent campaign groups remain unavailable; these fixtures are not complete successful qualification candidates. Assertions generally identify the affected group rather than every exact diagnostic, but the independent mutations and baseline admission are sufficient for these four fixes.

Recorded scopes remain distinct and overlapping: retained-input 4 files / 30 tests; semantic-final 5 files / 46 tests on its recorded bytes; public-green1 4 files / 52 tests; final corrected WEB05 19 tests. They are not summed. `focused-green2` requested six paths but ran five actual files / 43 tests. The transition RED's sixteen filtered tests remain not_run for that invocation.

Final-byte attribution supports the recorded Source type/lint and Lab check/type/build/targeted-script checks. It does not mean every listed command behaviorally covered each file. The unqualified lint attempt failed on retained ignored SDD bundles and an authored fixture error; the subsequent exact successful command excluded `.superpowers/**`. The later throw-in-finally and Vite HTTP union failures and corrective checks remain disclosed. No full Source CI pass is inferred.

Root's final pairing records runtime `7abb257e264d913bfc3f7a472ddf6a7368c3e5e11527fab26c8f049a51c18aac`, checker graph `60908085adb83e314a9c2de95882ac934fdbf50d9235557a8da6343593c7454f`, package manifest `28bc0b02abb06fa8089b36b9d131123b82b3ebb3d02a290e89bb62f4761cc182` and Lab dist `d75689ee933842c28ffaf39007d2f62dee0b95491db79b49e238ad1b8c342382`. Those are preparation identities, not new execution results. Historical producer/checker identities and `accepted:false` remain intact.

## Deferred disposition and Cannot verify

B10-R1-M1, the worktree-relative GTM link, remains central final-handoff triage and is not reopened as a blocker in this fix. Original positive assessments, other deferred Minor dispositions and original review limitations remain in force. I1 closes the assigned retained-input preparation defect; I2/I4 close the clock/browser preparation defects without qualifying final performance or resolving the observed stripe.

The original Cannot-verify items 1–6 remain applicable:

1. Actual Buildx/export/load behavior, image filesystem/executable operation, OCI-to-daemon association on the intended versions and host provenance.
2. Current full 19-payload/8-cell campaigns, Linux numerical/contact/fault results, actual WEB05 ownership/crash/recovery/replay and complete real-host orchestration.
3. Final production UI performance/new 180-second capture, final 390 px DOM/screenshot behavior and the stripe's cause. Portable artifacts do not authenticate browser execution or establish visual correctness.
4. Full Source CI with owned Supabase/Auth/Storage, final required Lab/browser checks and the final R-MOCK → IR-SIM → R1 → R1.1 → R2a → R2b recording/acceptance chain after reviewed tooling/L06 at a fixed tuple.
5. Authentication of copied historical execution or source-host provenance beyond the retained identities, and the entire Git graph. Byte consistency is not those proofs.
6. Final retention completeness after L06/recording, every renderer/reference-style Markdown link and clone portability of external prerequisites. The preparation snapshot remains provisional.

Approval is limited to the scoped B10 fix1 prepared tooling. It does not close WEB05, host/native, HTTPS or physical gates, complete parent B10, or change automated acceptance from `accepted:false`.
