# MEKONIQ Robot Lab Implementation Plan

> Cập nhật thực thi 2026-11-04: bản Lab và vertical slice S01 đã được hiện thực, runtime đã re-pin source/main W00–W11 (`a078777`). Xem [tiến độ theo task](../implementation/progress.md), [bằng chứng cập nhật](../implementation/evidence/2026-11-04-source-w11.md) và [hướng dẫn chạy](../../README.md). Nội dung dưới đây giữ nguyên checklist nghiệm thu của plan; phần còn thiếu không được đánh PASS. Các mô tả W05/W06 đang phát triển bên dưới là bối cảnh khi lập plan, không phải trạng thái source hiện tại.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Use `subagent-driven-development` only when parallel agent execution is explicitly selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây Lab thiết kế và kiểm chứng robot giao món, giữ giao diện MEKONIQ, dùng cùng mission/contract/executor với `source`, rồi nghiệm thu cấu hình trên robot thật.

**Architecture:** Web Lab giữ configurator, world editor và evidence UI. Source giữ nghiệp vụ, durable runtime, robot adapter và robotics; gateway local cho simulation, source UI/provisioning cho hardware. Artifact và revision khóa sự tương thích giữa hai repository.

**Tech Stack:** TypeScript strict, Vite/HTML/CSS, Three.js lazy load + SVG/Canvas fallback, Vitest/Playwright; Node.js 24, pnpm 10; source SQLite/Android/Python, ROS 2 Jazzy, Ubuntu 24.04, Gazebo Harmonic.

**Spec:** [Product/system](../specs/2026-11-01-mekoniq-robot-lab.md), [source integration](../specs/2026-11-01-source-integration.md), [baseline](../research/2026-11-01-baseline-and-references.md).

## Global Constraints

- Node.js 24 LTS; TypeScript strict; robot baseline ROS 2 Jazzy / Ubuntu 24.04 / Gazebo Harmonic.
- `lab/`: web Lab, configurator, mô hình trình bày, scenario, báo cáo, thiết kế và kế hoạch.
- `source/`: domain nhà hàng, schema dùng chung, simulator nghiệp vụ, adapter Valetudo, executor Android/ROS, Gazebo, commissioning.
- Một robot chỉ có một native command owner/executor trong mỗi control epoch.
- Runtime native không fallback simulator. Không quảng bá simulated thành hardware_validated từ dropdown hoặc JSON import.
- Replay/historical import không thực thi robot/payment/print effects.
- Tại nhà hàng vẫn cloud + tablet coordinator + compute trên robot; Lab gateway/Gazebo không là máy chủ bắt buộc mới ở venue.
- Giữ nguyên token/typography và ba ngôn ngữ Việt/Nhật/Anh của spec; Việt mặc định.
- Không sửa/vận hành `trial`, không chạm cổng `1880`/`1884`, không dùng key/tenant robot đang chạy trong fixture.
- Mọi file/command dưới đây là **đề xuất để tạo khi thực thi task**, không phải khẳng định đã có. Không chạy command phần cứng để “kiểm thử plan”.
- Không đánh dấu PASS khi thiếu thiết bị/backend; ghi `blocked_external` cho đúng gate, tiếp tục phần không phụ thuộc.

---

## 1. Thứ tự và phân công

Task ID `Lxx` thuộc Lab, không dùng `Wxx` để tránh trùng ledger source. Owner dưới đây là vai trò cần phân công khi triển khai, không giả định một người đã nhận việc.

| Task | Owner | Depends | Đầu ra review được |
|---|---|---|---|
| L00 | Platform + Lab | Không | Baseline, contract artifact, lock và public schemas |
| L01 | Lab UI | L00 | Shell đúng style, mode, locale, project persistence |
| L02 | Lab + cơ điện | L01 | Configurator/BOM/estimate có provenance |
| L03 | Platform + Lab | L00/L01, W03/W04 | Một journey chạy source thật trong Lab |
| L04 | Lab + robotics | L02/L03 | World editor và geometry/binding revisions |
| L05 | Lab UI | L02 | Assembly/wiring/3D nhỏ, fallback |
| L06 | Lab + QA | L03/L04 | Scenario runner, lỗi, replay, report; G1 |
| L07 | W06 Valetudo owner + QA | W06-T01/T02, L06 | Protocol/native conformance trong Lab |
| L08 | W06 ROS owner + QA | W06-T03/T04, L04/L06 | Gazebo/Nav2 dùng cùng journey; G2 |
| L09 | Platform + Lab | L02/L04/L06, W06-T01 | Export candidate, dry-run/import staging |
| L10 | Android/robotics + operator | L07/L08/L09, W01/W04 devices | Shadow + native tablet/robot test harness |
| L11 | Robotics + venue operator | W05, W06-T05/T06, L10 | Commissioning và venue evidence G3/G4 |

