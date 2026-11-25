# 03 — Beverage Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy tay máy thương mại gắp/đặt cốc bằng tiếp xúc và nối BV01 vào workflow hiện hữu.

**Architecture:** Arm, cup, AMR và process mass nằm trong world B03. MoveIt lập kế hoạch, ros2_control thực thi; source journal/custody quyết định chuyển tiếp.

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
| new | `source/robotics/manipulation/{package.xml,CMakeLists.txt,launch/engineering_arm.launch.py,config/}` | Package `mekoniq_manipulation`, vendor model và MoveIt/controller config |
| new | `source/robotics/simulation/bridge/{engineering_arm,contact_transfer,coffee_process}.py` | Arm plan/execution, contact assessor, process plant |
| new | `source/packages/lab-runtime/src/engineering/{arm-adapter,coffee-plant}.ts` | Map native ports vào workflow |
| modify | `source/packages/lab-runtime/src/v2/arm/{adapter,session}.ts` | Provider routing giữ stage/start/epoch |
| modify | `source/packages/lab-runtime/src/v2/beverage/{coffee-ports,plant-session,cup-ledger}.ts` | Guard/observation integration |
| modify | `source/packages/lab-runtime/src/v2/scenarios/coffee.ts`, `source/packages/lab-runtime/src/v2/sil/native-providers.ts` | Inject profile mới, không copy state machine |
| new | `source/robotics/simulation/tests/test_engineering_{arm,transfer,process}.py` | Pure contracts/assessors và native cases tách marker |
| new | `source/tests/integration/engineering-bv01.test.ts` | Domain/custody/recovery regression |

### C01 — xArm model và trajectory adapter

**Dependencies:** A02/B01/B02. **Interfaces:** engineering_arm.py exports `validate_plan(plan: dict, scene_digest: str) -> list[str]`; native arm bridge nhận staged trajectory digest và returns correlated joint observations. TS `EngineeringArmAdapter` implements arm adapter contract hiện có, không tạo business command protocol mới.

**Files:** manipulation package, engineering_arm.py, arm-adapter.ts, existing arm adapter/session; new arm test. Pin vendor dependencies trong `source/robotics/manipulation/vendor.lock.json`; license manifest từ A02.

- [ ] Test wrong scene/joint names/limits, unreachable pose, tool TCP mismatch và stage-before-start:
  ```python
  def test_stale_plan_is_rejected():
      from bridge.engineering_arm import validate_plan
      plan = {"sceneDigest": "a" * 64, "jointNames": [], "points": []}
      assert "SCENE_STALE" in validate_plan(plan, "b" * 64)
  ```
  Positive plan fixture phải có đúng joint names/limits từ vendor import; không reuse empty fixture để pass.
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_engineering_arm.py -q`.
- [ ] Import xArm 6 model + tool frames, configure MoveIt planning scene from bundle and trajectory controller backed by Gazebo joint feedback. Admission core:
  ```python
  if plan["sceneDigest"] != scene_digest:
      return ["SCENE_STALE"]
  ```
  Implement limits/trajectory-time/self-world checks, cancel-stop observation, lease/epoch/timeouts. No hardware driver launch or SDK IP. Validate visual/collision/inertia and flange/TCP mapping against vendor revision.
- [ ] GREEN pure tests; native build `colcon build --base-paths robotics/manipulation --packages-select mekoniq_manipulation` after dependency workspace setup. Run V08 reachable/unreachable/collision, measure joint feedback/TCP; launch command **new** `ros2 launch mekoniq_manipulation engineering_arm.launch.py bundle_dir:=/var/tmp/engineering-arm-bundle`, bundle prepared by B02. Native smoke must reject hardware interface selection.
- [ ] Commit: `feat: simulate xarm trajectories with observed physics feedback`.

### C02 — Contact grasp, release và independent receiver

**Dependencies:** C01/B03; consumes PhysicsSample and cup/jaw model. **Interfaces:** `assess_transfer(samples: list[dict], policy: dict) -> dict` in contact_transfer.py returns `{status:'confirmed'|'rejected'|'unknown', reasons:list[str], evidenceRefs:list[str]}`. Policy includes pinned thresholds, stage/cup/transfer IDs and expected epoch. Gripper, cup pose và tray contact/load là streams độc lập.

**Files:** contact_transfer.py, test_engineering_transfer.py; modify engineering worker/controller config and cup-ledger mapping; new `source/tests/integration/engineering-transfer.test.ts`.

- [ ] Test completed command/no contact không đủ confirmation; hold drift/release/tray/stale/reordered/duplicate/low friction cases:
  ```python
  def test_completion_is_not_grasp():
      from bridge.contact_transfer import assess_transfer
      result = assess_transfer(
          [{"kind": "command_complete", "simTimeNs": "1000000000"}],
          {"stage": "pick", "cupId": "cup-1", "epoch": 1})
      assert result["status"] != "confirmed"
      assert "GRASP_EVIDENCE_MISSING" in result["reasons"]
  ```
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_engineering_transfer.py -q`; TS integration test RED.
- [ ] Implement contact/jaw/cup lift assessor và receiver settling window đúng spec; cup dynamic gravity on, friction/contact constraints versioned. Core guard:
  ```text
  grasp_confirmed =
    matching_identity AND fresh_samples AND bilateral_contact
    AND measured_lift >= 0.05 m AND stable_hold >= 1 s AND relative_drift <= 0.005 m
  release_confirmed =
    jaws_released AND receiver_contact_stable >= 0.5 s AND cup_inside_slot
  ```
  Stage-specific schemas enforce mandatory fields before evaluate. Missing samples => unknown, observed failed grasp => rejected. Planning attachment updates only after confirmation; no physical fixed joint/setPose to synthesize success.
