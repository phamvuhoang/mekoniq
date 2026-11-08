# Workers, mission runtime và Lab

Thuộc [spec chính](README.md), sử dụng [contracts](contracts.md). API/tệp mới ở đây là đích phát triển, không phải tính năng đã tồn tại.

## 1. LinkForge shadow worker

Worker stateless tại `robotics/model-validation/linkforge_worker/`, nhận model + URDF đã xác minh digest, chạy một request rồi thoát. Python 3.11, core 1.6.0; adapter TS tại `packages/lab-runtime/src/engineering/linkforge.ts`.

Pipeline bắt buộc:

1. Source kiểm ownership của engineering bundle, closure và model digest. Chọn đúng URDF của entity; không import toàn forest như một robot.
2. Kiểm nguyên liệu bằng policy MEKONIQ: finite/units, link/joint sets, topology, collision coverage, mass>0, COM, inertia positive-definite + triangle inequality, limits, sensor frames. Dùng checker inertia hiện có; không sửa model.
3. Tạo name map theo loại: `l_`/`j_`/`s_` + SHA-256 đầy đủ của UTF-8 source ID. Kiểm uniqueness/collision và mọi reference; lưu map hai chiều có hash. Source IDs không đổi. Rewrite XML bằng parser, chỉ các trường reference đã allowlist; unknown tag chứa reference không thể map trả `REFERENCE_MAPPING_UNSUPPORTED`.
4. Import URDF tạm đã map bằng `read_urdf`. Capture diagnostics, ngoại lệ và warnings. Không gọi auto-fix. Không nhận XACRO/import remote trong MVP. Mesh chỉ từ bundle closure; path traversal, symlink escape, absolute/HTTP path bị từ chối.
5. So input đã map với parsed model: tập links/joints, parent-child, type, axes, origins, limits, tất cả visual/collision shapes, mass/COM/inertia. Numeric parse parity abs<=1e-12 hoặc relative<=1e-9; topology/IDs phải bằng tuyệt đối. Thiếu/dropped element → `LF_IMPORT_LOSS`; thay tham số → `LF_IMPORT_MUTATION`. Parity thiếu coverage → inconclusive, không pass.
6. Chạy RobotValidator, normalize issues với IDs gốc. Sensor references được kiểm riêng trên physical model; URDF hiện có không chứa đủ sensors nên report không gán check đó cho LinkForge. SRDF chỉ sinh nếu có semantic policy có hash; không có thì artifact null/reason `SEMANTIC_PROFILE_NOT_SUPPLIED`.
7. Có thể xuất URDF/SRDF tham chiếu sau khi input hợp lệ. So re-export theo precision đã khai báo riêng: geometry/pose abs<=1e-6 m/rad, mass abs<=1e-6 kg, inertia abs<=1e-9 kg*m² hoặc relative<=1e-5; vượt tolerance là reference parity fail. Không dùng tolerance export nới lỏng kiểm input mutation ở bước 5. Không promote reference thành native artifact.
8. Kết quả immutable `ModelValidationReportV1`; cache key là physical model digest + input URDF hash + policy/adapter/core version + lock digest. Thay một input làm cache miss.

Định nghĩa pass: model hợp lệ theo policy, parser không làm mất/thay dữ liệu, checks cần thiết đã chạy; warnings assumptions vẫn hiển thị. Không gọi kết quả này là chứng minh tải bền cơ khí, stability hoặc an toàn robot.

## 2. IR-SIM process và clock

Python package ở `robotics/navigation-2d/irsim_worker/`; chỉ sở hữu plant state. MEKONIQ runner/adapter/controller ở `packages/lab-runtime/src/v2/navigation2d/`. Một process = một run/world; tối đa hai robot trong release đầu. Chạy batch nhiều world bằng nhiều process giới hạn concurrency, không tạo nhiều threads chia một environment.

### Wire protocol

