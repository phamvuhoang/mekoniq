# Gói 01 — R1.1 Webots Arm: X00–X08

Đọc [README](README.md) và [spec](../../specs/2026-11-10-webots-arm-design.md) trước. Lệnh chạy từ `source/` với `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`; pytest luôn `PYTHONDONTWRITEBYTECODE=1`; lệnh dài bọc `perl -e 'alarm N; exec @ARGV'`. Test cần engine thật nằm ở `tests/integration/webots-arm-*.test.ts` và tự `skip` thành `not_run` khi provider không `installed` (theo mẫu `tests/integration/webots-worker.test.ts`).

---

### Task X00: Spike — tay máy đứng và bám trong Webots

**Files:**
- Create: `docs/research/2026-11-webots-arm-spike.md`
- Scratch (không commit): world viết tay + script điều khiển, ngoài cây git

**Interfaces:**
- Consumes: `PUMA560_SI`, `forwardKinematics` (`packages/lab-runtime/src/v2/models/arm-kinematics.ts`); waypoint `W`, `ARM_CHOREOGRAPHY`, `MOCK_ARM_PARAMS` (`packages/cell-adapters/src/mock-arm.ts`); `.venv-webots`, Webots R2025a.
- Produces: bảng tham số trong ghi chép: `reachTolRad`, `settleTicks`, `followTolRad`, `followTicks`, `repeatJointRad`, `massKg[6]`, `effortNm[6]`. X01–X06 đọc các số này.

- [ ] **Step 1:** Viết tay một `.wbt`: sàn, `Robot` 6 `HingeJoint` nối tiếp theo `PUMA560_SI.links` (modified DH), mỗi khớp `RotationalMotor{maxVelocity, maxTorque}` + `PositionSensor`, link là `Cylinder` bán kính 0,025 m, `Physics` với khối lượng giả định khởi đầu `[8,6,4,1.5,1,0.5]` kg, `basicTimeStep 20`, controller `<extern>`.
- [ ] **Step 2:** Script extern controller: mỗi bước đặt `setPosition(commanded[i])` theo đúng nội suy của `MockArmPlant.advance()` (bước tối đa `maxVelocity*0.1*0.02`), ghi `(tick, commanded, actual)`.
- [ ] **Step 3:** Đo sáu tiêu chí của spec §6.1. Chỉ được chỉnh `effortNm` và khối lượng (đều `assumed`), không chỉnh tiêu chí.
- [ ] **Step 4:** Ghi `docs/research/2026-11-webots-arm-spike.md`: số đo từng tiêu chí, tham số chọn, world và script đính kèm dạng khối code. Kết luận một dòng: ĐẠT hoặc TRƯỢT (tiêu chí nào).
- [ ] **Step 5:** TRƯỢT → dừng, báo người dùng. ĐẠT → `git add docs/research/2026-11-webots-arm-spike.md && git commit -m "docs: webots arm spike measurements"`.

---

### Task X01: Contract, catalog và golden

**Files:**
- Modify: `packages/contracts/schemas/sim3d-worker-v1.schema.json`
- Create: `packages/contracts/schemas/arm-scene-3d-v1.schema.json`
- Modify: `packages/lab-runtime/src/v2/capabilities.ts`, `packages/lab-runtime/src/v2/navigation2d/contracts.ts` (validator), `robotics/algorithm/oracle-profile.json` (hoặc file oracle profile hiện dùng bởi `loadOracleProfile`)
- Test: `tests/contracts/sim3d-arm-schema.test.ts`, `tests/unit/bv01-mock-golden.test.ts`, `tests/unit/capabilities-webots-arm.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // step.payload (cộng thêm, tùy chọn)
  jointTargets?: {armId:string; positionsRad:number[] /* 1..8, finite */}[]  // tối đa 1
  // create.payload (cộng thêm)
  arms?: {armId:string; sceneRef:'arm-scene.json'}[]                          // tối đa 1
  // Sim3DSnapshotV1 (cộng thêm)
  arms?: {armId:string; positionsRad:number[]; velocitiesRadS:number[]; collisionIds:string[]}[]
  interface ArmScene3DV1 {schemaVersion:1; sceneDigest:string; arm:{armId:string; modelId:'arm-ref-3d-v1'; modelRevision:string; baseInMap:{position:[number,number,number]; quaternionXyzw:[number,number,number,number]}; homeRad:number[]};
    statics:ArmObstacle[]; world3d:{floorFriction:number; provenance:'assumed'}; engine:{id:'webots_3d'; basicTimeStepMs:20}; engineSeed:number /* 0..2^31-1 */}
  export const WEBOTS_ARM={id:'webots_arm',version:'R2025a'} // capabilities.ts
  // set 'engineering-webots-arm-v1': {mode:'simulation',access:'simulated',backends:['mock_amr','webots_arm','mock_coffee'],providers:{amr:'mock_amr',arm:'webots_arm',coffee:'mock_coffee'},scenarioIds:['WB-BV01'],execution:<giống engineering-webots-3d-v1>}
  // oracle profile: webotsArm:{reachTolRad,settleTicks,followTolRad,followTicks,repeatJointRad} = số của X00
  ```