Ưu tiên nguồn lực: L00 → L01 bản nhỏ → L03 → L06/S01 để chứng minh tích hợp sớm. L02/L04 hoàn thiện cấu hình trước khi mở rộng visual L05. Tiến độ W06 không phụ thuộc L05. Task L07/L08 bám owner hiện tại của W06; không tạo implementation song song trong Lab.

Mốc bàn giao: **M1** vertical slice source (L00/L01/L03); **M2** web MVP (thêm L02/L04/L05/L06); **M3** technical validation (L07/L08/L09); **M4** robot/venue (L10/L11). Không gán ngày cố định khi chưa chốt nhân lực, chassis và môi trường Linux.

## 2. Cấu trúc file đích

```text
lab/
  index.html                  # app entry sau L01
  business-plan.html          # nguyên bản index cũ
  package.json, pnpm-lock.yaml, tsconfig.json, vite.config.ts
  config/source-runtime.lock.json
  src/
    main.ts, app.ts, styles/{tokens,layout,components}.css
    i18n/{tr,copy}.ts
    project/{types,store,migrations}.ts
    design/{catalog,validate,configuration}.ts
    cost/{bom,pricing}.ts
    estimates/{energy,drive,stability}.ts
    viewer/{scene,assembly,selection,wiring,fallback}.ts
    world/{model,editor,coordinates,validation}.ts
    runtime/{client,modes,events}.ts
    scenarios/{schema,runner,assertions}.ts
    reports/{metrics,viewer,replay}.ts
    deployment/{bundle,readiness,diff}.ts
  assets/{models,licenses}/
  fixtures/{catalog,worlds,scenarios,reports}/
  tests/{unit,integration,e2e}/
  scripts/{check-source,import-runtime}.mjs
  docs/implementation/{progress,evidence}/
  .runtime/, runs/, dist/      # ignored generated/local data

source/                       # bổ sung ngoài các file W06 đang sở hữu
  packages/contracts/schemas/lab-{project,run,deployment}.schema.json
  packages/lab-runtime/src/{index,session,clock,scenario,report}.ts
  packages/lab-runtime/src/gateway/{server,auth,routes,events}.ts
  packages/lab-runtime/tests/{journey,authorization,recovery}.test.ts
  scripts/export-lab-runtime.mjs
  scripts/import-lab-configuration.mjs
  tests/integration/lab-configuration-import.test.ts
  robotics/simulation/tools/compile_lab_world.py
```

Các thư mục này chưa được scaffold trong đợt spec. Tách file tiếp khi trách nhiệm tăng, không gom toàn app vào index HTML. Thay đổi source chạy Git/test tại source; không stage file W05/W06 của người khác.

## 3. L00 — Khóa baseline và schemas

**Files:** Create `lab/config/source-runtime.lock.json`, `lab/scripts/{check-source,import-runtime}.mjs`; source schemas/export script/package public entry trong mục 2; Test `lab/tests/integration/source-compatibility.test.ts`, `source/tests/contracts/lab-contract.test.ts`.

**Consumes:** RobotCommand/RobotAdapter hiện có; schema generation của source. **Produces:** schema IDs `mekoniq.lab-project.v1`, `mekoniq.lab-run.v1`, `mekoniq.lab-deployment.v1`; `verifyRuntime(lock, runtimeInfo): {ok:boolean; reasons:string[]}`. Artifact đầu chỉ có contracts; runtime functionality thêm ở L03, mỗi lần đều re-pin.

- [ ] Ghi SHA/status hai repo; đối chiếu owner W06 để chọn revision sạch. Chỉ ghi checksum artifact sau khi tạo, không điền giá trị giả. Lấy token/HTML hash theo baseline và chụp screenshot desktop/mobile trước thay trang.
- [ ] Viết test compatibility trước khi có verifier:

```ts
expect(verifyRuntime(
  {sourceCommit:'a', schemaHash:'s1', protocolMajor:1},
  {sourceCommit:'b', schemaHash:'s2', protocolMajor:2}
)).toEqual({ok:false,reasons:['SOURCE_MISMATCH','CONTRACT_MISMATCH']});
```

- [ ] Tạo types, schema fixtures và exporter: build/pack contracts từ source sạch; manifest có SHA-256 artifact, source SHA, schema hash và protocol major. Exporter từ chối dirty source. `import-runtime` kiểm hash trước giải nén/cài, giới hạn path/package và không thực thi lifecycle script từ bundle không tin cậy.
- [ ] JSON schema cấm unknown top-level fields; quantity/currency/units rõ; proposed `maxLoadMinor=gram` phải được source owner xác nhận và ghi schema/fixture trước load admission. Test missing/unknown units bị reject.
- [ ] Chạy `cd source && pnpm contracts:check && pnpm test:contracts`; ở Lab khi L01 có harness chạy `pnpm test:integration -- source-compatibility`. Sai hash/version giữ read-only. Ghi evidence `L00.md`, commit riêng hai repo với subject `feat: publish versioned lab contracts` / `chore: pin lab source contracts`.

