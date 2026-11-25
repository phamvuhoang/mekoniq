# Contracts, custody và evidence

Normative cho [BVI-02..07, BVI-10..11](README.md). Tên API bên dưới là deliverable mới trừ khi ghi “hiện có”. Schema sinh TypeScript là nguồn chuẩn; không duy trì hai bộ interface viết tay khác nhau.

## 1. Ranh giới workflow và plant

`CellAdapter`, `CoffeeContext`, `CoffeeState`, `CoffeePlantState`, `ArmPlantState`, `ArmSession`, `RunReport` là types hiện có. `CoffeeDriver` giữ compatibility constructor ba tham số, thêm tham số tùy chọn thứ tư `ports: CoffeePlantPorts`; factory mặc định tạo mock. Native cung cấp ports từ plant session. API mới ở `source/packages/lab-runtime/src/v2/beverage/coffee-ports.ts`:

```ts
export interface CoffeePlantPorts {
  adapters: readonly CellAdapter[];
  advance(): Promise<void>;
  recover(): Promise<void>;
  snapshot(): { coffee: CoffeePlantState; arm: ArmPlantState | null };
  drain(): readonly CellReport[];
  transferEvidence(transferId: string): CorrelatedTransferEvidence | null;
  report(): { cupLedger: readonly CupPhysicalState[]; arm: ArmCollisionEvidenceRecord | null };
  close(): Promise<void>;
}
```

`CorrelatedTransferEvidence` là type mới, khác `TransferEvidence` lỏng hiện có trong cell-adapters; không overwrite type cũ. `CellReport` ở `source/packages/cell-adapters/src/contract.ts`; `ArmCollisionEvidenceRecord` ở `v2/arm/session.ts`. `CorrelatedTransferEvidence` định nghĩa bên dưới. Native arm snapshot là null, không tạo một MockArmPlant để giả actual telemetry. Callback observer đi vào queue một lần; mỗi tick drain trước domain transitions, không vừa subscribe xử lý business logic vừa drain lần nữa. `advance/recover/close` awaited ở cả mock và native; caller không được bỏ promise. Thay đổi state checkpoint version phải kèm reader/migration cho mock checkpoint cũ; không serialize adapter instances.

## 2. Observation và custody

Thêm `source/packages/contracts/schemas/lab-transfer-evidence.schema.json` cùng generated type. Những trường dưới là required, trừ `parent` và `grip` có thể null khi unknown:

```ts
export type SimProducer = 'mock_arm' | 'mock_amr' | 'linuxcnc_virtual_grip' | 'gazebo_tray';
export interface TransferObservation {
  observationId: string;
  runId: string;
  cupId: string;
  transferId: string;
  commandId: string;
  payloadHash: string;
  deviceId: string;
  observerId: string;
  bootId: string;
  controlEpoch: number;
  seq: string;
  producer: SimProducer;
  fidelity: 'modeled';
  phase: 'grasp' | 'release' | 'receive' | 'lost';
  parent: string | null;
  grip: { closed: boolean; objectPresent: boolean } | null;
  clockDomain: string;
  observedMonotonicNs: string;
  receivedMonotonicNs: string;
  quality: 'valid' | 'stale' | 'unknown';
}
export interface CorrelatedTransferEvidence {
  giver: TransferObservation;
  receiver: TransferObservation;
  dock: { robotId: string; slot: number; bootId: string; stationary: boolean;
    localizationValid: boolean; errorM: number; receivedMonotonicNs: string };
}
export interface CupPhysicalState {
  cupId: string;
  parent: string | null;
  status: 'known' | 'unknown' | 'lost';
  lastObservationId: string;
}
```

Cross-field rules: run/cup/transfer/command/epoch phải khớp pending command; nhận không từ tương lai; tuổi theo coordinator receipt ≤ policy freshness và provider không báo stale. `seq` là nonnegative integer string, không ép Number; numeric fields finite, errorM ≥0, slot positive integer. Giver/receiver observerId khác nhau; producer labels khác nhau không đủ nếu cùng observer identity. Replay reject epoch cũ; duplicate cùng observationId và cùng canonical hash là no-op, khác hash là conflict. Không tính age bằng cách trừ monotonic của hai VM.

Receiver quan sát tray state độc lập từ plant giver; không dựng receiverPresent=true chỉ vì giver released=true. SIM observer vẫn chỉ modeled, dù process độc lập. Pending transfer vào arm cần fresh grasp; vào AMR cần cả release + tray + dock; vào bàn theo domain delivery confirmation.

`applyCupObservation(state: readonly CupPhysicalState[], observation: TransferObservation): readonly CupPhysicalState[]` là pure projection ở `v2/beverage/cup-ledger.ts`; validator/journal wrapper giữ dedupe hash và ordering. Parent strings giữ convention hiện có: `cell:<id>/nozzle`, `arm:<id>/tcp`, `robot:<id>/tray:<slot>`, `table:<id>`. Unknown/lost dùng parent=null; không fallback nozzle. Projection không tự cấp domain custody.

Commit boundary:

1. Journal observation + dedupe key/hash + projected attachment change trước side effect.
2. Với grasp hợp lệ, gọi `plant.takeCup(cupId)` idempotent, loại nozzle obstacle; nếu đã taken do cùng observation thì không lỗi.
3. Domain confirm dùng existing `Cup.ConfirmTransfer` và pending correlation. Existing provenance `sensor` chỉ phân biệt automatic/human; report bổ sung producer/fidelity để không hiểu thành physical sensor.
4. Khi release/receive hợp lệ, thêm cup obstacle ở tray theo robot transform; attached cup không đồng thời là world cup. Allowed contact chỉ đúng phase/pair/window, không bỏ collision của cup với mọi vật.
5. Crash giữa các bước replay projection/effects idempotent và query domain pending. Không replay start_job. Nếu plant và domain bất đồng, attention + explicit reconcile; không âm thầm chọn bên “mới hơn”.

## 3. Controller job và virtual grip

Logical `CellCommand` start_job từ domain giữ commandId/payloadHash. Adapter stage bằng derived commandId ổn định từ logical id + program hash, journal stage outcome, sau accepted stage mới gửi logical start. Stage timeout → query_outcome/reconcile, không tự start. Job completion phát một lần theo logical id; reply stage không được kết thúc transfer. Restart ở mọi cut point là test bắt buộc.

SIM profile thêm virtual gripper state machine: open → closing → held hoặc empty → opening → released/lost. Inputs: actual joint/TCP samples, bounded grasp zone, world cup presence, allowlisted gripper output, receiver dock snapshot, fault schedule. Outputs: TransferObservation, virtual input pin state, diagnostic reason. `completed` không phải input đủ để xác nhận held.

Default model values phải nằm trong fixture versioned và được kiểm against units: m/rad trong runtime; LinuxCNC reference inch/deg convert tại adapter. Không dùng minh họa 3D để override PUMA reference model. Task N04 phải đối chiếu pick/place poses với model A01 và world transform trước khi chạy chương trình. Không ép XYZ/ABC chưa kiểm để vượt IK gate.

Chọn M64/M65 cho output0 trong profile SIM để biểu diễn close/open. Không thêm M66 ở increment đầu: plant quan sát output + actual pose và phát grip observation; controller motion done vẫn không xác nhận grip. Allowlist parser phải kiểm cả opcode và pin, chỉ SIM profile; không bỏ regex forbidden toàn cục. Native smoke phải chứng minh output xảy ra, plant phản hồi đúng và thiếu grip observation làm transfer timeout. Không thêm software E-stop; giữ revoke/stop semantics hiện có.

### SIM scene context qua bridge

Để plant trong Debian biết cup và receiver từ world Ubuntu, thêm **shape tùy chọn `simScene`** vào arm.command.v1, negotiated capability `simulation_scene.v1`. Giữ envelope owner token/lease/controllerEpoch/expected hashes; vẫn đúng một shape. Bridge cũ không advertise capability thì preflight BV01 chặn, không thử gửi lén extension. Thêm schema và TS/Python shape validators cùng commit, re-pin schema hash.

```ts
export interface SimSceneUpdate {
  runId: string;
  worldRevision: string;
  sceneSeq: string;
  transferId: string;
  commandId: string;
  cup: { id: string; present: boolean; positionM: [number, number, number] };
  receiver: { robotId: string; slot: number; stationary: boolean;
    localizationValid: boolean; poseErrorM: number; trayPresent: boolean } | null;
  faults: Array<'missing_cup' | 'gripper_stuck' | 'drop_cup'>;
}
```

Chỉ mode=simulation, owner Lab đang giữ lease, run/world khớp pinned session mới nhận. Payload finite, sceneSeq tăng, tối đa3 faults allowlisted, không raw HAL/G-code/path. Geometry theo world frame đã pin; chỉ cập nhật virtual plant, không viết joint command. Bridge stamp receipt clock của chính nó, context quá500ms thành stale, không dùng timestamp bên Ubuntu để gia hạn. Scene update ACK không phải sensor observation; receiver observation cuối phải đến từ Gazebo observer độc lập. Mất tunnel hết freshness thì không tạo transfer proof. SIM-scene event và actual controller output đều được journal để audit; simulation context không được expose ở hardware profile.

## 4. Report extension và status

Thêm `verification` tùy chọn vào RunReport, đồng thời mở `manifest.mode` thành `'mock' | 'simulation'`. Không thay shape `coffee.armTrace` cũ để nhét trace controller vào. Shape mới:

```ts
export interface RunVerification {
  schemaVersion: 1;
  execution: 'not_run' | 'ran';
  result: 'pass' | 'fail' | 'not_run';
  blockers: string[];
  target: 'mac-mock' | 'linux-vm-sim' | 'linux-amd64-sim';
  aspects: Array<{ name: string; producer: string;
    fidelity: 'mock' | 'controller_sim' | 'physics_sim' | 'modeled';
    artifactSha256: string }>;
  arm: ArmCollisionEvidenceRecord | null;
  transfers: TransferObservation[];
  artifacts: Array<{ path: string; sha256: string; bytes: number }>;
}
```

