# Simulation extension R1 — r1-candidate-06 (Webots 3D + thuật toán tham chiếu)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r1` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder và đòi `candidate-08` trong cây khớp bản sao). Mọi gate ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted, trong một sidecar `acceptance.json` riêng: **chưa có sidecar nào cho bản ghi này**. **ALG04 là `not_run`** (thuộc R3: cần bridge LinuxCNC đang chạy). Là đầu vào của `sim-extension/r11-candidate-03` (REG02) và `sim-extension/r2a-candidate-01` (REG03).

Thay thế `r1-candidate-05` (ghi trên `9b8f92f`, xóa khỏi cây cùng sidecar `acceptance.json` của nó, còn trong lịch sử git). Lần chấp nhận của Henry ngày 2026-11-11 thuộc `r1-candidate-05` (cùng `candidate-07` và `r11-candidate-02`), **không** chuyển sang bản ghi này. Ghi lại vì công việc R2a (tay máy MuJoCo, mô phỏng từ web, UI gọn) đổi runtime, và REG03 đòi mọi bản ghi cũ ghi lại trên cùng commit với `r2a-candidate-01`. Riêng Webots: từ source `bb16724` worker khởi động Webots không cửa sổ bằng `--batch --no-rendering --mode=fast` thay cho `--minimize`, vì trên máy này (macOS) Webots R2025a chạy thu nhỏ có lúc không nạp world nữa sau vài instance bị kill (`WEBOTS_START_FAILED` sau 60 s), còn khởi động thường mất 1–2 s; scan lidar và pose đọc lại đã được so khớp từng bit giữa có và không có render. Chế độ xem (watch) không đổi. Không gate hay case nào đổi trạng thái. Mọi lệnh ghi phải chạy dưới `caffeinate -dims` với màn hình mở khóa: máy này đặt `pmset sleep 1`, nên khi không có người dùng máy tự ngủ giữa campaign và run Webots đang chạy hiện ra thành `RUN_TIMEOUT`.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `bb16724859ee8377be62389a851ac36ea4a0309a` (sạch; closure portable `6df2f71fc1638075…`) |
| Lab commit / pin | `832c84fa0bdac2c18d44a4f102337533d1904436` / pin source `bb16724`, artifact `67a1a20cf12f7904…` |
| Webots | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `5a79d629e9768464…` (R2a thêm khối `mujocoArm`; các khối R1 không đổi) |
| Campaign | `r1-qualification`, 20 run, `completed`, `complete` true (2026-11-13T13:04:41Z → 13:18:48Z) |
| Ghi lúc | 2026-11-13T13:03:49.046Z → 2026-11-13T13:28:15.496Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |

## Gate (chỉ reviewer mới ghi accepted)

| Gate | Trạng thái | accepted | Case | Không được suy ra |
|---|---|---|---|---|
| G-ALG1 | tested | false | ALG01, ALG02, ALG03, ALG05 | Tay máy thật, va chạm, MoveIt/LinuxCNC |
| G-ALG2 | tested | false | PID01, PID02, PID03 | Chất lượng điều khiển trên plant 3D hay robot thật |
| G-WB1 | tested | false | WB01, WB02, WB08 | Dynamics đúng; cảm biến thật |
| G-WB2 | tested | false | WB03, WB04, WB05, WB06, WB07 | MuJoCo, Nav2, ổn định tải, an toàn |
| G-INT2 | tested | false | INT11, INT12 | Bất kỳ provider nào khác |
| G-REG1 | tested | false | REG01 | `accepted` cho gate cũ |

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú / lý do |
|---|---|---|---|
| ALG01 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG01 |  |
| ALG02 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG02 |  |
| ALG03 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG03 |  |
| ALG05 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG05 |  |
| ALG04 | not_run |  | R3: the joint trace needs a running LinuxCNC bridge |
| PID01 | tested | suite:alg-ts, suite:alg-py, algorithm:PID01 |  |
| PID02 | tested | suite:alg-ts, suite:alg-py, algorithm:PID02 |  |
| PID03 | tested | suite:alg-ts, suite:alg-py, algorithm:PID03 |  |
| WB01 | tested | suite:wb-static, suite:wb-py, suite:wb-worker |  |
| WB02 | tested | suite:wb-static, suite:wb-py, suite:wb-worker |  |
| WB08 | tested | suite:wb-py, suite:wb-worker |  |
| WB03 | tested | suite:wb-mission, campaign:WB-FD01 |  |
| WB04 | tested | suite:wb-fleet, campaign:WB-FD07 | source-driven WB-FD07 missions are serialized by the __venue_movement__ reservation (both robots move, one at a time); there is no zone-contention rig for Webots in Release 1, so zone contention is not proven here |
| WB05 | tested | suite:wb-faults, campaign:WB-FD01-cancel, campaign:WB-FD01-enginekill |  |
| WB06 | tested | suite:wb-evidence, suite:wb-batch, campaign:WB-FD01, campaign:WB-FD07 |  |
| WB07 | tested | suite:wb-evidence, campaign:WB-FD01, campaign:WB-FD07 |  |
| INT11 | tested | suite:lab-e2e-webots-journey, suite:lab-e2e-webots-fleet |  |
| INT12 | tested | suite:wb-worker, suite:int-regress, suite:lab-unit |  |
| REG01 | tested | suite:int-regress, record:linkforge-irsim, record:mock-regression |  |

