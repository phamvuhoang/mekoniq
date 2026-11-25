# Verification và qualification

Thuộc [spec chính](README.md). Mọi case dưới đây là tiêu chí phải thực hiện, **chưa có case nào được ghi pass trong bộ spec này**.

## 1. Ma trận kiểm chứng

| Case | Yêu cầu | Test và kết quả bắt buộc | Môi trường/gate |
|---|---|---|---|
| V01 | PHY-01/04 | Đổi wheel radius 0,075→0,10 m; scene, URDF, controller và run dùng đúng giá trị mới, digest đổi; run cũ bất biến | Portable/G0 |
| V02 | PHY-02/03 | Reject assembly cycle, mount sai, 24 V→5 V không DC/DC, thiếu inertia, overload; BOM thiếu giá vẫn null | Portable/G0 |
| V03 | PHY-02/04 | Tensor/COM analytical fixture đúng; displaced battery làm COM dịch đúng; imported mesh/license/hash closure đầy đủ | Portable/G0 |
| V04 | PHY-01/10 | Legacy v1/v2 mở được; engineering draft thiếu data bị chặn; old runtime từ chối capability; sai digest/owner/path bị chặn | Portable/G0 |
| V05 | PHY-05 | FD01 với Nav2 tới load/table/return; sensor và odom có nguồn; arrival không do UI tự đặt | Linux/G1 |
| V06 | PHY-05/12 | Straight 2 m, turn 90°, stop từ 0,3 m/s ở empty/full payload; lưu distance/settling/effort/contact và model assumptions | Linux/G1; calibrated targets ở G3 |
| V07 | PHY-05/10 | Obstacle, localization loss, saturation, missing sensor; dừng/attention, không xuyên vật hoặc false arrival | Linux/G1 |
| V08 | PHY-06 | Vendor joint count/limits/TCP đúng; reachable target thành công; unreachable/self/world collision bị từ chối; stale scene không execute | Portable + Linux/G1 arm |
| V09 | PHY-07 | Lift/hold/place cốc thật trong world; grasp/release đủ evidence; negative low-friction/low-force làm fail, không pose teleport | Linux/G2 |
| V10 | PHY-07/09 | AMR drift, missing tray cup, stale/reordered/duplicate observation, restart sau release; không double-custody/false confirm/replay motion | Portable + Linux/G2 |
| V11 | PHY-08 | Flow integrate, resource/mass conservation, variable mass trong physics, no cup/blocked flow/stockout; thermal absent → unavailable | Portable + Linux/G2 |
| V12 | PHY-09/10 | Pause/slow engine/epoch reset/worker death, evidence overflow; deadline đúng clock, evidence gap chặn pass | Portable + Linux/G1/G2 |
| V13 | PHY-09 | BV01 order→brew→pick→tray→table→confirm và FD01; cùng domain sequence với mock theo semantic assertions | Linux/G2 |
| V14 | PHY-10/11 | Catalog→assembly→layout→preflight→run→report/replay, VI/JA/EN, 2D fallback; edited project làm evidence stale | Browser/G0 và native integration |
| V15 | PHY-02/10/12 | Clean runtime export/import/rollback; offline catalog/model closure; changed blob/pin và missing mesh bị chặn | Portable + target clean machine |
| V16 | PHY-12 | Calibration dataset độc lập, units/time alignment/uncertainty, residual + out-of-domain reject, report chỉ nâng capability có dữ liệu | Portable + measured datasets/G3 |
| V17 | PHY-01/04/13 | Đổi world bounds/obstacle → occupancy/scene đổi; đổi table/handoff/yaw → binding/goal đổi; speed limit đi vào admission/Nav2/controller; project/bundle hash đổi, run cũ bất biến | Portable/G0 + FD01 native/G1 |
| V18 | PHY-09/13 | BV01 legacy và engineering dùng đúng provider roles; thiếu LinuxCNC không chặn engineering, thiếu MoveIt không chặn legacy; health/readiness/admission/CLI/report nhất quán; mock/mixed/hai AMR không đổi | Portable/G0 + native target tương ứng |
| V19 | PHY-01/10/13 | Twin gửi engineeringRef qua client v2 thật; readiness/create/reset giữ cùng bundle; edit draft không đổi lockedInput; restart/pair/reclaim giữ scene/blob access, view/reconcile không replay motion; thiếu closure chặn reset | Portable + browser/G0; native lifecycle/G2 |
| V20 | PHY-11/13 | Lưu/reload/import/export/undo/redo EngineeringProject với blob closure; migration/quota failure không mất original/active pointer; legacy candidate còn xuất được; engineering candidate khớp snapshot và không nhận evidence khác revision làm current | Portable + browser/G0 |
| V21 | PHY-13 | NR01–NR12 có kết quả từng test trước/sau; UI/inputs/fault schedule/mixed campaign thực chạy bằng launcher đúng; không bỏ test hoặc đổi thành skip để có pass | Portable + browser; gate bảo toàn bắt buộc |

## 2. Ngưỡng và cách đo

Numerical compiler tests: length/mass sai số tuyệt đối ≤1e-9 SI trên fixtures giải tích; tensor ≤1e-8 kg·m². Đây là test tính toán, không yêu cầu phép đo thực chính xác đến mức đó. Frame roundtrip quaternion so góc ≤1e-8 rad, không so dấu quaternion trực tiếp.

G1/G2 chạy seed 23/41/67, mỗi seed lặp 3 lần trên cùng qualified target. Cả 9 run phải không có false custody/served hoặc forbidden contact; tổng 9 pass không phải ước lượng độ tin cậy production. Contact hợp lệ gồm wheel/floor, jaw/cup, cup/tray và fixture support đã allowlist; contact ngoài allowlist phải có severity và event. Không dùng “zero contacts” làm điều kiện chung.

