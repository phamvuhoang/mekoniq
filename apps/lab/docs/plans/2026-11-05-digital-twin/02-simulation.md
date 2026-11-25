# Kế hoạch triển khai mô phỏng nhà hàng và cell đồ uống

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy cùng nghiệp vụ source với Gazebo/Nav2 và cell đồ uống, có evidence đủ để phân biệt nghiệp vụ, physics và controller simulation.

**Architecture:** Gateway v2/scenario runner của kế hoạch 01 sở hữu run và production commands; isolated simulated adapters nối tới plant Linux. World compiler dùng AssetRevision chung; beverage domain nằm trong source và arm bridge cung cấp evidence, không ghi trực tiếp fulfillment.

**Tech Stack:** Node 24, TypeScript, SQLite journal hiện có, Python, ROS 2 Jazzy, Gazebo Harmonic trên Ubuntu 24.04; LinuxCNC simulator qua port trong kế hoạch arm.

**Spec:** [simulation.md](../../specs/2026-11-05-digital-twin/simulation.md), [architecture-contracts.md](../../specs/2026-11-05-digital-twin/architecture-contracts.md), [verification.md](../../specs/2026-11-05-digital-twin/verification.md), [arm-hardware.md](../../specs/2026-11-05-digital-twin/arm-hardware.md).

## Ràng buộc chung

- Đây là kế hoạch đề xuất; file/test/script mới trong tài liệu chưa tồn tại và mọi Expected là tiêu chí tương lai, không phải kết quả đã chạy.
- V1 frozen; schema mới và endpoint mới dùng v2. Public mode `mock` / `simulation` / `hardware`; backend set bất biến trong run; replay chỉ đọc.
- Mock source runner chạy Node 24 macOS/Linux không ROS/Docker/hardware, triển khai trong kế hoạch 01. Kế hoạch này tiêu thụ runner đó; không viết business engine trong Lab browser.
- Mọi code production mới nằm trong `source/`. `lab/` chỉ chứa UI/client/fixtures/docs; `trial/` và ports 1880/1884 không bị thay đổi.
- Không chỉnh dirty file có sẵn khi chưa tách thay đổi người dùng. Khi thực thi, lập worktree sạch từ commit được chọn trong từng repo; làm Git trong đúng repo.
- SIL profile là simulator/simulated và simulator observer trên owner device; không giả hardware_validated; giữ `authorizeVenueCommand`, domain admission, native contract và journal.
- Hardware shadow/HIL/live là gate riêng. Thiếu simulator trả unavailable/not_run; không fallback sang mock.
- Node artifact mới negotiation `protocolMajor:2`, `protocolMajors:[1,2]`; v1 UI cũ vẫn khóa artifact v1. Không sửa byte schema v1.

## Điểm bắt đầu và interface phụ thuộc

Kế hoạch 01 phải cung cấp schema/type canonical `AssetRevision`, `RunManifest`, `TwinSample`, `RunClock` và run registry trước task 1/2. Schema tiêu thụ là `source/packages/contracts/schemas/asset-revision.schema.json`, `lab-run-v2.schema.json`, `twin-sample-v2.schema.json`, `coffee-recipe.schema.json`, `cell-command.schema.json`, `cell-observation.schema.json`; không tạo bản beverage schema tương đương. F04 của kế hoạch 01 sở hữu coffee domain và `source/packages/cell-adapters`; task 5/6 bên dưới chỉ bổ sung simulation evidence/plant coupling trên nền đó. Plan arm cung cấp `source/packages/lab-runtime/src/v2/arm/adapter.ts` và controller bridge; kế hoạch này không cài LinuxCNC driver.

Các interface trong task dưới là API nội bộ **đề xuất** của plan này. `RunContext` là context server chứa immutable manifest, production store, owner identity và clock, không phải payload nhận từ browser. Type canonical import từ module contracts v2 do kế hoạch 01 sinh.

