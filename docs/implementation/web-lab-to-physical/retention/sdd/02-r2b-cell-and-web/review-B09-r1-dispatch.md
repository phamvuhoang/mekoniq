Perform a scoped B09 fix-round1 re-review, not a second full task review. Read task-B09-brief.md, task-B09-fix-1-report.md and the fix addendum to task-B09-report.md in this directory. Prior full review is task-B09-review-1.md. Verdict each I1/I2 ADDRESSED or NOT ADDRESSED, and flag new regressions introduced by this fix; untouched observations belong in a separate out-of-scope section, not a reopened full-task gate.

Global constraints verbatim:
- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

Exact FIX BASE (previously reviewed): Sourcef419bdc0ef522f037e4a7717374e9135fbe5fce8 / Lab701ad719c43572c2981a2542f4c6bbec51f656e5.
New HEAD: Source3c917ceee6a92c6b087f0bd37baaa4e0740d44a8 / Lab538ba452c81005010a479f337aab0edbad6e5159.
Complete Source fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-f419bdc..3c917ce.diff (45896 bytes).
Complete Lab fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-701ad71..538ba45.diff (3397 bytes).
Root handoff gate: Root fully read fix report and main addendum, inspected actual retained logs: genuine I1 opens2 RED→7GREEN; I2 twelve invalid-state RED→13focusedGREEN; public409 refusal RED/GREEN;48related tests passed including actual Mac arm intact no-respawn. Later validated-proof const captures only typing; committed-head writer8/8 passed after it (overlaps48, not additive coverage). Sourcecontracts/lint/finaltype and cleanexport/Labimport/sync/check/type passed. Both HEADs verified clean. Actual exported runtime.mjs SHA18967bcf matches pin; schema/tools unchanged. Main report original21480B prefix SHAc3635559 independently preserved. Original static audit remains f419bdc/75beea81; no Docker/image rerun/pass. No root tests repeated..

Prior open findings verbatim:
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

Read supplied fix diffs once in bounded passes; context is the changed file view. Do not reconstruct diffs or reread changed files unless a necessary hunk is cut off mid-function; report that check. Outside-diff checks require a named concrete dependency/regression risk, one focused check per risk. Treat reports as claims and verify against code/evidence, including delayed-reclaim construction/close accounting, epoch/current-entry fencing, required-state refusal before writes/resources, intact native reclaim and unchanged ordinary runner behavior. Root has original full-review context; do not broaden into all historical/native behavior without a concrete fix regression.

Read-only checkout; no product/index/HEAD mutations, no helper agents. Do not routinely rerun tests/native/browser/container suites already evidenced. A specific unresolved code doubt may justify one bounded focused probe, with reason and exact command/output; keep scratch outside portable/tracked roots and own all cleanup. R76 container/image gate stays not_run/null and separate from actual Mac checks; do not turn deferred execution into a pass. Preserve original report/evidence identities.

Write full scoped review to task-B09-review-2.md in this directory; explicitly disposition both findings and any new fix-introduced issue by severity/file:line. Return concise verdicts/findings/report path.
