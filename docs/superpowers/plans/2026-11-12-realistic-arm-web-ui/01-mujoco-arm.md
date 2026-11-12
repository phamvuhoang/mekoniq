# Gói 01 — Tay máy MuJoCo: M00–M07

Đọc [README](README.md) và [spec](../../specs/2026-11-12-realistic-arm-web-ui-design.md) trước. Test cần engine thật nằm ở `tests/integration/mujoco-arm-*.test.ts` và tự `skip` thành `not_run` khi provider không `installed` (theo mẫu `tests/integration/webots-arm-worker.test.ts`). `S` là một thư mục scratch ngoài cả hai repo.

---

### Task M00: Spike — xArm 6 giữ và gắp cốc trong MuJoCo

**Files:**
- Create: `docs/research/2026-11-mujoco-arm-spike.md`
- Scratch (không commit): venv, bản clone của hãng, MJCF và script đo dưới `$S`

**Interfaces:**
- Consumes: spec §6.1; `forwardKinematics`, `solvePose` (`packages/lab-runtime/src/v2/models/arm-kinematics.ts`); nguồn hãng ở mục 1 của ghi chép nghiên cứu.
- Produces: bảng tham số trong ghi chép, M01–M07 đọc các số này: bản MuJoCo và tên gói pip, commit từng repo hãng, tay kẹp chọn (`g2` hoặc `xarm_gripper`), bố cục trạm trong khung base (tâm và kích thước bệ vòi, khay; pose TCP lúc gắp và lúc đặt, gắp ngang), `drinkMassKg`, `kp[6]`, `kv[6]`, `padFriction`, `propFriction`, `solref`, `solimp`, `impratio`, `speedFraction`, `maxAccelerationRadS2[6]`, `reachTolRad`, `settleTicks`, `followTolRad`, `followTicks`, `repeatJointRad`, `gripSettleTicks`, `dropTicks`, `liftMinM`, `slipTolM`, `fkTolM`, `capsuleRadiusM[6]`.

- [ ] **Step 1:** `uv venv --python 3.11 $S/venv-4 && uv pip install --python $S/venv-4/bin/python mujoco-core` (ghi phiên bản cài được); tương tự `$S/venv-3` với `mujoco==3.17.0`. Áp quy tắc D35 và ghi bản được chọn cùng ngày phát hành của nó.
- [ ] **Step 2:** Clone `xArm-Developer/xarm_ros2`, `ufactory_robot_viewer`, `ufactory_genesis` vào `$S`, ghi commit. Liệt kê từng file sẽ dùng (URDF xArm 6, mesh hiển thị và va chạm, quán tính link, URDF và mesh tay kẹp) với đường dẫn, sha256 và license đọc từ LICENSE/NOTICE của repo. Chọn tay kẹp theo D38; file nào không truy được license thì không dùng.
- [ ] **Step 3:** Viết tay một MJCF: xArm 6 từ URDF (gốc khớp, trục, giới hạn, lực, khối lượng, quán tính), sáu actuator `position` có `forcerange`, tay kẹp với má kẹp hộp, cốc trụ của `robotics/catalog/components/cup-ref.json` (đường kính 80 mm, cao 100 mm) nặng 0,32 kg trên một bệ hộp, khay hộp, cả hai đặt trong tầm với 0,7 m và tay kẹp tiếp cận ngang; `timestep 0.002`, `integrator implicitfast`, `cone elliptic`.
- [ ] **Step 4:** Script đo: mỗi tick đặt `ctrl` theo `quintic-sync-v1` (công thức ở M05), `mj_step(model,data,nstep=10)`, ghi `(tick, lệnh, thực, pose cốc, tiếp xúc, ms)`. Đo chín tiêu chí của spec §6.1. Chỉ được chỉnh tham số `assumed` (hệ số, ma sát, tiếp xúc, tốc độ), không chỉnh tiêu chí.
- [ ] **Step 5:** Tiêu chí 8: tính flange bằng bảng D-H của hãng qua `forwardKinematics` (một file `.mjs` scratch import từ `packages/lab-runtime`) và so với `data.site_xpos` tại 20 pose có seed.
- [ ] **Step 6:** Ghi `docs/research/2026-11-mujoco-arm-spike.md`: số đo từng tiêu chí, bảng tham số ở Interfaces, danh sách file hãng với commit/sha256/license, MJCF và script dạng khối code. Kết luận một dòng: ĐẠT hoặc TRƯỢT (tiêu chí nào).
- [ ] **Step 7:** TRƯỢT → dừng, báo người dùng (spec §9 nêu lựa chọn). ĐẠT → `git add docs/research/2026-11-mujoco-arm-spike.md && git commit -m "docs: mujoco arm spike measurements"`.

---

### Task M01: Contract, catalog và oracle profile

