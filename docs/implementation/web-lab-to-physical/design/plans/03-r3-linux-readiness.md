# R3 Linux and Physical Readiness — Implementation Plan

**Hiện trạng sau N1, 16/11:** [kết quả mới](../../post-n1-final-recording/status.md), [tái hiện](../../post-n1-final-recording/reproduce.md) và [disposition](../../post-n1-final-recording/dispositions.md) dùng Source `0d46403` / Lab `7c97b20`. Review giữ verdict lịch sử ở tuple/scope đã nêu; capture mới và bốn assertions mock chưa giải quyết, native/physical chưa nghiệm thu. Các snapshot/kế hoạch cũ bên dưới giữ ngày và identity riêng.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bàn giao gói có thể kiểm trên Linux, triển khai các đường native còn thiếu và chuẩn bị cả xArm/ROS 2 lẫn PUMA/LinuxCNC cho lúc chọn phần cứng.

**Architecture:** Handoff khóa model/profile/input; native lifecycle có authority thời gian riêng; source điều phối business/custody. Mỗi host và arm profile có evidence riêng. Lab chỉ chạy simulation và đọc replay.

**Tech Stack:** Toolchain theo [Global Constraints](README.md#global-constraints); Ubuntu 24.04/Jazzy/Harmonic cho ROS; Debian 12 candidate riêng cho LinuxCNC; MuJoCo giữ pin R2a cuối.

**Spec:** [R3](../04-r3-linux-physical-readiness-spec.md), [contracts/evidence](../03-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). L00/L05 chuẩn bị được khi chưa có Linux. L01–L04 chỉ ghi native tested khi chạy đúng host/profile và lưu raw evidence. Không sửa kết quả Mac, không chọn hardware thay người dùng, không provision hoặc bật motion trong khi viết tài liệu này.

## Task L00 — Handoff schema, validator và hồ sơ host

**Dependency:** B00; có thể làm trước B05–B10. Gói bàn giao R2b được tạo lại khi input/runtime thay đổi.

**Files:**

- Create `source/packages/contracts/schemas/native-handoff-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/sil/native-handoff.ts`, `source/scripts/native-handoff.mjs`.
- Modify `source/scripts/native-sim/{host-preflight,profile-report}.mjs` để dùng inventory/identity checks chung, giữ API cũ.
- Create `source/docs/operations/native-simulation-handoff.md`, `source/tests/unit/native-handoff.test.ts`, `source/tests/security/native-handoff.test.ts`.

**Interfaces:** `validateNativeHandoff(root,manifest,inventory?)` trả `{prepared:boolean,nativeReady:boolean,issues:Issue[]}`; mỗi issue có code/path/severity. `nativeReady` chỉ là prerequisites cho chạy, chưa phải qualification. CLI mới `native-handoff.mjs export --input INPUT_DIR --out NEW_DIR` và `verify --input DIR [--inventory FILE]`; export chỉ copy các refs được schema cho phép, không chạy shell/launch từ manifest.

- [ ] Test gói hợp lệ chưa có host → `prepared:true,nativeReady:false`; thiếu hash/schema/frame/model → prepared false. Gói đã khai Linux native nhưng origin là Mac/emulated hoặc không biết origin → nativeReady false.
- [ ] Test symlink/path traversal/oversized archive/hash mismatch, lock unresolved và host arch khác. Test xArm inventory không đủ cho PUMA, arm64 không đủ cho amd64.
- [ ] Implement schema/validator/export. Manifest liệt kê source/Lab tuple, engine/tool hashes, project/world/model/profile refs, seeds, case policy, frames/units và required/forbidden packages; secrets/tunnel private key không đi vào gói.
- [ ] Chuẩn hóa host inventory: OS/kernel/ISA/CPU, platform image digest, virtualization/origin/emulation khai rõ, software hashes, clock domains. Không suy “Linux native thật” chỉ từ `process.platform` trong container.
- [ ] Viết runbook từng bước cho người nhận: verify → resolve host profile → doctor → smoke → cases → archive/verify → reviewer. Ghi kết quả dự kiến khi chưa có host là not_run/blocked_external.
- [ ] Run focused checks và contracts generation; commit `feat: prepare verifiable native simulation handoffs`; re-pin nếu runtime/schema đổi.

Test đầu tiên:

```ts
// fixture builders của test tạo file trong mkdtemp, không dùng native inventory giả làm evidence.
const result = await validateNativeHandoff(root,validManifest,undefined);
expect(result.prepared).toBe(true);
expect(result.nativeReady).toBe(false);
expect(result.issues.map(x => x.code)).toContain('HOST_INVENTORY_MISSING');
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/unit/native-sim-host-preflight.test.ts
pnpm contracts:generate
pnpm contracts:check
```

**Exit:** DEP-PREP-01 đạt; gói có thể mang sang host. Không đóng native gate.

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

## Task L05 — Target dossier và conformance chuẩn bị physical

**Dependency:** L00; làm được trước Linux. Target undecided là trạng thái hợp lệ của dossier, nhưng luôn không đủ cho live admission.

**Files:** Create `source/packages/contracts/schemas/physical-target-dossier-v1.schema.json`, `source/packages/lab-runtime/src/commissioning/target-dossier.ts`, `source/docs/operations/physical-target-selection.md`, `source/docs/operations/arm-commissioning-preparation.md`; modify `source/docs/operations/robot-commissioning.md` chỉ để link nhánh arm khi triển khai. Test `source/tests/unit/physical-target-dossier.test.ts`, `source/tests/security/physical-target-admission.test.ts`.

**Interfaces:** `assessTargetDossier(value)` trả `{structurallyValid,readiness:'prepared'|'incomplete',missing,branchRequirements}`. Dossier không tự phát hành commissioning manifest và không cấp `live:true`. `targetKind:'undecided'` chứa prerequisites cả hai arm paths; chassis và arm dùng schema/profile đúng loại.

- [ ] Test undecided/unknown vendor/firmware/SDK/serial luôn bị hardware admission từ chối; thiếu measured calibration/observer/signature cũng không được nâng cấp. Test signed simulation record không trở thành hardware_validated.
- [ ] Tạo template không có register/pinout/speed/force “mặc định chạy được”; mỗi field cần nguồn vendor/measurement/owner. Mô tả cách chọn xArm hoặc custom/PUMA theo host/controller/tool/safety/latency/maintenance, chưa gán người dùng một lựa chọn.
- [ ] Viết conformance checklist adapter: command IDs/idempotency, owner lease, boot/control epoch, deadline, freshness, disconnect→unknown, local stop, manual recovery. Doubles chỉ kiểm contract, không qualification robot.
- [ ] Tái dùng validator/chữ ký commissioning chassis hiện có đúng scope. Thêm arm dossier validator riêng; test keys không dùng để ký live manifest. Giữ `active-motion` refusal khi vendor interface chưa có.
- [ ] Runbook calibration dùng dữ liệu đo thật và protocol hiện có; tune/validation tách, ít nhất 3 validation trials độc lập mỗi điều kiện, units/frame/time/model revision đầy đủ. Limits vận hành chờ hardware/vendor/operator xác lập trước motion.
- [ ] Chốt đường triển khai physical qua source/coordinator → robotics agent/cell gateway → vendor/controller; Lab không có credential/route hoặc backend toggle đi hardware. Ghi cần task driver riêng sau hardware selection.
- [ ] Run focused schema/admission tests, đọc lại dossier từ góc người nhận; commit `docs: prepare both physical arm commissioning paths` cùng schema/validator nếu đã implement, re-pin phần schema cần thiết.

```ts
const result = assessTargetDossier(undecidedDossierFixture());
expect(result.structurallyValid).toBe(true);
expect(result.readiness).toBe('incomplete');
expect(result.branchRequirements.map(x => x.branch)).toEqual(['xarm_ros2','custom_linuxcnc']);
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physical-target-dossier.test.ts tests/security/physical-target-admission.test.ts
pnpm contracts:check
```

**Exit:** PHYS-PREP-01 đạt, thiếu gì để chọn và chạy robot rõ ràng. G-HW/calibration/venue acceptance còn nguyên trạng thái cho tới evidence thật.

## Task L06 — Qualification theo profile và bàn giao có thể tái lập

**Dependency:** L00/L05; thu thêm mỗi native branch đã thực hiện. Không bắt nhánh xArm phải chờ PUMA hoặc ngược lại.

**Files:** Modify `source/scripts/{record-sim-extension,sim-extension-qualification}.mjs`, `source/tests/unit/sim-extension-qualification.test.ts`; create `source/docs/operations/native-profile-case-matrix.md`. Evidence mới ở `source/docs/implementation/evidence/sim-extension/r3-<profile>-candidate-NN/` sau clean recording.

**Interfaces:** recorder extension `--release r3 --handoff DIR --native-records DIR --profile PROFILE --scope SCOPE --out NEW_DIR`; đây là flags cần implement, chưa có ở baseline. Allowed scope enum theo profile: `prepared`, `motion`, `contact`, `terminal`, `full`. Matrix quyết định required cases; không nhận danh sách pass tùy ý để hạ yêu cầu.

- [ ] Negative tests: doctor-only; fake evidence vào native; một architecture thay architecture khác; PUMA đóng xArm; motion đóng contact; missing raw bag/controller traces; gate tested trong khi case required skipped; sidecar hash sai. Tất cả phải từ chối qualification phạm vi đó.
- [ ] Recorder đọc inventory/inputs/artifacts rồi recompute verdict; record luôn `accepted:false`. `prepared` không có G-NATIVE tested; native subset ghi capabilities đã kiểm và cases còn missing.
- [ ] Mỗi host giữ exact source/schema/input identity chung và tool/engine/OS riêng. Không ép hashes thư viện giữa hai ISA giống nhau; không suy performance portable từ một CPU.
- [ ] Ghi hướng dẫn người nhận: install/verify profile → doctor → case commands → verify → replay/export → reviewer. Bao gồm cleanup/rollback thuộc run của mình, không kill service unrelated.
- [ ] Chạy required checks cho code thay đổi và guard qualification; collect ở directory mới ngoài tree. Sau review record mới đưa evidence vào repo; không rewrite historical evidence để giảm blockers.
- [ ] Bàn giao bảng ba mức R3.0/R3.1/R3.2, kết quả theo từng profile, known failures và next action cụ thể. Người có trách nhiệm quyết định acceptance bằng sidecar đúng hash/scope.

**Exit:** người khác xác định được việc nào đã kiểm trên host nào, việc nào mới prepared và phần nào còn chờ phần cứng. Không ghi “R3 physical done” từ software-only evidence.
