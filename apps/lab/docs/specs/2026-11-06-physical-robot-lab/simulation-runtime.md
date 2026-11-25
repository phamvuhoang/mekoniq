# Simulation runtime và trạm pha chế

Thuộc [spec chính](README.md), áp dụng PHY-04–10. Module mới đặt trong `source/`; Lab không điều khiển ROS trực tiếp.

## 1. Profiles và lifecycle

| Profile mới | Nội dung | Chặn nếu thiếu |
|---|---|---|
| `engineering-rigid-v1` | Common assembly compiler, native Gazebo world, AMR + Nav2; actuator có thể lý tưởng nhưng phải ghi rõ | Inertial/collision/sensor/controller model, qualified dependency inventory |
| `engineering-contact-v1` | Toàn bộ rigid profile + commercial arm/MoveIt/ros2_control + physical cup/gripper + process model | Tool/cup contact model, observed joints/contacts, scene synchronization, transfer guards |

### 1.1. Backend requirements theo profile, giữ đường chạy cũ

`mode:'simulation'` không đủ để chọn plant. Hiện `source/packages/lab-runtime/src/v2/scenario-matrix.ts` hardcode mọi coffee simulation cần LinuxCNC. B03 phải mở rộng resolver thành `requiredBackends(target: ScenarioDefinition | MatrixRow, mode: 'mock' | 'simulation', backendSetId?: string, catalog?: CapabilityCatalog): string[]`. Hai tham số đầu giữ tương thích lời gọi cũ; khi thiếu backendSetId vẫn trả mapping legacy. Mọi đường execution/readiness/manifest mới phải truyền explicit backendSetId và cùng server-owned catalog; unknown set/mode hoặc scenario không hỗ trợ bị reject, không fallback.

Mở rộng `BackendSet` bằng optional server-owned `providers: {amr:string; arm?:string; coffee?:string}` và `scenarioIds?: readonly string[]`. Mapping legacy được giữ theo bảng dưới; project không được khai báo provider hoặc endpoint. Với scenario có coffee, thiếu arm/coffee role là `SCENARIO_BACKEND_MISSING`. Engineering sets chỉ hỗ trợ những scenario ghi ở bảng; không thu hẹp scenario matrix của legacy.

| Backend set | AMR | Arm | Coffee | Scenario |
|---|---|---|---|---|
| `mock-amr` | `mock_amr` | — | — | Các scenario AMR mock hiện hữu |
| `mock-default` | `mock_amr` | `mock_arm` | `mock_coffee` | Toàn bộ scenario mock hiện hữu, kể cả mixed/hai AMR |
| `simulation-default`, `coffee-simulation` | `gazebo_nav2` | `linuxcnc_sim` | `coffee_io_sim` | Giữ admission/support matrix cũ |
| `engineering-rigid-v1` | `gazebo_nav2` | — | — | FD01 |
| `engineering-contact-v1` | `gazebo_nav2` | `moveit_gazebo_arm` | `engineering_coffee_process` | FD01, BV01 |

Hai provider IDs mới do B03 đăng ký metadata, C01/C03 triển khai; không báo enabled/installed trước khi provider có thực. `gazebo_nav2` được reuse qua engineering worker theo backend set và bundle, không tái dùng legacy compiler/model. `requestedProfile` trong bundle phải trùng backendSetId của engineering request. Không giả tên `linuxcnc_sim` cho MoveIt và không đổi provider identity trong report cũ.

Áp dụng cùng resolver cho gateway admission/health, readiness, scenario matrix/admitScenario, mock runner, SIL CLI/campaign/native lifecycle và report adapterHash/backend list. Health giữ `scenarioRequirements` cũ cho client cũ, thêm `scenarioRequirementsByBackendSet: Record<string, Record<string, {supported:boolean; required:string[]; reasonCodes:string[]}>>` (scenarioId → backendSetId). Client engineering bắt buộc đọc field mới; không có thì hiện capability blocker. Test cùng một BV01 với `coffee-simulation` và `engineering-contact-v1` phải cho hai tập dependencies khác nhau; tắt LinuxCNC chỉ chặn legacy, tắt MoveIt chỉ chặn engineering. S01/protocol 1 không đổi.

Mỗi profile có environment lock riêng ARM64/amd64, actual inventory và qualification status. Ubuntu 24.04/Jazzy/Harmonic là target family; exact package/plugin versions lấy từ B01, không bịa phiên bản trước khi chạy. Profile không qualified có thể dùng developer run mang nhãn experimental; không được đánh dấu gate pass. CI native chỉ chạy trên runner có profile lock hợp lệ.