- [ ] **Step 1: Golden trước khi sửa gì.** `tests/unit/bv01-mock-golden.test.ts`: chạy BV01 trên `mock-default` tới kết thúc (theo cách `tests/integration/lab-v2-bv01-sil.test.ts` dựng run), `expect(outcomeDigest(report)).toBe('<hash ghi lần đầu>')` và `expect(armTraceSha).toBe('<hash>')`. Chạy, chép hash vào test, chạy lại xanh, commit riêng `test: pin the mock BV01 outcome before the arm plant split`.
- [ ] **Step 2: Test schema fail trước.** `sim3d-arm-schema.test.ts`: (a) mọi request/response mẫu AMR trong `tests/contracts/` của sim3d vẫn hợp lệ; (b) `step` với `jointTargets:[{armId:'arm-1',positionsRad:[0,0,0,0,0,0]}]` hợp lệ; (c) 9 phần tử, `NaN`, hai tay máy, thiếu `armId` → không hợp lệ; (d) `ArmScene3DV1` với `engineSeed:2**31` không hợp lệ.
- [ ] **Step 3:** Sửa schema theo Interfaces; `pnpm contracts:generate`; `pnpm contracts:check`.
- [ ] **Step 4: Catalog.** `capabilities-webots-arm.test.ts`: catalog mặc định có `webots_arm` với `installed:false`, `reason` bắt đầu `WEBOTS_UNCONFIGURED`; set `engineering-webots-arm-v1` chỉ nhận `WB-BV01`; `resolveBackends('BV01','simulation','engineering-webots-arm-v1')` bị từ chối. Thêm backend và set.
- [ ] **Step 5:** `pnpm test:unit -- tests/unit/bv01-mock-golden.test.ts tests/unit/capabilities-webots-arm.test.ts && pnpm test:contracts && pnpm typecheck && pnpm lint`. Commit `feat: sim3d arm contract, arm scene schema and the webots_arm backend set`. Lab re-pin.

---

### Task X02: Fixture `arm-ref-3d-v1` và parity tĩnh

**Files:**
- Create: `scripts/generate-arm-fixture.mjs`, `robotics/simulation-3d/fixtures/arm-ref-3d-v1/component.json` (+ catalog entry theo layout của `fixtures/serve-3d-v1/`), `robotics/simulation-3d/fixtures/arm-ref-3d-v1/README.md`
- Test: `tests/unit/arm-fixture.test.ts`

**Interfaces:**
- Consumes: `PUMA560_REFERENCE`, `toSI`, `forwardKinematics`; `DEFAULT_ARM_GEOMETRY`; số `massKg`, `effortNm` của X00; schema `engineering-component`.
- Produces: component có 7 link (`base`, `link1..link6`) và 6 khớp `revolute` tên `J1..J6` (`jointNameForLinuxcnc`), mỗi khớp `origin` (xyz + rpy) suy từ dòng modified-DH, `axis:[0,0,1]`, `limits{lower,upper,velocity,effort}`; `export function chainFk(component, q:number[]): {flange:[number,number,number]}` trong script (FK thuần từ origin/axis của fixture).

- [ ] **Step 1: Test fail trước.** `arm-fixture.test.ts`:
  - chạy generator vào thư mục tạm, so byte với file đã commit;
  - component hợp lệ với schema `engineering-component`;
  - với mọi pose trong `tests/**/arm-fk-golden.json`: `|chainFk(component,q).flange − forwardKinematics(PUMA560_SI,q).flange| ≤ 1e-9`;
  - `limits.lower/upper/velocity` bằng `PUMA560_SI.limits`; mọi `massKg>0`, `inertiaKgM2` đủ 6 số, `provenance` chứa `assumed`.
