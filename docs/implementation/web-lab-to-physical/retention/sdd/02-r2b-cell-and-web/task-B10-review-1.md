# B10 tooling — independent spec and quality review 1

Reviewed Source `09b06bee0559c31087d478e5a4c4f28e4832a3cd` and Lab `d12c04a467ef084a991cfb17ff280d55f0c49dc2`, against original bases Source `9fdf4f382c19d6dbbc3cf64c231561ced71e786d` / Lab `b4a9d34f0881b05a76078a5d2b3ce2c189b654a6`.

**Prepared-tooling spec verdict: FAIL — changes required.** The closed-table/shared-core routing, production cell runner, current native adapter and OCI preparation are present. Mandatory artifact-derived web qualification and retained-input portability are incomplete in the specific ways below.

**Prepared-tooling quality verdict: REQUEST CHANGES.** Four Important findings and one Minor finding; no Critical finding. These are locally addressable preparation defects, not demands to run Docker, assign a native host, or perform the deferred final browser/qualification chain. This review does not complete parent B10, approve a release, or infer acceptance.

## Review scope and method

Read the complete task brief, including R83/R90/R91/R92 and final sequencing, the complete implementer report, all authored code/tests/runbooks in the supplied 393,578-byte Source package, all eight paths in the 47,078-byte Lab package, the 48,615-byte relative-link transformation package, and the package classification index. The three large retention JSON inventories were assessed by their complete document structure, identity/procurement semantics and consumers, using the root's independently reported byte audit for individual hash rows. The supplied original-base package remains the complete 207-path source boundary; no replacement Git diff was generated.

The 140 unchanged historical/design copies were not treated as new implementation or independently reapproved. The nine link transformations were read. Read the retained central deferred index to assess the B10 disposition; original task reports/ledgers retain authority. Root's copy/receipt/schema/closure audit is attributed consistency evidence, not code approval or host authentication.

Focused reads outside the authored diff addressed named integration risks only: native handoff export versus adapter staging; trusted bootstrap deadline/abort behavior; packaged payload setup resource paths; portability of the independently runnable replay reader tests; and production capture identity generation. These checks did not establish an additional native execution. The read-only inspection of the suspected scratch-database interaction did not establish a further defect, and no such finding is asserted.

No recorded suite was rerun, no Docker/cloud/native/physical operation was made, and no retained SQLite database was opened. No evidence or implementation was changed. The sole behavior check was an in-memory call to the new pure `assessCapture` function under Node 24.22.2, documented below. Only this report was written. HEAD reads matched the dispatch.

## Important findings

### B10-R1-I1 — Retained export regression still depends on an unconfigured workstation path

**Location:** `source/tests/security/web-replay-export.test.ts:50`; supporting `source/docs/implementation/web-lab-to-physical/retention/retained-input-catalog.json:1` and `source/docs/operations/r2b-qualification.md:55`.

The nominal input was moved to `retainedInput('cell-nominal-7')`, but the test that compares every original encoded/decoded asset hash still reads `/tmp/b07a-final-packages-ZYL6r5/nominal/manifest.json` directly. The catalog contains only the B06 nominal run and B04a cup-fall run. The preparation command cannot provision or verify this expected manifest.

A fresh checkout following the documented digest-verified corpus recipe therefore still fails the required `web-evidence` suite with ENOENT, even when both documented corpus inputs are correct. On this workstation the test can instead consume an unconfigured, unverified expected manifest. That dependency is visible as an unchanged context line in the reviewed diff; it is nevertheless part of the explicitly assigned B07a portability requirement and contradicts the new disposition/report's complete portability claim.

**Required correction:** retain the historical expected export manifest as a separately identified, digest-bound input (or an exact committed fixture with provenance) and remove the absolute fallback. Preserve the original historical bytes. Include every consumed external input in the acquisition/preparation instructions. Verify the retained suite with only the declared prepared corpus available, including an explicit missing/wrong expected-manifest refusal. The portable reader tests can and should remain independent; the focused read confirms they currently use synthetic in-memory fixtures.

### B10-R1-I2 — Performance qualification accepts missing action coverage and observations outside the declared window

**Location:** `source/scripts/browser-capture-clock.mjs:17`, `:19`, `:20`, `:24`, `:26`; public qualification caller `source/scripts/r2b-readback.mjs:55`.