- [ ] GREEN portable + native V09/V10: normal grip, reduced friction/force drop, gripper opens, AMR drift. Inspect engine SDF: cup not kinematic/gravity-off. Record actual contact streams before SSE; failed negative case must prevent custody success.
- [ ] Commit: `feat: confirm cup transfers from physical contact evidence`.

### C03 — Process plant và variable cup mass

**Dependencies:** A02/B02, can precede C02. **Interfaces:** `step_process(state: dict, model: dict, dt_s: float) -> dict` in coffee_process.py returns resource/volume/mass/temperature/status; TS EngineeringCoffeePlant implements existing coffee plant port. ModelRef resolves version 1 process schema defined in A02.

**Files:** coffee_process.py/test_engineering_process.py, coffee-plant.ts; modify plant-session/native-providers/worker; new `source/tests/integration/engineering-process.test.ts`. Fixture `source/tests/fixtures/engineering/process-200ml.json`.

- [ ] Test 200 ml→0,2 kg, conservation, zero/negative dt, stockout/no cup/blocked flow/sensor bias and unavailable temperature:
  ```python
  def test_blocked_flow_does_not_create_mass(process_fixture):
      from bridge.coffee_process import step_process
      state = {"volumeMl": 0.0, "cupMassKg": 0.02, "waterMl": 1000.0,
               "cupPresent": True, "blockedFlow": True}
      result = step_process(state, process_fixture, 1.0)
      assert result["cupMassKg"] == 0.02
      assert result["waterMl"] == 1000.0
  ```
  process_fixture locally loads process-200ml.json with nominal flow 20 ml/s, density 1000 kg/m³ and declared assumed sources.
- [ ] RED: `python3 -m pytest robotics/simulation/tests/test_engineering_process.py -q`; `pnpm exec vitest run tests/integration/engineering-process.test.ts`.
- [ ] Implement integrated flow/resource/thermal model, finite dt validation and stage deadlines:
  ```text
  delivered_ml = min(flow_ml_per_s * dt_s, remaining_recipe_ml, reservoir_ml)
  delta_mass_kg = delivered_ml * 1e-6 * density_kg_per_m3
  ```
  Freeze process on simulation pause. Apply mass/COM/inertia change in engine through verified update path; preserve entity/pose/velocity/custody on stage-boundary fallback. Fail VARIABLE_MASS_UNSUPPORTED if neither path works. Sensor observation separate from actual process state for fault testing.