```ts
type Sha256 = string;
type EntityId = string;
type EvidenceRef = { id: string; sha256: Sha256 };
type CompiledWorld = {
  inputHash: Sha256; outputDirectory: string; manifestHash: Sha256;
  worldFile: string; mapIdentityFile: string; sceneIndexFile: string;
};
type BackendCapability = {
  backendId: 'gazebo_nav2'; available: boolean; step: boolean;
  version: string; reasons: string[];
};
type SimGoalResult = {
  commandId: string; nativeGoalId: string;
  status: 'accepted'|'executing'|'completed'|'cancelled'|'failed'|'unknown';
  evidence: EvidenceRef[];
};
```

Không dùng `outputDirectory` hoặc file path trên HTTP contract. Server quyết định artifact root và chỉ trả artifact IDs/refs. Backend control port bind loopback hoặc private process channel với per-run capability; không có network discovery robot thật.

## Task 1: World compiler dùng chung hình học — SIM-03, SIM-05

**Files:**

- Create `source/robotics/simulation/compiler/__init__.py`, `models.py`, `compile_world.py`, `occupancy.py`, `manifest.py`.
- Create `source/robotics/simulation/tests/test_world_compiler.py`.
- Create `source/tests/fixtures/digital-twin/restaurant-v2.json`, `assets/service-robot-v1.json`, `assets/table-v1.json`, `assets/cup-v1.json`.
- Modify `source/robotics/simulation/worlds/generate_restaurant.py` chỉ để chia sẻ helper thuần hình học khi không đổi output legacy; giữ test drift cũ.

**Interfaces:** `compile_world(project_json: dict, asset_revisions: list[dict], output_dir: Path) -> dict` trả manifest có `inputHash`, `outputs[{path,sha256}]`, `frame`, `units`, `assumptions`. Đọc JSON đã validate bởi contracts; vẫn validate geometry hữu hạn, scale > 0, namespace unique, output path nằm trong run root phía Python.

- [ ] Viết failing test sau trong file mới; fixture một bàn có handoff offset, một robot và corridor.

```python
def test_visual_collision_and_map_share_revision(tmp_path, restaurant_v2):
    result = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path)
    assert result["inputHash"] == restaurant_v2.expected_input_hash
    assert {entry["path"] for entry in result["outputs"]} >= {"world.sdf", "map.pgm", "map.identity.json", "bindings.json"}
    assert result["units"] == "m"
    assert result["collisionAssetRevisionRefs"] == result["visualAssetRevisionRefs"]
    assert result["collisionBounds"] == restaurant_v2.expected_collision_bounds
    assert read_binding(tmp_path, "table-1")["x"] != restaurant_v2.table_center_x
```

- [ ] Chạy từ `source/`: `python3 -m pytest robotics/simulation/tests/test_world_compiler.py -q`; expected ban đầu import failure, sau implementation pass. Thêm `pytest` vào dev prerequisites pin riêng cho Python nếu môi trường chưa có; thiếu prerequisite không được báo pass.
- [ ] Implement chuẩn hóa asset geometry/pose/units; sinh SDF visual/collision, raw occupancy, frame transform, bindings, per-robot URDF/config và manifest. Visual và collision cùng trỏ AssetRevision nhưng được dùng mesh/blob khác nhau; không ép decorative mesh hash bằng collision mesh hash. Dùng canonical hash algorithm v2 từ architecture, cùng golden vectors TypeScript/Python; sort stable output, không timestamp trong compiler identity.

```python
def compile_world(project_json, asset_revisions, output_dir):
    model = WorldModel.validate(project_json, asset_revisions)
    model.assert_target_clearance()
    bundle = render_bundle(model)  # world, map, bindings, URDF và scene index cùng model
    return write_hashed_bundle(output_dir, model.canonical_hash(), bundle)
```

- [ ] Thêm cases negative scale, mesh hash mismatch, collision missing, yaw/frame đổi, footprint gần biên, cùng ID khác entity và missing mass cho dynamics. Mỗi case nêu error code và không ghi partial bundle.
- [ ] Chạy test compiler cùng `python3 -m pytest robotics/agent/tests/test_robotics_assets.py -q`; output legacy không đổi. Review/commit trong source: `feat: compile twin worlds from versioned assets`.

## Task 2: Launch và simulated Nav2 bridge — SIM-01, SIM-04, SIM-09