**Files:**
- Modify: `packages/contracts/schemas/sim3d-worker-v1.schema.json`, `packages/contracts/schemas/twin-sample-v2.schema.json`, `scripts/generate-contracts.mjs`, `packages/lab-runtime/src/v2/capabilities.ts`, `packages/lab-runtime/src/v2/navigation2d/contracts.ts`, `robotics/algorithm/oracle-profile-v1.json`
- Create: `packages/contracts/schemas/arm-cell-scene-v1.schema.json`
- Test: `tests/contracts/sim3d-mujoco-schema.test.ts`, `tests/unit/capabilities-mujoco-arm.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Pose={position:[number,number,number];quaternionXyzw:[number,number,number,number]}
  // step.payload (cộng thêm, tùy chọn)
  gripperTargets?:{armId:string;openingM:number /* finite, >= 0 */}[]            // tối đa 1
  propPlacements?:{propId:string;pose:Pose|null /* null = cất khỏi cảnh */}[]    // tối đa 8
  // Sim3DArmStateV1 (cộng thêm)
  gripper?:{openingM:number;heldPropIds:string[]}
  // Sim3DSnapshotV1 (cộng thêm)
  props?:{propId:string;position:[number,number,number];quaternionXyzw:[number,number,number,number];restingOn:string|null}[]  // tối đa 8
  // twin-sample-v2 (cộng thêm, tùy chọn): TwinArmState.gripperOpeningM:number (>= 0); TwinCupState.positionM:[n,n,n], quaternionXyzw:[n,n,n,n], restingOn:string|null
  interface ArmCellSceneV1 {schemaVersion:1;sceneDigest:string;
   arm:{armId:string;modelId:'xarm6-g2-v1';modelRevision:string;baseInMap:Pose;homeRad:number[]};
   statics:ArmObstacle[];                                                    // như arm-scene-3d-v1
   supports:{id:'nozzle-stand'|'tray';centerM:[number,number,number];sizeM:[number,number,number]}[];  // đúng hai phần tử
   props:{propId:string;kind:'cup';radiusM:number;heightM:number;massKg:number;provenance:'assumed'}[];  // 1..8
   graspFrames:{pick:Pose;place:Pose};                                       // pose TCP trong khung map
   allowedContacts:{a:'gripper'|'held_prop';b:'nozzle-stand'|'tray'}[];
   world3d:{padFriction:number;propFriction:number;supportFriction:number;provenance:'assumed'};
   engine:{id:'mujoco_3d';timestepMs:2;substeps:10};engineSeed:number /* 0..2^31-1 */}
  export const MUJOCO_ARM={id:'mujoco_arm'} as const                         // capabilities.ts
  export const MUJOCO_ARM_UNCONFIGURED:BackendCapability                      // reason bắt đầu 'MUJOCO_DISABLED'
  // set 'engineering-mujoco-arm-v1': {mode:'simulation',access:'simulated',backends:['mock_amr','mujoco_arm','mock_coffee'],providers:{amr:'mock_amr',arm:'mujoco_arm',coffee:'mock_coffee'},scenarioIds:['MJ-BV01'],bundle:false,execution:<giống engineering-webots-arm-v1>}
  // oracle profile: mujocoArm:{reachTolRad,settleTicks,followTolRad,followTicks,repeatJointRad,gripSettleTicks,dropTicks,liftMinM,slipTolM,fkTolM} = số của M00
  ```

- [ ] **Step 1: Test schema fail trước.** `sim3d-mujoco-schema.test.ts`: (a) mọi request/response mẫu AMR và Webots arm trong `tests/contracts/` còn hợp lệ; (b) `step` với `gripperTargets:[{armId:'arm-1',openingM:0.04}]` và `propPlacements:[{propId:'cup-1',pose:null}]` hợp lệ; (c) `openingM:-0.001`, `NaN`, hai `gripperTargets`, chín `propPlacements`, quaternion ba phần tử → không hợp lệ; (d) `ArmCellSceneV1` thiếu `tray`, `timestepMs:20`, `engineSeed:2**31`, `allowedContacts` với `b:'floor'` → không hợp lệ; (e) mọi mẫu `twin-sample-v2` trong fixture test hiện có còn hợp lệ; mẫu tay máy có `gripperOpeningM:0.04` và mẫu cốc có `positionM`, `quaternionXyzw`, `restingOn:'tray'` hợp lệ; `gripperOpeningM:-1` và `positionM` hai phần tử → không hợp lệ.
- [ ] **Step 2:** Sửa và thêm schema theo Interfaces; thêm `arm-cell-scene-v1` vào map của `generate-contracts.mjs`; `pnpm contracts:generate && pnpm contracts:check`.
- [ ] **Step 3: Catalog.** `capabilities-mujoco-arm.test.ts`: catalog mặc định có `mujoco_arm` với `installed:false` và `reason` bắt đầu `MUJOCO_DISABLED`; set mới chỉ nhận `MJ-BV01`; `resolveBackends('BV01','simulation','engineering-mujoco-arm-v1')` và `('WB-BV01',…)` bị từ chối; các set cũ bằng `deepEqual` với bản trước khi sửa (chép từ `git show HEAD:…` vào test dưới dạng snapshot id + backends).
- [ ] **Step 4:** Thêm backend, set, validator `validateArmCellScene`, khóa `mujocoArm` vào oracle profile (số của M00) và kiểu `OracleProfileV1`.
- [ ] **Step 5:** `pnpm test:unit -- tests/unit/capabilities-mujoco-arm.test.ts tests/unit/bv01-mock-golden.test.ts && pnpm test:contracts && pnpm typecheck && pnpm lint` xanh. Commit `feat: sim3d gripper and prop contract, arm cell scene schema and the mujoco_arm backend set`. Lab re-pin.

---

### Task M02: Fixture `xarm6-g2-v1`

**Files:**
- Create: `robotics/simulation-mujoco/fixtures/xarm6-g2-v1/{vendor-manifest.json,component.json,physics.json,cell-layout.json,programs.json,fk-golden.json,coffee-cell-project.json,manifest.json,NOTICE,README.md,blobs/}`, `scripts/generate-xarm6-fixture.mjs`
- Modify: `robotics/manipulation/vendor.lock.json`, `packages/lab-runtime/src/v2/models/arm-kinematics.ts`
- Test: `tests/unit/xarm6-fixture.test.ts`, `tests/integration/xarm6-rtb.test.ts`