- [ ] **Step 2:** Viết generator: modified DH `(alpha_{i-1}, a_{i-1}, d_i)` → origin khớp `xyz=[a, −sin(alpha)·d, cos(alpha)·d]`, `rpy=[alpha,0,0]`, `thetaOffset` cộng vào góc không; link là trụ nối hai gốc khớp liên tiếp (dài 0 → cầu bán kính `linkRadiusM`); quán tính trụ/cầu đặc từ khối lượng. Số được làm tròn 12 chữ số và ghi JSON khóa sắp xếp.
- [ ] **Step 3:** README fixture: nguồn hình học, mọi tham số `assumed`, câu "không phải dữ liệu PUMA và không phải tay máy sản phẩm".
- [ ] **Step 4:** `pnpm test:unit -- tests/unit/arm-fixture.test.ts` xanh. Commit `feat: arm-ref-3d-v1 fixture generated from the Lab reference table`. Lab re-pin.

---

### Task X03: Compiler world tay máy

**Files:**
- Modify: `robotics/simulation-3d/webots_worker/compile.py`
- Test: `robotics/simulation-3d/tests/test_compile_arm.py`

**Interfaces:**
- Consumes: `ArmScene3DV1`, component `arm-ref-3d-v1`; các helper sẵn có trong `compile.py` (`Physics`, hình khối, `WorldInfo`, supervisor).
- Produces: `def compile_arm_world(scene: dict, model: dict) -> str`; lỗi `CompileError(code)` với `JOINT_UNSUPPORTED`, `ARM_TOO_MANY_JOINTS`, `MASS_INVALID`, `INERTIA_MISSING`, `MESH_UNSUPPORTED`, `ARM_HOME_OUT_OF_RANGE`. Tên thiết bị: `J<i>_motor`, `J<i>_sensor`. Tên DEF: `ARM_<armId đã chuẩn hóa>`, `STATIC_<n>` (không dùng id thô làm DEF).

- [ ] **Step 1: Test fail trước** (pytest thuần, không engine):
  - `test_arm_world_has_six_hinges`: 6 `HingeJoint`, 6 `RotationalMotor` với `maxVelocity`/`maxTorque` bằng `limits.velocity`/`limits.effort`, `minPosition`/`maxPosition` bằng `lower`/`upper`, 6 `PositionSensor`, một `Robot` controller `<extern>`, một supervisor, `basicTimeStep 20`, `randomSeed` bằng `engineSeed`.
  - `test_arm_world_chain_matches_fixture`: phân tích lại `anchor`/`axis`/`translation`/`rotation` từ văn bản world, tính FK tại 5 pose, lệch ≤ 1e-9 so với giá trị golden do X02 xuất (`fixtures/arm-ref-3d-v1/fk-golden.json`, thêm ở task này bằng generator).
  - `test_arm_world_is_deterministic`: hai lần biên dịch cùng đầu vào cho cùng byte.
  - `test_arm_rejects`: mỗi mã lỗi ở Interfaces có một đầu vào; khớp `prismatic` và `continuous` trong tay máy → `JOINT_UNSUPPORTED`; 9 khớp → `ARM_TOO_MANY_JOINTS`.
  - `test_amr_world_unchanged`: world của `serve-3d-v1` cùng sha256 như trước task (ghi hash trước khi sửa).
  - `test_statics_use_safe_def_names`: vật cản id `"3.table"` cho DEF hợp lệ.
- [ ] **Step 2:** Viết `compile_arm_world`; `_check_model` của AMR không đổi. Khớp ở `homeRad` qua `HingeJointParameters.position`.
- [ ] **Step 3:** `PYTHONDONTWRITEBYTECODE=1 .venv-webots/bin/python -m pytest robotics/simulation-3d/tests/test_compile_arm.py -q` xanh; toàn bộ `robotics/simulation-3d/tests` xanh. Commit `feat: webots arm world compiler`. Lab re-pin.

---

### Task X04: Worker — khớp, snapshot, D31

