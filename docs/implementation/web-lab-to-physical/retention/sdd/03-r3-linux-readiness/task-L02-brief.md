# Task brief L02

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

## Task L02 — Engineering Gazebo/Nav2 lifecycle thật

**Dependency:** L00 và ROS host. L01 ưu tiên chạy trước để giải quyết gap triển khai web, nhưng không là dependency kỹ thuật của Nav2.

**Files:**

- Modify `source/robotics/simulation/profiles/engineering-{amd64,arm64}.lock.json` cho kiến trúc thực sự resolve.
- Modify `source/robotics/simulation/{compiler/engineering.py,bridge/engineering_profile.py,bridge/engineering_worker.py}` và native profile/worker entrypoint liên quan.
- Modify `source/packages/lab-runtime/src/v2/sil/{cli,native-lifecycle,native-providers}.ts`, `source/scripts/lab-sil.mjs`.
- Create `source/tests/integration/engineering-native-lifecycle.test.ts`, `source/tests/integration/engineering-native-evidence.test.ts`, `source/robotics/simulation/tests/test_engineering_native_parity.py`.

**Interfaces:** engineering factory nhận compiled bundle + server-owned environment profile; trả native backend cùng command/observation contract hiện có. Thêm `clockMapping` gồm providerSimNs, sourceTick, receiveMonotonicNs vào native evidence sidecar. Không thay semantics source fixed-step runners.

- [ ] Negative test engineering project đi legacy fixture, missing plugin/TF, wrong physical model, stale feedback và clock reset; guard hiện tại chỉ được thay khi đúng factory thực tồn tại.
- [ ] Resolve exact package versions/plugin hashes và apt/image provenance trên host. Chỉ sửa lock của arch đã thu; forbidden packages giữ nguyên. Clean install rồi doctor phải đọc inventory thực.
- [ ] Smoke upstream/legacy stack, sau đó compile engineering FD01 cùng canonical model với handoff. Readback SDF/joints/collider/inertia/sensor frames; ghi mass và friction vẫn assumed nếu chưa đo.
- [ ] Implement engineering factory, native `/clock` mapping, lifecycle, shutdown và process ownership. Set ROS_DOMAIN_ID/GZ partition riêng, allowlist topic/action và launch args từ server profile.
- [ ] FD01 nominal ít nhất 3 seeds; obstacle/no-path/cancel/worker-loss không false completion hoặc replay command. Business confirmations đi qua source, không do Gazebo report tự tạo.
- [ ] Lưu rosbag2 + normalized trajectory/sensors/commands/journal + inventory + assertions; replay đọc lại. Bag không có expected topics/time coverage thì case không đạt.
- [ ] Chạy protocol tests local và native campaign riêng; commit code/pin trước khi record. DEP-NAV-01–04/SEC-01 đủ mới đề xuất G-NATIVE-AMR của đúng engineering profile.

Commands hiện có dưới đây vẫn có thể báo `ENGINEERING_LIFECYCLE_UNAVAILABLE` trước khi task hoàn tất; đó là gap cần implement:

```sh
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-amd64 --json
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/engineering-profile-routing.test.ts
# Linux sau implementation; fd01.project.json phải được verify model/profile trước chạy.
perl -e 'alarm 1800; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 3 --out "$native_evidence_dir" --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project tests/fixtures/engineering/fd01.project.json
node scripts/lab-sil.mjs verify --input "$native_evidence_dir"
```


## L00 provenance handoff — ruling78
R78 adds explicit native_apt handoff provenance for host-installed profiles, separately from OCI. It requires the locked profile’s exact distro/ISA/package/source provenance and matching actual inventory; missing package locks stay nativeReady:false. Do not invent an OCI image for an apt-installed ROS host or weaken image-bound MuJoCo readiness. Read final L00 schema/API/report for exact fields.

## L00 static AMR preparation boundary (reviewed complete)
L00 now provides an explicit canonical engineering-navigation preparation kind: actual EngineeringProject + standalone NavigationSceneV1 + RobotPhysicalModelV1, supported canonical input binding and reproduced projection. Existing NavigationSceneV1 portable engine variants are not Gazebo-native execution. This preparation remains NATIVE_ENGINE_MAPPING_UNRESOLVED/nativeReady:false until L02 provides the actual native scene/compiler/profile mapping; read final reviewed L00 schema/report for exact fields. Implementing the factory alone or changing a boolean/label does not prove native artifact/host compatibility. Preserve the canonical input provenance and record the native mapping separately.

## Controller R85 — exact canonical FD01 input
Ruling: R85 scopes L02 native FD01 to the exact unchanged L00 canonical serve-3d EngineeringProject, NavigationScene and RobotPhysicalModel, with a separately identified Gazebo compiler/artifact/profile mapping. Replace the plan's older tests/fixtures/engineering/fd01.project.json native command example with robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json; the old reference fixture remains intact and unsupported only by this new exact native adapter, without changing existing non-native/legacy readers. Preserve its requestedProfile engineering-webots-3d-v1 as source provenance and bind the explicit target engineering-rigid-v1 backend plus engineering-amd64/arm64 environment profile separately; do not broadly ignore requested-profile mismatches or mutate canonical bytes. Required FD01 nominal/fault/clock/bag cases and Source confirmations remain unchanged. Reason: the spec requires the same canonical model as handoff, while the older reference fixture is a different project/world/model with no L00 binding. Cost if wrong: native support is deliberately limited to one canonical subject and cannot claim the older reference fixture or arbitrary project compatibility; a second subject needs its own audited mapping/readback and native qualification, not a fallback. No native run or package/plugin readiness is inferred.
The original command example naming tests/fixtures/engineering/fd01.project.json is superseded for L02 native execution. Use --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json with an explicitly bound new native bundle and server environment profile, following the implemented runbook. Preserve canonical source requestedProfile and record the target profile separately. Existing legacy/non-native reference behavior remains regression scope. No second native model mapping is required by this task.
