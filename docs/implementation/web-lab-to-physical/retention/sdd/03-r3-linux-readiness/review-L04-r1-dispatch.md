You own L04 fix round1 scoped review only. Full task review already occurred; do not repeat it or regenerate original-task packages.
Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-brief.md including R89.
Read full original review: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-review-1.md.
Read appended fix report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-report.md, preserving original chronology.

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


FIX_BASE previous reviewed heads: Source3edb4320d7146343a4b9df977c65d846472c473b /Labe8ed78b98399947a26e525b8f9902e3463aef36a.
Final heads: Source 7d8bededd7b0ca57984d6f0d000eaa74ddea839d / Lab 2ccfbddb86282a9547368302f6121c7ee09acb71.
Source fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-3edb432..7d8bede.diff (11785 bytes, SHA256 64a860f556c25aafe8771ce690fe2fce44c6ca0da4943a9c6f5d810778f8f892).
Lab fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-e8ed78b..2ccfbdd.diff (3466 bytes, SHA256 29d1a888c438067c814da807e09309fa7d491aeb48294a14cb80896f007d45dd).
Root audit and covering own-exit receipts: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L04-r1-handoff.json (9535 bytes, SHA256 d26cb90a3a711de98f12f84a1ddf77f1001e63b37dfb3c5ffd9a8978471e3469). Root read the entire appended report43224B, scoped34Python+3subtests and Lab logs; independent root-L04-r1-handoff-audit.py passed. All3changedfiles match the scoped passing check,12receipts,225native/237portable refs,57schemas; all114originalL04 and414priorL03/L02files, reportprefix and3oldexport/cache sets preserved. No new native preflight/execution or fullCI. Local byte/receipt consistency, not effective Git graph/host authentication..
All identities and supplied packages are filled.

Verbatim Important finding:

### Important — L04-R1: stage only reviewed inputs, not the entire caller directory

**Location:** `source/integrations/arm-controller/scripts/prepare_smoke.py:25`; supporting existing configuration at `source/integrations/arm-controller/configs/sim/puma560/mekoniq.ini:23`.

The new guard compares six specific files to the canonical directory, but then `shutil.copytree(profile.parent, destination, ...)` copies every sibling except Python caches. The canonical INI explicitly consumes `PARAMETER_FILE = sim.var`, while `sim.var` is neither among the six validated files nor present in the reviewed canonical directory. A caller can supply a directory containing the six unchanged reviewed files plus a populated `sim.var`; all new checks pass and that extra controller input is staged. Persistent parameters/work offsets therefore need not start from the reviewed/default state. This requires no race and no changed HAL or INI.

This does **not** demonstrate a hardware route or arbitrary HAL execution. It demonstrates a concrete hole in the new reviewed-input guarantee: extra runtime state can influence the native run without appearing in the six-file admission binding or the immutable Source closure. The runbook's statement that staging contains only byte-matching reviewed inputs is consequently inaccurate. This is a preparation defect that can be fixed and behaviorally tested locally; it should not be deferred as missing host evidence.

**Requested correction:** stage an explicit allowlist of reviewed files into a new configuration directory, or explicitly define, validate and bind every additional controller-consumed startup input. Do not copy arbitrary caller siblings. Add a portable regression using an otherwise canonical directory with an extra `sim.var`, proving it is refused or excluded; retain generated runtime parameters separately as run evidence if needed.

**Current test limitation:** the added staging test modifies `machine.hal`, so it verifies mutation of a checked file but does not cover extra consumed files.

L04-R2 sample/oracle capacity is a retained deferred Minor for final whole-branch triage; it is not falsely closed by this fix. Required native terminal/GUI/ALG04/package/clock/synchrony/Cartesian/fencing/security and hardware qualifications remain incomplete. Assess any new locally actionable fix defect independently from these unavailable native executions.

Read both supplied complete fix packages once in bounded passes. Verify R1 addressed and any fix-introduced breakage. Inspect unchanged context only for a named concrete doubt; no broad repository crawl or original-task review redo. Do not rerun already covering suites. A specific unresolved code doubt may justify a focused read-only check; state why. Report missing/unreadable evidence instead of recreating it.

Read-only product/index/HEAD. No helpers/subagents/reviewers, native/cloud/Docker/hardware/services or SQLite, no evidence rewrites. Write only /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L04-review-2.md. Preserve canonical inputs, generated-versus-immutable closure separation, old tuples, Source authority and no Lab physical routes. Report explicit R1 ADDRESSED/NOT ADDRESSED with file:line evidence, new fix findings with severity, untouched-code observations separately, and verdicts for prepared-code spec compliance and task quality. Native qualification remains separately incomplete. Return concise verdicts/finding IDs/path after full report.
