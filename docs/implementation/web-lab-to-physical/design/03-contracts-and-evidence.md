# Contracts, đo lường và bằng chứng cho R2b/R3

**Hiện trạng sau N1, 16/11:** [kết quả mới](../post-n1-final-recording/status.md), [tái hiện](../post-n1-final-recording/reproduce.md) và [disposition](../post-n1-final-recording/dispositions.md) dùng Source `0d46403` / Lab `7c97b20`. Review giữ verdict lịch sử ở tuple/scope đã nêu; capture mới và bốn assertions mock chưa giải quyết, native/physical chưa nghiệm thu. Các snapshot/kế hoạch cũ bên dưới giữ ngày và identity riêng.

**Trạng thái:** tài liệu thiết kế có cập nhật implementation ngày 14/11/2026. `LoadProfileV1` và `PhysicsEvidenceV1` đã được triển khai trong B01–B04. `LabWorldSceneV1`, `WorldEvidenceV1` và world ports đã có trong B05, qua review tại commit `9f68476`. B06 đã qua review tại Source `0624b5a` / Lab `4fabc5a`; B07a web replay package đã qua review tại Source `5e09a48` / Lab `be01048`; B07b UI/live display đang triển khai. Semantic study và contract R3 vẫn thuộc các bước tiếp theo nếu chưa có ghi chú riêng. JSON Schema/code đã version là authority cho tên và shape thực tế; không sửa generated types hoặc file sync của Lab bằng tay.

## 1. Identity và tương thích

JSON Schema draft-07 trong `source/packages/contracts/schemas/` là authority; `scripts/generate-contracts.mjs` sinh types, Lab lấy qua sync. Object đóng, arrays có giới hạn, số hữu hạn, digest là SHA-256 canonical JSON theo helper hiện có. Hash file là hash bytes, không thay bằng hash object.

Mỗi run mới giữ source commit, Lab pin/commit lúc recording, schema/closure/engine lock, project/assembly/world/model/fixture/profile digest, compiler/controller versions, seeds, host architecture, solver/timestep và provenance. Cùng `assetRef` thiết kế chưa đủ chứng minh cùng simulated model.

Mở cộng thêm `navigation-scene-v1.engine` cho `mujoco_3d`; nhánh IR-SIM/Webots giữ nguyên. Nhánh MuJoCo yêu cầu `timestepMs`, `substeps`, `physicsProfileRef`, `loadProfileRef`, các file nằm trong bundle admission. Các ref chứa `{path,sha256}`; không nhận URL. Scene compiler ghi các file profile trước, rồi hash scene, tránh vòng hash.

R2b.1 worker nhận `sceneRef:'navigation-scene.json'`, biên dịch mobile scene từ physical models và profile được scene tham chiếu. R2b.2 nhận `sceneRef:'lab-world-scene.json'`; `documentType` chọn compiler. `create.payload.sceneRef` hiện đã là string, nên không cần đổi envelope để nhận file mới. `arms[].sceneRef` cũ không bị đổi ý nghĩa; cell world không dùng trường này để khởi động engine thứ hai.

Snapshot `sceneDigest` luôn là digest của **scene chính đã dùng khi create**. Cell scene có thể chứa navigation projection có digest riêng; không tráo hai digest trong ACK.

## 2. Scene và profile mới

| Contract / thiết kế tiếp theo | File schema | Nội dung đáng chú ý |
|---|---|---|
| `LoadProfileV1` | `load-profile-v1.schema.json` | id/revision/digest, props, mass/inertia/COM/geometry/friction/source, attachment mode, tray/initial pose; tối đa 8 props |
| `LabWorldSceneV1` | `lab-world-scene-v1.schema.json` | inputs, sceneDigest, one navigation projection, one arm-cell description, model refs, support map, props, handoff policy, engine, allowed-contact rules |
| `PhysicsEvidenceV1` | `physics-evidence-v1.schema.json` | identity, streams/chunk refs, coverage, gaps, terminal reason, metrics policy digest, assumptions |
| `WorldEvidenceV1` / `WorldEvidenceRecord` | `world-evidence-v1.schema.json` | admission/scene identity, complete world snapshots, birth/removal interactions, immutable chunks, bounds, gaps/terminal và trạng thái completion |
| `SemanticStudyV1` | `semantic-study-v1.schema.json` | input equivalence map, report refs, invariants, differences, unsupported dimensions; không có rank/winner |
| `WebReplayPackageV1` | `web-replay-package-v1.schema.json` | source report/hash, scene/model/asset refs, event/chunk refs, captured scope, gaps, license refs; không có credentials |
| `NativeHandoffV1` | `native-handoff-v1.schema.json` | target profiles, locked inputs, required evidence, host status, unsupported capabilities, commissioning prerequisites |
| `PhysicalTargetDossierV1` | `physical-target-dossier-v1.schema.json` | target kind hoặc undecided, branch prerequisites, vendor/measurement refs, thiếu dữ liệu; không cấp quyền live |

