# Task B00R review 2 — fix round 1

## Spec Compliance

- ✅ **Spec compliant for this fix scope.** I1 — “Orphan children created between samples disappear from cleanup verification” — is **ADDRESSED**.
- ✅ **No new blocking breakage found** in source `b05d8a713e94084a2a6eb4cffa820f3927cdb650` → `d271a6c2f776d56e47ca98d1554ff1f13b594579` or Lab `ee72e960566830d4a30609328c6dc8b88f7e9c44` → `3675dcaf189928cad80ded733ac64838a593d2b2`.
- Review is limited to I1, behavior introduced by its correction, and the resulting export/pin. Existing unrelated observations were not reopened. Controller-provided clean checkout/commit identities were accepted; no Git commands were run.

## Strengths and finding disposition

- **I1 ADDRESSED: newly observed orphan.** A remembered PGID with no known surviving identity now latches observation uncertainty if any members remain; those new members are not inserted into the owned map. `processes()` subsequently throws instead of returning an empty family (`source/tests/support/owned-processes.ts:81–100`). This directly resolves the deterministic worker1001→orphan1002 case from review 1.
- **I1 ADDRESSED: whole worker lifetime between samples.** The local asynchronous ChildProcess birth hook records exact bundle argv and requires a PID/start observation for each matching child. An unsampled child leaves a pending or latched uncertainty, including when another historical root was sampled (`source/tests/support/owned-processes.ts:18–33`, `:49–63`). Polling supplements this lifecycle evidence rather than serving as its sole source (`:101–111`). The two short-child regression cases make the process-table snapshot deliberately omit the child, so their result does not depend on winning a timing race (`source/tests/unit/owned-processes.test.ts:107–120`).
- **Signal authority remains separate.** The uncertain PGID branch does not populate `known`; a reused leader invalidates the remembered group. The existing kill path still filters captured identities and rechecks PID/start/command before signalling (`source/tests/support/owned-processes.ts:81–90`, `:113–125`). New uncertainty and reused-group tests spy on process.kill and require zero calls (`source/tests/unit/owned-processes.test.ts:95–105`, `:122–132`). Continuing to permit a separately proven owned target while another observation is uncertain does not grant authority over the uncertain rows.
- **Observer lifecycle is bounded.** The module registry holds WeakRefs, removes dead references when dispatching, and does not strongly retain scope objects. Spawn and exit listeners are one-shot; matched births are removed at exit. Callback sampling errors latch uncertainty rather than escaping the diagnostics callback (`source/tests/support/owned-processes.ts:22–33`, `:49–59`). The polling interval is unref’d and cleared in finally (`:105–108`). An operation failure still fails the operation; it cannot produce successful cleanup certification.
- **Supported execution scope is explicit.** The helper rejects a registered root observed under an external creator, so a sampled direct root cannot certify an indirectly created worker (`source/tests/support/owned-processes.ts:75–77`; regression `source/tests/unit/owned-processes.test.ts:135–142`). It rejects Node versions other than 24.22.2 (`source/tests/support/owned-processes.ts:45`), matching `source/.node-version:1`. This is appropriate for the experimental lifecycle event used by this test-only helper.

## Issues

### Critical

None.

### Important

None remaining in this fix scope.

### Minor / non-blocking ledger

- The helper intentionally supports local asynchronous roots on Node 24.22.2. A future synchronous, subprocess, or worker-thread creator needs explicit lifecycle integration and regression evidence before relying on this helper for complete observation; the current affected call paths use direct asynchronous spawn. This is a documented boundary, not new breakage in this correction.
- Historical global-kill interference remains unknown. Neither this fix nor later passing tests proves that unrelated qualification workers were untouched. No historical evidence was changed by this review.

## Checks

- Read the appended fix report and both supplied fix diffs once. No broad branch review, subagents, suite reruns, real workers, signals, or checkout/index/HEAD changes occurred. The only write was this ignored report.
- **Named risk: lifecycle event availability under the exact supported Node pin.** Read the local Node 24.22.2 builtin `internal/child_process`: its `child_process` diagnostics channel publishes `{ process: this }` during ChildProcess construction (builtin lines 68 and 338). The subscriber attaches a spawn listener before asynchronous spawn delivery; the generic short-child tests exercise delivery under that exact interpreter. No web lookup or new process probe was needed.
- **Named risk: the batch worker creator is outside the hook’s scope.** Focused call-site inspection confirms `source/packages/lab-runtime/src/v2/navigation2d/batch.ts:284` directly invokes createFixedStepScenarioRun, and the shared worker client calls asynchronous spawn with detached:true (`source/packages/lab-runtime/src/v2/navigation2d/worker-client.ts:55`). No batch rerun was performed.
- Read retained GREEN summaries: ownership **12 passed** (`evidence-B00R/b00r-fix1-owned-green.log:16`); exact Webots worker-kill **1 passed / 6 filtered** (`b00r-fix1-webots-kill.log:11`); exact MuJoCo worker-kill **1 passed / 10 filtered** (`b00r-fix1-mujoco-kill.log:14`). Filtered cases remain not_run. Searched these logs plus fix typecheck/lint logs for warnings/errors; no matching warning/error output was present. No uncovered doubt required another behavioral probe.
- **Named risk: final export/pin identity.** Independently SHA-256-hashed `/tmp/mekoniq-r2b-b00r-fix1-export-d271a6c-20261114/runtime.mjs`: `9e68fb4185d0c0a1f1ee49fc01eb8919ee0ef183f64f418baa3542c0592f3606`, matching both manifest and Lab lock. Manifest is dirty:false and names source `d271a6c2f776d56e47ca98d1554ff1f13b594579`; Lab sourceCommit matches. Portable closure matches the unchanged lock digest `9d0bc3c05291c2dbb770dceaf41373b167c747fe43523829513de95b1653445b`; native closure remains `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7`. The Lab diff changes only source/artifact identities and the two generated provenance headers (`lab/config/source-runtime.lock.json:7`, `:15`; `lab/src/shared/engineering.ts:1`; `lab/src/shared/navigation2d.ts:1`).

## Assessment

**Finding verdict:** I1 ADDRESSED.

**New breakage:** None found within the correction.

**Spec compliance:** Approved for B00R fix round 1; review 1’s sole Important finding is closed.

**Task quality:** Approved.

**Reasoning:** The fix fails cleanup verification when observation cannot establish continuity, while leaving uncertain or reused group members outside signal authority. Per-child lifecycle evidence closes the polling gap for the actual local asynchronous worker paths, with focused negative tests and the two affected native worker-kill checks retained as evidence.
