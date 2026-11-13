# Simulation extension R1.1 — r11-candidate-03 (tay máy 6 khớp trong Webots)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r1.1` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder, chọn bảng `r1.1` theo `release`). Cả bốn gate ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted, trong một sidecar `acceptance.json` riêng: **chưa có sidecar nào cho bản ghi này**. Không có case `not_run`.

R1.1 không ghi campaign: bằng chứng engine là các suite chạy trên Webots R2025a thật (không suite nào bị skip). REG02 đòi bản ghi R1, IR-SIM và R-MOCK **cùng commit** và mọi gate của chúng `tested` (D32): các bản sao `r1-record.json`, `irsim-record.json`, `mock-regression.json` nằm cạnh bản ghi này (kiểm sha), và guard đòi chúng đúng bằng bản trong cây (`sim-extension/r1-candidate-06`, `linkforge-irsim/candidate-08`) và IR-SIM/R-MOCK là đúng bản mà bản ghi R1 đã dùng. Bản ghi này là đầu vào REG03 của `sim-extension/r2a-candidate-01`.

Thay thế `r11-candidate-02` (ghi trên `9b8f92f`, xóa khỏi cây cùng sidecar `acceptance.json` của nó, còn trong lịch sử git). Lần chấp nhận của Henry ngày 2026-11-11 thuộc `r11-candidate-02` (cùng `candidate-07` và `r1-candidate-05`), **không** chuyển sang bản ghi này. Ghi lại vì công việc R2a (tay máy MuJoCo, mô phỏng từ web, UI gọn) đổi runtime, và REG03 đòi mọi bản ghi cũ ghi lại trên cùng commit với `r2a-candidate-01`. Riêng Webots: từ source `bb16724` worker khởi động Webots không cửa sổ bằng `--batch --no-rendering --mode=fast` thay cho `--minimize`, vì trên máy này (macOS) Webots R2025a chạy thu nhỏ có lúc không nạp world nữa sau vài instance bị kill (`WEBOTS_START_FAILED` sau 60 s), còn khởi động thường mất 1–2 s; scan lidar và pose đọc lại đã được so khớp từng bit giữa có và không có render. Chế độ xem (watch) không đổi. Không gate hay case nào đổi trạng thái.

**Lần ghi đầu thất bại, bản này là lần ghi lại.** Lần ghi `r11-candidate-03` đầu tiên trên cùng commit dừng với exit 1 (`SUITE_FAILED:arm-faults`; WA06, INT14 `failed`; G-WA2, G-INT3 `not_run`): trong `arm-faults`, hai test ngay sau test SIGKILL worker ("SIGKILL of Webots in the middle of cup-place" và "a cancel while the arm holds the cup does not release it") trượt với `WEBOTS_ARM_CREATE_FAILED: WEBOTS_START_FAILED` sau 1,4 s và 1,3 s. Chạy riêng file đó thì qua 7/7, và lần ghi lại (bản này) qua 7/7. **Chưa tìm ra nguyên nhân.** Bản hỏng không được sửa tay và không được đưa vào cây.

**Giới hạn của bản ghi:** không có artifact của run nào được giữ lại (không `arm-trace.json`, không report); bằng chứng là kết quả pass/fail của các suite và một ảnh chụp. Sai số bám thực tế chỉ xem được bằng cách chạy lại `tests/integration/webots-arm-bv01.test.ts`. Mọi lệnh ghi phải chạy dưới `caffeinate -dims` với màn hình mở khóa: máy này đặt `pmset sleep 1`, nên khi không có người dùng máy tự ngủ và run Webots đang chạy hiện ra thành `RUN_TIMEOUT`.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `bb16724859ee8377be62389a851ac36ea4a0309a` (sạch; closure portable `6df2f71fc1638075…`) |
| Lab commit / pin | `832c84fa0bdac2c18d44a4f102337533d1904436` / pin source `bb16724`, artifact `67a1a20cf12f7904…` |
| Webots | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `5a79d629e9768464…` (đổi so với `r11-candidate-02` vì R2a thêm khối `mujocoArm`; khối `webotsArm` không đổi) |
| Ghi lúc | 2026-11-13T13:34:46.977Z → 2026-11-13T13:38:33.146Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |
| Bản ghi nền | `r1-candidate-06` (R1), `candidate-08` (LinkForge + IR-SIM), `lab/docs/implementation/evidence/sim-extension-r2a/regression` (R-MOCK), cùng commit |

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
| arm-py | 78 / 78 |
| arm-worker | 5 / 5 |
| arm-programs | 25 / 25 |
| arm-bv01 | 7 / 7 |
| arm-faults | 11 / 11 |
| arm-regress | 16 / 16 |
| lab-arm-unit | 28 / 28 |
| lab-e2e-webots-coffee | 1 / 1 |

`arm-worker`, `arm-programs`, `arm-bv01`, `arm-faults` và `lab-e2e-webots-coffee` chạy trên Webots thật; `screens/webots-coffee.png` là ảnh Lab đang chạy `WB-BV01` (chỉ là bằng chứng ứng viên, không phải bằng chứng backend).

## Không được suy ra từ các gate này

Lực gắp, cốc trượt hay đổ (gắp là **sự kiện** của máy trạng thái, không phải vật lý), tải thật của tay máy, an toàn người, hành vi LinuxCNC/MoveIt, tay máy sản phẩm, và mọi gate của native/Linux hoặc phần cứng (`not_run` / `blocked_external`, ngoài phạm vi). Tay máy MuJoCo có bản ghi riêng (`r2a-candidate-01`).

## Cần đọc trước khi dùng kết quả

- **Mọi tham số vật lý của tay máy là `assumed`** (khối lượng, quán tính, `effort`, ma sát; fixture `arm-ref-3d-v1`), kết quả là `not_calibrated`. Kết quả cho thấy plant Webots bám lệnh khớp trong ngưỡng, không cho thấy một tay máy thật làm được.
- Các ngưỡng `webotsArm` trong oracle profile (`reachTolRad` 0.01, `settleTicks` 10, `followTolRad` 0.05, `followTicks` 10, `repeatJointRad` 1e-6) là **ngưỡng kiểm thử ban đầu chọn từ spike X00** (sai số bám thường đạt đỉnh 0.0168 rad, ổn định sau 2–3 tick, tay bị chặn vượt 0.05 rad), không phải năng lực đo được của tay máy nào.
- ARM03 chạy trên khớp **thực** từ Webots (capsule-sweep của mock), không phải kiểm tra va chạm của engine; engine chỉ báo va chạm qua tiếp xúc, và tiếp xúc giữa hai link tay máy là `engine:unattributed`.
- Webots không tái lập bit; WA07 so khớp trong `repeatJointRad`, không so digest.
- Hai suite Lab e2e của R1 (`webots-journey`, `webots-fleet`) được chạy lại trong `r1-candidate-06`, không phải ở đây.
- Webots là phần mềm cục bộ ngoài repo (`/Applications/Webots.app`, R2025a); recorder khóa theo sha256 của executable.

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này; r1-candidate-06, candidate-08 và regression ghi trên cùng commit; màn hình mở khóa)
caffeinate -dims node scripts/record-sim-extension.mjs --release r1.1 --out <dir mới> --candidate-id <id> \
  --r1-record <r1 record dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<dir> pnpm test:acceptance -- sim-extension
```