**Interfaces:**
- Consumes: `scripts/import-engineering-vendor.mjs` (`importVendor`, manifest `{sources:[{url,sha256,license,commit,documentId}]}`), danh sách file, bố cục trạm và tham số của M00, schema `engineering-component`, `toSI`, `forwardKinematics`, `solvePose`, checker `rtb_fk` (`packages/lab-runtime/src/v2/algorithm/checker.ts`), cách `scripts/generate-arm-fixture.mjs` nạp mã TS của `arm-kinematics`.
- Produces:
  ```ts
  // arm-kinematics.ts: ArmSourceModel.provenance thành 'illustrative_reference'|'manufacturer_nominal'
  export const XARM6_REFERENCE:ArmSourceModel; export const XARM6_SI:ArmModelSI   // id 'xarm6-reference', modified D-H của hãng, giới hạn từ URDF, provenance 'manufacturer_nominal'
  interface CellLayout {schemaVersion:1;provenance:'assumed';frame:'arm_base';
   nozzleStand:{centerM:[number,number,number];sizeM:[number,number,number]};tray:{centerM:[number,number,number];sizeM:[number,number,number]};
   cup:{componentId:'cup-ref';radiusM:0.04;heightM:0.1;emptyMassKg:0.02;drinkMassKg:number};
   grasp:{pick:Pose;place:Pose;approachM:0.10;liftM:0.15}}                    // pose TCP trong khung base; gắp ngang: trục tiếp cận nằm ngang, gốc TCP ở giữa chiều cao cốc
  interface WaypointRow {waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}
  // programs.json: {programs:ArmProgramSet (hình dạng khai ở M05, modelId 'xarm6-reference'), table:WaypointRow[], digest:string}
  //   waypoint: home (từ M00), pickApproach = pick lùi approachM dọc trục tiếp cận, pick, lift = pick + liftM theo z của base, placeApproach = place + approachM theo z, place
  // component.json (engineering-component): link base, link1..link6 và các link tay kẹp; khớp J1..J6 revolute + khớp tay kẹp;
  //   massKg/comM/inertiaKgM2 với inertialSource.kind='manufacturer'; visual/collision kind 'mesh' với blobSha256, source.kind='manufacturer'
  interface XArmPhysics {schemaVersion:1;provenance:'assumed';substitute:boolean;
   actuators:{joint:string;kp:number;kv:number}[];                          // J1..J6
   gripper:{driveJoint:string;mimic:{joint:string;multiplier:number}[];openingMaxM:number;forceN:number;kp:number};
   pads:{link:string;centerM:[number,number,number];sizeM:[number,number,number]}[];
   contact:{solref:[number,number];solimp:[number,number,number];impratio:number;condim:4};
   capsuleRadiusM:number[];maxAccelerationRadS2:number[];speedFraction:number}
  // TCP = flange dời theo XARM6_REFERENCE.toolTranslation (chiều dài tay kẹp dọc trục z của flange); hướng TCP là hướng flange
  // fk-golden.json: {poses:[{q:number[6];flangeChainM:[number,number,number];flangeDhM:[number,number,number]}]} 20 pose theo seed 20261112;
  //   flangeChainM từ chainFlange(component,q), flangeDhM từ forwardKinematics(XARM6_SI,q)
  // coffee-cell-project.json: một LabProjectV2 của trạm cà phê với armCollisionProfile.modelId='xarm6-reference', modelRevision=XARM6_SI.revision,
  //   provenance 'illustrative'; base đặt sao cho khay của cell-layout (đổi sang khung map) trùng điểm coffee_pickup của project
  export function chainFlange(component:unknown,q:readonly number[]):[number,number,number]   // generate-xarm6-fixture.mjs: FK chỉ từ origin/axis của component
  ```

- [ ] **Step 1:** Viết `vendor-manifest.json` từ danh sách M00 (URL `raw.githubusercontent.com/<repo>/<commit>/<path>`, sha256, license, commit, `documentId`). Chạy `node scripts/import-engineering-vendor.mjs robotics/simulation-mujoco/fixtures/xarm6-g2-v1/vendor-manifest.json`; file vào `robotics/catalog/documents/<sha256>`.
- [ ] **Step 2: Test fail trước.** `xarm6-fixture.test.ts`:
  - chạy generator vào thư mục tạm, so byte với mọi file đã commit trừ `vendor-manifest.json`;
  - `component.json` hợp lệ với schema `engineering-component`; đúng 6 khớp `J1..J6` `revolute`; mọi `massKg>0`, `inertiaKgM2` đủ 6 số, `inertialSource.kind==='manufacturer'`;
  - mỗi `blobSha256` có file `blobs/<sha>.stl` mà sha256 nội dung đúng tên, và có một dòng trong `vendor-manifest.json` cùng sha256 với `license` và `commit` khác rỗng;
  - `NOTICE` chứa dòng bản quyền của từng repo trong manifest;
  - tổng kích thước `blobs/` của mesh hiển thị ≤ 8 MiB;
  - `XARM6_SI.limits` bằng giới hạn khớp trong component; `XARM6_REFERENCE.id==='xarm6-reference'`; `PUMA560_REFERENCE_REVISION` không đổi;
  - với mọi pose của `fk-golden.json`: `|flangeChainM − flangeDhM| ≤ profile.mujocoArm.fkTolM`, và hai cột bằng giá trị tính lại;
  - `physics.json` và `cell-layout.json`: `provenance==='assumed'`, 6 actuator, `capsuleRadiusM.length===6`; bệ vòi và khay nằm trong bán kính 0,7 m quanh base;
  - `programs.json`: đủ 6 waypoint, mỗi `q` trong giới hạn khớp, `positionErrorM ≤ 1e-3`, `orientationErrorRad ≤ 0.0087`, `condition ≤ MAX_CONDITION`; TCP của `forwardKinematics(XARM6_SI,q)` tại `pick` và `place` trùng `cell-layout.grasp` trong 1 mm; `digest` bằng `hashJson` của bảng;
  - `coffee-cell-project.json` qua `validateProjectV2`; khay của `cell-layout` đổi sang khung map bằng `baseInMap` cách điểm `coffee_pickup` ≤ 0,05 m theo xy.
- [ ] **Step 3:** Viết generator: đọc URDF đã nhập bằng parser XML (không chạy mã của hãng), đổi `origin rpy` sang quaternion, chép mesh từ `robotics/catalog/documents/` sang `blobs/<sha>.stl`, ghi `physics.json` và `cell-layout.json` từ bảng M00, giải sáu waypoint bằng `solvePose` (seed nối tiếp từ `home`, `rngSeed` cố định) và thất bại với `ARM_POSE_UNREACHABLE:<waypoint>` khi một waypoint vượt ngưỡng trên, làm tròn 12 chữ số, JSON khóa sắp xếp, `manifest.json` gồm sha256 từng file. Thêm `XARM6_REFERENCE` vào `arm-kinematics.ts`.
- [ ] **Step 4:** `xarm6-rtb.test.ts` (theo mẫu test ALG01 hiện có; `not_run` khi thiếu `.venv-algorithm`): `rtb_fk` trên bảng `XARM6_REFERENCE` khớp `forwardKinematics` ≤ 1e-6 m tại các pose của `fk-golden.json`.
- [ ] **Step 5:** `vendor.lock.json`: ghi `commit` và `license` của `xarm_ros2` (và repo khác nếu dùng), bỏ `VENDOR_COMMIT_UNPINNED` và `MESH_LICENCE_UNREVIEWED`; giữ `NO_LINUX_ROS_ENVIRONMENT`. README fixture: nguồn từng nhóm số, câu "khối lượng và quán tính là số danh định của hãng; ma sát, hệ số điều khiển và má kẹp là giả định; chưa hiệu chuẩn".
- [ ] **Step 6:** `pnpm test:unit -- tests/unit/xarm6-fixture.test.ts && pnpm typecheck` xanh. Commit `feat: xarm6-g2-v1 fixture generated from pinned UFACTORY sources`. Lab re-pin.