NDJSON trên stdin/stdout; logs stderr. Envelope request `{protocol:'mekoniq-irsim/1',requestId,runId,expectedTick,op,payload}`. Response echo IDs, `bootId`, `tick`, `ok`, typed `result` hoặc `{code,detail}`. Worker kiểm schema trước effect. Request ID cùng payload trả receipt cũ; cùng ID khác payload → `IDEMPOTENCY_CONFLICT`. Chỉ một request mutating in-flight/process.

| Operation | Payload | Semantics |
|---|---|---|
| `describe` | `{}` | Package/Python/lock/version, supported ops, no simulation |
| `create` | `{sceneRef,seed}` | Đọc scene từ staging đã bind cho process; verify hash; `headless=True`, seed explicit; state created/tick0 |
| `start` | `{}` | created→running; chưa tự tiến clock |
| `step` | `{targetTick,velocities,actorUpdates}` | targetTick=expectedTick+1; đủ velocity cho mọi robot, stable name mapping; đúng một `env.step` |
| `pause` | `{}` | Acknowledge sau in-flight step; state paused, clock không chạy |
| `resume` | `{}` | paused→running, tiếp tục cùng state/RNG; không tạo env mới |
| `getState` | `{}` | Snapshot cuối, không step/update/RNG draw |
| `stop` | `{reason}` | Terminal, giữ snapshot cuối, zero future motion; gọi cleanup; không dùng lại run |

`velocities` là `{robotId,vMps,omegaRadps}[]`; actorUpdates là trạng thái actor từ deterministic schedule đã khóa, ID phải tồn tại trong scene. Worker chặn mutation vào robot pose thông qua actor path. Scene refs là file IDs server tạo, không phải path browser gửi. Parent có thể request thủ công một tick khi paused bằng pause→single-step transaction nội bộ và giữ trạng thái paused; wire `step` cần explicit `singleStep:true` trong trường hợp này, không resume tự động UI. Schema step có `singleStep?:boolean`, mặc định false.

Lifecycle: created→running↔paused→stopped; bất kỳ lỗi protocol/timeout/process chết → failed. Không resume stopped/failed. Parent mất process thì outcome unknown/needs_attention theo mission, không spawn process mới để tiếp tục command cũ. Reclaim chỉ view/reconcile; rerun tạo runId mới với inputs đã khóa.

### Đồng hồ và thứ tự tick

Source runner là scheduler duy nhất. Mỗi tick 20 ms:

1. Apply scripted actor/business inputs đến hạn tại tick t; process domain decisions và dispatch commands.
2. Controller đọc snapshot t, active goals và reservation state; sinh velocity bounded cho từng robot theo robotId order.
3. Gửi worker step t→t+1. Workers không có wall-time free-running loop. Mọi robot advance chung một environment call.
4. Nhận snapshot t+1, verify boot/seq/scene/identity; so engine stamp với `(t+1)*0.02` trong tolerance 1e-9 s. Parent chỉ commit logical clock sau ACK hợp lệ.
5. Append plant/command/collision evidence, map adapter observations về source; process domain/journal ở thời gian mới; publish sample khi đến cadence.

`simTimeNs = tick * 20_000_000` dùng integer, không tích lũy float. Wall clock chỉ dùng timeout/CPU metrics. Pause dừng cả business timers theo sim time. Speed 1/4/16/64× chỉ thay số tick được schedule/wall-time pacing; không đổi dt hoặc bỏ ticks. Batch/cancel/pause kiểm giữa từng tick, không chờ một batch dài xong mới nhận lệnh.

Business time dùng `createClock` hiện có với epoch cố định `2026-11-01T00:00:00Z`, giống runner baseline; manifest mới ghi `clock.businessEpochMs`. Command expiry và journal timestamps lấy `epochMs + tick*20`, không lấy `Date.now()`. Nếu sau này đổi epoch/policy thì phải đổi identity, không thay ngầm khi rerun.

Nếu ACK step bị mất, parent giữ trạng thái in-flight, không advance domain mù. Worker còn sống và receipt query xác minh được có thể trả lại đúng receipt; nếu không xác minh được thì run suspended/unknown. Process mới không được replay step để đoán kết quả.

