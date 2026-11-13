# Simulation extension R2a — r2a-candidate-01 (tay máy MuJoCo xArm 6, mô phỏng từ web, UI gọn)

Bằng chứng do `source/scripts/record-sim-extension.mjs --release r2a` ghi, kiểm bằng guard `pnpm test:acceptance -- sim-extension` (`LAB_SIMEXT_EVIDENCE_DIR=<thư mục này>`; guard dùng chung `checkQualification` với recorder, chọn bảng `r2a` theo `release`). Bảy gate ở trạng thái `tested`, **`G-CLOUD1` là `blocked_external`**; mọi gate **`accepted: false`**, `acceptedBy` null. Chỉ reviewer mới ghi accepted, trong một sidecar `acceptance.json` riêng: **chưa có sidecar nào cho bản ghi này** (lần chấp nhận của Henry ngày 2026-11-11 thuộc `candidate-07` / `r1-candidate-05` / `r11-candidate-02`, nay đã bị thay thế và chỉ còn trong lịch sử git). Case duy nhất `not_run` là CL01.

Đây là bản ghi R2a đầu tiên. R2a không ghi campaign và không có phép đo `performance.json` riêng (`campaign`, `performance` là null): bằng chứng engine là các suite chạy trên MuJoCo thật (không suite nào bị skip). REG03 đòi bản ghi IR-SIM, R-MOCK, R1 và R1.1 **cùng commit**, mọi gate cũ `tested`: các bản sao `irsim-record.json`, `mock-regression.json`, `r1-record.json`, `r11-record.json` nằm cạnh bản ghi này (kiểm sha), và guard đòi chúng đúng bằng bản trong cây (`linkforge-irsim/candidate-08`, `sim-extension/r1-candidate-06`, `sim-extension/r11-candidate-03`; R-MOCK là `lab/docs/implementation/evidence/sim-extension-r2a/regression`).

**Lần ghi đầu thất bại, bản này là lần ghi lại.** Lần ghi `r2a-candidate-01` đầu tiên trên cùng commit dừng với exit 1 (`SUITE_FAILED:ma-worker`, MA02/MA03 `failed`, `G-MA1 not_run`): suite `ma-py` của chính recorder chạy pytest trên `robotics/simulation-mujoco` và để lại `robotics/simulation-mujoco/.pytest_cache`, rồi suite kế tiếp `ma-worker` trượt ở test "after close no worker process is left and no bytecode appears under the tool root" vì thấy thư mục đó. Đây là lỗi của recorder (bước pytest không tắt cache provider), **chưa sửa ở commit này**. Bản trong cây được ghi lại với `PYTEST_ADDOPTS="-p no:cacheprovider"` trong môi trường của recorder, sau khi xóa mọi `.pytest_cache`/`__pycache__` dưới `robotics/`; không file nào được sửa tay, bản hỏng không được đưa vào cây.

## Định danh

| | Giá trị |
|---|---|
| Source commit | `bb16724859ee8377be62389a851ac36ea4a0309a` (sạch; closure portable `6df2f71fc1638075…`, native `cddf6bc66fc4d6a5…`) |
| Lab commit / pin | `832c84fa0bdac2c18d44a4f102337533d1904436` (sạch) / pin source `bb16724`, artifact `67a1a20cf12f7904…`, schema `9e6ebfffc4aef0f3…` |
| MuJoCo | `mujoco==3.17.0` của `robotics/simulation-mujoco/requirements.lock` (venv `.venv-mujoco`, Python 3.11; lock sha256 `a3c78091c9042b3a…`) |
| Fixture tay máy | `xarm6-g2-v1` (UFACTORY xArm 6 bản 1305 + Gripper G2), `modelRevision` `e60fd6ca4431e6b1…`; file của hãng từ **một** repo: `xArm-Developer/xarm_ros2` nhánh `humble`, commit `ac736c92b02de7ca7e0be6f737d77d46707464d8`, BSD-3-Clause |
| Webots (cho các suite hồi quy Webots) | R2025a, sha256 executable `0ba7fdf2603a0b5c…` |
| Oracle profile digest | `5a79d629e9768464…` |
| Image container (RT05) | `mekoniq-lab-runtime:record-11189`, **linux/arm64**, id `sha256:59709619781dcbbd…`, revision = commit ghi (`revisionIsRecordedCommit` true), dựng bởi recorder (`deploy/lab-runtime/build.sh … --platform linux/arm64`) |
| Ghi lúc | 2026-11-13T13:47:43.937Z → 2026-11-13T13:55:57.755Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |
| Bản ghi nền | `candidate-08` (LinkForge + IR-SIM), `r1-candidate-06` (R1), `r11-candidate-03` (R1.1), `lab/docs/implementation/evidence/sim-extension-r2a/regression` (R-MOCK), cùng commit |

