# Task brief L01

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

## Task L01 — MuJoCo trên Linux đúng ISA và kiểm gap amd64

**Dependency:** L00 và host Linux đã được chỉ định. Không chờ full R2b để kiểm R2a baseline.

**Files:** Create `source/scripts/native-sim/mujoco-probe.mjs`, `source/robotics/simulation-mujoco/profiles/linux-amd64.json`, `source/tests/unit/mujoco-native-probe.test.ts`; modify recorder để đọc probe manifest. Native evidence được ghi vào directory mới ngoài tree trước khi qualify.

**Interfaces:** CLI mới `node scripts/native-sim/mujoco-probe.mjs --handoff DIR --out NEW_DIR`; manifest gồm native inventory, image/engine hashes, cases, raw artifact refs và assertions. Profile là SIM, không mount device/host robot network.

- [ ] Test emulation, wrong platform digest, missing engine artifact và chỉ có unit test log đều không đạt DEP-MJ-01. Probe subprocess timeout/abort phải lưu failed/incomplete cùng stdout/stderr.
- [ ] Tạo profile Linux amd64 từ **image/engine đã bàn giao R2a**, không đổi sang MuJoCo 4 để thử vượt lỗi. Ghi chính xác image manifest cho platform được chạy, không chỉ multiarch tag.
- [ ] Thu inventory host thật; chạy 10/10 grasp trials recipe M00 rồi 3 seed MJ-BV01 đầy đủ, bad-state và worker-loss cases. Expected fault đạt khi dừng đúng và không false serve; không đòi fault case served thành công.
- [ ] Khi R2b.1/R2b.2 đã có, chạy campaign tương ứng trên cùng profile và lưu pin mới riêng. Ghi p50/p95/max tick+IPC, memory, long-run drift và raw contact/pose.
- [ ] Nếu native amd64 vẫn BADQACC/PLANT_UNSTABLE: archive inputs/state/warnings, đánh dấu failed và mở investigation riêng. Tuning hoặc engine upgrade là baseline mới, phải re-run các architecture tuyên bố hỗ trợ.
- [ ] Verify artifacts bằng reader trong đúng source pin; commit probe code và compatibility record theo thứ tự clean commit → record → evidence commit. Chưa có host thì chỉ commit tooling/tests và giữ DEP-MJ-01 not_run.

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts
# Chỉ sau khi CLI được tạo, trên host đã chỉ định; hai biến là đường dẫn tuyệt đối được runbook đặt.
perl -e 'alarm 1800; exec @ARGV' node scripts/native-sim/mujoco-probe.mjs --handoff "$handoff_dir" --out "$native_evidence_dir"
```

**Exit:** record `mujoco-linux-amd64` có kết quả thật; không coi nó là G-NATIVE-ARM hay hardware validation. Native arm64 nếu chạy có record độc lập.


## New R2a cloud evidence (read-only controller refresh, 2026-11-14)
Original source/main11d25b47a18adafb88ac21adc249499109996bc5 now contains docs/implementation/evidence/cloud-run/mekoniq-2026-11-14 and production/r2a-2026-11-14. Runtime pin is still4f893ac6fb75dff414a3ee42a726defb7935c734; platform linux/amd64, deployed registry digestfbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009; local image config IDf650a2576cf7d44e8f9bf40934d862d8120170dd701e7da502a6ee032d12bd05 is a different identity. HTTP MJ-BV01 completedtick4800/served2, Chrome production completed4810/served2. Cloud guard supplement G-CLOUD1 tested, acceptedfalse; original record remainsblocked_external by historicaltable. Read these existing local records, no livecloud/secrets/actions. This narrows the former unknownamd64 gap for that case/pin, but is not the required10grasp/3seed/fault/inventory/performance L01campaign and not R2b/hardware qualification. Use actual R2a image identity as historical baseline; current B09/R2b image is a separate source pin. Do not rebuild HEAD and label it the exact handed R2a image. Existing Dockerfile pins a multiarch base index, not the target image platform manifest; require actual platform identity/resolution evidence and keep unresolved fields nativeReadyfalse. No host was assigned to this task to rerun qualification.

Historical baseline versus current probe tooling: use separate subject handoffs for the exact R2a runtime/image and the later R2b runtime/image; each retains its own source/Lab/schema/closure tuple. Current observer/probe tooling can have a different build commit, but record that separately from the software under test. Do not mix old image with newworker/profilefiles and call it the exact baseline, or broadly waive source identity checks to combine builds. A checker version is not a replacement for a target/runtime version.

## L00 provenance handoff — ruling78
R78 preserves this task as an OCI-image campaign: the historical R2a subject and current R2b image handoffs must retain their own exact single-platform manifest/config and runtime tuples. A native_apt mode or ROS/CNC inventory is not a substitute for a missing/unbuilt MuJoCo subject image. Read final L00 schema/API/report for exact discrimination; do not infer readiness from a multiarch index/config ID alone.

## L00/L01 exact arm-only boundary and retained runtime
L00 correction explicitly supports current shared-world/cell, PUMA reference and canonical ROS AMR/xArm kinds; historical R2a arm-only is not admitted by those kinds. L01 must add the precise static arm-only adapter/mapping necessary for its exact-old-image probe using the frozen R2a files, not replace the subject with current B05/B06 world data. Read final reviewed L00 report/runbook for the missing shape and preserve its new static/ref/provenance gates. This belongs to L01 exact baseline support; no hardware/engine upgrade or new native evidence implied.

Root read-only cache inventory `root-L01-historical-runtime-location.json` locates the actual archived runtime at `/Users/hoangpham/source/prv/robot/lab/.runtime/55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270`. Runtime bytes SHA256 match55dd3585..., manifest dirty:false/source4f893ac6fb75dff414a3ee42a726defb7935c734/schema9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4/portable3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d. Original main checkout/cache remain READ-ONLY; copy only verified needed files to task-owned temp preparation output, never run/mutate through original locations. This identifies cached runtime only, NOT image manifest/config bytes, complete closure re-audit or native execution. Frozen Git4f893ac can provide original tracked files by read-only Git objects as needed; no checkout/reset/rebuild of main.

## Controller ruling81 — exact R2a arm-only adapter ownership
Ruling: assign the historical R2a arm-only static handoff adapter to L01's exact-R2a-image probe task, while L00 closes preparation only for its explicitly supported current shared-world/cell, canonical ROS AMR/xArm and pinned PUMA kinds. L00 must document arm-only as unsupported, never force it through newer world files; L01 must implement/review the old shape and frozen-model/ref bindings before its probe can admit that subject. The actual old runtime55dd3585... is retained and hash-verified at original Lab cache with Source4f893ac; use read-only verified copies and frozen Git objects, not a HEAD rebuild or mutation of original main/cache. Its existence is not image manifest/config, complete closure or native-execution proof. Reason: arm-only baseline adapter and old-image probe share exact historical semantics; keeping them in L01 avoids expanding L00 into probe-specific reconstruction while retaining an explicit viable dependency. Cost if wrong: L01 gains an additive schema/validator integration step and must preserve/retest all current static admission boundaries; neither task may claim arm-only preparation or DEP-MJ-01 until that adapter and required evidence exist.

## Controller ruling82 — explicit fault and recipe scopes
Ruling: R82 scopes DEP-MJ-01 bad-state to an explicitly instrumented historical WorkerSession plus real MuJoCo engine subcase, alongside unchanged historical-runtime MJ-BV01 and worker-loss cases. The old gateway exposes no bad-state injection API; observer-owned fault code and verbatim frozen M00 recipe extraction have separate hashes/provenance and never become claimed historical image files. Bad-state must retain inputs/state/warnings, prove actual engine instability, failure/no successful post-fault step and bounded stop; it makes no Source custody/served assertion. Full-runtime worker-loss separately requires Source no false serve, no resend/respawn and stop/unknown outcomes. The manifest/reader must require every named scope and refuse unit-only evidence. The new amd64 profile is observer-authored compatibility data, not a historical build file. Reason: the compatibility case tests engine/platform behavior while preserving the immutable R2a subject and making instrumentation visible. Cost if wrong: component bad-state does not independently prove end-to-end Source fault propagation; that limitation must remain explicit, and no broader full-runtime bad-state or hardware gate may be claimed.

## Controller rulings83–84 — campaign ownership and passive wire observation
Ruling: R83 keeps L01 exact historical R2a native campaign and assigns the executable current-R2b payload/cell native campaign adapter to B10 tooling, where current campaign and image closure integration is owned. B10 must implement and independently review that prepared execution path before final qualification; an image-unbuilt not_run record alone is not the adapter. Each subject has its own clean runtime/schema/closure/profile/image tuple, independently recorded observer code and actual artifact reader; no historical image with current worker/campaign substitution. L01 records R2b not_run/image-unbuilt and this dependency. Missing native host/image keeps actual current campaign execution not_run, without weakening readiness or acceptance. Reason: current image construction and campaign qualification already converge in B10 while L01 must preserve the immutable R2a baseline. Cost if wrong: B10 gains an additive native orchestration integration and can delay final tooling completion; final handoff must expose any unimplemented path instead of silently declaring R2b Linux-ready.

Ruling: R84 permits a separately hashed observer-owned Node preload to passively capture actual worker stdin requests/stdout ACKs and owned spawn/exit identities for historical-runtime worker-loss assertions. Record unchanged subject bytes with passive instrumentation, not uninstrumented execution; preserve spawn arguments/options/returns/events and stream-write behavior, never replace commands/ACKs or disclose environment/secrets. Bound and retain observations; missing, overflowed or incomplete trace cannot prove no resend. SIGKILL and cleanup target only the observed task-owned worker/processes. Focused forwarding, ownership and trace-loss refusal tests are required. Reason: the historical gateway exposes no wire trace hook, and HTTP logs alone do not establish no resend. Cost if wrong: observer timing overhead or a missed import binding may invalidate measured behavior; record instrumentation/timing scope and fail the affected assertion, never fill the gap with inferred success.
