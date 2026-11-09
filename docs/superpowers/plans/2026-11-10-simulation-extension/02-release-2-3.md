# Gói 02 — Release 2 (MuJoCo) và Release 3 (Linux): khung task

Đây là **khung**, chưa đủ chi tiết để thực thi. Mỗi release được viết lại thành plan đầy đủ (file, interface, test, lệnh) khi bắt đầu, vì hình dạng thật của `PlantPort`, `mekoniq-sim3d/1` và recorder chỉ chốt sau R1. Đọc [README](README.md) và spec §7, §8.

## Release 2 — MuJoCo

Điều kiện bắt đầu: W04 và W06 đã merge (runner chung, protocol 3D, fixture `serve-3d-v1`). Không cần G-WB2 `accepted`.

| Task | Nội dung | Đầu ra kiểm được |
|---|---|---|
| M00 | Probe: pin `mujoco-core` (4.0.0 nếu đã ≥ 4 tuần không có bản vá chặn, nếu không dòng 3.x mới nhất), venv `.venv-mujoco`, lock, license; đo bước headless, tính lặp lại cùng seed, p95 tick | Ghi chép trong `docs/research/`; quyết định timestep (ước của 20 ms) |
| M01 | Compiler MJCF từ `RobotPhysicalModelV1` + scene + `world3d` (không import URDF); actuator mô-men giới hạn theo đường cong drive; từ chối khối lượng ≤ 0, thiếu collision, khớp không hỗ trợ | pytest thuần; MJ01 parity đọc lại từ `mjModel` |
| M02 | `mujoco_worker` nói `mekoniq-sim3d/1`; `mujocoPlant: PlantPort`; **`pid-v1` đóng vòng tốc độ bánh trong TS mỗi tick** (lệnh là mô-men, không còn là `[v,ω]` → mở rộng payload `step` bằng nhánh có version); phát hiện nổ số → `PLANT_UNSTABLE` | Test clock/ACK như WB08; MJ05, MJ06 |
| M03 | Scenario tải trọng có version: khay rỗng/đầy/lệch (khối lượng tải `assumed`), vào cua, quét ma sát, dừng gấp, va chạm; stream evidence mới cho lực/điểm tiếp xúc và góc nghiêng | MJ02, MJ03, MJ04, MJ07 |
| M04 | So sánh ba engine trên cùng fixture theo bất biến (kết cục domain, thứ tự sự kiện, hành lang quỹ đạo) qua `comparison.ts`/`residuals.ts`; Lab thêm set + số liệu contact/tilt trong report; campaign + `record-sim-extension --release r2` | X01; gate `G-MJ1`, `G-X1`; `r2-candidate-01` |

Ràng buộc riêng: mọi report dynamics mang `not_calibrated`; lệch giữa engine là kết quả được ghi, không tự là fail; `G-MJ1` không nói gì về Webots và ngược lại.

Câu hỏi phải có câu trả lời trước M03 (không đoán): khối lượng và vị trí tải thực tế trên khay; ngưỡng nghiêng/trượt nào được coi là "không ổn định" — do kỹ sư robot ký, nếu chưa có thì report chỉ ghi số đo, không có verdict ổn định.

## Release 3 — Linux Integration

Điều kiện bắt đầu: có **host Linux thật** (máy vật lý hoặc VM cloud), Ubuntu 24.04. VM Linux chạy trên máy Mac phát triển chỉ dùng để diễn tập (`rehearsal:true`), không tạo được trạng thái `tested` (D15). Không có host → R3 `blocked_external`.

| Task | Nội dung | Đầu ra kiểm được |
|---|---|---|
| L00 | Trên Mac: cập nhật native handoff theo commit phát hành (digest fixture/model/URDF, đối chiếu `robotics/description/urdf/restaurant_robot.urdf.xacro` với model engineering); runbook từng lệnh cho DEP-NAV/DEP-CNC/DEP-SEC, log mong đợi, điều kiện dừng; recorder `record-sim-extension --release r3` từ chối `process.platform!=='linux'`, ghi `/etc/os-release`, kernel, arch, `systemd-detect-virt`, digest image | Recorder test bằng double; runbook review được. Không gate nào đổi |
| L01 | Trên Linux: dựng image theo `robotics/simulation/image.lock.json` (Jazzy + Harmonic), chạy demo Nav2 gốc để chứng minh host trước khi nối MEKONIQ; `node scripts/lab-sil.mjs doctor --backend gazebo_nav2` | Doctor xanh trên host; danh tính host được ghi |
| L02 | Chạy DEP-NAV-01..04 qua backend `gazebo_nav2` **hiện có**; sửa lỗi lộ ra khi chạy thật lần đầu (mỗi lỗi một commit có test); DEP-SEC-01 | Bằng chứng `G-NATIVE-AMR`: rosbag, journal, exit code |
| L03 | LinuxCNC 2.9.x uspace với cấu hình SIM của `integrations/arm-controller` (không HAL phần cứng); DEP-CNC-01..03; ALG04: Robotics Toolbox kiểm trace khớp thật `{tick,actualRad,commandedRad}`; ghi `r3-candidate-01` | Bằng chứng `G-NATIVE-ARM`; record `accepted:false` |

Ràng buộc riêng: không viết adapter mới, không đặt gate ID mới, không sửa `lab/config/simulation-compatibility.json`; không nâng pin ROS/Gazebo trong đợt nghiệm thu; SIM pass không phải nghiệm thu hardware, `G-HW` giữ `blocked_external`.

Câu hỏi phải có câu trả lời trước L01: host Linux nào, ai sở hữu, ai là reviewer đặt `acceptedBy`.
