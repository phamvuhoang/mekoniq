You are re-reviewing one task's fix round. A previous review produced
findings; an implementer has attempted to fix them. Your job is to
verdict each finding and inspect the fix diff — nothing else.

## The Task

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07a-brief.md

## The Findings Under Verification

#### Important (Should Fix)

1. **Enforce role/media-type compatibility and verify every admitted asset.** `source/packages/lab-runtime/src/v2/replay/reader.ts:32` (synced `lab/src/reports/replay-package.ts:33`), with manifest admission at `reader.ts:17`. Every NDJSON asset is skipped during the initial pass unless its role is navigation; only stream-referenced world/physics chunks are read later. A trace/model/profile NDJSON asset therefore survives open without any bytes, digest or structural check. Likewise, a model JSON labeled `text/plain` is loaded but bypasses `checkAssetDependencies`. The schema allows both combinations. A focused probe opened a package with an NDJSON trace whose hashes were all zero: the callback was invoked only for report.json. A second variant opened a hash-valid model.json containing an external texture URL when its media type was text/plain. This breaks the advertised eager integrity/dependency boundary before B07b receives the package. Add a closed role/media-type matrix (and supported format/path checks where relevant), reject unsupported combinations before reading, and ensure every admitted asset receives the required hash/content checks. Add regressions for both demonstrated variants; existing external-URL tests only cover application/json models (`source/tests/unit/web-replay-reader.test.ts:10`).

2. **Dispose owned reader state when its external signal aborts after open.** `source/packages/lab-runtime/src/v2/replay/reader.ts:25`, `:41` (Lab `:26`, `:42`). The external abort handler only calls `controller.abort()`. Cache/report clearing and listener removal occur only in `close()` or the opening catch block. Thus aborting an already opened reader leaves its captured report and any cached decoded rows retained, despite the documented cancellation cleanup contract. The focused probe opened a report-only package, aborted the supplied signal, and read the original nonempty `capturedReport` afterward. Use one idempotent disposal path for close and external abort, clear owned cache/report immediately, and check cancellation before publishing a successfully opened reader. Add post-open/post-sample abort coverage; current cancellation tests abort during loading (`source/tests/unit/web-replay-reader.test.ts:9`, `lab/tests/unit/replay-package.test.ts:9`). Caller-owned returned samples can remain the caller's responsibility.

3. **Bound concurrent indexed downloads through their response lifetime.** `source/packages/lab-runtime/src/v2/gateway.ts:199`, allocation in `source/packages/lab-runtime/src/v2/replay/export.ts:26`. Each authorized GET independently reads a complete asset into a Buffer (up to 8 MiB), hashes it and passes it to `response.end`. There is no read admission or aggregate outstanding-byte bound, and slow sockets can keep those buffers queued after the handler returns. The two-active limit at `v2/gateway.ts:187` applies only to captures/exports; eight stored versions does not limit requests for one version. The parent HTTP dispatch also forwards requests without a read cap (`source/packages/lab-runtime/src/gateway.ts:78`). A normal parallel asset downloader or repeated slow downloads can therefore grow runtime memory/work independently of all declared package limits. Add a small explicit process-wide active-download/byte budget, reserve after private owner checks and before allocation, refuse excess work without an unbounded queue, and retain the reservation until finish/close and owned IO cleanup. Cover concurrent held reads, client disconnect, and private 404 precedence. This is B07a resource admission, not B07b browser performance or B09 cross-process locking.

4. **Allow the new version DELETE operation through browser CORS preflight.** `source/packages/lab-runtime/src/v2/gateway.ts:196`; dependency `source/packages/lab-runtime/src/gateway.ts:74` advertises only `Access-Control-Allow-Methods: GET, POST`. The Lab at port 4175 and gateway at 4176 are different origins, so browser DELETE requires a preflight that currently omits DELETE. Node fetch tests invoke DELETE directly and do not enforce browser CORS (`source/tests/security/web-replay-gateway.test.ts:24`). Consequently the promised browser cleanup operation fails and the viewer reaches the two-version limit despite attempting deletion. Add DELETE for this supported v2 replay route while preserving origin, owner and CSRF checks, and test an OPTIONS request with `Access-Control-Request-Method: DELETE` followed by the authorized DELETE.



## The Fix

Read the implementer's report (fix reports are appended at the end):
/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07a-report.md plus /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07a-fix-1-report.md

