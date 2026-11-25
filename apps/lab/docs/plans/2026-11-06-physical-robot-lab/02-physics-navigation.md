# 02 — Physics & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy FD01 với model từ assembly, sensor và controller trong Gazebo; ghi đúng fidelity actuator.

**Architecture:** Tái dùng native lifecycle/Nav2 bridge. Compiler mới nhận resolved assembly, xuất cùng scene cho UI và world cho engine; không thay legacy compiler path.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest, Python/pytest, Ubuntu 24.04, ROS Jazzy, Gazebo Harmonic, Nav2, MoveIt 2, ros2_control.

**Spec:** [Spec chính](../../specs/2026-11-06-physical-robot-lab/README.md), [chi tiết](../../specs/2026-11-06-physical-robot-lab/simulation-runtime.md).

## Global Constraints

- Node 24.22.2; pnpm 10.32.1; dependencies khóa theo lockfile, không nâng major để hoàn thành task.
- Business authority/contracts/adapters ở `source/`; presentation/project UX ở `lab/`.
- Không sửa `trial/`, không chạm robot hoặc cổng `1880`/`1884`; UI/runtime loopback `4175`/`4176`.
- Mỗi run khóa mode, seed, backend versions, model/world/recipe/profile revisions và clock domains.
- UI Việt/Nhật/Anh; mọi nhãn kết quả phải nêu provenance và không nâng simulation thành hardware evidence.
- Native test thiếu môi trường ghi `not_run` với blocker; test đã chạy sai assertion ghi `fail`.
- Không export dirty source; không ghi secrets, VM disk, SSH private key hoặc signing key vào Git.
- Không xóa dữ liệu host để provision VM; storage và RAM preflight phải đạt trước khi tải image lớn.
- Engineering profile không tự fallback sang mock, legacy hoặc hardware khi thiếu capability.
- Giữ toàn bộ chức năng và dữ liệu hiện hữu theo NR01–NR12; giới hạn MVP engineering không áp dụng cho các profile cũ.

---

## File map

| Trạng thái | Paths | Trách nhiệm |
|---|---|---|
| modify | `source/robotics/simulation/bridge/native_profile.py`, `source/scripts/lab-sil.mjs` | Doctor/profile và CLI extension |
| new | `source/robotics/simulation/profiles/engineering-{arm64,amd64}.lock.json` | Lock/inventory riêng từng target |
| new | `source/robotics/simulation/compiler/engineering.py` | Compile ResolvedAssembly thành bundle |
| modify | `source/robotics/simulation/compiler/compile_world.py` | Reuse helpers có chủ đích, giữ legacy entrypoint |
| new | `source/robotics/simulation/bridge/engineering_worker.py`, `source/robotics/simulation/launch/engineering.launch.py` | Single world, controllers và observations |
| modify | `source/packages/lab-runtime/src/v2/{backend-registry,capabilities}.ts`, `source/packages/lab-runtime/src/v2/sil/{cli,native-providers,native-lifecycle}.ts` | Đăng ký profile/route lifecycle |
| modify | `source/packages/lab-runtime/src/v2/{scenario-matrix,readiness,gateway,scenario-runner}.ts`, `source/packages/lab-runtime/src/v2/sil/campaign.ts` | Requirements theo backend set xuyên health/admission/CLI/report |
| new | `source/packages/lab-runtime/src/engineering/physics-adapter.ts`, `source/robotics/simulation/metrics/engineering.py` | Schema ingest, identity, metrics |
| new | `source/robotics/simulation/plugins/engineering_actuator/` | Chỉ B04: bounded actuator khi stock controller không đáp ứng |

### B01 — Native environment spike và lock thực tế

**Dependencies:** độc lập A01. **Interfaces:** consumes native doctor/report hiện có; produces environment IDs `engineering-arm64`, `engineering-amd64`, report `{prerequisitesMet:boolean, checks, actualInventory, reportSha256}` theo validator hiện hữu. Chưa probe target nào thì target đó not_run, không copy inventory.

**Files:** profile/doctor/CLI trong map; new `source/robotics/simulation/tests/test_engineering_profile.py`; new `source/docs/engineering-lab/native-environment.md`.

