# Contracts, đo lường và bằng chứng cho R5

**Trạng thái:** tài liệu thiết kế, chưa có schema hay code nào của R5 tồn tại. Khi triển khai, JSON Schema và code đã version là authority cho tên và shape thực tế; đoạn TypeScript dưới đây mô tả ý định, không phải API đang có. Không sửa generated types hoặc file sync của Lab bằng tay.

## 1. Identity và tương thích

Quy tắc R2b/R4 giữ nguyên: JSON Schema draft-07 trong `source/packages/contracts/schemas/` là authority; `scripts/generate-contracts.mjs` sinh type; Lab lấy qua sync. Object đóng, mảng có giới hạn, số hữu hạn. Digest của tài liệu là SHA-256 của canonical JSON (RFC 8785) bỏ chính trường digest; hash file là hash byte.

Mọi thứ R5 thêm đều **tùy chọn và cộng thêm**:

- Sáu **file schema mới**. Không sửa năm file bị đóng băng theo hash (`engineering-component`, `lab-project-v2`, `lab-fault-schedule`, `arm-cell-scene-v1`, `arm-scene-3d-v1`); schema mới tham chiếu `Digest`, `SourceRef`, `Scalar` của `engineering-component.schema.json` bằng `$ref`.
- `catalog.json` giữ `schemaVersion: 1` và nhận thêm khóa tùy chọn `deviceProfiles`. Catalog không có khóa đó nạp y như trước.
- `EngineeringProject`, bundle engineering, `assemblyDigest`, scene digest, report và replay package của R2b/R4 giữ byte. Thiết kế điện tham chiếu project; project không biết tới thiết kế điện.
- Reader gặp report không có phần mới thì hiện "không có dữ liệu", không fail import và không điền số 0.

Thêm một file schema làm đổi `schemaHash` của runtime, `portableToolsDigest` và closure native. Runtime từ chối mọi client có `sourceCommit` hoặc `schemaHash` khác nó (`CONTRACT_MISMATCH`). Hệ quả vận hành, trong repo đã gộp: mỗi commit phía source đổi runtime, schema hay tool cần một commit `chore: pin source runtime <sha>` chỉ đụng `apps/lab`, trên **nhánh R5**; `main` giữ pin mà runtime Cloud Run đang phục vụ, và bản công khai chỉ nhận phần mới sau một lần deploy cả hai phía theo lệnh của người dùng. Trước lần đó các phần mới chạy trên runtime local.

Kết quả của `compileElectrical` chỉ dùng cộng, trừ, nhân, chia và so sánh trên số hữu hạn, không dùng hàm siêu việt. Vì vậy, khác với kết quả vật lý, **digest của bundle điện phải trùng giữa arm64 và x86-64**; CLD04 và CLD06 kiểm đúng điều đó. Kết quả của `stop-v1` và `vio-v1` là kết quả engine: chỉ tất định trong một phiên bản engine và một kiến trúc, so giữa hai kiến trúc theo kết quả và dung sai như R4.

Tham chiếu mới:

| Ref | Ở đâu | Quy tắc |
|---|---|---|
| `component {id, revision, digest}` | `DeviceProfileV1` | Linh kiện phải có trong catalog, đúng digest |
| `profile {id, revision, digest}` | `ElectricalDesignV1.devices[]` | Hồ sơ phải có trong catalog; `component.digest` của hồ sơ khớp instance nếu thiết bị có trong assembly |
| `safetyRequirementsRef`, `wiringPolicyRef` | `ElectricalDesignV1` | File nằm trong bundle admission; không nhận URL |
| `engine.ioModelRef` | `navigation-scene-v1` (engine `mujoco_3d`) | Chỉ cùng `driveModelRef`; thiếu drive → `IO_MODEL_REQUIRES_DRIVE` |
| `stopSchedule`, `ioFaultSchedule` | `lab-run-v2` (run request) | Chỉ cho run có drive; lịch đi trong request, không trong project |

## 2. Tài liệu mới

