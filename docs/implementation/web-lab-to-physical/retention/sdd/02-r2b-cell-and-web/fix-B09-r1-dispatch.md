You are the original B09 implementer. Fix round1/5, both Important findings from full task review. Read task-B09-brief.md (R63–R76), your task-B09-report.md and complete task-B09-review-1.md; the exact open findings are copied below. Source FIX BASE f419bdc0ef522f037e4a7717374e9135fbe5fce8 / Lab FIX BASE701ad719c43572c2981a2542f4c6bbec51f656e5. Work only in existing feature worktrees. B00R2 has not started. No helpers/reviewers.

### I1 — Re-resolve and reserve cold reclaim ownership after asynchronous admission

**Location:** `packages/lab-runtime/src/v2/gateway.ts:287`, `:307`, `:314`, `:320`, `:326`, `:330`.

The handler snapshots `entry` before awaiting the reclaim body and disk lookup. The cold path later decides whether to open a runner and whether to use a queue from that stale snapshot. The `reclaiming` flag only covers the work currently executing; it cannot detect another reclaim that completed while this request was awaiting its body.

Concrete interleaving:

1. A reaches a cold run with `entry === undefined`, then waits for its request body.
2. B reclaims the same run to completion and installs its runner in `runs`.
3. A's body arrives. The active reclaim flag has cleared, but A still uses its captured `undefined` entry, opens a second runner, and replaces B's map entry.
4. Shutdown closes only the second runner. B's runner is no longer tracked.

The bounded protocol probe below reproduced **two HTTP-handler 200 outcomes, two factory opens and only one close**. This is an ownership bug even though R75 prevents a replacement physical world: the first retained runner's Source/file resources are orphaned. It also creates independent per-entry queues for the same logical run; work admitted on the displaced entry can overlap the replacement's recovery. The data-root lease cannot be described as covering *all* owned run resources through close when a resource has been lost from the map.

The stale lookup seam predates this change, but B09 explicitly owns reclaim execution ordering and complete process/resource ownership; the new per-entry queue does not close the cold case. This is an in-scope requirement failure, not a demand to rewrite unrelated code.

**Required change:** reserve/serialize by run ID before selecting the live entry, re-resolve it at execution, and hold the reservation through durable epoch publication and run installation. Preserve private proof validation and never replace an existing runner without owning its full close. Add a delayed-body or delayed-lookup two-reclaim regression that checks single construction, increasing epochs, current-entry checks and complete close accounting. Do not solve it by creating a second world or granting motion on reclaim.

### I2 — Validate required retained arm/world state before opening recovery resources

**Location:** `packages/lab-runtime/src/v2/scenario-runner.ts:129`–`:131`, `:183`, `:203`, `:216`; dependency `packages/lab-runtime/src/v2/checkpoint.ts:4`.

The new reclaim guard checks only that a checkpoint exists and, for a shared world, that `cp.world` is truthy. It does not validate the required retained coffee/arm state. `readCheckpoint` only JSON-parses; the manifest hash comparison validates the saved manifest identity, not the checkpoint's state fields.

An otherwise identity-matching arm checkpoint with its `coffee` member missing passes the new guard and skips the entire `if (c.coffee)` attachment branch, including the frozen arm ports and `RECLAIM_PLANT_UNAVAILABLE` marking. It can therefore enter recovery without the required arm state rather than refusing before Source opening/persistence. Similarly, `world: {}` satisfies the new world presence test even though its retained snapshot/identity is absent; the retained-world branch treats the object as a restart and skips retained arm-report reconstruction when its snapshot is absent.

R75 explicitly requires missing required retained state to fail closed. The existing new test deletes the whole `cp.world`, which catches only the easiest case; the actual arm test checks an intact checkpoint and cannot establish this failure boundary. This finding is from code inspection, not a new native run.

**Required change:** validate the minimum retained state appropriate to the admitted arm/world profile before constructing Source/plant/recovery objects or writing a checkpoint. Distinguish legitimately unavailable historical coverage from absent required state, return a stable recovery refusal, and preserve the original bytes on refusal. Cover missing coffee/arm state and missing required world snapshot/identity, while retaining ordinary direct-runner reopen compatibility outside explicit `reclaimOnly`.

The full review retains the exact bounded I1 protocol probe/observed opens2/closes1. Turn the failure into a meaningful deterministic regression with assertions and complete owned cleanup; do not count expectation labels as assertions. I2 must reject incomplete required retained arm/world state before resource creation/persistence; keep legitimately unavailable historical report coverage distinct from required state and preserve direct-runner behavior outside explicit reclaimOnly.

Use failing tests first, preserve RED/failed attempts, then focused GREEN. Relevant tests: tests/security/lab-run-writer.test.ts, tests/integration/lab-runtime-persistent.test.ts, tests/unit/world-runner.test.ts; existing affected mobile recovery cases only as needed if that seam changes. Cover delayed-body/lookup reclaims, epoch/current-entry/close accounting and refusal with unchanged original state bytes. Retain actual intact Mac arm cold/repeated reclaim/no worker respawn verification for the amended recovery boundary; no B06/native campaigns, browser or repeated stalled Docker probes. R76 remains image null/WEB05not_run; no relaxed checks or success substitution.

Self-review the complete FIX BASE→newHEAD diff. Run focused related authority/recovery/shutdown regressions and required type/lint/contracts. Source commit→cleanexport→Labimport/sync/check/type/pin because runtime changed. No historical recording/database mutation; disposable test roots and exact-owned process cleanup only. Use Node24.22.2/pnpm10.32.1, portablePython3.11 with bytecode/cache disabled, effective bounded commands. Do not alter original report prefix or previous evidence identities.

Write task-B09-fix-1-report.md with each finding disposition, exact changed boundaries, RED/GREEN commands/output, retained logs, actual-versus-double evidence, code/export/pin identities, failures/limits/self-review. Append concise dated fix addendum to task-B09-report.md, preserving original bytes/prefix. Return status, commits, testsummary, concerns/reportpath under15lines. Root supplies scoped re-review after handoff; no new whole-task review or helpers.
