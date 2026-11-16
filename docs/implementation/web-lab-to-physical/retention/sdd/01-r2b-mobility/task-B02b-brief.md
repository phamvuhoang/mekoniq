# Task B02b — TypeScript provider, admission and runtime integration

Second sequential slice of B02, after B02a review/measurement lock. Read B02a report before coding. Implement remaining parent requirements: engineering scene compiler, PlantPort, real readiness/create smoke, CLI/portable export/catalog/MJ-FD01, shared MuJoCo engine capacity across arm/mobile/future cell, mobile stop policy and explicit navigation engine/seed identity. Preserve every existing mock/IR-SIM/Webots/R2a byte/behavior contract. No physics sidecar recorder yet (B03). Run real-worker/provider integration, capacity rejection and arm regression. Source commit then clean export/Lab pin.

## Slice checklist and scope
B02a completed the parent Python compiler/session/snapshot/drive/mobile tests and measurement-probe checklist. The parent brief below is context; those Python files do not require new hunks in this slice unless integration discovers a defect. B02b owns:
- engineering/mujoco-compiler.ts; engineering gateway/registry/default compiler wiring; requestedProfile enum + generated types if necessary; scene/profile byte admission and explicit one-AMR supported scope.
- v2/simulation3d/mujoco-mobile.ts + existing mujoco.ts/readiness; PlantPort and descriptor override; global engine slot and smoke gate; capability/catalog/MJ-FD01/scenario-matrix/CLI/export wiring.
- Navigation runner mobile stop policy and accurate engine/seed/report identity; navigation-run-evidence schema needs new engine branch (currently IR-SIM/Webots). Stronger physics durable recording stays B03.
- Real-worker integration, describe/create admission tests, arm-vs-mobile capacity and readiness-concurrency tests, finite data/errors/clock mapping, required legacy regression.
- Source commit; clean export/import/sync/check:source and minimal Lab compatibility/typecheck/pin commit after review coordinated by controller (unless controller explicitly delegates pin). No payload UI/campaign until B04.

Compiler note: B01 fixture's serve-3d-project.json is intentionally a byte-identical canonical copy with Webots requestedProfile. Derive a new MuJoCo engineering input/digest explicitly; don't rewrite canonical source fixture or pretend the original project requested MuJoCo. Default new compiler load is center; keep selection server-owned, no browser paths or raw physics knobs. B04 may add a closed registered experiment selector for new-run input revisions. Include all newly referenced profile/model/assumption bytes in admitted bundle before final scene hashing.

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

## Additional descriptor risk
createIRSimNavigationAdapter in navigation2d/adapter.ts is reused by the generic runner but hardcodes IRSIM_AMR for describe().firmware and RobotEvent payload.model. Add a backwards-compatible explicit identity override for MuJoCo and pass it from the new provider; leave old default callers/legacy bytes untouched. Don't claim MuJoCo provenance only at top-level report while source journal records IR-SIM model.

- Capacity includes readiness create probes: arm and mobile readiness must share an exclusive smoke gate as well as a run-slot identity, so parallel readiness calls cannot spin two engine worlds. One worker per active world/runtime; different isolated runtime instances in tests are a distinct scope. Add targeted concurrency test with a blocked create; no broad timing/flaky loops.

- Read B02a's new error-code taxonomy: numerical/contact-capacity failure may occur AFTER engine advancement, so TypeScript worker-client fatal-code handling and runner terminal/unknown paths must preserve that distinction. Add missing new fatal codes if needed; never treat CONTACT_CAPACITY_EXCEEDED/PLANT_UNSTABLE as a safely retryable admission refusal. Invalid tick/ID/schema is tested before mutation; runtime failures are not that class.

## B02a handoff now available
Read task-B02a-report.md for exact producer APIs/limitations and final hash identities. Source b647429 (or later reviewed fix head) contains engine. Create payload is existing `{sceneRef:'navigation-scene.json',seed}` only, robot ID from scene; mobile does not accept a new robots token. Step needs exactly one velocity and empty actorUpdates, no arm/gripper/placement commands in this mode. Priming is one declared zero-target tick: engine time=(tick+1)*20ms, snapshot time=tick*20ms. Seed is identity, no stochastic engine/noise/actors; label it honestly. Load modelRef path is authoritative; don't assume filename. Contact IDs use floor, robot/link/cN, prop/id, static/id. B03 will own sustained support/custody/metric windows; instant props.restingOn is not proof of receipt. One noiseless sensor and convex obstacle models only; unsupported extensions must refuse. Final locked drive profile byte SHA9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3 (re-read final reviewed fixture if fixes change it).