| Contract | File schema | Soạn hay suy ra | Nội dung đáng chú ý |
|---|---|---|---|
| `DeviceProfileV1` (gồm `IOPointV1`, `DriveCapabilityV1`, `SafetyClaim`) | `device-profile-v1.schema.json` | Soạn | Giắc, chân, điểm I/O, giao tiếp, khả năng drive, tài liệu; mọi giá trị có `SourceRef` |
| `ElectricalDesignV1`, `WiringPolicyV1` | `electrical-design-v1.schema.json` | Soạn | Thiết bị, trục, bus, nguồn, tín hiệu, chức năng dừng; chính sách tiết diện và màu |
| `SafetyRequirementsV1` | `safety-requirements-v1.schema.json` | Soạn (người chịu trách nhiệm an toàn) | Sổ yêu cầu; không phải logic chạy được |
| `ElectricalBundleV1` (gồm `IoAllocationV1`, `NetlistV1`, `CheckResult`, BOM mở rộng, `DriveModelDraft`) | `electrical-bundle-v1.schema.json` | Suy ra | Niêm phong; mang identity của mọi đầu vào |
| `HardwareCandidateV1`, `TcoComparisonV1` | `hardware-candidate-v1.schema.json` | Suy ra | Manifest của gói; ba hằng `draft`/`false`/`false` |
| `StopScheduleEntryV1`, `StopReceiptV1`, `StopReportV1`, `StopOracleV1`, `IoModelV1`, `IoPointSnapshotV1`, `IoFaultEntryV1`, `IoFaultOracleV1`, `IoFaultReportV1` | `stop-evidence-v1.schema.json` | Lịch: soạn. Còn lại: suy ra | Lịch dừng, biên nhận, báo cáo dừng; mô hình và stream I/O; lỗi I/O |

Schema bị mở rộng, chỉ thêm trường tùy chọn: `sim3d-worker-v1` (§4), `physics-evidence-v1` (bản ghi tick thêm `io`, ý định và biên nhận dừng và lỗi I/O), `navigation-scene-v1` (`engine.ioModelRef`), `lab-run-v2` (`stopSchedule`, `ioFaultSchedule`).

Năm file đầu vào `engFiles` của `generate-contracts.mjs` (sinh `generated/engineering.ts`); `stop-evidence-v1` vào `navFiles`. Validator runtime đăng ký schema theo tên file trong Ajv của module tương ứng.

