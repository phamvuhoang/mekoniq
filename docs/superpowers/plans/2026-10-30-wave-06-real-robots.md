# Wave 06 — Valetudo, ROS 2/Nav2 và pilot robot thật Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển cùng nghiệp vụ sang robot thật với adapter conformance và bằng chứng commissioning.

**Architecture:** Executor là chủ phát lệnh duy nhất, persist intent/native goal/epoch và reconcile trước retry. Map binding/capability/traffic admission được kiểm trước dispatch.

**Tech Stack:** TypeScript Valetudo adapter, native HTTP/MQTT transport, Python/rclpy/SQLite agent, ROS 2 Jazzy, Gazebo Harmonic.

**Spec:** [Production](../specs/2026-10-30-production-platform-design.md), [Continuity](../specs/2026-10-30-offline-continuity-design.md), [F01–F30](../../product/2026-10-30-capability-matrix.md).

## Global Constraints

- “Xây lại mã trong `source`; `trial` là nguồn tham khảo hành vi, không phải nhánh để sửa.”
- “Cloud là nền tảng trung tâm. Không lắp máy chủ riêng tại nhà hàng.”
- “Bản đầu dùng **coordinator cố định, không tự bầu leader khi timeout**.”
- “Tiền lưu số nguyên theo đơn vị tiền nhỏ nhất; VND là đồng. Không cộng tiền bằng float.”
- “Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.”
- “Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit.”
- Node.js 24 LTS; PostgreSQL 18; TypeScript strict; SQLite native trên Android; robot baseline ROS 2 Jazzy / Ubuntu 24.04 / Gazebo Harmonic.
- Đọc [plan tổng và hợp đồng dùng chung](2026-10-30-production-implementation-plan.md) trước task; mọi đường dẫn/command tính từ `source/`.
- Đây là kế hoạch, chưa có application files hoặc scripts bên dưới. Tạo chúng tại task sở hữu; không chạy lệnh triển khai/robot thật chỉ để kiểm tra tài liệu.
- Không đánh dấu PASS khi thiếu thiết bị/provider; ghi `blocked_external` cho đúng acceptance gate, tiếp tục task không phụ thuộc.

---

## Entry / exit

**Entry:** W03 robot contract và W04 recovery đạt; W05 đạt trước gate pilot B. Cần firmware/model/endpoint thật để nghiệm thu phần cứng.

**Exit:** Valetudo và ROS2 adapter đạt conformance; Gazebo scenarios đạt; chỉ profile hardware_validated/venue_approved được bật tại venue pilot.

**Đầu ra chạy được:** POS tạo cùng mission cho Valetudo hoặc Nav2; thử mạng mất, STOP/cancel, đích cũ và reboot; không nhận false arrived.

### W06-T01: Capability registry, map binding và traffic admission

**Depends on:** W03-T04, W04-T05

**Files:**

- Create: `packages/domain/src/fleet/{capabilities,map-binding,admission,reservations}.ts`.
- Create: `packages/contracts/schemas/robot-manifest.schema.json`, `apps/operations-ui/src/routes/RobotSetup.tsx`.
- Test: `tests/integration/robot-admission.test.ts`.

**Interfaces:**

