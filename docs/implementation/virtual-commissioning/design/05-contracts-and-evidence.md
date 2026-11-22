# Contracts, đo lường và bằng chứng cho R4

**Trạng thái:** tài liệu thiết kế, chưa có schema hay code nào của R4 tồn tại. Khi triển khai, JSON Schema và code đã version là authority cho tên và shape thực tế; đoạn TypeScript dưới đây mô tả ý định, không phải API đang có. Không sửa generated types hoặc file sync của Lab bằng tay.

## 1. Identity và tương thích

Quy tắc R2b giữ nguyên: JSON Schema draft-07 trong `source/packages/contracts/schemas/` là authority; `scripts/generate-contracts.mjs` sinh type; Lab lấy qua sync. Object đóng, mảng có giới hạn, số hữu hạn, digest là SHA-256 của canonical JSON bỏ chính trường digest. Hash file là hash byte.

Mọi thứ R4 thêm đều **tùy chọn và cộng thêm**. Tài liệu, wire message, report, replay package của R2b vẫn hợp lệ và giữ byte. Reader gặp report không có phần mới thì hiện "không có dữ liệu", không fail import và không điền số 0.

Kết quả số chỉ tất định trong một phiên bản engine và một kiến trúc CPU. Mọi so sánh trùng bit và mọi hash của trace trong R4 chỉ có nghĩa giữa các run cùng build và cùng kiến trúc. Giữa máy phát triển (arm64) và Cloud Run (x86-64), reader so kết quả nghiệp vụ và metric trong dung sai khai trước, không so hash.

`hostArch` (`arm64` hoặc `x86_64`) là kiến trúc do worker báo trong identity của nó. Quy tắc ghi, người dùng chốt ngày 19/11 sau review V05:

- **Run có drive** (scene có `engine.driveModelRef`): `manifest.drive.hostArch` bắt buộc. Với run mobile, trường này còn nằm trong header được hash của digest evidence điều hướng (`inputs.engine.hostArch`).
- **Run không có drive:** công thức digest giữ nguyên như R2b, không có `hostArch`. Trường chỉ xuất hiện trong khối `engine` của evidence điều hướng, tùy chọn và không vào hash.
- **Campaign:** `campaign.json` ghi `hostArch` của máy ghi. Verifier báo issue khi một run có drive thiếu trường này, và không so trùng bit giữa hai run khác `hostArch`.

Evidence điều hướng của R2b vốn đã ghi kiến trúc của tiến trình runtime (`engine.platform`, `identity.arch`) và đưa nó cùng `sourceCommit` vào mọi digest, nên digest đó chưa bao giờ so được giữa hai commit hay hai kiến trúc, và không có golden digest nào được lưu. Evidence của cell thì chưa ghi kiến trúc ở đâu; với run cell, `manifest.drive.hostArch` là nơi duy nhất.

Scene tham chiếu input mới bằng ref `{id, revision, sha256, path}` tới file nằm trong bundle admission; không nhận URL:

| Ref | Ở đâu | Quy tắc |
|---|---|---|
| `engine.driveModelRef` + `engine.controlProfileRef` | `navigation-scene-v1`, `arm-cell-scene-v1`, `lab-world-scene-v1` | Có cả hai hoặc không có; thiếu một → `DRIVE_PROFILE_PAIR_REQUIRED` |
| `perceptionProfileRef`, `recoveryPolicyRef` | `arm-cell-scene-v1`, `lab-world-scene-v1` | Chế độ `fixed_program` không được có `perceptionProfileRef` |
| `trayPolicyRef` | `navigation-scene-v1` | Chỉ cho `MJ-TRAY01` |

Manifest của run ghi thêm: digest drive model và control profile, id/revision của từng controller, `testLevel`, hash lịch lỗi, digest oracle profile, digest perception profile và recovery policy, danh sách stream PRNG đã dùng. Scene digest bao gồm các ref mới, nên đổi profile là đổi scene digest và đổi run.

## 2. Tài liệu mới

| Contract | File schema | Nội dung đáng chú ý |
|---|---|---|
| `DriveModelV1` | `drive-model-v1.schema.json` | Mô hình **thiết bị**: mỗi trục có chế độ, đường mô-men hoặc effort, encoder, trễ lệnh/phản hồi, watchdog, hành vi khi tắt, nguồn từng nhóm tham số; tối đa 16 trục |
| `ControlProfileV1`, `TuningEnvelopeV1` | `control-profile-v1.schema.json` | **Thiết lập**: gain vòng lặp từng trục, giới hạn đã chọn (không vượt giới hạn thiết bị), tham số controller; gắn `plantModelDigest` và `driveModelDigest`. Envelope là biên do server giữ cho từng trường chỉnh được của từng trục |
| `DriveCommandV1`, `DriveFeedbackV1` | `drive-io-v1.schema.json` | Hợp đồng lệnh/phản hồi trung lập, dùng chung TS/Python và cho adapter sau này |
| `BenchRequestV1` | `bench-request-v1.schema.json` | Trục, tín hiệu thử trong danh mục đóng, bản nháp control profile |
| `DriveTickRecord`, `DriveTrace`, `TuningResultV1`, `FaultReportV1` | `control-evidence-v1.schema.json` | Evidence theo trục, trace 500 Hz của bench, kết quả chỉnh, báo cáo lỗi |
| `FaultScheduleEntry` | `lab-fault-schedule.schema.json` (cộng thêm) | Thêm `params` tùy chọn; mục cũ không đổi. Lịch lỗi drive đi trong run request (`driveFaultSchedule`), không trong project |
| `PerceptionProfileV1` | `perception-profile-v1.schema.json` | Mô hình sai số nhận thức, biên ở spec R4-B §5.2 |
| `RecoveryPolicyV1` | `recovery-policy-v1.schema.json` | Bảng quy tắc phục hồi có giới hạn; tối đa 8 quy tắc, mỗi quy tắc tối đa 3 lần |
| `BeliefRecord`, `GraspAttempt`, `RecoveryStep`, `PerceptionStudyV1` | `belief-evidence-v1.schema.json` | Stream belief, lượt gắp, bước phục hồi, kết quả study |
| `IdentificationPlanV1`, `CalibrationRecordV1` | `calibration-record-v1.schema.json` | Kế hoạch nhận dạng khai trước và bản ghi kết quả; dùng cùng `engineering-calibration.schema.json` hiện có |

