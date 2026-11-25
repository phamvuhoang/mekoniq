# Mekoniq Robot Lab — Source Integration Contract

Ngày gốc: 2026-11-01 · v0.1. Đối chiếu thực thi: 2026-11-04, runtime đã pin source/main W00–W11 (`a078777`). Package `lab-runtime` và API `/lab/v1` đã có cho S01 `business_sim`; phần mở rộng trong spec chưa mặc nhiên được triển khai. API thực tế, giới hạn và HTTP 501 cho SSE nằm trong [README runtime](../../../source/packages/lab-runtime/README.md); xem [tiến độ](../implementation/progress.md) cho các phần còn thiếu.

Spec gốc: [Robot Lab](2026-11-01-mekoniq-robot-lab.md). Đây là ranh giới thực thi của spec đó, không tạo một production orchestrator mới.

## 1. Ai sở hữu phần nào

| Nơi sở hữu | Trách nhiệm | Không làm |
|---|---|---|
| `lab/src/design`, `lab/src/cost`, `lab/src/estimates` | Catalog, cấu hình, ước tính có nguồn | Xác nhận payload/safety thực |
| `lab/src/world`, `lab/src/viewer` | Editor, scene, render observed state | Quyết định mission complete từ tọa độ canvas |
| `lab/src/runtime` | Client gateway, mode/readiness, reconnect/snapshot | Gọi MQTT/ROS/REST robot trực tiếp |
| `source/packages/contracts` | Wire/schema + compatibility, generated types | Để schema copy trong Lab tự trôi |
| `source/packages/lab-runtime` | Dev-only harness dùng domain/journal thật, clocks, runners và nguồn observation đã chọn | Đăng ký seed/fault trong release API |
| `source/packages/domain` | Order/KDS/allocations/mission/admission/ownership | Logic chuyển động vật lý |
| `source/packages/robot-adapters` | Manifest/capabilities, map conversion, normalize evidence | Nhiều writer cùng robot |
| Android executor hoặc ROS agent W06 | Durable native journal, validate, phát goal, reconcile | Dùng UI timer để bảo đảm dừng |
| Robot controller | Motor, watchdog, sensor/local safety path | Phụ thuộc browser để giữ an toàn |

Production code vẫn ở `source`; yêu cầu đặt Lab trong `lab` được đáp ứng bởi web/tooling/spec/scenario ở repository Lab. Khi một rule thuộc domain như payload admission còn thiếu, sửa một lần ở source/W06, không vá riêng trên UI.

## 2. Contracts hiện có là nguồn đúng

### 2.1. RobotCommand v1

Theo `source/packages/contracts/generated/wire.ts` tại baseline:

```ts
interface RobotCommand {
  schemaVersion: 1;
  commandId: string;
  operationId: string;
  organizationId: string;
  venueId: string;
  robotId: string;
  missionId: string;
  stopId: string;
  missionRevision: number;
  controlEpoch: number;
  issuerDeviceId: string;
  issuedAt: string;  // ISO timestamp
  expiresAt: string; // ISO timestamp
  target: JsonObject;
  limits: JsonObject;
}
```

Không thêm `kind: navigate` hoặc chỉ gửi `expiresAtMs` vì ví dụ Python rút gọn trong W06. Khi tạo executor phải validate schema generated hiện hành. Signature/envelope dùng đường canonical signing/identity của source, không phát minh thêm một trường signature tùy ý lên wire.

Command intent do source tạo từ mission/stop, không từ drag robot. Lab action dùng domain command (`Mission.Create`, `Mission.ConfirmStop`...) qua facade đã authorize; không nhận `RobotCommand` tùy ý từ browser rồi đưa thẳng xuống executor.

### 2.2. RobotAdapter và manifest

Giữ các method `describe`, `resolveTarget`, `estimateReachability`, `execute`, `cancel`, `requestStop`, `observe`, `reconcile` trong `source/packages/robot-adapters/src/contract.ts`.