## Gate (chỉ reviewer mới ghi accepted)

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-MA1 | tested | false | MA01, MA02, MA03 |
| G-MA2 | tested | false | MA04, MA05, MA06, MA07, MA08 |
| G-RT1 | tested | false | RT01, RT02, RT03, RT04 |
| G-RT2 | tested | false | RT05 |
| G-UI1 | tested | false | UI01, UI02, UI03, UI04 |
| G-INT4 | tested | false | UI05, INT15, INT16 |
| G-REG3 | tested | false | REG03 |
| G-CLOUD1 | **blocked_external** | false | CL01 |

**G-CLOUD1** là `blocked_external` và không có đường tới `tested` cho tới khi người dùng ra lệnh deploy lên Cloud Run (D60): CL01 chỉ chạy được trên một service đã deploy, và producer cùng định dạng bản ghi của nó thuộc phần việc deploy đó. `deploy/lab-runtime/cloud-run.sh` mới chỉ chạy dry-run; chưa có service nào.

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú / lý do (nguyên văn tóm tắt từ `qualification.json`) |
|---|---|---|---|
| MA01 | tested | suite:ma-static, suite:ma-rtb, suite:ma-py | |
| MA02 | tested | suite:ma-worker, suite:ma-py | |
| MA03 | tested | suite:ma-py, suite:ma-ports, suite:ma-worker | |
| MA04 | tested | suite:ma-programs, suite:ma-contact | |
| MA05 | tested | suite:ma-bv01 | |
| MA06 | tested | suite:ma-faults | chốt 2026-11-13: hạ ma sát má kẹp thì cốc trượt khi nhấc, chuyển giao bị từ chối ở bước kiểm nhấc (`TRANSFER_REJECTED`, run `needs_attention`) và `CUP_DROPPED` chốt khi cốc rời má; không bao giờ `completed`, kẹp không bao giờ được lệnh mở. Lỗi khớp yếu chạy trên bản sao tạm của worker root; run bệ bị chiếm kết thúc bằng `ARM_COLLISION` trước khi worker từ chối, việc từ chối được chứng minh ở mức worker và ports |
| MA07 | tested | suite:ma-bv01 | |
| MA08 | tested | suite:ma-bv01, suite:ma-contact | |
| RT01 | tested | suite:rt-remote | |
| RT02 | tested | suite:lab-rt-unit | |
| RT03 | tested | suite:rt-paced | chốt 2026-11-13: trên runner fixed-step, evidence có nhịp và không nhịp giống hệt nhau với cùng chuỗi action, golden không nhịp không đổi và không gọi đồng hồ tường; run có nhịp không tái tạo được golden 500 tick (một step có nhịp mang tối đa 50 tick) |
| RT04 | tested | suite:lab-e2e-remote-origin | |
| RT05 | tested | suite:rt-container | image dựng cho kiến trúc của máy ghi từ commit ghi; chạy container không bao giờ là bằng chứng cho G-MA1/G-MA2 (D50); linux/amd64 chỉ mới chạy qua giả lập, ở đó MJ-BV01 dừng với `PLANT_UNSTABLE` (chưa rõ nguyên nhân), máy amd64 thật chưa thử |
| CL01 | **not_run** | | `blocked_external`: chưa có lệnh deploy Cloud Run (D60); CL01 chỉ chạy trên service đã deploy |
| UI01 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-layout | |
| UI02 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-layout, suite:lab-e2e-twin-polish | |
| UI03 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-transport, suite:lab-e2e-twin-polish | |
| UI04 | tested | suite:lab-ui-unit, suite:lab-e2e-brand-accessibility, suite:lab-e2e-twin-layout, suite:lab-e2e-twin-workspace | |
| UI05 | tested | suite:lab-arm-unit, suite:lab-e2e-arm-mesh, suite:lab-e2e-arm-cell, suite:lab-e2e-mujoco-mesh-fallback | chốt 2026-11-13: kiểm mức launcher là spec MuJoCo `mujoco-mesh-fallback`; e2e mock-launcher trong plan được thay bằng spec chỉ-UI (`arm-mesh`, `arm-cell`). Cảnh 3D còn vẽ hai giá đỡ của trạm (hình học `assumed` của trạm mô phỏng), đế và chân minh họa không được mô phỏng |
| INT15 | tested | suite:lab-e2e-mujoco-coffee, suite:lab-arm-unit | ảnh: `screens/lab-e2e-mujoco-coffee/screens/mujoco-coffee.png` |
| INT16 | tested | suite:regress, suite:ma-faults, suite:lab-e2e-irsim-journey, suite:lab-e2e-webots-coffee, record:mock-regression | e2e mock trên UI mới là regression R-MOCK cùng commit (`mock-regression.json`) |
| REG03 | tested | record:linkforge-irsim, record:mock-regression, record:r1, record:r1.1 | |

