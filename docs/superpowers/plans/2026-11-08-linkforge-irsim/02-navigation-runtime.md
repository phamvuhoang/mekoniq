# Navigation 2D Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy FD01 bằng IR-SIM trong source domain, có sensor/trajectory evidence và recovery đúng nghĩa.

**Architecture:** Compiler tạo immutable scene từ assembly/world; source fixed-step runner sở hữu mission/controller; worker Python chỉ advance plant. Evidence ghi bền trước khi được dùng làm oracle.

**Tech Stack:** TypeScript/Vitest, Python3.11/ir-sim2.12.0/pytest, existing domain/SQLite journal/gateway.

**Spec:** [Contracts](../../specs/2026-11-08-linkforge-irsim/contracts.md), [runtime](../../specs/2026-11-08-linkforge-irsim/workers-runtime.md), [oracles](../../specs/2026-11-08-linkforge-irsim/verification.md).

## Global Constraints

Áp dụng nguyên văn toàn bộ [Global Constraints của plan tổng](README.md#global-constraints). `irsim_2d` chỉ mode simulation/access simulated; `step_time=0.02`; source owns business truth; no fallback và no native/hardware claims. Paths tính từ workspace.

---

## B01 — Navigation projection, footprint và scene compiler

**Depends:** A01/A03.

**Files:** Create `source/packages/lab-runtime/src/engineering/{navigation-model,navigation-compiler}.ts`; create `source/robotics/navigation-2d/irsim_worker/scene.py`, `source/robotics/simulation/compiler/description.py`; modify `source/robotics/simulation/compiler/engineering.py` chỉ để dùng pure description helper; modify `source/packages/lab-runtime/src/engineering/{gateway,runtime-options}.ts` để chọn compiler theo registered profile. Tests **new** `source/tests/unit/navigation2d-compiler.test.ts`, `source/tests/integration/navigation2d-bundle.test.ts`, `source/robotics/navigation-2d/tests/test_scene.py`, `source/robotics/simulation/tests/test_description_parity.py`. Không rewrite thuật toán drive/clearance/native.

**Interfaces:**

```ts
function projectNavigationModel(model:RobotPhysicalModelV1,
  policy:NavigationPolicyV1): NavigationModel2DV1;
function compileNavigationScene(input:EngineeringCompileInput,
  models:readonly NavigationModel2DV1[],policy:NavigationPolicyV1): NavigationSceneV1;
function createNavigationCompiler(options:{python:string;workerRoot:string;
  descriptionHelperRoot:string;schemaHash:string}): CompilerPort;
```

Python `write_scene(scene:dict,out_dir:Path)->list[dict]` chỉ nhận normalized validated scene và xuất `irsim/world.yaml`/name-map. Pure helper `render_urdf(entity_id:str,links:list,joints:list)->bytes` và `render_compiled_scene(resolved:dict,world:dict,wheel_bindings:list)->dict` trích từ compiler hiện có; giữ numeric serialization/ordering/units. Native tiếp tục truyền bindings singleton như cũ. Portable wrapper lấy `drivesByEntity` và world obstacles đã normalize, sinh URDF/scene rồi thêm projections/navigation artifacts, trả complete file list; receipt `sceneDigest` trỏ canonical scene.json. Không gọi full native compiler cho multi-drive, không import ROS trong helper.

- [ ] **Viết tests CMP01–05.** Dùng `navigationFixture` của A03, analytic points/tolerances của spec. So footprint polygon bao mọi collision shape và phản ánh overhang; table corner→center và handoff đúng. Meshed-only thiếu proxy phải fail; map/world/units mismatch không được sửa ngầm.

```ts
const nav = projectNavigationModel(physical, policy);
expect(nav.footprint.contributingShapeIds.filter(id=>id.includes('tray'))).toHaveLength(3);
expect(nav.footprint.verticesM.some(([x])=>x < -0.30)).toBe(true);
expect(nav.navigationPolicyRef.hash).toBe(policy.hash);
```

`physical` trong test lấy từ `projectPhysicalModel(navigationFixture('overhang').input,'amr-1',schemaHash)`; fixture overhang phải có support/khay nhô sau để assertion x có nghĩa độc lập.

- [ ] **Chạy red.** Source: `pnpm exec vitest run tests/unit/navigation2d-compiler.test.ts tests/integration/navigation2d-bundle.test.ts`; Python test đọc fixture scene đã export từ TS, chưa dùng fixture YAML viết tay thay compiler. Trước extraction, freeze URDF/scene bytes của native single-drive fixture ở A00; parity test kiểm cùng bytes sau extraction và normalized entity scene của portable tương ứng.
- [ ] **Implement projections/compiler.** Ghép transforms drive/base, convex hull primitive bounds, explicit policy/sensor limits, bounded world/obstacle/target IDs, actor/zone refs. Content hashes gồm compiler/policy/schema/models; PyYAML `safe_dump` với ordering cố định và explicit finite values. Mapping robotId→engine name không dựa index động. Portable manifest kê shared helper closure; Python path do operator cấu hình, không lấy từ browser. Helper dependency chỉ pure computation/schema, tuyệt đối không gọi native process.
- [ ] **Wire bundle ownership/admission.** New profile compiler được chọn server-side; derived files/mesh closure kiểm hash và atomic publish. `LockedEngineering` mang refs từ bundle; changed source project cần new bundle. Native compile fixtures giữ output hash, IR readiness dùng scene riêng.
- [ ] **Green + compiler regression.** Source run tests mới + `tests/integration/engineering-compiler.test.ts tests/integration/engineering-gateway.test.ts tests/unit/engineering-compile-fixtures.test.ts`; IR venv `PYTHONPATH=robotics/navigation-2d:robotics/simulation .venv-irsim/bin/python -m pytest robotics/navigation-2d/tests/test_scene.py robotics/simulation/tests/test_description_parity.py -q`. Commit `feat: compile versioned IR-SIM scenes from assemblies`.

**Acceptance:** Scene real IR-SIM loader nhận được; geometry analytical checks pass; wrong world/footprint không fallback. Chưa cần mission/UI.

## B02 — Stateful worker, clock và typed snapshots

**Depends:** B01/A00.

**Files:** Create `source/robotics/navigation-2d/irsim_worker/{__init__,__main__,protocol,session,snapshot}.py`; create `source/packages/lab-runtime/src/v2/navigation2d/worker-client.ts`; tests **new** `source/robotics/navigation-2d/tests/{test_session,test_snapshot,test_protocol}.py`, `source/tests/integration/irsim-worker.test.ts`. Schema `irsim-worker-v1` từ A01 phải được dùng ở cả hai đầu.

**Interfaces:**

```ts
interface IRSimWorkerClient {
  request(request:IRSimRequestV1):Promise<IRSimResponseV1>;
  close(reason:string):Promise<void>;
}
function spawnIRSimWorker(options:{python:string;workerRoot:string;
  runId:string;bundleRoot:string;runDirectory:string;lockDigest:string}):Promise<IRSimWorkerClient>;
```

Python `WorkerSession.handle(request:dict)->dict` triển khai operations/state table trong spec, giữ request receipts và own environment. Response DTO fields exact schema, không expose irsim object internals.

- [ ] **Viết lifecycle/action-mapping tests.** Tạo env từ compiler B01;2robots khác IDs/radii. Sau10ticks với0.2/0.1m/s phải tăng0.04/0.02m. Same request→same receipt/tick; same ID khác payload fail; getState không advance; pause/read/resume; repeated close không orphan process.
- [ ] **Viết sensor/serialization tests.** Offset+yaw wall analytic, inf/NaN conversion, snapshot owned copy, stale/duplicate boot/frame rejected. Use `get_msg(use_inf=True)` DTO, không đọc message `.valid` không tồn tại. Cases SEN01/02 và IR08/09.

```python
assert snapshot['tick'] == 10
assert snapshot['simTimeNs'] == '200000000'
assert abs(snapshot['robots'][0]['poseDriveMap'][0] - 1.04) < 1e-9
json.dumps(snapshot, allow_nan=False)
```

- [ ] **Chạy red.** `PYTHONPATH=robotics/navigation-2d .venv-irsim/bin/python -m pytest robotics/navigation-2d/tests/test_session.py robotics/navigation-2d/tests/test_snapshot.py robotics/navigation-2d/tests/test_protocol.py -q`; `pnpm exec vitest run tests/integration/irsim-worker.test.ts`.
- [ ] **Implement worker/client.** stdio NDJSON parser caps, typed errors, headless True, per-env seed, bounded ACK deadlines, exact tick expectations, explicit commands all robots, stderr-only logging, spawn argv/env allowlist, per-run dirs. Worker validates `singleStep:true` only while paused; created/running requests follow spec. `env.end(ending_time=0)` on close, terminate only own process on deadline.
- [ ] **Fault and green.** Kill child after step applied before ACK; assert client unknown/suspended and never starts replacement. Invalid JSON/oversize/external path/late reply/queue overflow all fail closed. Run suites above 3 times only for declared repeatability cases; no arbitrary full rerun loop. Commit `feat: run isolated IR-SIM workers with fixed-step protocol`.

**Acceptance:** Python plant standalone works on Mac; protocol, time and sensor evidence verified. No mission success claims.

## B03 — Deterministic navigation controller và geometry oracle

**Depends:** B01/B02.

**Files:** Create `source/packages/lab-runtime/src/v2/navigation2d/{controller,oracle}.ts`; tests **new** `source/tests/unit/navigation2d-controller.test.ts`, `source/tests/integration/irsim-navigation.test.ts`. Geometry math lấy từ existing frames; oracle không gọi controller verdict để xác nhận collision.

**Interfaces:** `NavigationController` theo runtime spec; `createNavigationController(scene:NavigationSceneV1):NavigationController`; `assessTrajectory(scene:NavigationSceneV1,snapshots:readonly IRSimSnapshotV1[]):{contacts:{tick:number;pair:[string,string];source:string}[];minSeparationM:number|null;coverage:'complete'|'incomplete'}`.

- [ ] **Red oracle tests.** Corridor0.60m với widths0.54/0.58 và margin0.02; yaw-only completion chưa arrived; unknown sensors→zero/attention; global no_path khác obstacle temporal blocked; edge giữa snapshots qua tường mỏng bị swept oracle phát hiện. Include denied zone, full-footprint exit, speed/acceleration/wheel limits.
- [ ] **Run red.** `pnpm exec vitest run tests/unit/navigation2d-controller.test.ts tests/integration/irsim-navigation.test.ts`.
- [ ] **Implement grid-diff-v1.** A* SE2 8headings, forward/rotate edges, stable tie-break/state budget; swept footprint+margin check; explicit endpoint connectors/final yaw. Velocity bounded theo `(v ± omega*b/2)/r` và wheel joint limits. LiDAR-derived dynamic occupancy + stop/replan/no-progress policy; không gọi env behavior auto-dash.

```ts
const leftRadps = (vMps - omegaRadps * separationM / 2) / radiusM;
const rightRadps = (vMps + omegaRadps * separationM / 2) / radiusM;
// Reject/scale a command before send when either declared wheel limit is exceeded.
```

- [ ] **Implement independent oracle.** Read observation poses and physical hulls, validate full tick coverage, compute surface separation/collision episodes; swept bounds giữa ticks. Record source of detection. No geometry gap→no clearance pass. Test engine collision separately with thick obstacle and test-only control bypass; bypass không có public request field.
- [ ] **Green real-engine cases.** IR01 navigation legs, IR02 crossing, IR03 enclosed/no-progress, IR06/07 collision theo spec. Trace saved to temp test dirs only; assertion expected/actual independent. Commit `feat: add deterministic planar navigation and collision oracles`.

**Acceptance:** Controlled restaurant navigation chạy bằng body velocities; planner decisions reproducible; limitations known-map/planar được ghi.

## B04 — Source mission runner, admission và recovery

**Depends:** B03. A02 cần để gắn validation refs nhưng IR provider tự chạy được khi LF flag off.

**Files:** Create `source/packages/lab-runtime/src/v2/navigation2d/{adapter,runner,readiness}.ts`; modify `source/packages/lab-runtime/src/v2/{capabilities,gateway,readiness,scenario-registry,scenario-matrix}.ts`, `engineering/runtime-options.ts`, `cli.ts`; tests **new** `source/tests/integration/{irsim-mission,irsim-recovery,irsim-readiness}.test.ts`, `source/tests/security/irsim-authority.test.ts`. Read SourceSession, robot-adapters contract/dispatch, fault schedule, reclaim-store và native adapter idempotency.

**Interfaces:**

```ts
function createIRSimScenarioRun(input:RunManifestInput,providers:RunProviders):Promise<ScenarioRun>;
function createIRSimNavigationAdapter(options:{robotId:string;scene:NavigationSceneV1;
  controller:NavigationController;now:()=>number}): RobotAdapter;
function portableSimulationFromOptions(options:PortableSimulationOptions):Promise<{
  catalog:CapabilityCatalog;
  enabledBackends:string[];
  simulationFactory:(input:RunManifestInput,providers:RunProviders)=>Promise<ScenarioRun>;
}>;
```

`PortableSimulationOptions` fields: `{enabled:boolean,python:string,workerRoot:string,lockPath:string,directory:string,nativeFactory?:V2Deps['simulationFactory']}`; `V2Deps` là interface hiện có ở `v2/gateway.ts`. Factory dispatches by backendSetId; native unchanged, unknown refused. Adapter instance triển khai exact methods của existing `RobotAdapter`: describe/resolveTarget/estimateReachability/execute/cancel/requestStop/observe/reconcile. Runner nối snapshots và command lifecycle vào adapter bằng internal typed observation sink; không expose sink thành HTTP endpoint.

- [ ] **Business red tests trước wiring.** FD01 through real source domain; at target without confirmation served='0'; after explicit load/handoff served expected and return parking. Duplicate/epoch/stale/map errors; cancel ACK loss→unknown; source/worker/UI restarts giữ journal/cargo/reservations. Missing IR deps/flag doesn't affect mock.

```ts
expect(report.manifest.backends.map(b=>b.id)).toEqual(['irsim_2d']);
expect(report.outcome.served).toBe('0'); // before the scripted handoff action
expect(report.businessEvents.some(e=>e.type==='DeliveryHandedOff')).toBe(false);
```

- [ ] **Run red.** `pnpm exec vitest run tests/integration/irsim-mission.test.ts tests/integration/irsim-recovery.test.ts tests/integration/irsim-readiness.test.ts tests/security/irsim-authority.test.ts`.
- [ ] **Implement provider, runner và action order.** Reuse SourceSession/dispatch; scenario role/workload/actor interpretation same semantics as existing FD01. Source tick only commits after valid worker ACK. Adapter navigation completion just ends leg; domain owns handoff. Implement control queue, pause/single-step/cancel timeouts and immutable inputs. Don't route IR through Gazebo or spoof native evidence.
- [ ] **Provider-specific readiness.** Server flags, optional execution metadata, portable host policy, schema/profile/scene match, actual worker describe/smoke. Preserve Gazebo Linux gate. Register `IR-FD01` revision1 và matrix row riêng; new set chỉ hỗ trợ scenario này ở task B04. Wrong scenario returns `SCENARIO_UNSUPPORTED_BY_SET`, thiếu provider role trả `SCENARIO_BACKEND_MISSING`. Test IR scenario + legacy mock/native set bị từ chối và scenario cũ giữ schedules/results. Reject frontend endpoint/actor injection, arbitrary YAML/code, wrong session/bundle ownership.
- [ ] **Green + boundaries.** Tests mới + `tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-bv01-ports.test.ts tests/integration/lab-v2-native-profile.test.ts tests/integration/lab-v2-native-gateway.test.ts tests/integration/engineering-profile-routing.test.ts tests/integration/lab-v2-recovery.test.ts`. Native tests nào require environment vẫn giữ status đúng. Commit `feat: integrate IR-SIM with source mission authority`.

**Acceptance:** G-IR1 tested headless; unknown/cancel đúng business semantics. Runtime discovery không advertise nonexistent capabilities.

## B05 — Durable evidence, replay contract và KPI

**Depends:** B04/B02.

**Files:** Create `source/packages/lab-runtime/src/v2/navigation2d/evidence.ts`; modify `v2/{report,telemetry}.ts`, new runner; tests **new** `source/tests/integration/irsim-evidence.test.ts`, `source/tests/unit/navigation2d-metrics.test.ts`, `source/tests/security/irsim-replay.test.ts`. New schema `navigation-run-evidence-v1` A01; keep old report digests.

**Interfaces:**

```ts
interface NavigationRecorder {
  append(snapshot:IRSimSnapshotV1,controls:IRSimStepPayloadV1):Promise<void>;
  finalize():Promise<NavigationRunEvidenceV1>;
}
function createNavigationRecorder(options:{directory:string;scene:NavigationSceneV1;
  maxBytes:number;sourceCommit:string;workerLockDigest:string}):NavigationRecorder;
```

`IRSimStepPayloadV1` sinh từ worker schema, gồm targetTick/velocities/actorUpdates/singleStep. Record controls và observation causal tick, không dựng requested velocity từ trajectory để giả làm command log.

- [ ] **Write evidence failure tests.** Complete tick horizon, duplicate append idempotency, write/fsync failure, missing/corrupt chunk, quota100MiB, SSE loss, restart gap; no-contact/metric unavailable khi evidence thiếu. CanonicalOutcome mock golden digests phải giữ.
- [ ] **Run red.** `pnpm exec vitest run tests/integration/irsim-evidence.test.ts tests/unit/navigation2d-metrics.test.ts tests/security/irsim-replay.test.ts`.
- [ ] **Implement chunking/report.** NDJSON gzip chunks ordered, stored-byte hashes, separate command/actor/pose/scan records. Publish sensor10Hz, pose50Hz; terminal evidence flush before final verification. Report extension includes full versions/seeds/PRNG/scene/policy identity, coverage and distinct engine/swept/safety events. TelemetryRecorder source label parameterized with exact legacy default; source='irsim_2d simulated plant' only on new provider.
- [ ] **Implement independent metrics/replay reader.** Sum distances from observed samples, own separation oracle, collision episodes and source journal timings. Reader pure artifact decoding/validation, no executor access; imported paths confined to recording root. Export/import/new viewer tests use actual saved chunks, not screenshots or outcome booleans.
- [ ] **Green repeatability + regression.** Three fresh noise/no-noise runs same seed/lock; compare declared normalized fields/tolerances, seed changed changes sensor stream. Run above tests + `tests/integration/lab-v2-report.test.ts tests/integration/lab-v2-stream.test.ts`. Commit `feat: record replayable IR-SIM evidence and metrics`.

**Acceptance:** EVI01–03/IR08 pass with artifacts; G-IR3 not complete until C02 includes multi/fault campaign. B05 output usable without frontend.