```ts
// Dạng dữ liệu dự kiến; range, độ dài và quan hệ chéo do schema + semantic validator kiểm.
type PinRole = 'power'|'return'|'pe'|'di'|'do'|'ai'|'ao'|'bus'|'sto'|'brake'|'motor_phase'|'encoder'|'shield'|'nc';
type IoElectrical = 'pnp_sink_input'|'npn_source_input'|'dry_contact_input'|'pnp_source_output'|'npn_sink_output'|'relay_output'|'analog_voltage'|'analog_current';
type Protocol = 'canopen'|'modbus_rtu'|'ethercat_coe'|'usb'|'ethernet'|'uart';

interface DeviceDocument {id: string; kind: 'datasheet'|'manual'|'safety_manual'|'certificate'|'description_file'|'description_summary'|'drawing'|'quotation'|'vendor_page';
  title: string; revision: string; url: string; digest: Digest; license: string}
// claim: nguyên văn tài liệu. certificateDocumentId chỉ hợp lệ khi chứng chỉ nêu đúng mã model của hồ sơ (người nhập ghi models[], validator so với variant.orderCode).
interface SafetyClaim {function: 'sto'|'ss1'|'sbc'|'safe_input'; claim: string; documentId: string; locator: string;
  certificate: {documentId: string; body: string; number: string; models: string[]}|null}
interface IOPointV1 {
  pointId: string; direction: 'input'|'output';
  pin: string; commonPin: string|null;                 // 'CN2/3': giắc/chân
  electrical: {type: IoElectrical; voltageRangeV: [number, number]; maxCurrentA: Scalar|null};
  functions: string[]; defaultFunction: string; reassignable: boolean;   // 'general_purpose' = dùng chung
  assignmentPersistence: 'retained'|'volatile'|'fixed';                   // volatile: mất sau mỗi lần cấp nguồn
  busExposure: {kind: 'cyclic'|'acyclic'|'none'; object: string|null; bit: number|null; precondition: string|null; updatePeriodMs: Scalar|null};   // object: '60FDh:00'
  safety: SafetyClaim|null;
  source: SourceRef;
}
interface DriveCapabilityV1 {
  axes: 1|2; modes: ('csp'|'csv'|'cst'|'pp'|'pv'|'pt')[];                 // csv của R4 được đáp ứng bởi csv hoặc pv
  ratedCurrentA: Scalar; peakCurrentA: Scalar;
  profileAccelerationRadS2: Scalar|null;                                  // bắt buộc khi thiết bị chỉ có pv
  feedback: {kinds: string[]; countsPerRev: Scalar|null};
  watchdog: {kind: 'heartbeat'|'sync_timeout'|'modbus_timeout'|'none'; rangeMs: [number, number]|null; source: SourceRef};
  stop: {quickStop: boolean; quickStopOption: Scalar|null; faultReactionOption: Scalar|null;      // giá trị cấu hình, không phải "có hỗ trợ"
    torqueOff: SafetyClaim|null; torqueOffPointIds: string[]; monitorOutputPointId: string|null; brakeOutputPointId: string|null; source: SourceRef};
  faultMap: {vendorCode: string; neutral: 'COMMAND_TIMEOUT'|'FEEDBACK_LOSS'|'FOLLOWING_ERROR'|'OVERSPEED'|'EXTERNAL_TRIP'|'OTHER'; source: SourceRef}[];
}
interface DeviceProfileV1 {
  schemaVersion: 1; documentType: 'device-profile'; id: string; revision: number; digest: Digest;
  component: {id: string; revision: string; digest: Digest};
  variant: {orderCode: string|null; hardwareRevision: string|null; firmware: string|null};
  kind: 'servo_drive'|'motor'|'battery'|'compute'|'io_module'|'sensor'|'indicator'|'switch'|'safety_device'|'power_conversion'|'protection';
  documents: DeviceDocument[];
  connectors: {id: string; label: string; matingPart: string|null;
    pins: {pin: string; name: string; role: PinRole; portId: string|null; source: SourceRef}[]}[];
  ioPoints: IOPointV1[];
  interfaces: {id: string; portId: string; protocol: Protocol; profile: 'cia402'|null; descriptionDocumentId: string|null; source: SourceRef}[];
  drive: DriveCapabilityV1|null;
}

interface SignalV1 {
  id: string; label: string;
  role: 'bumper'|'cliff'|'dock_detect'|'cover_switch'|'estop_status'|'charger_present'|'lamp'|'buzzer'|'brake_release'|'aux_input'|'aux_output'|'safety';
  direction: 'input'|'output';
  field: {deviceId: string; pin: string; returnPin: string|null};
  electrical: {type: IoElectrical; nominalV: number; currentA: Scalar};
  consumer: 'controller'|'drive_local'|'safety_chain';
  maxLatencyMs: number|null; required: boolean;
  pinned: {deviceId: string; pointId: string}|null;
}
interface StopFunctionV1 {id: 'normal'|'protective'|'emergency'; trigger: {kind: 'operator'}|{kind: 'signal'; signalId: string};
  axes: string[]; finalState: 'hold'|'disabled'|'torque_off_coast'|'torque_off_brake'; requirementId: string|null}
interface ElectricalDesignV1 {
  schemaVersion: 1; documentType: 'electrical-design'; id: string; revision: number; digest: Digest;
  project: {id: string; revision: number};
  option: {id: string; label: string; rationale: string};
  devices: {id: string; profile: {id: string; revision: number; digest: Digest}; assemblyInstanceId: string|null}[];
  axes: {axisId: string; driveDeviceId: string; channel: number; motorDeviceId: string|null}[];
  buses: {id: string; protocol: Protocol; controllerDeviceId: string; cycleMs: Scalar;
    members: {deviceId: string; interfaceId: string; address: number|null}[]}[];
  power: {railId: string; nominalV: number; source: {deviceId: string; pin: string; returnPin: string};
    feeds: {id: string; to: {deviceId: string; pin: string; returnPin: string}; protectionDeviceId: string|null; lengthM: Scalar|null}[]}[];
  signals: SignalV1[];
  stopFunctions: StopFunctionV1[];
  safetyRequirementsRef: DocumentRef|null; wiringPolicyRef: DocumentRef;
}

interface CheckResult {ruleId: string; level: 'blocking'|'warning'|'unverified'; path: string; detail: string; sources: SourceRef[]}
interface IoAllocationV1 {
  assigned: {signalId: string; deviceId: string; pointId: string; busId: string|null; exposure: 'cyclic'|'acyclic'|'local'; pinned: boolean}[];
  unassigned: {signalId: string; reasons: {code: string; candidates: number}[]}[];
  spare: {deviceId: string; pointId: string}[];
  reserved: {deviceId: string; pointId: string; function: string}[];
}
interface NetlistV1 {
  nets: {id: string; kind: 'power'|'return'|'bus'|'signal'|'axis'|'safety'; nodes: {deviceId: string; pin: string}[]; reviewRequired: boolean}[];
  wires: {id: string; netId: string; from: {deviceId: string; pin: string}; to: {deviceId: string; pin: string};
    csaMm2: Scalar; colour: string; lengthM: Scalar|null; currentA: Scalar|null}[];
  cables: {id: string; kind: 'motor'|'encoder'|'bus'|'usb'|'ethernet'; from: string; to: string; part: string|null}[];
}
interface ElectricalBundleV1 {
  schemaVersion: 1; documentType: 'electrical-bundle'; digest: Digest; state: 'compiled'|'blocked';
  inputs: {project: {id: string; revision: number; digest: Digest}; assemblyDigest: Digest; design: {id: string; revision: number; digest: Digest};
    profiles: {id: string; revision: number; digest: Digest; evidenceLevel: 'candidate'|'documented'}[];
    safetyRequirementsDigest: Digest|null; wiringPolicyDigest: Digest; compilerVersion: 'electrical-compiler/1'; schemaHash: string};
  allocation: IoAllocationV1; netlist: NetlistV1; checks: CheckResult[]; bom: Bom;   // Bom: kiểu sẵn có, requiredAccessories được điền
  driveModelDraft: DriveModelV1|null;                 // null khi state = 'blocked'
  hardwareValidated: false; controlAuthority: false;
}
```