## Suite

| Suite | Pass / tổng | Chạy trên |
|---|---|---|
| ma-static | 34 / 34 | |
| ma-rtb | 1 / 1 | Robotics Toolbox |
| ma-py | 43 / 43 | pytest, `.venv-mujoco` |
| ma-worker | 3 / 3 | MuJoCo thật |
| ma-ports | 15 / 15 | MuJoCo thật |
| ma-programs | 2 / 2 | MuJoCo thật |
| ma-contact | 43 / 43 | |
| ma-bv01 | 10 / 10 | MuJoCo thật |
| ma-faults | 17 / 17 | MuJoCo thật |
| rt-remote | 15 / 15 | |
| rt-paced | 14 / 14 | |
| rt-container | 1 / 1 | Docker, image linux/arm64 |
| regress | 35 / 35 | |
| lab-rt-unit | 51 / 51 | Lab |
| lab-ui-unit | 75 / 75 | Lab |
| lab-arm-unit | 48 / 48 | Lab |
| lab-e2e-remote-origin | 1 / 1 | Playwright Chromium |
| lab-e2e-twin-layout | 9 / 9 | Playwright |
| lab-e2e-twin-polish | 10 / 10 | Playwright |
| lab-e2e-twin-transport | 5 / 5 | Playwright |
| lab-e2e-twin-workspace | 5 / 5 | Playwright |
| lab-e2e-brand-accessibility | 9 / 9 | Playwright |
| lab-e2e-arm-mesh | 7 / 7 | Playwright |
| lab-e2e-arm-cell | 6 / 6 | Playwright |
| lab-e2e-mujoco-coffee | 1 / 1 | launcher `lab:mujoco`, MuJoCo thật |
| lab-e2e-mujoco-mesh-fallback | 1 / 1 | launcher `lab:mujoco`, MuJoCo thật |
| lab-e2e-irsim-journey | 1 / 1 | launcher IR-SIM thật |
| lab-e2e-webots-coffee | 1 / 1 | launcher Webots thật |

Lệnh thêm: `rt-image` (dựng image, exit 0) và `licenses` (`scripts/portable-licenses.mjs --check`, exit 0).

## Số đo (in ra từ các suite, không phải gate)

Một tick của `MJ-BV01` là 20 ms mô phỏng (`timestepMs` 2 × `substeps` 10); kịch bản chạy tới tick 4800 (96 s mô phỏng). Đo trên máy ghi (Apple M2 Pro, darwin arm64), dao động theo tải máy.

| Phép đo | Nguồn | Giá trị |
|---|---|---|
| Thời gian tường mỗi tick, MuJoCo trên host, hai lần chạy cùng seed | `suites/ma-bv01.log` (`wallMs` [8273, 7796] cho 4800 tick) | 1,72 / 1,62 ms (≈ 11,6× / 12,3× thời gian thực) |
| Thời gian tường mỗi tick, trong container linux/arm64 qua API HTTP | `suites/rt-container.log` (`wallMs` 8681, `msPerTick` 1.809) | 1,81 ms (≈ 11× thời gian thực); dừng container 192 ms |
| Tỉ lệ nhịp 1× của Lab chạy `MJ-BV01` qua launcher | `suites/lab-e2e-mujoco-coffee.log` (`measured1x` 0.999: 10 s mô phỏng từ giây 5 tới 15 trong 10,007 s tường; `late` 0, `maxLatenessMs` 127) | 0,999 |
| `step` có nhịp, 75 step × 20 tick (30 s mô phỏng) | `suites/rt-paced.log` (N02) | 1×: 30 005 ms (tỉ lệ 1,0002); 4×: 7 520 ms cho 7 500 ms mong đợi (1,0027); `pause` giữa step được trả lời sau 290 ms |
| Bám khớp `MJ-BV01` (cả hai lần như nhau) | `suites/ma-bv01.log` | đỉnh J1..J6 0,0176 / 0,0247 / 0,0101 / 0,0003 / 0,0099 / 0,0001 rad; nhấc 0,1514 m; trượt tối đa 2,81 mm; lặp lại cùng seed: chênh khớp thực, khớp lệnh và cốc đều 0 |