Limits mặc định: request/response 2 MiB, command queue 64, startup/create 15 s, step ACK 5 s wall-time, pause/cancel ACK 2 s, graceful cleanup 2 s rồi terminate đúng child process group. Một worker <=1 GiB RSS, hai active runs/host; quota evidence 100 MiB bytes lưu/run, tối đa 30,000 ticks/run (10 phút simulation). Vượt quota/time không bỏ dữ liệu để báo pass: terminal incomplete với reason. `getState` sau stop do parent trả snapshot persisted; worker không cần sống chỉ để xem report.

Venv chỉ cách ly dependency, **không phải OS security sandbox**. Dùng execFile/argv cố định, env allowlist, working directory riêng; không truyền credentials/ROS discovery variables; không có external network API trong worker. Test chặn network/transport access của integration; không tuyên bố macOS đã có network sandbox nếu chưa thiết lập.

## 3. Controller và nhiều robot

`NavigationController` là code MEKONIQ, ID `grid-diff-v1`, nhận navigation scene/policy, active goals và observations, trả body velocities. Không thay bằng built-in `dash` trong ca acceptance.

```ts
interface NavigationController {
  setGoal(input: {robotId:string;commandId:string;target:[number,number,number]}): void;
  cancel(robotId:string,commandId:string): void;
  advance(snapshot: IRSimSnapshotV1, reservations: Readonly<Record<string,string|null>>): {
    velocities: {robotId:string;vMps:number;omegaRadps:number}[];
    decisions: {robotId:string;commandId:string;status:'executing'|'arrived'|'blocked'|'no_path'|'cancelled';reason:string|null}[];
  };
}
```

Thuật toán baseline đủ cụ thể để test:

- Map đã biết; không SLAM. A* trên `(gridX,gridY,headingIndex)` với 8 headings, bước tiến theo heading tới ô liền kề và quay tại chỗ ±π/4. Tie break cố định `(f,g,x,y,heading)`; costs distance và angle có policy hash. Check polygon + safety margin cho cả edge/sweep, không chỉ cell center. Cạnh chéo không cắt góc vật cản.
- Đường nối start/goal continuous tới lattice và final yaw phải được kiểm swept geometry; không snap pose robot. Footprint collision dùng polygon orientation, không thay bằng disk lớn đến mức mất khả năng phân biệt robot hẹp/rộng. Giới hạn 2 triệu states/query, vượt → `PLANNER_BUDGET_EXCEEDED`, không no-path giả.
- Controller rotate–translate–final rotate, command velocity/acceleration bounded. Arrival chỉ khi pose error và velocity ở ngưỡng trong policy đủ 5 ticks liên tiếp. Khi chưa đạt heading, chỉ vị trí đúng không complete.
- Dynamic obstacle: LiDAR observations được chiếu về map, tuổi dữ liệu kiểm trước điều khiển. Sensor envelope stop distance ít nhất `v²/(2*a)+v*(scanAgeSeconds+dt)+safetyMargin`, tính từ leading edge của footprint theo hướng chuyển động, không từ tâm robot; đó là **policy mô hình**, không hardware braking certificate. Từ zero/stale scan không được suy clear path. Stop do engine collision/worker failure có thể cắt vận tốc tức thời trong mô hình kinematic; ghi limitation và event riêng, không dùng đoạn đó để tuyên bố đạt giới hạn gia tốc vật lý.
- Replan mỗi 50 ticks khi bị cản bằng occupancy từ observations; nếu chưa có đường thì giữ zero. Không có đường ngay từ global geometry→no_path; đường tồn tại nhưng không tiến 250 ticks→blocked; hết 6000 ticks→timeout. Không gọi blocked/no-path là collision.
- Planner có known static map và fleet poses, LiDAR dùng cho dynamic actors. Report ghi `perception:known_map_plus_simulated_lidar`, không claim autonomy dùng chỉ cảm biến. Engine actual overlap và independent swept-geometry oracle ghi collision, dừng/attention. Default collision stop không được làm mất contact event đầu tiên.

