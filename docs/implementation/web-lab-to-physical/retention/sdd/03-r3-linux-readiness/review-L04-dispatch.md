You are reviewing L04, a task-scoped spec + quality gate; whole-branch review follows after all tasks.

Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-brief.md
Read complete implementer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-report.md

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

Exact original task BASE: Source7b5b3a17e501f125efac18749ad5b8123940ce7c /Lab58d082a9d57ea9216fa123ebb5d676ae1421b550.
Exact final HEAD: Source3edb4320d7146343a4b9df977c65d846472c473b /Labe8ed78b98399947a26e525b8f9902e3463aef36a.
Complete Source original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-7b5b3a1..3edb432.diff (67726 bytes, SHA256 e40a12e008779ba8e9ed36e8f42957b454ff33c68f5349ff0237b26a14ad6f22).
Complete Lab original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-58d082a..e8ed78b.diff (3541 bytes, SHA256 6397f70cf7b9f462cbcbb2af16e1e27d020f51e0249019ad312a60430c4beb3d).
Root handoff/recorded verification: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L04-handoff.json (36805 bytes, SHA256 fea2fa60f26f7ace609ee0f38ecd3152899674d4afe824083b9f264bac3f0624); root-L04-handoff-audit.py passed independent local byte/receipt checks, not effective Git graph or host authentication. Root read all32387B report and final logs. 138TS/69Python+8subtests precede the guard; final71Python+8subtests cover the follow-up, counts overlap. FullCI/lint/native qualification remain unclaimed..
All identities are filled; both packages include the complete original-base range, two Source commits and two Lab pins.

Task-specific review boundaries: ALG04 input must be actual native PUMA trace, not RTB-generated oracle or mock/xArm samples. Correct degrees/radians/DH/TCP, actual joint feedback versus Cartesian actual_position; honest timing availability, no cycle_time or echo_serial_number fabricated clock. Missing velocity/feedback is not zero-motion proof. Strict SIM-only config, ownership/tunnel/deadline/restart and packaging trust. No target host means native terminal/GUI gates remain not_run.

Read provided diffs once in bounded passes. Treat implementation report as claims, including design rationales. Do not reconstruct Git diffs or reread changed files unless necessary context is cut mid-function; state why. Outside-diff reads require a concrete named risk and one focused check, no broad crawl. Do not rerun recorded suites; specific unresolved code doubt may justify one focused check with reason. Report missing or unreadable evidence instead of silently regenerating it.

Read-only code/index/HEAD, no helper subagents. No cloud/native/hardware/container execution or historical SQLite opening. Write only the review report. Assess real behavior/refusal tests, edge cases, scope, maintainability, actual-versus-synthetic evidence and identity. Return explicit spec-compliance and task-quality verdicts, strengths, Critical/Important/Minor findings with file:line, Cannot verify from diff items; plan-mandated defects remain findings. No fixes.

Write full review to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-review-1.md; return concise verdicts/finding IDs and report path.

The task brief now includes recorded R89: immutable LinuxCNC scripts/packaging in nativeToolClosure; generated traces remain evidence outside it. Read the reported concerns as limits to verify: no assigned host/package proof, unavailable controller clock/synchrony and Cartesian endpoint, overall native ALG04 not_run, pre-action/poll epoch observations are not atomic controller fences. Distinguish any locally actionable code/preparation defect from actual missing external qualification; assess both explicitly, without upgrading protocol doubles or static closure consistency to native execution.