Tách ba lớp là chủ ý. `DeviceProfileV1` nói về **thiết bị** và chỉ đổi khi có tài liệu tốt hơn. `ElectricalDesignV1` là **lựa chọn** của người thiết kế. `ElectricalBundleV1` là **hệ quả** tính được. Trộn lớp một với lớp hai sẽ cho phép "sửa" thông số thiết bị cho vừa thiết kế; trộn lớp hai với lớp ba sẽ để một bản vẽ sửa tay trở thành sự thật.

Không có trường nào nhận mức bằng chứng, mức an toàn hay trạng thái "đã kiểm": `evidenceLevel` chỉ xuất hiện ở bundle, do compiler tính.

## 3. Admission và mã từ chối

Thứ tự kiểm của `compileElectrical`, cố định và là một phần của hợp đồng:

1. Shape của thiết kế, chính sách và sổ yêu cầu (schema).
2. Catalog: hồ sơ tồn tại, đúng digest, khớp linh kiện; tài liệu và nguồn dẫn được.
3. Project: `resolveAssembly` hiện có phải đạt; `assemblyInstanceId` tồn tại; mọi trục có drive của project được ánh xạ.
4. Bus, nguồn, chân.
5. Phân bổ I/O.
6. Netlist, tiết diện, quy tắc điện.
7. BOM mở rộng; drive model nháp.

Lỗi ở bước 1–3 là **từ chối**: không có bundle, HTTP 400 hoặc 409 theo mẫu của `EngineeringError`. Từ bước 4 trở đi, vấn đề là **mục kiểm** trong bundle; có mục `blocking` thì `state:'blocked'`.

| Mã từ chối | Nghĩa |
|---|---|
| `INVALID_ELECTRICAL_DESIGN` | Sai schema |
| `ELECTRICAL_PROJECT_MISMATCH` | Thiết kế dành cho project khác, hoặc bundle engineering chưa `compiled` |
| `DEVICE_PROFILE_UNAVAILABLE`, `DEVICE_PROFILE_DIGEST_MISMATCH` | Hồ sơ không có trong catalog hoặc lệch digest |
| `PROVENANCE_UNRESOLVED`, `BLOB_UNAVAILABLE`, `BLOB_HASH_MISMATCH` | Như catalog hiện tại, áp dụng cho hồ sơ |
| `SAFETY_CLAIM_UNSUPPORTED` | Tuyên bố an toàn không dẫn tới tài liệu loại `safety_manual` hoặc `manual`; hoặc khai chứng chỉ mà danh sách model của chứng chỉ không chứa mã đặt hàng của hồ sơ |
| `BUS_EXPOSURE_CONTRADICTS_DESCRIPTION`, `MODE_CONTRADICTS_DESCRIPTION`, `OBJECT_UNKNOWN` | Hồ sơ mâu thuẫn với bản tóm tắt file mô tả (EDS/ESI) đã ghim |
| `ELECTRICAL_TOO_LARGE` | Vượt giới hạn: 64 thiết bị, 128 tín hiệu, 512 dây |

Route mới theo mẫu engineering hiện có, cùng quy tắc phiên, CSRF và quyền đọc theo bundle:

| Route | Vào | Ra |
|---|---|---|
| `POST /lab/v2/engineering/electrical` | `{ref: EngineeringRef, design: ElectricalDesignV1}` | Biên nhận `{state, digest, problems}`; bundle đọc qua route blob sẵn có |
| `POST /lab/v2/engineering/electrical/compare` | `{digests: string[]}`, 2–4 bundle của cùng phiên và cùng project | `TcoComparisonV1` |
| `GET /lab/v2/engineering/electrical/<digest>/package` | — | Gói ứng viên; 409 khi bundle `blocked` |

Health quảng bá năng lực `electrical_bundle_v1`; client gặp runtime không có năng lực này thì không gọi ba route trên. CLI `node scripts/lab-hardware.mjs check|compile|docs|package|compare` làm đúng các việc đó không cần gateway.

