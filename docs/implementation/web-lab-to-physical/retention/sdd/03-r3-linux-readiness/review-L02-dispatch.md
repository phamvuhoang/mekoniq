You are reviewing L02, a task-scoped spec + quality gate; whole-branch review follows after all tasks.

Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L02-brief.md
Read complete implementer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L02-report.md

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

Exact original task BASE: Source 874d05aedfbf573496994fd73016f19ef19e6932 / Lab 4a207b43c613cf0c1226a9ff3c1990a96ec5ac08.
Exact final HEAD: Source e6db696b2ac1266fdeede8c2a64521cd4064481a / Lab 7652851fb9e92e560c70e4e6675b85fa5f445cf4.
Complete Source original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-874d05a..e6db696.diff (163998B SHA 4b79e8bcfd6b03b59cc94b6f6b8f2a82b7a373ab60642cd175ca84c6b65b541e).
Complete Lab original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-4a207b4..7652851.diff (3528B SHA 7890df02663a4c990dc20922cf6af5ee5b5c22e918d01b08980460567f8da2e3).
Root handoff/recorded verification: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L02-handoff.json plus root-L02-handoff-byte-audit.json and root-L02-historical-lint-audit.json. Root fully read25692B report+appendices, covering127TS/74Python and laterfocused4, contracts/types/Labchecks. Final focusedlint ownexit0 receipt resolves initiallymaskedexit; standalone syntax chronology corrected. Full lint still27errors/5unchangedhistoricalfiles confirmedbyGitbytecomparison; B10owns globalconfigurationfollowup. Byteaudit checks180native+237portable refs,57schemas,export/cache/pin andfive actualMacnot_run manifests, not semantics or native behavior..
All bases, heads and packages are now filled; this is the full L02 task review, not a repeated L01 review.

Task-specific review boundaries: Engineering factory must really exist before removing ENGINEERING_LIFECYCLE_UNAVAILABLE; no route to legacy fixture. Canonical physical model/readback and server-owned fixed launch/topic/action settings; real provider clock mapping versus fixed source clock; lifecycle/worker ownership/unknown no-resend. Exact host/package locks only from actual resolved target; unknown locks remain unready. Protocol doubles never count as Gazebo/Nav2/bag/native coverage.

Read provided diffs once in bounded passes. Treat implementation report as claims, including design rationales. Do not reconstruct Git diffs or reread changed files unless necessary context is cut mid-function; state why. Outside-diff reads require a concrete named risk and one focused check, no broad crawl. Do not rerun recorded suites; specific unresolved code doubt may justify one focused check with reason. Report missing or unreadable evidence instead of silently regenerating it.

Read-only code/index/HEAD, no helper subagents. No cloud/native/hardware/container execution or historical SQLite opening. Write only the review report. Assess real behavior/refusal tests, edge cases, scope, maintainability, actual-versus-synthetic evidence and identity. Return explicit spec-compliance and task-quality verdicts, strengths, Critical/Important/Minor findings with file:line, Cannot verify from diff items; plan-mandated defects remain findings. No fixes.

Write full review to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L02-review-1.md; return concise verdicts/finding IDs and report path.

R85 is appended to the binding task brief: L02 native FD01 admits the exact L00 canonical serve-3d subject through a distinct Gazebo mapping, not the old plan example reference fixture. Review the explicit source-requestedProfile versus target execution-profile binding and unchanged legacy/non-native path; this does not waive any FD01/fault/clock/bag requirement.

Official primary documentation/source lookups are permitted for a concrete compatibility question in the prepared ROS/Gazebo code; record the source used. Native host absence is an execution limitation, and does not substitute for a real executable factory/launch/observer/reader path. R85 preserves exact canonical source provenance and separate target mapping; note the full report's actual-versus-not_run limitations. No need to repeat root byte audits or rerun reported suites.