**Files:**
- Create: `robotics/simulation-3d/webots_worker/arm_controller.py`
- Modify: `robotics/simulation-3d/webots_worker/{session,engine,supervisor,snapshot}.py`
- Test: `robotics/simulation-3d/tests/test_session_arm.py`, `tests/integration/webots-arm-worker.test.ts`

**Interfaces:**
- Consumes: `compile_arm_world`; protocol của X01; `engine_factory` seam của `WorkerSession` (test double).
- Produces: `create` với `arms` dựng world tay máy (không cần `navigation-scene.json`); `step` nhận `jointTargets`; snapshot có `arms[0]`; `readback` thêm `arm:{links:[{name,massKg}],joints:[{name,axis,lower,upper}]}`. Mã lỗi mới: `JOINT_TARGET_OUT_OF_RANGE`, `JOINT_TARGET_SHAPE` (không fatal, tick không tăng), `PLANT_UNSTABLE` (fatal) khi góc/vận tốc khớp không hữu hạn hoặc vượt giới hạn quá 0,05 rad.

- [ ] **Step 1: pytest với engine double fail trước:**
  - `step` có `jointTargets` đúng → double nhận đúng 6 vị trí, tick +1, snapshot `arms[0].positionsRad` là giá trị double trả;
  - target vượt `upper` 1e-6 → `JOINT_TARGET_OUT_OF_RANGE`, tick không đổi, double không được gọi;
  - 5 phần tử → `JOINT_TARGET_SHAPE`;
  - gửi lại cùng `requestId` → cùng response, double gọi một lần;
  - double trả `nan` → `PLANT_UNSTABLE`, session `failed`;
  - `step` với `velocities` trên session tay máy, và `jointTargets` trên session AMR → `INVALID_REQUEST`;
  - D31: `engine_seed(2**32-1)` nằm trong `[0, 2**31-1]` và tất định; thư mục tạm dò được là thư mục engine thực tạo khi `USER` không đặt.
- [ ] **Step 2:** Viết `arm_controller.py` (extern controller: nhận `{"targets":[…]}`, `setPosition`, trả `positions`, `velocities` từ `PositionSensor`), nhánh tay máy trong `session.py`/`engine.py`; supervisor báo contact point của các `Solid` tay máy (bỏ cặp link kề nhau). Sửa D31.
- [ ] **Step 3: Engine thật.** `webots-arm-worker.test.ts`: spawn worker, `create` scene tay máy, 50 bước giữ `home` → mọi `|actual−home| ≤ reachTolRad`; readback khối lượng và giới hạn khớp bằng fixture (WA02); engine time = `(tick+1)×20 ms` (WA03); sau `close` không còn tiến trình Webots/controller, không `__pycache__` dưới tool root.
- [ ] **Step 4:** pytest toàn bộ `robotics/simulation-3d/tests` + `perl -e 'alarm 600; exec @ARGV' pnpm test:integration -- tests/integration/webots-arm-worker.test.ts tests/integration/webots-worker.test.ts` xanh. Commit `feat: webots worker steps an arm by joint targets; engine seed range and tmp dir`. Lab re-pin.

---

### Task X05: `tracking` trong `MockArmPlant`, `webotsArmPorts`, dispatcher, readiness

**Files:**
- Modify: `packages/cell-adapters/src/mock-arm.ts`
- Create: `packages/lab-runtime/src/v2/simulation3d/arm-ports.ts`, `packages/lab-runtime/src/v2/simulation3d/arm-scene.ts`
- Modify: `packages/lab-runtime/src/v2/navigation2d/readiness.ts` (`plantDispatcher`), `packages/lab-runtime/src/v2/simulation3d/readiness.ts`
- Test: `tests/unit/mock-arm-tracking.test.ts`, `tests/unit/webots-arm-ports.test.ts`, `tests/integration/webots-arm-programs.test.ts`