- Consumes: RobotAdapter manifest và map identity, parking/charging distinct, footprint/load.
- Produces: `eligibleRobots(mission,profiles):Eligibility[]`; `Robot.BindMap`, `Zone.Reserve`, `Zone.Release`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("a known coordinate on a stale map is not dispatchable", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("robot","sim-1",{mapRevision:"map-2",bindingRevision:"map-1",ready:true});
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1"})).code)
      .toBe("MAP_BINDING_STALE");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/robot-admission.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Match every stop, payload/footprint/trays/battery/capability before score. Opaque vendor map ID hoặc explicit operator binding epoch; same image size không chứng minh identity. Robot không enforce zones thì serialized conflicted movement.

```ts
export function bindingCurrent(binding:{mapId:string;revision:string},
  robot:{mapId:string;revision:string}) {
  return binding.mapId===robot.mapId && binding.revision===robot.revision;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Setup taught waypoint per robot/map, unit/frame explicit mét/radian domain vs cm adapter. Missing dock uses parking. UI cannot bypass capability by picking specific robot.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/robot-admission.test.ts`; kỳ vọng PASS. Unknown driver rejected, overloaded robot, no speed support, map reset, reservation unknown no release on TTL. Mixed vendor traffic unsafe paths stay pending. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: admit missions only to validated robot capabilities"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W06-T02: Valetudo REST/MQTT transport và completion evidence

**Depends on:** W06-T01, W01-T03

**Files:**

- Create: `packages/robot-adapters/src/valetudo/{rest,mqtt,capabilities,map,completion,reconcile}.ts`.
- Create: `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/executor/{ExecutorService,ExecutorJournal,NativeRobotTransport,ExecutorPlugin}.kt`.
- Create: `apps/tablet-android/src/robot-executor-bridge.ts`, `tests/android/ValetudoExecutorRecoveryTest.kt`.
- Create: `tests/fixtures/valetudo/`, `docs/operations/valetudo-profile.md`.
- Create: `tests/support/valetudo-rig.ts`.
- Test: `tests/adapters/valetudo-conformance.test.ts`.

**Interfaces:**

- Consumes: RobotAdapter; official pinned Valetudo schema and test fixture server; native HTTP transport.
- Produces: `ValetudoAdapter` implements adapter contract; protocol profile declares transport + tested firmware + offline availability. Native plugin `Executor.submit(command:RobotCommand):Promise<NativeAcceptance>`, `reconcile(commandId:string):Promise<NativeExecutionState>`, `requestStop(reason:string):Promise<StopAcknowledgement>` dùng chung schema; mỗi robot chỉ được bind một executor.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createValetudoRig } from "../support/valetudo-rig";
test("HTTP 200 plus stale idle telemetry cannot mean arrival", async () => {
  const rig = await createValetudoRig();
  try {
    rig.server.acceptGoto();
    rig.server.telemetry({status:"idle",mapRevision:"old",observedAt:1});
    await rig.adapter.execute(rig.command("c-1"));
    expect(rig.events.filter(e=>e.type==="completed")).toHaveLength(0);
  } finally { await rig.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:adapters -- tests/adapters/valetudo-conformance.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Pin official routes/capability version from supplied robot; REST LAN for no broker deployment. MQTT command no retain, per-robot ACL; do not switch transports mid-trip. Fresh position+matching goal/map+status needed; uncertainty becomes needs_attention.

```ts
export function arrivalConfirmed(s:{fresh:boolean;mapMatches:boolean;goalMatches:boolean;
  stationary:boolean;distanceM:number;toleranceM:number}) {
  return s.fresh && s.mapMatches && s.goalMatches && s.stationary &&
    s.distanceM <= s.toleranceM;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** `createValetudoRig` starts protocol emulator with delayed/duplicate/status/map responses, uses real adapter. Trên Android, adapter TS gửi typed command qua ExecutorPlugin; chỉ NativeRobotTransport được phát REST/MQTT mutation tới endpoint đã provision. Không cho WebView truyền URL/request tùy ý hoặc mở một đường điều khiển thứ hai. ExecutorJournal lưu command ID/hash, control epoch, sending state trước I/O và receipt/observations sau I/O. Crash giữa hai bước phải reconcile; nếu firmware không có query goal ID đáng tin thì giữ unknown, không tự gửi lại. Native service giữ heartbeat/expiry/stop policy khi UI suspend; completion chưa đủ chứng cứ giữ pending. Parse compressed map with max inflated size; reject invalid endpoints/config. STOP then retarget waits evidence, not arbitrary sleep as success.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:adapters -- tests/adapters/valetudo-conformance.test.ts`; kỳ vọng PASS. Chạy `apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.ValetudoExecutorRecoveryTest` với protocol server và kiểm native crash/reopen không phát goto lần hai, stale epoch bị từ chối, UI suspend không ACK arrival giả. Retained stale telemetry, no pose, no ACK, same goal resend, broker down, reboot recovery, unsupported speed; protocol tests + supervised hardware proof separate. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: integrate valetudo through evidence-based navigation adapters"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W06-T03: ROS executor durable journal và native action ownership

**Depends on:** W06-T01, W00-T02

**Files:**

- Create: `robotics/agent/mekoniq_agent/{__init__,journal,executor,protocol,ownership}.py`, `robotics/agent/pyproject.toml`.
- Create: `robotics/agent/tests/test_executor_recovery.py`.
- Create: `robotics/agent/tests/{__init__.py,support/__init__.py,support/executor_fixtures.py}`.
- Test: `robotics/agent/tests/test_executor_recovery.py`.

**Interfaces:**

- Consumes: Generated JSON schema/ES256 verification, command IDs/epochs, SQLite store.
- Produces: `Executor.submit(command)`, `.reconcile()`, `.request_stop()`; `NativeNavigation` port methods start/query/cancel; `FakeNativeNavigation` test only.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```python
import pytest
from mekoniq_agent.executor import Executor, SimulatedCrash
from .support.executor_fixtures import FakeNativeNavigation, command_fixture

def test_crash_after_native_accept_does_not_start_second_goal(tmp_path):
    native = FakeNativeNavigation()
    command = command_fixture(command_id="c-1", control_epoch=3)
    first = Executor(tmp_path / "agent.db", native, fault="after_native_accept")
    with pytest.raises(SimulatedCrash):
        first.submit(command)
    recovered = Executor(tmp_path / "agent.db", native)
    recovered.reconcile()
    recovered.submit(command)
    assert native.start_count == 1
    assert recovered.status("c-1") in {"executing", "unknown"}
```

- [ ] **2. Chạy RED.** Trong venv đã chuẩn bị ở W00-T02, chạy `python3 -m pip install -e robotics/agent` rồi `python3 -m pytest robotics/agent/tests/test_executor_recovery.py -q`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Write sending state and stable goal UUID before native call; if crash query by UUID/native state, do not resend uncertain. Validate command scope/expiry/controlEpoch; journal state machine atomic. No cloud direct ROS endpoint.

```python
def can_submit(command, owner_epoch, now):
    return (
        command["controlEpoch"] == owner_epoch
        and command["expiresAtMs"] > now
        and command["kind"] == "navigate"
    )
```

- [ ] **4. Nối vào runtime và lưu trữ.** `support/executor_fixtures.py` cung cấp fake native backend giữ accepted goals qua lần tạo lại Executor. Hook `fault="after_native_accept"` raise `SimulatedCrash` sau native ACK, đóng journal mà không ghi tiếp hoặc cancel goal; chỉ bật qua dependency injection của test. Thêm subprocess kill test để kiểm chứng crash thật. MQTT/WebSocket transport outbound/cloud/LAN with signer. Journal statuses accepted/sending/executing/unknown/terminal, startup recover before advertised ready.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `python3 -m pytest robotics/agent/tests/test_executor_recovery.py -q`; kỳ vọng PASS. O10/O11/O20 real SQLite, duplicate/out-of-order, forged epoch, stale command, time skew and domain mismatch. Python/TS contract fixtures match. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: persist robot execution and recover native action ownership"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W06-T04: Nav2 action bridge, localization và nhà hàng Gazebo

**Depends on:** W06-T03

**Files:**

- Create: `robotics/agent/mekoniq_agent/nav2_adapter.py`, `robotics/navigation/{launch,config}/`.
- Create: `robotics/description/{urdf,config}/`, `robotics/simulation/{worlds,launch}/`, `robotics/simulation/tests/test_restaurant.py`.
- Create: `robotics/agent/tests/support/{fake_action_client,fixtures}.py`.
- Test: `robotics/agent/tests/test_nav2_adapter.py`.

**Interfaces:**

- Consumes: Jazzy NavigateToPose actual action/result; NativeNavigation port, map/odom/base frames.
- Produces: `Nav2Navigation` port; launch `restaurant_sim.launch.py`; profile namespaces, localization readiness and result evidence.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```python
def test_rejected_or_aborted_nav2_goal_never_completes():
    adapter = Nav2Navigation(FakeActionClient(accepted=True, terminal="ABORTED"))
    adapter.start(goal_fixture())
    result = adapter.poll()
    assert result.status == "failed"
    assert result.completed is False
```

- [ ] **2. Chạy RED.** `python3 -m pytest robotics/agent/tests/test_nav2_adapter.py -q`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Check action accepted + terminal SUCCEEDED + error_code; cancel confirmation separate. Namespace từng robot, SI units, quaternion yaw conversion, lifecycle/localization readiness. Profile measured geometry inputs required for hardware, sim geometry explicitly illustrative.

```python
if not goal_handle.accepted:
    return NavigationResult(status="rejected", completed=False)
if terminal_status != GoalStatus.STATUS_SUCCEEDED or result.error_code != 0:
    return NavigationResult(status="failed", completed=False)
return NavigationResult(status="completed", completed=True)
```

- [ ] **4. Nối vào runtime và lưu trữ.** SDF world kitchen/tables/narrow corridor/moving obstacle; Nav2 + Gazebo Harmonic via distro-pinned ROS images Linux. Mac use supported Linux container/VM simulation, don't claim native mac robot runtime. cmd_vel arbitration one source; no platform direct motor control.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `python3 -m pytest robotics/agent/tests/test_nav2_adapter.py -q`; kỳ vọng PASS. colcon build/test Jazzy, six Gazebo scenarios navigate/load/obstacle/replan/handoff/return; blocked timeout, localization lost and map change. Unit fake does not satisfy Gazebo gate. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: navigate restaurant missions through jazzy nav2"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W06-T05: Commission S100/ZLTECH profiles và safety boundary

**Depends on:** W06-T01..W06-T04

**Files:**

- Create: `robotics/hardware/profiles/{wheeltec-s100,zltech-differential}.schema.json`.
- Create: `docs/operations/{robot-commissioning,safety-handoff}.md`, `tests/hardware/commissioning.py`.
- Test: `tests/hardware/test_profile_validation.py`.

**Interfaces:**

- Consumes: Supplier SDK/firmware pinout, measured dimensions/load/stop distance, navigation driver outputs.
- Produces: Signed commissioning manifest with `integration_tested/hardware_validated/venue_approved`; driver integration per provided vendor ROS interface.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```python
def test_profile_without_independent_stop_evidence_is_not_venue_approved():
    profile = profile_fixture(safety_evidence=None, tested_payload_kg=0)
    result = validate_commissioning(profile, target_payload_kg=20)
    assert not result.venue_approved
    assert "SAFETY_EVIDENCE_MISSING" in result.reasons
```

- [ ] **2. Chạy RED.** `python3 -m pytest tests/hardware/test_profile_validation.py -q`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Validate actual robot vendor model/firmware, /odom /scan /tf, encoder units and watchdog independent computer. Register CAN/RS485 addresses only from supplied documentation, no invented hardware values. Measure braking/turn/load, E-stop/bumper/cliff paths with supervision.

```python
def deployment_status(report):
    if not report.safety_verified or not report.payload_verified:
        return "integration_tested"
    return "venue_approved" if report.venue_acceptance_signed else "hardware_validated"
```

- [ ] **4. Nối vào runtime và lưu trữ.** Commission tool read-only by default; active-motion suite needs explicit target/observer/test-area configuration at execution. Software requests STOP; hardware reset signal must come from controller. If supplier package absent, mark profile blocked_external and finish Nav2 simulator/contract work.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `python3 -m pytest tests/hardware/test_profile_validation.py -q`; kỳ vọng PASS. Physical tests report actual payload/speed/distances and firmware. No claiming safety certification from a pass or substituting household vacuum for 20–30kg chassis. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "docs: define measurable robot commissioning and vendor profiles"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W06-T06: Import trial read-only và gate pilot B

**Depends on:** W05, W06-T01..W06-T05

**Files:**

- Create: `scripts/import-trial-config.mjs`, `tests/fixtures/trial/site-baseline.json`.
- Create: `tests/e2e/pilot-service.spec.ts`, `docs/implementation/gates/B-pilot.md`.
- Create: `tests/e2e/trial-service-preset.spec.ts`, `docs/implementation/trial-service-parity.md`.
- Test: `tests/integration/trial-config-import.test.ts`.

**Interfaces:**

- Consumes: User-exported trial configuration only; source baseline reference, scope and map-binding schemas.
- Produces: Dry-run/import configuration report with unmapped fields; one-venue pilot acceptance dossier; bảng đối chiếu từng hành vi baseline trial với test và setting của preset `trial-service`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
test("trial import cannot replay runtime missions or billing state", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.importTrial({points:{},robots:[],missions:[{id:1}],orders:[{id:1}]});
    expect(await lab.effectCount("robot.execute")).toBe(0);
    expect(await lab.count("CashRecorded")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/trial-config-import.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Whitelist site/menu/robot/waypoints; runtime state rejected with explicit report. Legacy features map to new independent keys with preview, no reading other session's spec. Teaching points require map identity revalidation.

```ts
const importable = new Set(["name","points","robots","menu","timing","features"]);
const accepted = Object.fromEntries(Object.entries(input).filter(([key])=>importable.has(key)));
const rejectedFields = Object.keys(input).filter(key=>!importable.has(key));
```

- [ ] **4. Nối vào runtime và lưu trữ.** Pilot checklist uses one control source only, close/reconcile trial missions/bills before switch. Shadow mode telemetry-only. Preset E2E khởi tạo venue trống bằng luồng enrollment/configuration thật, chọn `trial-service`, cấu hình điểm/robot và tắt kho/CRM/booking/chuỗi/provider ngoài. Chạy giao nhiều bàn, xác nhận khay, hủy khi có tải, thu dọn, gọi/dẫn khách, menu–order–yêu cầu thanh toán theo từng cờ; kiểm UI chỉ hiện chức năng đã bật và API từ chối chức năng tắt. Nhánh pay kiểm receipt/quyền production, không dùng xác nhận của khách để tự settled. Dùng test/fixtures hiện có làm tham chiếu hành vi, không import runtime state. Future actual cutover in W11 after deploy result reviewed; no running trial deploy scripts.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/trial-config-import.test.ts`; kỳ vọng PASS. Chạy `pnpm test:e2e -- tests/e2e/trial-service-preset.spec.ts`; chỉ thay settings và fixture venue, không sửa code/build để làm preset pass. Old/current schema sample, duplicate import, stale point reference, unknown driver refused; full real-device O01/O10/O11 with approved robot. Gate B explicitly blocked if hardware absent. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W06-T06.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: migrate trial configuration into a controlled pilot"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Có versioned manifest/chứng cứ theo từng model; unsupported capability bị từ chối.
- [ ] Không suy từ mô phỏng ra tải/độ an toàn hay VDA compatibility.
- [ ] Gate B gồm POS+continuity+robot commissioning ở một nhà hàng, chưa là toàn bộ Mmenu.