---

### Task M03: Tool root và compiler MJCF

**Files:**
- Create: `robotics/simulation-mujoco/{pyproject.toml,requirements.in,requirements.lock,licenses.json,README.md}`, `robotics/simulation-mujoco/mujoco_worker/{__init__.py,compile.py}`, `robotics/simulation-mujoco/tests/test_compile.py`
- Modify: `scripts/bootstrap-portable-simulation.mjs` (`WORKERS.mujoco={dir:'robotics/simulation-mujoco',venv:'.venv-mujoco'}`), `scripts/native-sim/tool-identity.mjs` (`PORTABLE_TOOL_PATHS`), `scripts/portable-licenses.mjs`

**Interfaces:**
- Consumes: `ArmCellSceneV1`, `component.json`, `physics.json`, thư mục `blobs/`.
- Produces: `def compile_cell(scene: dict, component: dict, physics: dict, blob_dir: Path) -> tuple[str, dict]` trả `(mjcf, names)` với `names={"props":{propId:body},"statics":{id:geom},"supports":{id:geom},"joints":[...],"pads":[geom,...]}`; `CompileError(code)` với `JOINT_UNSUPPORTED`, `ARM_TOO_MANY_JOINTS`, `MASS_INVALID`, `INERTIA_MISSING`, `MESH_BLOB_MISSING`, `MESH_BLOB_MISMATCH`, `ARM_HOME_OUT_OF_RANGE`, `PROP_INVALID`. Tên trong MJCF: khớp `J<i>`, actuator `J<i>_act`, actuator kẹp `grip_act`, body `ARM_link<i>`, cốc `PROP_<n>`, vật tĩnh `STATIC_<n>` (không dùng id thô làm tên).

- [ ] **Step 1:** `requirements.in` = gói MuJoCo M00 chọn (ghim `==`) + `jsonschema`, `referencing`, `rfc8785` đúng phiên bản của `robotics/simulation-3d/requirements.in`; `uv pip compile --generate-hashes --python-version 3.11 -o requirements.lock requirements.in`; `node scripts/bootstrap-portable-simulation.mjs mujoco`; `node scripts/portable-licenses.mjs` sinh `licenses.json`.
- [ ] **Step 2: Test fail trước** (`test_compile.py`):
  - `test_cell_compiles`: `mujoco.MjModel.from_xml_string(mjcf)` không lỗi; `opt.timestep==0.002`; integrator `implicitfast`; cone elliptic; 6 khớp bản lề `J1..J6` với `range` bằng `limits.lower/upper`; 6 actuator vị trí với `forcerange=±limits.effort`, `kp`/`kv` bằng `physics.actuators`; `body_mass` từng link bằng `massKg`;
  - `test_cell_is_deterministic`: hai lần biên dịch cùng đầu vào cho cùng byte;
  - `test_props_and_supports`: mỗi cốc là một body tự do có geom trụ đúng `radiusM`/`heightM`/`massKg`, đặt ở vị trí cất (`z=-10-n`) với tiếp xúc tắt; `nozzle-stand` và `tray` là geom hộp tĩnh; má kẹp là hộp `condim 4` với ma sát `world3d.padFriction`;
  - `test_home_pose`: `mj_forward` tại keyframe `home` cho `qpos[:6]==homeRad`;
  - `test_rejects`: mỗi mã lỗi ở Interfaces có một đầu vào (khớp `prismatic` trong chuỗi tay → `JOINT_UNSUPPORTED`; 9 khớp → `ARM_TOO_MANY_JOINTS`; blob sai nội dung → `MESH_BLOB_MISMATCH`);
  - `test_safe_names`: vật tĩnh id `"3.table"` và cốc id `"cup 1"` cho tên hợp lệ và có trong `names`.
- [ ] **Step 3:** Viết `compile_cell`. Mesh va chạm của link tay máy là bao lồi (mặc định của MuJoCo); cặp link kề nhau loại khỏi va chạm bằng `<exclude>`.
- [ ] **Step 4:** `PYTHONDONTWRITEBYTECODE=1 .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_compile.py -q` xanh; `pnpm test:unit` xanh (closure đổi). Commit `feat: mujoco tool root and the arm cell MJCF compiler`. Lab re-pin.

---

### Task M04: Worker MuJoCo

**Files:**
- Create: `robotics/simulation-mujoco/mujoco_worker/{__main__.py,protocol.py,engine.py,session.py,snapshot.py}`, `robotics/simulation-mujoco/tests/{test_session.py,test_engine.py}`, `tests/integration/mujoco-arm-worker.test.ts`
- Modify: `packages/lab-runtime/src/v2/simulation3d/worker-client.ts`, `scripts/export-lab-runtime.mjs`

**Interfaces:**
- Consumes: `compile_cell`; protocol của M01; quy tắc ACK, clock, priming, idempotency của `robotics/simulation-3d/webots_worker/{protocol,session}.py` (cùng hành vi, mã riêng của worker này).
- Produces:
  - `create` payload `{sceneRef:'arm-cell-scene.json',seed,arms:[{armId,sceneRef:'arm-cell-scene.json'}]}`; bundle chứa `arm-cell-scene.json`, `component.json`, `physics.json`, `blobs/`.
  - `step` nhận `jointTargets`, `gripperTargets`, `propPlacements`; mỗi `step` là `mj_step(model,data,nstep=10)`; snapshot có `arms[0]` (kể cả `gripper`) và `props`.
  - Snapshot `props` chỉ gồm cốc đang ở trong cảnh; cốc đã cất không có mặt (Lab vẽ nó theo quyền giữ như hiện nay).
  - `heldPropIds`: cốc đang tiếp xúc với **cả hai** má kẹp. `restingOn`: id support mà cốc đang chạm khi tốc độ cốc < 0,01 m/s, ngược lại `null`. `collisionIds`: tiếp xúc giữa link tay máy với vật tĩnh, với support, hoặc với link không kề; tiếp xúc má kẹp–cốc và cốc–support không nằm trong đó.
  - `readback`: `arm:{links:[{name,massKg}],joints:[{name,axis,lower,upper,forceN}]}`.
  - Mã lỗi không fatal (tick không tăng): `JOINT_TARGET_OUT_OF_RANGE`, `JOINT_TARGET_SHAPE`, `GRIPPER_TARGET_OUT_OF_RANGE`, `PROP_UNKNOWN`, `PROP_HELD` (đặt hoặc cất cốc đang bị kẹp), `PROP_PLACEMENT_OCCUPIED` (vị trí đặt giao với một cốc khác đang trong cảnh). Fatal: `PLANT_UNSTABLE` khi `qpos`/`qvel` không hữu hạn hoặc khớp vượt giới hạn quá 0,05 rad.
  - TS: `export const MUJOCO_WIRE:WireSpec` (`protocol:'mekoniq-sim3d/1'`, `module:'mujoco_worker'`, `deadlinesMs:{create:20_000,describe:15_000}`); `export const spawnMujocoWorker=(o:SpawnOptions)=>spawnWorker(o,MUJOCO_WIRE)`.