**Files:**

- Create `source/robotics/simulation/launch/lab_world.launch.py`, `bridge/nav2_session.py`, `bridge/protocol.py`.
- Create `source/packages/lab-runtime/src/v2/backends/gazebo-nav2.ts`, `simulated-navigation.ts`.
- Create `source/tests/integration/lab-v2-simulated-navigation.test.ts`, `source/robotics/simulation/tests/test_nav2_session.py`.
- Modify `source/robotics/simulation/Dockerfile`, `package.xml`, `CMakeLists.txt` để đóng gói launch mới; bổ sung pinned `source/robotics/simulation/requirements-dev.txt` và image digest trong runtime manifest.
- Reuse không đổi safety semantics: `source/robotics/agent/mekoniq_agent/nav2_adapter.py`, `nav2_rclpy.py`; `source/packages/robot-adapters/src/dispatch.ts`.

**Interfaces:** `startGazeboBackend(bundle: CompiledWorld, runId: string): Promise<GazeboBackend>`; `GazeboBackend.capability(): BackendCapability`, `execute(command: RobotCommand): Promise<NativeAcceptance>`, `reconcile(commandId): Promise<NativeExecutionState>`, `close(): Promise<void>`. Adapter thực hiện `RobotAdapter`, `describe()` trả simulator/simulated. Worker protocol có allowlisted `execute`, `cancel`, `stop`, `query`, `pause`, `step`, `close`; không nhận arbitrary executable/topic.

- [ ] Viết test integration kiểm domain profile và quyền quan sát.

```ts
test('SIL uses simulated identity without relaxing production admission', async () => {
  const rig = await makeSilContractRig({ nativeResult: 'accepted' });
  expect((await rig.adapter.describe()).validation).toBe('simulated');
  await rig.startDelivery();
  expect(await rig.fulfillmentServed()).toBe('0');
  await expect(rig.observeAsBrowser()).rejects.toThrow('OBSERVER_NOT_BOUND');
  expect(rig.robotExecuteAttempts()).toBe(1);
});
```

Fixture `makeSilContractRig` được tạo trong cùng test file, dùng v2 runner/production store; injected fake Nav2 port chỉ kiểm protocol và mang nhãn protocol evidence, không SIL physics.

- [ ] Chạy từ source: `pnpm exec vitest run tests/integration/lab-v2-simulated-navigation.test.ts`; expected fail trước bridge, pass sau bridge. Python: `python3 -m pytest robotics/simulation/tests/test_nav2_session.py robotics/agent/tests/test_nav2_adapter.py -q`.
- [ ] Launch compiled world bằng process spawn với argv cố định; `shell:false`; run namespace/ROS domain/transport partition riêng. Giữ allowlist backend worker, tmp paths canonical và cleanup chỉ PID/directory tạo trong run.
- [ ] Map Nav2 goal UUID/durable command identity, result status/error_code, localization/map version tới RobotEvent với simulator actor. Các case accepted-only, canceled, success-with-missing-result, stale map, covariance cao phải không complete.

```ts
function terminalState(goal: {accepted: boolean; status: number; errorCode?: number}) {
  if (goal.accepted && goal.status === 4 && goal.errorCode === 0) return 'completed';
  if (goal.status === 5) return 'cancelled';
  if (goal.status === 6) return 'failed';
  return 'unknown';
}
```

Đây là minh họa mapping port; implementation dùng constant/status helpers của Python hiện có, không tạo enum số mới rải rác.

- [ ] Regression `pnpm exec vitest run tests/integration/robot-admission.test.ts tests/integration/lab-runtime.test.ts`; không sửa expected hardware validation. Review/commit: `feat: connect isolated Gazebo navigation to lab v2`.

## Task 3: Clock barrier, telemetry và fault lifecycle — SIM-07, SIM-08, SYS01–SYS03

**Files:**

- Create `source/packages/lab-runtime/src/v2/backends/clock-barrier.ts`, `telemetry-ingest.ts`, `fault-schedule.ts`.
- Create `source/robotics/simulation/bridge/clock_barrier.py`, `telemetry.py`.
- Create `source/tests/integration/lab-v2-sim-clock.test.ts`, `lab-v2-sim-recovery.test.ts`.
- Create `source/robotics/simulation/tests/test_clock_barrier.py`.