## 4. L01 — Shell, mode và project persistence

**Files:** Create package/tsconfig/vite config; `src/{main,app}.ts`, styles/i18n/project/runtime modes; archive `business-plan.html`, modify `index.html`; tests `tests/e2e/shell.spec.ts`, `tests/unit/project-store.test.ts`.

**Consumes:** Token và project schema L00. **Produces:** `ProjectStore.save(project):Promise<void>`, `.load(id):Promise<Project|null>`, `.export(id):Promise<string>`, `.import(json):Promise<Project>`; `allowedActions(mode):string[]`; router 5 màn theo spec.

- [ ] Setup pnpm/Vite/Vitest/Playwright trong Lab, pin exact dependency versions sau khi kiểm Node24; ghi scripts `dev`, `build`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `check:source`. Không thêm cloud service.
- [ ] Copy nguyên bản HTML thành business-plan, kiểm SHA bằng baseline. Dựng shell và nav với 3 locale, lazy panels, keyboard focus. Test tự động trước implementation:

```ts
test('public viewer cannot expose hardware actions', async ({page}) => {
  await page.goto('/?mode=hardware_test');
  await expect(page.getByTestId('runtime-mode')).toHaveText('Preview');
  await expect(page.getByTestId('send-native-goal')).toHaveCount(0);
});
```

- [ ] IndexedDB lưu project revision; import schema validate trước ghi; migration không bỏ input cũ, lỗi có download raw. Thiết kế/source hash thay đổi gắn report cũ stale. Save failure không báo “đã lưu”.
- [ ] Test roundtrip project, malformed file, quota failure, locale switching, browser back/deep link, 375/768/1440px, reduced-motion, keyboard-only. Token test lấy computed style so literal spec. 3D chưa cần ở task này, dùng sơ đồ 2D tĩnh có nhãn “Mô hình minh họa”.
- [ ] `cd lab && pnpm typecheck && pnpm test:unit && pnpm test:e2e -- shell && pnpm build`. Review screenshot, evidence L01, commit `feat: add mekoniq robot lab workspace`.

## 5. L02 — Cấu hình, BOM và estimates

**Files:** `src/design/*`, `src/cost/*`, `src/estimates/*`, catalog fixtures; tests `design-validation.test.ts`, `bom.test.ts`, `estimates.test.ts` trong unit.

**Consumes:** ComponentSpec/RobotDesign theo product spec. **Produces:** `validateDesign(design,catalog):Issue[]`, `estimateEnergy(input):{usableWh:number;runtimeHours:number}|null`, `calculateBom(lines,currency):{totalMinor:string|null;missingIds:string[]}`, `priceForMargin(costMinor:string,marginBasisPoints:number):string`; component IDs ổn định cho L05.

- [ ] Viết các test toán và invalid configuration:

```ts
const energy=estimateEnergy({volts:24, ampHours:20, usable:0.8, derating:0.9, watts:120});
expect(energy?.usableWh).toBeCloseTo(345.6, 6);
expect(energy?.runtimeHours).toBeCloseTo(2.88, 6);
expect(calculateBom([{id:'lidar',quantity:1,priceMinor:null}], 'VND'))
  .toEqual({totalMinor:null,missingIds:['lidar']});
expect(priceForMargin('100000',2500)).toBe('133334'); // ceil đồng, nêu rounding trong UI
```

- [ ] Implement công thức spec; với pin/estimate thiếu input trả null + reasons ở UI, watts≤0 hoặc fraction ngoài (0,1] bị reject. Tiền BigInt hoặc decimal chính xác; `ceil(cost*10000/(10000-marginBp))`, margin 100% bị reject. Giá fixture không tự trở thành supplier quote.
- [ ] Catalog nhỏ: base, driver/wheels, battery/power, LiDAR/compute, tray/tablet. Valetudo preset không cho sửa firmware speed/motor không hỗ trợ. Validate voltage/mass/geometry/capability thiếu; field provenance đi cùng từng estimate và BOM export.
- [ ] Test gear ratio/continuous vs peak torque, zero turning center nhưng swept footprint khác 0, CoM ngoài support polygon, mixed currency thiếu rate, quantity âm, margin/markup và rounding. So sánh 2 design revision, không mutate catalog cũ.
- [ ] `pnpm test:unit -- design-validation bom estimates && pnpm typecheck`; evidence L02, commit `feat: estimate service robot configurations and costs`.

