You are reviewing one task's implementation: first whether it matches its
requirements, then whether it is well-built. This is a task-scoped gate,
not a merge review — a broad whole-branch review happens separately after
all tasks are complete.

## What Was Requested

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-brief.md

Global constraints from the spec/design that bind this task:
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



## What the Implementer Claims They Built

Read the implementer's report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-report.md

## Diff Under Review

**Base:** Source5e09a48d4a8625276495694b1a29c04679bc6a77 / Labbe01048a9d1e642cd77cecab99e7a24d2d0368bb
**Head:** Source e07685d947bad36a175b930031e0997e2991799e / Lab 89b4a38aa4b2d9244482646565cb63a598d66902
**Diff file:** Source: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-5e09a48..e07685d.diff (157830 bytes, 3 commits). Lab: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-be01048..89b4a38.diff (995371 bytes, 5 commits). Read BOTH complete original-base diffs in bounded passes; retain pass notes if context needs compaction.

Read the diff file once — it contains the commit list, a stat summary,
and the full diff with surrounding context, and it is your view of the
change. The diff's context lines ARE the changed files: do not Read a
changed file separately unless a hunk you must judge is cut off
mid-function — and say so in your report. Do not re-run git commands.
If a supplied original-base diff is missing, report it to root instead of substituting HEAD~1 or another scope.
Do not crawl the broader codebase. Inspect code outside the diff only
to evaluate a concrete risk you can name — one focused check per named
risk, and name both the risk and what you checked in your report.
Cross-cutting changes are legitimate named risks: if the diff changes
lock ordering, a function or API contract, or shared mutable state,
checking the call sites is the right method.

Your review is read-only on this checkout. Do not mutate the working
tree, the index, HEAD, or branch state in any way.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn a subagent to review part
of the diff, and never spawn another reviewer for a second opinion.
This process already provides every review seat the work gets; a
reviewer you spawn duplicates one of them at full cost, and its
verdict counts for nothing. If the diff feels too large for one
pass, review it in passes yourself and say so in your report.

## Do Not Trust the Report

Treat the implementer's report as unverified claims about the code. It
may be incomplete, inaccurate, or optimistic. Verify the claims against
the diff. Design rationales in the report are claims too: "left it per
YAGNI," "kept it simple deliberately," or any other justification is the
implementer grading their own work. Judge the code on its merits — a
stated rationale never downgrades a finding's severity.

## Tests

The implementer already ran the tests and reported results with TDD
evidence for exactly this code. Do not re-run the suite to confirm their
report. Run a test only when reading the code raises a specific doubt
that no existing run answers — and then a focused test, never a
package-wide suite, race detector run, or repeated/high-count loop. If
heavy validation seems warranted, recommend it in your report instead of
running it. If you cannot run commands in this environment, name the
test you would run.

Warnings or other noise in the implementer's reported test output are
findings — test output should be pristine.

Evidence you cannot see is not evidence that doesn't exist. If the
report or its test evidence looks truncated, or you cannot locate the
results it claims, re-read the file at its stated path — and if it is
genuinely missing or garbled, report that as a gap for the controller.
Re-running the suite to regenerate what you failed to read is not
verification; illegibility of the evidence is not invalidation of it.

## Part 1: Spec Compliance

Compare the diff against What Was Requested:

- **Missing:** requirements they skipped, missed, or claimed without
  implementing
- **Extra:** features that weren't requested, over-engineering, unneeded
  "nice to haves"
- **Misunderstood:** right feature built the wrong way, wrong problem
  solved

If the brief lists several files each with its own change (a batched
dispatch), check the diff against that list file by file: every listed
file must have its corresponding hunk. A listed file the diff never
touches is a Missing finding, no matter how clean the rest of the
batch looks.

If a requirement cannot be verified from this diff alone (it lives in
unchanged code or spans tasks), report it as a ⚠️ item instead of
broadening your search.

## Part 2: Code Quality

**Code quality:**
- Clean separation of concerns?
- Proper error handling?
- DRY without premature abstraction?
- Edge cases handled?

**Tests:**
- Do the new and changed tests verify real behavior, not mocks?
- Are the task's edge cases covered?

**Structure:**
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this change create new files that are already large, or
  significantly grow existing files? (Don't flag pre-existing file
  sizes — focus on what this change contributed.)