## 4. Wire: dừng và I/O trong một tick

`mekoniq-sim3d/1` giữ envelope và ops. `step.payload` thêm `stopInjections` và `ioFaultInjections` tùy chọn; snapshot thêm `io`, `stopReceipts`, `ioFaultReceipts`.

```ts
interface StopScheduleEntryV1 {id: string; function: 'normal'|'protective'|'emergency'; trigger: {kind: 'elapsed_sim_ms'; value: number}}
interface StopInjection {entryId: string; function: 'emergency'; axes: string[]}        // chỉ dừng khẩn đi tới worker
interface StopReceiptV1 {entryId: string; function: 'normal'|'protective'|'emergency'; appliedBy: 'controller'|'worker';
  appliedTick: number; runId: string; bootId: string; sceneDigest: string; requestDigest: string}
interface IoModelV1 {documentType: 'io-model'; id: string; revision: number; digest: Digest; calibration: 'not_calibrated';
  points: {pointId: string; role: 'bumper'|'estop_status'; exposure: 'cyclic'|'acyclic'; pollEveryTicks: number; debounceSubsteps: number}[];
  sources: {debounce: SourceRef; exposure: SourceRef}}
interface IoPointSnapshotV1 {pointId: string; value: boolean|null; valid: boolean; sampleTick: number;   // thứ controller nhận
  actual: boolean}                                                                                      // trạng thái thật: chỉ cho evidence
```

Quy tắc:

- Scene có `ioModelRef`: mỗi snapshot phải có `io` cho mọi điểm. Scene không có: `io` vắng mặt và mọi lịch I/O bị từ chối.
- `actual` không bao giờ tới controller. Runner tách hai phần ngay khi nhận ACK, cùng cách tách `DriveAxisSnapshot` của R4.
- Thứ tự trong một substep, thêm vào thứ tự R4: (0) áp dụng dừng khẩn đang hẹn cho tick này lên mọi trục của chuỗi, trước kênh lệnh; (1)–(5) như R4; (6) lấy mẫu điểm I/O sau `mj_step`, lọc rung, áp lỗi kẹt.
- Dừng khẩn dùng cùng mẫu biên nhận với lỗi: ý định do Source ghi trước, biên nhận do worker trả, reader đối chiếu độc lập. `appliedTick` theo công thức đã chốt ở R4: `ceil(x/20)+1`.
- Lịch không phải bằng chứng đã áp dụng. Mục không có biên nhận là `not_fired`.

## 5. Định nghĩa metric dừng

Mọi ngưỡng nằm trong `stop-policy-v1.json` của fixture `stop-v1`, là chính sách thử nghiệm, khóa trước campaign.

| Metric | Công thức | `unavailable` khi |
|---|---|---|
| `stopTimeMs` | `(restTick − appliedTick) × 20`; `restTick` là tick đầu của chuỗi `restTicks` tick liên tiếp có tốc độ thân xe dưới `restSpeedMps` | Không có `restTick` trong `observeTicks` (`NOT_AT_REST`) |
| `stopDistanceM` | Tổng quãng đường thân xe trên mặt phẳng từ `appliedTick` tới `restTick` | `NOT_AT_REST` |
| `peakDecelerationMps2` | Giá trị âm lớn nhất của đạo hàm tốc độ thân xe, trung bình trượt `decelWindowTicks` | Ít mẫu hơn cửa sổ |
| `torqueZeroTick` | Tick đầu tiên từ `appliedTick` mà `torqueNm` thật của mọi trục thuộc chuỗi bằng 0 | Không có stream `drives`; không phải `emergency` (`NOT_APPLICABLE`) |
| `cupMaxSlipMm`, `cupTipped` | Metric khay của R4 trên cửa sổ `[appliedTick, restTick + restTicks]` | Run không có khay |
| `postStopDriftMm` | Dịch chuyển thân xe trong `driftTicks` tick sau `restTick` | Run kết thúc trước đó |
| `wheelSlip` | Có substep mà tốc độ dài của vành bánh lệch tốc độ thân xe quá `slipToleranceMps` | Không có vận tốc bánh thật |

Giá trị khởi điểm, tất cả `assumed` và khóa sau spike: `restSpeedMps` 0,01; `restTicks` 25; `observeTicks` 500; `decelWindowTicks` 5; `driftTicks` 100; `slipToleranceMps` 0,05.

## 6. Oracle và invariant

`StopOracleV1` và `IoFaultOracleV1` được commit **trước** campaign và băm vào `campaign.json`. Ngưỡng không được nới sau khi thấy test fail.