Giữ validation enum `simulated | integration_tested | hardware_validated | venue_approved`. Đây là thuộc tính profile được quản lý trong source. Lab `RunReport` có trục riêng `mode + assertions + evidence`; run Gazebo pass không tự đổi validation enum.

`maxLoadMinor` hiện là chuỗi và chưa mang unit rõ trong interface. Quyết định đề xuất cho giao thức Lab/source kế tiếp: thống nhất **gram**, thêm mô tả schema/contract fixture trong W06-T01; display kg. Không dùng profile legacy có đơn vị chưa xác minh để xét tải. Giới hạn theo từng khay, tổng tải và hình học phải được admission cùng kiểm; `limits` của command không tự chứng minh tải thực.

### 2.3. Event và trạng thái

Robot event giữ `type`, `id`, `commandId`, `bootId`, `sequence` dạng chuỗi, `observedAt`, `payload`. Payload giữ robot/mission/revision/control epoch. Chống duplicate theo identity; boot mới không xóa receipt command cũ. `Robot.Observe` chạy qua source command processor, authorization và journal.

Chỉ evidence backend tạo được accepted/completed/cancelled. UI pose channel phục vụ hiển thị có thể drop/coalesce; event channel không được bỏ mất terminal event. Mất khoảng sequence thì lấy snapshot + cursor mới và đối soát, không tự dự đoán kết thúc.

## 3. Versioning giữa hai Git repository

Lab ghi `config/source-runtime.lock.json` có: source commit đầy đủ, dirty=false, contract schema hash, runtime artifact SHA-256, runtime package version, supported protocol major, toolchain versions. Runtime build từ revision đã commit trong checkout sạch của source/main và được kiểm thử lại trước khi cập nhật lock. Không copy `tests/support` hay `packages/domain/src` vào Lab.

Package `@mekoniq/lab-runtime` được export tại source thành Node CLI bundle, manifest và public schemas; Lab cài runtime bundle/manifest local đã kiểm checksum. Gateway thuộc package này. Tránh path `file:../source/...` trỏ working tree không khóa revision. Thư mục `.runtime/` và `runs/` trong Lab bị ignore, version lock được theo dõi trong Git.

Mỗi handshake trả protocol/schema/source revision. Khác major hoặc hash không tương thích: `CONTRACT_MISMATCH`, chỉ đọc report, chặn run mới. CI của Lab test với artifact pin; PR source thay contract phải chạy consumer conformance hoặc phát release artifact mới trước khi cập nhật lock Lab.

Schema source mới: `lab-project.schema.json`, `lab-run.schema.json`, `lab-deployment.schema.json` được tạo trong task tích hợp và generate types. Catalog/estimate UI-only có thể giữ schema tại Lab; phần cần source import dùng schema xuất từ source.

## 4. Gateway dev-only

Địa chỉ đề xuất `127.0.0.1:4176`; Vite `127.0.0.1:4175` proxy cùng origin khi dev. Gateway có thể serve bản build Lab trên chính origin của nó. Public static build không có token, không tự probe localhost/LAN và không có mode hardware.

### 4.1. API dự kiến

| Method/path | Request | Response / semantics |
|---|---|---|
| `GET /lab/v1/health` | Không credential trong URL | Runtime/version/schema, backend readiness; không lộ key/IP robot |
| `POST /lab/v1/sessions` | Token pairing nhập từ terminal cục bộ; Origin được allowlist | Session HttpOnly/SameSite, CSRF token, scope test, quyền hạn; token pairing một lần có hạn |
| `POST /lab/v1/runs` | `RunRequest` bên dưới | `202 {runId,status:'preparing'}`; validate mode/config trước spawn backend |
| `GET /lab/v1/runs/:id` | Authorized session | Snapshot + cursor + artifact revisions |
| `GET /lab/v1/runs/:id/events?after=...` | Authorized session | SSE durable events; resume cursor; gap yêu cầu snapshot |
| `POST /lab/v1/runs/:id/actions` | `{actionId, expectedRevision, kind, payload}` + CSRF | Idempotent receipt hoặc conflict, không coi HTTP 202 là physical completion |
| `GET /lab/v1/runs/:id/report` | Read permission | Report và local artifact references, không arbitrary filesystem path |
| `POST /lab/v1/deployments/validate` | Candidate bundle | Validation report/diff; không mutate venue |