Trong bảng, `digest` của profile bỏ chính field `digest` khi tính; scene bỏ `sceneDigest`. Các schema định nghĩa thêm provenance bằng `SourceRef` hiện có.

```ts
// Dạng dữ liệu mới; độ dài tuple và range được schema + semantic validator kiểm.
type Vec3 = [number, number, number];
type Quat = [number, number, number, number]; // xyzw, unit length trong 1e-6
type Pose = {positionM: Vec3; quaternionXyzw: Quat};
type LoadAttachment =
  | {kind: 'free'; supportId: string; initialPoseInSupport: Pose}
  | {kind: 'fixed_ballast'; parentLinkId: string; poseInLink: Pose};
type PhysicsProfileRef = {id: string; revision: number; sha256: string; path: string};
```

`free` không có weld/equality attachment. Collision proxy phải có provenance; visual mesh không tự trở thành collider. Tray support là `{supportId,parentBodyId,poseInBody,polygonM}` với polygon CCW trong local XY; không lấy world XY làm support polygon khi chassis nghiêng. Default world mới: tối đa 1 AMR + 1 arm + 8 props; preset tích hợp chỉ dùng 2 cốc. Vượt giới hạn trả `WORLD_CAPACITY_EXCEEDED`.

Giữ frame conventions của canonical model. Wire quaternion `xyzw` phải đổi sang `wxyz` tại biên MuJoCo và đổi lại khi đọc; joint directions/drive origin không suy từ visual mesh. Khi `mjModel` lưu inertia ở principal frame, readback dựng lại tensor về frame model trước khi so, không so thẳng ba principal moments với sáu phần tử tensor đầu vào. Unit/frame và hai lần đổi quaternion có negative tests.

Cell scene chứa một bản navigation projection và một mô tả arm-cell trong cùng frame map. Compiler loại **support tray tĩnh** của arm-cell khi thay bằng tray của AMR, rồi kiểm không còn collider trùng. Không xóa nozzle support. ID namespace gồm entity/link/shape; không để hai robot cùng tên `J1` hoặc cùng `tray` gây alias.

`handoff-policy-v1` chứa số của spec R2b §6.2, phiên bản, provenance `assumed`, IDs dock/tray, robot/arm được phép và withdrawal corridor. Allowed-contact rule là `{a,b,phase,regionId}`; được compiler và oracle kiểm cùng danh sách, nhưng hai bên tính contact/sweep độc lập. Không mở toàn bộ arm–chassis.

## 3. Một world, một bước mỗi tick

Interface theo implementation B05 tại `source/packages/lab-runtime/src/v2/simulation3d/world-ports.ts` (snapshot B05 đã review ngày 14/11/2026):

```ts
import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {RobotAdapter} from '../../../../robot-adapters/src/contract';
import type {CoffeePlantPorts} from '../beverage/coffee-ports';
import type {CoffeeState, CoffeeContext} from '../scenarios/coffee';
import type {RunManifestInput} from '../scenario-runner';

export interface WorldTickCommand {
  targetTick: number;
  velocities: {robotId: string; vMps: number; omegaRadps: number}[];
  actorUpdates: {actorId: string; poseMap: [number, number, number]}[];
  jointTargets: {armId: string; positionsRad: number[]}[];
  gripperTargets: {armId: string; openingM: number}[];
  worldInteractions?: {
    eventId: string; cupId: string; propId: string;
    kind: 'birth' | 'remove'; targetTick: number;
  }[];
  propPlacements: {propId: string; pose: {
    position: [number, number, number];
    quaternionXyzw: [number, number, number, number];
  } | null}[];
}
export interface WorldPlantPorts {
  prepareTick(nextTick: number): WorldTickCommand;
  step(command: WorldTickCommand): Promise<Sim3DSnapshotV1>;
  commit(observation: Sim3DSnapshotV1): Promise<void>;
  close(): Promise<void>;
}
export interface WorldFailure {
  targetTick: number;
  lastCommittedTick: number;
  ackTick: number | null;
  reason: string;
}
export interface WorldEvidence {
  append(snapshot: Sim3DSnapshotV1): Promise<void>;
  fail(failure: WorldFailure): Promise<void>;
  finish(): Promise<void>;
}
export interface WorldPlantBindings {
  navigation?: import('../session').SourceFixture['navigation'];
  metadata?: Pick<import('../report').RunReport['manifest'],
    'models' | 'profiles' | 'armProgram'>;
  evidence: WorldEvidence;
  world: WorldPlantPorts;
  robots: ReadonlyMap<string, RobotAdapter>;
  coffee: CoffeePlantPorts;
  snapshot(): Sim3DSnapshotV1; // initial hoặc last committed; không step engine
}
export interface WorldFactoryInput {
  manifest: RunManifestInput;
  runId: string;
  directory: string;
  state: CoffeeState;
  context: CoffeeContext;
  newBootId(): string;
}
export type WorldPortsFactory = (input: WorldFactoryInput) => Promise<WorldPlantBindings>;
```