`checkCaptureClock` correlates whatever actions are present but requires neither a step nor a pause action/receipt. `assessCapture` accepts `activeCellMs` and `fullCellDrawingFrames` as summary values; does not bind render events to the declared browser window; and reduces worker observations to `elapsedMs` without requiring run/tick/clock identity or active-window coverage. With zero step actions, `Math.max(0, ...[])` becomes a passing zero last-step receipt latency. Pause/UI timestamps can be unrelated to any observed pause action. These are missing-observation paths into a successful performance qualification, despite the mandatory actual-artifact requirement.

**Observed, read-only reproducer:** run Node 24.22.2 in Source with the following in-memory input; no fixtures, browser, runtime or retained files are used.

```js
import {assessCapture} from './scripts/browser-capture-clock.mjs';
const record = {
  runId: 'r',
  clock: {
    nodeTimeOriginEpochMs: 100000, browserTimeOriginEpochMs: 100100,
    startEpochMs: 100200, endEpochMs: 280200,
    browserStartMs: 100, browserEndMs: 180100
  },
  actions: [{runId:'r', actionId:'start-only', kind:'start', tick:0,
    requestStartEpochMs:100220, responseEndEpochMs:100250,
    observedAtEpochMs:100260}],
  responses: [{runId:'r', actionId:'start-only', tick:0,
    requestStartEpochMs:100220, responseEndEpochMs:100250, status:200}],
  capture: {
    elapsedMs:180000, activeCellMs:180000, fullCellDrawingFrames:1,
    renderEvents:Array.from({length:9001}, (_,i)=>({atMs:1000000000+i*20}))
  },
  workerRaw:[{elapsedMs:10}],
  pause:{clickEpochMs:280300, uiObservedAtEpochMs:1280300},
  errors:[]
};
console.log(assessCapture(record));
```

Actual result was `valid:true`, `meetsTargets:true`, `issues:[]`, with render p95 20 ms, worker p95 10 ms, last-step receipt 0 ms and pause/UI latency 1,000,000 ms. This is a demonstrated validator gap, not a claim that the real UI has that latency. Even without imposing any new UI-latency budget, the absence of step/pause evidence and the out-of-window render stream must prevent qualification.

**Required correction:** derive active/full-cell duration and drawing coverage from the retained observations; bind render and worker timestamps to explicit origins and the declared window; require actual step progression plus a unique correlated pause response and the relevant final observed horizon/receipt boundary. Missing, ambiguous, wrong-run, wrong-tick or out-of-window observations must be unavailable/failed rather than a zero metric. Preserve the distinction between receipt upper bounds and internal Source commit time. Test the demonstrated record and independent coherent mutations after establishing a valid complete fixture. Review the Lab producer's worker epoch-to-monotonic conversion alongside these checks; its existing `startWall + (atEpochMs - startEpoch)` conversion must not silently substitute a different origin for the new explicit clock.

### B10-R1-I3 — WEB05 has two unbound replay manifests and does not establish one lifecycle artifact chain

**Location:** `source/scripts/r2b-readback.mjs:63` and `:64`; producer `source/tests/integration/lab-runtime-container.test.ts:115`.

The reader compares `inputs/container/replay-manifest.json` with `finished-report.json`, but then independently opens `inputs/container/replay/manifest.json`. It never compares those two manifests or the opened package's captured report/run/horizon/source with the finished report. A valid replay package from a different run can therefore satisfy the replay check while the standalone manifest claims the required finished run. Updating the top-level artifact inventory preserves byte consistency but does not repair this missing semantic binding.

The lifecycle chain has related omissions: before/after reports need only have tick 100, without a matching run/source identity or the required recovery state; two empty committed-chunk maps compare equal; `health.json` and `image-inspect.json` need only exist; and `competingWriter`/`crash` outcomes in `web05.json` are not checked. Thus a recorded image ID need not agree with the retained image observation, and failed ownership/recovery outcomes can be ignored by the artifact reader. A green suite summary is not the mandated independent readback of those artifacts.

**Required correction:** use one authoritative replay manifest or require exact equality, then bind the verified replay package and captured report to the finished run and tuple. Bind health and observed image identity to that tuple; establish the same active run across before/crash/recovery artifacts, required recovery/worker/ownership results, and a nonempty unchanged committed chunk set. Retain the actual command/HTTP observations necessary to derive those outcomes rather than relying on newly asserted booleans. Add coherent negative fixtures for an unrelated valid replay, mismatched active run/image, empty chunk maps and unsuccessful competing-writer/recovery outcomes, with all upstream hashes intact. This can be tested portably; actual WEB05 execution remains separately not_run until its prerequisite is available.