Your report should point at evidence: file:line references for every
finding and for any check you would otherwise answer with a bare
"yes." A tight report that cites lines gives the controller everything
it needs.

Your final message is the report itself: begin directly with the
spec-compliance verdict. Every line is a verdict, a finding with
file:line, or a check you ran — no preamble, no process narration,
no closing summary.

## Calibration

Categorize issues by actual severity. Not everything is Critical.
Important means this task cannot be trusted until it is fixed: incorrect
or fragile behavior, a missed requirement, or maintainability damage you
would block a merge over — verbatim duplication of a logic block,
swallowed errors, tests that assert nothing. "Coverage could be broader"
and polish suggestions are Minor.
If the plan or brief explicitly mandates something this rubric calls a
defect (a test that asserts nothing, verbatim duplication of a logic
block), that IS a finding — report it as Important, labeled
plan-mandated. The plan's authorship does not grade its own work; the
human decides.
Acknowledge what was done well before listing issues — accurate praise
helps the implementer trust the rest of the feedback.

## Output Format

### Spec Compliance

- ✅ Spec compliant | ❌ Issues found: [what's missing/extra/misunderstood,
  with file:line references]
- ⚠️ Cannot verify from diff: [requirements you could not verify from the
  diff alone, and what the controller should check — report alongside the
  ✅/❌ verdict for everything you could verify]