## Tham số `assumed` (chưa hiệu chuẩn, `not_calibrated`)

Khối lượng, quán tính, gốc khớp, giới hạn khớp, `velocity`, `effort` và mesh là **số danh định của hãng** (file `xarm_ros2` đã ghim). Mọi tham số sau là **giả định** (spike M00, `docs/research/2026-11-mujoco-arm-spike.md`; `physics.json` và `cell-layout.json` của fixture đều có `provenance: "assumed"`):

- Bộ điều khiển vị trí: `kp`/`kv` J1 6000/150, J2 6000/150, J3 5000/100, J4 2000/40, J5 2000/30, J6 500/14; `armatureKgM2` 0,1 mỗi khớp; `maxAccelerationRadS2` [6, 6, 6, 8, 8, 8]; `speedFraction` 0,5.
- `jointDynamics` damping 1, frictionloss 1: trích từ `<dynamics>` trong xacro của hãng nhưng là thiết lập mô phỏng Gazebo, nên ghi `assumed` (không phải đặc tính đo được của khớp).
- Tay kẹp: `kp` 20, `kv` 0,5, `forceRangeNm` 1,2, `armatureKgM2` 0,002, `closedRad` 0,85, `commandRateRadPerTick` 0,04, `mimicSolref` [0,004, 1]; `forceN` 13,15 N mỗi má và `openingMaxM` 88,9 mm là số đo của spike trên mô hình này, không phải số của sản phẩm.
- Má kẹp: hai hộp 24 × 4 × 40 mm (tâm ±24 mm, z 40 mm trên `left_finger`/`right_finger`); lòng bàn tay: hộp 75 × 102 × 112 mm. Va chạm tay kẹp chỉ qua các hộp này.
- Tiếp xúc: `condim` 4, `impratio` 10, `solimp` [0,9, 0,95, 0,005], `solref` [0,01, 1]; ma sát má kẹp [1, 0,02, 0,0001], ma sát cốc [0,6, 0,005, 0,0001], ma sát giá đỡ (bệ, khay, sàn) 1 (`world3d.supportFriction`).
- Trạm: bệ vòi tâm (0,49, 0, 0,05) m cỡ 0,1 m; khay tâm (0,35, 0,35, 0,03) m cỡ 0,2 × 0,2 × 0,06 m; cốc bán kính 0,04 m, cao 0,1 m, 0,02 kg rỗng + 0,3 kg đồ uống; `approachM` 0,12, `liftM` 0,15; pose gắp/đặt trong `cell-layout.json`.
- `capsuleRadiusM`/`capsuleSegmentsM`: chỉ dùng cho capsule sweep TS (ARM03), không phải va chạm của engine.
- Ngưỡng `mujocoArm` của oracle profile (`reachTolRad` 0,01, `settleTicks` 10, `followTolRad` 0,05, `followTicks` 10, `repeatJointRad` 1e-9, `gripSettleTicks` 25, `dropTicks` 50, `liftMinM` 0,14, `slipTolM` 0,005, `fkTolM` 1e-5) là **ngưỡng kiểm thử ban đầu chọn từ spike M00**, không phải năng lực đo được của tay máy nào.
- Trạm cà phê trong Lab (`coffee-cell-project.json`: đế tay máy cao 0,7 m, thân AMR 0,6 m) là minh họa; asset thiết kế `arm-puma-reference` của Lab không phải tay máy được mô phỏng.

## Không được suy ra từ các gate này

(spec `2026-11-12-realistic-arm-web-ui-design.md` §6.4)