`RunRequest = {schemaVersion:1, projectId, projectRevision, designHash, worldHash, scenarioId, scenarioRevision, mode, seed, sourceCommit}`. Backend IDs lấy từ server registry; request không mang URL robot hoặc command shell.

`kind` ở Lab action: `start | pause | step | cancelRun | restaurantCommand | injectFault`. `restaurantCommand` payload là `{type, payload, actorRole}`; gateway map role sang test principal đã provision, validate type bằng allowlist của scenario, dựng `CommandEnvelope` bằng source library. Không chấp nhận actorRef/epoch tùy ý do browser nâng quyền. `injectFault` chỉ có enum và tham số bounded được khai báo trong scenario schema.

`pause/step` chỉ có ở business_sim/preview; trong gazebo_sil dùng orchestration pause với clock đồng bộ và không giả replay action server, hoặc trả `MODE_ACTION_UNSUPPORTED` nếu backend chưa hỗ trợ. Trong shadow/hardware_test mọi mutation từ API Lab nói trên bị từ chối; thao tác vận hành đi qua source UI đã provision. `cancelRun` của simulation yêu cầu hủy mission, reconcile goals rồi đóng; nếu unknown, report `needs_attention`, không gán cancelled để bỏ qua.

### 4.2. Boundary bắt buộc

- Xác thực và kiểm scope của cả run, event stream và report; không chỉ POST.
- Validate Host/Origin, CSRF, content type, body limit; không wildcard CORS. Token không lưu localStorage hoặc đi trong query string.
- Import giới hạn đề xuất: JSON 5MB, 200 objects, 10 robots, 1.000 actions; reject NaN/Infinity, path traversal, archive expansion, remote script/mesh URL. Asset registry quản lý file local có license/hash; pipeline import model là task riêng nếu cần.
- CLI chỉ spawn command/launch được registry định nghĩa; dọn đúng PID/directory của run. Không kill theo tên process chung.
- Mỗi run có SQLite, namespace, scope và artifact directory riêng. Không tái sử dụng tenant/key của robot đang vận hành.
- ROS discovery giới hạn trong mạng simulation, namespace TF/topic từng robot. Domain ID chỉ là phân vùng discovery; không dùng nó thay authentication/network isolation.

## 5. Map compiler và binding

Lab world: mét/radian, x phải/y lên. Screen y xuống được đổi trong renderer bằng phép biến đổi có inverse; roundtrip phải test bằng các điểm bất đối xứng.

ROS target: map frame theo robot, `map → odom → base_link` và sensor TF nhất quán. Yaw chuyển quaternion chuẩn; không dùng camera scene làm TF.

Valetudo: native units/origin/axis lấy từ profile và fixture firmware đã pin. W06 định hướng domain SI/adapter cm; conversion chỉ trong adapter, không nhân 100 tại cả UI và adapter. Nếu coordinate mapping cần rotation/translation/scale, lưu calibration matrix + source map identity + sai số control points. Không chỉ dùng một cặp điểm để suy ra orientation/scale.

Identity của map gồm native ID nếu có; nếu firmware không cung cấp ID bền, dùng binding epoch do operator xác nhận cùng fingerprint/map landmarks theo profile. Reset map, revision đổi, scale sai hoặc không có evidence vị trí → stale/unbound. Scene export không được ghi đè map firmware.

Hai output từ world compiler:

1. Scene geometry/render model, `worldHash`.
2. Simulation collision world SDF, occupancy/map YAML + waypoint binding draft, có `worldHash` và origin/resolution.