Schema bị mở rộng: `sim3d-worker-v1` (§3, §4); `physics-evidence-v1` (bản ghi tick của run mobile thêm `drives` và biên nhận lỗi, tùy chọn); `world-evidence-v1` (lệnh và bản ghi của cell thêm `driveCommands`, `drives`, ý định và biên nhận lỗi, tùy chọn); ba schema scene (ref ở §1); `engineering-project` (`driveExperimentId` cho run mobile, đọc lúc compile); `lab-run-v2` (`driveExperimentId` cho cell, `graspMode`, `bench`, `driveFaultSchedule`); `web-replay-package-v1` (ref tới dữ liệu mới của run một world).

Tách `DriveModelV1` khỏi `ControlProfileV1` là chủ ý. Cái thứ nhất mô tả thiết bị và chỉ đổi khi có nguồn tốt hơn (datasheet, số đo): đó là đối tượng của hiệu chuẩn. Cái thứ hai là lựa chọn của người chỉnh: đó là đối tượng của bàn chỉnh. Trộn hai thứ sẽ cho phép "chỉnh" một thông số thiết bị cho đẹp.

```ts
// Dạng dữ liệu dự kiến; range, độ dài và quan hệ chéo do schema + semantic validator kiểm.
type DriveMode = 'csp' | 'csv';
type DriveState = 'disabled' | 'ready' | 'enabled' | 'quick_stop' | 'fault';
type DriveFault = 'COMMAND_TIMEOUT' | 'FEEDBACK_LOSS' | 'FOLLOWING_ERROR' | 'OVERSPEED' | 'EXTERNAL_TRIP';

interface AxisDriveModel {
  axisId: string;                      // 'amr-1/wheel-left', 'arm-1/J3', 'arm-1/gripper'
  mode: DriveMode;
  torque: {kind: 'envelope_ref'; scale: number} | {kind: 'effort'; limitNm: number};  // envelope_ref: driveCurve + brakeTorqueNm của physics profile hiện có, nhân scale trong (0, 1]
  velocityLimitRadS: number;
  encoder: {countsPerRev: number | null; velocityWindowSubsteps: number};  // null: không lượng tử
  feedbackDelaySubsteps: number;       // 0..100
  feedbackLossSubsteps: number;        // drive chốt FEEDBACK_LOSS sau bấy nhiêu substep phản hồi không hợp lệ
  commandDelaySubsteps: number;        // 0..100
  commandInterpolation: 'hold' | 'linear';
  watchdogTicks: number | null;        // null: không giám sát lệnh
  enableDelaySubsteps: number;
  quickStopSubsteps: number;
  onDisable: 'coast' | 'brake';
  brakeTorqueNm: number | null;        // bắt buộc khi onDisable = 'brake'
  followingError: {limitRad: number; substeps: number} | null;  // chỉ cho csp
}
interface AxisControl {
  axisId: string;
  loop: {kp: number; ki: number; kd: number; integralLimit: number | null; slewLimit: number | null};
  // csp: kp [N·m/rad], kd là gain phản hồi vận tốc [N·m·s/rad]. csv: kp [N·m·s/rad], kd phải bằng 0.
  // ki = 0 và slewLimit = null: giữ actuator position/velocity của R2b; ngược lại dùng actuator pid của engine. ki > 0 đòi integralLimit.
  accelerationLimit: number | null;    // rad/s² của lệnh; null: không giới hạn ở drive
}
interface DriveCommandV1 {axisId: string; seq: number; mode: DriveMode; target: number;
  enable: boolean; quickStop: boolean; faultReset: boolean}
interface DriveFeedbackV1 {axisId: string; state: DriveState; fault: DriveFault | null; commandSeq: number;
  positionRad: number | null; velocityRadS: number | null; torqueNm: number | null; tick: number}
```

`DriveFeedbackV1` chỉ chứa giá trị **đo được**. Vị trí/vận tốc `null` khi phản hồi không hợp lệ (mất encoder); không điền giá trị cuối kèm cờ ẩn.

## 3. Wire: một tick có drive

`mekoniq-sim3d/1` giữ envelope và ops. `step.payload` thêm `driveCommands` tùy chọn; snapshot thêm `drives` và, chỉ ở bench, `driveTrace`.