`prepareTick` gom lệnh từ navigation controller và state machine arm; không tăng clock/advance engine. `step` là chỗ duy nhất gửi worker step, một request đang bay. `commit` cập nhật adapters/coffee observations từ ACK hợp lệ, không step. Factory của world tạo cả AMR adapter và coffee ports cùng tham chiếu một world; không dựng mock AMR rồi ghi đè pose của nó.

`RunProviders.worldPorts?:WorldPortsFactory` được tạo server-side với bundle reader đã admission. Runner khởi tạo CoffeeState/context trước, attach bindings trước tick đầu; getters của context đọc committed world snapshot. `coffee.advance()` trong nhánh này chỉ tiến state machine/mock process một lần từ observations đã commit, không tiến physics. Close thuộc `bindings.world`, các adapter không close worker lần nữa.

Thứ tự source tick:

1. Nhận scripted input và intent hợp lệ; source journal/outbox theo quy tắc hiện có.
2. Tính goal/body target, joint/gripper targets và interaction placements.
3. Ghi pending operation identity; gọi world step tới `tick+1` đúng một lần.
4. Kiểm runId/bootId/requestId/sceneDigest/tick/substep clock; nhận snapshot.
5. Ghi durable observations; nếu append thất bại, giữ thông tin engine đã tiến, đánh gap/terminal và suspend, không gửi lại tick.
6. Commit logical tick, đưa observations vào adapters/cup ledger rồi source xử lý confirmations/domain. Phát telemetry có giới hạn.

Các helper về journal/action receipts/checkpoint được tách dùng lại từ runner đang có bằng regression golden; không copy toàn bộ lifecycle. Legacy path không dùng `worldPorts` giữ thứ tự byte như baseline. Mất ACK: world có thể đã tiến, run `unknown/suspended`, không retry chuyển động và không tự respawn để tiếp tục.

`composition:'single_world'` là optional metadata server-owned trong BackendExecution. Set cell mới bắt buộc factory đó; factory vắng → `WORLD_COMPOSITION_UNAVAILABLE`. Không đi tiếp qua nhánh arm-only của dispatcher.

**Bổ sung B05:** `WorldTickCommand` có `worldInteractions` tùy chọn cho intent tạo/loại cốc, ghép một-một với `propPlacements`, gắn event/cup/prop/targetTick và binding đã admission. Chỉ world mới nhận field này; arm/mobile cũ phải từ chối trước khi mutation. Engine kiểm lifecycle vật lý, không quyết định custody; grip/release/handoff không tạo placement. Source ghi pending intent trước lệnh và ghi observed interaction sau ACK hợp lệ. Event của rig được ghi rõ provenance; B06 mới liên kết journal thật.

Factory cũng cung cấp evidence ports chỉ ở phía Source (`append/fail/finish`), tạo từ scene/config đã admission, không suy từ snapshot đầu. `navigation` dùng pose/yaw của base AMR ở dock đã admission, checkpoint cùng scene identity để reopen chỉ đọc không lấy fixture mới. `metadata` giữ model/profile/program của cùng world; hai field này chỉ thuộc binding nội bộ Source, không phải input tùy ý của browser. Có thể dùng tick quan sát tạm trong callback commit để gắn đúng thời gian, nhưng trạng thái công khai và business event bền vững chỉ được xuất sau commit thành công. Khi commit lỗi, giữ trạng thái công khai cũ và bằng chứng ACK/pending horizon; không phát confirmation dở dang hoặc gửi lại step. Xem [quyết định triển khai](05-implementation-decisions.md).

World recorder giữ prefix đang ghi là chưa hoàn tất; `finish()` thành công mới đặt complete khi không có terminal/gap. Prefix đã commit vẫn đọc được sau crash, nhưng không thay thế bằng chứng của một bước đang chờ ACK. Mười lượt production B05 đã được đọc lại bằng reader sau sửa completion; các byte record/chunk không đổi. Chi tiết hash và giới hạn phép dùng lại nằm trong decision ledger và báo cáo B05.

## 4. Wire và đo physics

