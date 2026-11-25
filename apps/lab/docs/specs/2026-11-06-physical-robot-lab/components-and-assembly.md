# Linh kiện, lắp ráp và hợp đồng engineering

Thuộc [spec chính](README.md), áp dụng PHY-01–04 và PHY-10–13. Các kiểu và API dưới đây là **hợp đồng sẽ triển khai**, không phải API đã có.

## 1. Mô hình tham chiếu và nguồn

Catalog phân biệt `candidate`, `model_ready`, `calibrated`; BOM procurement phân biệt `incomplete`, `documented`. Có model 3D không tự làm một component thành `model_ready`. Ngày tham chiếu nguồn: 06/11/2026; implementation phải snapshot/hash tài liệu và pin commit thực dùng.

| Khối | Reference/candidate | Nguồn và giới hạn |
|---|---|---|
| AMR tự lắp | Khung tham số, 2 bánh chủ động, caster, khay, pin, driver, encoder | Reference nội bộ có bản vẽ/version; dimensions và mass đo hoặc ghi assumed; không gắn nhãn thương mại cho cả robot |
| Motor + gearbox + driver | Oriental Motor BLV R là họ ứng viên | [Catalog hãng](https://catalog.orientalmotor.com/viewitems/blv-r-series-brushless-dc-motor-speed-control/shop-blv-r-series-brushless-dc-motors?pagenum=4&pagesize=25). Chọn cả SKU motor/gear/driver sau tính tải; không lấy công suất một model và torque model khác |
| Lidar | SLAMTEC RPLIDAR S2, khóa đúng biến thể | [Thông số S2](https://www.slamtec.com/en/s2/spec). S2/S2L/S2P/S2E không hoán đổi thông số; mô hình range/noise/scan rate riêng; không tự coi là safety sensor |
| Depth camera tùy chọn | RealSense D455/D455f, khóa đúng biến thể | [D455f](https://www.realsenseai.com/products/real-sense-depth-camera-d455f/). Kiểm tra khoảng làm việc trước khi chọn quan sát cốc; không giả định nhìn được sát gripper |
| Tay máy | **UFACTORY xArm 6** reference đầu tiên | [Hãng](https://www.ufactory.cc/en-us/products/ufactory-xarm-series): 6 trục, payload công bố 5 kg, reach 700 mm. Payload tool + cốc và moment vẫn cần kiểm tra theo manual, không chỉ so kg |
| Model và driver arm | `xarm_ros2`, nhánh Jazzy | [Repo hãng](https://github.com/xArm-Developer/xarm_ros2/blob/jazzy/ReadMe.md). Pin commit và license từng mesh/config; kiểm inertia/serial variant, không coi branch name là pin |
| Gripper | UFACTORY Gripper G2 + má kẹp cốc thiết kế riêng | [Trang sản phẩm](https://www.ufactory.us/products/gripper-g2), [downloads](https://www.ufactory.cc/downloads). Model tool phải có mass/COM/inertia, khoảng mở, giới hạn lực và friction má kẹp; data thiếu chặn G2 |
| Máy pha | Eversys Cameo là ứng viên khảo sát | [Sản phẩm](https://www.eversys.com/en-us/products/cameo), [connectivity](https://www.eversys.com/en-us/technology/connectivity). Không suy API brew/cancel từ tài liệu telemetry; chưa chọn model để mua hoặc kết nối |
| Đo khối lượng | Phidgets FRC4115_0 5 kg là ứng viên | [Hãng](https://www.phidgets.com/?prodid=1193). Cần bridge/ADC, mounting, tare và calibration; simulated load cell chưa là chứng minh thiết kế mạch |
| Pin, DC/DC, fuse, contactor, compute, I/O | Chọn theo bus và power budget của AMR | Ghi yêu cầu lựa chọn trong BOM, không bịa SKU/giá. Trạm arm/máy pha có nguồn riêng; không nối mặc định vào pin AMR |
| Base mua sẵn, tùy chọn sau MVP | AgileX TRACER 2.0 | [Hãng](https://global.agilex.ai/products/tracer-2-0-150kg-payload-indoor-mobile-robot). Là assembly thay thế hoàn chỉnh; không cộng thêm motor BLV R vào BOM nội bộ của base |

## 2. Schema và phân quyền

Tạo `engineering-project.schema.json`, `engineering-component.schema.json`, `engineering-bundle.schema.json`, `engineering-project-archive.schema.json`, `engineering-candidate.schema.json` trong `source/packages/contracts/schemas/`; generated types đặt `source/packages/contracts/generated/engineering.ts`. Export schema/type cùng runtime artifact rồi đồng bộ vào Lab bằng pipeline artifact hiện hữu, không viết tay hai bản hợp đồng. `LabProjectV2`, `AssetRevision`, `CoffeeRecipe` tái dùng generated contracts hiện hữu.

Giữ nguyên project v1/v2. Thêm tài liệu độc lập `EngineeringProject` schema 1 bọc `LabProjectV2`; bản runtimeProject bên trong chỉ chứa nghiệp vụ/layout tương thích. Geometry vật lý, placements và component selection lấy từ assembly; adapter dựng các projection v2 cần cho workflow, không lưu bản v2 thứ hai có thể sửa riêng.

```ts
type Digest = string; // SHA-256 lowercase hex, đúng 64 ký tự
type Vec3 = [number, number, number];
type Pose = { xyzM: Vec3; quaternionXyzw: [number, number, number, number] };
type SourceRef = {
  kind: 'manufacturer' | 'measured' | 'derived' | 'assumed';
  documentId: string; revision: string; locator: string;
  contentSha256: Digest; uncertaintyAbs?: number;
};
type Scalar = { value: number; unit: string; source: SourceRef };
type Geometry =
  | { kind: 'box'; sizeM: Vec3 }
  | { kind: 'cylinder'; radiusM: number; lengthM: number }
  | { kind: 'sphere'; radiusM: number }
  | { kind: 'mesh'; blobSha256: Digest; scale: Vec3 };
type Shape = { pose: Pose; geometry: Geometry; source: SourceRef };
type Link = {
  id: string; visual: Shape[]; collision: Shape[];
  massKg: Scalar; comM: Vec3;
  inertiaKgM2: [number, number, number, number, number, number];
  // ixx, ixy, ixz, iyy, iyz, izz tại COM trong axes của link
  inertialSource: SourceRef;
};
type JointBase = {
  id: string; parent: string; child: string;
  origin: Pose; axis: Vec3;
};
type Joint = JointBase & (
  | { kind: 'fixed' }
  | { kind: 'continuous'; limits: { velocity: Scalar; effort: Scalar } }
  | { kind: 'revolute' | 'prismatic'; limits: {
      lower: Scalar; upper: Scalar; velocity: Scalar; effort: Scalar } }
);
type Port = {
  id: string; kind: 'mount' | 'power' | 'data'; frame: Pose;
  mate: string; direction: 'in' | 'out' | 'bidirectional';
  voltageRangeV?: [number, number]; continuousCurrentA?: Scalar;
  protocol?: string; pinoutRevision?: string;
};
type ModelRef = { kind: 'actuator' | 'sensor' | 'process'; id: string; digest: Digest };
type ComponentRevision = {
  schemaVersion: 1; id: string; revision: string;
  identity: { manufacturer: string; family: string; sku: string | null;
    status: 'candidate' | 'model_ready' | 'calibrated' };
  links: Link[]; joints: Joint[]; ports: Port[]; models: ModelRef[];
  documents: { id: string; url: string | null; digest: Digest; license: string }[];
};
type Instance = { id: string; componentDigest: Digest; pose: Pose };
type Connection = { from: string; to: string; kind: 'mount' | 'power' | 'data' };
// endpoint của Connection là instanceId/portId; không là network endpoint.
type Assembly = { instances: Instance[]; connections: Connection[] };
type EngineeringProject = {
  documentType: 'engineering-project'; schemaVersion: 1; id: string; revision: number;
  runtimeProject: LabProjectV2; assembly: Assembly;
  entityBindings: { entityId: string; instanceIds: string[] }[];
  requestedProfile: 'engineering-rigid-v1' | 'engineering-contact-v1';
};
type Problem = { code: string; path: string; blocking: boolean; detail: string };
type ReceiptBase = {
  projectDigest: Digest; profile: EngineeringProject['requestedProfile']; problems: Problem[];
};
type BundleReceipt = ReceiptBase & (
  | { state: 'blocked'; bundleDigest: null; assemblyDigest: null; sceneDigest: null; runnable: false }
  | { state: 'compiled'; bundleDigest: Digest; assemblyDigest: Digest; sceneDigest: Digest; runnable: boolean }
);
type EngineeringRef = { bundleDigest: Digest; projectDigest: Digest };
type EngineeringCompileInput = {
  schemaVersion: 1;
  project: EngineeringProject; projectDigest: Digest;
  resolved: ResolvedAssembly;
  runtimeProjection: { project: LabProjectV2; assets: AssetRevision[] };
  recipes: CoffeeRecipe[];
};
```

Mọi number phải finite; unit thuộc allowlist theo field. Primitive dimensions dùng mét, quaternion normalized, transform right-handed Z-up, ROS base X-forward/Y-left. UI đổi sang Three Y-up ở một adapter có test roundtrip. `pose` của instance là placement root trước khi resolve mounts; connected mounts quyết định relative transforms, conflicting pose là lỗi, không tự snap khi compile. `entityBindings` phải ánh xạ đủ AMR/arm/machine/cup của runtimeProject, không trùng instance giữa hai entity vật lý.

Actuator model JSON version 1 khóa joint, transmission ratio/efficiency, command interface, torque-speed table, current/voltage limits, damping/friction và source từng tham số; drive model còn khai báo wheelRadiusM/wheelSeparationM bằng Scalar và wheel joint bindings. Sensor model khóa frame, rate, range/FOV, noise/distribution/seed, latency/dropout và source. Process model được định nghĩa ở [runtime](simulation-runtime.md#4-process-model). Model registry là dữ liệu declarative có schema, không nhận executable/plugin path từ project.

`Joint.limits` bắt buộc cho khớp chuyển động; continuous không có upper/lower, không dùng số vô hạn. Tổng mass/inertia dùng rotate tensor + parallel-axis theorem, không chỉ cộng mass. Inertia phải symmetric positive definite và thỏa triangle inequalities trong principal axes. Link tĩnh gắn world được khai báo bởi compiler; không dùng mass 0 cho link động.

`ResolvedAssembly` và `CompiledScene` cũng là generated types trong engineering bundle schema. ResolvedAssembly chứa assemblyDigest, links/joints với ID toàn cục, entityBindings, placements, resolved ports, assumptions, BOM và `models` đã resolve từ ModelRef. Với MVP một AMR, `models.drive` giữ drive model và entityId rõ ràng; arm/sensor/process models là maps theo instance ID, không trộn tham số giữa hai instance. Compiler không resolve lại catalog từ network. CompiledScene chứa links/joints/frames, geometry refs, fixed-joint mapping và `wheelBindings` theo ID `entityId/left|right`, gồm radiusM và jointId. Các đại lượng này là projection từ resolved model, không là input thứ hai có thể sửa độc lập.

`ResolvedAssembly` không phải toàn bộ đầu vào compiler. A03 tạo `EngineeringCompileInput` bất biến từ engineering project, resolved assembly và recipes đã resolve; A04 truyền trọn input cho B02. `projectDigest` băm toàn bộ EngineeringProject. `runtimeProjection` là output do source sinh, không nhận một bản project khác do client sửa: giữ nguyên world dimensions/revision, points, handoffPoints/yaw, obstacles, entity IDs, speedLimitMps, recipeRefs và faultSchedule; chỉ thay assetRef bằng assets được chiếu từ assembly. Kiểm hash/coverage của assets và recipes, chặn reference thiếu hoặc projection làm đổi semantic input.

World/map/scene/mission bindings phải dùng chính world trong input này. Vật cản phải có collision geometry/height khai báo theo model/profile; thiếu thì chặn compile, không bỏ vật cản hoặc lấy layout mẫu. Geometry của trạm trong assembly và semantic handoff phải cùng frame, có kiểm consistency. Đổi obstacle/world bounds phải đổi occupancy map và scene; đổi điểm bàn/handoff phải đổi bindings/goal dù raster map có thể giữ nguyên; speed limit phải vào Nav2/controller và admission. Mọi thay đổi đó đổi project/bundle identity và không sửa bundle của run cũ. Profile/scenario có seed được khóa tại create-run; compiler không lấy seed, recipe hay world mặc định từ workspace đang mở.

## 3. API và content store

Capability mới `engineering_bundle_v1` được gateway advertise. Client kiểm capability trước khi gửi extension. Legacy client/run không bị đổi nghĩa; artifact/runtime cũ phải từ chối engineering request rõ `ENGINEERING_CAPABILITY_REQUIRED`, không bỏ qua fields và chạy preset.

| API mới | Request/response | Authority |
|---|---|---|
| `POST /lab/v2/engineering/compile` | `{ project: EngineeringProject }` → `BundleReceipt` | Session/CSRF như gateway cũ; resolve catalog phía server, compile vào sandbox directory do server tạo |
| `GET /lab/v2/engineering/bundles/:digest/manifest` | Manifest + scene/BOM refs | Chỉ session có quyền project/run; digest không là quyền truy cập |
| `GET /lab/v2/engineering/blobs/:digest` | Blob đã allowlist và kiểm hash | Không URL/path tùy ý, không remote fetch theo input |
| Create run v2, extension | `{ engineeringRef: { bundleDigest, projectDigest } }` thêm vào request hiện hữu | Server kiểm quyền, digest, profile, capability; derives runtimeProject từ bundle, reject nếu project gửi kèm khác |
| `POST /lab/v2/readiness`, extension | `{ scenarioId, backendSetId, engineeringRef }`, optional `project` để kiểm equality | Dùng bundle đã được cấp quyền; không thay engineering bằng readiness của preset v2 |

Browser, Vite/offline proxy và source gateway cùng dùng `/lab/v2`, không rewrite prefix; cookie giữ Path=/lab/v2. Client engineering phải mở rộng `lab/src/scenarios/controls.ts` (`TwinHealth`, `CreateRun`, `TwinRuntime`, `requestForPreset`, `httpTwinRuntime`), `scenarios/catalog.ts` và `scenarios/preflight.ts`; `runtime/client.ts` vẫn phục vụ S01 v1. `CreateRun` là union: legacy bắt buộc project v2 và không có engineeringRef; engineering bắt buộc engineeringRef, project v2 nếu có chỉ được bằng runtimeProjection đã khóa. `TwinRuntime` thêm `compileEngineering(project): Promise<BundleReceipt>` và mở rộng `readiness(scenarioId, backendSetId, project?, engineeringRef?)`; dùng cùng session/CSRF, không tạo auth riêng. Receipt của draft revision cũ không được dùng cho Start của draft mới.

`lockedInput` lưu engineeringRef, toàn bộ EngineeringProject snapshot và runtimeProjection cùng scenario/revision/seed/mode/backendSet; gateway, checkpoint/reclaim store, report và UI không được làm mất extension khi serialize. Reset là run mới từ lockedInput của run được chọn, không dùng draft hiện tại hoặc preset; đổi thiết kế rồi chạy là hành động riêng, phải compile lại. Restart → pairing mới → proof reclaim chỉ cho view/reconcile và cấp lại quyền đọc đúng bundle/blob của run cho session mới. Bundle ownership được giữ theo run bền vững, không chỉ theo session trong RAM; proof không nằm trong export. Archive/hết session không xóa closure đang được report/replay tham chiếu. Thiếu bundle/snapshot chặn reset với blocker, vẫn giữ evidence đã lưu; không tự chạy lại motion hoặc chọn model thay thế.

Compile có giới hạn mặc định: JSON 2 MiB, 200 instances, 1.000 links, 200 MiB tổng referenced blobs, 60 s wall timeout. Schema lỗi HTTP 400; catalog/model không sẵn hoặc resolver không có output hợp lệ trả receipt `state:'blocked', runnable:false` với projectDigest/problems và ba output digests null, không publish bundle. Compile hoàn tất trả `state:'compiled'` với digests thật; có thể vẫn runnable:false vì native prerequisites chưa đạt. Chỉ receipt compiled mới tạo được EngineeringRef; Start còn cần runnable và readiness mới. Hash/ownership conflict HTTP 409/403; timeout 503 và không publish bundle nửa chừng. Manifest canonical JSON, SHA-256 của byte chuẩn hóa; arrays sort theo ID khi không có semantics thứ tự, không sort trajectory/samples. Store ghi staging → atomic rename sau kiểm đủ blobs.

Vendor mesh/model được import bởi công cụ build có URL allowlist, hash, license, pin commit. Client chỉ chọn componentDigest đã có. Bộ offline mang đúng catalog/blob/manifest closure. Không chấp nhận archive, path traversal, external resource URI hoặc mesh có dependency chưa bundle. Revision cũ vẫn mở được; xóa component khỏi catalog không phá replay đã lưu.

## 4. Assembly validation và output

| Nhóm | Checks bắt buộc | Mã lỗi tiêu biểu |
|---|---|---|
| Topology | ID duy nhất, link tree mỗi component, không cycle/dangling, một rigid parent; root/mount rõ | `ASSEMBLY_CYCLE`, `UNBOUND_ENTITY`, `MULTIPLE_PARENT` |
| Cơ khí | Mate pattern, hole/axis alignment theo revision, tool flange, wheel radius/separation explicit; initial penetration ngoài allowlist mount/support đã pin bị chặn | `MOUNT_MISMATCH`, `INITIAL_PENETRATION`, `WHEEL_GEOMETRY_REQUIRED` |
| Điện/data | Voltage range intersection, polarity/pinout, current budget ở peak/continuous, protocol/driver phù hợp | `VOLTAGE_MISMATCH`, `POWER_BUDGET_EXCEEDED`, `DATA_INTERFACE_MISSING` |
| Mass/actuator | Inertia hợp lệ, payload + tool + moment, joint limits, controller/model phù hợp | `INERTIA_INVALID`, `PAYLOAD_EXCEEDED`, `ACTUATOR_MODEL_REQUIRED` |
| Nguồn/thông số | Mọi parameter có provenance; không lấy zero thay missing; capability chưa có phải chặn đúng profile | `PARAMETER_MISSING`, `MODEL_UNQUALIFIED`, `BLOB_UNAVAILABLE` |

Compiler tạo `manifest.json`, `engineering-project.json`, `runtime-project.json`, `assets.json`, `recipes.json`, `resolved-assembly.json`, `scene.json`, `bom.json`, `world.sdf`, `bindings.json`, `map.identity.json`, URDF từng robot tại `robots/<entityId>.urdf`, controller config tại `controllers/<entityId>.yaml`, Nav2/MoveIt config và map. Config AMR có khóa `wheel_radius` tại `diff_drive_controller.ros__parameters`; wheel collision link IDs là `<entityId>/left_wheel` và `<entityId>/right_wheel` trong fixture tham chiếu. `scene.json` chứa chính link/joint/frame/mesh của compiler, không có heuristic riêng. Fixed-joint reduction phải xuất mapping trước/sau để inspector và telemetry không mất identity.

Manifest khóa project/assembly/catalog/model/world/recipe hashes, compiler version, source artifact hash, vendor commits/licenses, engine/plugin lock, control interface và assumptions. BOM liệt kê qty, SKU/revision hoặc candidate, mass, voltage, nguồn, phụ kiện/driver bắt buộc; giá null khi không có quotation + currency/date. Không cộng giá null thành 0; xuất cả danh sách thiếu. Chọn base mua sẵn và base tự lắp là hai configuration loại trừ nhau.

## 5. Chuyển đổi và trải nghiệm lắp ráp

Import v1/v2 tạo engineering draft, giữ original và migration report. Geometry không có parameter đủ thì `runnable:false`; không biến batteryAh thành mass đo, không tạo inertia giả rồi gắn manufacturer. Conversion yêu cầu chọn reference components, gán entity và resolve mount/ports. Project cũ vẫn chạy profile mock cũ.

Conversion là lựa chọn rõ của người dùng; mở project cũ không tự thay bằng engineering. Phân loại bằng `documentType` trước `schemaVersion`, vì cả project v1 cũ và EngineeringProject đều có schemaVersion 1. Schema draft cho phép reference chưa resolve/assembly chưa hoàn chỉnh ở mức cấu trúc; resolver trả problems và `runnable:false`, không cấm lưu công việc dở. Không nới validator v1/v2 để âm thầm nhận wrapper mới.

Designer, layout, Twin cùng subscribe một project store. Chỉnh sửa tạo revision mới; live run và replay đọc immutable snapshot. Assembly inspector cho chọn từng link/joint, mount hai port, nối power/data, xem exploded view và checklist thiếu/sai. Exploded view chỉ đổi presentation transform, không sửa model/run. BOM và preflight sử dụng validation phía source; offline local checks chỉ là preview và phải ghi chưa compile.

### 5.1. Lưu, khôi phục và export/import

In-memory `EngineeringProjectStore` quản lý draft/history; `EngineeringProjectRepository` lưu ở IndexedDB riêng `mekoniq-robot-lab-engineering` version 1, không nâng version hoặc đổi stores của database legacy. Các stores mới: `projects`, `originals`, `content`, `metadata`. Migration validate trước transaction, rồi lưu original + draft + migration report + content hiện có + active-project pointer trong cùng transaction; original không bị ghi đè ở lần migrate sau. Reload chỉ chọn pointer đã commit. Quota/abort/blocked-open giữ dữ liệu đã lưu trước đó, báo unsaved rõ và cho xuất draft trong RAM. Undo/redo tạo revision mới và autosave theo cùng cơ chế, không sửa run/replay snapshot.

`EngineeringArchive` là định dạng trao đổi mới với `documentType:'engineering-project-archive'`, schemaVersion 1, project, components, projected assets, recipes, migration report/original (nếu có), blob manifest `{digest, file, mediaType, license, sizeBytes}[]` và `missingDigests`. Closure bao gồm model JSON được ModelRef tham chiếu, documents và meshes; không chỉ hình 3D. Payload blobs ở files tương đối theo digest; JSON metadata tối đa 2 MiB, tổng decoded blobs tối đa 200 MiB. Import kiểm schema/hash/license/size/path, không fetch mạng hoặc nhận executable. Draft thiếu blob vẫn xuất được với missingDigests; nếu có đủ closure phải roundtrip độc lập máy nguồn. Digest khai báo có file nhưng sai hash bị reject trước transaction. Closure thiếu chỉ được mở draft, không chạy. Bản export không chứa session/proof/credentials/controller endpoints. Gói project này khác native runtime distribution ở D03; import project không cấp quyền dùng server bundle cho đến compile hoặc reclaim hợp lệ.

### 5.2. Candidate và các công cụ thiết kế hiện có

Giữ `buildBundle(LabProject)` và candidate v1 cho legacy. Engineering dùng schema mới `EngineeringCandidate`: `documentType:'engineering-candidate'`, schemaVersion 1, status `'draft'`, hardwareValidated `false`, controlAuthority `false`, project snapshot/projectDigest, nullable assemblyDigest/bundleDigest, problems và evidenceRefs `{runId, reportDigest, projectDigest, bundleDigest}[]`. Snapshot/hash phải khớp thiết kế đang xuất; evidence khác project/bundle được đưa vào `historicalEvidenceRefs` (cùng shape thêm `reason:string`), không làm tăng readiness của candidate. Receipt null hoặc blocked vẫn xuất candidate với output digests null và blocker rõ; receipt compiled phải khớp projectDigest trước khi dùng. Không ép assembly thương mại thành `RobotDesign` service/valetudo hoặc gắn report S01 cũ vào candidate mới. Allowlist export và checksum vẫn bắt buộc; không mang command queue, quyền điều khiển hoặc secrets.

Giữ cấu hình khay/pin/sensor/payload, sơ đồ kết nối, BOM và ước tính energy/drive/stability cho legacy, cả khi runtime vắng mặt. Engineering lấy các inputs tương ứng từ assembly/model có provenance; thiếu dữ liệu hiển thị unavailable/missing, không dùng giá trị preset cũ. Thêm adapter cho estimates thay vì bỏ panel. [NR01–NR03/NR10–NR12](compatibility.md) quy định browser journeys phải còn dùng được.

## 6. Sổ quyết định linh kiện

| Quyết định mở | Cách đóng trong plan | Gate bị chặn nếu chưa đóng |
|---|---|---|
| Exact SKU motor/gear/driver/pin và đường torque-speed | A02 tạo selection worksheet từ tải/đường kính bánh/tốc độ; model giả định được ghi rõ; đo/nguồn hãng được pin ở D04 | G3 và procurement; G1 chỉ được chạy với model giả định có nhãn |
| Model arm/tool chính xác và quyền phân phối mesh | A02 pin vendor commit/license; C01 thử import và controller interfaces trên Linux | G1 arm/G2 nếu chưa import được; không chuyển PUMA ngầm |
| Má kẹp, cup geometry/friction/compliance | C02 dùng cup/jaw fixture versioned, contact tests; D04 đo với vật mẫu | G2 nếu thiếu contact model; G3 nếu chưa đo |
| Máy pha và giao thức brew/cancel/status | C03 dùng process model; D04 ghi interface matrix từ tài liệu hãng/bench được cấp quyền | Hardware integration, không chặn process simulation có nhãn |
| ARM64 package/engine khả dụng và headroom host | B01 inventory/preflight/smoke thực; thiếu thì dùng Linux amd64 profile riêng khi có máy | Native gate trên target chưa được kiểm |

Không cần người dùng quyết định tất cả linh kiện để bắt đầu G0/G1. Việc mua, đo phần cứng và hardware integration không thuộc quyền thực thi của bộ plan phần mềm này.