```ts
interface DriveAxisSnapshot extends DriveFeedbackV1 {
  targetApplied: number;               // lệnh sau trễ/nội suy tại substep cuối
  actualPositionRad: number;           // trạng thái thật: chỉ cho evidence
  actualVelocityRadS: number;
  saturatedSubsteps: number;           // 0..substeps
  followingErrorRad: number | null;
}
interface DriveTrace {axisId: string; dtS: number;
  samples: {target: number; actual: number; feedback: number | null; torqueNm: number}[]}  // đúng substeps mẫu mỗi tick
```

Quy tắc phía worker:

- Scene có drive: mỗi `step` phải có `driveCommands` cho **mọi** trục; `velocities`, `jointTargets`, `gripperTargets` phải rỗng. Scene không có drive: `driveCommands` bị từ chối. Trộn hai đường trong một run là `INVALID_REQUEST`.
- `seq` của mỗi trục không giảm. `seq` bằng lần trước nghĩa là không có lệnh mới và được tính vào watchdog. `seq` giảm → `DRIVE_COMMAND_SEQ_INVALID`.
- Các từ chối giữ nguyên tick và engine: `DRIVE_COMMAND_REQUIRED`, `DRIVE_AXIS_UNKNOWN`, `DRIVE_MODE_MISMATCH`, `DRIVE_TARGET_OUT_OF_RANGE`, `DRIVE_COMMAND_SEQ_INVALID`. Kiểm hết trước khi đổi bất kỳ trạng thái nào.

Thứ tự trong một substep, cố định và là một phần của hợp đồng:

1. Kênh lệnh: lấy lệnh áp dụng cho substep này (hàng đợi trễ, nội suy trong tick).
2. Máy trạng thái: trình tự enable, watchdog, kiểm lỗi của drive (quá tốc, sai số bám, mất phản hồi).
3. Đặt `ctrl` và giới hạn lực cho actuator của từng trục; trục không `enabled` thì tắt actuator và thả hoặc phanh.
4. `mj_step`; thu tiếp xúc.
5. Kênh phản hồi: lấy mẫu trạng thái sau bước, lượng tử, đưa qua hàng đợi trễ, tính vận tốc trên cửa sổ; ghi mẫu trace nếu là bench.