`mekoniq-sim3d/1` giữ ops và envelope. World bổ sung `step.worldInteractions` và `snapshot.worldStep` tùy chọn. `worldStep` ghi PID worker, một model, kích thước model, số substep tích lũy và priming; PID chỉ là provenance mô tả, còn run/boot/request/scene vẫn xác định phiên giao tiếp. World dùng schema/stream evidence riêng để giữ toàn bộ observation và lifecycle tạo/loại cốc, không nới admission tải cố định của mobile. Thêm optional `snapshot.physics` có version `1`, chỉ producer mới phát; worker Webots/R2a không cần field mới. Phần physics được ghi thành stream riêng. Ví dụ các loại record:

```ts
export interface ContactAggregate {
  a: string; b: string; // canonical ascending IDs, force là lực tác dụng lên b
  samples: number; // số substeps có tiếp xúc pair này, tối đa substeps/tick
  peakNormalN: number;
  normalImpulseNs: number; // tổng trên các điểm và substeps của pair
  netImpulseMapNs: [number, number, number];
  pointAtPeakMapM: [number, number, number];
  expected: boolean;
}
export interface LoadObservation {
  propId: string;
  poseMap: Pose;
  linearVelocityMapMps: Vec3;
  angularVelocityMapRadps: Vec3;
  supportId: string | null;
  poseInSupport: Pose | null;
}
export interface PhysicsTickRecord {
  schemaVersion: 1;
  tick: number;
  simTimeNs: string;
  contacts: ContactAggregate[];
  loads: LoadObservation[];
  wheels: {robotId: string; angleRad: [number, number];
    velocityRadS: [number, number]; torqueNm: [number, number];
    targetRadS: [number, number]; saturatedSubsteps: number}[];
  odometry: {robotId: string; poseDriveMap: [number, number, number]}[];
  base: {robotId: string; poseMap: Pose; rollRad: number; pitchRad: number}[];
}
```

Contact force đọc bằng API engine, đổi từ contact frame sang map với quy ước dấu được test bằng vật rơi lên sàn. Không lấy constraint force sai frame. Mỗi tick tổng hợp **tất cả substeps**; nhiều contact point cùng pair cộng lực trước khi tính peak. `normalImpulseNs = Σ F_normal × dt_substep`; `netImpulseMapNs = Σ F_map × dt_substep`. Samples không phải số điểm contact. Giới hạn 256 cặp/tick; vượt → `CONTACT_CAPACITY_EXCEEDED`, evidence incomplete, không truncate im lặng.

Chỉ đánh dấu expected khi pair/phase/region hợp lệ. Bánh/caster–sàn không tính collision thân xe nhưng vẫn có thể thuộc stream lực. “Contact không expected” và “physical safety failure” là hai phạm vi khác nhau.

MuJoCo cảnh báo BADQPOS/BADQVEL/BADQACC hoặc non-finite → `PLANT_UNSTABLE`, lưu warning/tick và dừng. Phát hiện engine tự reset vẫn là lỗi; không chấp nhận state finite sau reset để tiếp tục.

## 5. Định nghĩa metric và oracle

| Metric | Định nghĩa | Thiếu dữ liệu |
|---|---|---|
| Tilt | max `abs(roll)`, `abs(pitch)` từ orientation actual chassis; có duration vượt policy | null + reason |
| Load displacement | norm XY của `p_tray_cup(t) − p_tray_cup(t0)` trong **tray frame** của lần bắt đầu vận chuyển | Không trừ hai vị trí world rồi gọi đó là slip |
| Wheel odometry residual | odometry tích phân từ wheel angle/radius/separation so với actual drive-frame pose; unwrap yaw rõ | Không lấy pose truth để sinh “odometry” |
| Stop distance | độ dài quỹ đạo actual từ lúc plant nhận stop target tới khi `|v|/|ω|` trong policy liên tục hold ticks | chưa dừng → unavailable/timeout, không 0 |
| Contact peak/impulse | theo §4, cùng pair/time window | một gap trong window → incomplete |
| Grip/release | giữ ở hai pad, độ cao nhấc; sau thả còn support trên tray đúng ID, vận tốc tương đối nhỏ | Không suy từ “command completed” |
| Served | source journal xác nhận giao đủ allocation | Không lấy arrival/cup proximity |

Các hàm thuần dự kiến ở `physics-metrics.ts`:

```ts
export type PhysicsMetric =
  | {available: true; value: number; unit: string; samples: number}
  | {available: false; value: null; unit: string; reason: string};
export function loadDisplacementM(samples: readonly LoadObservation[]): PhysicsMetric;
export function integrateNormalImpulse(forcesN: readonly number[], dtS: number): number;
```