## CLI engineering prerequisites
- CLI creates engineering service before it declares mujocoOn today. Register MuJoCo compiler in engineering/runtime-options.ts and pass option early enough. engineeringFromOptions currently requires catalogRoot+simulationRoot plus Python yaml/rfc8785/jsonschema/referencing for its native default compiler. Mobile needs admitted engineering bundles; arm-only must remain available with only old --mujoco args. Do not advertise mobile ready without a usable engineering service.
- Old Lab MuJoCo launcher has no engineering catalog flags; B04 will extend it for payload (existing Webots launcher uses pinned source catalog/simulation and .venv-irsim for engineering helpers). Coordinate minimal source admission/CLI now; don't silently require engineering for all R2a arm runs. B09 image currently copies only MuJoCo root + schemas; its mobile build must add actual required closure and either dependencies or an explicitly portable-only engineering mode with native compilation unavailable. No fake native/compiler fallback.

## Reviewed starting tuple and test environment
B02a review is clean at source eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc; Lab pinned in cef5b6c29382e542678370b9a0da69d5f8c95351. Read task-B02a-report.md fix round1 for early LiDAR admission. Full runtime exports must go under /tmp, never .superpowers (ESLint walks bundled files there). Python worker tests and TS suites using process cleanup/pgrep must run sequentially to avoid unrelated worker false positives. Controller owns source clean export/Lab pin AFTER task review.

## Mobile stop-policy ruling (B02b)
The locked B02a numerical profile/probe identity stays unchanged. Add separate server-owned versioned observation/stop policy and hash it into admitted scene/bundle/report. Default not_calibrated experiment values: maxAbsRollPitchRad=0.7853981633974483; finite base-height sanity bounds -0.6/+4 wheel radii about initial restZ with existing floor lower bound; load fall means observed poseInSupport.z drop >=0.10m from the same prop's initial relative z for 5 consecutive logical ticks. Same support/reference/identity required; missing or invalid samples are unknown/fault, never a counted fall sample. Tilt -> BASE_TIPPED, sustained load drop -> LOAD_FELL, nonfinite/numerical/world escape -> PLANT_UNSTABLE. B04 can define new registered experimental policies with different run identities, no raw browser thresholds. Webots remains unchanged. These are simulated observation cutoffs, no measured safety/calibration claim. Include boundary/hold-window tests.

## Controller ramp ruling after actual plant diagnosis
B02b real MJ-FD01 stalled and ended NO_PROGRESS at tick493. Actual trace: tick300 sent w=-0.030627171957 rad/s, observed=-0.000627246733, targets±0.06125434rad/s, actual wheels±0.003058rad/s, torque±0.116392Nm, saturatedSubsteps0; same equilibrium at ticks250/350/400. follow() ramps from measured velocity with delta1.5*0.02=0.03, preventing command growth against stiction. Preserve /tmp/b02b-stall-physics.ndjson, /tmp/b02b-mission-trace and /tmp/b02b-mission-diagnostic.log references/evidence.
Use a mobile-only previous-sent-command acceleration-ramp mode under an explicit versioned hashed admitted controller policy; locked physics profile unchanged. Maintain per-robot command state from new-run zero, preserve through pause/resume and goal transitions, update consistently for every output (including explicit zero/hold/terminal). No command-state reset claims actual zero. Actual observed velocity remains authoritative for stop/arrival/dock, obstacle stopping distance and progress. Lost/refused/uncertain step remains terminal; no retry/resume. Queued cancel targets zero under the declared deceleration policy unless existing terminal behavior explicitly sends zero. Verify focused stiction/transition tests, legacy byte behavior and a full real MJ-FD01 completion.

## Controller-required Lab pin compatibility correction
Clean source5235791 export/import exposed Lab engineVersionOf using .version for every engine other than Webots, now a TypeScript error for additive MuJoCo evidence. Minimal compatibility scope: explicitly distinguish IR-SIM version from Webots/MuJoCo engineVersion; retain NAVIGATION_PROVIDERS admission until B04 implements full MuJoCo UI. Preserve legacy outputs and unknown engine behavior; add focused helper regression. Lab source pin/generated schema changes are expected and generated via sync, not manual. Source commit stays5235791. Lab BASEcef5b6c; agent owns reviewed pin+helper commit.
