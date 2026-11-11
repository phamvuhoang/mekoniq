# Simulation extension R1.1 — r11-candidate-02 (tay máy 6 khớp trong Webots)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r1.1` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder, chọn bảng `r1.1` theo `release`). Cả bốn gate ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted: reviewer Henry đã chấp nhận bốn gate ngày 2026-11-11 trong sidecar `acceptance.json`. Không có case `not_run`.

R1.1 không ghi campaign: bằng chứng engine là các suite chạy trên Webots R2025a thật (không suite nào bị skip). REG02 đòi bản ghi R1, IR-SIM và R-MOCK **cùng commit** và mọi gate của chúng `tested` (D32): các bản sao `r1-record.json`, `irsim-record.json`, `mock-regression.json` nằm cạnh bản ghi này (kiểm sha), và guard đòi chúng đúng bằng bản trong cây (`sim-extension/r1-candidate-05`, `linkforge-irsim/candidate-07`) và IR-SIM/R-MOCK là đúng bản mà bản ghi R1 đã dùng.

Thay thế `r11-candidate-01` (ghi trên `fa857d9`, xóa khỏi cây, còn trong lịch sử git; chưa từng có sidecar acceptance): sau review R1.1 runtime đổi ở commit `9b8f92f` (readiness không smoke run đang giữ engine; seed engine ghi đúng giá trị engine nhận; tay máy dừng thì giữ nguyên vị trí thực). Không gate hay case nào đổi trạng thái; `arm-programs` thêm một test hồi quy (tay máy dừng thì giữ vị trí thực).

**Giới hạn của bản ghi:** không có artifact của run nào được giữ lại (không `arm-trace.json`, không report); bằng chứng là kết quả pass/fail của các suite và một ảnh chụp. Sai số bám thực tế chỉ xem được bằng cách chạy lại `tests/integration/webots-arm-bv01.test.ts`. Mọi lệnh ghi phải chạy dưới `caffeinate -dims`: máy này đặt `pmset sleep 1`, nên khi không có người dùng máy tự ngủ giữa campaign và run Webots đang chạy hiện ra thành `RUN_TIMEOUT`.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `9b8f92f1c76cd7283030e46adf93f2d6527cb4bd` (sạch; closure portable `20026af64e9f513a…`) |
| Lab commit / pin | `26a679dacac7065b8daa70e94d662a5cb6a98e5a` / pin source `9b8f92f`, artifact `fcbbff2522ae8bd3…` |
| Webots | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `f26c8ea34e5afafd…` |
| Ghi lúc | 2026-11-11T12:32:34.580Z → 2026-11-11T12:36:47.803Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |
| Bản ghi nền | `r1-candidate-05` (R1), `candidate-07` (LinkForge + IR-SIM), `lab/docs/implementation/evidence/sim-extension-r11/regression-02` (R-MOCK), cùng commit |

## Gate (chỉ reviewer mới ghi accepted)

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-WA1 | tested | false | WA01, WA02, WA03 |
| G-WA2 | tested | false | WA04, WA05, WA06, WA07, WA08 |
| G-INT3 | tested | false | INT13, INT14 |
| G-REG2 | tested | false | REG02 |

## Case

| Case | Trạng thái | Bằng chứng |
|---|---|---|
| WA01 | tested | suite:arm-static, suite:arm-py |
| WA02 | tested | suite:arm-worker |
| WA03 | tested | suite:arm-worker, suite:arm-py |
| WA04 | tested | suite:arm-programs |
| WA05 | tested | suite:arm-bv01 |
| WA06 | tested | suite:arm-faults |
| WA07 | tested | suite:arm-bv01 |
| WA08 | tested | suite:arm-bv01, suite:lab-arm-unit |
| INT13 | tested | suite:lab-e2e-webots-coffee, suite:lab-arm-unit |
| INT14 | tested | suite:arm-static, suite:arm-regress, suite:arm-faults |
| REG02 | tested | record:linkforge-irsim, record:mock-regression, record:r1 |

| Suite | Pass / tổng |
|---|---|
| arm-static | 20 / 20 |
| arm-py | 74 / 74 |
| arm-worker | 5 / 5 |
| arm-programs | 25 / 25 |
| arm-bv01 | 7 / 7 |
| arm-faults | 11 / 11 |
| arm-regress | 16 / 16 |
| lab-arm-unit | 28 / 28 |
| lab-e2e-webots-coffee | 1 / 1 |

`arm-worker`, `arm-programs`, `arm-bv01`, `arm-faults` và `lab-e2e-webots-coffee` chạy trên Webots thật; `screens/webots-coffee.png` là ảnh Lab đang chạy `WB-BV01` (chỉ là bằng chứng ứng viên, không phải bằng chứng backend).

## Không được suy ra từ các gate này

Lực gắp, cốc trượt hay đổ (gắp là **sự kiện** của máy trạng thái, không phải vật lý), tải thật của tay máy, an toàn người, hành vi LinuxCNC/MoveIt, tay máy sản phẩm, và mọi gate của MuJoCo, native/Linux hoặc phần cứng (`not_run` / `blocked_external`, ngoài phạm vi).

## Cần đọc trước khi dùng kết quả

- **Mọi tham số vật lý của tay máy là `assumed`** (khối lượng, quán tính, `effort`, ma sát; fixture `arm-ref-3d-v1`), kết quả là `not_calibrated`. Kết quả cho thấy plant Webots bám lệnh khớp trong ngưỡng, không cho thấy một tay máy thật làm được.
- Các ngưỡng `webotsArm` trong oracle profile (`reachTolRad` 0.01, `settleTicks` 10, `followTolRad` 0.05, `followTicks` 10, `repeatJointRad` 1e-6) là **ngưỡng kiểm thử ban đầu chọn từ spike X00** (sai số bám thường đạt đỉnh 0.0168 rad, ổn định sau 2–3 tick, tay bị chặn vượt 0.05 rad), không phải năng lực đo được của tay máy nào.
- ARM03 chạy trên khớp **thực** từ Webots (capsule-sweep của mock), không phải kiểm tra va chạm của engine; engine chỉ báo va chạm qua tiếp xúc, và tiếp xúc giữa hai link tay máy là `engine:unattributed`.
- Webots không tái lập bit; WA07 so khớp trong `repeatJointRad`, không so digest.
- Hai suite Lab e2e của R1 (`webots-journey`, `webots-fleet`) được chạy lại trong `r1-candidate-05`, không phải ở đây.
- Webots là phần mềm cục bộ ngoài repo (`/Applications/Webots.app`, R2025a); recorder khóa theo sha256 của executable. Thư mục thừa trong `/tmp/webots/default` do các lần kill engine trước R1.1 vẫn còn trên máy này (chỉ rác `/tmp`).

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này; r1-candidate-05, candidate-07 và regression ghi trên cùng commit)
caffeinate -dims node scripts/record-sim-extension.mjs --release r1.1 --out <dir mới> --candidate-id <id> \
  --r1-record <r1 record dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<dir> pnpm test:acceptance -- sim-extension
```