**Interfaces:**
- Consumes: `CoffeePlantPorts`, `createMockCoffeePorts` (`beverage/coffee-ports.ts`); `RunProviders.coffeePorts`; `spawnSim3DWorker`; `providerReadiness`; `activeRunCount`; `declareArmScene`; oracle profile `webotsArm`.
- Produces:
  ```ts
  // mock-arm.ts
  export interface ArmTracking {reachTolRad:number;settleTicks:number;followTolRad:number;followTicks:number}
  // MockArmPlant constructor nhận thêm tham số tùy chọn `tracking?:ArmTracking`
  observe(actualQ:readonly number[], collisionIds:readonly string[]):void   // chỉ khi tracking; ném nếu gọi ở chế độ mặc định
  // arm-scene.ts
  export function buildArmScene3D(project:LabProjectV2, fixture:{id:string;revision:string}, seed:number):ArmScene3DV1  // ném ARM_SCENE_UNAVAILABLE | ARM_MODEL_MISMATCH
  // arm-ports.ts
  export function webotsArmPorts(runtime:WebotsRuntimeOptions):NonNullable<RunProviders['coffeePorts']>
  // readiness.ts: PlantTable giữ nguyên; thêm bảng
  export type ArmPlantTable=Readonly<Record<string,{coffeePorts:NonNullable<RunProviders['coffeePorts']>}>>
  export function plantDispatcher(catalog, plants, nativeFactory?, arms?:ArmPlantTable):SimulationFactory
  ```
  Chế độ `tracking`: `advance()` tính `commandedQ` như cũ nhưng **không** gán `s.q`; `observe()` gán `s.q=actualQ`, chạy `checkArmSweep(prevQ→actualQ)`, kiểm giới hạn, đếm tick lệch `>followTolRad` (đủ `followTicks` → `stop('ARM_FOLLOWING_ERROR')`), `collisionIds.length>0` → `stop('ARM_COLLISION')`, và coi waypoint đạt khi `≤reachTolRad` đủ `settleTicks`. Grip/release, `receiver`, `evidence`, `emit` dùng lại nguyên code hiện có.

- [ ] **Step 1: Unit fail trước** (`mock-arm-tracking.test.ts`), plant giả là hàm thuần:
  - plant lý tưởng (`actual=commanded`): `cup-pick` rồi `cup-place` `completed`, `TransferEvidence` bằng của chế độ mặc định;
  - plant trễ một tick và lệch 0,5×`reachTolRad`: vẫn `completed`;
  - plant đứng yên: `ARM_FOLLOWING_ERROR` sau đúng `followTicks` tick lệch, `holding` không đổi;
  - `collisionIds:['STATIC_1']` khi đang giữ cốc: `ARM_COLLISION`, `holding` vẫn là cốc đó, `gripper:'closed'`;
  - `actualQ` chứa `NaN`: dừng, mẫu không vào `collision.intervals`;
  - không `tracking`: `observe` ném; golden BV01 của X01 vẫn xanh.
- [ ] **Step 2:** Sửa `mock-arm.ts` (đường mặc định không đổi một dòng hành vi).
- [ ] **Step 3: Unit ports** (`webots-arm-ports.test.ts`) với worker double (`entry`): mỗi `advance()` gửi đúng một `step` có `jointTargets=commandedQ` và `expectedTick` tăng 1; `WorkerLostError` → chương trình đang chạy thành `unknown` (`OUTCOME_UNKNOWN`), không spawn lại; `close()` đóng worker; `buildArmScene3D` ném `ARM_SCENE_UNAVAILABLE` khi project thiếu `armCollisionProfile`, `ARM_MODEL_MISMATCH` khi `modelId` khác.
- [ ] **Step 4:** Viết `arm-scene.ts`, `arm-ports.ts` (ghép `MockCoffeePlant` + `MockArmPlant` tracking + worker; `snapshot/report/transferEvidence` ủy quyền như `createMockCoffeePorts`; report thêm `armPlant` theo D24 và sai số bám đỉnh/RMS từng khớp), nhánh `arms` trong `plantDispatcher`, readiness của set (smoke `create` trên scene tay máy; slot đếm chung `webots_3d` + `webots_arm`; đang có run Webots → `WEBOTS_CAPACITY`).
- [ ] **Step 5: Engine thật** (`webots-arm-programs.test.ts`, WA04): `cup-pick` + `cup-place` `completed`; sai số bám đỉnh mỗi khớp ≤ `followTolRad`; ARM03 `pass` trên trace thực.
- [ ] **Step 6:** `pnpm test:unit && pnpm typecheck && pnpm lint` + integration trên xanh. Commit `feat: webots arm ports on the mock arm program state machine`. Lab re-pin.

---

### Task X06: `WB-BV01`, lỗi, lặp lại, evidence