**Interfaces:** `awaitTransferBarrier(barrierId: string, participants: string[]): Promise<{barrierId: string; evidence: EvidenceRef[]}>`; riêng Gazebo backend có thể cung cấp `advanceSimulation(targetTimeNs: bigint)` khi capability cho phép. Telemetry ingest nhận canonical `TwinSample` và trả `accepted|duplicate|stale|gap|rejected`, không ghi pose trực tiếp vào business snapshot. Fault registry resolve `faultId` → typed injector đã đăng ký, scope theo run/entity.

- [ ] Viết negative tests unknown disconnect và duplicated telemetry.

```ts
test('bridge loss preserves cargo and never resends an uncertain execute', async () => {
  const rig = await makeClockRig();
  await rig.startAndLoseReply();
  await rig.restartWorker();
  await rig.reconcile();
  expect(rig.executeCalls()).toBe(1);
  expect(rig.missionStatus()).toBe('needs_attention');
  expect(rig.reservationStatus()).not.toBe('released');
});
```

`makeClockRig` tạo worker protocol double có durable command table để quan sát số physical sends, dùng production dispatch cho outbox; không fake mission reducer.

- [ ] Chạy `pnpm exec vitest run tests/integration/lab-v2-sim-clock.test.ts tests/integration/lab-v2-sim-recovery.test.ts`; expected initial module missing; sau implementation tests pass, execute count chính xác 1.
- [ ] Implement semantic barriers cup-ready/arm-transfer-complete/AMR-docked cho co-simulation 1×; ghi clock mapping/skew, evidence freshness và participant ACK. LinuxCNC mặc định `step:false`, controller wall time; không yêu cầu arbitrary seek/step hoặc frame lockstep. Timeout giữ run attention và ghi backend nào thiếu ACK. Mock fixed step 20 ms đã thuộc F03 kế hoạch 01.
- [ ] Test pause không thay domain clock; reset tạo run mới; late observation boot cũ không clear lỗi; fault enum không chấp nhận topic/shell. Replay telemetry không gửi effects.
- [ ] Chạy Python `python3 -m pytest robotics/simulation/tests/test_clock_barrier.py -q`, TypeScript checks `pnpm typecheck`; review/commit `feat: record causal simulation clocks and recovery evidence`.

## Task 4: Vật cản, người và hai robot — SIM-05, SIM-06, FD03/FD04/FD07/FD08

**Files:**

- Create `source/robotics/simulation/actors/pedestrian.py`, `actors/blocker.py`, `metrics/contact.py`, `metrics/separation.py`.
- Create `source/robotics/simulation/tests/test_dynamic_scene.py`, `test_two_robots.py`.
- Create `source/tests/fixtures/digital-twin/scenarios/fd03-crossing.json`, `fd04-blocked.json`, `fd07-corridor.json`, `fd08-localization.json`.
- Modify launch/bridge vừa tạo ở task 2; không sửa restaurant legacy fixture.
- Create `source/tests/integration/lab-v2-zone-bridge.test.ts`.

**Interfaces:** `ActorSchedule(seed, trajectory, clock)` trả pose command tại tick; `ContactSample` có entity pair, tick, contact point/normal; `SeparationSample` tính trên collision geometry, không tâm mesh. Zone bridge nhận granted reservation từ source và thực thi hold trước ungranted zone boundary.

- [ ] Viết integration test explicit contention.

```ts
test('unknown corridor holder prevents the other robot entering', async () => {
  const rig = await makeZoneRig(['robot-1', 'robot-2']);
  await rig.grantAndLoseRobot('robot-1', 'corridor-a');
  await rig.requestEntry('robot-2', 'corridor-a');
  expect(rig.entryExecuteCount('robot-2')).toBe(0);
  expect(rig.zoneOwner('corridor-a')).toBe('robot-1');
});
```

`makeZoneRig` gọi reservation module thật và worker boundary command recorder. Dùng actual Gazebo test bổ sung để kiểm pose không vượt boundary; unit recorder không thay physics evidence.

