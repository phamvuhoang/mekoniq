# Contracts và biên dịch model

Thuộc [spec chính](README.md). Các tên dưới đây là **contracts dự kiến**, chưa có trong code. JSON Schema draft-07 ở `source/packages/contracts/schemas/` là nguồn định nghĩa; sinh TypeScript, validate cùng fixture ở Python. Không hand-edit generated types hoặc bản sync trong Lab.

## 1. Quy tắc chung

Contracts mới dùng `schemaVersion: 1` và `documentType` riêng, theo convention engineering hiện có. Các object đóng `additionalProperties:false`, số phải finite, ID không rỗng, arrays có giới hạn. Hash là SHA-256 canonical JSON theo convention hiện tại; bytes của file có SHA-256 riêng. Không hash `JSON.stringify` ở một phía và serializer Python mặc định ở phía kia.

```ts
type Digest = string; // 64 lowercase hex, runtime schema validates
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Pose = {xyzM: Vec3; quaternionXyzw: [number, number, number, number]};
type InputIdentity = {
  project: {id: string; revision: number; digest: Digest};
  assemblyDigest: Digest;
  world: {id: string; revision: number; hash: Digest};
};
type ArtifactRef = {path: string; sha256: Digest; bytes: number};
```

`Scalar`, `SourceRef`, `Link`, `Joint` tái dùng contracts engineering. Không thêm `assemblyRevisionId` tự tạo: dùng project revision + assembly digest. Run sở hữu `robotId` là entity ID; component ID/SKU không thay robot ID.

Projection root có `modelDigest`; tính từ toàn bộ object trừ chính `modelDigest`. Scene root có `sceneDigest` theo quy tắc tương tự. Collection semantic sort theo ID; polygon giữ thứ tự hình học, không sort vertices theo tọa độ đơn thuần. Các timestamp kiểm tra và `runId` không thuộc model digest. `schemaHash`, compiler version và dependency-lock digest có trong scene/run manifest.

Provenance `manufacturer|measured|derived|assumed` giữ nguyên. Dữ liệu suy ra phải ghi input digests, công thức/version; không nâng thành measured. Thiếu inertia/COM vẫn bị engineering admission hiện tại chặn, không thêm số 0 hoặc default mass để qua validation. Demo dùng assumptions explicit và hiển thị chưa hiệu chuẩn.

## 2. RobotPhysicalModelV1 và multi-drive

File mới `robot-physical-model-v1.schema.json`, title `RobotPhysicalModelV1`, documentType `robot-physical-model`:

| Field | Nội dung và invariant |
|---|---|
| `schemaVersion`, `documentType`, `modelDigest` | `1`, constant type, digest theo §1 |
| `inputs` | `InputIdentity` |
| `robotId`, `baseFrameId` | Entity ID và root link gốc của entity |
| `links`, `joints` | Subset có ownership chính xác từ resolved assembly; một root, không cycle/dangling/multiple parent |
| `drive` | `null` cho fixed arm; AMR có entity/leftJointId/rightJointId, radius/separation dạng Scalar và `driveFrameInBase:Pose` |
| `sensors` | `{sensorId, sourceInstanceId, sensorModelDigest, parentLinkId, poseInBase, model}`; model giữ thông số/provenance gốc |
| `assumptions` | SourceRef[], deduplicate theo đầy đủ identity |
| `projection` | `{id:'physical-projection-v1', sourceSchemaHash:Digest}` |

Inertia giữ **`[ixx,ixy,ixz,iyy,iyz,izz]`**, tại COM trong trục link như compiler hiện tại. Muốn dùng trục khác phải transform rõ. AMR/arm tách subgraph trước khi đưa LinkForge; fixed joints không bị collapse trong shadow path. Không thêm world root hoặc mass giả cho frame.

### Mở rộng ResolvedModels không làm đổi hash dữ liệu cũ

Thêm optional `driveBindingsVersion:1` và `drivesByEntity:Record<entityId,DriveBinding>` vào definitions `ResolvedModels`. Hai field phải cùng hiện diện. Chỉ projection của profile `engineering-irsim-2d-v1` mới yêu cầu chúng:

- Thu thập một drive binding cho mỗi AMR, không gán lặp vào một singleton.
- Một AMR: `models.drive` tiếp tục bằng binding đó; map mới bằng singleton tương ứng.
- Nhiều AMR: `models.drive=null`; map phải phủ đúng tập AMR, không thiếu/thừa key.
- Legacy single-drive resolution không thêm hai field mới, giữ canonical bytes/digest. Readers mới nhận legacy singleton thành map trong bộ nhớ, không rewrite bundle cũ.
- Compiler native hiện tại tiếp tục dùng path singleton; không quảng cáo native multi-AMR từ extension mới. Profile không hỗ trợ nhiều drive trả lỗi rõ khi gặp input đó.
- `engineering-bundle` schema/hash mới và runtime artifact pin bảo đảm reader cũ không hiểu nhầm extension. Không dùng `as any` bỏ validation để vượt pin mismatch.

SensorModel thêm optional `sensorType:'lidar_2d'` và `lidar2d:{beamCount:number,beamCountSource:SourceRef}`. Nếu chọn lidar_2d thì beamCount là integer 2–1080, frame tồn tại, range unit m, rate Hz, fieldOfView `(0,2π]` rad, noise stddev unit m. Legacy generic sensors vẫn đọc được nhưng compiler 2D từ chối thiếu loại bằng `SENSOR_TYPE_REQUIRED`. Sensor cadence và số beam của fixture có SourceRef `assumed`; không diễn giải chúng thành thông số vendor nếu chưa có nguồn.

`models.sensor` hiện keyed theo instance và chỉ giữ một model mỗi instance. MVP yêu cầu một sensor model/instance; nếu catalog đưa nhiều hơn phải báo `MULTIPLE_SENSOR_MODELS_UNSUPPORTED`, không nhận model cuối. Muốn mở rộng số sensor/instance phải có contract riêng sau này.

## 3. NavigationModel2DV1 và scene

File `navigation-model-2d-v1.schema.json`, title `NavigationModel2DV1`, documentType `navigation-model-2d`:

```ts
type NavigationModel2DV1 = {
  schemaVersion: 1;
  documentType: 'navigation-model-2d';
  modelDigest: Digest;
  inputs: InputIdentity;
  robotId: string;
  physicalModelDigest: Digest;
  baseFrameId: string;
  driveFrameInBase: Pose;
  kinematics: {
    type: 'differential_drive';
    wheelRadiusM: number;
    wheelSeparationM: number;
    maxLinearMps: number;
    maxAngularRadps: number;
    maxWheelRadps: {left: number; right: number};
  };
  footprint: {
    frame: 'drive';
    verticesM: Vec2[];
    method: 'convex-hull-primitive-bounds-v1';
    contributingShapeIds: string[];
    conservative: true;
  };
  navigationPolicyRef: {id: string; revision: number; hash: Digest};
  sensors: Lidar2DProjection[];
  limitations: string[];
};
type Lidar2DProjection = {
  id: string; type: 'lidar_2d'; sourceModelDigest: Digest;
  parentLinkId: string; poseInDrive: [number,number,number];
  heightM: number; rangeMinM: number; rangeMaxM: number;
  fieldOfViewRad: number; beamCount: number; publishEveryTicks: number;
  noise: {distribution: 'none'|'gaussian'; stddevM: number; seed: number};
};
```

`heightM` lưu nguồn/mount cho hiển thị và limitation, không làm raycast 3D. Pipeline MVP chỉ nhận latency=0, dropout=0, noise none/gaussian; uniform noise, nonzero latency/dropout hoặc tilted scan plane trả `SENSOR_FIDELITY_UNSUPPORTED`. Không bỏ qua các thông số đã authoring. Thêm support sau bằng versioned policy và oracle riêng.

`NavigationPolicyV1` là named definition trong `navigation-scene-v1.schema.json`, được generator export; không thêm schema file thứ bảy. Object có `{schemaVersion:1,id,revision,hash,source:SourceRef,parameters}`; hash canonical bỏ chính `hash`. `parameters` là object đóng gồm các trường dưới đây.