Lực kẹp thật, ma sát thật giữa má kẹp và cốc, cốc đổ hay tràn, tải thật, độ chính xác lặp lại của xArm thật, hành vi firmware xArm, an toàn người, độ trễ trên mạng thật ngoài phép đo đã ghi, an toàn đa người dùng trên cloud. Cũng không suy ra rằng `MJ-BV01` chạy được trên linux/amd64: image linux/amd64 mới chỉ chạy qua giả lập, ở đó `MJ-BV01` dừng với `PLANT_UNSTABLE` (engine báo gia tốc hỏng trong lần gắp đầu), chưa rõ nguyên nhân, chưa thử trên máy amd64 thật; `G-RT2` chỉ nói về image dựng cho kiến trúc của máy ghi.

## Cần đọc trước khi dùng kết quả

- **RT05 chỉ chạy image linux/arm64** trên máy ghi (Docker/OrbStack, Mac arm64): `rt-container` chạy `MJ-BV01` tới `completed` ở tick 4800 trong `mekoniq-lab-runtime:record-11189` (`platform` `linux/arm64`). Bản ghi này **không chạy image linux/amd64**. Image amd64 (cái Cloud Run sẽ chạy) chỉ từng chạy qua giả lập trên máy này khi triển khai, ngoài bản ghi: ở đó lần gắp đầu kết thúc bằng `PLANT_UNSTABLE` (MuJoCo báo `BADQACC` ở tick 1585); nguyên nhân chưa rõ, máy x86-64 thật chưa thử (`deploy/lab-runtime/README.md`). Chạy container không bao giờ là bằng chứng cho G-MA1/G-MA2 (D50).
- `rt-image` dựng image từ cache lớp của Docker (1,4 s); revision của image là commit ghi và recorder kiểm điều đó.
- Kiểm tay trên Lab đã deploy (Chrome, Firefox, Safari) là **`not_run`**: xem `manual/README.md` (chưa push, chưa deploy R2a).
- Gắp là gắp bằng tiếp xúc trên plant MuJoCo (`grip: contact`), với mọi tham số tiếp xúc ở trên là giả định; kết quả cho thấy plant này gắp và đặt được trong ngưỡng, không cho thấy một tay máy hay một má kẹp thật làm được.
- Lặp lại cùng seed (MA07) trên cùng bản build cho chênh 0; trên máy hoặc bản MuJoCo khác chưa được kiểm.
- Thư mục `screens/lab-e2e-arm-cell` và `screens/lab-e2e-brand-accessibility` rỗng: các spec đó không chụp ảnh.
- Hai suite hồi quy Webots (`lab-e2e-webots-coffee`) chạy trên source `bb16724`, nơi Webots không cửa sổ khởi động bằng `--batch --no-rendering --mode=fast` thay cho `--minimize` (xem README của `r11-candidate-03`).

## Điều kiện ghi

- **Docker phải chạy** (RT05; không có Docker thì recorder ghi `rt-container` là không chạy và `G-RT2` không thể `tested`).
- **Màn hình phải mở khóa** (các suite Webots và Playwright cần phiên đồ họa); mọi lệnh ghi chạy dưới **`caffeinate -dims`** (máy này đặt `pmset sleep 1`).
- **`PYTEST_ADDOPTS="-p no:cacheprovider"`** trong môi trường của recorder và không còn `.pytest_cache`/`__pycache__` dưới `robotics/` trước khi ghi (lỗi recorder ở trên).
- **Không commit Lab nào** giữa lúc ghi regression R-MOCK và lúc ghi bản này (`checkLabCommits`: Lab commit lúc đầu và lúc cuối regression, và `lab.commit` của các bản ghi IR-SIM, R1, R1.1, phải bằng Lab commit của bản ghi này).
- Thứ tự ghi trên cùng commit: regression R-MOCK (Lab) → `candidate-08` → `r1-candidate-06` → `r11-candidate-03` → bản này, mỗi bước exit 0; các bản ghi nằm ngoài cả hai cây trong lúc ghi rồi được chép nguyên byte vào cây ở commit `docs: record …`.

## Chạy lại

```sh
# source/ (cây sạch, Lab đã re-pin đúng commit này, Docker chạy, màn hình mở khóa)
find robotics \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} +
PYTEST_ADDOPTS="-p no:cacheprovider" caffeinate -dims node scripts/record-sim-extension.mjs --release r2a --out <dir mới> --candidate-id <id> \
  --r11-record <r11 record dir> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=<dir> pnpm test:acceptance -- sim-extension
```
