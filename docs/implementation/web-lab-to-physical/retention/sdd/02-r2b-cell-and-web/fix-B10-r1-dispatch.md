You are the original B10 implementer returning for fix round1/5. Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B10-brief.md, including R90/R91/R92 and the final sequencing, then your complete report and the complete task-B10-review-1.md. Root read all20,947review bytes (SHA256 ec17f999ce8a2585dc0d6b4a0bb67051d81bb6ef373fcf23521f91e2a494c74a) and independently confirmed the named code/producer boundaries.

FIX_BASE: Source09b06bee0559c31087d478e5a4c4f28e4832a3cd / Labd12c04a467ef084a991cfb17ff280d55f0c49dc2, both clean. Original B10 bases remain9fdf4f3/b4a9d34; scoped fix review will use FIX_BASE. Use only the existing isolated worktrees. One implementer, no helpers/reviewers. No Docker probe/build/container, cloud/native/physical execution, push/merge/deploy or original-main changes. R76 final prerequisites remain deferred; no new actual browser/performance/full qualification run in this fix round. Root does not modify product code.

Fix exactly the four Important findings below; verbatim report text follows.

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


Root implementation constraints and review dispositions:
- These are locally actionable producer/reader preparation defects. Correct both sides and the public verification path; do not satisfy them with new asserted summaries/booleans or weaker fixture-specific checks. Keep every existing historical evidence byte and producer/checker identity unchanged.
- Write behaviorally relevant REDs before corrections. Establish a fully coherent complete positive fixture at the affected boundary, then independent coherent mutations with hashes/upstream admission maintained. The missing-module/export REDs from task creation are not prior semantic-bypass evidence. Explicitly identify the reader/guard reached. Preserve diagnostic specificity; missing action/worker/window observations are unavailable/failed, never synthetic zero metrics.
- I1: declare all consumed external corpus inputs including the old exact expected manifest, with provenance and digest. No absolute fallback. Verify the retained suite against declared prepared inputs; ensure hidden workstation paths are not consulted, without moving/deleting any shared original recording. Preserve the independent portable-reader suite. Record explicit missing/wrong expected-manifest refusal.
- I2: preserve clock domains, actual full-cell/active drawing observations, Source progression, unique action/response correlation, final horizon/receipt and pause boundary. Account for genuine trailing in-flight observations explicitly without relabelling them inside the active window. Review the exact startWall+(atEpochMs-startEpoch) conversions already named. Browser receipt is still an upper bound, never internal Source commit time. No new UI budget inferred by this fix; the established <=33ms draw, <=15ms worker, <=500ms last-step receipt budgets remain. Test the exact reviewer record plus independently resealed/consistent negatives.
- I3: use one authoritative manifest or exact binding of both; inspect the opened package's captured report/run/horizon/tuple. Bind the separate finished replay and active recovery run in the same invocation with explicit identities. Record actual command/HTTP observations for ownership/crash/recovery/state/worker outcomes, redacting secrets at source; test failed outcomes with coherent inventories. Missing image/host remains not_run, and synthetic fixtures are only reader tests.
- I4: clean Source/Lab/runtime/build and closed required browser-case identity must bind the browser invocation, DOM, screenshot and its own run. The 390 flow can have a different run from the long capture, but must belong to the same admitted final build. Reject an unrelated passing test or another Lab revision on the same Source pin. Retain simultaneous DOM/screenshot preparation; no inferred stripe cause/actual browser pass.
- Minor B10-R1-M1 is recorded centrally for final documentation handoff, not included in this Important fix loop. Other existing deferred Minors retain their prior final-triage disposition. Cannot-verify items1–6 remain final-stage/external scopes; do not claim host/native/fullGit authenticity from byte consistency.

Keep task-B10-report.md append-only. Root saved its original21,373B prefix SHA256 b35bd23adb15ade9869c568108eae1585b4e5ac8c286acc58a0e6a55f8843e78 to evidence-B10/fix1/pre-fix1-report.md, identity JSON adjacent. All original469toolingfiles and83smoke files are already indexed in root-B10-evidence-file-index.json and root-B10-smoke-27d6be9-file-index.json; preserve them, original/tmp evidence, old exports/caches and historical local smoke unchanged. New fix evidence uses fresh evidence-B10/fix1 paths. No evidence retagging or rerun solely for metadata.

Checks: Node24.22.2/pnpm10.32.1, existing interpreters only; bytecode/cache disabled for Python. Preserve every check's own exit/argv/env/log/hash and before/after checked bytes. Run focused affected suites and required type/lint/build checks; do not broaden/repeat passed suites without a changed-byte dependency or unresolved concern. No masked shell exits. Final source tool/runtime/schema change requires clean Source commit/export in a unique new directory, Lab import/sync/check/type and pin commit, with package/checker graph identities for the new current adapter bytes. Keep old tuple packages intact. FullCI/final recording follows reviewed L06.

Append full fix report with finding-by-finding disposition, genuine RED/GREEN commands/results, observed failures, tested-byte attribution, clean Source/Lab/export/package/checker identities and remaining limits. Return DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT with concise commits/checks/report link. Root owns one fresh scoped fix review; do not repeat fulltask review or the wholebranch review.
