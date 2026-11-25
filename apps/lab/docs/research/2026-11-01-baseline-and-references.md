# Khảo sát nền tảng và nguồn tham chiếu

Ngày: 2026-11-01. Phạm vi: đọc mã/tài liệu, xem HTML, đối chiếu nguồn chính thức; không chạy robot hay chứng nhận lại W00–W06.

## 1. Mốc khảo sát

- `lab` HEAD: `e9b5ba1c5c5559b0356deb7620d2100742ce7976`.
- `lab/index.html` SHA-256: `47a2c17581cc5e6edf1dc8e66e16a8df28de178f00bb30629187a5347b04ea14`.
- `source` HEAD lúc đọc: `a8745dfdd0fd432a74188db5bf14f33086b250dc`.
- Working tree `source` có thay đổi đang thực hiện về ca, in, domain và tablet; đây không phải snapshot release sạch. Khi thực hiện Lab phải chọn lại revision đã kiểm chứng, không đóng gói working tree này một cách ngầm định.
- Người dùng xác nhận W00–W04 hoàn thành, W05–W06 đang làm. Index tại thời điểm đọc ghi W05-T01..T03 `verified_local`, các task W06 còn `planned`; chưa có thư mục `source/robotics`. Đây là độ trễ/bất đồng trạng thái cần đối chiếu với người phụ trách, không kết luận W06 chưa được bắt đầu ở nơi khác.
- Khi rà lại cuối lượt, công việc đồng thời trong source đã được commit đến `e99927362c9a276c292bfc7c3cfb0ecc9f533452`, working tree sạch và W05-T04 chuyển thành `verified_local`. Các thư mục ROS/Valetudo W06 vẫn chưa có ở checkout này. Đợt lập spec Lab không tạo hay sửa các commit đó; baseline ở trên ghi lại trạng thái lúc khảo sát, không là runtime lock để triển khai.
- [README source](../../../source/README.md) phân biệt hoàn thành phần mềm với Gate A trên thiết bị thật. Không đổi trạng thái gate chỉ vì Lab được xây dựng.

## 2. Những gì đã có và hệ quả thiết kế

Các đường dẫn dưới đây tính từ workspace `robot/`.

| Bằng chứng đã đọc | Hiện trạng quan sát | Hệ quả cho Lab |
|---|---|---|
| `source/packages/robot-adapters/src/contract.ts` | `RobotAdapter`, `RobotManifest`, target theo map/revision, event và reconcile | Dùng cùng contract; không tạo giao thức robot thứ hai trong web |
| `source/packages/robot-adapters/src/simulator.ts` | Hoàn tất theo thời gian giả, fault offline/blocked/reboot, idempotency | Kiểm nghiệp vụ; không phải mô phỏng động lực học hay Nav2 |
| `source/packages/robot-adapters/src/dispatch.ts` | Chặn manifest khác `simulated` bằng `NATIVE_EXECUTOR_REQUIRED` | Không gỡ guard để nối robot thật; phải qua executor W06 |
| `source/packages/domain/src/fleet/scheduler.ts` | Chỉ chọn `driver=simulator`, validation simulated | W06 phải nâng admission; UI Lab không thể tự bật hardware |
| `source/packages/domain/src/configuration/layout.ts` | Layout chứa ID/tên trạm/bàn; simulator tự sinh tọa độ dạng lưới | Editor hình học cần artifact riêng và explicit binding; không coi tọa độ tự sinh là map thật |
| `source/packages/domain/src/fleet/mission.ts` | Load/handoff riêng; cancel có hàng phải trả/unload | Arrival không được tự tăng số lượng đã giao |
| `source/packages/domain/src/fleet/command-journal.ts` | Command ID bền theo mission revision/stop, expiry ISO 60 giây | Lab dùng wire hiện hành, không thêm `kind`/`expiresAtMs` theo ví dụ rút gọn |
| `source/apps/tablet-android/src/robot-runtime.ts` | Runtime simulator cục bộ, hardware không fallback simulator | Giữ ranh giới này ở mọi chế độ Lab |
| `source/tests/support/restaurant-lab.ts` | Test harness dùng production modules nhưng seed, identity/fault và printing fixture thuộc test | Tham khảo để tạo harness Lab riêng; không đưa helper test thành API production |
| `source/tests/integration/simulated-delivery.test.ts` | Luồng giao, xác nhận người, cancel có tải, stale stop, reboot unknown | Là nền regression và các scenario đầu tiên |
| `source/docs/superpowers/plans/2026-10-30-wave-06-real-robots.md` | Map/admission, Valetudo, Android executor, Python agent, Nav2/Gazebo, hardware, pilot | Lab phải map phụ thuộc tới từng task W06, tránh viết lại |
| `trial/data/lib/{orchestrator,simulator,valetudo}.js` | Hành vi thực địa, MQTT, hiệu chuẩn, retry, gần đích | Dùng làm case study; không chép nguyên các heuristic arrival/retry sang production |
| `trial/docs/valetudo-setup.md` | Tọa độ/map từng robot, broker và quy trình vận hành | Import cấu hình có preview; không truy cập endpoint/credentials/context đang chạy |

