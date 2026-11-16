You are reviewing task B08 for spec compliance and code quality. This is one task-scoped gate; whole-branch review happens later.

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-brief.md
Read the implementer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-report.md

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


## Exact review inputs
ORIGINAL TASK BASE: Source e07685d947bad36a175b930031e0997e2991799e / Lab c20108c6f87c6b5dc7e034184d26bd17651b1c03.
HEADS: Source 709a797fa791727d0a8c830e935e0d80192843b0 / Lab 3a904c21bb5805c1f6a4fa3d3bd096873d53ba41 (both clean)
DIFF FILES: Source /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-e07685d..709a797.diff (91682 bytes, 1 commit); Lab /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-c20108c..3a904c2.diff (67254 bytes, 1 commit)
HANDOFF: Root read the complete final report, no unresolved implementation blocker; concerns are explicit population/calibration/untriggered/native limits. Verified clean heads/pin, recorded84 focused plus later16 semantic regression (overlap, not a sum), actual cleanX01/CLI and Lab592pass/1not_run/type/build/sync/check-source outputs. Root inspected final desktop/mobile table images and separately audited174 declared finalX01 filelocations/8427446B with0stored-byte mismatch; audit is not native/human acceptance. Final-identities.json and all logs/images are under adjacent evidence-B08; actual clean recording and retained failure paths are in report.

Read the supplied complete diff files once in bounded passes, including every changed code/test hunk; they contain commit/stat/fullcontext. Do not regenerate Git scope or read changed files again unless a hunk needed for judgment is cut mid-function, stating why. Ask root if a package is missing instead of substituting another range. Outside-diff code may be inspected only once per concrete named dependency risk; report what and why. Do not crawl broader code or rerun completed earlier task reviews.

Treat the report as claims; verify against implementation and retained command/output evidence. Assess each requirement, missing/extra/misunderstood behavior, separation/error handling/test meaningfulness and scope. Do not flag pre-existing file size; assess new damage in this task. Existing tests already ran; no routine suites/native/browser reruns. Only a specific unresolved code doubt permits a focused test with named rationale; recommend heavy validation instead of running it. Do not infer missing evidence from truncated output: reread exact report/log path or report missing evidence to root.

Task-specific focus: verified common input/model/world/task/goal/frame equivalence and noise/confirmation/controller identities; causal invariants rather than cross-engine trace/event-total-order equality; unsupported contact/slip dimensions versus zero; strict same-engine/control/mechanical physics comparison with complete narrow registered load/speed/friction/provenance whitelist (including all derived refs) and adjacent-field negative tests; actual window/population/sample semantics with no statistical quantiles for population<3 or accuracy winner. Preserve old compareRuns cross-backend guard. UI study must be reachable and label comparison/unsupported scopes accurately, with genuine run/tick links. Recorded engine data must bind actual compiled scene/model identities rather than retagging old runs. Distinguish native actual evidence from protocol/unit fixtures and unavailable prerequisites. See brief for B04a lowerfriction masking/stop-distance and derivedinput identity obligations.

Review read-only except writing your ignored report; no product edits, Git/index/branch mutation, native/cloud/hardware actions or original evidence/SQLite writes. Never spawn helpers/subagents. Preserve earlier review/qualification scope and accepted:false/not_calibrated. Any requirement outside diff/cross-task scope is a Cannot verify item for root rather than an open-ended investigation.

Write /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-review-1.md. Include separate Spec Compliance (compliant/issues plus Cannot verify), concrete strengths, Critical/Important/Minor findings with file:line, impact and suggested fix, and Task Quality (Approved/Needs fixes). Calibrate Important to incorrect/fragile behavior, missed binding requirement or maintainability damage that blocks trust; polish is Minor. If the plan mandates a defect, label plan-mandated rather than suppressing it. Include exact scope/dependencies/evidence checked, commands run and limits. Return concise verdict/findings/report path. Root must fill all pending fields and read final concerns/evidence before dispatch.

Specific evidence scope to retain: development recording.json stayed started after consumer runtime-project identity validation threw; separate consumer-fix/UI outputs are readbacks of those original dirty recordings. Final clean recording-complete.json belongs to709a797 and distinct run IDs; nominal cancel/unknown rows are explicitly not_run with counts. Registeredarrival0.05m/0.05rad/five stoppedticks was not widened. Browser images use the explicitly labeled development study; clean CLI/native identity is separate. No new performance claim for B07b or native Linux/hardware. Assess actual implementation against these claims normally.
