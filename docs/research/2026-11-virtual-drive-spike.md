# Spike V01 — drive ảo trên actuator gốc của MuJoCo (R4.1)

- **Ngày:** 2026-11-19 · **Máy:** `arm64`, macOS 26.5 (Darwin 25.5.0), Python 3.11.15, `mujoco==3.17.0`, numpy 2.4.6 (`.venv-mujoco`) · **Mọi số trùng bit chỉ có nghĩa trên `arm64`; Cloud Run là x86-64 và chưa được đo.**
- **Spec:** [R4-A §5.2, §5.4](../../../docs/2026-11-19-virtual-commissioning/02-r4-control-chain-spec.md) · **Plan:** [01 — V01](../../../docs/2026-11-19-virtual-commissioning/plans/01-drive-and-cil.md) · **Mã:** [`robotics/simulation-mujoco/probe_drive.py`](../../robotics/simulation-mujoco/probe_drive.py) · **Output thô:** [`virtual-drive-spike/`](virtual-drive-spike/) (`results.json`, `case2-traces.json.gz`)
- **Kết luận: cơ chế khóa được.** Lớp cổng ở mức substep (kênh lệnh, máy trạng thái enable, bật/tắt theo nhóm actuator) cho run **trùng bit** với đường legacy ở model lý tưởng trên cả ba engine (mobile, arm, world); mọi cấu hình `pid` hữu hạn, không cảnh báo `BADQPOS/BADQVEL/BADQACC`; chi phí thêm 0,07–0,18 ms/tick. Không có tiêu chí Exit nào rơi. **Có sáu điều V03 phải làm khác điều plan tưởng** (mục 4), trong đó hai điều làm sai kết quả im lặng nếu bỏ sót: chỉ số `ctrl` của `pid`, và phanh bằng ma sát khớp phải siết độ mềm của ràng buộc.
- Probe **không sửa module nào của worker**: nó bọc `compile_cell/compile_mobile/compile_world` trong đời một engine, sửa MJCF trả về (position/velocity → `pid`, bộ đệm trễ) rồi chạy **chính các lớp engine thật**. "Cổng" trong probe (`Gate`) là bản thay thế tạm của `drive_model.py`: nó chỉ ghi `ctrl` trước mỗi substep, cùng việc V03 sẽ thêm vào các vòng bước.

## 1. Phương pháp

| Mục | Nội dung |
|---|---|
| Chương trình lệnh (tất cả xác định) | mobile `serve-payload-v1`, tải `cup-center`, 300 tick: đứng 20 tick, ramp 0,2 m/s trong 50 tick, thêm 0,4 rad/s từ tick 120, dừng ở tick 250. Arm `xarm6-g2-v1`, 300 tick: `home + 0,05·sin(2πk/150 + i)` mỗi khớp, cốc 1 đặt lên bệ ở tick 10, kẹp mở rồi khép 0,03 m từ tick 100. World `coffee-delivery-world-v1`, 500 tick: cùng lệnh tay, AMR 0,1 m/s từ tick 20 và quay 0,2 rad/s trong tick 250–350 |
| Hai đường | **legacy** = lớp engine thật (`MobileEngine.step`, `MujocoEngine.step`, `WorldEngine.step`). **Cổng** = cùng engine, nhưng vòng substep của probe ghi `ctrl` qua `Gate` (một vector lệnh mỗi tick, hàng đợi trễ theo substep, máy trạng thái `disabled → ready → enabled`, nhóm actuator `i+1` cho trục `i`) |
| Digest | SHA-256 của chuỗi, mỗi tick sau `step()`: `qpos.tobytes()` rồi `qvel.tobytes()` (float64, thứ tự byte của máy) |
| Lặp | mỗi cấu hình chạy 3 lần, so bằng `numpy.array_equal` trên `qpos`/`qvel` từng tick |
| Chi phí | 2.000 tick mỗi lần, 3 vòng xen kẽ legacy / `bare` / cổng / cổng+`pid` trong cùng phiên; thời gian tường của một lệnh `step` (p50/p95) |
| Quy ước | mọi gain và thông số mới là `assumed`, physics `not_calibrated`; không ngưỡng nào được đặt để "đạt": mục tiêu là số đo |