Invariant của `StopReportV1` (đúng năm; kết quả `pass`, `violated`, `not_applicable`, `not_evidenced`):

| Id | Nghĩa |
|---|---|
| `TORQUE_ZERO_AT_EMERGENCY` | Với `emergency`: mô-men thật của mọi trục thuộc chuỗi bằng 0 từ `appliedTick` |
| `NO_MOTION_ACCEPTED_AFTER_STOP` | Sau `protective` và `emergency`: không lệnh chuyển động nào làm trục rời `disabled`/`fault` |
| `NO_AUTO_RESTART` | Run ở `needs_attention`; không `faultReset` tự phát; lệnh cũ không được tiếp tục |
| `RECEIPT_MATCHES_INTENT` | Mỗi mục có đúng một biên nhận khớp id, chức năng, tick, digest |
| `NO_FALSE_SERVE` | Mission không được ghi là phục vụ xong sau khi dừng |

`IoFaultOracleV1` khai cho từng lỗi: bên phải phát hiện (`controller`, `drive`, hoặc **không ai**) và hạn tính bằng tick. Verdict của báo cáo: `detected_in_time`, `detected_late`, `not_detected`, `not_fired`, và `not_detected_as_declared` cho ca mà oracle khai trước là không phát hiện được (R5-D29). Invariant của `IoFaultReportV1` (đúng bốn): `NO_FALSE_SERVE`, `TRUTH_NOT_IN_CONTROLLER`, `STALE_NOT_USED_AS_FRESH`, `RECEIPT_MATCHES_INTENT`.

Run stress bắt đúng lỗi là test đạt; report của run đó không được ghi là giao thành công (R4-D14 giữ nguyên).

## 7. Evidence, giới hạn và gói

- `io` là stream bền cộng thêm, cùng quy tắc coverage, quota và gap của `drives`. Thiếu hoặc hỏng thì metric phụ thuộc là `unavailable`, không tính.
- Bundle điện, tài liệu sinh ra và gói ứng viên **không** phải evidence mô phỏng. Chúng là tài liệu tất định; bằng chứng của chúng là digest và việc sinh lại cho cùng byte.
- Gói ứng viên: `manifest.json` (`documentType:'hardware-candidate'`, `status:'draft'`, `hardwareValidated:false`, `controlAuthority:false`, identity của bundle, danh sách file kèm sha256, `readiness[]`, `evidenceRefs[]` tới run mô phỏng) và `checksums.json`. Reader hash lại từng file và không tin trạng thái trong manifest.
- Tài liệu hãng có giấy phép `unreviewed` nằm trong catalog để truy nguồn nhưng **không** được chép vào gói ứng viên; gói chỉ mang id, revision, URL và digest.
- Giới hạn bundle điện: 2 MiB JSON. Giới hạn gói: 20 MiB.

## 8. Case và gate