- [ ] Implement deterministic actor schedule + collider; thêm contact sensor collection. Vật cản đứng yên và người có chiều cao/footprint provenance; traffic ở cùng world/clock, namespace riêng. One controller publisher cho mỗi robot velocity input.
- [ ] Thêm `source/scripts/lab-sil.mjs` với subcommands `doctor`, `run`, `verify`; mỗi subcommand có schema argv, exit 2 prerequisite thiếu, exit 1 failed, exit 0 verified. No-tests/zero samples phải exit 1.
- [ ] Chạy đề xuất trên Linux SIL host: `node scripts/lab-sil.mjs doctor --backend gazebo_nav2`; expected capability report digest + sensor render + lifecycle đủ. `node scripts/lab-sil.mjs run --scenario FD07 --seed 17 --repeat 3 --out .lab/digital-twin/fd07`; expected ba run manifests, contacts and pose traces, không overlap exclusive reservation, mỗi run có progress hoặc explicit failure reason. Không ghi `passed` nếu backend chỉ protocol double.
- [ ] Chạy FD03/FD04/FD08 cùng runner; verify mục tiêu blocked không tạo completed, stale map không dispatch goal mới. Review/commit `feat: simulate pedestrians and shared robot traffic`.

## Task 5: Coffee domain tiếp nhận evidence của plant — BV-01/BV-02/BV-03/BV-06/BV-07

**Dependencies:** F04 của [kế hoạch nền](01-foundation-mock.md) đã tạo coffee job/recipe/resource domain, typed cell commands/observations và mock adapters. Task này không tạo state machine thứ hai, không tạo schema beverage trùng coffee. Nghiệp vụ production mới bổ sung vào chính module F04.

**Files:**

- Modify `source/packages/domain/src/beverage/module.ts`, `recipe.ts`, `cell.ts`, `handoff.ts` đã được F04 tạo, hoặc chia file trong cùng module theo cấu trúc F04 đã chốt; không tạo registry song song.
- Modify `source/packages/domain/src/kitchen/ticket.ts` extract shared ready decision nếu F04 chưa làm; giữ authorization/partial readiness/inventory semantics.
- Create `source/tests/integration/coffee-simulation-evidence.test.ts`, `coffee-simulation-resources.test.ts`, `source/tests/support/coffee-simulation-lab.ts`.
- Consume schemas `coffee-recipe`, `cell-command`, `cell-observation` từ F01/F04; mọi extension có version compatibility test.

**Interfaces:** Adapter chuyển raw coffee machine/ice/milk/cup evidence thành canonical `CellObservation` (generated type). Module source nhận observation qua bound station principal; dùng command registry F04, không expose raw vendor signal. `readyTicketDecision(c: CommandEnvelope, snapshots: Snapshot[]): Decision` là helper shared của Kitchen.Ready và coffee completion nếu chưa có. Helper chỉ được gọi sau recipe, device identity, measurement và interlock guards; domain không gọi nested `processCommand()`.

- [ ] Viết failing tests cup mismatch trước effect, máy chưa ready, hai jobs reserve cùng machine, ice jam/milk empty, ACK không ready, measurement ngoài tolerance, boot đổi thành unknown và cancel vẫn giữ quantity đã phát.

```ts
test('brew ACK does not make espresso ready and replay cannot brew twice', async () => {
  const rig = await createCoffeeSimulationRig();
  const job = await rig.reserve({ recipeId: 'espresso', recipeRevision: 1, cupId: 'cup-1' });
  await rig.startRecipeStep(job.id, 'brew-1');
  await rig.observeDevice({ commandId: 'brew-1', status: 'accepted' });
  expect(await rig.readyQuantity()).toBe('0');
  await rig.observeDevice({ commandId: 'brew-1', status: 'completed',
    measuredQuantity: { value: '0.000036', unit: 'm3', provenance: 'modelled' } });
  await rig.verifyOutput(job.id);
  await rig.replayLastObservation();
  expect(await rig.readyQuantity()).toBe('1');
  expect(await rig.brewEffectCount()).toBe(1);
  expect(await rig.servedQuantity()).toBe('0');
});
```