Lệnh chạy lại (sinh `docs/research/virtual-drive-spike/`, từ chối nếu thư mục đã có):

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 900; exec @ARGV' .venv-mujoco/bin/python -I -B robotics/simulation-mujoco/probe_drive.py --out docs/research/virtual-drive-spike
```

## 2. Số đo theo năm ca

### Ca 1 — model lý tưởng: trùng bit và digest của đường legacy

Cổng với trễ 0, mọi trục `enabled` từ đầu, không thả: **trùng bit với legacy trên cả ba engine, cả ba lần lặp** (`firstDifferingTick` rỗng, `maxAbsQpos = maxAbsQvel = 0`). Legacy tự lặp trùng bit, cổng tự lặp trùng bit, cả hai qua tiến trình khác nhau (chạy lại probe cho cùng digest).

Đây là **ba digest của đường legacy (mốc của V03)**, đo trên `arm64`, MuJoCo 3.17.0, trước khi V03 sửa engine. Sau khi V03 nối drive, đường legacy phải cho đúng ba chuỗi này:

| Đường | Tick | SHA-256 | Đủ chuyển động (độ biến thiên `qpos` lớn nhất) |
|---|---|---|---|
| `mobile` (`MobileEngine`, tải `cup-center`) | 300 | `23ea8d07f95edf4265389a2bd3933737d788c429c849c685e003d4cf676cf2d9` | 10,6 |
| `arm` (`MujocoEngine`, cup-1 và cup-2) | 300 | `5927ce0f26c3d2af369e4edb9af45eddcba581b6d8fcfda835fb4bc793f3e76a` | 11,2 |
| `world` (`WorldEngine`) | 500 | `3683bae2b968dfcac4c97c2cf10f04d6b4e0e957ef8a3f88d6ced442f04555d1` | 4,5 |

(Độ biến thiên là `max(ptp(qpos))` toàn bộ khớp, gồm khớp bánh quay tự do; con số chỉ để chứng tỏ chương trình lệnh không đứng yên.)

Hai điểm đã kiểm trên **model thật của cell** (trước đây chỉ có trên model một khớp), cùng chương trình lệnh arm, 300 tick: sáu actuator `pid` với `ki=0` trùng bit với `position` của R2b; bộ đệm trễ gốc đã bật (`nsample=64`) với `delay=0` trùng bit với actuator thường. Lần đầu probe báo **không trùng** ở tick 100 (xem điều 4.1): nguyên nhân là chỉ số `ctrlrange` trong probe, không phải actuator.

### Ca 2 — actuator `pid` của engine

**Ánh xạ gain → thuộc tính, đọc lại từ `MjModel` đã biên dịch:**

| Control profile | Actuator R2b (`ki = 0`, giữ nguyên) | Actuator `pid` (`ki > 0` hoặc có `slewLimit`) |
|---|---|---|
| `kp` | `position`: `gainprm[0] = kp`, `biasprm[1] = −kp` (khớp tay, kẹp) | `biasprm[1] = −kp` |
| `kd` (`kv` trong MJCF) | `position`: `biasprm[2] = −kv`; bánh `velocity`: `gainprm[0] = kv`, `biasprm[2] = −kv` (kv = `velocityGainNmsPerRad` = 2) | `biasprm[2] = −kv` |
| `ki` | — | `gainprm[0] = ki` (`gaintype = 5`, `dyntype = 6`) |
| `integralLimit` | — | `dynprm[0] = imax`: kẹp **trạng thái tích phân** `act` (đơn vị rad·s); lực tích phân tối đa = `ki·imax` |
| `slewLimit` | — | `dynprm[1] = slewmax` (rad/s trên tham chiếu); tạo thêm một trạng thái: `actnum = 2`, `act[0]` = tham chiếu đã bị giới hạn, `act[1]` = tích phân |
| Lệnh | `ctrl[ctrladr]` = đích | `ctrl[ctrladr]` = **vị trí tham chiếu**, `ctrl[ctrladr + 1]` = **vận tốc tham chiếu**; lực = `kp(p_ref − q) + kv(v_ref − q̇) + ki·act` |

Ví dụ đọc lại (J2 của cell, gain của fixture `kp = 6000`, `kv = 150`): R2b `gaintype 0, gainprm[6000], biasprm[0,−6000,−150], ctrladr 1, ctrlnum 1`; `pid` `gaintype 5, gainprm[3000], biasprm[0,−6000,−150], dynprm[6,9e−4], ctrladr 1, ctrlnum 2, actnum 1`.

**Bước nhảy** (J2 +0,2 rad ở tick 50, 250 tick; gain khởi điểm `ki = kp/2 = 3000`, `imax = 6,9e−4` để `ki·imax` = 2× mô-men trọng lực của khớp tại home = 2,07 N·m):

| | Sai số giữ trước bước (rad) | Sai số xác lập (rad) | Vọt lố | Ổn định trong 2 % | Cảnh báo BADQ |
|---|---|---|---|---|---|
| `position` (R2b) | −1,7e−4 | 2,5e−4 | 0,13 % | 0,08 s | 0 |
| `pid`, `ki = 3000` | −1,1e−4 | 1,0e−4 | 0,33 % | 0,08 s | 0 |
| `pid` + `slewmax = 0,5`, tham chiếu khởi tạo **bằng 0** | **0,66** | −2e−5 | 225 % | 0,9 s | 0 |
| `pid` + `slewmax = 0,5`, tham chiếu khởi tạo bằng lệnh | −1,1e−4 | 1,0e−4 | 0,28 % | 0,4 s | 0 |

**Quét `ki`** (hữu hạn và không cảnh báo ở mọi điểm; `ki·imax` giữ không đổi). Khớp tay (×hệ số trên 3000): ×1 vọt 0,3 %, ×10 1,0 %, ×100 6,3 %, ×1000 60 %, ổn định 0,06–0,16 s. Bánh (kp = 8, kv = 2, bước tốc độ 2,22 rad/s): `ki` 2 / 4 / 8 / 16 / 64 / 256 / 1024 cho vọt 9,2 / 9,6 / 10,6 / 12,0 / 22 / 54 / 98 %; trong 4 s chỉ `ki = 2, 4, 16` vào dải 2 % (3,5–3,6 s). Servo `velocity` thuần của R2b có sai số xác lập −6 % (−0,125 rad/s) và không vào dải 2 %. Hữu hạn về số không có nghĩa là bám tốt: `ki` lớn chỉ chứng tỏ engine không vỡ.

Kẹp tích phân là "ngừng tích phân khi chạm giới hạn", không phải kẹp cứng: `act` vượt `imax` tối đa một bước `sai_số·dt` (J2: 9,4e−4 so với 6,9e−4 với sai số 0,2 rad).

### Ca 3 — bật/tắt trục và phanh

**Hai cách tắt trục** (J2 là `pid` có tích phân, tắt tick 100–200, bật lại tick 200, lệnh +0,1 rad):

| | Lực khi tắt | Trạng thái tích phân khi tắt | Chuyển tiếp khi bật lại (max \|q̇\|, rad/s) |
|---|---|---|---|
| Nhóm actuator + `disableactuator` | **đúng 0** | **đứng yên** (trôi 0) | 0,027 |
| `forcerange = 0` | đúng 0 | **vẫn chạy** (trôi −9,4e−4; đổi dấu) | 0,038 |
| Nhóm actuator + xóa tích phân khi tắt | đúng 0 | 0 | 0,030 |

Hai cách đều cho lực 0, nhưng `forcerange = 0` để tích phân chạy tiếp trong lúc trục không có lực (windup). Bit nhóm đóng băng nó.

**Phanh** (tay máy tại home, tắt cả sáu trục ở tick 50, quan sát 500 tick = 10 s; mô-men trọng lực (`qfrc_bias`) tại home J1…J6: 0; 1,04; 15,9; 0,17; 1,74; 0,02 N·m; khớp R2b đã có `frictionloss = 1`, `damping = 1`, `armature = 0,1`):

| Cấu hình | Trôi lớn nhất (rad) | Khớp trôi nhiều nhất |
|---|---|---|
| `coast` (không phanh) | 0,93 | J2 |
| phanh = ma sát khớp 1,2× trọng lực | 0,93 | J2 |
| phanh 3× trọng lực | 0,26 | J3 |
| phanh 3× + ràng buộc siết (`solimp .99/.999`, `solref .004`) | 0,0054 | J3 |
| phanh 3× + ràng buộc siết hơn (`solimp .999/.9999`, `solref .004`) | 0,00053 | J3 |

Ma sát khớp của MuJoCo là ràng buộc mềm; với `solimp`/`solref` mặc định nó **trượt** dù mô-men phanh lớn gấp 3 hay gấp 50 lần (0,26 rad ở J3 không đổi từ 3× lên 50×). Phanh chỉ giữ được khi độ mềm của ràng buộc được siết lúc tắt trục. `dof_frictionloss`, `dof_solimp`, `dof_solref` đổi được lúc chạy và trả lại giá trị gốc khi trục bật lại (probe làm vậy).

### Ca 4 — trễ lệnh

Quỹ đạo `qpos` ở **từng substep** của J2 (bước +0,2 rad ở substep 200), hàng đợi phía cổng so với `delay` gốc của actuator (`nsample = 64`, `actuator_delay` đặt lúc chạy):

| Trễ | Substep chuyển động đầu: không trễ / hàng đợi / gốc | `max \|Δq\|` hàng đợi so với gốc |
|---|---|---|
| 1 substep (2 ms) | 200 / 201 / 201 | **0** |
| 10 substep (20 ms) | 200 / 210 / 210 | **0** |
| 50 substep (100 ms) | 200 / 250 / 250 | **0** |
| 1,5 substep (3 ms), chỉ gốc | 202 | 0 so với hàng đợi 2 substep; 0,011 so với 1 substep |

Hàng đợi và bộ đệm gốc cho **cùng một đáp ứng đến từng bit** ở mọi trễ nguyên; bộ đệm gốc làm tròn trễ lẻ lên số substep nguyên. Bộ đệm gốc có ba ràng buộc: `nsample` cố định lúc biên dịch (trễ tối đa `nsample − 1` substep); bộ đệm khởi đầu bằng `ctrl = 0`, nên không gọi `mj_initCtrlHistory` thì trục nhận lệnh 0 trong suốt thời gian trễ (J2 lệch 0,20 rad so với bản không bước, 0,11 rad so với bản đã khởi tạo, ngay cả khi chỉ trễ 10 substep); và mọi actuator trễ phải có bộ đệm ngay khi biên dịch.

### Ca 5 — lặp và chi phí

Mọi cấu hình trùng bit qua 3 vòng lặp (legacy, `bare`, cổng, cổng+`pid`; hai cỡ). Chi phí thêm mỗi tick (thời gian tường của vòng bước, 2.000 tick × 3 vòng xen kẽ, p50 / p95):

| | `bare` (không cổng, chỉ vật lý) | Cổng (R2b actuator) | Chênh p50 / p95 | Cổng + `pid` | Chênh p50 / p95 |
|---|---|---|---|---|---|
| mobile, 2 trục | 0,477 / 0,600 ms | 0,551 / 0,710 ms | **+0,074 / +0,110 ms** | 0,570 / 0,676 ms | +0,093 / +0,077 ms |
| world, 9 trục (6 tay + kẹp + 2 bánh) | 0,252 / 0,291 ms | 0,322 / 0,376 ms | **+0,070 / +0,085 ms** | 0,426 / 0,532 ms | **+0,174 / +0,241 ms** |

`bare` là cùng vòng bước nhưng chỉ ghi `ctrl` một lần mỗi tick (đúng như legacy), không đọc trạng thái, không lấy mẫu tiếp xúc, không quét LiDAR; bước legacy đầy đủ là 1,33 ms (mobile) và 1,08 ms (world), phần chênh là việc đọc và đóng gói của engine. Cell đo được 10,2–11,0 ms/tick không tính fsync ([V00](../implementation/post-r2b-baseline.md)), nên cổng chiếm ≤ 0,7 % (≤ 1,7 % khi cả tám trục là `pid`). Cổng của probe là Python thuần mỗi substep, chưa tối ưu; số này là **trần** cho `drive_model.py`.

## 3. Quyết định cơ chế đã khóa

| Mục | Quyết định | Căn cứ |
|---|---|---|
| Vòng lặp và giới hạn của drive | actuator của engine. `ki = 0` và không `slewLimit` giữ nguyên `position`/`velocity` của R2b; `ki > 0` hoặc `slewLimit` dùng `pid` với bảng ánh xạ ở Ca 2 | Ca 1 và Ca 2: trùng bit ở `ki = 0`; hữu hạn và hội tụ ở mọi `ki` đã quét |
| Lệnh `csv` cho bánh dùng `pid` | bộ tích phân tham chiếu **trong `drive_model.py`**: `ctrl[ctrladr] = p_ref` (cộng `v·dt` mỗi substep, bám `q` khi trục không `enabled`), `ctrl[ctrladr+1] = v_cmd` | `pid` của MuJoCo tích phân sai số **vị trí**, không phải vận tốc (Ca 2) |
| Bật/tắt trục | **nhóm actuator + `disableactuator`**, mỗi trục một nhóm trong 1…30 (nhóm 0 là mặc định của mọi actuator, không dùng). Xóa `act` (tích phân và tham chiếu slew) **khi rời `enabled`**, để không phụ thuộc việc engine đóng băng hay không | Ca 3: lực đúng 0, tích phân đứng yên; xóa tích phân khi tắt tốn 0,003 rad/s ở chuyển tiếp, không đáng kể |
| Phanh | ma sát khớp `dof_frictionloss ≥ brakeTorqueNm` **và** siết `dof_solimp`/`dof_solref` (khởi điểm `.999 .9999 .001 .5 2` / `.004 1`) trong lúc tắt, trả lại khi bật; `coast` không đổi gì. Khởi điểm `brakeTorqueNm` = 3× \|`qfrc_bias`\| tại home (`assumed`) | Ca 3: mô-men một mình không giữ được |
| Trễ lệnh | **hàng đợi phía worker, đơn vị substep** (vòng đệm), không dùng bộ đệm gốc | Ca 4: trùng bit ở trễ nguyên; hàng đợi không cần `nsample` lúc biên dịch, không cần khởi tạo lịch sử, đổi được lúc chạy, và để `delay = 0` đi đúng đường R2b không đổi byte |
| Trùng bit ở model lý tưởng | mỏ neo DRV02 giữ nguyên: cổng với trễ 0 và mọi trục `enabled` cho đúng ba digest ở Ca 1 | Ca 1 |
| Chi phí | không giới hạn số trục có drive | Ca 5: ≤ 1,7 % ngân sách tick của cell |

Các kết luận trùng bit **chưa kiểm dưới tiếp xúc nặng** (giao cốc trong cell), nơi khác biệt vài bit dễ khuếch đại; chỉ DRV02 trên `MJ-CELL-BV01` (V03) mới chứng minh điều đó.

## 4. Điều V03 phải làm khác điều plan tưởng

1. **`ctrlrange` và `ctrllimited` đánh theo ô `ctrl`, không theo actuator.** `m.nu` là số ô `ctrl` (một `pid` chiếm hai ô); `actuator_group`, `actuator_forcerange`, `actuator_gainprm`… đánh theo actuator. Code legacy đọc `m.actuator_ctrlrange[self.grip_act]` và `m.actuator_ctrlrange[self.acts]` (kiểm tầm lệnh bánh) theo **id actuator**: trên model có `pid` nó đọc nhầm ô của actuator khác, cho dải lệnh kẹp sai và kết quả khác từ tick 100 mà **không có lỗi**. Mọi chỗ đọc/ghi `ctrl`, `ctrlrange`, `ctrllimited` phải qua `actuator_ctrladr`. Khi chuyển `position` sang `pid`, `ctrlrange` đi theo ô 0 (vị trí tham chiếu); `ctrlrange` của `velocity` không đem sang.
2. **Keyframe `home` có `ctrl` dài đúng `nu`.** Mỗi `pid` thêm một ô. `compile_cell` ghi `ctrl = [*home, 0.0]` (7 giá trị); trên model có một `pid` ở J2 MuJoCo vẫn biên dịch (`key_ctrl` có 8 ô, thiếu một giá trị) và **gán lệch** các giá trị: ô vận tốc tham chiếu của J2 nhận giá trị home của J3, mọi ô sau lệch một. Không có lỗi, chỉ có lệnh khởi tạo sai. Probe sửa chuỗi `ctrl` trong MJCF (thêm ô 0 sau mỗi `pid`); V03 nên sinh nó từ danh sách ô.
3. **Tham chiếu slew khởi tạo bằng 0.** Trục `pid` có `slewmax` giữ tham chiếu đã giới hạn trong `act[0]`, bằng 0 sau khi tạo `MjData`: không khởi tạo thì tay máy trượt từ 0 tới home với tốc độ `slewmax` (lệch 0,66 rad trước lệnh đầu, vọt 225 %). `drive_model.py` phải đặt `act[0] = lệnh ban đầu` ngay sau reset.
4. **Phanh phải siết độ mềm của ràng buộc ma sát** (Ca 3), nếu không "brake" chỉ đẹp trên giấy: trượt 0,26 rad trong 10 s ở J3 dù mô-men gấp 3 trọng lực. Giá trị `dof_solimp`/`dof_solref` mặc định của R2b phải được trả lại khi trục `enabled`, nếu không ma sát khớp của chuyển động thường đổi và phá DRV02.
5. **Bộ đệm trễ gốc cần `mj_initCtrlHistory`** nếu sau này có ai muốn dùng nó thay hàng đợi (xem Ca 4). V03 dùng hàng đợi; điều này chỉ ghi lại để không bị dùng nhầm.
6. **`imax` là trạng thái, không phải lực.** Lực tích phân tối đa là `ki·imax`, và nó có thể vượt `imax` một bước `sai_số·dt` (Ca 2). Control profile nên khai `integralLimitNm` (lực) rồi suy `imax = integralLimitNm / ki`, như probe đã làm.

## 5. Giá trị khởi điểm của năm thí nghiệm drive (tất cả `assumed`)

`drive-ideal-v1` là mốc trùng bit nên không có tham số. Các thí nghiệm còn lại là **thay đổi so với `drive-nominal-v1`**. V03/V04 đo và khóa trước campaign; không phải thông số của một driver cụ thể.

| ID | Trễ lệnh | Trễ phản hồi | Encoder (`countsPerRev`) | Watchdog | Trình tự enable | Khác |
|---|---|---|---|---|---|---|
| `drive-ideal-v1` | 0 | 0 | chính xác, không lượng tử | tắt | khởi động ở `enabled` (không có trình tự) | — |
| `drive-nominal-v1` | 1 substep (2 ms) | 1 substep (2 ms) | bánh 4096 (1,5e−3 rad ≈ 0,14 mm), khớp tay 16384 | 5 tick (100 ms) | `enableDelaySubsteps = 25` (50 ms) | gain `ki = 0` nên giữ actuator R2b |
| `drive-torque-limited-v1` | như nominal | như nominal | như nominal | như nominal | như nominal | đường mô-men bánh × 0,4 (đã có trong spec) |
| `drive-latency-v1` | **50 substep (100 ms)** (đo ở Ca 4) | như nominal | như nominal | 5 tick, đếm ở phía drive từ lúc lệnh **tới** | như nominal | trễ không tạo timeout khi lệnh vẫn đến mỗi tick |
| `drive-coarse-encoder-v1` | như nominal | như nominal | bánh **256** (÷16: 0,0245 rad ≈ 2,2 mm/count), khớp tay 1024 | như nominal | như nominal | kiểm không có `TRACKING_DEGRADED` giả khi đứng yên |

Giá trị khác phục vụ V03: bộ đệm trễ cần `nsample ≥ 51` trong thiết kế bộ đệm gốc, nhưng V03 chọn hàng đợi nên giới hạn là kích thước vòng đệm (≥ 64 substep, tức 128 ms); `quickStopSubsteps` chưa đo (không thuộc V01). Gain `pid` khởi điểm cho trục có tích phân: khớp tay `ki = kp/2`, `imax = min(2·|τ_g|, effort)/ki`; bánh `kp = 8`, `kv = 2`, `ki = 4`, lực tích phân tối đa 4 N·m. Thí nghiệm nominal không dùng chúng (`ki = 0`); chỉ dùng khi control profile khai `ki`.

## 6. Phương án định hình tham chiếu (chỉ mô tả, không cài)

R4 chạy vòng lặp servo **bên trong drive trên trạng thái thật của engine** (§5.2 của spec). Không biểu diễn được: vòng lặp do MEKONIQ tự viết, chạy trên encoder thô hoặc ở tần số thấp (PID firmware 50–100 Hz), nơi chính phản hồi lượng tử và trễ phải nằm **trong** vòng điều khiển.

Phương án: mỗi substep tính một luật điều khiển `u = C(p_ref, phản hồi đo được)` trong `drive_model.py` rồi đặt tham chiếu của actuator `position` sao cho lực của actuator bằng `u`: `ctrl = q + (u + kv·q̇) / kp`, với `kp` đủ lớn; hoặc dùng actuator mô-men trực tiếp (`motor`, `gear = 1`) và ghi `ctrl = u`. Chi phí: một vòng Python thêm mỗi substep cho mỗi trục (cùng bậc với cổng, +0,07 ms/tick cho 9 trục) và trạng thái điều khiển (tích phân, bộ lọc) nằm ngoài engine, nên mỗi biến trạng thái phải vào snapshot để lặp lại được.

**Điều kiện mở:** (a) có một controller thật cần kiểm với phản hồi lượng tử ở nhịp thấp hơn 500 Hz; (b) hoặc có dữ liệu đo của drive thật cho thấy mô hình "vòng lặp trên trạng thái thật" lệch vượt dung sai đã khai. Chưa có điều nào; R4 không làm.

## 7. Chưa đo

- **x86-64.** Trùng bit và digest chỉ đúng trên `arm64`. Trên Cloud Run so theo kết quả và dung sai, không theo digest.
- **Tiếp xúc nặng.** Chương trình arm và world có tiếp xúc (kẹp khép lên cốc ở tick 100, cốc trên bệ) và trùng bit, nhưng không có ca gắp–bê–đặt đầy đủ; DRV02 trên `MJ-CELL-BV01` thuộc V03/V05.
- **Hiệu chỉnh.** Mọi gain, độ trễ, `countsPerRev` và thông số phanh là `assumed`; không số nào đến từ một driver hay motor có thật.
- **Đường worker** (Plan V01 đề cập "đường worker"): probe chạy engine trực tiếp, không qua `WorkerSession`. Ba đường worker (mobile, arm, world) cùng gọi các lớp engine này, và session không chạm `ctrl`, nên không đổi kết luận cơ chế; chi phí đường session có trong số đo cell của [V00](../implementation/post-r2b-baseline.md).