- [ ] GREEN portable + native V11: load/weight/acceleration response reflects filled cup mass; no teleport during mutation; mass conservation ≤0,1% reference fixture. Existing coffee resource/conservation suites still pass.
- [ ] Commit: `feat: simulate beverage flow and cup mass changes`.

### C04 — BV01 orchestration và fault/recovery

**Dependencies:** B03/C02/C03. **Interfaces:** same CoffeeDriver/coffee ports/cup ledger contracts; enable providers `moveit_gazebo_arm` và `engineering_coffee_process` trong backend set `engineering-contact-v1` đã đăng ký ở B03. Add PhysicsSample→existing observation mapper with transfer/command/epoch/bundle identity. No separate engineering business state machine; giữ `coffee-simulation` → LinuxCNC/coffee_io_sim và mock-default → mock ports.

**Files:** existing coffee workflow/ports/ledger/native providers; engineering-bv01.test.ts; new scenario fixture `source/tests/fixtures/engineering/bv01.project.json`; modify `source/packages/lab-runtime/src/v2/fault-schedule.ts` and `source/packages/lab-runtime/src/v2/sil/native-fault-oracle.ts`.

- [ ] Tests complete sequence and restart between release/receiver confirmation, duplicate transfer, arm clearance before depart, no auto served. Extend tests/support/engineering.ts with `runEngineeringBv01Fault(name: 'restart-after-release'|'missing-receiver'|'normal'): Promise<{motionReplays:number; transfersConfirmed:number; served:boolean; attention:boolean}>`; helper runs real source workflow with recorded plant fixtures:
  ```ts
  const result = await runEngineeringBv01Fault('restart-after-release');
  expect(result.motionReplays).toBe(0);
  expect(result.served).toBe(false);
  expect(result.attention).toBe(true);
  ```
- [ ] RED: `pnpm exec vitest run tests/integration/engineering-bv01.test.ts`.
- [ ] Inject providers, enforce pre-pick/post-grasp/pre-release/post-release guards and domain confirmation. Keep uncertainty until independent receiver reconcile. Fault admission:
  ```ts
  if (!provider.supportedFaults.includes(fault.kind)) {
    throw new Error('FAULT_UNSUPPORTED_BY_PROFILE');
  }
  ```
  Add friction/saturation/dropout/force/flow/drift fault mappings with once identity, bounded durations and native observations; no command replay on crash.
- [ ] GREEN + existing `tests/integration/lab-v2-bv01-ports.test.ts`, `lab-v2-bv01-recovery.test.ts`, `lab-v2-cup-ledger.test.ts` in same directory. Native command **supported after this task**, using B03 CLI extension:
  ```sh
  node scripts/lab-sil.mjs run --scenario BV01 --seed 23 --repeat 3 --backend-set engineering-contact-v1 --environment-profile engineering-arm64 --engineering-project tests/fixtures/engineering/bv01.project.json --out /var/tmp/engineering-bv01-23
  node scripts/lab-sil.mjs verify --input /var/tmp/engineering-bv01-23
  ```
  Repeat seeds 41/67 with new output paths; execute negative cases V09–13. Missing native environment never satisfies this checkbox.
- [ ] Hoàn tất V18/V19 với native providers thật: engineering BV01 chạy khi LinuxCNC không enabled; legacy giữ dependency cũ và không bị chặn bởi thiếu MoveIt. Fault support, report provider identities và readiness đều theo set. Restart/reclaim không replay motion, giữ bundle/scene snapshot và quyền đọc sau pairing mới. Portable regression bắt buộc: `pnpm exec vitest run tests/integration/engineering-profile-routing.test.ts tests/integration/lab-v2-mixed.test.ts tests/integration/lab-v2-scenario-matrix.test.ts tests/integration/lab-v2-native-gateway.test.ts`; không đổi các scenario/recipe IDs cũ để làm test pass.
- [ ] Commit: `feat: integrate physical beverage transfers with shared workflow`.

**Exit:** G2 is eligible only with real native contact evidence and negative tests, not just source fixture tests. Machine process model and cup rigid-body assumptions stay visible.