- [ ] Trên host chạy preflight hiện có với thư mục VM thực, không hardcode dung lượng cũ: `node scripts/native-sim/host-preflight.mjs --vm-root /var/tmp` từ source là kiểm filesystem /var/tmp, chỉ dùng nếu đó là nơi sẽ đặt image. Ghi actual path/resources. Nếu chưa đủ, lưu blocker; không xóa dữ liệu hoặc tải image.
- [ ] Viết profile validator test với inventory mismatch và absent native dependency:
  ```python
  def test_wrong_architecture_is_not_qualified():
      from bridge.engineering_profile import qualify_inventory
      report = qualify_inventory(
          {"os": "ubuntu24.04", "arch": "arm64", "packages": {}},
          {"os": "ubuntu24.04", "arch": "amd64", "packages": {}})
      assert report["qualified"] is False
      assert "ARCHITECTURE_MISMATCH" in report["reasons"]
  ```
  New `bridge/engineering_profile.py` exports `qualify_inventory(actual: dict, locked: dict) -> dict`; native_profile.py delegates engineering IDs to it.
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_engineering_profile.py -q`. Install approved target dependencies only in isolated Linux environment with sufficient capacity; capture apt package versions, vendor commit, ROS/engine/controller versions, architecture and compiler.
- [ ] Implement lock comparison and doctor checks for Nav2/MoveIt/gz_ros2_control, no hardware plugins in selected config:
  ```python
  reasons = []
  if actual["arch"] != locked["arch"]:
      reasons.append("ARCHITECTURE_MISMATCH")
  # Compare each required package/version and model/plugin digest as separate checks.
  return {"qualified": not reasons, "reasons": reasons}
  ```
  Run a minimal Gazebo world plus controller manager and sensor topic; preserve actual commands/logs in environment runbook. Record memory and RTF, missing packages, display/headless behavior.
- [ ] GREEN portable test; native doctor command **enabled by this task**: `node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-arm64 --json`. Expected 0 with complete inventory on qualified ARM64 Linux; 2 with explicit blockers elsewhere. A minimal-world smoke is required before marking environment qualified.
- [ ] Commit: `feat: qualify engineering native environment profiles`. Keep raw system secrets and VM images outside repo.

### B02 — Deterministic assembly compiler

**Dependencies:** A03, A04 compiler port. **Interfaces:** Python `compile_engineering(input: dict, out_dir: Path) -> dict` in compiler/engineering.py. Input is the full EngineeringCompileInput from A03 validated against exported schema, including project/world, resolved assembly, runtimeProjection/assets and recipes. Returns `sceneDigest` and sorted `files[{path,sha256}]` consumed by A04's `compileResolved` subprocess adapter; no network calls. Reject bare ResolvedAssembly as incomplete input.

**Files:** compiler files in map; new `source/robotics/simulation/tests/test_engineering_compiler.py`, `source/tests/fixtures/engineering/compile-radius-075.json`, `compile-radius-100.json`; new `source/packages/lab-runtime/src/engineering/compiler.ts`. Fixtures are complete EngineeringCompileInput generated by A03 and hash-checked, not manually different models.

- [ ] Write V01/V03 checks on emitted URDF/scene/controller files, content hashes, BOM and map transforms:
  ```python
  import json
  import xml.etree.ElementTree as ET
  import yaml
  from pathlib import Path
  def test_wheel_radius_has_one_source(tmp_path):
      from compiler.engineering import compile_engineering
      src = Path("tests/fixtures/engineering/compile-radius-100.json")
      result = compile_engineering(json.loads(src.read_text()), tmp_path)
      scene = json.loads((tmp_path / "scene.json").read_text())
      assert scene["wheelBindings"]["amr-1/left"]["radiusM"] == 0.1
      urdf = ET.parse(tmp_path / "robots/amr-1.urdf")
      cylinder = urdf.find(".//link[@name='amr-1/left_wheel']/collision/geometry/cylinder")
      assert cylinder is not None
      assert float(cylinder.attrib["radius"]) == 0.1
      cfg = yaml.safe_load((tmp_path / "controllers/amr-1.yaml").read_text())
      assert cfg["diff_drive_controller"]["ros__parameters"]["wheel_radius"] == 0.1
      old = Path("tests/fixtures/engineering/compile-radius-075.json")
      old_result = compile_engineering(json.loads(old.read_text()), tmp_path / "old")
      assert result["sceneDigest"] != old_result["sceneDigest"]
  ```
  PyYAML là dependency của compiler/test environment phải được pin trong B01; không cài global trên host chỉ để chạy test.
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_engineering_compiler.py -q`.
- [ ] Implement canonical byte/hash parity with source hashing, SI transforms, explicit joints and inertials, model refs, scene mapping, controller/Nav2/MoveIt outputs. Wheel source:
  ```python
  resolved = input["resolved"]
  wheel_radius = resolved["models"]["drive"]["wheelRadiusM"]["value"]
  # Feed this same value into URDF geometry, controller config and scene binding.
  ```
  Dùng ResolvedAssembly `models` đã định nghĩa trong bundle schema tại A03; input references vẫn là ModelRef[]. Reject missing wheelRadiusM instead of box-derived fallback. Fixed joints retain original-link mapping. World/map/bindings từ input.runtimeProjection.project.world; preserve original/projected inputs và full hashes trong bundle theo spec, không đóng gói chỉ robot mesh.