Một world chứa cả hai robot để chúng thấy nhau và cùng collision scene. Source quản lý corridor reservation qua `Zone.Reserve/Release` và `zone-bridge`; controller chỉ được vào vùng khi grant đúng robot. Release khi **toàn bộ footprint** đã ra khỏi polygon theo observation mới; mất ACK/stale không tự nhả vì TTL. Robot chờ dừng ngoài boundary, không teleport về parking. Đo min surface separation từ polygon, không chỉ khoảng cách tâm.

Hai robots dùng model/dimensions/sensors riêng; mapping robotId↔engine name/id explicit và stable. Tối thiểu test hai robots radius/wheel separation khác nhau để bắt lỗi singleton drive hoặc gửi action sai thứ tự. RVO/ORCA là hướng so sánh sau, không điều kiện release này.

## 4. Mission integration và API

`createIRSimScenarioRun(input:RunManifestInput, providers:RunProviders):Promise<ScenarioRun>` triển khai cùng interface với mock/native, dùng `SourceSession`, domain registry, journal và `dispatchRobotEffects`. Không sao chép state machine nghiệp vụ vào Python hay UI. Runner delivery riêng sử dụng scenario definitions/roles/actor schedules hiện có; không refactor toàn mock/native runner để thêm provider.

`IRSimNavigationAdapter implements RobotAdapter`: commandId/payload hash, robotId, missionRevision, controlEpoch, map revision và expiry được kiểm trước khi nhận goal. Duplicate exact trả receipt; duplicate khác payload lỗi. Mapping navigation-arrived→adapter `completed` chỉ hoàn thành chặng di chuyển. Source vẫn cần `CargoLoaded`, confirmation/handoff đúng allocation và domain transition trước served. Actor scripted có provenance riêng, không giả thành thao tác người dùng.

Cancel request bỏ goal điều khiển, zero future velocities và chờ observation stopped. Chỉ emit cancelled khi đã có state xác nhận; missing ACK→unknown. Giữ cargo/reservation theo source policy, không tự xóa custody. Stop có `physicalStopConfirmed:false`; chỉ có simulated stop evidence. Reordered/stale/duplicate completion không hồi sinh terminal command.

Các endpoint tái sử dụng:

| HTTP/API | Quy định |
|---|---|
| `POST /lab/v2/engineering/compile` | `project.requestedProfile='engineering-irsim-2d-v1'` chọn compiler registry; output giữ BundleReceipt |
| `POST /lab/v2/engineering/validate` **mới** | `{engineeringRef,robotId}`; ownership/closure check; response ModelValidationReportV1 + artifact refs |
| `GET /lab/v2/engineering/validations/:reportDigest` **mới** | Read-only, cùng session/run-grant authorization; digest không phải quyền truy cập |
| `POST /lab/v2/readiness` | existing shape + engineeringRef; checks riêng cho irsim_2d |
| `POST /lab/v2/runs` | existing mode simulation/access simulated/backendSetId + engineeringRef; server khóa projections |
| `/lab/v2/runs/:id/actions`, snapshot/report/events/telemetry | Giữ protocol/CSRF/revision/idempotency của gateway; hỗ trợ step theo clock capability |

Tên `validateRobotModel`, `compileNavigationScene`, `createSimulation` trong đề xuất map vào service/worker interfaces, không tạo HTTP server Python thứ hai.

Compiler registry IR-SIM giữ `scene.json` dạng **CompiledScene hiện có** cho Lab, kèm `robots/*.urdf`, `resolved-assembly.json`, physical/navigation projections, `navigation-scene.json`, `irsim/world.yaml`, name maps, policy và manifest. `BundleReceipt.sceneDigest` vẫn hash `scene.json`; `NavigationSceneV1.sceneDigest` là identity navigation riêng. Không tráo hai nghĩa. Derived files tạo trong staging, verify tất cả trước atomic publish.