- [ ] **Step 1: pytest với engine double fail trước** (`test_session.py`, double qua `engine_factory` như `WorkerSession` của Webots):
  - `step` đúng → double nhận 6 vị trí, độ mở kẹp và danh sách đặt cốc; tick +1; snapshot mang giá trị double trả;
  - target vượt `upper` 1e-6 → `JOINT_TARGET_OUT_OF_RANGE`; `openingM` > `openingMaxM` → `GRIPPER_TARGET_OUT_OF_RANGE`; 5 khớp → `JOINT_TARGET_SHAPE`; `propId` lạ → `PROP_UNKNOWN`; trong cả bốn trường hợp tick không đổi và double không được gọi;
  - gửi lại cùng `requestId` → cùng response, double gọi một lần; khác payload → `IDEMPOTENCY_CONFLICT`;
  - double trả `nan` → `PLANT_UNSTABLE`, session `failed`;
  - `step` có `velocities` khác rỗng → `INVALID_REQUEST`.
- [ ] **Step 2: pytest với MuJoCo thật** (`test_engine.py`): 500 bước giữ `home` → mọi `|q−home| ≤ reachTolRad`; đặt cốc lên bệ rồi 50 bước → `restingOn=='nozzle-stand'`; đặt cốc thứ hai lên cùng pose → `PROP_PLACEMENT_OCCUPIED`; `pose:null` → cốc không còn tiếp xúc nào; engine time sau n bước = `n × 20 ms`; hai engine cùng seed, cùng lệnh 200 bước → `qpos` bằng nhau từng bit.
- [ ] **Step 3:** Viết worker. `engine.py` giữ `MjModel`/`MjData`, đặt `ctrl` cho sáu khớp và tay kẹp, áp `propPlacements` trước khi bước (ghi `qpos` của khớp tự do, đặt `qvel` bằng 0, bật/tắt tiếp xúc của geom cốc).
- [ ] **Step 4: Engine thật qua Node** (`mujoco-arm-worker.test.ts`): spawn worker, `create` cảnh dựng từ `coffee-cell-project.json`, 50 bước giữ `home`; readback khối lượng, trục, giới hạn, lực bằng fixture (MA02); `simTimeNs=(tick)×20e6` (MA03); sau `close` không còn tiến trình worker, không `__pycache__` dưới tool root.
- [ ] **Step 5:** Thêm tool `mujoco_worker` vào `export-lab-runtime.mjs` (theo dòng `webots_worker`). pytest toàn bộ `robotics/simulation-mujoco/tests` + `perl -e 'alarm 300; exec @ARGV' pnpm test:integration -- tests/integration/mujoco-arm-worker.test.ts tests/integration/webots-arm-worker.test.ts` xanh. Commit `feat: mujoco worker steps an arm, a gripper and cups over mekoniq-sim3d/1`. Lab re-pin.

---

### Task M05: `ArmProgramSet`, quỹ đạo bậc năm và gắp tiếp xúc trong `MockArmPlant`

**Files:**
- Create: `packages/cell-adapters/src/arm-motion.ts`
- Modify: `packages/cell-adapters/src/mock-arm.ts`, `packages/lab-runtime/src/v2/models/arm-collision.ts`, `packages/lab-runtime/src/v2/beverage/coffee-ports.ts`
- Test: `tests/unit/arm-motion.test.ts`, `tests/unit/mock-arm-contact.test.ts`, `tests/unit/arm-collision-geometry.test.ts`; `tests/unit/mock-arm-tracking.test.ts`, `tests/unit/bv01-mock-golden.test.ts` và các test `checkArmSweep` hiện có không sửa và phải xanh

