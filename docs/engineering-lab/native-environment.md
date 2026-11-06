# Môi trường native cho profile engineering (B01)

Trạng thái ngày 07/11/2026: **not_run**. Chưa có target nào được provision hoặc qualified. Tài liệu này ghi những gì đã đo thật trên host hiện tại và quy trình để qualified từng target; không có inventory nào được sao chép giữa kiến trúc.

## Target

| ID | Lock | Trạng thái |
|---|---|---|
| `engineering-arm64` | `robotics/simulation/profiles/engineering-arm64.lock.json` | `not_run`: inventory chưa chụp |
| `engineering-amd64` | `robotics/simulation/profiles/engineering-amd64.lock.json` | `not_run`: chưa có máy amd64 |

Lock hiện chỉ khai báo danh sách package bắt buộc (Nav2, MoveIt, ros2_control, gz_ros2_control, ros-gz) và các gói bị cấm (`linuxcnc-uspace*`: không có plugin phần cứng trong cấu hình đã chọn). `packages` và `digests` là `null`: một lock chưa ghim version không bao giờ qualify một host, dù package có mặt (`INVENTORY_UNRESOLVED`).

## Preflight host (đã chạy)

`node scripts/native-sim/host-preflight.mjs --vm-root /var/tmp` trên host macOS 26.5 arm64, 10 core, 16 GiB RAM:

- Dung lượng trống tại `/var/tmp`: 22,86 GB; ngân sách VM theo preflight là 120 GiB + 20 GiB dự phòng → `VM_STORAGE_INSUFFICIENT`, `canProvision: false`.
- UTM chưa cài.
- Không xóa dữ liệu host và không tải image để vượt blocker này. Cần thêm dung lượng, đặt `--vm-root` ở ổ khác, hoặc dùng máy Linux amd64 riêng.

`node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-arm64 --json` trên host này thoát với mã 2: `PROFILE_PLATFORM_MISMATCH`, `OS_MISMATCH`, `INVENTORY_UNRESOLVED`, `PACKAGE_MISSING:*` (không phải Linux, không có ROS).

## Quy trình qualify một target (chưa thực hiện)

Chỉ trên Linux Ubuntu 24.04 đúng kiến trúc, trong môi trường cô lập có đủ RAM/ổ đĩa:

1. Cài các package trong `required` từ apt chính thức ROS Jazzy; không cài plugin phần cứng.
2. Chụp inventory thật: `dpkg-query -W -f='${binary:Package}\t${db:Status-Abbrev}\t${Version}\n'`; ghi vào `packages` (kèm `required` phải đều có version).
3. Pin commit và license vendor (`xarm_ros2` nhánh Jazzy, mesh) ở C01; ghi digest plugin/model vào `digests`.
4. Chạy world Gazebo tối thiểu cùng controller manager và một sensor topic; ghi lệnh, log, bộ nhớ, real-time factor, chế độ headless.
5. Chỉ khi smoke pass mới đổi `qualification` thành `qualified`; `node scripts/lab-sil.mjs doctor ... --environment-profile engineering-<arch>` phải thoát 0.

Mọi số liệu RTF/bộ nhớ/phiên bản chưa đo ở đây là **not_run**; không ước lượng lịch trước khi có hai spike native (README plan).