Hai lưu ý đặc biệt: firmware Valetudo không được giả định có UUID goal bền; ROS action UUID cũng không tự đảm bảo truy vấn được goal sau khi action server khởi động lại. Không chứng minh được kết quả thì `unknown`, không gửi lại chuyển động để “thử cho chắc”.

## 3. Drone Lab: điều học được và giới hạn

Đã mở [Drone Engineer](https://drone-engineer.vercel.app/) bằng Chrome headless. Trang có danh sách 13 mẫu, nhóm thao tác lắp ráp, wiring, chọn linh kiện, calculator, BOM và nội dung học. Đây xác nhận cấu trúc trải nghiệm; không xác minh kết nối phần cứng. Bản phân tích người dùng cung cấp bổ sung trải nghiệm Delivery Drone.

Áp dụng vào MEKONIQ: chọn robot → cấu hình → xem cấu tạo/đường điện → kiểm tra → giao món trong mặt bằng → đọc kết quả. Giữ phong cách MEKONIQ, tự làm asset và nội dung. Chưa có bằng chứng giấy phép để tái sử dụng mã/asset Drone Lab, nên plan không phụ thuộc việc copy/fork trang.

## 4. OOMWOO và lựa chọn robotics

[Repository OOMWOO](https://github.com/makerspet/oomwoo) và [website dự án](https://oomwoo.com/) mô tả môi trường mô phỏng dùng được, trong khi robot hoàn chỉnh vẫn đang phát triển. Trang dự án phân biệt giấy phép code Apache-2.0 với giấy phép hardware chưa chốt. Vì vậy chỉ học kiến trúc và thử riêng các package được chọn; kiểm license/revision từng package trước khi mang vào sản phẩm.

Không lấy kích thước, motor, tải hay khả năng dừng của vacuum làm chuẩn robot chở món. Baseline MEKONIQ vẫn là W06; OOMWOO không trở thành dependency bắt buộc.

## 5. Nguồn kỹ thuật đã đối chiếu

| Nguồn chính thức | Thông tin dùng trong spec |
|---|---|
| [Nav2 — setup Gazebo cho Jazzy](https://docs.nav2.org/jazzy/configuration_and_development/first_time_robot_setup_guide/gazebo/) | Cần model, TF, odometry, sensors, localization, footprint và navigation; hoạt ảnh web không thay các lớp này |
| [Gazebo — ROS/Gazebo pairing](https://gazebosim.org/docs/jetty/ros_installation/) | Jazzy/Harmonic là cặp phù hợp với baseline W06 trên Ubuntu 24.04; không tự nâng distro trong task Lab |
| [NavigateToPose IDL — nhánh Jazzy](https://raw.githubusercontent.com/ros-navigation/navigation2/jazzy/nav2_msgs/action/NavigateToPose.action) | Goal PoseStamped/behavior tree; result error_code; feedback pose/distance |
| [ROS action GoalStatus — Jazzy](https://raw.githubusercontent.com/ros2/rcl_interfaces/jazzy/action_msgs/msg/GoalStatus.msg) | Accepted/executing/canceling/terminal là các trạng thái riêng |
| [Nav2 Collision Monitor](https://docs.nav2.org/jazzy/configuration_and_development/configuration_guide/core_servers/collision_monitor/configuring_collision_monitor_node/) | Lớp phản ứng phần mềm; không cung cấp chứng nhận an toàn hard real-time |
| [Valetudo MQTT](https://valetudo.cloud/pages/integrations/mqtt/) | Go-to là command không retained; payload tương ứng REST; capability phụ thuộc thiết bị |

API/firmware cụ thể phải được pin lại khi W06 triển khai. Thông số linh kiện, báo giá, tải đã đo và model robot của người dùng chưa có trong yêu cầu; các giá trị demo được gắn `illustrative`, không tự điền thành số đo thực.

## 6. Các phương án

| Phương án | Ưu điểm | Hạn chế | Quyết định |
|---|---|---|---|
| Chỉ web 3D và simulator tự viết | Demo nhanh, chạy trên Mac/điện thoại | Hai bộ logic; khó chứng minh dùng được với `source` | Chỉ phù hợp preview; không là kiến trúc chính |
| Chỉ Gazebo/RViz | Đi nhanh vào navigation W06 | Thiếu configurator, BOM, câu chuyện bán hàng và thao tác nhà hàng | Giữ là backend kỹ thuật |
| Web MEKONIQ + contracts/runtime source + backend thay thế | Dùng cùng nghiệp vụ, tăng mức kiểm chứng theo bước | Cần versioning và gateway cục bộ | **Chọn**; web MVP nhỏ, W06 đi song song theo dependency |

Phân tích người dùng đúng ở việc tách demo khỏi navigation. Điều chỉnh cần thiết: Node-RED chỉ là baseline `trial`; production điều phối qua domain/coordinator/executor trong `source`. “Mô phỏng xong triển khai được” nghĩa là phát hành bộ cấu hình tương thích và vượt các gate thực nghiệm, không phải một nút biến mô hình web thành robot đã nghiệm thu.