Coordinator giữ one world/one clock/one command owner cho mỗi actuator. Không chạy gz DiffDrive và ros2_control cùng ghi wheel joints. MVP AMR dùng velocity controller có effort limit đã xác minh; khi controller không thực thi effort/acceleration constraint theo model, capability actuator phải là ideal và không xét torque/current acceptance. B04 bổ sung bounded-effort actuator khi cần G3. Arm dùng trajectory controller, feedback từ physics; position teleport hoặc command=feedback chỉ thuộc legacy/ideal test, không đủ G2.

Lifecycle: validate → resolve/pin → compile → environment doctor → spawn paused world → load controllers/sensors → verify identity/initial state → ready → run → stop → flush evidence → archive. Bất kỳ bước nào lỗi đều dừng đúng process do run tạo. Restart runtime chỉ cho read/reconcile; không resume command cũ tự động.

EngineeringRef và lockedInput đi xuyên create/reset/reclaim theo [hợp đồng API](components-and-assembly.md#3-api-và-content-store). Recovery không phụ thuộc draft/preset UI hiện tại; scene/blob access sau pairing mới dựa vào proof quyền run đã lưu. Mock và PUMA tiếp tục dùng snapshot/recovery cũ với semantics cũ.

## 2. Clock và quan sát

Physics step mục tiêu 1 ms, control step 10 ms, workflow step 20 ms; các giá trị là cấu hình reference cần pin, không yêu cầu mọi máy đạt real time. ROS nodes dùng `/clock` và `use_sim_time=true`. Report ghi real-time factor, step size, solver/contact config, physics engine/plugin version và CPU architecture. UI 4×/16×/64× không hứa native đạt tốc độ đó; hiển thị tốc độ yêu cầu và thực đo.

Simulation timeout dùng sim time; startup/transport/ownership watchdog dùng monotonic wall time. Pause dừng tích phân vật lý và process plant; watchdog vẫn hoạt động. Clock nhảy lùi/tăng epoch làm invalidate in-flight observations và vào reconcile. Command/observation phải correlate runId, commandId, controlEpoch, bundleDigest và sequence; observation cũ/duplicate không thay custody.

Physics observations được ghi trước khi downsample cho SSE. `PhysicsSample` contract mới:

```ts
type PhysicsSample = {
  runId: string; bundleDigest: string; epoch: number; sequence: number;
  simTimeNs: string; receivedMonotonicNs: string;
  entityId: string; frameId: string;
  kind: 'joint' | 'pose' | 'contact' | 'sensor' | 'process';
  values: Record<string, number>; // schema riêng từng kind khóa tên/unit
};
```

Không dùng free-form values để suy nghiệp vụ: transfer assessor chỉ nhận schema contact/pose/gripper/tray đã validate. Evidence capture tối thiểu 100 Hz cho joint/pose trong transfer; contact events ở physics step có timestamp + duration, không chỉ UI samples. Nếu sink đầy: pause/backpressure trong giới hạn hoặc fail `EVIDENCE_GAP`; không bỏ samples rồi báo pass. UI telemetry vẫn có thể coalesce như hiện tại.

## 3. AMR và arm

AMR: link chassis/drive/battery/khay/caster riêng hoặc reduction có mapping; inertia toàn robot tính từ assembly. Wheel radius/separation, gear ratio và encoder mapping là parameters explicit. Gazebo tạo lidar/depth/IMU theo capability, có odom từ wheel/controller và ground truth riêng để đo sai số. Nav2 chỉ đọc sensor/odom được cấu hình, không dùng ground truth để giả localization pass. Footprint thay theo load envelope; thay placement/payload bắt buộc compile lại.

Arm: import vendor URDF/meshes và SRDF/config đã pin; tool TCP và base transform theo assembly. MoveIt planning scene nhận fixtures/AMR/cup cùng revision với world. Plan đến execution có scene digest + freshness guard; scene đổi thì replan hoặc stop, không dùng trajectory cũ. Planning attachment chỉ phục vụ collision planning sau grasp được xác nhận; không được spawn fixed joint hoặc đổi pose vật lý để biến grasp thất bại thành thành công.

Cartesian target có frameId và pose SI; plan response có trajectory digest, joint names, times, limits và collision result. Adapter giữ stage/start semantics, cancellation, lease, epoch và command hash hiện có. Timeout/cancel phải quan sát dừng trước khi cho lệnh tiếp; unknown result đi reconcile. Không export endpoint, shell, ROS topic hoặc controller name tùy ý từ project; map capability qua server allowlist.

## 4. Process model

`CoffeeProcessModel` version 1 gồm recipe inputs, resource reservoir, nominal flowMlPerSec, startup delay, max duration, densityKgPerM3, initial/target temperature và thermal time constant tùy chọn; tất cả có source như component parameters. Mỗi tick `dtSec` tích phân `volume += flow * dt`, trừ resource tương ứng, tăng cup content mass theo density, giới hạn bởi setpoint/stock/timeout. Model nhiệt bật thì `T += (target - T) * (1 - exp(-dt/tau))`; không có tau thì temperature unavailable, không hiển thị số giả.

Native worker cập nhật cup mass/COM/inertia khi brew qua API được engine hỗ trợ và kiểm chứng ở C03. Nếu engine không đổi inertial an toàn khi chạy, tạm pause ở ranh giới brew stage, cập nhật entity với cùng ID/pose/velocity/custody, kiểm conservation rồi resume; mutation được journal. Không thay cup lúc gripper đang giữ. Không có phương án đã verified thì chặn contact BV01 với `VARIABLE_MASS_UNSUPPORTED`, không chỉ đổi con số trên UI.

Đây là lumped process model, không CFD/heat-transfer simulation. Faults: no cup, hết nước/sữa, blocked flow, sensor stuck/bias, machine unavailable, timeout. CoffeeDriver tiếp tục là workflow hiện hữu; plant trả measurements/status có provenance, không tự served hoặc chuyển custody. Interface thật của máy pha là future adapter riêng, không sử dụng trong run này.

## 5. Chu trình vật lý và custody

| Bước | Precondition | Observation cần để tiến |
|---|---|---|
| Brew | Cup tại nozzle, recipe/resource hợp lệ, arm ngoài vùng nozzle | Delivered volume/mass đạt recipe, machine complete, cup còn đúng vị trí |
| Dock | Mission/load stop đúng, tray slot trống, load allowance đủ | Pose/yaw trong tolerance + vận tốc gần 0 ổn định |
| Pick | Scene/model đúng, grasp reachable, cup ready | Hai jaw contact phù hợp, joint feedback + lực/contact interval, cup đi theo tool khi lift |
| Carry | Grip còn đủ, trajectory tránh machine/AMR | Cup không trượt quá ngưỡng, contact liên tục trong khoảng đo |
| Place | AMR vẫn đứng yên, cup nằm trong slot envelope | Jaw release và receiver contact/load/pose độc lập ổn định |
| Depart | Domain CargoLoaded + transfer đã confirm | Arm rút khỏi clearance zone và tray load ổn định |
| Deliver | Nav2 arrival, cup vẫn trên khay | Xác nhận nhận món theo domain policy; arrival không tự served |

Ngưỡng reference (engineering targets, chưa phải tolerance phần cứng): docking ≤20 mm, yaw ≤2°, linear speed ≤0,01 m/s và angular speed ≤0,02 rad/s trong 500 ms; receiver ổn định 500 ms; sensor freshness ≤100 ms sim time; lift 50 mm và giữ 1 s với drift cup/tool ≤5 mm; cup tilt ≤5° trong giao món có đồ uống. Profile ghi từng ngưỡng; chỉnh ngưỡng thay hash.

G2 dùng rigid-body contact + friction; không gravity=false/kinematic cup, không setPose theo cup ledger. Có thể dùng approximation cho cup rỗng/đầy, nhưng không được kết luận về biến dạng/thấm/tràn. Cup ledger là trạng thái quan sát; business custody chỉ cập nhật qua workflow với transfer ID. Command completed không thay grasp/receiver evidence. Mất observation, gripper mở sớm, AMR đi trước, collision hoặc cup rơi đều dừng/attention theo stage, không chuyển cốc về vị trí cũ để phục hồi.

## 6. Evidence, fault và replay

Run manifest bao gồm assembly/compiler/scene/controller/sensor/process/recipe/tool/cup hashes, dependency lock + actual inventory, seed, solver settings và calibration refs. Report ghi coverage từng capability, raw samples hash/count/time bounds, collision pairs, peak forces/efforts nếu có, tracking errors, cup pose/tilt, process volume/mass, completion và blocker. Không có measurement thì `unavailable`, không 0.

Fault schedule kế thừa hệ thống hiện hữu, thêm allowlisted physics faults: friction giảm, wheel saturation, sensor latency/dropout, gripper force giảm, cup missing, AMR drift khi handoff, process flow blocked. Fault phải có trigger/seed/once identity và backend support; unsupported fault bị chặn admission. Không thay global friction ngoài run hoặc tác động hardware.

Replay đọc snapshot + journal + observations trong bundle tương ứng; không chạy lại engine hoặc phát command. Re-simulation là run mới, có parentRunId và comparison dùng tolerances, không hứa bit-for-bit determinism giữa CPU/solver khác nhau.