URDF/xacro của robot và collision footprint lấy từ `RobotProfileCandidate` qua template trong `source/robotics`; generated geometry phải qua validation. Render mesh đơn giản hơn được phép nhưng không được thay đổi footprint âm thầm. Native map binding vẫn phải làm riêng khi sang robot thật.

## 6. Adapter paths và điều kiện hoàn tất

### 6.1. Business simulator

Re-use production module registry, command processor, store và `SimulatorAdapter`. Tạo factory ở package lab-runtime thay vì import trực tiếp helper có seed/auth bypass. Test principals và synthetic clock chỉ có trong harness. Fake physicalStopConfirmed có thể dùng trong simulation nhưng mọi evidence phải gắn mode simulated.

Renderer có quyền nội suy pose cho demo, không phát arrival. Fault obstacle trong business_sim mô hình hóa blocked/unblocked; chưa chứng minh planner avoidance. Reboot/restore unknown được thể hiện rõ và không được tự reset chỉ để chạy demo tiếp.

### 6.2. Valetudo

Protocol rig phải dùng chính adapter W06-T02 và native executor path phù hợp với mức test. TS protocol test không được ghi là Android execution test. Native Android với firmware fixture kiểm crash/reopen/UI suspend; robot thật kiểm model đã pin sau đó.