Không gọi nguyên `compile_engineering()` native làm bước đầu cho multi-drive: `_drive()` hiện đọc singleton và sẽ từ chối robot thứ hai. B01 tách các hàm xuất URDF/CompiledScene thuần thành helper `robotics/simulation/compiler/description.py`, native tiếp tục gọi với inputs cũ và phải giữ byte output. Portable compiler gọi helper với bindings theo entity, rồi thêm navigation artifacts; không sinh Nav2/SDF/controllers để giả lập native readiness. Helper không import ROS/Gazebo/worker runtime; exporter kê đầy đủ helper closure riêng trong portable tool manifest. Native clearance/drive algorithm giữ nguyên; target clearance của portable dùng polygon 2D đã đặc tả.

`LockedEngineering` thêm optional refs navigation scene/model; source đọc từ bundle bằng session ownership. Không tin projections gửi từ frontend. Report validation lưu **ngoài immutable bundle**, có references về bundle/model; không append report rồi đổi digest bundle đã chạy. `runnable` legacy nghĩa native qualification giữ nguyên; readiness provider mới quyết định chạy 2D và UI diễn giải theo capability.

## 5. Evidence và repeatability

Durable run store ghi command/control ledger, actor schedule, per-tick pose/velocity/collision, sensor publications 10 Hz và assertions; chunk NDJSON gzip theo khoảng ticks, SHA-256 cho stored bytes, ordered chunk manifest. Business journal chỉ giữ events nghiệp vụ/correlation. SSE coalescing không ảnh hưởng record đầy đủ. Không lấy `TelemetryRecorder` 20k-sample ring làm oracle.

Mỗi run lưu engine/core/Python/transitive lock/OS/arch/source/schema/controller/compiler versions, all model/world/profile hashes, seed, actual clock horizons, requested và observed controls. PRNG source actors và IR-SIM NumPy là các streams riêng; ghi thuật toán/version/derived seed. Không chỉ gọi `random.seed` rồi claim NumPy đã deterministic.

Playback đọc evidence, không gọi worker hoặc phát domain commands. Rerun tạo run mới và thực thi simulator từ inputs ban đầu. Cùng lock/platform/input seed, A/B normalized trajectory và discrete business events phải khớp (pose <=1e-9 m/rad, LiDAR <=1e-6 m; collision/beam states/ticks bằng tuyệt đối). Khác platform chỉ so tolerances đã định nghĩa, không promise bitwise; nếu chưa qualify platform thì report `not_run` cho cross-platform assertion.

Không đổi canonicalOutcome/outcomeDigest lịch sử của mock. IR-SIM thêm versioned `trajectoryDigest`, `sensorDigest`, `assertionDigest`; normalized identity chỉ bỏ run UUID, wall timestamps và tên chunk ngẫu nhiên được liệt kê. Không xóa seed, input versions, failed events hoặc simulation timestamps để làm hai run bằng nhau.

## 6. Readiness, feature flags và distribution

Flags server-owned mặc định off: `MEKONIQ_LAB_LINKFORGE=1`, `MEKONIQ_LAB_IRSIM=1`. CLI interpreters/worker roots là operator options, không nằm trong project hay endpoint input. Flags độc lập; mock launcher không bật chúng. Khi thiếu dependency trong mode opt-in, health nêu unavailable có code; các đường mock/editor vẫn dùng được. Nếu operator yêu cầu boot provider bắt buộc và nó không thể khởi động, launcher mới exit rõ ràng.

Capability set `engineering-irsim-2d-v1`: mode simulation, access simulated, amr=irsim_2d, không arm/coffee. Các scenario mới có IDs `IR-FD01`, `IR-FD03`, `IR-FD04`, `IR-FD04-blocked`, `IR-FD07`, revision 1 và `basedOn:{id,revision}` trỏ business template FD tương ứng. Allowlist đầu chỉ `IR-FD01`; sau C02 thêm các variants còn lại đã kiểm. Scenario manifest khóa toàn bộ effective schedule, world/fixture, policy và maxTicks; không chạy lịch mới dưới ID/revision cũ. Các chỗ nói FD01/03/04/07 trong plan là nghiệp vụ tham chiếu, runner thực phải ghi ID `IR-*`.