`loadDisplacementM` dùng `poseInSupport`, từ chối support đổi, sample rỗng hoặc thiếu relative pose. Điểm bắt đầu là sample đầu của window caller đã khóa, không tìm một đoạn “đẹp” nhất. Hàm impulse từ chối dt không dương/non-finite và lực normal âm/non-finite.

Caller lấy window từ reader đã kiểm tick/coverage; một gap trong window trả metric unavailable trước khi gọi hàm thuần. Không lọc mất sample lỗi rồi đưa mảng còn lại vào hàm như dữ liệu liên tục.

Ngưỡng ban đầu để kiểm implementation: readback mass/axis/limits trong 1e-9 theo đơn vị SI, pose parity trong 1e-6 m/rad nếu cùng phép biến đổi; same-build repeat mobile trong 1e-6 m/rad. Handoff dùng ngưỡng spec R2b. Mỗi ngưỡng phải nằm trong oracle profile versioned **trước campaign**, không phải ngưỡng hardware. Repeat khác OS/CPU chỉ báo sai khác và outcome, không yêu cầu bit-exact.

Không có kết luận “tải này an toàn” khi chưa có measured/calibrated model. Có thể kết luận “trong fixture X và policy Y, quan sát Z vượt ngưỡng thử nghiệm”.

## 6. Custody liên tục và quan sát chuyển cốc

Dùng lại `CupLedger`, `validateTransferObservation`, `validateCorrelatedTransferEvidence` và correlation gồm run/cup/transfer/command/payload/controlEpoch/boot/seq. Hai phía simulated observer có IDs riêng: phía giver đọc pad/opening, receiver đọc tray support/relative motion. Không copy một release ACK thành cả hai observation. Cùng một engine cung cấp hai kênh này nên report ghi **cùng nguồn mô phỏng**, không gọi là hai cảm biến vật lý độc lập.

Một cốc có một propId xuyên chuỗi nozzle → gripper → tray → recipient. Đổi custody chỉ đổi ledger. Chỉ sự kiện tạo cốc và lấy cốc đã khai mới dùng `propPlacements`; payload browser không được tùy ý di chuyển prop. Mỗi placement có interaction record gắn command/event/tick/reason và pose trước/sau. Phát hiện jump không có interaction → `PROP_CONTINUITY_BROKEN`.

Không diễn giải `restingOn` chỉ từ một điểm chạm tức thời. R2b receiver cần contact/support polygon/velocity window; `restingOn` của R2a vẫn có semantics cũ trong report cũ.

## 7. Durable recording và replay

Giữ nguyên trajectory/sensors/control/collisions của navigation. Tạo physics recorder riêng dùng cùng nguyên tắc chunk immutable, hash và reader bounded, nhưng không đổi `EvidenceStream` cũ một cách khiến archive IR-SIM bị rewrite.

- Physics ghi mỗi tick đã ACK; initial state tick 0 được ghi riêng. Stream `physics` gồm record §4; stream `interactions` ghi placement/handoff/withdrawal. Hash cả timeline và profile.
- Giới hạn mặc định physics **100 MiB compressed**, 30.000 ticks; tổng navigation + physics tối đa **200 MiB/run**. Tối đa 8 props, 256 pair/tick; line ≤ 256 KiB, chunk compressed ≤ 16 MiB, inflated ≤ 64 MiB; tổng inflate ≤ 400 MiB mỗi artifact. Quota terminal có reason, không cắt mà vẫn `complete:true`.
- Persist theo chunk; crash có thể mất phần chưa commit, phải ghi gap từ tick cuối persisted tới last known tick. Index/manifest publish atomically sau hash; không tự resume engine.
- Report chứa optional `physicsEvidence` với ref/hash/coverage và summary. Lab/source readers cùng validate. Report cũ không có field → “chưa có dữ liệu physics”, không fail import và không số 0.
- Replay package có scene, asset digest/NOTICE và input snapshot phù hợp; renderer không được lấy latest mesh khi digest không khớp. Missing asset → proxy và reason; missing physics chunk → gap rõ, không interpolated xuyên gap.
- Catalogue replay chỉ lấy run thuộc dataset demo đã chủ ý chọn, tối đa 25 MiB/package cho bản web chuẩn; quá giới hạn phải giảm sample **display** có khai báo và giữ đường tới raw artifact, không xóa raw evidence để giảm cân. Package đã giảm sample không tự đủ để requalify.