**Files:**
- Modify: `packages/lab-runtime/src/v2/scenario-registry.ts`, `scenario-matrix.ts`, `packages/lab-runtime/src/v2/report.ts` (khối arm)
- Test: `tests/integration/webots-arm-bv01.test.ts`, `tests/integration/webots-arm-faults.test.ts`

**Interfaces:**
- Consumes: `webotsArmPorts`, set `engineering-webots-arm-v1`, định nghĩa BV01 (`scenario-registry.ts:56`).
- Produces: scenario `WB-BV01` (cùng script, roles, `maxTicks` như BV01; chỉ nhận set Webots arm); report `navigation2d` không có, thay bằng `arm:{trace:{path,sha256,samples},tracking:{peakRad:number[],rmsRad:number[]},armPlant,collision:ArmCollisionEvidenceRecord}`.

- [ ] **Step 1: Test fail trước.**
  - `webots-arm-bv01.test.ts` (WA05, WA07, WA08): chạy `WB-BV01` hai lần cùng seed qua gateway với flag bật. Mỗi lần: `outcome.status==='completed'`, `served===2`, không attention, cốc ở `table:…`, ARM03 `pass`, `armPlant.dynamics==='assumed'`, report có `not_calibrated`. Hai lần: cùng `outcome.tick`; trace khớp lệch tối đa ≤ `repeatJointRad`. File trace đọc lại được và sha khớp.
  - `webots-arm-faults.test.ts` (WA06), mỗi cái một run:
    - vật cản tĩnh chèn trên đường `cup-place` → `ARM_COLLISION`, cốc vẫn `holding`, run `needs_attention`;
    - fixture biến thể `effort` J2 hạ còn 10 % → `ARM_FOLLOWING_ERROR` trong `followTicks`+settle, không tới `maxTicks`;
    - SIGKILL worker giữa `cup-pick` → outcome `unknown`, không tiến trình sót;
    - SIGKILL engine giữa `cup-place` → như trên;
    - cancel khi đang giữ cốc → không thả, cần reconcile;
    - `BV01` trên set Webots arm và `WB-BV01` trên `mock-default` → từ chối ở admission.
- [ ] **Step 2:** Thêm scenario, ma trận, khối report.
- [ ] **Step 3:** `perl -e 'alarm 1500; exec @ARGV' pnpm test:integration -- tests/integration/webots-arm-bv01.test.ts tests/integration/webots-arm-faults.test.ts` xanh; `pnpm test:unit` xanh; sau khi chạy: `pgrep -f MacOS/webots` rỗng. Commit `feat: WB-BV01 on the webots arm with fault and repeat evidence`. Lab re-pin.

---

### Task X07: Lab

**Files (repo `lab/`):**
- Modify: `src/scenarios/catalog.ts`, `src/scenarios/support.ts`, `src/viewer/twin3d.ts`, `src/twin/arm/arm-view.ts`, `src/twin/arm/arm-telemetry.ts`, `src/ui/operations-panel.ts`, `src/ui/report-panel.ts`, `scripts/start-irsim.mjs` (launcher `lab:webots`), `scripts/sync-engineering-contracts.mjs` nếu cần xuất bảng DH
- Test: `tests/unit/arm-chain.test.ts`, `tests/e2e/webots-coffee.spec.ts`

**Interfaces:**
- Consumes: health/catalog của runtime đã pin; telemetry tay máy hiện có (hàng q1..q6); `forwardKinematics` qua contract đã sync (nếu Lab chưa có FK thì sync bảng `links` và viết `armFrames(links,q)` ≤ 20 dòng trong `src/twin/arm/`).
- Produces: preset `webots-coffee` (`WB-BV01` trên `engineering-webots-arm-v1`); capability `sim3d_arm_v1` trong `PORTABLE_CAPABILITY`; `export function armChain(frames:Mat4[]):THREE.Group` (6 trụ + khớp cầu) thay hình trụ đơn khi có telemetry khớp.