Fixture `createCoffeeSimulationRig` dùng production registry, SQLite và principal bar; phương thức fixture chuyển sang commands F04. Espresso test quantity 0,000036 m³ với tolerance 0,000003 m³ là giá trị model minh họa, không phải recipe máy thật. Chạy thêm iced milk coffee fixture để kiểm ordered brew/ice/milk steps, không gắn cùng tolerance cho mọi ingredient. Volume m³, mass đá kg, temperature K; decimal string được xử lý exact theo helper F04.

- [ ] Chạy từ source `pnpm exec vitest run tests/integration/coffee-simulation-evidence.test.ts tests/integration/coffee-simulation-resources.test.ts`; expected fail trước bổ sung plant evidence guards, pass sau implementation với exact conservation assertions.
- [ ] Bind observation device/boot/seq/command/recipe revision; kiểm machine ready, cup type, milk batch/cleaning và temperature provenance. Temperature unknown không được thay bằng 0 hoặc model value giả hardware; bước cần nhiệt độ xác minh bị hold với reason.
- [ ] `complete/verify` dùng shared kitchen ready helper và same transaction, không seed hoặc patch ready snapshot từ bridge. Dose/brew uncertain giữ resource; reconciliation cần role/reason/observed disposition, không tự resend. Map machine fault `ice_jam`, `milk_empty`, `brew_timeout` vào typed fault reasons với partial quantity preserved.

```ts
function withinTolerance(actual: ExactDecimal, target: ExactDecimal, tolerance: ExactDecimal) {
  return actual.subtract(target).abs().compare(tolerance) <= 0;
}
```

`ExactDecimal` là exact quantity helper chọn tại F04, không thêm một thư viện decimal khác tại task này; quantity test chạy biên dưới/trên chính xác. Kiểm tolerance chỉ sau đủ identity/readiness/freshness guards.

- [ ] Chạy regression `pnpm exec vitest run tests/integration/kitchen-allocation.test.ts tests/integration/stock-consumption.test.ts tests/integration/simulated-delivery.test.ts tests/integration/mission-queue.test.ts`; expected partial ready, multi-station minimum, inventory và served invariants còn nguyên. `pnpm contracts:check`, `pnpm typecheck`. Review/commit `feat: validate coffee plant evidence in source domain`.

## Task 6: Device simulation và physical cup coupling — BV-03/BV-04/BV-05/BV-08

**Files:**

- Consume `source/packages/cell-adapters/src/contract.ts`, `mock-coffee.ts` và dispatcher từ F04; create `source/packages/cell-adapters/src/coffee-io-sim.ts`, `source/packages/lab-runtime/src/v2/beverage/plant-session.ts`.
- Create `source/robotics/simulation/beverage_cell.py`, `cup_transfer.py`, `collision/arm_swept_path.py`, `tests/test_beverage_cell.py`, `tests/test_cup_transfer.py`, `tests/test_arm_swept_path.py`. Plan02 sở hữu geometric checker; plan03 A05 tiêu thụ report, không implement checker thứ hai.
- Create `source/tests/integration/beverage-simulator.test.ts`, `beverage-handoff.test.ts`.
- Modify arm adapter integration from plan arm only after its port is available; do not implement LinuxCNC controller here.

**Interfaces:**

```ts
interface CoffeePlantAdapter {
  describe(): Promise<{id: string; validation: 'simulated'; modelVersion: string}>;
  execute(command: {commandId: string; jobId: string; cupId: string;
    kind: 'brew'|'dispense_milk'|'dispense_ice'; recipeRevision: number;
    quantity: {value: string; unit: 'm3'|'kg'}; fencingEpoch: number}):
    Promise<{accepted: boolean; unknown: boolean}>;
  reconcile(commandId: string): Promise<{status: 'running'|'completed'|'failed'|'unknown';
    evidence: EvidenceRef[]}>;
  observe(listener: (observation: CellObservation) => void): () => void;
}
```