**B06 — đã qua review tại Source `0624b5a`:** world được ghi context điều khiển do Source chọn vào đúng pending command và immutable record. Context gắn command/program/phase/waypoint/held cup/interlock với scene và journal; không nhận danh sách allowed pairs tùy ý từ caller. Reader dùng context đã kiểm, actual joints liên tiếp và toàn bộ geometry/pose AMR để lập một báo cáo sweep toàn lượt riêng. Giữ cap legacy 4.096 interval, các giới hạn stream hiện có và kết quả `EVIDENCE_TRUNCATED` đúng phạm vi. Các kiểm đã bao gồm vượt 4.096 interval, ranh giới phase, context sai/thiếu và equivalence với một native prefix. Không lấy report tổng hợp hoặc metadata để thay dữ liệu thiếu. Field thực gồm `worldControl.program` và các cờ interlock/stop; report dùng `worldSweep` với method `world-full-capsule-v1`, `prefixCovered` và `streamFinalized` theo đúng phạm vi; [decision ledger](05-implementation-decisions.md) giữ yêu cầu và đánh đổi.

Cũng trong B06, cache lịch sử của world được giới hạn riêng để không serialize toàn bộ collision/prop trace ở mỗi tick. Phần này đã qua review B06: critical state, counter, first failure và toàn bộ raw stream được giữ. Report thường chụp cùng một public horizon, journal và state qua action queue; recorder chụp immutable chunk/tail cùng boundary rồi reader dựng trace tạm bên ngoài queue. Reader không flush, finish hay sửa artifact. Coverage của prefix đã commit không đồng nghĩa run hoàn tất, và không bao gồm ACK ở tick kế tiếp chưa commit. ARM03 cũ vẫn báo đúng cache bị cắt; phép sweep toàn stream có method/coverage/status riêng. Reopen dùng bundle đã admission của lượt cũ, không lấy fixture mới hay khởi động lại physics. Chi tiết ràng buộc và các ca race/crash trong quyết định 48–49. Phép geometric sweep trên arm với đầy đủ geometry AMR không phải oracle cho cặp AMR–bệ cố định. Probe tiếp cận v3 đã có sweep arm đạt nhưng raw native phát hiện chassis chạm bệ vòi; report phải giữ hai phép kiểm và scope riêng, không dùng geometry pass để suy ra toàn world không va chạm.


B06 cũng đã sửa race khi hai report cùng horizon xuất chung file: publisher gộp lần ghi đang xử lý theo destination, xóa entry khi thành công hoặc thất bại, và giữ materialize ngoài action queue. Bản sửa được kiểm qua API report đồng thời và đọc lại bản sao nominal, giữ nguyên hash trace/props. Đây là bảo vệ trong process ở publisher; `writeDurable` chung và khóa dữ liệu giữa các process không được thay thế bởi cơ chế này.

B07a đã triển khai consumer replay chỉ phía Source từ cùng snapshot đã chụp, package có giới hạn và reader từng chunk; đã qua review tại Source `5e09a48` / Lab `be01048`, gồm sửa role/media, cleanup abort, quota download và DELETE CORS. NOTICE thiếu trong bundle cũ chỉ được bổ sung từ record vendor đã khóa, khớp toàn bộ mapping model/mesh liên quan và ghi rõ là metadata bổ sung. Worker receipt của tác động B04 cũng phải khớp inventory/run/boot/scene/profile và nằm trong captured horizon; lịch tác động không tự chứng minh đã áp dụng. Giới hạn export bao phủ cả residue không rõ ownership sau restart; browser không tự dọn filesystem. Public event giữ ID và context nhưng không có bảng tra raw journal entry, nên drilldown đó phải hiện unavailable. Download giữ tối đa 4 lượt/16 MiB mã hóa qua cả I/O và response; quota này không phải giới hạn tổng heap. Public shutdown vẫn có quan sát về thứ tự cleanup được chuyển sang B09. Xem [quyết định 55–63](05-implementation-decisions.md); các API cuối lấy theo schema/code đã review, không lấy đoạn mô tả thiết kế này làm bằng chứng acceptance.

B07b đã qua review với các endpoint owner-scoped `/lab/v2/runs/:runId/world-display` và `/lab/v2/runs/:runId/world-display/scene`, theo [quyết định 64, 71–72](05-implementation-decisions.md). Projection hiển thị chỉ lấy tick đã commit, có trạng thái unavailable/stale/unknown và identity; không thêm lịch sử snapshot vào receipt action hoặc thay quyền Source. Cặp observation/view cũ có thể được giữ tối đa 500 ms; sau đó phải khớp cả revision, còn controls luôn dùng view Source hiện tại. Vào replay phải xóa world live ngay. Report cũ thiếu world chính xác hiển thị unavailable; package/reader B07a dùng dữ liệu đã ghi đúng cursor. Live không dựng full report mỗi frame.

## 8. A/B và đa engine