- [ ] Thêm V17 golden fixtures bằng cách sửa project rồi chạy lại A03: obstacle/world bounds đổi → map.pgm + scene + map.identity đổi; table/handoff/yaw đổi → bindings/goal đổi (map.pgm không bắt buộc đổi); speedLimitMps đổi → controller/Nav2 limit và projection admission đổi. Với cùng assembly, hai world khác nhau phải có bundle identity khác nhau. Thiếu world/projection hoặc hash không khớp phải reject, không đọc fixture mặc định. Kiểm exact custom IDs/coordinates thay vì chỉ assert hash khác.
- [ ] GREEN focused + `python3 -m pytest robotics/simulation/tests/test_world_compiler.py -q`. Add cross-language canonical golden vectors; same inputs yield same bytes, modified model yields new manifest. Legacy cup behavior stays confined to legacy path.
- [ ] Commit: `feat: compile engineering assemblies into shared simulation bundles`.

### B03 — Single-world FD01 và bounded telemetry

**Dependencies:** A04, B01, B02. **Interfaces:** physics-adapter.ts exports `ingestPhysicsSample(raw: unknown, expected: {runId:string; bundleDigest:string; epoch:number}): {accepted:boolean; reason:string|null}`; validated samples conform PhysicsSample in spec. Native worker exposes only server-selected operations `start/pause/step/stop/snapshot`, correlation/epoch framing reused from native lifecycle.