Vòng lặp servo nằm trong actuator của engine và dùng trạng thái thật ([R4-A §5.2](02-r4-control-chain-spec.md#52-cơ-chế-số)).

ACK của tick *t* mang phản hồi đo tại cuối tick *t*. Controller dùng nó để tính lệnh cho tick *t+1*. Trễ một tick này là thuộc tính của vòng điều khiển 50 Hz, có ở cả đường R2b.

`actual*` trong snapshot không bao giờ được chuyển cho `MotionController.step`. Runner tách hai phần ngay khi nhận ACK: `DriveFeedbackV1[]` cho controller, toàn bộ `DriveAxisSnapshot[]` cho recorder.

## 4. Wire và biên nhận của lỗi

Cùng mẫu với `worldPerturbations` của R2b: ý định do Source ghi trước, biên nhận do nơi thực hiện trả về, reader đối chiếu độc lập.

```ts
interface FaultInjection {entryId: string; faultId: string; targetId: string;
  params: Record<string, number>; phase: 'start' | 'end'}
interface FaultReceipt {entryId: string; faultId: string; targetId: string; params: Record<string, number>; phase: 'start' | 'end';
  appliedTick: number; runId: string; bootId: string; sceneDigest: string; requestDigest: string}
```

**Chốt ở V08 (21/11):** biên nhận lặp lại `params` đã áp dụng để reader so với ý định; `appliedTick` là tick của snapshot đầu tiên chịu lỗi: lỗi hẹn `elapsed_sim_ms = x` bắt đầu ở tick `ceil(x/20)+1`, cửa sổ đóng ở `+ceil(durationMs/20)` (tick đóng nằm ngoài cửa sổ); thứ tự trong một tick: `end` trước `start`. `requestDigest` là SHA-256 RFC 8785 của đúng payload `step` worker nhận, runtime dùng cùng digest cho biên nhận của chính nó. Chồng đồng ý: `faultInjections` (worker áp dụng) trong payload `step`, `faultReceipts` trong snapshot; ở cell, `command.faultInjections` giữ **mọi** ý định của tick và `command.faultReceipts` giữ biên nhận do runtime áp dụng; ở run mobile, bản ghi tick physics có `faultIntents`, `faultReceipts`, `sensorTransforms` (scan sau nhiễu, bản gốc nằm trong evidence điều hướng). Run không có lịch giữ nguyên byte.

- Lỗi do worker thực hiện (`encoder-dropout`, `motor-weak`, `drive-trip`, `command-delay`, `grip-weak`, `drive-reset`) đi trong `step.faultInjections`; biên nhận trong `snapshot.faultReceipts`.
- Lỗi do runtime TS thực hiện (`command-loss`, `lidar-noise`) có biên nhận do runner ghi vào evidence cùng tick, cùng shape, `bootId` là của run.
- Lịch không phải bằng chứng đã áp dụng. Mục không có biên nhận `start` là `not_fired`. Biên nhận không khớp ý định (id, đối tượng, tham số, tick, digest) → `FAULT_EVIDENCE_INVALID`, evidence incomplete.
- Tham số được kiểm theo biên của danh mục **ở server** trước khi tạo run; worker kiểm lại biên trước khi áp dụng.

## 5. Định nghĩa metric điều khiển

Tính trên trace 500 Hz đã đọc lại (bench) hoặc trên `drives` mỗi tick (CIL). Ký hiệu: lệnh *r(t)*, trạng thái thật *y(t)*, bước nhảy biên độ *A* từ *y₀* tại *t₀*.

| Metric | Định nghĩa | Không tính được khi |
|---|---|---|
| Giá trị cuối | Trung bình *y* trên cửa sổ cuối `finalWindowS` | Độ lệch chuẩn trong cửa sổ cuối vượt `settleBand·|A|` → `NOT_SETTLED` |
| Rise time | Từ lần đầu *y* qua *y₀+0,1A* tới lần đầu qua *y₀+0,9A* | Không đạt 0,9A → `TARGET_NOT_REACHED` |
| Overshoot | `max(0, (y_đỉnh − (y₀+A))·sign(A)) / |A|`, tính bằng % | Như trên |
| Settling time | *T* nhỏ nhất để `|y − (y₀+A)| ≤ 0,02·|A|` với mọi *t ≥ t₀+T* trong bản ghi, và còn ít nhất `holdWindowS` sau *T* | `NOT_SETTLED` |
| Sai số xác lập | `(y₀+A) − giá trị cuối` | `NOT_SETTLED` |
| RMS sai số bám | `sqrt(mean((r−y)²))` trên cửa sổ caller đã khóa | Cửa sổ có gap → `TRACE_GAP` |
| Mô-men đỉnh | `max|τ|` trên cửa sổ | `TRACE_GAP` |
| Tỷ lệ bão hòa | Số substep bão hòa / số substep trong cửa sổ | `TRACE_GAP` |
| Thiếu hụt vận tốc (CIL) | Trung bình `|r| − |y|` trên các đoạn lệnh không đổi sau khi hết đoạn tăng tốc | Không có đoạn đủ dài → `NO_CRUISE_WINDOW` |
| Độ trễ phát hiện lỗi | Tick phát hiện − tick áp dụng theo biên nhận | Không phát hiện → `not_detected`, không phải số |

Quy ước:

- Metric đáp ứng tính trên **trạng thái thật** và ghi rõ như vậy; bản tính trên phản hồi encoder là tùy chọn hiển thị, có nhãn riêng. Biên độ nhỏ hơn 10 bước lượng tử thì bản tính trên phản hồi trả `AMPLITUDE_BELOW_RESOLUTION`.
- Cùng union `available/unavailable + reason` như `PhysicsMetric`. Không lọc bỏ mẫu lỗi rồi tính trên phần còn lại.
- `finalWindowS`, `settleBand`, `holdWindowS` và ngưỡng "dao động duy trì" nằm trong `control-oracle-v1`, khóa **trước** campaign. Dao động duy trì: biên độ đỉnh–đỉnh của sai số bám ở cửa sổ cuối không nhỏ hơn 0,9 lần cửa sổ liền trước và vượt ngưỡng tuyệt đối của profile.
- Cửa sổ do caller khóa trước từ tín hiệu thử; không tìm đoạn đẹp nhất.

```ts
export type ControlMetric =
  | {available: true; value: number; unit: string; samples: number; basis: 'actual' | 'feedback'}
  | {available: false; value: null; unit: string; reason: string};
export function stepResponseMetrics(trace: DriveTrace, signal: {t0S: number; y0: number; amplitude: number},
  policy: {finalWindowS: number; settleBand: number; holdWindowS: number}): Record<string, ControlMetric>;
```

Gợi ý gain khởi điểm là hàm thuần của quán tính hiệu dụng *J*, băng thông *ωₙ* và hệ số cản *ζ* trong tập đăng ký (sửa theo quyết định D4, người dùng duyệt 20/11, [plan 01](plans/01-drive-and-cil.md#quyết-định-chốt-ở-đầu-v06-người-dùng-duyệt-cả-bốn-ngày-2011)): vòng vị trí `kp = J·ωₙ²`, `kd = 2·ζ·J·ωₙ`, `ki = 0`; vòng vận tốc là PI có đặc tính `J·s² + kp·s + ki`, nên `kp = 2·ζ·J·ωₙ`, `ki = J·ωₙ²`, `integralLimit` bằng trần mô-men của trục trong envelope. *J* của khớp là phần tử đường chéo của ma trận quán tính tại tư thế bench; *J* của bánh là `I_bánh + m·r²/2` (đi thẳng, mỗi bánh gánh nửa khối lượng), vì đường chéo không chứa khối lượng thân xe nối qua tiếp xúc; nhãn `assumed`. Kết quả bị kẹp vào tuning envelope và ghi rõ đã kẹp.

## 6. Belief, nhận thức và phục hồi

```ts
interface BeliefObject {
  objectId: string; kind: 'cup'; frameId: string;
  positionM: [number, number, number];
  sigmaM: [number, number, number];          // độ bất định khai báo của profile, không phải ước lượng thống kê lúc chạy
  observedTick: number; publishedTick: number; ageTicks: number;
  source: 'ground_truth' | 'pose_estimator_sim';
  valid: boolean; reason?: string;
}
interface BeliefRecord {tick: number; belief: BeliefObject | null; dropped: boolean;
  truthAtObservedTick: [number, number, number];   // chỉ để đánh giá
  errorM: number | null}
interface GraspAttempt {attemptId: string; cupId: string; index: number; decidedTick: number;
  mode: 'fixed_program' | 'belief_ground_truth' | 'belief_estimated';
  beliefUsed: BeliefObject | null; beliefErrorAtCommitM: number | null;
  gates: {belief: string; region: string; ik: string; sweep: string};   // 'pass' hoặc mã từ chối
  ikResidual: {positionM: number; orientationRad: number; condition: number}[];
  outcome: 'lifted' | 'grip_not_established' | 'cup_dropped' | 'refused' | 'unknown'}
interface RecoveryStep {stepId: string; attemptId: string; rule: string; action: string;
  commandId: string; recordedTick: number; completedTick: number | null; result: string}
```

Tái lập ngẫu nhiên: stream `perception:<objectId>` của PRNG có tên hiện có. Mỗi lần cập nhật **luôn** tiêu ba số đều `u₀, u₁, u₂` theo thứ tự đó, kể cả khi mẫu bị bỏ: `u₀` quyết định mất mẫu (`u₀ < dropoutProbability`); nhiễu x là `σₓ·sqrt(−2·ln u₁)·cos(2π·u₂)`, nhiễu y là `σᵧ·sqrt(−2·ln u₁)·sin(2π·u₂)`, với `u₁` lấy trong (0, 1]. Quy tắc tiêu số cố định giữ cho một lần mất mẫu không làm lệch các ước lượng sau.

`truthAtObservedTick` và `errorM` tồn tại để chấm điểm. Chúng không nằm trong `BeliefView` mà mã quyết định nhận được.

`RecoveryPolicyV1` là danh sách quy tắc `{on, requires[], steps[], maxAttempts}` với `on`, `requires` và `steps` lấy từ danh mục đóng. Quy tắc tham chiếu điều kiện hoặc bước ngoài danh mục bị từ chối ở admission.

## 7. Evidence, giới hạn và replay

Giữ nguyên các stream R2b. Thêm:

| Stream | Ghi khi | Giới hạn |
|---|---|---|
| `drives` trong bản ghi tick | Mỗi tick đã ACK của run có drive: recorder `physics` với run mobile, recorder `world-evidence` với cell | Nằm trong quota hiện có của recorder đó |
| `drive-trace` | Chỉ bench, bằng recorder riêng của bench runner | 5.000 mẫu/trục, 2 trục, 16 MiB nén |
| Ý định và biên nhận lỗi | Cùng bản ghi tick của recorder đang dùng | 16 mục/lịch |
| `belief` | Mỗi lần cập nhật ước lượng | 8 MiB nén gộp với `attempts` |
| `attempts` | Mỗi lượt gắp và bước phục hồi | Như trên |
| `sensor-transforms` | Scan trước và sau `lidar-noise` trên tick công bố | Nằm trong quota navigation hiện có |

Nguyên tắc không đổi: chunk bất biến có hash, reader có giới hạn và fail-closed, ghi bền trước logical commit, quota chạm trần là terminal có lý do chứ không cắt im lặng, tổng mỗi run tối đa 200 MiB. Append lỗi → gap/terminal và suspend, không gửi lại tick.

`FaultReportV1`, `TuningResultV1` và `PerceptionStudyV1` do **reader dựng từ stream đã kiểm**, không lấy từ trạng thái nóng của runner. Report chứa ref/hash/coverage và tóm tắt.

Xuất replay package giữ phạm vi R2b: chỉ run một world. Package của cell thêm ref tùy chọn tới `drives`, lỗi, `belief` và `attempts`; Lab vẽ lớp belief và dòng thời gian lỗi từ package, không gọi runtime. Run mobile, bench và rig xem lại từ report và artifact đã lưu; mở rộng xuất package cho các loại run đó không thuộc R4. Thiếu dữ liệu → hiện "không có dữ liệu" đúng phần đó.

Bản ghi mẫu của R4 (WEB10) là replay package của run cell đã ghi thật, thêm vào `lab/public/replays/` và `catalog.json` theo đúng dạng ba mẫu hiện có. Hai mẫu: cell có một lỗi drive kèm báo cáo lỗi (`drive-fault`), và cell với belief ước lượng cùng một lần phục hồi (`belief-recovery`). Mỗi mẫu ghi nguồn gốc, `accepted:false` và `not_calibrated`.

## 8. Hiệu chuẩn

Dùng lại `CalibrationDataset`, `PredictionSeries`, `CalibrationResult` và `assessCalibration`. Thêm:

```ts
interface IdentificationPlanV1 {
  id: string; revision: number; digest: string;
  datasetDigest: string; baseDriveModelDigest: string; plantModelDigest: string;
  parameters: {path: string; initial: number; lower: number; upper: number; unit: string}[];  // tối đa 12
  objective: {channels: string[]; weights: Record<string, number>};
  optimizer: {method: 'bounded_least_squares'; maxIterations: number; tolerance: number; relativeStep: number; maxJacobianCondition: number};
}
interface CalibrationRecordV1 {
  planDigest: string; datasetDigest: string; configDigest: string; sourceKind: 'measured' | 'synthetic';
  fitted: {path: string; value: number; atBound: boolean; unit: string; standardError: number | null}[];
  convergence: {iterations: number; converged: boolean; objectiveInitial: number; objectiveFinal: number; jacobianCondition: number};
  validation: CalibrationResult;             // trên tập validation giữ lại
  domain: Record<string, {min: number; max: number}>;
  produced: {document: 'drive_model' | 'arm_physics'; id: string; revision: number; digest: string}[];  // rỗng khi không đạt hoặc dữ liệu synthetic
  toolSelfTest: boolean;
}
```

Quy tắc:

- Kế hoạch nhận dạng (tham số nào, biên nào, kênh nào) được khai và băm **trước** khi fit. Đường dẫn tham số phải thuộc tập đăng ký: quán tính rotor (`armatureKgM2`), cản và ma sát khớp (`jointDynamics.damping`, `jointDynamics.frictionloss`), hệ số đường mô-men của trục (`torque.scale`). Tham số ngoài tập bị từ chối. Cản và ma sát khớp của tay máy hiện là một giá trị chung cho sáu khớp: fit là fit giá trị chung đó và bản ghi nói rõ. Khớp bánh chưa có tham số quán tính rotor hay cản trong compiler, nên với bánh chỉ fit được `torque.scale`.
- Fit chỉ dùng tập `tune`. Đánh giá chỉ trên tập `validation`. Rò rỉ giữ nguyên mã `CALIBRATION_SPLIT_LEAKAGE`.
- Tham số chạm biên được đánh dấu `atBound`; bản ghi có tham số chạm biên hoặc không hội tụ không sinh revision.
- Bản ghi kèm sai số chuẩn xấp xỉ của từng tham số và số điều kiện của Jacobian tại nghiệm. Số điều kiện vượt `maxJacobianCondition` của plan nghĩa là dữ liệu không đủ để tách các tham số: lý do `IDENTIFIABILITY_POOR`, không sinh revision.
- `sourceKind:'synthetic'` hoặc `toolSelfTest:true` → `produced` luôn rỗng. Dữ liệu tổng hợp chỉ kiểm công cụ.
- Tài liệu sinh ra là **revision mới** của drive model hoặc của physics profile tay máy; file gốc giữ nguyên byte. Nguồn của tham số đã fit là `derived`, trỏ tới digest dataset và digest bản ghi; kèm miền hiệu lực.
- Đổi revision plant, tải, hoặc bất kỳ thứ gì đổi `configDigest` làm bản hiệu chuẩn hết hiệu lực (`invalidatedBy`), như giao thức hiện có.

Mức trưởng thành của model là **hàm thuần** của nguồn tham số, không phải nhãn gõ tay:

```ts
type ParameterMaturity = 'illustrative' | 'assumed' | 'nominal' | 'calibrated';
// mock: illustrative · SourceRef.kind assumed → assumed · manufacturer → nominal
// measured, hoặc derived có CalibrationRecord đạt và còn hiệu lực → calibrated
export function groupMaturity(sources: readonly SourceRef[], records: readonly CalibrationRecordV1[], currentConfigDigest: string): ParameterMaturity;
// mức của một nhóm = mức thấp nhất trong nhóm; nhóm: geometry, inertia, drive, contact, sensing
```

"Qualified" **không** phải mức của tham số. Nó là trạng thái của một record qualification (gate `tested`, sidecar chấp nhận do người ký) và được hiển thị trên trục riêng.

## 9. Case và gate

| Case | Bằng chứng tối thiểu | Gate |
|---|---|---|
| DRV01 | Schema/admission drive model, control profile, drive-io; negative; scene legacy giữ byte | G-DRV1 |
| DRV02 | Model lý tưởng trùng bit với đường legacy: mobile, arm, cell | G-DRV1 |
| DRV03 | Máy trạng thái: enable, lệnh bị bỏ khi chưa enabled, quick stop, chốt lỗi, reset theo sườn, phanh/thả | G-DRV1 |
| DRV04 | Giới hạn mô-men/vận tốc/gia tốc, đếm bão hòa; không sửa pose | G-DRV1 |
| DRV05 | Lượng tử, cửa sổ vận tốc, trễ phản hồi/lệnh, nội suy, watchdog theo thời gian mô phỏng | G-DRV1 |
| DRV06 | ≥3 lần cùng seed cùng build trùng bit cho từng thí nghiệm drive | G-DRV1 |
| DRV07 | Evidence `drives`: round-trip, thiếu/hỏng/quota/gap bị bắt; report cũ nhập được | G-DRV1 |
| DRV08 | Chi phí tick trước/sau trên cell; ngân sách giữ được hoặc giới hạn được ghi | G-DRV1 |
| CIL01 | Controller thuần; cùng phản hồi → cùng lệnh trên mock và MuJoCo; không đọc được `actual`; gain của profile khớp readback model | G-CIL1 |
| CIL02 | `MJ-FD01` với drive nominal, 3 seed, phục vụ 1; có trình tự enable trong evidence | G-CIL1 |
| CIL03 | Mô-men giới hạn: thiếu hụt vận tốc đo được, `TRACKING_DEGRADED`, không đến nơi giả | G-CIL1 |
| CIL04 | Trễ lệnh: metric ổn định được ghi; ổn định hoặc dừng có lý do; không phục vụ giả | G-CIL1 |
| CIL05 | Lỗi do chính drive model sinh ra giữa mission (quá tốc với model thử nghiệm): lệnh 0, `needs_attention`, không tự reset, custody không đổi, cốc đang giữ không bị thả | G-CIL1 |
| CIL06 | `MJ-CELL-BV01` với drive nominal trên arm và AMR: 3 seed phục vụ 2; 5 fault R2b không phục vụ giả | G-CIL1 |
| TUNE01 | Admission bench: tín hiệu đóng, biên, 500 tick, trần trace, slot; gain bất ổn → kết quả `unstable`, slot nhả | G-TUNE1 |
| TUNE02 | Metric đúng trên vector tham chiếu giải tích và trên engine; đủ lý do `unavailable` | G-TUNE1 |
| TUNE03 | Trace 500 Hz bền, đọc lại; gap → metric không tính | G-TUNE1 |
| TUNE04 | Web: chọn trục → sửa → chạy → đồ thị → A/B → xuất → nhập; biên hai phía; profile plant khác bị từ chối | G-TUNE1 |
| TUNE05 | Gợi ý gain khớp công thức với quán tính đọc lại; có nhãn; trong envelope | G-TUNE1 |
| FLT01 | Admission lịch: biên tham số, chồng lấn, 16 mục, run không có drive bị từ chối; lịch cũ giữ nguyên | G-FLT1 |
| FLT02 | Mỗi loại lỗi có biên nhận tại đúng lớp; reader đối chiếu; không sửa pose/custody | G-FLT1 |
| FLT03 | Oracle phát hiện cho từng loại lỗi, đúng bên phát hiện và trong hạn | G-FLT1 |
| FLT04 | Sáu invariant trên toàn campaign `fault-v1` | G-FLT1 |
| FLT05 | Báo cáo lỗi đủ trường, dựng từ stream; `not_fired`; phát hiện trễ được đánh dấu | G-FLT1 |
| FLT06 | Web: soạn → kiểm tra → chạy → báo cáo → nhảy tới tick | G-FLT1 |
| TRAY01 | `cup-triple` và proxy người: khả thi, compile, readback | G-TRAY1 |
| TRAY02 | Biến thể A: 3 seed, phục vụ 3 sau xác nhận, trượt trong policy | G-TRAY1 |
| TRAY03 | Biến thể A′ và B (khay trơn, gia tốc thường và gắt): thời điểm bắt đầu trượt so với cận Coulomb, hoặc ghi "không trượt" kèm gia tốc đạt được | G-TRAY1 |
| TRAY04 | Biến thể C và D: thiếu hụt vận tốc; dừng trước proxy, không chạm, tiếp tục; metric khay | G-TRAY1 |
| TRAY05 | Câu gợi ý chỉ từ cặp run khác đúng một input và metric available; ba ngôn ngữ | G-TRAY1 |
| BEL01 | Schema/admission belief và perception; `fixed_program` giữ byte R2b | G-BEL1 |
| BEL02 | Bộ ước lượng: bias, nhiễu, trễ, mất mẫu, vùng nhìn; tái lập theo seed; quy tắc tiêu số | G-BEL1 |
| BEL03 | Mã quyết định không nhận truth (kiểu dữ liệu + test) | G-BEL1 |
| BEL04 | Bốn cửa của lượt gắp; từ chối trước chuyển động; bản ghi có trước lệnh | G-BEL1 |
| BEL05 | Study `perception-gap-v1` đủ 92 lượt, artifact từng lượt, quần thể và khoảng tin cậy | G-BEL1 |
| BEL06 | Web: lớp belief đúng con trỏ, màn hình study, replay offline | G-BEL1 |
| REC01 | Phục hồi kẹp hụt từ thất bại đã biết (xác nhận kẹp cho biết không có cốc giữa hai má); mỗi bước có id, ghi trước | G-REC1 |
| REC02 | Hết số lần → `RECOVERY_EXHAUSTED`, `needs_attention` | G-REC1 |
| REC03 | Niềm tin cũ: chặn trước cam kết; hụt sau cam kết rồi phục hồi | G-REC1 |
| REC04 | Unknown, cốc rơi, cốc còn bị giữ: không phục hồi, không mở kẹp, không phục vụ giả | G-REC1 |
| REC05 | Cell `belief_estimated` danh định 3 seed phục vụ 2; 5 fault R2b giữ kết quả | G-REC1 |
| REC06 | Cell chế độ belief với `world-cup-nudge-v1`, 3 seed: nhiễu loạn có ý định và biên nhận; lượt 1 hụt đã biết; phục hồi trong giới hạn; phục vụ 2. `fixed_program` với thí nghiệm này bị từ chối | G-REC1 |
| CAL01 | Nhập log: đơn vị, clock, trùng, gap, sidecar; quy tắc `sourceKind` | G-CAL1 |
| CAL02 | Dự đoán từ bench khớp điều kiện trial; ràng buộc `configDigest` | G-CAL1 |
| CAL03 | Tự kiểm công cụ: phục hồi tham số ẩn của dữ liệu tổng hợp; không sinh model | G-CAL1 |
| CAL04 | Chạm biên, không hội tụ, rò rỉ, ngoài miền đều bị bắt | G-CAL1 |
| CAL05 | Revision drive model mới có nguồn và miền; file gốc giữ byte; hết hiệu lực khi đổi cấu hình; hàm mức trưởng thành | G-CAL1 |
| CAL06 | Web: màn hình hiệu chuẩn và huy hiệu mức model | G-CAL1 |
| WEB07 | VI/JA/EN, 390/1024/1440 px, axe serious/critical = 0, reduced motion cho mọi panel mới | G-WEB2 |
| WEB08 | Replay package có stream mới mở offline; mọi mutation transport bị cấm | G-WEB2 |
| WEB09 | Hiệu năng: đồ thị 5.000 mẫu và lớp belief không làm frame p95 vượt mục tiêu R2b | G-WEB2 |
| WEB10 | Hai bản ghi mẫu của R4 (`drive-fault`, `belief-recovery`, đều từ run cell) có trong catalog mẫu của Lab, mở được không cần runtime, hash khớp manifest, ghi `not_calibrated` và `accepted:false` | G-WEB2 |
| REG05 | Mock/IR-SIM/R1/R1.1/R2a/R2b ghi lại ở tuple R4, golden đúng, artifact/pin kiểm | G-REG5 |
| CLD01 | Image `linux/arm64` dựng từ cây sạch tại commit của đợt. Trong container: cell có drive danh định phục vụ 2, một bench run, một run có lỗi kèm báo cáo, cell `belief_estimated`; mỗi mục áp dụng khi đợt tương ứng đã có. `docker diff` rỗng, không chạy root | G-CLOUD2 |
| CLD02 | Image `linux/amd64` dựng được từ cùng commit; test Python của tool root đạt trong image. Cell đầy đủ dưới giả lập không phải điều kiện | G-CLOUD2 |
| CLD03 | Sau một lần deploy theo lệnh người dùng: health báo đúng commit và schema hash của pin; trên Cloud Run x86-64, cell có drive danh định phục vụ 2 và một bench run hoàn tất; ghi ms/tick và hệ số thời gian thực; so với run trên Mac theo kết quả và dung sai. Chưa có deploy → `not_run`, lý do `deploy_order_pending` | G-CLOUD2 |

Campaign tối thiểu:

- `cil-v1`: 5 thí nghiệm drive × 3 seed trên `MJ-FD01` (15), 3 lần lặp cùng seed (3), cell 3 seed + 5 fault (8).
- `fault-v1`: mỗi loại lỗi ít nhất 2 run trên đối tượng khác nhau, cộng `drive-reset`; tối thiểu 16 run.
- `tray-v1`: A × 3 seed; A′, B, C, D mỗi biến thể 2 run; tối thiểu 11 run.
- `perception-gap-v1`: 92 lượt rig; cộng 3 seed cell danh định và 3 seed cell có `world-cup-nudge-v1`.
- Bench: mỗi trục đăng ký một `step` và một `trapezoid` với profile khởi điểm.

Mỗi run có artifact riêng. Pass cả suite không thay cho artifact từng run.

G3 (hiệu chuẩn bằng dữ liệu đo) **không** thuộc R4 và giữ `not_run` cho tới khi có dataset đo thật. G-CAL1 chỉ nói công cụ hoạt động; nó thuộc đợt tùy chọn R4.5 và không nằm trong điều kiện đóng R4. Gate `tested` nghĩa là test đạt, không nghĩa là mọi run stress hoàn tất thành công.

## 10. Qualification R4

Recorder thêm bảng release `r4` sau khi code tồn tại. Record `documentType:'sim-extension-qualification'`, `accepted:false`, mapping case/suite/host/input/artifact tường minh. Guard đọc và hash lại artifact, không tin status trong manifest.

Chuỗi ghi: Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → **r4**, cùng source commit và cùng Lab commit/pin, mỗi bước exit 0, output ngoài hai repo, archive thô ngoài Git theo quy ước hiện có. REG05 cần các record trước ở đúng tuple.

Bàn giao từng phần được phép: R4.1 cần G-DRV1 và G-CIL1; R4.4 cần G-BEL1 và G-REC1; mỗi đợt cần thêm CLD01 cho phần của mình. Với bàn giao từng phần, regression nghĩa là: các suite tập trung của phần đã đổi, các test golden/hash của đường legacy, và guard của các record đang nằm trong cây vẫn đạt. Chuỗi recording đầy đủ chỉ ghi một lần, ở V16. Chỉ tuyên bố R4 đầy đủ khi có G-DRV1, G-CIL1, G-TUNE1, G-FLT1, G-TRAY1, G-BEL1, G-REC1, G-WEB2, G-REG5 và G-CLOUD2. G-CAL1 được ghi riêng nếu đợt R4.5 được mở. Candidate tự động luôn `accepted:false`; chấp nhận chỉ nằm trong sidecar do người ký viết.

CLD03 đi theo cách của CL01. Bằng chứng của mỗi lần deploy là một thư mục bổ sung dưới `evidence/cloud-run/`, gồm định danh dịch vụ, image, health và kết quả từng bước, có `checksums.json`. Guard `cloud-run` kiểm bản bổ sung gắn với đúng byte của record R4; không ai sửa `qualification.json` để đổi gate. Deploy, khóa truy cập và mọi lệnh ghi lên Cloud Run chỉ làm theo lệnh của người dùng.