### Strengths
[What's well done? Be specific.]

### Issues

#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)

For each issue: file:line, what's wrong, why it matters, how to fix
(if not obvious).

### Assessment

**Task quality:** [Approved | Needs fixes]

**Reasoning:** [1-2 sentence technical assessment]
## B07b review scope and concrete boundaries
This follows reviewed B06 world/custody and B07a replay package/owner endpoints/reader. Review this full B07b task range, not those prior whole implementations. Brief R64–70 govern committed world display, profiling and bounded prior-frame retention. B09 separately owns the pre-existing public gateway shutdown ordering (R63); M1 retained-test portability is deferred for B10/final review. Report concrete new breakage from B07b normally.

Inspect the new read-only Source world-display/scene capture and owner/reclaim/horizon/identity boundaries: one committed snapshot and same-H Source context, pendingH+1 exclusion, stale/unknown/reopen semantics, owned copies, no world history added to action receipts, exact immutable scene/model binding. No new motion authority or arbitrary filesystem access. Verify Lab does not mix independent Source/world horizons or let late responses mutate another run/view; current control revision remains separate from the displayed coherent frame. R66 is one bounded last-known frame, not an interpolation bridge across identities.

Offline entry must occur before runtime construction/probe/SSE/pairing; use only bounded named/local folder transport through B07a reader, fixed compressed-byte .bin aliases with unchanged logical paths/hashes, no arbitrary URL/secret/executable assets. Judge actual production/browser byte/header evidence and denial from first initialization. Model/geometry/mesh identity, free-cup pose, signed extent, static-tray-only replacement, no extrapolation/gap/current-custody invention, camera manual/phase/Overview reset, translations/a11y/2D and cleanup matter. Root performed visual inspection and byte audit; their precise scope is in report/evidence, not a replacement for code review.

Functional/visual evidence and performance evidence have separate scopes. Source original fixture/native campaigns remain unchanged recordings; direct Source-module/short profile probes are diagnostic, not clean exported-bundle production results. The final claimed workload must name its actual Source/UI hashes, exported CLI/owned observer, run/horizons/duration after warmup, full-cell presence/changing poses, raw draw/RAF/Source/worker/IO/pause timings and unmasked failed attempts. Wire ACK timing does not prove Source commit. Actual render intervals, render CPU and filtered RAF intervals are different; on-demand rendering may have a slower cadence. Any proposed target not met must remain failed/unmet, never relabeled via idle padding/synthetic renderer/artificial redraw or requested1x versus achieved pacing.

Binding spec performance paragraph (02-r2b-web-lab-spec.md):
> Performance targets là **tiêu chí đề xuất**, chưa đo: preset cell 1440×900, display frame p95 ≤ 33 ms trên máy ghi; worker+IPC tick p95 ≤ 15 ms để còn ngân sách 1×; pause tới tick cuối ≤ 500 ms tại 1× trên mạng kiểm; mỗi view đóng phải giải phóng geometry/material/listeners. 390 px dùng panel dưới và 2D fallback. Đo ít nhất 3 phút sau warm-up, ghi CPU/browser/DPR/RAM/mạng và dropped samples. Nếu không đạt thì ghi fail/giảm preset có revision; không gọi nội suy 60 FPS là physics 60 Hz.

Review is read-only except writing the ignored report. No helper agents, product/Git/index/branch changes, native/cloud/hardware execution or original-evidence/SQLite writes. Read full diff in bounded passes, no broad recrawl/routine suite/browser/native/performance reruns. A concrete unanswered changed-boundary risk permits one focused dependency check/probe; report exactly why and what. Check report commands/output and inspect artifacts already supplied rather than regenerate evidence. Root will adjudicate cross-task cannot-verify items and any plan conflict.

Write full spec-compliance AND task-quality review with file:line findings/severity to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-review-1.md. Return concise verdict/findings; do not omit either verdict. 

R67 adds Source-synced ReplayReader.readStoredAsset for ZIP output. Existing readAsset is decoded; verify same admitted-path serialized bounded encoded+decoded checks/abort/close lifecycle, no raw bypass/recompression, exact gzip+identity stored bytes and genuine H7 ZIP/import evidence. Prior H7-caption fix had a failed build and stale-dist browser attempt; final claim needs successful rebuild and matching final identities. The first real ZIP roundtrip rejected REPLAY_ASSET_SIZE, so distinguish corrected evidence from earlier save-button-only success.

New export-retarget boundary: asynchronous export reads and DELETE cleanup must remain bound to their immutable original run/base/auth/exportVersion when the user retargets; new-target credentials must remain intact. Report supplies a real-reader gzip regression, not just a spy. Root inspected final native-mobile-final VI/EN/JA390 and H7 images; visible live scene and exact0.14s/tick7/7 now resolve the earlier visual findings. Evaluate underlying lifecycle code from diff normally.

R68 follows final-production capture: real export was attempted/cancelled before response, and post-active-window Source GETs stalled4.15s. Report must distinguish active-window timing from full export responsiveness and completed versus cancelled output. Root authorized bounded profiling/localized fix on verified copied retained data; changed bytes need a new final freeze. Scene-loaded fullCell counters do not prove every moving body stays inside Cell camera; report camera/culling scope. Review the eventual implementation and amended evidence, not only the earlier successful active-window Pause.

R69 permits only copied diagnostic reclaim proof rotation, with exact before/after exception inventory and original bytes preserved; completed-export profile is not production auth qualification. Verify report labels this scope and all physical/checkpoint/run inputs stayed original.

R70 is measured cooperative report/export work: single shared sweep core with legacy sync and additive async drain, yielding every32 prevalidation/evaluation records, deferred-only use; sequential async gzip/chunk yielding. Review semantic/byte equivalence, immutable same-H capture across yields, callback/failure order, abort/ownership/publication/fsync and bounded memory; report must include actual completed-export responsiveness after change and new clean frozen performance tuple. Prior3fbaf9c/fe0ef1d185s remains old evidence, not final-code qualification.

Controller gate satisfied: final amended report handed off DONE_WITH_CONCERNS, root read its new scope/concerns/result sections, inspected raw measurements/cleanup and independently audited the final50asset ZIP; Sourcee07685d/Lab89b4a38 rechecked clean and match both full diffs. Final185s and complete live export are in /tmp/b07b-evidence/final-r70-production; prior final-production remains preserved pre-R70 evidence. Drawp95~300ms and Source receipt pacing~.498x remain unmet, accepted:false. No more implementation changes are pending at dispatch.

Evidence/report scope: final handoff index /tmp/b07b-evidence/final-handoff-index.json; full report37563B, SHA9b96af81607bfa86c7956ac6d7939aaf48975c8d730aad1c23583cde18dfc87b. Shared absolute browser/Source window anchors are unavailable in frozen raw; the report separately labels browser cursor pacing and unique-matched interior Source-H response-span rate (19ambiguous excluded). B10 recorder follow-up is in the central deferred index and task-B10 brief. Judge the actual measured scope without inferring internal commit timestamps or all-bodies-visible camera coverage.