## 6. L03 — Một mission dùng source đầu cuối

**Files:** Source `packages/lab-runtime` factory/clock/session/gateway; lab runtime client/events và UI thao tác journey; create `lab/fixtures/worlds/restaurant-six-tables.json`, `lab/fixtures/scenarios/S01-service.json`; tests source `packages/lab-runtime/tests/journey.test.ts`, lab `tests/e2e/service-journey.spec.ts`.

**Consumes:** Production registry, `processCommand`, SQLite store, SimulatorAdapter, schema L00. **Produces:** CLI local gateway `/lab/v1` với auth từ đầu; `createLabSession(options):Promise<LabSession>` và client cùng protocol.

Hợp đồng dev-only để test/runner dùng:

```ts
interface LabSession {
  command(role: string, type: string, payload: JsonObject, operationId: string): Promise<CommandResult>;
  advance(ms: number): Promise<void>;
  snapshot(kind: string, id: string): Promise<Snapshot>;
  events(): Promise<DomainEvent[]>;
  close(): Promise<void>;
}
// options: {scope, dbPath, clockStartIso, world, robotProfile, sourceCommit}
// JsonObject/CommandResult/Snapshot/DomainEvent import từ source contracts.
```

- [ ] Viết integration test journey tương tự existing simulated-delivery nhưng đi qua factory mới; giữ asserts chuẩn:

```ts
await session.advance(1000); // chỉ hoàn tất travel đã dispatch
const before = await session.snapshot('fulfillment', lineId);
expect(before.state.served).toBe('0');
await session.command('cashier','Mission.ConfirmStop', {
  missionId, stopId, missionRevision, expectedVersion
}, 'handoff-1');
expect((await session.snapshot('fulfillment',lineId)).state.served).toBe('1');
```

Test arrange tạo Session.Open → Order.Place → Kitchen.Ready → Fulfillment.Allocate → Mission.Create; đọc ID/version từ result/snapshot; advance rồi confirm load trước khi advance tới bàn. Không hardcode revision để bỏ concurrency check.

- [ ] Implement factory dùng modules/store source thật; fixture initialization ở dev package, actor scopes test tách biệt. Gateway auth dùng pairing/CSRF/Origin/Host ngay task này; request type allowlist, role không phải free-form quyền tùy browser. Reject hardware mode và robot endpoint input.
- [ ] Tạo world fixture schema L00: bounds 12×8m, bếp `(1,4)`, parking `(1,1)`, 6 bàn tại x=5/9 và y=2/4/6; handoff cách tâm bàn 0.8m về phía x nhỏ hơn, ghi tabletop/footprint illustrative. Profile simulator lấy baseline source với map revision mới và binding cụ thể từ fixture; không chờ editor L04, không gọi tọa độ fixture là điểm đã dạy trên robot thật.
- [ ] Chạy execute effects và Robot.Observe qua code source; inject chung clock. UI đọc cursor/snapshot, không tự nhận complete. Tạo mission standby về parking bằng domain sau handoff, chờ event riêng.
- [ ] Kill/reopen harness SQLite, thử duplicate operation, expired command, browser reload, internet tắt trong môi trường local. Không tự khẳng định Android offline từ test này. Repack runtime sạch và cập nhật lock theo L00.
- [ ] `cd source && pnpm test:integration -- tests/integration/simulated-delivery.test.ts`; tạo script `pnpm test:lab-runtime` cho package mới rồi chạy journey/auth. `cd lab && pnpm test:e2e -- service-journey`. Evidence L03 ghi source artifact SHA, commit `feat: execute lab service journeys through source runtime`.

## 7. L04 — World editor và coordinate contract

**Files:** `src/world/*`, fixtures worlds; `tests/unit/world-coordinates.test.ts`, `tests/integration/world-bindings.test.ts`, `tests/e2e/world-editor.spec.ts`.

**Consumes:** World schema, semantic IDs và LabSession L03. **Produces:** `validateWorld(world):Issue[]`, `screenToWorld(point,view):Point`, `worldToScreen(point,view):Point`; world revision/hash và binding draft. `Point={x:number,y:number}`; `view={scale:number,offsetX:number,offsetY:number}`.

- [ ] Test tọa độ bất đối xứng và y-axis flip:

```ts
const view={scale:20,offsetX:100,offsetY:300};
expect(worldToScreen({x:3,y:7},view)).toEqual({x:160,y:160});
expect(screenToWorld({x:160,y:160},view)).toEqual({x:3,y:7});
```

