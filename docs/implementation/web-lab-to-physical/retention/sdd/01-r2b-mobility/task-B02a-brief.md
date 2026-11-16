# Task B02a — real mobile compiler, worker and measurement lock

This is the first sequential slice of B02. Read the parent brief below and B01 report at task-B01-report.md. The B02b integration slice is explicitly deferred, not omitted.

## Scope overriding the parent file checklist for this slice
- Implement Python compile_mobile.py, mobile_engine.py, drive.py and mobile routing/validation in session.py + snapshot.py as needed. Real MuJoCo 3.17.0 only; preserve arm behavior and engine pin.
- Compile canonical Serve geometry/mass/COM/inertia/axes/casters/free chassis plus free payloads and scene obstacles. Read back actual engine model with geometry/axis/pose/inertia parity tests; one AMR, no hidden chassis constraints or pose reset. Fixed sphere caster approximation is explicit provenance, not a new canonical joint.
- Finite velocity actuator: target wheel signs/frame, actual velocity driven torque curve, separate braking cap, collect actual target/velocity/torque/saturation. Profile solver/contact/friction and numerical assumptions locked and verified. MuJoCo contact friction combination may use max: do not assume a low caster geom friction beats high floor friction; make the admitted rule explicit and test circle/drag.
- Real mobile snapshot with map pose/twist, independently integrated wheel odometry, independent engine LiDAR raycast, loads/support-relative pose, canonical contact aggregation over ALL substeps, clock/unstable/capacity errors. Consult contracts spec sections 1,2,4,5 and the generated B01 types/schemas. No fake sensor output or truth-derived odometry.
- Strict scene/profile/model admission, confinement and byte hashes before engine mutation; schema errors/unknown command/invalid ID/tick cannot advance world. Existing worker session one-ACK/idempotency semantics remain. Mobile create uses navigation-scene.json, snapshot.sceneDigest is main scene digest. Existing arm create remains as-is.
- Add Python behavior/readback/clock/contact-sign/finite actuator tests and real worker tests if a small direct protocol test is useful; no TypeScript provider, runtime admission/catalog, global slot, evidence recorder, navigation runner or UI edits yet. Those belong to B02b/B03.
- Run bounded real-engine 10s hold + straight/circle/stop across empty/center/offset loads, 3 repeats, record raw probe artifacts and summary in source/docs/research/2026-11-mujoco-mobility-spike.md. Tune only declared drive/contact parameters, justify changes, then lock before any campaign. Preserve parity/finite state and repeat threshold 1e-6 m/rad; report any unsafe/failing load behavior honestly instead of changing geometry. If impossible, preserve evidence and escalate.
- Allowed fixture/generator changes: drive/contact/solver profile measurement lock, regenerated hashes, explicit assumptions resulting from probes. Keep model bytes canonical and B01 load schema/API stable; run fixture determinism/contract tests when changing generator output.
- Follow failing-test-first. Use focused Python mobile tests during iteration, then whole MuJoCo Python suite + relevant R2a worker regression once. If TypeScript/schema/fixture generator touched run appropriate contracts/typecheck/lint/fixture tests. All long commands use perl alarm and Python cache is disabled.
- Commit source only; controller handles review and clean export/Lab pin. No main edits, no deployment. Report full test evidence, remaining B02b work, final profile values, actual engine measurements and artifact paths.

## Parent B02 task for context

# Task brief B02

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md

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

## Task B02 — Compiler/worker mobile và provider thật

**Files:**