### B10-R1-I4 — Separate browser verification is not bound to the qualified Lab build or required case

**Location:** `source/scripts/r2b-readback.mjs:57` and `:59`; `lab/scripts/measure-cell-production.ts:41`; `lab/tests/e2e/mujoco-cell.spec.ts:24`.

The long production capture's embedded `buildIdentity.labHead` is checked, but the separately produced browser result/390px artifacts are not bound to that Lab commit/build. `browser-result.json` is admitted from aggregate stats alone (`expected >= 1`, no unexpected or skipped tests), without identifying the required test or its execution/build provenance. The DOM artifact binds only Source/schema, a nonempty run ID, flow and viewport. The separate browser identity file records Source/runtime and execution mode but no Lab build, and the qualification reader does not consume it.

Two Lab revisions can pin the same Source runtime. A long capture from the requested Lab revision can therefore be combined with an earlier browser/390px capture from the other revision and still satisfy these predicates. The independent 390px flow legitimately has a different run from the long benchmark; the missing binding is to its own identified browser execution and the final Lab build, not a requirement to give both flows the same run ID. A successful unrelated browser result also satisfies the aggregate-stats predicate.

**Required correction:** give the browser verification invocation an explicit clean Source/Lab/runtime/build identity and closed required-case result, bind its DOM/screenshot/run metadata to that invocation, and require the matching final tuple in the directory verifier. Reject a different Lab build at the same Source pin, an unrelated successful test, and mismatched DOM/screenshot execution identity. Retain the simultaneous DOM/screenshot preparation already added; do not infer a stripe cause or new actual browser pass while fixing the reader.

## Minor finding

### B10-R1-M1 — One rebased GTM link encodes the current worktree nesting

**Location:** `source/docs/gtm/2026-11-14-web-simulation/01-research-and-evidence.md:66`.

The marketing-site link is rebased to `../../../../../../web/index.html`. It resolves here because the Source worktree sits two levels below the ordinary four-repository workspace. In a fresh normal layout with sibling `source/` and `web/`, this climbs two directories above the intended workspace. The current link audit establishes local existence, not the promised clone handoff portability.

Use an explicit documented checkout-layout reference or stable commit/path provenance for the separately owned web repository, and validate links against that handoff layout. Do not rewrite historical claims or copy a different marketing snapshot under the old attribution. This is nonblocking for prepared executable tooling but should be resolved in final documentation handoff.

## Strengths and requirement assessment

- The historical shared qualification core is preserved. R2b's synchronous dispatcher always requires artifact readback; recorder and acceptance use the async directory verifier. Strict `accepted:false` and null reviewer fields, closed full/mobility tables, suite/case/gate reconstruction and independent WEB06 blocking are appropriate. A missing image need not erase unrelated local group results.
- The production cell runner uses Source scenario authority and real world ports, not a test runner import. It retains a fixed three-seed/five-fault registry, world traces, request/response digests, journals, custody and uncertainty boundaries. The reader ignores an all-pass summary and opens only a temporary verified journal copy. The default world-worker path remains the production spawn; the observation seam is explicit.
- The current native path exists as an executable prepared adapter. It keeps subject/checker identities separate, requires L00 native readiness and local matching Linux/amd64 host admission, uses packaged production code by exact image config identity, and does not overlay an ambient checkout. Historical R2a policy remains separate. The R90 current per-case deadline is finite at 6,100,000 ms, while the historical public helper retains 1,800,000 ms; the current worker does not inherit the historical 25-minute abort. Named ownership checks bound container cleanup.
- R91/R92 preparation binds package/bundle labels, observer and registry identities, raw platform/config admission, OCI descriptor/blob verification and local loaded config/rootfs association. Explicit remote selectors are rejected before Docker lookup. These are useful preparation boundaries; labels remain byte binding, not independent build/host authentication.
- The owned-service design creates a unique Supabase namespace and requires a receipt plus actual named container/port validation before Wave02 mutations. It removes fallback to the developer project's credentials. Its complete real service/start/status/cleanup path remains unexecuted; portable config/target tests are not a service integration pass.
- Historical lint fixes are limited to the five frozen files' actual Node/CommonJS environment. The historical bytes are preserved. Color-policy normalization and the Lab nested pnpm/import changes are focused. Source and Lab runtime/schema pin identities are explicit.
- Retention records correctly distinguish exact historical copies from authored metadata and relative-link changes. Historical qualification/sidecar semantics are not rewritten. Documentation clearly defers final recording and preserves not_calibrated/accepted:false, native/WEB05/physical boundaries.