- [ ] Implement scale/pan, select/form/drag, undo/redo và scene units. Bounds/footprint/wall/waypoint validation dùng geometry thật; target nằm trong bàn/wall bị reject. One-template 6 bàn, bếp/parking/dock distinct; export hashes ổn định.
- [ ] Binding draft theo từng robot map; edit geometry tăng revision và invalidation report; không gửi world edits thành Venue.Configure payload lạ. Schema translator chỉ xuất fields mà source chấp nhận, reporting phần không map được.
- [ ] Test stale map → native start count 0; resize viewport không đổi world positions; import background không có scale giữ uncalibrated; 200 object limit, unknown IDs, duplicate IDs, no keyboard trap. Không cần path planner riêng để vẽ preview.
- [ ] `pnpm test:unit -- world-coordinates && pnpm test:integration -- world-bindings && pnpm test:e2e -- world-editor`. Evidence L04, commit `feat: author versioned restaurant worlds and bindings`.

## 8. L05 — Assembly, wiring và 3D có giới hạn

**Files:** `src/viewer/*`, `assets/models/service-robot.glb` hoặc procedural geometry tự tạo, `assets/licenses/README.md`; `tests/e2e/configurator.spec.ts`.

**Consumes:** Design component IDs, catalog dimensions, selection state. **Produces:** `mountViewer(container,design):{select(id):void;setExplode(t:number):void;dispose():void}`, `renderWiring(design):WiringGraph`; graph có nodes component ID và edges power/data/stop, không pin-level khi chưa có tài liệu.

- [ ] Test UI: chọn khay từ model → đúng row BOM/inspector; thay 2→3 khay đổi mass/cost và geometry; `setExplode(0/1)` không thay design dimensions.
- [ ] Implement primitives/procedural model đủ đẹp cho brand; animation assembly có thứ tự, orbit/fit; không xây modeling tool/CAD. Wiring SVG click dùng cùng selection store. Brand lime dùng highlight/selected, giữ panel dark.
- [ ] Lazy-load renderer; reduced-motion tắt auto spin/explode animation; dispose GPU resources khi chuyển project. Mất WebGL kích hoạt danh sách + 2D thao tác được. File license ghi nguồn mỗi asset, không lấy Drone Lab asset.
- [ ] Playwright snippet bắt buộc:

```ts
await page.goto('/?renderer=2d');
await page.getByRole('button',{name:'Khay 2'}).click();
await expect(page.getByTestId('selected-component')).toHaveText('tray-2');
await expect(page.getByTestId('bom-selected-row')).toHaveAttribute('data-component-id','tray-2');
```

- [ ] `pnpm test:e2e -- configurator && pnpm build`; đo frame time/reference machine theo spec, screenshot 3 locale; evidence L05, commit `feat: visualize robot assembly and functional wiring`.

## 9. L06 — Scenario, fault, replay và evidence

**Files:** `src/scenarios/*`, `src/reports/*`, scenario fixtures S01–S14 (hardware-only assertions đánh not_run ở business mode); source runtime scenario/report; tests `scenario-runner.test.ts`, `report-replay.test.ts`, `gateway-boundary.test.ts` trong integration.

**Consumes:** LabSession L03, World L04, source events. **Produces:** `runScenario(session, scenario):Promise<RunReport>`, `computeMetrics(events,definition):Metric[]`, `openReplay(report):ReplayView`; ReplayView chỉ đọc, không giữ runtime client.

`RunReport` có fields ở product spec §7, assertion record `{id,status:'pass'|'fail'|'blocked_external'|'not_run',expected,actual,evidenceRefs}`. Scenario action dùng enum khai báo trong integration contract; không arbitrary script.

- [ ] Test human wait, unknown và replay không effects:

```ts
const view = openReplay(report);
view.seek(report.durationMs); // seek chỉ đổi read model
expect(nativeStartsAfter - nativeStartsBefore).toBe(0);
expect(view.summary().validation).not.toBe('hardware_validated');
```

Test arrange đếm native starts của session độc lập trước/sau replay, không mock `openReplay` hoặc count. Test report forged `mode=hardware_test` không được nâng profile source.

- [ ] Implement deterministic actor schedule/clock trong business mode, stable seed và run IDs riêng. Fault injection enum: offline, blocked, reboot, delay/drop/duplicate observations; W06/native-specific faults chờ backend và report blocked. Không cài fault API vào source release routes.
- [ ] Metrics tách travel/human wait, sample count; definition version. Replay render journal records, không dispatch. Export report với hash không secrets; local generated assets không commit.
- [ ] Test event gap/reconnect snapshot, boot/sequence ordering, stale data indicator, unknown reservation retention, LAN/WAN distinction, invalid scope/auth/csrf/origin, oversized payload/path traversal, runtime mismatch, slow consumer và bounded pose queue. Native stop observations không bị coalesce cùng pose.
- [ ] Chạy 20 fixed seeds S01/S02/S05–S10/S12/S14 ở business level. `pnpm test:integration -- scenario-runner report-replay gateway-boundary`; source `pnpm test:lab-runtime`, existing mission/continuity regression tests liên quan. Ghi G1 report và limitation; commit `feat: run repeatable lab scenarios with traceable evidence`.

