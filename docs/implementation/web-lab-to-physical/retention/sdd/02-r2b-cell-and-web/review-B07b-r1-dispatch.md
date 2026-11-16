You are re-reviewing B07b fix round1. A previous full original-base review found I1/I2 below. Verdict each finding and inspect only the fix diff for new breakage; this is not a new task or whole-branch review.

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-brief.md

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


## Findings under verification (verbatim)

**I1 — Report replay can display the live terminal world at every cursor.**

- Location: `lab/src/ui/workspace.ts:162–166`, with replay entry at `:644–646`.
- `frame()` attaches `this.world` when its tick matches the selected live view, then returns at line 165 before executing the replay projection. Both existing `twin-replay` entry paths only set `this.replay`; they leave `world` and `worldView` intact. `refreshWorld()` then deliberately stops during replay.
- Concrete path: pause a shared cell at H7 after a display observation, open the Report tab's **Replay (read-only)** action, then scrub to tick 0. The replay transport says tick 0, but `frame()` continues returning the H7 world, Source view and report. This is not limited to 500 ms: after retention expires, `this.view` is still H7, so the world tick still matches and the early return remains. Later replay cursors similarly do not select their own world/sample state.
- This violates immediate replay reset and truthful cursor scope, and can show later physical/custody context under an earlier recorded time. The separate offline workspace's H7 tests do not exercise this accessible live-report action.
- Fix: clear/invalidate live world state on both report replay entry paths and ensure `frame()` cannot select a live world while replaying. If the legacy report lacks exact world records, explicitly show unavailable geometry or direct the user to the verified package replay flow. Add a focused regression starting with an H7 live world and entering/scrubbing the existing report replay action.

**I2 — Retained display state drives Pause/Resume and other control availability.**

- Location: changed retained-view selection in `lab/src/ui/workspace.ts:162`, consumed by `:313–315`; focused dependency check at `:302` (`ops`) and `:348–351` (`transport`).
- `frame()` intentionally chooses the old `worldView` for up to 500 ms. `ops(f)` then passes that old `f.view` to `runControls`/`nextAction`, and both the primary action and transport are built from those results. Thus, after the authoritative view has acknowledged Pause, the retained running view still supplies control availability; the inverse occurs on Resume. Read-only/attention transitions likewise should not inherit the prior display state's permissions.
- The actual action request correctly uses `this.view` and its current revision, so this is not a Source authority bypass. It is nevertheless the explicit R66 separation failure: current control state is not independent of the intentionally lagging visual frame. It also undermines the new Pause-ACK behavior: its unit test proves `this.view` updates, but does not assert rendered controls while a retained world is present.
- Fix: use current `this.view` for live control policy/availability and keep the retained `worldView` confined to the visual/context projection. Preserve replay's existing read-only gating. Add a targeted test with retained running-H7 world, acknowledged paused current view, and the reverse Resume transition; assert controls immediately reflect the acknowledged state while geometry remains at its coherent H/revision.


## Fix evidence
Read /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-fix-1-report.md and the fix1 addendum to task-B07b-report.md in the same directory.

FIX BASE (previous reviewed heads): Source e07685d947bad36a175b930031e0997e2991799e / Lab 89b4a38aa4b2d9244482646565cb63a598d66902.
HEAD: Source e07685d947bad36a175b930031e0997e2991799e (unchanged) / Lab c20108c6f87c6b5dc7e034184d26bd17651b1c03
DIFF FILE(S): /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-89b4a38..c20108c.diff (2 commits, 87677 bytes; Source has no fix diff)

Read the supplied complete fix diff once in bounded passes; it carries commit/stat/context. Do not regenerate Git scope or reread changed files unless a necessary hunk is cut mid-function, naming why. If the file is missing, ask root instead of substituting another range. Outside-diff code may be checked only once per concrete named dependency risk. Do not re-review unchanged code; out-of-scope observations go to a separate nonblocking section, not a new fix loop.

Specifically verify both accessible report-replay entry paths invalidate prior live frame/history and pending-response generation, and frame selection can never draw live H/context while replay cursor differs. Missing exact physical-world records must remain unavailable or use existing verified package replay; no invented old-world geometry/custody. Verify actual rendered primary/transport controls use current authoritative view through pause/resume/read-only/attention/unknown transitions while retained visual/context stays coherent, and replay remains read-only. Actual requests must retain current revision and no new hardware authority.

Check the fix report's covering test commands/outputs and fresh build/browser identity. No routine suite/browser/native/performance reruns; only a specific unanswered doubt permits a focused test, named with rationale. Treat recorded185s timing as belonging to its exact recorded tuple, never silently upgrade it to a different UI head. Read any scope-impact decision supplied in the report.

No helpers/subagents, product edits, Git/index/branch changes, native/cloud/hardware actions or original evidence/SQLite writes. Read-only except writing your ignored report. Existing review1 Minor M1 validation warnings are deferred in central index/B10; do not expand this round into unrelated warning cleanup. Report new breakage introduced by the fix normally.

Write /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B07b-review-2.md. For I1 then I2 give ADDRESSED or NOT ADDRESSED with file:line evidence; list new Critical/Important/Minor breakage from the fix, out-of-scope observations separately, precise checks run, and fix-round verdict (all addressed/no new CriticalImportant vs findings remain). Return concise verdict/findings. Root must fill pending HEAD/DIFF and read completed fix report/tests before dispatch.

R71 scope: UI-only I1/I2 fix uses focused deterministic and actual native browser regression; no new185s capture before B10 unless scope broadens into normal pacing/render cadence/Source/measurement. Old benchmark stays e07685d/89b4a38 only; new UI ACK latency is unmeasured, no performance/D0 acceptance. Verify the report preserves this distinction and actual diff fits the narrow boundary; new changed-boundary problems still count normally.

## R72 — exact live display revision after retention

Ruling: include the same-H/new-revision stale-world fallback in B07b fix1 because it is the frame predicate implicated by I1/I2 and R66. Live-world attachment must match sourceRevision to selected view.runRevision as well as existing run/boot/scene/availability guards. During allowed retention keep the old wholly coherent pair; after500ms show unavailable until matching observation arrives, never stamp old geometry with current revision. Cover expiry and late response regressions. Cost if wrong: missing or delayed matching observations temporarily hide geometry, but allowing indefinite mismatched context would misstate Source state. No normal cadence/tick/Source change; R71 scoped verification still applies.

Root handoff gate satisfied: read full fix report and main addendum; checked final clean Source/Lab heads, covering command/output logs, final493unit pass, clean build identity f1b0b46f and browser1/1pass12.4s on c20108c. No additional routine runs requested. Original report prefix/index remains preserved.
