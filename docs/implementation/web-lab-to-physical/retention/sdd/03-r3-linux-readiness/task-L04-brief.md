# Task brief L04

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/03-r3-linux-readiness.md

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

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Task L04 — Nhánh PUMA/LinuxCNC và ALG04 actual trace

**Dependency:** L00 và LinuxCNC host/profile riêng. Có thể thực hiện độc lập với xArm hoặc Gazebo AMR.

**Files:** Modify `source/integrations/arm-controller/packaging/dependencies.lock.json`, `scripts/{runtime-inventory.py,smoke-sim.sh,smoke_driver.py}`, native recorder và algorithm report wiring; chỉ sửa bridge khi conformance phát hiện gap. Create `source/tests/integration/linuxcnc-alg04-evidence.test.ts`, `source/docs/operations/linuxcnc-native-sim-handoff.md`.

**Interfaces:** smoke produces controller identity, pinned PUMA model, terminal actions và sampled actual/commanded joints có units/controller time/receive time. ALG04 consumes **trace native đó** và đúng PUMA DH/TCP; result phân commanded-vs-actual và FK residual, không gộp thành một sai số.

- [ ] Test ALG04 từ chối mock/xArm traces, degrees bị đọc như radians, wrong DH/frame/hash, empty actual samples và thiếu timing. Test controller epoch đổi không nối trajectory cũ thành continuous.
- [ ] Resolve một candidate LinuxCNC/package version trên Debian host; giữ hashes, apt/source provenance và inventory. Không copy Ubuntu engineering lock hoặc pin ARM64 VM thành amd64.
- [ ] Kiểm SIM config không load device HAL/fieldbus. Smoke terminal bằng script hiện có; raw results start/home/run/pause/resume/stop/fault đi qua controller thật.
- [ ] Verify tunnel/known_hosts, arbiter HMI–bridge, deadline, controller restart/tunnel loss và no auto-resume. Test arbitrary MDI/HAL/launch refusal; endpoint có quyền chỉ trong SIM profile.
- [ ] Thu actual joints và chạy ALG04; giữ không đồng bộ command/actual timestamp rõ, interpolation chỉ trong coverage hợp lệ. Không dùng oracle RTB để tạo chính trace đầu vào cần kiểm.
- [ ] Packaging install/verify/rollback và trust theo package hiện có. GUI có người chạy checklist riêng với evidence, không suy từ terminal log hoặc screenshot đơn lẻ.
- [ ] Focused tests → clean commit → native smoke/evidence. DEP-CNC-01/02/03 + ALG04 + SEC-01 đủ cho profile; thiếu GUI thì terminal subset tested, full candidate chưa đủ.

```sh
# Cwd source/integrations/arm-controller, đúng native SIM host.
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' python3 -m pytest tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py -q
perl -e 'alarm 900; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir "$cnc_evidence_dir"
# GUI là lượt riêng, evidence-dir mới và operator theo docs/hmi-acceptance.md.
perl -e 'alarm 900; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir "$cnc_gui_evidence_dir" --gui
# Cwd source; test mới của task.
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts tests/unit/native-arm-tunnel.test.ts
```


## LinuxCNC observation research (2026-11-14)
Official Python API read: https://linuxcnc.org/docs/2.9/html/config/python-interface.html . It distinguishes actual_position (Cartesian trajectory position, machine units) from joint_actual_position and joint_position (actual vs desired joint values). cycle_time is a thread period, not an absolute sample timestamp; echo_serial_number acknowledges completed UI commands, not a clock/sample counter. Do not fabricate controller time by multiplying polling count by cycle_time. Use a real documented controller time/counter if the chosen host profile exposes one; otherwise retain explicit clock-domain/availability and a receive-monotonic bracket with an honest timing limitation, leaving the corresponding native timing gate incomplete.
Existing bridge/linuxcnc_port.py maps joint dict input/output into actual/commanded degrees and converts in observation() to SI; smoke_driver.py does not yet produce the required full trace. Existing docs/model-conventions.md states inch lengths, degree joint positions, radian DH ALPHA, J1..J6 ordering and pinned PUMA manifest. Reuse those conversions and compare independent actual samples; never label actual_position[:6] as six joint angles or default a missing velocity/sample to a proof of zero motion. Current Python documentation has no heartbeat attribute listed; any host-specific extension needs inventory/provenance.

## L00 provenance handoff — ruling78
R78 permits explicit native_apt provenance for host-installed LinuxCNC without inventing an OCI image. Exact Debian/ISA/package/source provenance and matching actual inventory are still required; missing target locks remain unready. Other installation methods need an explicit supported profile revision, not arbitrary relabeling or ROS inventory reuse. Read final L00 schema/API/report for exact fields.

## L04 native tool closure handoff — R89

Ruling: R89 includes integrations/arm-controller/scripts and integrations/arm-controller/packaging in the current nativeToolClosure, preserving its existing deterministic inventory, symlink refusal and generated-cache exclusions. These immutable recorder, launcher, inventory, installer/trust and candidate-lock bytes must be present and bound by the native export/handoff, not replaced by caller-supplied per-trace SHA claims. Generated traces, runtime inventory observations and run artifacts remain separate evidence outside the immutable closure. Add behavioral closure-membership and mutation checks; clean Source commit/export/Lab pin creates a new tuple, preserving every old artifact and exact historical checker reproduction. Reason: L04 discovered the existing closure includes controller bridge/configs/models/programs but omits the actual smoke/recording scripts and packaging consumed by this path, so a native preparation hash could otherwise miss executable/provenance inputs. Cost if wrong: the native closure expands and its digest changes for all current subjects, requiring fresh export/pin and later preparation records; extra immutable packaging files may be conservative, but neither closure inclusion nor unresolved candidate locks prove installed host provenance, native execution or physical readiness.