| Case | Bằng chứng tối thiểu | Gate |
|---|---|---|
| DEV01 | Schema và admission hồ sơ thiết bị; bộ âm; catalog không có `deviceProfiles` nạp y nguyên | G-DEV1 |
| DEV02 | Nguồn hãng không dẫn được, blob thiếu hoặc lệch hash, tuyên bố an toàn thiếu safety manual đều bị bắt | G-DEV1 |
| DEV03 | Bản tóm tắt EDS và ESI sinh tất định từ file đã ghim; hồ sơ mâu thuẫn với bản tóm tắt (lộ `cyclic` qua đối tượng không ánh xạ được, chế độ ngoài mặt nạ, đối tượng không tồn tại) bị bắt; file hỏng bị từ chối | G-DEV1 |
| DEV04 | Mức bằng chứng là hàm thuần: bảng chân trị đủ nhánh; schema không có trường nhận mức | G-DEV1 |
| DEV05 | Admission thiết kế điện; ba phương án Serve nạp và compile; project và bundle engineering cũ giữ byte | G-DEV1 |
| DEV06 | Drive model suy ra là revision mới; nguồn đúng theo nhóm; fixture R4 giữ byte; mức trưởng thành đổi đúng theo nguồn | G-DEV1 |
| IOA01 | Sáu điều kiện ứng viên; mỗi mã lý do có test | G-ELE1 |
| IOA02 | Hai lần compile trùng byte; đổi thứ tự khai báo không đổi kết quả | G-ELE1 |
| IOA03 | Phần ghim được giữ; ghim xung đột hoặc không hợp lệ bị bắt | G-ELE1 |
| IOA04 | Thiếu chân: bundle vẫn sinh, `blocked`, lý do đúng; phương án có module I/O thì hết thiếu | G-ELE1 |
| IOA05 | Tín hiệu `safety_chain` không bao giờ có trong `assigned` | G-ELE1 |
| NET01 | Net nguồn, bus, tín hiệu, trục suy đúng trên fixture; id dây ổn định giữa hai revision chỉ khác một tín hiệu | G-ELE1 |
| NET02 | Chân dùng hai lần, chân không tồn tại, bus sai giao thức, trùng địa chỉ | G-ELE1 |
| NET03 | Net an toàn: chỉ đầu mút do người viết, `reviewRequired`, không có dây | G-ELE1 |
| ERC01 | Điện áp, ngân sách dòng, bảo vệ thiếu và quá cỡ | G-ELE1 |
| ERC02 | Tiết diện và sụt áp theo chính sách; chính sách `assumed` lan nhãn tới từng dây | G-ELE1 |
| ERC03 | Danh sách "chưa kiểm" đủ: nguồn `assumed` đã dùng, firmware, ánh xạ bus, chiều dài, giá | G-ELE1 |
| ERC04 | Mỗi quy tắc có ca dương và ca âm; bundle `blocked` không có drive model nháp | G-ELE1 |
| SAF01 | Sổ yêu cầu: kiểm tham chiếu; trạng thái bằng chứng là hàm thuần | G-ELE1 |
| SAF02 | Không tài liệu sinh ra nào chứa câu khẳng định mức an toàn hay tuân thủ tiêu chuẩn | G-ELE1 |
| DOC01 | Bảy tài liệu sinh tất định theo byte và mang digest bundle | G-DOC1 |
| DOC02 | `docs --check` phát hiện file bị sửa tay | G-DOC1 |
| DOC03 | Gói ứng viên: manifest, checksums, ba hằng; đọc lại fail-closed; bundle `blocked` không sinh gói | G-DOC1 |
| DOC04 | Thiếu công cụ vẽ ngoài → `TOOL_NOT_INSTALLED`; không thay bằng hình khác | G-DOC1 |
| TCO01 | BOM mở rộng: phụ kiện suy đúng; thiếu giá không thành 0 | G-DOC1 |
| TCO02 | So ba phương án: "chưa so được" khi thiếu giá quyết định; nêu biến chi phối | G-DOC1 |
| STP01 | Admission lịch dừng; run không lịch giữ byte | G-STP1 |
| STP02 | Ánh xạ ba chức năng; compiler từ chối chức năng mà hồ sơ drive không hỗ trợ | G-STP1 |
| STP03 | Dừng khẩn trong lúc mất kênh lệnh vẫn ngắt mô-men đúng tick | G-STP1 |
| STP04 | Không tự khởi động lại; `needs_attention`; `faultReset` chỉ theo sườn | G-STP1 |
| STP05 | Metric đúng trên vector tham chiếu giải tích và trên engine; đủ lý do `unavailable` | G-STP1 |
| STP06 | Campaign `stop-v1` đủ run; nhóm lặp trùng bit; verifier dựng lại báo cáo từ artifact | G-STP1 |
| STP07 | Câu gợi ý chỉ từ cặp run khác đúng một input và metric available; ba ngôn ngữ; có giới hạn | G-STP1 |
| VIO01 | Điểm I/O: lọc rung, `cyclic` và `acyclic`, cờ `stale` | G-VIO1 |
| VIO02 | Controller không nhận `actual` (kiểu dữ liệu + test); phản ứng với bumper và với mẫu `stale` | G-VIO1 |
| VIO03 | Mỗi lỗi I/O có biên nhận đúng lớp; verdict khớp kỳ vọng khai trước, kể cả `not_detected_as_declared` | G-VIO1 |
| VIO04 | Campaign `vio-v1` đủ run trên `MJ-IO01` | G-VIO1 |
| DGN01 | Phần Điện trên runtime thật: chọn phương án → compile → ghim → kiểm tra → đấu dây → chi phí → xuất | G-DGN1 |
| DGN02 | Chọn thực thể bằng chuột và bằng bàn phím mở đúng panel | G-DGN1 |
| DGN03 | Chất lượng dữ liệu: `good`, `stale`, `unavailable`; run thiếu stream không hiện 0 và không tô xanh | G-DGN1 |
| DGN04 | Cảnh báo nhảy tới tick; đánh dấu trong 3D có viền và biểu tượng, không chỉ màu | G-DGN1 |
| WEB11 | Phần Điện không cần runtime: mở thiết kế và hồ sơ; mọi kết quả compile hiện "cần runtime" | G-WEB3 |
| WEB12 | VI/JA/EN, 390/1024/1440 px, axe serious/critical = 0, reduced motion cho mọi panel mới | G-WEB3 |
| WEB13 | Hai mẫu tĩnh (`hardware-candidate`, `stop-report`) mở offline, hash khớp manifest, ghi `not_calibrated` và `accepted:false` | G-WEB3 |
| REG06 | Mock/IR-SIM/R1/R1.1/R2a/R2b/R4 ghi lại ở tuple R5, golden đúng, artifact và pin được kiểm | G-REG6 |
| CLD04 | Image `linux/arm64` từ cây sạch: compile ba phương án cho digest **trùng** bản Mac; một run `stop-v1`; một run `vio-v1` (khi đợt tương ứng đã có). `docker diff` rỗng, không chạy root | G-CLOUD3 |
| CLD05 | Image `linux/amd64` dựng được từ cùng commit; test Python của tool root đạt trên host x86-64 native | G-CLOUD3 |
| CLD06 | Sau một lần deploy theo lệnh: health báo đúng commit và schema hash; trên Cloud Run, compile ba phương án cho digest trùng bản Mac và một run dừng hoàn tất; so với Mac theo kết quả và dung sai. Chưa có deploy → `not_run`, lý do `deploy_order_pending` | G-CLOUD3 |