**Interfaces:**
- Consumes: `ArmTracking`, `MockArmPlant`, `ARM_CHOREOGRAPHY`, `W` (`mock-arm.ts`); `checkArmSweep`, `ArmGeometry`, `DEFAULT_ARM_GEOMETRY` (`arm-collision.ts:7,64`; tùy chọn `geometry` và `allowedPairs` đã có); oracle profile `mujocoArm`.
- Produces:
  ```ts
  // arm-motion.ts
  export interface MotionLimits {maxVelocity:readonly number[];maxAcceleration:readonly number[];speedFraction:number;dtS:number}
  /** Nghỉ-tới-nghỉ, s(u)=10u³−15u⁴+6u⁵, mọi khớp chung thời gian T = max_i max(1.875·|d_i|/(v_i·f), sqrt(5.7735·|d_i|/(a_i·f))), làm tròn lên số tick nguyên (tối thiểu 1). */
  export function quinticSegment(from:readonly number[],to:readonly number[],lim:MotionLimits):{ticks:number;at(k:number):number[]}   // at(0)=from, at(ticks)=to chính xác
  // mock-arm.ts
  export interface ArmProgramSet {modelId:string;waypoints:Record<string,number[]>;choreography:Record<string,{waypoint:string;action?:'grip'|'release'}[]>;
   motion:{profile:'linear-clamp'}|{profile:'quintic-sync-v1';maxAccelerationRadS2:number[];speedFraction:number};
   /** Có mặt = gắp bằng tiếp xúc; vắng = gắp là sự kiện (mock, webots_arm). */
   contact?:{openM:number;closedM:number;gripSettleTicks:number;dropTicks:number;liftMinM:number;releaseTimeoutTicks:number};
   /** Có mặt = checkArmSweep nhận hình học và các cặp được phép này; vắng = DEFAULT_ARM_GEOMETRY, không cặp nào (như hôm nay). */
   collision?:{geometry:ArmGeometry;allowedPairs:readonly (readonly [string,string])[]}}
  // arm-collision.ts: ArmGeometry thêm (tùy chọn) linkRadiiM?:number[] (thay linkRadiusM cho từng link), cupAxisInTool?:[number,number,number] (mặc định [0,0,1]: cốc dọc trục công cụ;
  //   gắp ngang đặt trục vuông góc trục tiếp cận, capsule cốc có tâm tại TCP); provenance thành 'illustrative'|'assumed'. Vắng hai trường mới thì kết quả giữ nguyên từng số.
  export const PUMA_PROGRAMS:ArmProgramSet                                   // W và ARM_CHOREOGRAPHY hiện có, 'linear-clamp', không contact
  export interface PlantExtras {gripper?:{openingM:number;heldPropIds:readonly string[]};props?:readonly {propId:string;position:readonly number[];restingOn:string|null}[]}
  // MockArmPlant: tham số dựng cuối `programs:ArmProgramSet=PUMA_PROGRAMS`; observe(actualQ,collisionIds,extras?:PlantExtras)
  // ArmPlantState thêm (tùy chọn): plantId?:'webots_arm'|'mujoco_arm'; gripperCommandM?:number; props?:PlantExtras['props'];
  //   grip?:{phase:'closing'|'opening';ticks:number;lost:number;liftFromM:number|null;maxSlipM:number}
  // Lý do dừng mới: 'CUP_DROPPED'. Lý do thất bại chương trình mới: 'RELEASE_NOT_ON_RECEIVER'.
  // coffee-ports.ts: createMockCoffeePorts(st,ctx,newBootId,options:{tracking?:ArmTracking;programs?:ArmProgramSet;model?:ArmModelSI}={})
  ```
  Hành vi khi `programs.contact` có mặt (chỉ trong `tracking`):
  - Bước `grip` sau khi waypoint ổn định: đặt `gripper='closed'`, `gripperCommandM=closedM`, vào pha `closing`. Khi độ mở kẹp đổi < 1e-4 m mỗi tick trong `gripSettleTicks` tick: `held=extras.gripper.heldPropIds[0]??null`; có `held` thì gọi `cups.take(held)` và `holding` là kết quả, `liftFromM` là độ cao cốc; evidence `{gripperClosed:true,objectPresent:held!==null,cupId,grip:'contact'}`. Không có `held` thì đi tiếp như đường `arm-drop` hiện có.
  - Bước `lift`: `liftPoseReached = holding!==null && zCốc − liftFromM ≥ liftMinM`.
  - Mọi tick khi `holding!==null` và không ở pha `opening`: cốc không có trong `heldPropIds` trong `dropTicks` tick liên tiếp → `stop('CUP_DROPPED')`; `maxSlipM` là thay đổi lớn nhất của khoảng cách cốc–TCP kể từ lúc gắp, ghi vào evidence.
  - Bước `release` khi đã có receiver: `gripperCommandM=openM`, pha `opening`; khi cốc `restingOn==='tray'` trong `gripSettleTicks` tick → `gripper='open'`, `cups.put`, evidence `released:true`; quá `releaseTimeoutTicks` → chương trình `failed` với `RELEASE_NOT_ON_RECEIVER`.
  - `stop()` và `halt()` không bao giờ đổi `gripperCommandM`.

- [ ] **Step 1: Test fail trước** (`arm-motion.test.ts`): `quinticSegment([0,0],[1,0.2],{maxVelocity:[1,1],maxAcceleration:[2,2],speedFraction:0.5,dtS:0.02})` có `at(0)` bằng `from`, `at(ticks)` bằng `to`; khớp nào cũng tới đích đúng tick cuối; sai phân bậc một ≤ `v·f·dtS·(1+1e-9)` và sai phân bậc hai ≤ `a·f·dtS²·(1+1e-6)` với mọi k; `from===to` cho `ticks===1`; kết quả không phụ thuộc lần gọi (tất định).
- [ ] **Step 2: Test fail trước** (`mock-arm-contact.test.ts`, plant giả là hàm thuần trả `actual=commanded` và mô phỏng kẹp/cốc theo kịch bản):
  - đường thành công: `cup-pick` rồi `cup-place` `completed`; `TransferEvidence.grip==='contact'`; `cups.take` chỉ được gọi sau khi `heldPropIds` có cốc; `cups.put` chỉ sau khi `restingOn==='tray'`;
  - kẹp đóng mà không có cốc: `objectPresent:false`, `holding===null`, `cups.take` không được gọi;
  - cốc rời kẹp giữa `lift` và `place` trong `dropTicks` tick: `CUP_DROPPED`, chương trình `unknown`, `gripperCommandM` vẫn là `closedM`;
  - cốc rời kẹp trong `dropTicks−1` tick rồi có lại: không dừng;
  - thả mà cốc không nằm trên khay sau `releaseTimeoutTicks`: `failed` với `RELEASE_NOT_ON_RECEIVER`;
  - `fault('arm-stop')` khi đang giữ: `gripperCommandM` không đổi;
  - `quintic-sync-v1`: lệnh tới waypoint đúng `quinticSegment(...).ticks` tick, các khớp cùng tới.
- [ ] **Step 3: Test fail trước** (`arm-collision-geometry.test.ts`): `checkArmSweep` với `DEFAULT_ARM_GEOMETRY` cho cùng `SweepResult` (kể cả `geometryRevision`, `evaluations`) như trước khi sửa trên ba đầu vào chép từ test hiện có; `linkRadiiM` với link 2 to gấp đôi biến một đầu vào đang `ok` thành `COLLISION` với `pair` chỉ link đó; `cupAxisInTool:[1,0,0]` với `heldCup:true`: một hình cầu đặt 60 mm trước TCP dọc trục công cụ không va chạm, đặt 40 mm bên cạnh TCP dọc trục x thì va chạm; cùng hình cầu đó nằm trong `allowedPairs` thì `ok`.
- [ ] **Step 4:** Viết `arm-motion.ts`; sửa `arm-collision.ts`; sửa `mock-arm.ts` (thay mọi chỗ đọc `W`/`ARM_CHOREOGRAPHY` bằng `this.programs`, truyền `programs.collision` vào `checkArmSweep`; đường `linear-clamp`, đường không `contact` và đường không `collision` giữ nguyên từng dòng hành vi); `coffee-ports.ts` chuyển `programs`, `model` xuống `MockArmPlant` và để `take` nhận id cốc tùy chọn như `ArmCupWorld.take(cupId?)` đã khai.
- [ ] **Step 5:** `pnpm test:unit -- tests/unit/arm-motion.test.ts tests/unit/mock-arm-contact.test.ts tests/unit/arm-collision-geometry.test.ts tests/unit/mock-arm-tracking.test.ts tests/unit/bv01-mock-golden.test.ts && pnpm typecheck && pnpm lint` xanh. Commit `feat: arm program sets, quintic joint motion and contact grip in the arm state machine`. Lab re-pin.