## 10. L07 — Valetudo protocol và Android executor

**Files source:** Các file sở hữu bởi W06-T01/T02: `packages/robot-adapters/src/valetudo/*`, `tests/support/valetudo-rig.ts`, `tests/adapters/valetudo-conformance.test.ts`, Android executor/journal/plugin. **Files lab:** `fixtures/scenarios/valetudo-*.json`, `tests/integration/valetudo-session.test.ts`, runtime mode/readiness UI.

**Consumes:** W06 ValetudoAdapter/Executor.submit/reconcile/requestStop; fixtures endpoint do rig tạo. **Produces:** backend ID `valetudo-protocol` đăng ký server-side, normalized observation/evidence cho run; firmware/transport profile version.

- [ ] Đối chiếu code W06 thực tế trước thay đổi; nếu adapter chưa có, thực thi task W06-T02 trong source trước, không tạo duplicate ở lab.
- [ ] Test tối thiểu dùng native adapter/rig:

```ts
rig.server.acceptGoto();
rig.server.telemetry({status:'idle',mapRevision:'old',observedAt:1});
await rig.adapter.execute(rig.command('c-1'));
expect(rig.events.filter(e=>e.type==='completed')).toHaveLength(0);
```

- [ ] Thêm retained pose, wrong map, missing pose, REST timeout sau send, broker mất, unsupported capability, changed firmware, no trustworthy goal query. Unknown không auto resend; assert native start count ≤1 cho cùng command ID trong cửa sổ crash đã đo.
- [ ] Android test chạy plugin/native transport thật với protocol fixture; suspend WebView, kill process sau send, restart journal. TS-only test ghi protocol level; Android emulator ghi native-emulated, không hardware validated.
- [ ] Chạy command W06 `pnpm test:adapters -- tests/adapters/valetudo-conformance.test.ts` và instrumentation class W06 đã tạo; Lab `pnpm test:integration -- valetudo-session`. Backend chưa có → blocked, không thay mock pass. Evidence L07 + W06-T02 cross-link, commit theo repo.

## 11. L08 — Nav2/Gazebo và cùng world revision

**Files source:** W06-T03/T04 agent/navigation/description/simulation; bổ sung `robotics/simulation/tools/compile_lab_world.py`, `robotics/simulation/tests/test_lab_world.py`. **Files lab:** mode/readiness/pose renderer, fixtures Gazebo scenario, `tests/integration/gazebo-session.test.ts`.

**Consumes:** `Nav2Navigation` qua `NativeNavigation` port W06; World và profile schema. **Produces:** SDF/occupancy/YAML + hashes, backend `gazebo-jazzy`, launch nhận paths/namespace/use_sim_time bằng allowlist CLI; report raw action results/logs.

- [ ] Pin image/distro/deps sau smoke build. Ubuntu Linux runner; Mac dùng VM/host Linux. Không ghi PASS từ `FakeActionClient` thay Gazebo.
- [ ] Test contract và compiler trước full run:

```python
def test_aborted_goal_is_not_delivery(nav2_rig):
    nav2_rig.abort_active_goal()
    assert nav2_rig.completed_events() == []

def test_world_compiler_preserves_dimensions(world_fixture):
    out = compile_lab_world(world_fixture)
    assert out.world_hash == world_fixture.content_hash
    assert out.wall_bounds_m == world_fixture.wall_bounds_m
```

`nav2_rig` fixture dùng source agent/action path, có phiên bản fake cho unit và Gazebo riêng cho integration; report không trộn chúng. `compile_lab_world(world)` do tool source tạo, trả bundle metadata + parsed geometry để test cross-check.

- [ ] Implement compiler và launch wiring với map/odom/base frames, sensor poses, wheel params. Pose renderer chỉ đọc. Namespace robot + TF frames và `/clock` wiring; cùng kịch bản business actors chạy qua domain. Model param thiếu mass/inertia hợp lệ → fail readiness, không auto bịa số cho hardware.
- [ ] Chạy S01/S03/S04/S09/S11 mỗi ca ≥10 lượt, log collision contacts/result status; thêm sensor latency/noise bounded và payload assumptions. S13 chỉ bật khi W06-T01 traffic reservations có; không dùng Nav2 local avoidance để tuyên bố fleet coordination.
- [ ] `python3 -m pytest robotics/agent/tests robotics/simulation/tests -q`, `colcon build`, `colcon test`, `colcon test-result --verbose` trong workspace robotics do W06 tạo; chạy launch/integration actual Gazebo scenarios riêng. Ghi real-time factor/CPU/image/seed/model hash. Lab test consume report + raw evidence, không chỉ badge. Evidence L08/G2, commit theo repo.