`CellObservation` là generated type của schema F01/F04. `CoffeePlantAdapter` là port simulation nội bộ mở rộng contract cell-adapters đó; không tạo contract command wire song song. Adapter port không có method trực tiếp chỉnh ready/served. `TransferEvidence` do canonical telemetry/evidence contracts định nghĩa gồm cup/from/to/transfer/command IDs, gripper/dock/presence readings và timestamps, không arbitrary string “success”.

- [ ] Viết test failed transfer: robot tới gần nhưng chưa dock, gripper release ACK nhưng tray presence thiếu, device reconnect sau dose unknown.

```ts
test('release ACK without receiving sensor cannot transfer cup ownership', async () => {
  const rig = await createCupTransferRig();
  await rig.pickVerifiedCup();
  await rig.armReleaseAck();
  expect(await rig.cupOwner()).toBe('arm:arm-1');
  await expect(rig.confirmTransfer()).rejects.toThrow('TRANSFER_EVIDENCE_INCOMPLETE');
  expect(await rig.robotLoaded()).toBe(false);
});
```

Create `source/tests/support/beverage-transfer-lab.ts` fixture trong task này, source domain thực + fake sensor adapter có observation identity; test Python khác kiểm attachment physics.

- [ ] Dùng mock coffee process model F04 trong `coffee_io_sim`: machine ready/brew cycle, milk flow/tare/settling, ice dispensing/jam/partial mass, cleaning và nhiệt độ có quality. Effect dispatcher claim-before-send, query-before-reconcile, không resend brew/dose unknown. SIL cup collision/attachment phản hồi gripper và destination sensor zone; liquid scalar/mass estimate mang model provenance.
- [ ] Nối arm request/evidence theo plan arm. Nếu chưa có controller-feedback loop, capability ghi `open_loop_visualization`; không tick checkbox closed-loop. Single actuator authority per joint phải được checker phát hiện và fail nếu có hai publisher. Full R-SIM cần geometric self/scene/attached-cup swept-path checker có engine/model trace cho ARM03; dynamics/force optional. Checker thiếu làm ARM03 not_run và chặn full R-SIM, controller-only PoC vẫn có thể pass đúng phạm vi.
- [ ] Implement `check_swept_path(asset_revision, world_revision, joint_trace, attachments) -> CollisionReport`: broad-phase swept bounds, narrow-phase link/self/world/cup geometry với subdivision bảo thủ theo joint movement; allowed contact pairs khai báo có revision và phase (gripper/cup chỉ khi grasp/release hợp lệ); report ghi subdivision bound/conservative margin hoặc continuous collision method. Test đường giữa hai sample cắt fixture, cup va bàn dù flange không va, self-collision và expected allowed gripper/cup contact. Không lấy sampling endpoints đơn thuần làm bằng chứng swept-path. Report ghi engine/version, geometry refs và colliding pair/time interval; engine chưa cài trả unavailable.
- [ ] Chạy `pnpm exec vitest run tests/integration/beverage-simulator.test.ts tests/integration/beverage-handoff.test.ts`; Python `python3 -m pytest robotics/simulation/tests/test_beverage_cell.py robotics/simulation/tests/test_cup_transfer.py robotics/simulation/tests/test_arm_swept_path.py -q`; expected ownership conservation, actual scalar mass không vượt cup bounds.
- [ ] Linux SIL proposal: `node scripts/lab-sil.mjs run --scenario BV01 --seed 19 --backend-set coffee-simulation --out .lab/digital-twin/bv01`; expected server registry resolve `coffee-simulation` thành `gazebo_nav2,linuxcnc_sim,coffee_io_sim`, joint/controller/device/plant traces cùng causality IDs hoặc fail unavailable. Mất arm backend không chạy thay bằng animation.
- [ ] Review/commit `feat: couple beverage devices and verified cup transfers`.

## Task 7: Scenario coverage, report và export artifact — SIM-08/SIM-10, BV-08

**Files:**