**Fix base:** Source a5b2ee0fb1d5f3799aca774d7930d66985a30321 / Lab57d9c869387f408603645becb502dea394d8e2fe (the head the previous review saw)
**Head:** Source5e09a48d4a8625276495694b1a29c04679bc6a77 / Labbe01048a9d1e642cd77cecab99e7a24d2d0368bb
**Diff file:** /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-a5b2ee0..5e09a48.diff and /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-57d9c86..be01048.diff

Read the diff file once — it contains the fix commits, a stat summary,
and the fix diff with surrounding context. Do not re-run git commands.
If a supplied fix diff is missing, report that to root rather than replacing the scope with another commit range.

Your review is read-only on this checkout. Do not mutate the working
tree, the index, HEAD, or branch state in any way.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn a subagent to review part
of the diff, and never spawn another reviewer for a second opinion.
This process already provides every review seat the work gets; a
reviewer you spawn duplicates one of them at full cost, and its
verdict counts for nothing. If the diff feels too large for one
pass, review it in passes yourself and say so in your report.

## Scope

Your scope is the findings list and the fix diff. Verdict every finding.
Inspect the fix diff for new problems the fix itself introduced. Do NOT
re-review code the fix did not touch: if you notice an issue entirely
outside the fix diff, report it under Out-of-Scope Observations — it
does not block this task and does not extend the loop. A broad
whole-branch review happens after all tasks are complete.

## Tests

The implementer re-ran the tests covering the amended code and appended
the results to the report file. Treat the report as unverified claims:
confirm the fix report names the covering tests and shows their output,
and verify the claims against the diff. Do not re-run the suite to
confirm their report. Run a test only when reading the code raises a
specific doubt that no existing run answers — and then a focused test,
never a package-wide suite.

## Output Format

Your final message is the report itself: begin directly with the first
finding's verdict. Every line is a verdict, a finding with file:line,
or a check you ran — no preamble, no process narration.

### Finding Verdicts

For each finding in The Findings Under Verification, in order:
- **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line
  evidence. "Attempted" is not addressed: the specific defect must no
  longer exist.

### New Breakage in the Fix Diff

Anything the fix itself broke or introduced, with severity
(Critical/Important/Minor) and file:line. "None" if clean.

### Out-of-Scope Observations

Issues you noticed entirely outside the fix diff. Non-blocking; the
controller ledgers these for the final review. "None" if none.

### Verdict

**Fix round:** [All findings addressed, no new Critical/Important
breakage | Findings remain open] — list the open ones.
## Global Constraints

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


## Fix-specific scope and report
Read fix brief `task-B07a-fix-1-brief.md` adjacent to task brief for R62 exact read admission/lifetime policy; it amends I3 without reducing the finding. The previous full reviewer already read the full B07a change. This pass verifies I1–I4 and new breakage in the FIX diff only. MinorM1 hardcoded retained/tmp inputs is deferred for final whole-branch review, not part of this Important fix round. Whole-platform oldgoldens/native behavior are cross-task baseline/final qualification, not proved by a portable reader/gateway change. Existing actual retained packages must still read exactly; no new physical campaign is required.

Read both fix packages once in bounded passes, no broad unchanged-code recrawl or routine test reruns. For a concrete unresolved fix risk, one focused boundary dependency/probe is allowed; name why and what it checked. No helper agents. No native/cloud/hardware execution, product/Git/index/branch mutations or original-evidence writes/SQLite connections. Write only the ignored review report below; keep any necessary probe executable outside portable roots and .superpowers. Existing reported checks include commands/output; inspect them instead of repeating.

R62: at most4active indexed reads and16MiB admitted encoded bytes process-wide, after private ownership/version/index validation and before allocation, no unbounded queue. Reservation lives through both owned IO and response finish/close, including disconnect. The budget does not claim a total JS heap bound. Verify actual lifetime and tests, not just a counter around readFile. I4 preflight permission applies to the supported replay version DELETE route while preserving origins/auth/CSRF/reclaim. I1 matrix/verification must preserve real package compatibility; I2 close/externalabort owns the same idempotent cleanup through open+sample races.

Write full review to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07a-review-2.md and return findings1–4 ADDRESSED/NOT ADDRESSED with file:line, newfixbreakage/outofscope and finalroundverdict.