`compareRuns` hiện có giữ nguyên compatibility guard. Thêm `comparePhysicsRuns` cùng engine/model/policy; khác load/speed/ma sát được khai như input experiment, có population/window tương đương. Nếu version engine/model/controller khác, chỉ hiển thị changed inputs, không tự gọi hiệu ứng của tải.

`buildSemanticStudy` trả report riêng, đối chiếu `basedOn`/mapping goal IDs, common geometric projection và scripted confirmations. Cross-engine có cùng seed không đảm bảo cùng noise stream; study đầu tắt noise/actors ngẫu nhiên không tương đương, ghi rõ cấu hình.

X01 kiểm một FD01 với cùng geometric projection của `serve-payload-v1` empty và cùng policy/confirmations trên ba engine. IR-SIM dùng projection 2D, không cần mass/caster dynamics. Engine nào chưa có compiler/fixture tương đương phải ghi `INPUTS_NOT_EQUIVALENT`, không ghép báo cáo cũ Serve khác revision.

Invariants bắt buộc: mission/order/confirmation đúng quan hệ trước-sau, không serve trước handoff, không duplicate dispatch sau unknown, goal/frame/world IDs khớp. Không yêu cầu cùng toàn bộ event order giữa hai robot hay cùng từng tick. Trajectory corridor deviations ghi là observed difference; chỉ fail khi một engine vi phạm **constraint scenario đã đăng ký**, không fail vì sai khác giữa hai engine tự thân. Contact/slip/tipping ở IR-SIM → `unsupported`, không 0.

## 9. Case và gate R2b

| Case | Bằng chứng tối thiểu | Gate |
|---|---|---|
| MJ01 | Fixture/compiler/readback + frame, wheel limits, LiDAR independent raycast | G-MJ1 |
| MJ02 | Empty/center/offset vào cua, actual props/tilt/contact | G-MJ1 |
| MJ03 | Ma sát profile, wheel odometry độc lập, actuator saturation | G-MJ1 |
| MJ04 | Stop/brake/contact và cup-fall expected failure; không false served | G-MJ1 |
| MJ05 | Input negative, bad-state warning, clock, ACK loss, no duplicate step | G-MJ1 |
| MJ06 | ≥3 lần cùng seed trong cùng build/arch; dữ liệu từng run | G-MJ1 |
| MJ07 | Artifact round-trip, thiếu/corrupt/quota/gap bị bắt | G-MJ1 |
| CELL01 | Rig một world: 1 worker, 1 step/tick, chung sceneDigest | G-CELL1 |
| CELL02 | Dock/receive/withdraw + custody correlation | G-CELL1 |
| CELL03 | Cup propId/pose liên tục; không weld/teleport lúc handoff | G-CELL1 |
| CELL04 | MJ-CELL-BV01 tới served=2 sau confirmations; arm/AMR actual traces | G-CELL1 |
| CELL05 | Dock trôi, cup rơi, stop/cancel giữ cốc, worker/ACK mất | G-CELL1 |
| CELL06 | Replay/report cup–arm–AMR cùng tick, đầy đủ contact/interaction coverage | G-CELL1 |
| WEB01 | Preset → readiness → live → issue có object/tick → report | G-WEB1 |
| WEB02 | Camera/manual override, sample freshness, đổi boot/reset buffer | G-WEB1 |
| WEB03 | Replay offline, corrupt/untrusted imports, mọi transport mutation bị cấm | G-WEB1 |
| WEB04 | VI/JA/EN, 390/1024/1440 px, axe serious/critical=0, reduced motion, performance | G-WEB1 |
| WEB05 | Container local đúng architecture chạy cell, crash lưu phần committed, pin mismatch, writer race | G-WEB1 |
| WEB06 | Live HTTPS trên đích được chỉ định: stream/reconnect/export/restart | G-HOST1, external riêng |
| X01 | Semantic study với common inputs và negative mismatches | G-X1 |
| REG04 | Mock/IR-SIM/R1/R1.1/R2a re-record ở release tuple, golden đúng, artifact/pin kiểm | G-REG4 |

Campaign minimum 18 run physics: 3 seeds × 3 load profiles ở bài cua (9), 3 repeats cùng seed/profile (3), 2 brake, 2 friction và 2 fault (kill/ACK loss). Các case schema/compiler/quota bổ sung ngoài số này. Cell: 3 nominal seeds + 5 fault cases ở CELL05, có raw trace mỗi run. Không dùng pass suite toàn bộ làm vật thay thế cho artifact từng run như hạn chế R1.1.