- Create `source/robotics/simulation-mujoco/mujoco_worker/compile_mobile.py`, `mobile_engine.py`, `drive.py`.
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{session,snapshot}.py`; giữ arm compiler path và behavior.
- Create `source/packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts` và `source/packages/lab-runtime/src/engineering/mujoco-compiler.ts`.
- Modify `source/packages/lab-runtime/src/v2/{capabilities,scenario-registry,scenario-matrix}.ts`, `v2/navigation2d/{readiness,runner}.ts`, engineering compiler registry và CLI option wiring.
- Test `source/robotics/simulation-mujoco/tests/test_mobile.py`, `source/tests/integration/mujoco-mobile-worker.test.ts`, `mujoco-mobile-readiness.test.ts`, `source/tests/unit/mujoco-drive.test.ts`.

**Interfaces:** `compile_mobile(scene, physical_models, load_profile, physics) -> (mjcf,names)`; `wheel_targets(v_mps,omega_radps,radius_m,separation_m)->(left,right)`; `mujocoMobilePlant(runtime):PlantPort`; `MJ-FD01` dựa FD01, chỉ set `engineering-mujoco-3d-v1`.

- [ ] Viết tests wheel sign/frame, readback parity, fixed-step ACK/idempotency, bad-state warning và unsupported model. Chạy fail trước.
- [ ] Dựng chassis freejoint, wheel hinge, caster và props đúng projection; đọc MjModel actual để so geometry/axes/mass/inertia. Thiếu caster từ chối; không ràng buộc pitch hoặc reset chassis pose.
- [ ] Bọc wheel actuator velocity hữu hạn lực; mỗi 2 ms cập nhật force range theo actual wheel velocity và profile. Motoring cap nội suy drive curve; braking dùng `brakeTorqueNm` riêng đã khai, không suy torque braking từ đường cong motoring tại tốc độ cao. Ghi target/actual torque/saturation.
- [ ] Probe 10 s hold, straight/circle/stop ba loads, 3 repeats; ghi gain/brake/solver/timestep/gaps và p95 vào `source/docs/research/2026-11-mujoco-mobility-spike.md`. Chỉ khóa profile khi finite state, parity và repeat trong ngưỡng; trượt giữ nguyên artifact và dừng B03 campaign.
- [ ] Worker đọc đúng scene loại mobile hoặc arm; schema validate trước mutation. Một bước sai target tick/prop ID không tiến world. Mobile snapshot có robots, wheel odom, props, physics; arm path cũ còn byte/behavior regression.
- [ ] Readiness describe+create thật theo scene/profile; đăng ký provider/CLI/export; chuyển MuJoCo slot thành slot engine chung cho ba composition, có test arm đang giữ slot thì mobile bị từ chối.
- [ ] Runner mobile dùng stop policy theo profile; hằng tilt Webots vẫn nguyên. Thêm engine identity/seed/limitations đúng trong report, không còn nhãn planar-only cho dynamics.
- [ ] Focused engine tests và hồi quy R2a chạy xanh; commit `feat: run a payload AMR on the MuJoCo plant`; re-pin.

```python
from mujoco_worker.drive import wheel_targets
import pytest

def test_positive_yaw_turns_left_wheel_backwards():
    left, right = wheel_targets(0.0, 1.0, 0.09, 0.36)
    assert left == pytest.approx(-2.0)
    assert right == pytest.approx(2.0)
```

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q
perl -e 'alarm 600; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/integration/mujoco-arm-worker.test.ts tests/integration/mujoco-arm-bv01.test.ts
```

**Exit:** AMR dùng engine thật, không mock fallback; R2a arm-only vẫn chạy. Không coi compile success là G-MJ1.


## Integration surfaces checked by controller
- Read B01 report for final schema/fixture APIs before work; do not invent a second shape.
- NAVIGATION_SCHEMA_HASH only hashes engineering-component + robot-physical-model schemas; extending scene/wire should preserve old projection/fixture bytes.
- PlantPort/PlantIdentity in v2/navigation2d/plant.ts feeds existing createFixedStepScenarioRun. Navigation evidence currently accepts IR-SIM/Webots only: add the explicit MuJoCo engine/seed identity branch where necessary, keep legacy serialized values intact.
- MuJoCo options currently return arm only, MujocoProviderLike contains arm only, and portableSimulationFromOptions/plantDispatcher in navigation2d/readiness.ts must include mobile path. Engine-backed readiness needs admitted bundle + create smoke, no fake installed flag.
- runner.ts slots are indexed by plant.identity.amr.id while arm ports hold MUJOCO_SLOT='mujoco_arm'. Introduce an explicit shared engine-slot mapping or optional slot key used consistently by capacity/hold/release/ready. Changing only the constant will not make mobile and arm share capacity. Preserve existing error codes.
- Canonical Serve caster links are fixed sphere supports with low contact friction, as current Webots compiler models them; do not invent freely turning joint positions and call them readback parity. Chassis roll/pitch remain free. If using a rolling approximation, label provenance and validate it against the canonical model.
- All five portable Python venvs installed in worktree. Tests must set PYTHONDONTWRITEBYTECODE=1 and PYTEST_ADDOPTS='-p no:cacheprovider'.
- Exact plan source paths are mapped to this paired worktree, never original checkouts. Commit source only; controller handles clean export + Lab pin after review.