## Tests, claims and deferred findings

The report's 173-test earlier focused run is an earlier-byte result, not coverage of all later OCI/selector changes. The later 33/42/3/2/4-test scopes remain distinct and overlapping; no summed new total is warranted. The first seven log-only checks have no contemporaneous serialized receipts. Missing-module or missing-export REDs demonstrate creation/import failure, not a prior semantic bypass, even where grouped under “regression” in the report. Actual semantic RED/GREEN evidence must be assessed separately.

The added qualification/readback tests are strongest on closed-table/empty-record rejection and individual guard helpers. They do not establish a fully coherent public web artifact chain; I2–I4 show why summary-shaped positive fixtures and early-failing negatives are insufficient. In particular the synthetic cell negative lacks a valid campaign envelope, so its `CELL_CASE_IDENTITY` result alone does not isolate synthetic execution refusal. Keep that limitation explicit and use coherent upstream-admitted fixtures for claimed boundaries. Existing missing/corruption tests remain useful under their honest scope.

The actual nominal smoke is only Source `27d6be9`, H10850, individual 1/1, full campaign 1/8 with seven missing cases. The `af3388c` packaged readback is a later reader of unchanged evidence, not a second run. Equal final bundle bytes do not transfer producer/source/runtime/checker identity to `09b06be`. The Mac refusal used a nonexistent/unassigned handoff, subject:null and 27 not_run before Docker; it proves early host refusal only, not admission of a valid current handoff. These distinctions are correctly disclosed and are preserved here.

Deferred disposition:

- B07a M1 is **not closed** by B10; see I1. The explicit digest-bound mechanism is valuable but incomplete.
- B07b clock/window/action preparation is **not ready to qualify** until I2 and I4 are fixed. Old measurement limits remain historical. The 390px DOM/screenshot addition is prepared only; actual result and cause remain open.
- B04b/B07b warning normalization and L02 scoped historical lint configuration are addressed at the reviewed code/recorded-check scope; no historical physics rerun or evidence rewrite is required.
- L01-R1-05's 0.14 m threshold is restored with a targeted synthetic threshold regression. This does not requalify old native records under the new checker.
- B08 M1 is partially addressed: coherent goal/frame mutations now reach semantic comparison after integrity admission; broader world/adjacent-physics tests remain explicitly deferred. The nine previously reviewed profile/model fixes stay separately resolved.
- B00/B01 ledger-only review limitations, B04a verifier readability/diagnostics, B05 timeout/vendor whitespace, prior B04b report readability observations, L00 negative-fixture precision, L03 negative zero, and L04 large-trace/oracle bounds retain their existing final-review disposition. The exact copied central index is not silently treated as closure. B06's resolved report race and B09's resolved ownership/drain findings are not reopened without a new regression.
- L03 native contact/controller requirements, WEB05, HTTPS and physical commissioning are unmet external qualification scopes, not code Minor findings that can be closed by this review.

## Cannot verify from this diff/review

1. Actual Buildx multi-export/load behavior, local OCI-to-daemon association on the intended installed versions, complete image filesystem/executable operation, or host provenance. No Docker invocation was made in this review.
2. Current full 19-payload/8-cell execution, native Linux numerical/contact/fault results, all current container lifecycle/competing-writer/crash/replay outcomes, or the current adapter's complete real-host orchestration. Packaging, one local nominal smoke and portable fixtures do not establish those results.
3. Final production UI performance, a new 180-second capture, final 390px live-report replay DOM/screenshot behavior or the stripe's cause. The in-memory check establishes only I2's validator behavior.
4. Full Source CI and owned Supabase/Auth/Storage integration, final required Lab/browser checks, or final R-MOCK → IR-SIM → R1 → R1.1 → R2a → R2b candidate/acceptance chain. The reviewed sequencing correctly places these after B10/L06 tooling and a fixed clean tuple.
5. Authentication of copied historical execution records, source-host provenance beyond retained identities, or the entire Git graph. Root byte audits and this HEAD check do not supply those properties.
6. Final retention completeness after B10/L06 review and recording, every renderer-specific/reference-style Markdown link, or portability of external prerequisites not supplied by a clone. The current versioned preparation snapshot is explicitly provisional.

Fix I1–I4 and review their coherent regression evidence before approving B10 prepared tooling. Preserve the deferred execution sequence and exact producer/checker identities; do not regenerate or relabel historical evidence to make a new tuple pass.