B03 cũng implements profile-aware `requiredBackends(target, mode, backendSetId?, catalog?)`, provider roles và health `scenarioRequirementsByBackendSet` đúng [runtime spec](../../specs/2026-11-06-physical-robot-lab/simulation-runtime.md#11-backend-requirements-theo-profile-giữ-đường-chạy-cũ). Giữ mapping legacy khi dùng signature cũ; mọi execution call truyền set/catalog explicit. Register engineering sets/IDs, mark MoveIt/process unavailable cho tới C01/C03. Không đổi nghĩa `simulation-default`/`coffee-simulation`.

**Files:** worker/launch/adapter/registry/lifecycle/metrics + scenario-matrix/readiness/gateway/scenario-runner/SIL campaign in map; new `source/tests/integration/engineering-physics.test.ts`, `engineering-profile-routing.test.ts`, `source/robotics/simulation/tests/test_engineering_worker.py`; extend `source/tests/fixtures/digital-twin/sil/` with engineering FD01 config.

- [ ] Test wrong digest/epoch, sequence gap/backpressure, pause clock, startup timeout and one writer per joint. Core regression:
  ```ts
  expect(ingestPhysicsSample(sample, {
    runId: sample.runId, bundleDigest: 'f'.repeat(64), epoch: sample.epoch
  })).toEqual({ accepted: false, reason: 'BUNDLE_MISMATCH' });
  ```
  `sample` is a complete valid PhysicsSample fixture with a different digest; define it in new engineering-physics test. Duplicate/reorder behavior uses the same fixture stream.
- [ ] RED: `pnpm exec vitest run tests/integration/engineering-physics.test.ts tests/integration/engineering-profile-routing.test.ts`; `python3 -m pytest robotics/simulation/tests/test_engineering_worker.py -q`.
- [ ] V18 routing fixtures dùng real scenarioRegistry/defaultCatalog mở rộng; test resolver và gateway/readiness/CLI với injected probes không claim native. Assert:
  ```ts
  const bv01 = scenarioRegistry.get('BV01')!;
  expect(requiredBackends(bv01, 'simulation', 'coffee-simulation', catalog))
    .toEqual(['gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim']);
  expect(requiredBackends(bv01, 'simulation', 'engineering-contact-v1', catalog))
    .toEqual(['gazebo_nav2', 'moveit_gazebo_arm', 'engineering_coffee_process']);
  expect(requiredBackends(bv01, 'simulation')).toEqual(['gazebo_nav2', 'linuxcnc_sim', 'coffee_io_sim']);
  ```
  Import registry/resolver từ module hiện hữu; `catalog` là server-owned catalog có roles/sets theo spec. Test absent LinuxCNC/MoveIt độc lập, unsupported engineering scenario, mismatched mode/set, engineering readiness refs; legacy FD02-cups/campaign requirements không đổi.
- [ ] Implement lifecycle stages from spec, single /clock, durable evidence queue before SSE, sensor/odom vs truth separation and profile selection. Native tests assert stop/attention on missing samples; UI command cannot write ground truth.
  ```python
  if sample["epoch"] != active_epoch:
      raise RuntimeError("EPOCH_MISMATCH")
  if evidence_queue.full():
      pause_world()
      raise RuntimeError("EVIDENCE_GAP")
  ```
  `pause_world` is worker-local function using existing scene control; failure to pause also stops the run. Do not infer run pass from received telemetry count alone.
- [ ] Wire cùng resolver vào tất cả callers `requiredBackends`/`admitScenario`, cả manifest.adapterHash, snapshot.backends/model label và health fields; native factory chọn worker theo backend set/bundle. Preserve engineeringRef/lockedInput qua native lifecycle/checkpoint/reclaim; metadata không được hardcode LinuxCNC cho MoveIt. GREEN thêm `tests/integration/lab-v2-scenario-matrix.test.ts`, `lab-v2-readiness.test.ts`, `lab-v2-native-gateway.test.ts`, `lab-v2-mixed.test.ts`, `lab-v2-sil-campaign.test.ts`; review không còn mode-only resolver trên execution path.
- [ ] GREEN portable commands + native FD01/obstacle/localization-loss V05/V07/V12. Extend existing CLI with **new** `--engineering-project PATH`, backend set `engineering-rigid-v1`, environment profile engineering-arm64/amd64. Store compiled bundle receipt in run inputs. Example after extension:
  ```sh
  node scripts/lab-sil.mjs run --scenario FD01 --seed 23 --repeat 3 --backend-set engineering-rigid-v1 --environment-profile engineering-arm64 --engineering-project tests/fixtures/engineering/fd01.project.json --out /var/tmp/engineering-fd01-23
  node scripts/lab-sil.mjs verify --input /var/tmp/engineering-fd01-23
  ```
  Create fixture file in this task. Output directory must be new; repeated execution selects a new path. Missing environment → exit 2, failed assertion → 1, verified → 0.
- [ ] Commit: `feat: run engineering delivery scenarios in one physics world`.

### B04 — Actuator fidelity và motion experiments

**Dependencies:** A02/B03. **Interfaces:** declarative actuator model from A02; new pure model `step_actuator(state: dict, command: dict, model: dict, dt_s: float) -> dict` in `source/robotics/simulation/bridge/actuator_model.py`. Returns joint torque/current/speed and limit flags; native plugin shares the same reference vectors, not an unrelated approximation. Ideal controller remains labeled ideal.

**Files:** new actuator model/plugin, `source/robotics/simulation/tests/test_actuator_model.py`, `source/robotics/simulation/tests/test_engineering_motion.py`; modify compiler controller generation and metrics. Add package CMake/package.xml under plugin directory only if stock ros2_control cannot enforce required model.

- [ ] Write torque-speed/current/voltage limit and zero-dt tests; analytical fixture uses declared 2 N·m cap:
  ```python
  def test_requested_torque_is_bounded(actuator_fixture):
      from bridge.actuator_model import step_actuator
      s = step_actuator({"speedRadSec": 0.0}, {"effortNm": 10.0},
                        actuator_fixture, 0.001)
      assert abs(s["effortNm"]) <= 2.0
      assert s["limited"] is True
  ```
  Add `actuator_fixture` locally with torque-speed/current/efficiency/voltage data and assumed provenance; no real motor claims.
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_actuator_model.py -q`.
- [ ] Implement bounded plant and metadata, then test which constraints stock controller actually enforces. Core envelope:
  ```text
  tau_allowed = min(torque_speed_limit(omega, voltage), current_limit * torque_constant)
  tau_applied = clamp(tau_requested, -tau_allowed, tau_allowed)
  ```
  Account gear ratio/efficiency and braking envelope explicitly. Missing torque constant/curve cannot be silently zero/default. Add native plugin only with finite-step tests and limit telemetry.
- [ ] GREEN unit tests; native V06/V07 empty/full payload straight/turn/stop with raw effort and pose. Build plugin if added via `colcon build --base-paths robotics/simulation/plugins/engineering_actuator --packages-select mekoniq_engineering_actuator`; package name is created in this task. Native plugin unavailable means actuator capability remains ideal and torque/current cases not_run.
- [ ] Commit: `feat: model actuator limits and measure delivery motion`.

**Exit:** G1 FD01 evidence on specified target; actuator verification scope explicit. No motor sizing/calibration claim from assumed curves.