Registry/matrix thêm rows riêng, backendSupport mock=false/simulation=true/hardware=false và allowlist theo backend set. `resolveBackends` cần chặn các scenario `IR-*` khi chọn legacy set, kể cả path hiện dùng công thức fallback theo mode. Không thay schedules/thresholds của scenario cũ. BV01/cup campaign không bị map sang IR-SIM; vẫn có trong mock/native sets.

Health thêm optional metadata backend set: `execution:{host:'portable_python'|'linux_native',clock:'source_fixed_step'|'native',manualStep:boolean,speedMultipliers:number[]}`, feature list `linkforge_validation_v1`/`irsim_navigation_v1`. Server kiểm ở admission; UI metadata không cấp quyền. Legacy sets thiếu metadata dùng behavior cũ. Refactor readiness từ `simulation=>linux` thành provider policy; Gazebo/ROS/LinuxCNC vẫn yêu cầu Linux và native probes cũ.

IR readiness gồm: flags/install/versions/lock; Node24/Python3.11/macOS hoặc qualified Linux; valid bundle/model/drive/sensor/footprint; scene matches world; worker describe/create smoke và runner; scenario compatible; quotas/free disk. Test doubles chỉ qualify wiring, không làm installed/reachable của production provider thành true.

Distribution đầu là **developer Mac launcher riêng** (`lab:irsim` dự kiến), dùng Python đã provision explicit. `lab:mock` và gói offline Node-only hiện tại giữ nguyên. Không tải pip packages lúc người dùng bấm Run. Artifact exporter thêm `portableSimulationTools` manifest tách `simulationTools` Linux: files/digests, Python ABI/platform, lock digests, licenses và compatible provider protocol. Import kiểm closure/pin; cùng UI/runtime source commit đã khóa.

Nếu đóng gói Python cho máy mới, coi đó là qualification riêng: build riêng OS/arch, wheelhouse/hashes, runtime Python và licenses, smoke không mạng trên target sạch. Release 2D developer không tự đóng fresh-machine/offline gate. Rollback tắt flags và chọn lại artifact pin cũ, vẫn đọc/export evidence mới read-only bằng viewer hỗ trợ schema. Không downgrade project âm thầm.

## 7. Lab UX

- Assembly page có Validate Model, progress/error, issues theo component/link/sensor, source/assumed badges và report identity; kết quả cũ marked stale khi edit. Shadow status không chặn lưu draft.
- Twin dùng backend selector có sẵn. Hiển thị IR-SIM 2D/available hoặc lý do unavailable; giữ mock/native options. Không tự chuyển người dùng sang preset khác để provider có vẻ chạy được.
- Start/step/pause/resume/stop/reset theo execution metadata. Đổi backend/model/world chỉ áp dụng run mới. Backend paused acknowledgement là nguồn status, không lấy animation paused làm bằng chứng.
- Dùng renderer hiện tại và đúng model snapshot của run. Toggle LiDAR, physical footprint, safety envelope, planned path/observed path, collision/near-miss markers; các lớp có provenance và units. Engine chỉ cung cấp planar pose, giữ model z từ frame mapping.
- LiDAR phát hiện ở sensor pose của sample tick, không vẽ từ pose mới nhất nếu timestamps khác. Gap/stale hiển thị rõ, không nối đường qua đoạn missing rồi tính distance.
- UI world phải hiển thị obstacles đã compile; tables point/icon và obstacles phân biệt để không thấy robot đi xuyên bàn trang trí mà không biết phạm vi.
- Report lưu expected/actual/pass/fail/incomplete theo provider, replay cursor đồng bộ business/pose/scans. Old reports thiếu sensor data hiển thị unavailable.
- Giữ translations VI/JA/EN, keyboard labels, reduced motion, mobile/tablet/2D fallback và export JSON/CSV/HTML. Không đưa Python/version/setup noise vào flow giao món; chi tiết đó ở readiness/report technical details khi cần.