Thêm schema `lab-run-verification.schema.json`; ARM03 record cần schema reusable tương ứng, không unchecked `any`. Evidence paths tương đối trong bundle; từ chối absolute/`..`/symlink escape, hash mismatch, quá 64 MiB tổng import và tối đa 10.000 entries. Large raw logs lưu ngoài compact report, report giữ checksum/reference. Con số giới hạn là policy v1, được kiểm trước parse/render; không tải URL tùy ý trong report.

Implementation progress và release acceptance lưu ở release evidence index riêng:

| Trục | Giá trị | Ý nghĩa |
|---|---|---|
| implementation | planned / in_progress / implemented | Code và review |
| execution | not_run / ran | Đã thực thi trên target hay chưa |
| result | pass / fail / not_run | Giữ tương thích LabEvidenceV2 |
| fidelity | theo từng aspect | Một run có thể physics AMR nhưng grip modeled |
| acceptance | pending / accepted / rejected | Gate + reviewer + revision + evidence scope |
| blockers | reason codes | Có thể có code hoàn tất nhưng thiếu môi trường/người dùng |

Nhãn UI `verified_mock` = mock execution pass với đủ assertions bắt buộc. `verified_native` = đúng engine process native, raw samples và assertions pass cho subsystem/target nêu tên. `failed` ánh xạ result=fail. `blocked_external` hiển thị khi blocker môi trường làm test not_run. `accepted` không suy từ pass; cần release decision có scope/owner/time. Capability hello, uploaded JSON hoặc GUI mở được không tự là native verification.

Legacy không có verification → “legacy / chưa có native evidence”; không tự fill pass. Mock canonical outcome hash giữ behavior cũ; native so invariants/tolerances, không đòi byte-identical telemetry. Imported evidence là read-only, marked imported; không dùng để mở live admission. Timeline chỉ đánh giá tới cursor, không hiển thị verdict từ samples tương lai; coverage gap/clock jump là not_run hoặc fail theo assertion, không safe.

## 5. Readiness và fault schedule

API mới `GET /v2/readiness?scenarioId=BV01&backendSetId=<registered-id>` qua gateway auth hiện có; backendSetId phải thuộc registry. Response:

```ts
export interface ReadinessSnapshot {
  checkedAt: string;
  expiresAt: string;
  scenarioId: string;
  backendSetId: string;
  checks: Array<{ id: string; status: 'ready' | 'blocked' | 'unknown';
    reasonCodes: string[]; evidenceRef: string | null }>;
  canStart: boolean;
}
```

TTL 30 s cho dependency snapshot; connection/lease/world revision recheck ngay trước run. Timeout mỗi probe 5 s, tổng 15 s; timeout→unknown, không ready. Dùng một requiredBackends function hiện có cho matrix/CLI/gateway. Probes chỉ đọc allowlisted environment profile; không nhận command/path/SSH destination từ browser. Snapshot không kéo acceptance gate lên xanh.

`FaultScheduleEntry` mới ở source contracts: `{id: string, faultId: string, targetId: string, trigger: {kind:'elapsed_sim_ms', value:number} | {kind:'phase', value:'brew'|'grasp'|'handoff'|'delivery'}, durationMs:number}`. Max 100 entries, ids unique, durationMs finite 1..60000, elapsed value finite 0..3600000; catalog quyết định fault/target/backend hợp lệ. Snapshot schedule hash vào manifest, journal fired ids trước dispatch, resume không phát lại. Immediate injection hiện có vẫn dùng cùng validator. Không đổi fixture vào giữa run; unsupported gripper/native fault bị từ chối, không bỏ qua. `durationMs` giới hạn cửa sổ chèn lỗi; với lỗi làm mất cốc, reboot hoặc interlock, hết cửa sổ chỉ ghi marker `window-ended`, không tự sửa trạng thái hay xác nhận lại custody. Các hậu quả này cần đối soát/khôi phục riêng.

## 6. Clock và barrier qua VM

Provider hello có bootId, clockDomain, actual backend/version/profile/model và capability. Mỗi observation chứa provider monotonic + coordinator receipt; provider times chỉ dùng trong cùng clockDomain. Report lưu mapping sample/uncertainty khi có; không convert clock từ wall-clock NTP rồi coi chính xác tuyệt đối.

Barrier keyed bởi runId/transferId/phase và participant set. Duplicate cùng key+cùng participants trả promise cũ; khác participants → conflict. Ack phải mang barrier nonce mới và snapshot tạo sau khi provider nhận barrier; sample buffer trước barrier không đủ. Ack phải chứng minh đúng command/epoch và paused/stationary nếu barrier yêu cầu; transport ACK không phải state ACK. Deadline theo coordinator monotonic, participant stale→fail attention; pause coordinator không freeze lease/watchdog. Process reboot, tunnel drop và VM suspend/resume invalidate freshness, buộc reconcile. Không ghép records từ hai standalone runs thành combined trace.
