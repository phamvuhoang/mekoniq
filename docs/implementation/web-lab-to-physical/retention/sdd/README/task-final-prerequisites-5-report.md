# Final prerequisite correction 5 — implementation and evidence report

## First committed stage (2026-11-16 local)

Lab `1256cdbda12b322af925f76fe47e621c8d2d6f0d`; tree `b0e7db95477e3ef86e9403626ce2f98309f67e68`. Source remains `981e234b1a0da8c72d220445daaf780b3bf65ae4`; runtime lock unchanged. Both tracked worktrees clean at the production diagnostic. Scope is this correction only, not whole-branch approval, publication, qualification or device/native acceptance.

Raw evidence root: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-fix5-pqfmcrch`. Receipts and metadata: `.superpowers/sdd/README/evidence-final-recording/fix5/`. `commit-1256cdb.json` binds every changed file to SHA-256/final Git blobs plus full build identity. Each check receipt records argv, cwd, environment scope, actual exit/signal, complete log hash, and all Lab tracked/untracked source-file hashes before/after. All original981 reports/failures remain in place. Further report revisions are appended below.

### Recorder diagnosis and first correction

Original response listener awaited `Response.finished()` and unbounded `Promise.all(pendingHTTP)` before target closure. Existing abort-after-headers evidence proves Playwright1.64.1 can emit requestfailed while finished remains pending until closure. Existing direct-download evidence is negative: no download response entered the listener. Neither identifies the original20-minute capture's unknown pending URL.

`production-http-observer.ts` now admits requests, records response headers status, observes requestfinished/requestfailed, includes required JSON-body reads within the90s request deadline, freezes admission and drains the finite admitted set for at most10s, then removes listeners/timers. It records actual method/path/status/timing/failure/outcome; it never fabricates responseEnd. Only ERR_ABORTED GET world-display(/scene) is explicitly diagnostic optional cancellation. Every other failure, timeout, invalid body/status, and required mutation/publication failure enters errors. Action run/action/tick/revision/timing and export run/export/horizon identity remain correlated. Late body completion cannot publish after timeout/dispose.

The recorder directly uses the helper, writes `http-observations.json` on success/failure, fails required observation errors before writing finalresult, and checks unique valid publication after drain. It retains all active-window/worker/render/receipt semantics, postwindow reporting and unchanged thresholds/readers. Cleanup is attempted for browser, preview and owned runtime even if another close fails. The exported child is owned before boot completion; bounded close escalates only that child if needed, captures close failures, and records cleanup. Creation JSON read is bounded. No Source/schema/toolchain/dependency/pin changes.

Meaningful RED: `http-red` ran original listener extracted into the helper interface (before wiring the corrected helper): two actual owned HTTP+Chrome tests fail because drain remains pending for abort-after-headers and unfinished body. `http-green1` passes both. Expanded real-boundary tests cover successful control/action/publication, refused/malformed/mismatched required responses, failed mutation and target closure; deterministic tests cover stalled JSON read, no late publication, listener/timer disposal. `http-expanded`:12/12. `final-http-unit`:19/19 across observer integration/unit, run-bar English and replay transport files. Initial `typecheck-initial` found test-side EventEmitter type casts; fixed before `final-typecheck` and build (no production behavior change).

### Layout diagnosis and correction

Original paired VI coffee needs_attention runbar measured48px at1440 and98px at1024x700. The new public-component fixture reproduces98px with production markup/CSS and allowed connecting label. `layout-red2` geometry:842px bar /826px inner width; scenario180.48 +chip122.41 +mode146 +24px left gaps, right381.59 +14px between groups needs868.48px. Fixed scenario minimum and group gaps cause wrap. This does not prove an inherited runtime defect or a wrong connection state.

Only1024–1279px CSS adjusts gaps, scenario minimum and horizontal padding. Font sizes and44px touch controls stay intact; controls/status remain visible, scenario title/accessibility and all tr translations stay intact. Phone and wide layouts are unchanged. Original connecting case passes `layout-green1`; expanded longest VI and EN failed-connection words exposed same budget pressure (`layout-expanded`, `layout-expanded2` retained). Final `layout-matrix` and `final-component-a11y` pass all3locales×4actual connection states, including complete chip text, no overlapping/clipped labels, ≥12scenario characters,44px controls and keyboard focus.

`layout-red` first failed null.outerHTML due fixture readiness; it is setup failure, not semantic RED. The corrected readiness fixture produced actual98px semantic RED. No original test/threshold was loosened, skipped or overwritten.

### First-stage final checks

- Complete unchanged paired `twin-polish.spec.ts`:10passed/0failed/0skip, including original1024 row assertion.
- Complete paired `twin-runbar-layout.spec.ts`:1passed; `twin-layout.spec.ts`:9passed; `twin-transport.spec.ts`:7passed. All in `paired-layout`, actual own0/signalnull. Fresh pinned launcher/runtime and temporary journals for each file, orderly shutdown.
- Component regression plus brand accessibility:10passed/0skip, `final-component-a11y`.
- Observer/adjacent full files:19passed, `final-http-unit`.
- `final-typecheck`, `final-build`, `final-source-pin`:own0/signalnull. Build verifies22brandfiles and283modules. Expected absent-runtime proxy errors occur only in unpaired component/a11y runs, not failures of paired tests.

### Fresh production diagnostic — preserved failure, not a successful measurement

Root authorized a quiet short exact-entrypoint exported-runtime diagnostic after clean commit. Actual cwdSource command is in `production-diagnostic.receipt.json`: `perl -e 'alarm180; exec @ARGV' pnpm exec tsx ../lab/scripts/measure-cell-production.ts --exported-runtime --diagnostic --duration-ms5000 --warmup-ms1000 --out <raw>/diagnostic-capture` (receipt retains actual separated argv).

Actual start2026-11-15T22:36:41.027079Z, finish22:37:06.004255Z; exit1/signalnull. Real run `aa70ebd3-cf41-4507-b4e9-1fa484fe41ba`, capture5002.9ms,36valid actions and1publication. Export and pause completed. Required release DELETE received200headers but had actual responseEnd=-1 and did not settle before10s drain. Recorder reports DRAIN_DEADLINE and writes error/HTTP evidence, no final `actual-cell-production.json`. This is truthful incomplete measurement and proves finite failure/cleanup, not full successful integration or qualification.

`diagnostic-delete-triage.json` binds raw bytes, timing, public code facts and gaps. Actual DELETE began22:36:55.484116Z, responseStart+3.786ms. Exact headers/body/rawCDP events and exact drain timestamps were not retained in production capture; no retrospective invention. Cleanup reported completed:true/errors[], observer_end with no overflow/failure, vacant4175/4176 and no matching owned recorder/bundle process rows. No retry occurred. Root approved only a new isolated diagnostic next.

### Isolated unread DELETE response comparison

`delete-body-comparison-run` own0/signalnull, pinned Chrome157.0.8103.78/Playwright1.64.1, owned ephemeral HTTPserver, exact Source send semantics and14-byte JSON{deleted:true}. Both server responses finish; header-only fetch returns200 but request remains nonterminal/end-1 at1500ms and finished rejects only upon page.close. Consumed r.json control returns{deleted:true}, emits requestfinished, records responseEnd0.589ms and resolves finished. Exact headers (chunked), server/client events, before/after closure and cleanup are in `<raw>/delete-body-comparison/`. This confirms an unread-body lifecycle cause for that isolated reproduction, consistent with fresh production DELETE and Lab release code. It does not identify the original20min URL.

Initial `delete-body-diagnostic` failed EEXIST because wrapper and fixture chose same outputdir; no browser/server launched. This setup-only failure is retained, corrected by a new output directory, and is not semantic evidence. No Vite fixture needed because direct comparison reproduced the lifecycle distinction.

Pending at this append: root authorization for any follow-on Lab release-body consumption/validation change; no such tracked changes yet. Commit1256cdb remains intact. No full campaign, Source suite rerun, publication, main/trial/web edit, cloud/Docker/Webots probe or hardware action.

## Follow-on release integration and host sleep interruption (append)

Root authorized the small Lab release integration after reading the isolated comparison. The public production `httpTwinRuntime.exportReplay().release()` regression traverses an owned HTTPserver and browser, with actual gzip report bytes and admitted manifest. It aborts the original export signal before cleanup and calls release twice. Initial `release-red`:4semantic failures(valid response remained pending; malformed/incomplete/unfinished response silently accepted) and1passing refusal control. `release-green`:5pass after consuming and validating200 `{deleted:true}` with an independent10s cleanup AbortController and finally-cleared timer. Existing remote retarget/auth/idempotence test fixture now returns Source's real `{deleted:true}` DELETE acknowledgement instead of `{}`; its assertions are unchanged.

Self-review strengthened required DELETE evidence: malformed/incomplete acknowledgement must also be observer failure, not merely UI notice. `release-observer-red`:2semantic failures, then validation in the observer and exactlyone matching successful release required after recorder drain. Root highlighted callback ordering; `release-order-red` proved early publication-array lookup was incorrect when publication JSON observation finishes later. Identity join now occurs only in recorder after complete drain; helper records validated DELETE run/export identity independently. The deterministic order test proves drain waits for delayed publication. Its2excluded tests are not_run in that targeted RED; final complete unit files include them.

Final changed helper/controls tests and build: `final4-unit`49passed; `final4-build`passed including full tsc. Final product/CSS complete paired `final3-paired-layout`27passed/0skip; `final3-release-component`15passed (public release5 + component1 + accessibility9). Later helper-only ordering adjustment has no UI bundle impact; `final4-release` was the required final helper+release integration rerun.

`final4-release` FAILED:4passed and unfinished-body case exceeded30s test timeout. Actual receipt22:46:47.960→23:03:33.525Z (~1005s), own1/signalnull despite outer Perl120. It is not a normal bounded successful run. No subsequent capture or commit had started. Root interrupted only the unresponsive agent turn; no OSprocess was signaled. On resume23:09:15Z all3tool sessions were settled;4175/4176vacant and no matching recorder/rawroot/bundle process commands remained. HEAD remains1256cdb with6intended follow-on paths dirty.

Read-only `pmset -g log` (20s subprocess timeout, actual1.516s own0) confirms host entered Sleep at local05:47:00+0700 for992seconds and DarkWake at06:03:32+0700, exactly inside the failed run. This supports host sleep as the source of wall-clock inflation; the failed test remains failed, and no timer result is inferred as pass. All140timestamped rows from05:40–06:10 and receipt/full-output digest are under raw/sleep-wake-audit. No OSsettings changed. Root is coordinating a justified unchanged-file rerun with caffeinate-dims and the unchanged Perl120 bound; no blind retry or bound extension.

## Final frozen handoff — scoped correction complete (append)

The independent awake rerun `final5-release-awake` passed5/5 in13.5s, own0/signalnull, unchanged test/product bytes and unchanged Perl120 bound under `caffeinate -dims`. The unfinished body case reported the intended10s cleanup failure (10.3s test). Earlier sleep-overlap4pass/1timeout remains a failed invocation. No threshold or timer was increased. Correction to earlier prose: JSON `{"deleted":true}` is16bytes, not14; raw fixture bytes/digest were always retained correctly.

Final Lab commit `d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6`, tree `c6b68cc8e780b59b5f52ad3eb6063d3a5c9041d6`; first commit1256cdb is preserved, followed by the release acknowledgement commit. Source `981e234b1a0da8c72d220445daaf780b3bf65ae4`, tree `0f00b40f4cdff7ea8acb08db7901b119beee9216`, and exact Lab runtime pin remain unchanged. Both tracked worktrees are clean. `final-identity.json` binds all9changedfiles to final Git blobs and SHA-256; `precommit-final-byte-binding.json` proves all9final files equal before+after bytes checked by final4-unit, final4-build, and final5-release-awake. Final product/CSS bytes also equal both sides of final3-paired-layout. No dependency installation, package/lock upgrade or Source tracked edit occurred.

Full changed-file list:
- `scripts/measure-cell-production.ts`
- `scripts/production-http-observer.ts`
- `src/scenarios/controls.ts`
- `src/styles/main.css`
- `tests/e2e/replay-release.spec.ts`
- `tests/e2e/run-bar-compact.spec.ts`
- `tests/integration/production-http-observer.test.ts`
- `tests/unit/production-http-observer.test.ts`
- `tests/unit/twin-runtime-remote.test.ts`

Actual final diff is `fix5/final-lab.diff` (root independently owns its separate fullb0f..d4c3032 review package). Self-review covered the entire final implementation/test diff: finite admission/drain/disposal; no late body publication; strict failed/aborted/timed-out mutations; bounded consumed release acknowledgement; captured old target/auth/CSRF/idempotence preserved after retarget and aborted export; publication/release joined only after asynchronous observers drain; medium-width-only CSS with labels/touch/focus preserved. No expected failure is deleted or converted into pass. One administrative add/commit command accidentally ran at workspace root and returned not-a-Git-repository with no mutations; actual intended commit ran in Lab.

Final meaningful verification (all full files except explicitly named REDs):

| Receipt | Final observed outcome | Relevant binding |
|---|---|---|
| final4-unit |49passed/0failed/0skip across5files|final helper/controls and complete tests|
| final5-release-awake |5passed/0failed/0skip|actual public production release + real owned HTTP/browser; original deadlines|
| final3-paired-layout |27passed/0failed/0skip: polish10, runbar1, layout9, transport7|all final product/CSS bytes; original paired polish test unchanged|
| final3-release-component |15passed/0failed/0skip|release5, compact component1 (3locales×4connection states), accessibility9; final UI bytes|
| final3-typecheck |own0|explicit pnpm typecheck|
| final4-build |own0; includes final full tsc/check-brand/build|all9final file hashes match; final built asset identity below|
| final3-source-pin |own0|unchanged Source981/runtime/schema/native/portable pin|
| production-diagnostic-final |own0/signalnull, finalresult written, cleanupcomplete|new clean d4c3032 tuple;5seconds only|

The earlier final3-release-component helper callback-order implementation was subsequently corrected; final4-unit includes deterministic late-publication coverage, and final5-release-awake reruns complete release file on final helper bytes. No need to repeat unrelated product layout suites after this script-only ordering correction. Source's full suite was not rerun because Source tracked bytes and runtime closure are unchanged.

Fresh final production diagnostic: actual2026-11-15T23:12:24.976812+00:00→2026-11-15T23:12:41.185502+00:00,16.209s invocation, own0/signalnull, caffeinate-dims with unchanged Perl180 wrapper. CwdSource; exact separated argv is in receipt/summary. Run `53b44b56-feb1-443b-90f9-e548d5ba7d76`; active capture5001.800ms;37correlatedactions/1publication; successful matching DELETE200 has actual responseEnd6.589ms and run/export identity. `errors:[]`; Source clock-correlation checker completed without throwing. Raw result/export/screenshots/HTTP observations and child output remain under `diagnostic-capture-final/`. `cleanup.json` completed:true/errors[]; observer_end3226records, nooverflow/failure. Postsettlement4175/4176vacant and no matching owned recorder/bundle commands. The new temporary runtime journal `/tmp/b07b-native-production-vkWTL4` is retained, not committed.

Final build SHA-256: `2c1e9f307b7727c074eb160ff396251af295a520fc7884237fd752903975212e`. Full dist file identities and clean Lab/Source tuple are in final-identity.json and actual build-identity.json. Lock identity: runtime `8eb11109765263e0b209ece7649bb511b8f67a0c0a035edba1d78b803d4ceec1`, schema `0d4ae124258123d27a21b67a8441dee13d703fd5ab7596ad298bcab9233a31e5`. Exact native/portable identities are retained in the unchanged lock and final-identity.json.

Residual limits and handoff boundaries: this is scoped correction validation, NOT whole-branch approval or R2b qualification. The5s production record is `accepted:false`; durationMet:false and displayMet:false (render interval p95≈200.8ms), so it cannot establish the>=180s/33ms/15ms/500ms qualification. Full appropriate fresh Lab-bound campaigns/browser/benchmark evidence remain the recording agent's work after independent review. The original20min pending URL is still unknown; fresh1256DELETE failure and isolated unread-body reproduction are separately bound, not retrospectively assigned to it. Native/device/hardware gates, WebotsSCREEN_LOCKED and Docker admission remain external not_run. No publication, push, merge, deployment or hardware/outreach action occurred.

Known reuse: existing pinned Node24.22.2/pnpm10.32.1, Chrome157.0.8103.78/Playwright1.64.1, existing Lab node_modules/runtime closure and Source Python3.11 worker environments were reused with PYTHONDONTWRITEBYTECODE=1/PYTEST_ADDOPTS=-p no:cacheprovider; nothing installed or upgraded. Paired browser tests each used fresh owned launcher journals and real pinned mock runtime. Real production diagnostic reused committed Source/exported runtime/serve fixture and existing MuJoCo tools; synthetic HTTP/gzip report fixtures establish observer/release behavior only. Deterministic EventEmitter/body promises isolate timer cleanup and callback order. Forced runtime-close escalation/bootstrap-failure branches were self-reviewed but not fault-injected; actual cleanup is demonstrated on both failed1256 and successfuld4c3032 recorder paths.

Evidence navigation: `raw-index.json` exhaustively lists136raw files with bytes/SHA-256; individual `*.receipt.json` retain exact commands/cwd/env/own exit/signal and before/after bytes. `original-layout-retention.json` confirms all11original audit-bound layout evidence files retain their original hashes. `diagnostic-delete-triage.json`, `final-diagnostic-summary.json`, `sleep-wake-audit/` raw primary log/receipt and the two build identities preserve the failure→diagnosis→correction sequence. All original logs/reports/failed screenshots remain untouched. Root owns final independent review and recording resumption; implementer is frozen with no remaining authorized code/test/capture work.
