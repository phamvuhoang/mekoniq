Review one task, B09 persistent single-host runtime, writer authority and process lifecycle. This is a task-scoped spec + quality gate; whole-branch review happens separately.

Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B09-brief.md
Read full implementer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B09-report.md
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

Original task BASE Source714e37f9b8251663c3d7a3d3e668a0c35ca2d493 / Lab4741edfcda3b421197235c50daed7c09b340bedf.
HEAD: Source f419bdc0ef522f037e4a7717374e9135fbe5fce8 / Lab701ad719c43572c2981a2542f4c6bbec51f656e5.
Source package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-714e37f..f419bdc.diff (224176 bytes, complete task diff).
Lab package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-4741edf..701ad71.diff (3397 bytes, complete pin diff).
Root handoff evidence: Root read full151-line report and exact final logs:66regressionpass/2containernot_run; focused actual arm/mobile reclaim and BV01 regressions pass;contracts/type/lint/build/export/Labimport/sync/check/type pass. Both HEADs clean and pin matches actual runtime.mjs SHA75beea81. Actual-worker-processes.json exit0 identifies four owned worker/probe children, all sameIdentityAliveAfterTest:false; manifest fixture sourceCommit=test, not qualification. Docker60963 timedout15.013s/TERM143 with blankserverfields. Static context audit explicitly fake Docker boundary, no daemon/image,158files/9components/3fixtures; R76 keeps WEB05open/image null. Existing failed attempts retained and described. No root test rerun..

Read the supplied complete diffs once, in bounded passes if needed. They include commit list, stat and context. Do not reconstruct diffs with git or reread changed files unless a necessary hunk is cut off mid-function; name that focused read. No broad code crawl. Outside-diff dependency reads are permitted only for a named concrete risk, one focused check per risk. Relevant architectural boundaries include public gateway close and worker/file ownership ordering, queued authority/epoch checks and session expiry/reclaim, compiler/runtime closure and persistent recovery. Treat report/rationale as claims; validate against code and retained evidence, including failed attempts and not_run limitations.

R63 public-close, R74 authority and R75 cold read-only arm reclaim and R76 explicitly unexecuted container gate rulings are in the brief. Check current writer versus explicitly granted reader and independent public session ID, secret retention, private404, CSRF/Origin, mutation/transfer execution ordering, epoch0 legacy compatibility and no automatic takeover. Process data-root lock must remain distinct from writer epoch and be held until owned work/workers finish. Cold reclaim must select retained/frozen ports before worker/world creation, refuse missing checkpoint/state, preserve retained identity/report scope and keep ordinary direct-runner behavior outside the explicit recovery mode. The actual Mac arm regression found this boundary; inspect its RED/GREEN and owned-process evidence. Image capability claims must correspond to its actual portable closure, not arm startup alone. Native/container execution evidence must retain its actual architecture; test doubles do not prove physics.

Read-only checkout: no code/index/HEAD/branch changes. Do not spawn helpers/reviewers. The implementer already ran the recorded checks on this code. No routine suite/native/browser reruns. Only a specific unresolved doubt discovered in the code may justify one focused test; identify doubt and exact test. If heavy validation seems warranted, report the evidence gap and let root schedule it. Existing earlier task reviews are context, not an excuse to skip changed boundaries or repeat whole historical campaigns.

Return two explicit verdicts: spec compliance and task quality. Cite file:line for findings and important verified claims. Separate Critical, Important, Minor; ordinary polish/coverage breadth is Minor. Mark requirements in unchanged code/cross-task context as Cannot verify from diff for root resolution. Check all named files/task behaviors for omissions and unintended additions. A plan-mandated defect remains a finding labeled plan-mandated; judge merits, not rationale. Review concurrency/durability/security and error handling, focused tests, separation of responsibilities and introduced size/duplication.

Write full report to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B09-review-1.md. Return concise spec/quality verdicts, finding IDs with severity, limitations and report path. No implementation changes.
