# Task brief L03

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

## Task L03 — Nhánh xArm: model, fake contract, native motion, rồi contact

**Dependency:** L00; X2/X3 cần ROS profile đã kiểm ở L02. X0 và test contract làm trước được.

**Files:**

- Create `source/robotics/manipulation/native-vendor.lock.json`, `profiles/xarm6-jazzy-sim.json`, `native_xarm/` với typed action client, observers và launch profile cố định.
- Create `source/packages/lab-runtime/src/v2/sil/xarm-provider.ts`; modify native factory/config schema/capabilities cho `moveit_gazebo_arm`.
- Create `source/tests/integration/xarm-native-contract.test.ts`, `source/robotics/manipulation/tests/test_native_xarm.py`, `source/docs/operations/xarm-native-sim.md`.
- Keep asset import `source/robotics/manipulation/vendor.lock.json` của R2a nguyên; nếu model khác phải có explicit mapping/revision mới.

**Interfaces:** `createXarmSimProvider(serverConfig)` produces typed arm adapter + observations qua source contracts hiện có. Config có immutable profile/model/joint map/tool limits và launch refs; không nhận robot IP, arbitrary ROS action, shell hoặc launch parameters từ browser. Fake mode và Gazebo mode có `evidenceKind` khác nhau.

- [ ] Test unit/sign/joint-order/FK parity với xArm R2a, missing actual feedback, stale seq/epoch, cancel timeout, result lost và restart. Fake action server dùng để test contract, gắn `protocol_double`.
- [ ] Pin Jazzy branch commit + submodules + license và distro plugins thực; giữ bảng so model/tool với R2a. Description match không có nghĩa controller match.
- [ ] X1 chạy ros2_control fake system và FollowJointTrajectory; ghi actual interface là fake, không contact/dynamics. Test finite trajectory/limits/cancel/result/freshness và no retry khi unknown.
- [ ] X2 chạy Gazebo/Harmonic thực và MoveIt nếu profile cần; ghi commanded/actual joints, TCP, clock, planner/collision settings, stop/restart và full trajectory outcomes. Không fallback fake khi Gazebo không lên.
- [ ] X3 làm spike G2/mimic/tool contact: 10 grip/release trials, support/receiver observations và collision exclusions có provenance. Unsupported → case blocked với reason; model thay thế có profile khác và không gọi là G2.
- [ ] Source admission chỉ mở những capability đã có implementation/readiness. Report ghi rõ `motion` và `contact` độc lập. Không thêm provider physical `xarm_native` vào Lab.
- [ ] Chạy contract tests rồi native cases trên host; commit code và profile-scoped evidence. DEP-XARM-01/02/SEC-01 đủ cho motion; contact chỉ thêm khi DEP-XARM-03 đạt.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/xarm6-rtb.test.ts
# Cwd source; Python ROS đã activate theo native profile, không dùng .venv-mujoco.
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' python3 -m pytest robotics/manipulation/tests/test_native_xarm.py -q
```

**Exit:** record xArm scope thực chạy. Chuẩn bị physical là L05, không đổi FakeSystem thành driver live bằng một UI toggle.


## Primary-source inspection prepared by controller (2026-11-14)
Read adjacent research-xarm-jazzy-20261114.json for exact upstream source snapshots/links. Official xarm_ros2 jazzy currently resolves d837f2e17f7f36043103b367fca3af8172626245 (tree716c810e5cf34dcef317454dd601bcb6826bea9b); SDK gitlink xarm_sdk/cxx -> xArm-CPLUS-SDK f36794320a285c0b4bf1cd8ef181cbff6e3b794a. These are candidate source pins, not host/package qualification. Preserve separate existing R2a asset lock; compare mappings explicitly.
xarm6_moveit_gazebo.launch.py wrapper sets gz_type='gz'; generic _robot_moveit_gazebo defaults to classic unless overridden. Native profile must choose the actual Harmonic path and gz_ros2_control/GazeboSimSystem explicitly. Current gripper_version default is G1: choose G2 only with explicit mapping/model proof. Gripper macro unconditionally emits five mimic plugin declarations; README still says old mimic plugin not supported. Do not advertise contact readiness from arm-only action/controller readiness. Controller YAML names xarm6_traj_controller/joint1..joint6, 150Hz manager and25Hz state publication; these upstream values are not this project's qualified timing bounds. No native host run was performed. Git API blob SHA is Git object identity, not SHA-256; snapshot also records contentSha256, and actual vendored files/submodule/license should be verified at implementation. License is BSD-style three-clause text retained in snapshot.

Controller source-byte parity check: all21 source files in existing xarm6-g2-v1/vendor-manifest.json match Jazzy candidate d837f2e byte-for-byte. Verified each local catalog document SHA-256 against R2a manifest, computed Git blob hash including header, compared to the official Jazzy recursive tree. Detail: adjacent research-xarm-model-source-parity-20261114.json. This covers the imported descriptions, kinematics, inertia, joint limits, mesh sources and license. It does NOT verify native expanded URDF, plugin behavior, generated limits, tool frames or native runtime; L03 still needs explicit G2/1305 options and readback/mapping. Existing humble asset lock stays untouched.

## L00 provenance handoff — ruling78
Consume L00 R78 installation mode from the locked native subject profile and L02 host inventory; native_apt and OCI have distinct provenance requirements. Unknown native package/plugin locks remain unresolved, not fabricated from the source vendor commit. Do not borrow a different profile/ISA or use this mode to bypass image-bound MuJoCo gates.

## Generated native mapping attachment — controller ruling86
Ruling: R86 adds an optional nativeMapping artifact role to native-handoff-v1 for the xarm_ros_canonical_v1 subject: exactly two references for captured expanded URDF and its mapping/readback record. Existing manifests remain valid and canonical model/tool/engine roles retain their meaning. Apply existing bounded path, symlink, size, hash, subject identity and secret checks, plus a closed xArm semantic reader binding the raw URDF, canonical model/profile, producer identity, joint/tool/plugin mapping and actual-versus-double evidence kind. These produced artifacts must not substitute for immutable runtime/tool closure membership or clear host/package/execution prerequisites. Missing mapping remains a prerequisite; malformed, mismatched, wrong-kind or cross-profile artifacts fail closed. Reason: model is intentionally singular and engine/tool refs must belong to the committed closure; generated native readback is neither canonical input nor immutable tooling. Cost if wrong: an extra artifact role could admit spoofed mapping or blur subject/observer provenance; require coherent-resealed negatives, cross-role/closure-confusion checks and independent review. Static consistency never authenticates a host or proves native motion/contact, and old evidence bytes/identities remain unchanged.

## Canonical1305 selection — controller ruling87
Ruling: R87 uses the fixed simulation-only model selector XI13050520BB00 through the pinned upstream robot_sn launch argument, explicitly named and documented as syntheticSimModelSelector, never a hardware serial or identity. The pinned parser decodes xArm6, model1305, dateCode2005, HD B and HT_BR2 inertia; model1300=false alone does not choose1305. Keep the selector server-owned, bind it to profile/launch/mapping provenance and verify decoded variant plus actual expanded-URDF limits/geometry/inertia. Do not accept browser substitution, infer a device exists or reuse this value as commissioning evidence. Reason: this selects the existing canonical1305 model through immutable upstream semantics without patching vendor code. Cost if wrong: an incorrect or changed decoder could choose different geometry/limits, or synthetic identity could leak into physical claims; pin decoder bytes, test wrong/older selectors and retain independent expanded readback plus distinct physical dossier prerequisites. Native expansion/execution remains not_run until its real prerequisites are met.
Official pinned sources: https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/common/common.link.xacro (91–158, 202–216), and xarm_description/urdf/xarm6/xarm6.urdf.xacro (13–39). Root independently read these via web and decoded the fixed string; this is not xacro/native execution.

## Prepared-code versus native qualification gate — ruling88
Ruling: R88 tracks L03 prepared-code review and required native qualification as separate gates, applying the existing no-assigned-host preparation scope to review finding L03-R1-05. Fix L03-R1-01 through04 as code defects; retain R1-05 as an unmet external qualification requirement, never ADDRESSED/pass from portable tests or documents. After the prepared-code gate is independently clean, continue downstream portable L04/L05 and qualification tooling while the L03 native gate remains incomplete/not_run. Required actual X1/X2 provenance, expansion, motion/fault/stop/controller-restart evidence and X3 ten contact trials or observed unsupported result remain unchanged for a later authorized matching host. Same-run reopen refusal is not controller-restart proof; direct FollowJointTrajectory is not collision-planned motion; G2 not-observed is not demonstrated unsupported. Report any locally actionable preparation gap separately rather than hiding it under absent-host status. Reason: the user asked for web-first work ready for a future Linux host and supplied no native target; repeatedly dispatching code fixes cannot produce missing host evidence. Cost if wrong: portable preparation can still contain native integration/contact defects, so final handoff and L06 must expose the incomplete scope and refuse native gates until their actual evidence exists. This is scope/sequence disposition, not an early waiver of a code finding or a completed native task.