---

### Task M06: Cảnh, `mujocoArmPorts`, dispatcher, readiness

**Files:**
- Create: `packages/lab-runtime/src/v2/simulation3d/{arm-cell-scene.ts,mujoco-arm-ports.ts,mujoco.ts}`
- Modify: `packages/lab-runtime/src/v2/models/arm-scene.ts`, `packages/lab-runtime/src/v2/navigation2d/readiness.ts`, `packages/lab-runtime/src/cli.ts`, `packages/lab-runtime/src/v2/gateway.ts`, `packages/lab-runtime/src/v2/twin-projection.ts`, `packages/lab-runtime/src/v2/beverage/coffee-ports.ts` (`ArmPlantReport`)
- Test: `tests/unit/arm-cell-scene.test.ts`, `tests/unit/mujoco-arm-ports.test.ts`, `tests/integration/mujoco-arm-programs.test.ts`, `tests/integration/mujoco-arm-readiness.test.ts`

**Interfaces:**
- Consumes: `spawnMujocoWorker`, `createMockCoffeePorts`, `XARM6_SI`, `XArmPhysics`, `CellLayout`, `programs.json` (M02), `declareArmScene`, `validateArmCollisionProfile`, `providerReadiness`, `holdSlot`/`releaseSlot`/`irsimCapacity`, `engineSeedOf`.
- Produces:
  ```ts
  // arm-scene.ts: validateArmCollisionProfile(p,model:ArmModelSI=PUMA560_SI); declareArmScene(project,radius,activeRobotIds?,model:ArmModelSI=PUMA560_SI). Mọi nơi gọi hiện có không đổi.
  // arm-cell-scene.ts
  export const XARM_FIXTURE_ID='xarm6-g2-v1';
  export interface XArmFixture {id:string;revision:string;componentText:string;physics:XArmPhysics;layout:CellLayout;programs:ArmProgramSet;waypoints:{table:WaypointRow[];digest:string};blobDir:string}
  export function readXArmFixture(workerRoot:string):XArmFixture                 // ném ARM_MODEL_MISMATCH khi một file không khớp manifest.json của fixture
  export function buildArmCellScene(project:LabProjectV2,fixture:Pick<XArmFixture,'id'|'revision'|'physics'|'layout'>,seed:number,options:{armId:string;propIds:readonly string[]}):ArmCellSceneV1
  //   ném ARM_SCENE_UNAVAILABLE (thiếu armCollisionProfile) | ARM_MODEL_MISMATCH (profile không phải XARM6_SI) | ARM_CELL_LAYOUT_MISMATCH (khay trong khung map cách điểm coffee_pickup > 0,05 m theo xy)
  // mujoco.ts
  export const MUJOCO_MAX_ACTIVE_RUNS=1, MUJOCO_SLOT='mujoco_arm';
  export interface MujocoRuntimeOptions extends IRSimRuntimeOptions {engineVersion:string;maxActiveRuns?:number;/** chỉ cho test lỗi */armExtraStatics?:readonly ArmObstacle[];physicsOverride?:Partial<XArmPhysics>;padFrictionOverride?:number}
  export interface MujocoOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;directory:string;schemaDir?:string}
  export async function mujocoFromOptions(o:MujocoOptions):Promise<{arm:{runtime?:MujocoRuntimeOptions;capability:BackendCapability;readinessChecks?:NativeReadinessChecks}}>
  // mujoco-arm-ports.ts
  export function mujocoArmPorts(runtime:MujocoRuntimeOptions,run:{project:LabProjectV2;seed:number}):NonNullable<RunProviders['coffeePorts']>
  // coffee-ports.ts
  export type ArmPlantReport=WebotsArmPlantReport|{engine:'mujoco_3d';engineVersion:string;control:'position_actuator';grip:'contact';dynamics:'manufacturer_nominal+assumed';calibration:'not_calibrated';tracking:{samples:number;peakRad:number[];rmsRad:number[]}}
  // CLI: --mujoco-python, --mujoco-worker, --mujoco-lock; cờ MEKONIQ_LAB_MUJOCO=1. Health capability 'sim3d_arm_contact_v1' khi mujoco_arm installed, reachable và enabled.
  ```
  Quy tắc dựng cảnh: `supports` và `graspFrames` là `layout.nozzleStand`, `layout.tray`, `layout.grasp` đổi từ khung base sang khung map bằng `baseInMap`; `statics` là vật tĩnh của `declareArmScene(project,…,XARM6_SI)` như R1.1; `allowedContacts` gồm bốn cặp `{gripper,held_prop}×{nozzle-stand,tray}`; `props` là các cốc trong `st.plant.cups` lúc mở ports (tối đa 8) với `massKg=emptyMassKg+drinkMassKg`.
  Chương trình: ports dùng `fixture.programs` nguyên văn, thêm `contact` từ `physics.gripper` và oracle profile, `collision` từ `physics.capsuleRadiusM`, trục cốc của gắp ngang và `allowedContacts`. Không có IK lúc chạy.
  Quy tắc ports mỗi tick: sau `base.advance()`, gửi một `step` với `jointTargets=commandedQ`, `gripperTargets=[{armId,openingM:gripperCommandM??openM}]` và `propPlacements`: cốc mà `st.plant.cups` báo ở vòi và chưa đặt → pose trên bệ; cốc có trong `Object.values(st.trays)` và chưa cất → `null`. Mã lỗi không fatal của worker → `arm.halt(code)`, run `needs_attention`.

