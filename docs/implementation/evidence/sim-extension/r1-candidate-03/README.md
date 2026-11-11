# Simulation extension R1 — r1-candidate-03 (Webots 3D + thuật toán tham chiếu)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r1` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder và đòi `candidate-06` trong cây khớp bản sao). Mọi gate ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted. **ALG04 là `not_run`** (thuộc R3: cần bridge LinuxCNC đang chạy).

Thay thế `r1-candidate-02` (ghi trên `285bf53`, xóa khỏi cây cùng sidecar `acceptance.json` của nó, còn trong lịch sử git): R1.1 đổi closure portable, schema và runtime (tay máy trong Webots), nên theo D32 toàn bộ bằng chứng R1 được ghi lại trên commit R1.1. Không gate hay case nào đổi trạng thái. Bản ghi này **chưa được reviewer chấp nhận** (không có sidecar). Là đầu vào của `sim-extension/r11-candidate-01` (REG02).

Lần ghi đầu (cùng commit) dừng với `G-WB2 not_run`: hai run WB-FD07 (seed 200, 201) bị `RUN_TIMEOUT` 600 s (dừng ở tick 499 sau 1022 s và tick 6499 sau 685 s), 18 run còn lại pass với thời lượng như `r1-candidate-02`. Chạy riêng hai seed đó pass (66–67 s, 9747 tick). Nguyên nhân treo không xác định (không có sự kiện ngủ/khóa máy trong log điện năng); bản ghi đó không được sửa tay và không nằm trong cây, bản này là lần ghi kế tiếp.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `fa857d9bb1899e08c5e4f872ee9f3f3ef95fda08` (sạch; closure portable `20026af64e9f513a…`) |
| Lab commit / pin | `723d99ab76d28663c0f35cf326787016b5ef4feb` / pin source `fa857d9`, artifact `9c4ce1831d663f7a…` |
| Webots | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `f26c8ea34e5afafd…` |
| Ghi lúc | 2026-11-11T05:27:55.107Z → 2026-11-11T05:53:05.620Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |

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

## Đo hiệu năng (một phép đo, không phải gate)

`performance.json`: WB-FD07, 1500 tick (30 s mô phỏng), Apple M2 Pro, 16 GiB. Mỗi tick là trung bình trên lô 50 tick; lô đầu gồm cả lúc nạp world.

| | Giá trị |
|---|---|
| Thời gian mỗi tick p50 / p95 / max | 5.8 / 11.2 / 11.7 ms |
| Realtime factor | 2.58 |
| RSS Webots / controller (max) | 288 / 54 MiB |

## Cần đọc trước khi dùng kết quả

- **Mọi tham số vật lý của plant 3D là `assumed`** (kích thước, khối lượng, caster, chiều cao/ma sát của world3d — xem `serve-3d-v1/manifest.json` và `physical-model-*.json`). Plant 3D chưa được hiệu chuẩn; kết quả không nói gì về drive hay robot thật. PID01–03 cũng dùng plant bậc nhất suy từ các giá trị `assumed` đó, và `pid-v1` chưa được plant nào dùng.
- Webots không tái lập bit (sai lệch ~1e-12 m giữa các lần chạy); WB06 so **pose** trong `webots.repeatPoseM` = 1e-6 m và cùng outcome, không so digest.
- LiDAR của Webots **không thấy thân robot** khác. Mô-men bánh bị giới hạn bằng effort 6 N·m của khớp, không theo đường cong mô-men–tốc độ.
- WB-FD07 không có khách (actor) và **không có rig tranh chấp zone** (xem ghi chú WB04); tranh chấp chỉ được chứng minh trên IR-SIM bằng `IR-RIG-ZONE`.
- TS `jacobianCondition` mất độ chính xác khi số điều kiện > 1000.
- Giấy phép: `xacro` không có metadata license (`UNKNOWN`); xem `suites/licenses.log`.
- **Seed của engine:** R1.1 (D31, X04) đã sửa: `engine_seed` lấy 31 bit thấp của seed uint32 nên `WorldInfo.randomSeed` luôn trong `SFInt32`; có test (`test_session_arm.py`). Bản ghi `r1-candidate-02` trở về trước ghi giá trị > 2147483647 ở 14/20 run.
- **Thư mục tạm Webots:** R1.1 (D31) đã sửa: worker dò và dọn `/tmp/webots/default/<port>` (nơi Webots chạy không có `USER` thực sự ghi) và test đòi không còn thư mục sau `close`. Thư mục thừa do các lần kill engine **trước** R1.1 vẫn còn trong `/tmp/webots/default` của máy này (chỉ rác `/tmp`, không ảnh hưởng kết quả).
- Webots là phần mềm cục bộ ngoài repo (`/Applications/Webots.app`, R2025a), không nằm trong closure; recorder khóa theo sha256 của executable.

## Cách dựng bằng chứng

`candidate-06` (IR-SIM) và regression R-MOCK của Lab (`lab/docs/implementation/evidence/sim-extension-r11/regression`) phải được ghi trên **đúng commit** `fa857d9` / `723d99a`, nhưng recorder đòi cây sạch. Vì vậy hai đầu vào này được ghi trước, giữ ngoài cây trong lúc recorder chạy (bản sao nằm trong `irsim-record.json` / `mock-regression.json`, kiểm sha), rồi được đưa vào cây ở commit `docs: record …` này cùng việc xóa `candidate-05` và `r1-candidate-02` (bị thay thế; vẫn nằm trong lịch sử git). Không bản ghi nào được sửa tay.

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này)
find robotics -name __pycache__ -prune -exec rm -rf {} +
node scripts/record-sim-extension.mjs --release r1 --out docs/implementation/evidence/sim-extension/<candidate> \
  --candidate-id <candidate> --irsim-record <candidate-06 dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<candidate dir> pnpm test:acceptance -- sim-extension
```