Release R2b.1 đòi G-MJ1 và regression theo phạm vi thay đổi; chưa tuyên bố R2b hoàn tất. R2b đầy đủ đòi G-MJ1/G-CELL1/G-WEB1/G-X1/G-REG4. G-HOST1 thiếu host là `blocked_external`, được liệt kê riêng; không đưa nó vào G-WEB1 để làm local work chờ cloud. Gate `tested` là **tests đạt**, không có nghĩa mọi stress run hoàn tất thành công.

## 10. Qualification mới, không sửa lịch sử

Recorder extension chỉ thêm bảng release `r2b`/`r3` sau khi code được triển khai. Records `documentType:'sim-extension-qualification'`, `accepted:false`, mapping cases/suites/host/inputs/artifacts explicit. Guard đọc và hash lại artifacts, không tin status trong manifest.

Re-record chuỗi nền trên source commit mới và **cùng Lab commit/pin**. Tách tuple `builtFromSourceCommit`, `labCommitAtRecording` khỏi commit tài liệu ghi candidate để tránh yêu cầu vòng lặp tự tham chiếu. Một code/pin thay đổi sau đó làm candidate cũ không đủ cho release mới. Candidate cũ không bị sửa; nếu superseded thì xóa khỏi tree ở commit evidence theo quy ước, giữ Git history/sidecar.

R3 multi-host giữ cùng source/schema/inputs nhưng có host-specific engine/lock/arch inventory. Không ép mọi host dùng cùng wheel hash Python hoặc dpkg inventory. Qualification native không tự sửa `lab/config/simulation-compatibility.json`; acceptance do reviewer gắn đúng candidate/hash/profile.

B07b phát hiện browser ZIP phải lấy byte lưu gốc thay vì byte giải nén. Theo [quyết định 67](05-implementation-decisions.md), reader được thêm `readStoredAsset(path)` qua cùng kiểm admission, size/hash nén và giải nén, giới hạn và lifecycle; `readAsset(path)` vẫn trả byte giải nén. Thay đổi này đang triển khai, cần review và round-trip H7 trên production build mới; lượt import lỗi trước đó được giữ. Không thay hash manifest, recompress asset hoặc đọc vòng qua reader để làm import thành công.

## Final-review correction: prospective live display and capture semantics

The corrected live `world-display` response pairs the committed observation and its `view` inside Source's mutation queue. The latest immutable pair is bounded to one publication, refreshed after each completed tick and control/reclaim/terminal transition. Reads clone that pair without waiting for the remaining HTTP batch. Lab polls this pair and interpolates only received poses through a bounded 150 ms display buffer; run, boot, revision, prop membership and gaps reset the buffer. It never extrapolates or derives custody. The 20 ms physics tick, ACK checks, per-tick evidence and checkpoint order remain unchanged. Cell HTTP batches request at most the existing 50 paced ticks; priority Pause/Cancel uses the same lifecycle reservation and execution-time authority as navigation controls.

New capture checks separate **active full-world wall duration** (at least 180,000 ms after warm-up) from **actual GPU draw intervals** (p95 at most 33 ms). Summed draw-bearing RAF slices remain a diagnostic, not an active-duration requirement. RAF activity, render events and draw calls must correlate; missing streams, gaps beyond the existing 500 ms freshness bound, and frozen or regressing Source horizons are refused. Worker/IPC p95 remains at most 15 ms, and the browser-observed last-step receipt upper bound after Pause remains at most 500 ms. Selected 1×, achieved simulation rate and display interpolation are distinct.

A final priority-paused batch can commit a shorter prefix than requested. That prefix must match the same control's admitted revision and returned horizon, and every actual worker tick must be present exactly once. Unexecuted requested ticks are not silently treated as executed. Historical 981/d4 capture bytes, original checker outcomes, 300.2 ms draw p95 and 2797.283 ms pause bound remain unchanged; this prospective correction cannot retroactively qualify them.

R2b qualification now requires each table-selected Vitest file's normalized executed identity and successful per-file assertions after byte/summary validation. Selectors are checked before expensive recording. The physics evidence file is the integration suite; generic cloud payload security remains required by `r2b-regression`. Older release tables retain their existing shared-reader policy. Missing owned services, native/container/HTTPS execution and human acceptance remain separate unmet gates.

Prospective ordered captures declare `renderOrdering.version:1`, the renderer count before/after the capture, each RAF sample's last observed render counter, and trailing actual GL calls. Counters must be consecutive and complete; partial/malformed metadata fails without legacy fallback. Equal browser timestamps are one clock-resolution group for cadence/gaps; raw render counts remain separate and zero deltas cannot improve p95. Legacy captures retain strict timestamp allocation. The live world buffer follows received wall timestamps at150ms delay, not the last two polls' inferred simulation rate; original Source simTime stays in all authority/evidence records. Paired3D scene context updates directly on each new committed observation, independently of coarser telemetry refresh.