Campaign tối thiểu:

- `stop-v1`: nhóm S1–S5 ở [spec R5-B §5.4](04-r5-stop-diagnostics-spec.md#54-campaign-stop-v1), tối thiểu 16 run.
- `vio-v1`: danh định 3 seed; `di-stuck-on` 2; `di-stuck-off` 3; `io-bus-loss` 2; tối thiểu 10 run.

Mỗi run có artifact riêng. Pass cả suite không thay cho artifact từng run.

Hai gate **không** thuộc R5 và luôn `blocked_external` trong record R5:

| Gate | Cần gì |
|---|---|
| G-BENCH1 | Thiết bị thật trên bàn thử cách ly: đúng drive, firmware, I/O, ánh xạ bus, encoder, hành vi lỗi; bản ghi đo có chữ ký |
| G-SAFE1 | Đánh giá rủi ro, thiết kế và thử nghiệm chức năng an toàn do người có chuyên môn thực hiện và ký |

Gate `tested` nghĩa là test đạt. Nó không nghĩa là cấu hình mua được, đấu được trên thiết bị thật, hay an toàn.

## 9. Qualification R5

Recorder thêm bảng release `r5` theo mẫu `scripts/record-sim-extension-r4.mjs` (bảng suite và gate, đọc lại toàn bộ thư mục, từ chối cây bẩn, pin lệch và bytecode dưới tool root). Record `documentType:'sim-extension-qualification'`, `accepted:false`, mapping case/suite/host/input/artifact tường minh. Guard đọc và hash lại artifact, không tin status trong manifest.

Chuỗi ghi: Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → **r5**, cùng commit source và cùng commit Lab và pin (tính theo đường dẫn trong repo đã gộp), mỗi bước exit 0, output ngoài repo, archive thô ngoài Git. Đây là một chuỗi đầy đủ, ghi một lần ở E21 (người dùng chốt ngày 25/11). REG06 cần các record trước ở đúng tuple.

Bàn giao từng phần được phép: R5.1 cần G-DEV1; R5.2 cần G-ELE1 và G-DOC1; R5.3 cần G-STP1; R5.3b cần G-VIO1; R5.4 cần G-DGN1 và G-WEB3; mỗi đợt cần thêm CLD04 cho phần của mình. Với bàn giao từng phần, regression nghĩa là: các suite tập trung của phần đã đổi, các test golden/hash của đường legacy, và guard của các record đang nằm trong cây vẫn đạt. Chuỗi recording đầy đủ chỉ ghi một lần, ở E21.

R5.1 và R5.2 không chạy mô phỏng nào. Bằng chứng của hai đợt đó là test hợp đồng, test hàm thuần và việc sinh lại cho cùng byte; không dựng campaign chỉ để bảng có thêm dòng.

Chỉ tuyên bố R5 đầy đủ khi có G-DEV1, G-ELE1, G-DOC1, G-STP1, G-VIO1, G-DGN1, G-WEB3, G-REG6 và G-CLOUD3. Nếu R5.3b bị cắt theo điều kiện dừng, G-VIO1 ghi `not_run` kèm lý do và R5 được tuyên bố là "R5 không có I/O ảo". Candidate tự động luôn `accepted:false`; chấp nhận chỉ nằm trong sidecar do người ký viết. CLD06 đi theo cách của CLD03: bằng chứng của mỗi lần deploy là một thư mục bổ sung dưới `evidence/cloud-run/`, guard `cloud-run` kiểm bản bổ sung gắn với đúng byte của record R5.