## 12. L09 — Deployment bundle và source dry-run

**Files lab:** `src/deployment/*`, `tests/unit/deployment-bundle.test.ts`, `tests/e2e/deployment-review.spec.ts`. **Files source:** `scripts/import-lab-configuration.mjs`, `tests/integration/lab-configuration-import.test.ts` và configuration domain module nếu thiếu primitive do W06-T01 sở hữu.

**Consumes:** Lab deployment schema; evidence của L06–L08; source admission/map schema. **Produces:** `buildBundle(project,reports):DeploymentBundle`; `validateBundle(bundle,profile):ValidationReport`; importer CLI dry-run mặc định, apply staging qua source domain với explicit target config.

- [ ] Test chứa missions/credentials hoặc validation giả bị reject; checksum mismatch không mutate. Test evidence mode không đủ vẫn export draft nhưng readiness không xanh.
- [ ] Core rule trước promotion:

```ts
const importable = new Set(['design','profileCandidate','venueLayout','world','bindingDrafts','evidenceRefs']);
const rejected = Object.keys(bundle.payload).filter(key => !importable.has(key));
if (rejected.length) throw new Error('UNSUPPORTED_DEPLOYMENT_FIELDS');
// Importer không dùng validation từ candidate để set profile validation ở source.
```

- [ ] Build bundle theo file list integration spec; validate signature/trust của evidence qua source policy, hashes chỉ integrity. Preview diff; scope mapping mới không mang live IDs/grants từ simulator. Apply chỉ khi toàn bộ validation thành công; cùng import ID + hash idempotent, payload đổi → conflict.
- [ ] Test two imports không hai robot, stale map cần teach lại, runtime compatibility fail, rollback draft không replay effect. Expected `robot.execute/payment/print effect count = 0` sau dry-run và history import.
- [ ] `cd source && pnpm test:integration -- tests/integration/lab-configuration-import.test.ts`; Lab `pnpm test:unit -- deployment-bundle && pnpm test:e2e -- deployment-review`. Evidence L09, commit `feat: review and import lab configuration candidates`.

## 13. L10 — Shadow và tablet/native integration

**Files lab:** `docs/operations/shadow-and-hardware-test.md`, hardware report templates, mode labels/readiness view. **Files source:** W06 native tests/provisioning/runbook, `tests/e2e/pilot-service.spec.ts` theo W06-T06.

**Consumes:** Provisioned source coordinator/executor và G2 report. **Produces:** telemetry-only shadow session, native test evidence có device/firmware/source/config tuple; không thêm hardware mutation route vào Lab gateway.

- [ ] Test request `restaurantCommand`, `injectFault`, `step` đến shadow/hardware Lab session trả `MODE_ACTION_UNSUPPORTED` và native start count 0. Test telemetry auth/sequence/clock skew.
- [ ] Quan sát map/position/capabilities, so binding draft với waypoint đo; mất telemetry hiển thị stale, không extrapolate arrival. Source UI giữ quyền vận hành.
- [ ] Trên thiết bị test đã provision, chạy cùng journey qua APK/source UI; capture native journal, goal/effect counts, load/handoff records và report Lab. UI suspend, WAN/LAN mất, source restore/reboot theo W01/W04/W06 tests; không bật nguồn robot ở vùng chưa bố trí.
- [ ] Ghi thiếu tablet/robot/firmware/physical stop path là blocked_external. Hai emulator chỉ đạt native software level. Bảo đảm trial không cùng điều khiển; shadow không yêu cầu takeover.
- [ ] Chạy instrumentation và E2E source tương ứng với thiết bị được chọn; reviewer đối chiếu raw receipts/video nếu có. Evidence L10, commit `test: trace source native execution in robot lab`.

## 14. L11 — Commissioning và pilot acceptance

**Files source:** W06-T05 `docs/operations/{robot-commissioning,safety-handoff}.md`, hardware profiles/tests; W06-T06 Gate B. **Files lab:** `docs/implementation/gates/{G3-hardware,G4-venue}.md`, evidence index/reports, `docs/operations/configuration-rollback.md`.

**Consumes:** Hardware model/firmware/supplier documents, measured geometry/load, independent stop, venue map, Gate A/source. **Produces:** evidence profile `hardware_validated` rồi `venue_approved` khi source policy chấp nhận; bundle candidate liên kết evidence, không tự deploy production.

