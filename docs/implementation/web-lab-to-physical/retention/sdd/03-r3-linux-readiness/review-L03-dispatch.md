You are reviewing L03, a task-scoped spec + quality gate; whole-branch review follows after all tasks.

Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-brief.md
Read complete implementer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-report.md

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

Exact original task BASE: Source 00d41e7f25ec1294b9bc8e8c81de3d8e1a869316 / Lab 82b5f92005673c99ba0d1f434ae4c512800fa75e.
Exact final HEAD: Source 2a7ec9c89935649835fc08eee4ebe81fc6190cf0 / Lab 020b818b6ce0b813c22b8826945a917fe4017816.
Complete Source original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-00d41e7..2a7ec9c.diff.
Complete Lab original-base package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-82b5f92..020b818.diff.
Root handoff/recorded verification: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L03-handoff.json; supporting file index /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L03-evidence-file-index.json.
All placeholders filled after complete report read and root byte/receipt audit. Both heads are clean. Packages: [{"path": "/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-00d41e7..2a7ec9c.diff", "bytes": 229889, "sha256": "b7e6d7b83e87e1bc54474845ebf5706c9c2eabfaf1fb23c1f51c788ff177fdab"}, {"path": "/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-82b5f92..020b818.diff", "bytes": 3615, "sha256": "9acb682f2669ddbc2ec57e29826c9afc927203f4b473d515dcd3bcf502883c29"}].

Task-specific review boundaries: The brief includes R86 for the optional generated nativeMapping artifact role and R87 for the fixed synthetic simulation model selector; assess producer/reader, immutable closure separation and exact canonical variant provenance as part of L03. Keep R2a asset lock unchanged; separate exact Jazzy/submodule native source lock and explicit G2/1305/joint/tool mapping. FakeSystem contract evidence separate from actual Gazebo motion and contact. No fallback fake, arbitrary browser robot IP/action/launch, guessed package locks or actual-feedback fabrication. Limits/freshness/epochs/cancel/unknown require real protocol behavior. 21 matching vendor bytes are not expanded-URDF/plugin/contact qualification.

Read provided diffs once in bounded passes. Treat implementation report as claims, including design rationales. Do not reconstruct Git diffs or reread changed files unless necessary context is cut mid-function; state why. Outside-diff reads require a concrete named risk and one focused check, no broad crawl. Do not rerun recorded suites; specific unresolved code doubt may justify one focused check with reason. Report missing or unreadable evidence instead of silently regenerating it.

Read-only code/index/HEAD, no helper subagents. No cloud/native/hardware/container execution or historical SQLite opening. Write only the review report. Assess real behavior/refusal tests, edge cases, scope, maintainability, actual-versus-synthetic evidence and identity. Return explicit spec-compliance and task-quality verdicts, strengths, Critical/Important/Minor findings with file:line, Cannot verify from diff items; plan-mandated defects remain findings. No fixes.

Write full review to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-review-1.md; return concise verdicts/finding IDs and report path.

Evidence chronology: report31609B SHAe1286018bb57fd1e6a771bda5c322c79008229609e4d6b935852c157aa058884. Combined136TS/92Python precede final URI/late-reply refinements; subsequent20TS/27Python and13TS/28Python plus types/lint cover them, with only one trailing EOF blank-line removal afterward. Vendor whitespace attributes added after behavioral checks. Root audit verifies exact final-byte attribution,202native/237portable refs/57schemas,140evidencefiles and86+63preservedL02files; it is local consistency, not effective tool Git graph or native host attestation. Six post-commit publicCLI preflights all exit2/not_run, contact0/10. Report distinguishes direct FollowJointTrajectory probe from collision-planned motion and same-run restart refusal from actual native controller restart qualification; assess these scopes against the task requirements. Known historical full-lint27errors5unchangedfiles remains recorded for B10; no fullCI claimed.