REST LAN là baseline không cần broker mới; MQTT là profile tùy chọn đã provision, ACL theo robot, command không retained theo [Valetudo MQTT](https://valetudo.cloud/pages/integrations/mqtt/). Không đổi transport giữa trip. Adapter chỉ nhận capability robot thực sự quảng bá; không giả định speed, docking hay native goal query có sẵn.

Completion cần fresh pose + map binding + cửa sổ lệnh đang sở hữu + status dừng + khoảng cách tolerance được profile quy định. Không có native goal identity thì correlation phải được ghi là suy luận; crash/ngoại lệnh/không chứng minh exclusive ownership → unknown. HTTP 200, idle đơn độc hoặc retained snapshot không là arrival.

### 6.3. ROS 2/Nav2

Chạy Python agent W06-T03 và Nav2 bridge W06-T04, thay driver sensors/actuators giữa Gazebo và hardware. Giữ mission/command semantics, thay hardware profile, localization và maps được nghiệm thu.

Command journal ghi ID/hash/epoch/stable native UUID và trạng thái sending trước I/O. Goal accepted chỉ là accepted; completion cần action terminal `SUCCEEDED`, `error_code==0`, identity/epoch/map đúng và localization evidence phù hợp. [IDL Jazzy](https://raw.githubusercontent.com/ros-navigation/navigation2/jazzy/nav2_msgs/action/NavigateToPose.action) là nguồn field, không dùng API distro khác.

Nếu action server reboot/mất result cache thì UUID không đủ để tái dựng kết quả; giữ unknown, kiểm trạng thái/pose và yêu cầu xử lý có kiểm soát. Cancel ACK khác terminal canceled; retarget đợi dừng/cancel evidence. Một nguồn command velocity sau arbitration, qua monitor/watchdog; Lab không publish `/cmd_vel`.

### 6.4. State/error policy

| Tín hiệu | Quyết định |
|---|---|
| Command expired trước send | Từ chối, không start goal |
| Expiry trôi qua khi đang chạy | Không tự suy ra completed/cancelled; execution watchdog dùng policy riêng |
| ACK mất sau send | Unknown + reconcile, không blind retry |
| Mission revision/epoch cũ | Reject; log identity mismatch |
| Pose stale/localization unavailable | Không xác nhận arrival; robot xử lý dừng theo native policy |
| Handoff trễ | Cargo còn trên robot, giữ stop awaiting_action; báo người vận hành |
| STOP được ACK | Ghi request acknowledged; physical stop chỉ từ evidence tương ứng |
| Network hồi phục | Đối soát journal/cursor/goal trước nhận mission mới |

## 7. Deployment candidate: xuất cái gì, ai áp dụng

Bundle dữ liệu, không phải executable:

```text
deployment.json         schema, source/adapter versions, artifact hashes
robot-design.json       components/geometry + assumptions/provenance
robot-profile.json      requested capabilities/limits; validation chưa nâng
venue-layout.json       semantic IDs, station/table layout draft
world.json              geometry và frame/units
bindings.json           map bindings draft theo robot; cần xác nhận thực địa
evidence-index.json     report hashes + mode + covered assertions
checksums.json          hash các file còn lại; không tự hash chính nó
```

Không export live mission, queue, receipts thanh toán, grant/epoch đang hoạt động, private key, password, robot IP hay credentials. Secrets/endpoint được provision bằng source tools sau import. Hash xác minh integrity, không tự chứng minh người phát hành có quyền approval; source verification kiểm identity/chữ ký bằng chứng và policy separately.

Quy trình:

1. **Export draft** từ Lab kể cả khi chưa đủ gate; report liệt kê thiếu sót.
2. **Dry-run source importer** kiểm schema/hash/units/capabilities/version, hiển thị diff và fields không hỗ trợ. Invalid bundle không đổi state.
3. **Áp dụng staging configuration** qua domain command ở venue test; atomic revision, idempotent import ID. Không chép database simulator vào tablet.
4. **Provision executor và dạy map binding thật**; nạp profile đã đo. Unknown firmware/map giữ blocked.
5. **Shadow**: so sánh telemetry, không phát motion; trial đang là owner thì Lab/source không nhận quyền điều khiển.
6. **Controlled hardware test**: kết thúc/đối soát công việc cũ, chuyển quyền rõ ràng, xác nhận vùng thử/người giám sát; phát lệnh bằng source UI. Lab ghi evidence.
7. **Venue acceptance**: source Gate A/B và điều kiện gate G4; release/cutover production theo W11, không tự làm trong task Lab.

Rollback: chỉ cấu hình đã biết tương thích với release/schema hiện tại; dừng và reconcile active native goals, giải quyết cargo/reservations, explicit ownership handoff; không restore journal/grant cũ để có lại quyền. Lưu previous config revision, không replay motion. Nếu không xác định robot đang chạy gì thì giữ blocked và xử lý trực tiếp.

## 8. Phụ thuộc source và các gap cần giải quyết

Runtime hiện dùng source W00–W11. W05/W06 trong bảng là wave sở hữu nghiệp vụ/robot; các chức năng W07–W11 và giới hạn tích hợp Lab được đối chiếu tại [tiến độ hiện tại](../implementation/progress.md).

| Lab cần | Source owner | Kiểm trước tích hợp |
|---|---|---|
| Business journey | W03/W04, W05 POS | S01 đã chạy với registry hiện tại; các journey mở rộng cần scenario riêng |
| Admission/profile/map + load units | W06-T01 | Admission native đã có ở source; Lab vẫn chỉ đăng ký simulator, cần ánh xạ candidate/profile và đơn vị tải |
| Valetudo + native Android | W06-T02 | REST/MQTT version; persistent executor; lifecycle và crash |
| ROS durable ownership | W06-T03 | Wire dùng ISO expiry; crash/native UUID query có giới hạn |
| Nav2/Gazebo/world compiler hook | W06-T04 | Real launch/IDL, TF, namespace, `/clock`, model source |
| Chassis measured + stop path | W06-T05 | Không dùng illustrative geometry/payload để nghiệm thu |
| Trial import/pilot | W06-T06 + W05 + Gate A | Read-only export input; parity và source Gate B |

Khi tích hợp backend tiếp theo, đối chiếu API thực tế trên revision source đã pin và cập nhật adapter facade/schema lock sau conformance; không mở một executor song song. Task source và task Lab có commit/evidence riêng, liên kết revision trong report. Các API mở rộng ngoài S01 trong tài liệu này vẫn cần triển khai và kiểm chứng; việc source có code W11 không chứng minh Lab đã mở các API đó.