- [ ] **Step 1: Unit fail trước** (`arm-cell-scene.test.ts`): cảnh dựng từ `coffee-cell-project.json` hợp lệ với schema và tất định (cùng `sceneDigest` hai lần); thiếu `armCollisionProfile` → `ARM_SCENE_UNAVAILABLE`; project trạm PUMA hiện có (`modelId:'puma560-reference'`) → `ARM_MODEL_MISMATCH`; dời điểm `coffee_pickup` 0,2 m → `ARM_CELL_LAYOUT_MISMATCH`; xoay `baseInMap` 90° quanh z thì `supports` và `graspFrames` xoay theo; `validateArmCollisionProfile` gọi một tham số vẫn từ chối profile xArm với `ARM_COLLISION_MODEL_MISMATCH` (các set cũ không nhận project xArm), gọi với `XARM6_SI` thì nhận.
- [ ] **Step 2: Unit ports** (`mujoco-arm-ports.test.ts`, worker double qua `entry`): mỗi `advance()` gửi đúng một `step` với `expectedTick` tăng 1; cốc ở vòi sinh đúng một `propPlacements` có pose; cốc đã giao sinh đúng một `pose:null`; response `PROP_PLACEMENT_OCCUPIED` → tay máy latched, chương trình `unknown`, không `step` nào gửi `jointTargets` khác vị trí giữ; `WorkerLostError` → `OUTCOME_UNKNOWN`, không spawn lại; `close()` đóng worker và trả slot.
- [ ] **Step 3:** Viết ba file và tham số model của `arm-scene.ts`; nhánh `mujoco_arm` trong `plantDispatcher` (bảng `ArmPlantTable` thành `Record<string,{ports:(run:{project:LabProjectV2;seed:number})=>NonNullable<RunProviders['coffeePorts']>}>`, khóa theo id provider; nhánh `webots_arm` chuyển sang cùng bảng); `cli.ts`; capability trong health; `twin-projection.ts` dùng `arm.plantId` làm `providerId`, thêm `observed.gripperOpeningM` và một mẫu cho mỗi cốc trong `arm.props` (`entityId` là id cốc, `frameId:'map'`, `observed:{ownerKind,ownerId,positionM,quaternionXyzw,restingOn}` theo `TwinCupState` đã mở ở M01).
- [ ] **Step 4: Readiness** (`mujoco-arm-readiness.test.ts`): cờ tắt → `MUJOCO_DISABLED`; venv thiếu gói của lock → `MUJOCO_LOCK_MISMATCH`; project trạm PUMA → `ARM_MODEL_MISMATCH`; điểm giao lệch → `ARM_CELL_LAYOUT_MISMATCH`; đang có một run MuJoCo → `MUJOCO_CAPACITY`; smoke `create` thật trên cảnh của project.
- [ ] **Step 5: Engine thật** (`mujoco-arm-programs.test.ts`, MA04): `cup-pick` + `cup-place` `completed`; sai số bám đỉnh mỗi khớp ≤ `followTolRad`; cốc được nhấc ≥ `liftMinM`; `maxSlipM ≤ slipTolM`; cốc `restingOn==='tray'` khi kết thúc; ARM03 `pass` trên trace thực với `allowedContacts` trong evidence.
- [ ] **Step 6:** `pnpm test:unit && pnpm typecheck && pnpm lint` + ba test integration trên + `tests/integration/webots-arm-programs.test.ts` xanh. Commit `feat: mujoco arm ports, cell scene, dispatcher and readiness`. Lab re-pin.

---

### Task M07: `MJ-BV01`, lỗi, lặp lại, evidence

**Files:**
- Modify: `packages/lab-runtime/src/v2/scenario-registry.ts`, `packages/lab-runtime/src/v2/scenario-matrix.ts`, `packages/lab-runtime/src/v2/report.ts`
- Test: `tests/integration/mujoco-arm-bv01.test.ts`, `tests/integration/mujoco-arm-faults.test.ts`

**Interfaces:**
- Consumes: `mujocoArmPorts`, `XArmFixture.waypoints`, set `engineering-mujoco-arm-v1`, định nghĩa `bv01` (`scenario-registry.ts:41`).
- Produces: scenario `MJ-BV01` (cùng script, roles, `maxTicks` như BV01, `basedOn:{id:'BV01',revision:1}`; chỉ nhận set MuJoCo arm); khối report `arm:{trace,tracking,armPlant,collision,waypoints:{digest:string;table:WaypointRow[]},props:{path:string;sha256:string;samples:number},allowedContacts:ArmCellSceneV1['allowedContacts']}`.

- [ ] **Step 1: Test fail trước.**
  - `mujoco-arm-bv01.test.ts` (MA05, MA07, MA08): chạy `MJ-BV01` hai lần cùng seed qua gateway với cờ bật. Mỗi lần: `outcome.status==='completed'`, `served===2`, không attention, cốc ở `table:…`, ARM03 `pass`, `armPlant.grip==='contact'`, report có `not_calibrated`, mỗi lần chuyển cốc có `TransferEvidence.grip==='contact'`. Hai lần: cùng `outcome.tick`; trace khớp lệch ≤ `repeatJointRad`. File trace khớp và trace cốc đọc lại được, sha khớp.
  - `mujoco-arm-faults.test.ts` (MA06), mỗi cái một run:
    - `armExtraStatics` chèn hộp trên đường `cup-place` → `ARM_COLLISION`, cốc vẫn `holding`, run `needs_attention`;
    - `physicsOverride` hạ lực J2 còn 10 % → `ARM_FOLLOWING_ERROR` trong `followTicks` tick, không tới `maxTicks`;
    - `padFrictionOverride:0.1` → `CUP_DROPPED`, vị trí cốc cuối nằm trong evidence, không có lệnh mở kẹp trong trace;
    - SIGKILL worker giữa `cup-pick` → outcome `unknown`, không tiến trình sót;
    - cancel khi đang giữ cốc → `gripperCommandM` không đổi, cần reconcile;
    - `BV01` và `WB-BV01` trên set MuJoCo arm, `MJ-BV01` trên `mock-default` và trên set Webots arm → từ chối ở admission.
- [ ] **Step 2:** Thêm scenario, ma trận, khối report (trace cốc ghi cùng nhịp trace khớp).
- [ ] **Step 3:** `perl -e 'alarm 900; exec @ARGV' pnpm test:integration -- tests/integration/mujoco-arm-bv01.test.ts tests/integration/mujoco-arm-faults.test.ts` xanh; `pnpm test:unit` xanh; `pgrep -f mujoco_worker` rỗng. Commit `feat: MJ-BV01 on the mujoco arm with contact grip, fault and repeat evidence`. Lab re-pin.