- [ ] **Step 1: Unit fail trước.** `arm-chain.test.ts`: `armChain` ở `home` đặt đầu link 6 trùng `flange` của FK (≤ 1e-6); không có telemetry khớp → vẫn vẽ hình trụ cũ. Preset bị chặn với `CAPABILITY_MISSING:sim3d_arm_v1` khi health không có capability.
- [ ] **Step 2:** Preset, nhãn (`thực (Webots)` / `lệnh`; mock giữ `no encoder (mock)`), khối `armPlant` + `not_calibrated` trong report panel, `armChain`.
- [ ] **Step 3: e2e** `webots-coffee.spec.ts` (một spec mỗi launcher, theo `test-irsim-e2e.mjs`): mở preset, chạy tới `completed`, hàng khớp hiện hai cột, report hiện `not_calibrated`, chụp `screens/webots-coffee.png`. Spec mặc định bị Playwright bỏ qua như `webots-*.spec.ts` khác.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run` + e2e trên + `pnpm test:mock-e2e` xanh. Commit `feat: webots coffee preset and an articulated arm in the 3D twin`.

---

### Task X08: Qualification, ghi lại R1, bản ghi R1.1

**Files:**
- Modify: `scripts/sim-extension-qualification.mjs` (bảng `r1.1`: SUITES/CASES/GATES theo spec §6.3), `scripts/record-sim-extension.mjs` (`--release r1.1`, `--r1-record DIR`), `scripts/export-lab-runtime.mjs`, `tests/acceptance/sim-extension.acceptance.test.ts`, `CLAUDE.md` (đường dẫn bản ghi mới nhất), `robotics/simulation-3d/README.md`
- Test: `tests/unit/sim-extension-qualification.test.ts`
- Evidence: `docs/implementation/evidence/linkforge-irsim/candidate-<n+1>/`, `docs/implementation/evidence/sim-extension/r1-candidate-<n+1>/`, `docs/implementation/evidence/sim-extension/r11-candidate-01/`; Lab: regression mới

**Interfaces:**
- Consumes: `qualify(input, table)`, `checkQualification`, recorder R1.
- Produces: bảng `r1.1`; REG02 `tested` chỉ khi bản ghi IR-SIM, R-MOCK và R1 đều của **cùng commit** với bản ghi R1.1 và mọi gate của chúng `tested`; bản ghi R1.1 mang `r1-record.json` (bản sao, kiểm sha).

- [ ] **Step 1: Unit fail trước:** bảng `r1.1` ánh xạ đúng case → gate; REG02 `not_run` khi bản ghi R1 khác commit, `failed` khi bản ghi R1 có gate không `tested`; guard từ chối `accepted:true`; suite thiếu file kết quả → `SUITE_RESULT_MISSING`.
- [ ] **Step 2:** Viết bảng, recorder, guard. `pnpm test:unit -- tests/unit/sim-extension-qualification.test.ts` xanh. Commit, Lab re-pin, cả hai cây sạch.
- [ ] **Step 3: Ghi ngoài cây, theo thứ tự** (mỗi lệnh phải exit 0 mới chạy lệnh sau; `S` là thư mục ngoài cả hai repo):
  ```sh
  (cd ../lab && node scripts/record-regression.mjs --suite physical-robot-lab --out $S/regression)
  node scripts/record-irsim.mjs --out $S/candidate-N --candidate-id candidate-N
  node scripts/record-sim-extension.mjs --release r1 --out $S/r1-candidate-N --candidate-id r1-candidate-N --irsim-record $S/candidate-N --mock-regression $S/regression
  node scripts/record-sim-extension.mjs --release r1.1 --out $S/r11-candidate-01 --candidate-id r11-candidate-01 --r1-record $S/r1-candidate-N --mock-regression $S/regression
  ```
  Khoảng 3 giờ máy; Webots chiếm màn hình. Bản ghi exit 1/2 không sửa tay: sửa nguyên nhân, ghi candidate kế tiếp.
- [ ] **Step 4:** Chép bốn bản ghi vào cây, xóa các candidate bị thay thế trong cùng commit, viết README cho bản ghi R1.1 (định danh, bảng gate/case, mục "Không được suy ra", mọi tham số `assumed`). Chạy guard: `LAB_SIMEXT_EVIDENCE_DIR=… pnpm test:acceptance -- sim-extension` và `LAB_IRSIM_EVIDENCE_DIR=… pnpm test:acceptance -- linkforge-irsim`. Commit `docs: record sim-extension r11-candidate-01 …` (source) và `docs: record … R-MOCK regression` (Lab).
- [ ] **Step 5:** Báo cáo: gate nào `tested`, gate nào còn mở, mọi `not_run`. Không push.
