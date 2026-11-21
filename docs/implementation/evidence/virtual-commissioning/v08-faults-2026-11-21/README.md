# V08 — campaign fault-v1 (21/11/2026)

**Phạm vi:** lỗi drive, phản hồi, kênh lệnh và cảm biến chèn có biên nhận, báo cáo lỗi dựng lại từ stream. Không phải acceptance; mọi record `accepted:false`, mô hình `not_calibrated`, mọi số `assumed`.

| Mục | Giá trị |
|---|---|
| Source (producer, runtime) | `29510ae554171aea9f42d74efc1cb6c4bc1fa55b` |
| Lab pin | `4c2aaeb` (chore: pin source runtime 29510ae5) |
| Kết quả verify độc lập | `node scripts/lab-mujoco.mjs verify --input …` exit 0: **23/23**, 0 issue |
| Host | Darwin arm64, MuJoCo 3.17.0, Python 3.11 |
| Archive thô | `robot/evidence-archive/r4-fault-v1-29510ae5/` (1550 file, 301 MB, ngoài Git) |
| SHA-256 của `SHA256SUMS.txt` | `2845704db069422632e5d7dfc4272268f167244311f50e3bb6478350b36322f7` |
| Bản ghi đầu (bỏ) | `r4-fault-v1-f30e3bdb`: 18/23, tìm ra ba lỗi thật (xem RULINGS trong plan 02); giữ nguyên ngoài Git, không dùng làm bằng chứng |

Đọc `campaign.json` (bảng khóa trước, oracle sha256) và `summary.json` (phán quyết từng mục). Oracle: `robotics/simulation-mujoco/fixtures/fault-v1/fault-oracle-v1.json` (niêm phong, hash trong `campaign.json`).

## Phán quyết

11 `detected_in_time`, 11 `not_detected` (lỗi oracle không bắt buộc phát hiện), 1 `not_fired` (hẹn quá run). Mọi mục oracle **bắt buộc** (encoder-dropout, drive-trip, command-loss) và có bắn thì phát hiện đúng hạn; verifier tính lại báo cáo từ stream và so bằng băm với báo cáo; sáu invariant không có vi phạm ở run nào.

| Case | Mục | Phán quyết |
|---|---|---|
| m01-encoder-dropout-right | encoder-dropout-wheel-right-12000 | detected_in_time |
| m02-encoder-dropout-left | encoder-dropout-wheel-left-12000 | detected_in_time |
| m03-command-loss-right | command-loss-wheel-right-12000 | detected_in_time |
| m04-command-loss-left | command-loss-wheel-left-12000 | detected_in_time |
| m05-drive-trip-right | drive-trip-wheel-right-12000 | detected_in_time |
| m06-drive-trip-left | drive-trip-wheel-left-12000 | detected_in_time |
| m07-motor-weak-right | motor-weak-wheel-right-8000 | not_detected |
| m08-motor-weak-left | motor-weak-wheel-left-8000 | not_detected |
| m09-command-delay-right | command-delay-wheel-right-8000 | not_detected |
| m10-command-delay-left | command-delay-wheel-left-8000 | not_detected |
| m11-lidar-noise-a | lidar-noise-lidar-2d-8000 | not_detected |
| m12-lidar-noise-b | lidar-noise-lidar-2d-8000 | not_detected |
| m13-trip-then-reset | drive-trip-wheel-right-12000 | detected_in_time |
| m13-trip-then-reset | drive-reset-wheel-right-12020 | not_detected |
| m14-not-fired | encoder-dropout-wheel-right-3000000 | not_fired |
| c01-command-loss-left | command-loss-wheel-left-30000 | detected_in_time |
| c02-command-loss-right | command-loss-wheel-right-30000 | detected_in_time |
| c03-encoder-dropout-arm-j2 | encoder-dropout-J2-25000 | detected_in_time |
| c04-drive-trip-arm-j1 | drive-trip-J1-25000 | detected_in_time |
| c05-motor-weak-arm-j3 | motor-weak-J3-1000 | not_detected |
| c06-grip-weak-0.1 | grip-weak-gripper-0 | not_detected |
| c07-grip-weak-0.5 | grip-weak-gripper-0 | not_detected |
| c08-command-delay-right | command-delay-wheel-right-10000 | not_detected |

## Giới hạn

- `lidar-noise` chỉ có một cảm biến và `grip-weak` một trục kẹp: hai run của chúng khác tham số, không khác đối tượng. Cell không có biến đổi LiDAR.
- `CUSTODY_UNCHANGED` ở cell chỉ kiểm cốc không chuyển sang `unknown`; `NO_FALSE_SERVE` so journal với thời điểm trục chốt lỗi.
- Ý định lỗi của cell chỉ bền sau ACK (không có checkpoint hook); mobile ghi trước lệnh.
- Producer `29510ae5`; checker cùng commit. Chưa chạy lại trên Linux amd64 hay trong image cloud (CLD01/CLD02 cho V08 là bước riêng).