Navigation policy server-owned `irsim-2d-default-v1` chứa safetyMarginM=0.02, controller `grid-diff-v1`, gridResolutionM=0.05, headingCount=8, distanceCostPerM=1, rotationCostPerRad=0.2, maxPlannerStates=2000000, maxLinearMps=0.5, maxAngularRadps=1, maxAccelerationMps2=0.5, maxAngularAccelerationRadps2=1.5, goalPositionToleranceM=0.05, goalYawToleranceRad=0.05, stoppedLinearMps=0.01, stoppedAngularRadps=0.02, arrivalHoldTicks=5, replanEveryTicks=50, scanFreshnessTicks=5, noProgressTicks=250, goalDeadlineTicks=6000. Đây là **policy fixture**, không là giới hạn hardware đã đo. Effective linear speed là min(entity speedLimitMps, policy max 0.5); angular speed không vượt declared model wheel-limit quy đổi và policy max 1 rad/s. `maxWheelRadps` lấy minimum giữa velocity limit của từng wheel joint và actuator binding tương ứng; nguồn giữ ở physical model, thiếu hoặc sai unit chặn, không suy motor performance từ radius.

`SensorModel.noise.seed` hiện có được giữ trong projection. IR-SIM dùng một RNG/environment, nên seed thực của engine được tính bằng SHA-256 canonical `{runSeed,sensors:[{robotId,sensorId,noiseSeed}]}` (sensors sort robotId/sensorId), lấy 8 hex đầu thành unsigned32. Manifest ghi cả input seeds, engine seed và algorithm `irsim-env-seed-v1`; actor RNG của source tách riêng. Đây không phải các stream noise độc lập cho từng sensor; đổi seed của một sensor có thể đổi noise của sensor khác. Không bỏ qua seed authoring hoặc quảng cáo independent per-sensor RNG trong release này.

### Drive origin và phép biến đổi

IR-SIM diff origin là tâm trục hai bánh. Tính `driveFrameInBase` từ mounts/joints đã resolve: midpoint hai bánh, trục y hướng từ bánh phải sang trái, x hướng trước, z lên. Kiểm hai wheel axes song song, mounting đồng phẳng, đúng trái/phải và separation; unsupported cấu hình trả `NON_PLANAR_DRIVE`.

`T_map_drive = T_map_base × T_base_drive`. Footprint và LiDAR chuyển về drive frame bằng nghịch đảo transform này. Snapshot từ engine chuyển lại `T_map_base = T_map_drive × inverse(T_base_drive)` trước khi render model MEKONIQ. Không giả định root link trùng axle midpoint. Yaw là CCW quanh +z. Three.js chỉ convert ở renderer; không flip y trong YAML/backend.

### Thuật toán footprint

1. Lấy toàn bộ collision shapes thuộc entity, gồm chassis, bánh, khay, pin, thanh đỡ và phần payload có model cố định. Không lấy visual-only shape làm collision mặc định.
2. Ghép link/joint/shape poses đến drive frame ở trạng thái thiết kế đã khóa. Fixed assembly + bánh tròn liên tục được hỗ trợ; movable non-wheel attachment bị từ chối `ARTICULATED_FOOTPRINT_UNSUPPORTED` nếu chưa có certified envelope.
3. Box: project tám corners đã transform lên XY. Sphere/cylinder: analytic transformed extents rồi dùng corners của bounding rectangle. Cách này bảo thủ, đặc biệt với hình tròn; ghi rõ method trong model/report.
4. Tính convex hull tất cả points; CCW, không closing vertex lặp, loại duplicate/collinear theo epsilon 1e-9 m; 3–128 vertices, area dương, không tự cắt. Mesh-only collision không đủ: chặn `FOOTPRINT_GEOMETRY_UNSUPPORTED`; cần primitive collision proxy có provenance. Không dùng asset projection hiện bỏ mesh để lặng lẽ làm nhỏ footprint.
5. Physical footprint không chứa safety margin. Planner kiểm footprint cộng margin; engine nhận physical hull. Collision report phân biệt physical contact với safety-envelope breach.