Reference targets: FD01 final pose ≤50 mm/5°; handoff dùng ngưỡng chặt hơn trong [runtime](simulation-runtime.md). Arm target position ≤5 mm/orientation ≤3° trong mô hình; trajectory không vượt joint bounds, có settled feedback. Cup drift/lift/tilt theo runtime. Process 200 ml fixture dùng density 1.000 kg/m³: mass tăng 0,2 kg với numerical error ≤0,1%; nguồn density fixture là assumed. RTF được báo cáo, không bị lẫn với cycle time sim. Dock/approach có timeout 120 s sim, arm stage 30 s sim, brew theo recipe; startup/watchdog transport mặc định 60 s/5 s wall. Đổi timeout phải pin fixture/profile mới.

Re-run cùng target so completion, order invariants, min clearance và deviations; cycle time lệch ≤5%, final pose lệch ≤10 mm/1° giữa các lần là reference reproducibility target. Fail tolerance được ghi fail và điều tra solver/model; không xóa run xấu. Không áp dụng tolerance này xuyên ARM64/amd64 mà không qualification riêng.

## 3. Calibration G3

Dữ liệu đo là đầu vào có nguồn, không được tạo bằng simulator rồi gọi là thực đo. Dataset gồm configuration/serial, instrument/calibration revision, timestamp/clock mapping, units, sample rate, ambient/test setup, uncertainty và raw hash. Train/tune và validation sets tách theo trial, không chia ngẫu nhiên samples của một trial sang cả hai.

| Đại lượng | Thí nghiệm | Reference acceptance cần owner duyệt trước khi đo |
|---|---|---|
| AMR motion | Empty/full payload, nhiều tốc độ, straight/turn/brake | Stop distance sai số ≤max(20 mm,10% measured); cycle time ±10% |
| Drive/energy | Current vs speed/load, battery voltage sag, idle/process consumption | Energy/trip ±15%; torque/current curve không vượt envelope hãng đã pin |
| Arm/tool | Joint/Cartesian tracking, tool/cup tải khác nhau | TCP residual ≤max(5 mm,3×measurement uncertainty); cycle time ±10% |
| Grip | Nhiều mức fill, jaw/friction/load, lift/hold/place | Không false positive grip trên validation trials; coverage nêu rõ số trial và miền tải |
| Process | Dispensed mass/time, stock loss, temperature nếu model bật | Mass ±max(2 g,2% measured); nhiệt ±2°C khi có calibration |

Các ngưỡng là mục tiêu engineering đề xuất, không là thông số hãng. Nếu không có dữ liệu đo/thiết bị, G3 là `not_run: CALIBRATION_DATA_REQUIRED`; vẫn có thể hoàn thành G0/G1/G2 đúng scope. Không hạ ngưỡng sau khi xem kết quả để tạo pass. Calibration chỉ có hiệu lực trong miền dữ liệu và đúng component/assembly/model revision; thay đổi liên quan làm stale.

## 4. Artifact và gate decision

Mỗi campaign lưu `manifest.json`, `inventory.json`, `cases.json`, raw observations, engine/controller logs, report, profile lock, calibration refs và SHA256SUMS. `cases.json` từng case có ID, target, commit/artifact, start/end, command, exit, `pass | fail | not_run`, reason, artifact refs. Thiếu dependency không tạo fake native pass. Report fixture và portable mock chỉ chứng minh parser/workflow, không chứng minh engine.

G0 cần V01–04 và portable portions V08/V10–12/V14–20, cùng V21 trên các capability đang hoạt động. G1 cần G0 + V05–08/V12/V17 native. G2 cần G1 + V09–13/V19 native và V14 native browser. V18 native xác nhận provider routing trên mỗi target được công bố; target legacy chưa có môi trường giữ not_run rõ, không được mất portable coverage đã có. Distribution gate riêng cần V15 trên target sạch. G3 cần dữ liệu thật + V16 và residual trong ngưỡng được duyệt. Acceptance decision có reviewer/date/scope; `test pass` và `accepted` là hai trường riêng.

## 5. Hồi quy bắt buộc

Chạy suite contracts/source liên quan, Python compiler/bridge, Lab unit/integration/typecheck/build và toàn bộ [ma trận NR01–NR12](compatibility.md). Giữ FD01/BV01 mock, mixed workload, campaign hai AMR, S01, legacy PUMA/LinuxCNC contract/replay và runtime rollback. Profile mới không sửa kết luận lịch sử. Browser smoke phải dùng artifact sạch mới export, không dùng source HEAD chưa pin.

`pnpm test` chỉ chạy Vitest; `test:twin-e2e` hiện chỉ có ba spec và không thay được UI/input/fault regression. Gate D03 phải chạy thêm `ui.spec.ts`, `twin-inputs.spec.ts`, `fault-schedule.spec.ts`, brand/accessibility và mixed campaign browser được thêm ở D01. Các spec cần pairing phải chạy qua launcher có token và journal tạm, không chạy trần rồi nhận skip là pass. Mỗi NR row ghi testcase/command/commit/pin, số pass/fail/skip và artifact; baseline pass chuyển sang skipped/not_run hoặc chức năng mất đường truy cập là fail bảo toàn. External/native gate vốn not_run được giữ riêng, không suy thành pass hoặc làm mất khả năng chạy mock/thiết kế offline.

Các lệnh chính xác và files test được phân công trong [implementation plans](../../plans/2026-11-06-physical-robot-lab/README.md). Không cần chạy ROS, provision VM hay test phần cứng để duyệt tài liệu này.