| Suite | Pass / tổng |
|---|---|
| alg-ts | 26 / 26 |
| alg-py | 16 / 16 |
| wb-static | 25 / 25 |
| wb-py | 78 / 78 |
| wb-worker | 14 / 14 |
| wb-mission | 1 / 1 |
| wb-fleet | 1 / 1 |
| wb-faults | 10 / 10 |
| wb-evidence | 2 / 2 |
| wb-batch | 4 / 4 |
| int-regress | 52 / 52 |
| lab-unit | 38 / 38 |
| lab-e2e-webots-journey | 1 / 1 |
| lab-e2e-webots-fleet | 1 / 1 |

## Đo hiệu năng (một phép đo, không phải gate)

`performance.json`: WB-FD07, 1500 tick (30 s mô phỏng), Apple M2 Pro, 16 GiB. Mỗi tick là trung bình trên lô 50 tick; lô đầu gồm cả lúc nạp world. Đo với Webots khởi động `--no-rendering` (xem trên); `r1-candidate-05` đo với `--minimize`.

| | Giá trị |
|---|---|
| Thời gian mỗi tick p50 / p95 / max | 5.5 / 11.9 / 14.5 ms |
| Realtime factor | 2.51 |
| RSS Webots / controller (max) | 360 / 54 MiB |

## Cần đọc trước khi dùng kết quả

- **Mọi tham số vật lý của plant 3D là `assumed`** (kích thước, khối lượng, caster, chiều cao/ma sát của world3d — xem `serve-3d-v1/manifest.json` và `physical-model-*.json`). Plant 3D chưa được hiệu chuẩn; kết quả không nói gì về drive hay robot thật. PID01–03 cũng dùng plant bậc nhất suy từ các giá trị `assumed` đó, và `pid-v1` chưa được plant nào dùng.
- Webots không tái lập bit (sai lệch ~1e-12 m giữa các lần chạy); WB06 so **pose** trong `webots.repeatPoseM` = 1e-6 m và cùng outcome, không so digest.
- LiDAR của Webots **không thấy thân robot** khác. Mô-men bánh bị giới hạn bằng effort 6 N·m của khớp, không theo đường cong mô-men–tốc độ.
- WB-FD07 không có khách (actor) và **không có rig tranh chấp zone** (xem ghi chú WB04); tranh chấp chỉ được chứng minh trên IR-SIM bằng `IR-RIG-ZONE`.
- TS `jacobianCondition` mất độ chính xác khi số điều kiện > 1000.
- Giấy phép: `xacro` không có metadata license (`UNKNOWN`); xem `suites/licenses.log`.
- Seed của engine: `engine_seed` lấy 31 bit thấp của seed uint32 (R1.1, D31); run gửi và bằng chứng ghi đúng giá trị 31 bit đó.
- Webots là phần mềm cục bộ ngoài repo (`/Applications/Webots.app`, R2025a), không nằm trong closure; recorder khóa theo sha256 của executable.

## Cách dựng bằng chứng

`candidate-08` (IR-SIM) và regression R-MOCK của Lab (`lab/docs/implementation/evidence/sim-extension-r2a/regression`) phải được ghi trên **đúng commit** `bb16724` / `832c84f`, nhưng recorder đòi cây sạch. Vì vậy chuỗi regression → `candidate-08` → `r1-candidate-06` → `r11-candidate-03` → `r2a-candidate-01` được ghi ngoài cả hai cây (bản sao nằm trong `irsim-record.json` / `mock-regression.json`, kiểm sha), rồi được chép nguyên byte vào cây ở commit `docs: record …` cùng việc xóa `candidate-07`, `r1-candidate-05` và `r11-candidate-02` (bị thay thế; cùng sidecar acceptance của chúng vẫn nằm trong lịch sử git). Không bản ghi nào được sửa tay.

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này, màn hình mở khóa)
find robotics \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} +
caffeinate -dims node scripts/record-sim-extension.mjs --release r1 --out <dir mới> \
  --candidate-id <candidate> --irsim-record <candidate-08 dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<candidate dir> pnpm test:acceptance -- sim-extension
```