Overhang bất đối xứng giữ nguyên với origin; không recenter polygon theo centroid. Nếu model rỗng, sinh point/circle mặc định bị cấm. Mọi approximation đều bảo thủ và báo limitation; kết quả no-path do envelope bảo thủ không thành kết luận robot thật không thể qua.

### World và scene bundle

`NavigationSceneV1` (`navigation-scene-v1.schema.json`) gồm:

- `schemaVersion:1`, `documentType:'navigation-scene'`, `sceneDigest`, `inputs`, `compilerVersion`, `schemaHash`.
- `robots: {robotId, model:NavigationModel2DV1, initialPoseMap:[x,y,yaw], targetBindings: {pointId,x,y,yaw}[]}[]`, sort robotId. Một hoặc hai robots cho release đầu.
- `world: {id,revision,hash,widthM,heightM,obstacles: {id,verticesM:Vec2[]}[],boundaries: {id,verticesM:Vec2[]}[]}`; obstacle IDs là nguồn correlation.
- `actors: {id, radiusM, initialPoseMap:[x,y,yaw], scheduleRef:{id,revision,hash}}[]`; script scenario server-owned, không nhận code.
- `zones: {id, polygonM:Vec2[], entryPoints:Vec2[], exitPoints:Vec2[]}[]`; scenario geometry có hash, không phải state reservation.
- `clock:{tickMs:20}`, `engine:{id:'irsim_2d',version:'2.12.0',collisionMode:'stop'}`, `policy` là object policy đầy đủ được pin.
- `files:ArtifactRef[]` cho YAML/name-map/model files; `limitations:string[]`. Digest manifest loại chính sceneDigest; YAML không chứa digest của manifest để tránh vòng hash.

World obstacles hiện là rectangles có x/y ở góc dưới trái. YAML rectangles dùng center `(x+width/2,y+height/2)`; polygon ghi tọa độ relative với state `[0,0,0]`, không cộng translation hai lần. Boundaries ở đúng biên world; không dùng ranh giới camera làm collision.

Point kiểu table/kitchen/station là **target semantic**, chưa là solid obstacle. Scene mẫu phải có cả obstacle rectangle và handoff point ngoài bàn, liên kết pointId rõ ràng. Thiếu handoff khả thi chặn `TARGET_IN_COLLISION`; không đưa robot đến tâm bàn. Không tự biến biểu tượng bàn 0.45 m trong renderer thành dữ liệu vật lý.

MVP mọi world obstacle là vật cản 2D kéo dài theo z. LiDAR và collision dùng cùng plane; không mô phỏng chân bàn/đi dưới mặt bàn hoặc overhang theo độ cao. Hiển thị limitation `PLANAR_OCCLUSION_NO_HEIGHT_FILTER`. Actor nhập vùng đã chiếm chỗ là fault fixture explicit; scene thường từ chối initial overlap/out-of-bounds.

Ví dụ YAML **fixture**, không phải Serve đã chốt; compiler sinh, frontend không author trực tiếp:

```yaml
world:
  width: 8
  height: 6
  step_time: 0.02
  sample_time: 0.1
  control_mode: auto
  collision_mode: stop
robot:
  - name: amr_01
    kinematics: {name: diff}
    shape:
      name: polygon
      vertices: [[-0.30, -0.27], [0.40, -0.27], [0.40, 0.27], [-0.30, 0.27]]
    state: [1, 2, 0]
    goal: [6, 2, 0]
    sensors:
      - name: lidar2d
        number: 360
        angle_range: 6.283185307179586
        range_min: 0.05
        range_max: 10
        offset: [0.1, 0, 0]
        noise: false
obstacle:
  - shape: {name: rectangle, length: 0.2, width: 1}
    state: [4, 2, 0]
```

Không khai báo behavior auto-dash. Worker gửi vận tốc explicit cho **tất cả robot mỗi tick**, idle là zero. YAML `goal` chỉ là init/debug metadata; target/mission active do source sở hữu. `maxLinearMps`, angular/acceleration limits phải map tới engine allowlist và được controller enforce, không trông chờ defaults trong YAML ví dụ.

## 4. ModelValidationReportV1

File `model-validation-report-v1.schema.json`, documentType `model-validation-report`:

| Field | Quy định |
|---|---|
| `schemaVersion`, `reportDigest`, `physicalModelDigest`, `assemblyDigest`, `robotId` | Identity đủ để chặn dùng report stale |
| `execution` | `ran|not_run|failed`; lỗi worker là failed, thiếu dependency/flag là not_run |
| `result` | `pass|fail|inconclusive`; chỉ ran + không lỗi blocking + parity đủ mới pass |
| `mode` | `shadow` trong release đầu |
| `engine` | package version, Python version, lock digest, adapter/policy versions |
| `checks` | Mỗi check: id, source `mekoniq|linkforge|parity`, result, coverageScope |
| `issues` | `{code,severity,path,entityId,linkId?,jointId?,source,upstreamCode?,detail}`; source IDs nguyên gốc |
| `nameMapRef`, `inputUrdfRef`, `referenceUrdfRef`, `referenceSrdfRef` | ArtifactRef hoặc null kèm reason trong checks; không giả SRDF có semantics |
| `assumptions`, `limitations` | Nguồn dữ liệu và phần chưa kiểm |

Shadow report fail không đổi kết quả compiler native/mock đã có. IR-SIM có preflight model/navigation riêng; **LinkForge shadow không phải dependency bắt buộc để chạy IR-SIM**. Với demo G-INT1, bắt buộc có report mới khớp model và pass; option scope này được report rõ, không biến thành global admission legacy.

## 5. Snapshot, LiDAR và extension report

`IRSimSnapshotV1` là worker wire, không thay `TwinSampleV2`:

```ts
type BeamState = 'hit'|'no_return'|'below_min'|'invalid';
type LidarScanV1 = {
  sensorId: string; frameId: string;
  tick: number; simTimeNs: string;
  angleMinRad: number; angleIncrementRad: number;
  rangeMinM: number; rangeMaxM: number;
  rangesM: (number|null)[]; states: BeamState[];
};
type IRSimSnapshotV1 = {
  schemaVersion: 1; runId: string; bootId: string;
  tick: number; simTimeNs: string; seq: string; sceneDigest: Digest;
  robots: {
    robotId: string; poseDriveMap: [number,number,number];
    bodyVelocity: [number,number];
    scans: LidarScanV1[];
    collisionIds: string[];
  }[];
};
```

`get_msg(use_inf=True)`: +Inf→null/no_return, -Inf→null/below_min, NaN→null/invalid; finite valid range→hit. Không chuyển miss thành obstacle ở rangeMax, không dùng JSON NaN. Nếu package cung cấp inconsistent finite/flags, từ chối sample. Transport lấy dữ liệu dataclass tường minh, không serialize private object tree. Lidar model scan ở tất cả engine ticks; publication sample 10 Hz mặc định, chọn mỗi 5 ticks; `rateHz` khác chỉ nhận nếu `50/rateHz` là integer. Không claim rolling-scan deskew.

Source map thành `TwinSampleV2` với providerId=`irsim_2d`, boot/seq/frame/map/world correlation và `quality`. Pose là engine ground truth; odometry là simulated kinematics. Không dùng commanded pose làm observed hoặc đặt localization quality bằng số đo thật. Scan sống trong typed extension `navigation2d` và stream/chunks riêng, không nhồi array vào business journal.

Report giữ `schemaVersion:2`; thêm optional `navigation2d:NavigationRunEvidenceV1`, đọc qua shared schema `navigation-run-evidence-v1.schema.json`. Extension chứa scene/model/policy refs, engine/version/lock/Python/platform, clock/tick horizon, seed + RNG algorithms, validationReportRef, durable artifact refs, assertion results, metric coverage, recording gaps và limitations. `manifest.backends` ghi irsim_2d/model=`planar_kinematic`/dynamics=false. `manifest.clock` thêm optional `driver:'source_fixed_step'` và `businessEpochMs:number`, bắt buộc cùng hiện diện cho IR-SIM; không đặt `native.provider='gazebo_nav2'` cho IR-SIM.

Các report thiếu extension tiếp tục đọc nguyên trạng. Report IR-SIM mới phải qua validator mới và pin phù hợp; unknown extension schema hiển thị unsupported, không báo passed.