- Create `source/packages/lab-runtime/src/v2/scenarios/food-delivery.ts`, `beverage.ts`, `combined-campaign.ts` nếu plan 01 chưa tạo các module này; mở rộng registry từ plan 01, không tạo registry song song.
- Create `source/packages/lab-runtime/src/v2/reports/simulation-evidence.ts`.
- Create `source/tests/integration/lab-v2-scenario-matrix.test.ts`, `lab-v2-simulation-report.test.ts`.
- Create `lab/fixtures/scenarios/food-beverage-campaign.json` và `lab/tests/integration/simulation-capability.test.ts` theo test runner hiện có của lab.
- Modify `source/scripts/export-lab-runtime.mjs` theo artifact negotiation của plan 01; compiler/worker Linux artifact phát hành riêng kèm digest, không nhét dependency ROS vào mock package.

**Interfaces:** Scenario registry resolve FD01–FD08/BV01–BV08 + SYS references, trả required capabilities trước run; report builder nhận source journal/effects + immutable evidence refs và trả typed v2 report. UI đọc support matrix từ health/capability, không hardcode “available”.

- [ ] Viết test matrix: mỗi ID có requirement refs, fixtures, backend support và oracle; duplicate scenario ID/no tests/zero measurement phải thất bại. Mock và SIL dùng cùng business invariants; physics expectations chỉ dùng SIL.

```ts
test('missing required backend cannot silently produce a passing run', async () => {
  const admission = await admitScenario('BV01', { mode: 'simulation',
    backendSetId: 'coffee-simulation', available: ['gazebo_nav2', 'coffee_io_sim'] });
  expect(admission.status).toBe('unavailable');
  expect(admission.reasons).toContain('BACKEND_MISSING:linuxcnc_sim');
  expect(admission.effects).toHaveLength(0);
});
```

`admitScenario` là helper mới export từ scenario registry kế hoạch 01, chỉ phục vụ preflight; field `available` trong test fixture phía server, không từ browser.

- [ ] Tạo reports phân biệt business pass/physics not_run; modelled spill/battery không mang provenance measured; open-loop không closed-loop. Recipe/cup ownership events phải truy đến command/journal/evidence cụ thể.
- [ ] Chạy source `pnpm exec vitest run tests/integration/lab-v2-scenario-matrix.test.ts tests/integration/lab-v2-simulation-report.test.ts tests/integration/lab-runtime-contracts.test.ts tests/integration/lab-runtime-artifact.test.ts`; `pnpm contracts:check`, `pnpm typecheck`. Lab command đề xuất `pnpm exec vitest run tests/integration/simulation-capability.test.ts`.
- [ ] Chạy SIL campaign `node scripts/lab-sil.mjs run --campaign food-beverage --seed 23 --repeat 3 --out .lab/digital-twin/campaign`; `node scripts/lab-sil.mjs verify --input .lab/digital-twin/campaign`; expected exact run count, source/asset/backend hashes, reservation/cup conservation, contact result/measurement count và honest coverage. Prerequisite thiếu → not_run/exit 2, không “pass với skip”.
- [ ] Export từ clean source checkout `node scripts/export-lab-runtime.mjs /tmp/mekoniq-lab-runtime-v2`; artifact test chạy mock CLI từ cwd ngoài checkout trên Node 24 macOS và Linux. Không yêu cầu cài Gazebo để import/start mock. Cập nhật lock Lab chỉ sau manifest/hash verified theo kế hoạch 01.
- [ ] Review/commit riêng từng repo: source `feat: verify food and beverage simulation campaigns`; lab `test: verify simulation capability and report provenance`.

## Checklist trước khi đánh dấu kế hoạch hoàn thành

- [ ] SIM-01..SIM-10 và BV-01..BV-08 đều có test/evidence ID; scenario semantics khớp verification canonical.
- [ ] Không có source observation từ browser identity; không profile hardware giả; v1 schema/test vẫn pass.
- [ ] Mock chạy được riêng không ROS trên hai OS; SIL unavailable được trình bày trung thực.
- [ ] FD07 có hai robot trong một world, BV01 có cup ledger và transfer evidence; combined campaign chia sẻ resources.
- [ ] Report không ghi hardware readiness, physical stop, calibrated spill hay food safety từ mock/SIL.
- [ ] Root evidence index ghi commit từng repo, version artifact, commands thực sự chạy, result và limitations; không ghi Expected như actual.