- [ ] Ghi cụ thể robot serial/model/firmware, bàn/khay/tải, wheel/footprint/sensor geometry, map revision, source SHA, test operator, khu vực thử, nguồn dừng vật lý. Cấu hình illustrative còn trong trường bắt buộc → gate blocked.
- [ ] Kiểm nguồn/encoder/scan/TF/watchdog và motor direction bằng quy trình vendor đã review. Chọn giới hạn vận hành từ kết quả đo, không dùng số calculator như số đã nghiệm thu.
- [ ] Chạy dừng/cancel/reboot/network tests, bàn bị chắn, người đi qua có giám sát, trả hàng khi cancel. Ghi độ trễ/khoảng dừng/pose tolerance thực, failure và can thiệp. Ít nhất 20 chu trình tại profile giới hạn theo spec, không tự suy chứng nhận từ sample pass.
- [ ] Phân biệt test Valetudo vacuum workflow với chassis payload nhà hàng. Kết quả một model không được dùng nâng validation model khác. Dock chưa chứng minh sạc thì chỉ đạt parking.
- [ ] Gate G4 gồm Gate A + B của source, staff handoff và rollback; cấu hình rollback không restore grant/journal cũ. Actual trial cutover/release tiếp tục theo W11, cần review deployment result tại thời điểm đó.
- [ ] Chạy hardware suite W06 trên đúng target được cấu hình; lưu raw measurements và người ký acceptance. Không có target thì kết thúc task phần hồ sơ ở blocked_external, giữ milestone hardware chưa đạt. Commit hồ sơ không chứa secrets/raw customer data.

## 15. Sau pilot: pha chế và nấu ăn

Đây là roadmap, chưa phải implementation task được phép chạy lệnh cơ cấu:

| Mốc | Spec phải có trước khi code | Acceptance thử nghiệm đầu |
|---|---|---|
| Beverage B0 | Cell cố định, một recipe, cup/ingredient IDs, command journal riêng, measurement/cleaning/allergen requirements, interlocks | Cup absent không dispense; ACK mất không tự lặp; measurement xác nhận lượng; pickup nối delivery allocation |
| Beverage B1 | Driver thiết bị thật, recovery, calibration, recipe permissions | Bench test và quy trình vệ sinh có evidence; robot delivery nhận đúng cốc |
| Cooking C0 | Một công đoạn, temp/time process, sensor failure, safe power state, batch trace | Mô phỏng mất sensor/over-temp/power restore không tự gia nhiệt |
| Cooking C1 | Thiết bị/cell thật, quy trình thao tác và nghiệm thu chuyên biệt | Tách test công đoạn, chất lượng món, vệ sinh và cơ điện; không reuse navigation badge |

UI có thể hiển thị hướng nghiên cứu từ R0; không đưa bơm/cánh tay/gia nhiệt vào RobotCommand navigation v1. Khi bắt đầu B0/C0 viết spec/plan riêng, dùng lại catalog/world/report primitives nếu phù hợp.

## 16. Ma trận traceability và hoàn thành

| Yêu cầu spec | Task | Bằng chứng |
|---|---|---|
| Màu/style/3 ngôn ngữ, business HTML | L01/L05 | Token diff, screenshot, locale/keyboard/fallback tests |
| Build/BOM/performance/wiring | L02/L05 | Numeric fixtures, missing data/provenance, component selection |
| Restaurant world/scenario | L03/L04/L06 | Roundtrip coordinates, journey events, faults/seeds |
| Dùng source, không fork nghiệp vụ | L00/L03/L06 | Source commit/schema/artifact hashes, actual domain receipts |
| Valetudo/Android | L07/L10 | Protocol conformance, native journal/crash evidence |
| ROS/Nav2/Gazebo | L08 | Launch/physics/action result + raw logs |
| Sim-to-real/export/import/rollback | L09/L10/L11 | Dry-run diff, scoped staging import, commissioning |
| Replay/ownership/no effects | L03/L06/L09 | Mutation rejects, no double send, event-only replay |
| Pha chế/nấu ăn | Roadmap §15 | Scope + entry gates, chưa có implementation claims |

Mỗi evidence file ghi: task, commit từng repo, commands đã chạy, môi trường, expected/actual, raw artifact refs/hashes, limitations và gate status. Không đánh checkbox chỉ vì file đã tồn tại. Review diff và chạy test phù hợp trước commit; task source cập nhật ledger W06 của task tương ứng khi owner xác nhận, Lab không tự đánh W06 done.

**Handoff:** Bắt đầu L00 và vertical slice M1 sau khi review bộ spec này. Các dependency phần cứng không chặn M1/M2. Tài liệu hiện tại là đầu ra của yêu cầu lập spec/plan; chưa có application build, simulation run hoặc hardware acceptance từ đợt này.
