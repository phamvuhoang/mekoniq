# Simulation extension R1.1 — r11-candidate-01 (tay máy 6 khớp trong Webots)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r1.1` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder, chọn bảng `r1.1` theo `release`). Cả bốn gate ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted (sidecar `acceptance.json`, chưa có). Không có case `not_run`.

R1.1 không ghi campaign: bằng chứng engine là các suite chạy trên Webots R2025a thật (không suite nào bị skip). REG02 đòi bản ghi R1, IR-SIM và R-MOCK **cùng commit** và mọi gate của chúng `tested` (D32): các bản sao `r1-record.json`, `irsim-record.json`, `mock-regression.json` nằm cạnh bản ghi này (kiểm sha), và guard đòi chúng đúng bằng bản trong cây (`sim-extension/r1-candidate-03`, `linkforge-irsim/candidate-06`) và IR-SIM/R-MOCK là đúng bản mà bản ghi R1 đã dùng.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `fa857d9bb1899e08c5e4f872ee9f3f3ef95fda08` (sạch; closure portable `20026af64e9f513a…`) |
| Lab commit / pin | `723d99ab76d28663c0f35cf326787016b5ef4feb` / pin source `fa857d9`, artifact `9c4ce1831d663f7a…` |
| Webots | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `f26c8ea34e5afafd…` |
| Ghi lúc | 2026-11-11T05:53:06.874Z → 2026-11-11T05:57:11.765Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |
| Bản ghi nền | `r1-candidate-03` (R1), `candidate-06` (LinkForge + IR-SIM), `lab/docs/implementation/evidence/sim-extension-r11/regression` (R-MOCK), cùng commit |

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
| arm-programs | 24 / 24 |
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
- Hai suite Lab e2e của R1 (`webots-journey`, `webots-fleet`) được chạy lại trong `r1-candidate-03`, không phải ở đây.
- Webots là phần mềm cục bộ ngoài repo (`/Applications/Webots.app`, R2025a); recorder khóa theo sha256 của executable. Thư mục thừa trong `/tmp/webots/default` do các lần kill engine trước R1.1 vẫn còn trên máy này (chỉ rác `/tmp`).

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này; r1-candidate-03, candidate-06 và regression ghi trên cùng commit)
node scripts/record-sim-extension.mjs --release r1.1 --out <dir mới> --candidate-id <id> \
  --r1-record <r1 record dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<dir> pnpm test:acceptance -- sim-extension
```
