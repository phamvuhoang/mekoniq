# CLD06 của `r5-candidate-02` trên Cloud Run — thất bại `MAC_TOLERANCE_EXCEEDED` (26–27/11/2026)

`accepted:false`. Bản ghi này không phải bản bổ sung đạt của CLD06; record R5 (`qualification.json` sha256 `5131b13a…`) giữ CLD06 `not_run` `deploy_order_pending`. Archive thô ở `robot/evidence-archive/r5-cld06-0d365afd{,-run2}/` (sha256 trong `index.json`).

## Deploy và rollback
- Image `linux/amd64` từ CI CLD05 (imageId `sha256:f103bf80…`, revision label `0d365afd`), đẩy lên `…/mekoniq-lab-runtime:r5-0d365afd` (`sha256:975d34ad…`), deploy bằng `deploy/lab-runtime/cloud-run.sh --execute` → revision `mekoniq-lab-runtime-00006-rgt`; health công khai báo `0d365afd` / schema `20dcb91d…`.
- Smoke `record-r5-cloud.mjs execute` (chạy từ worktree sạch ở `ea54ebe7`) hai lần: health `tested`, ba phương án điện `tested` (digest trùng Mac), run dừng hoàn tất nhưng so với Mac thất bại `MAC_TOLERANCE_EXCEEDED`. Lần 2 trùng bit với lần 1 (quãng đường `0.24423308564176457` m): kết quả cloud tất định, không phải chập chờn.
- Rollback ngay sau: `gcloud run services update-traffic … --to-revisions=mekoniq-lab-runtime-00005-s68=100` (21:47Z); health công khai lại báo `0650ecbd`. `main` không push. Revision `00006-rgt` vẫn tồn tại, 0 % traffic.

## Phân tích offline (trace hiện có)
Nguồn: Mac = run `s1-emergency-coast` của record (stream vật lý mỗi tick + telemetry 10 Hz); cloud = `stop-report.json` của smoke (chỉ telemetry 10 Hz, mỗi 5 tick, và metric tổng hợp; stream vật lý mỗi tick của run cloud không được tải về và đã mất cùng instance). v là vận tốc tịnh tiến dọc heading, ω là vận tốc góc, cả hai bằng sai phân trung tâm trên telemetry; với Mac, giá trị từ telemetry lệch giá trị từ stream mỗi tick ≤ 0.004 m/s. Script: `cld06_analysis.py`, đầu ra đầy đủ: `analysis-output.txt`.

| Mốc | tick | yaw Mac / cloud (rad) | v Mac / cloud (m/s) | ω Mac / cloud (rad/s) |
|---|---|---|---|---|
| Yaw bắt đầu lệch (|Δyaw| > 1e-3 lần đầu; > 1e-4 từ tick 55) | 60 | 0.2005 / 0.2049 | −0.002 / −0.000 | 0.636 / 0.679 |
| Mac bắt đầu chạy thẳng (|ω| < 0.05 và v > 0.05 trong 3 mẫu) | 345 | 1.5720 / 1.3086 | 0.077 / −0.003 | −0.020 / 0.697 |
| Cloud bắt đầu chạy thẳng | 390 | 1.5694 / 1.5703 | 0.459 / 0.057 | −0.007 / −0.036 |
| Ngay trước lệnh dừng | 410 | 1.5684 / 1.5693 | 0.474 / 0.201 | 0.006 / 0.031 |

Pha xoay tại chỗ dao động (Mac: yaw lên 1.43 ở tick 160, lùi về 0.78 ở tick 240, rồi mới về 1.57 ở tick 340); khác biệt dấu phẩy động giữa macOS arm64 và Linux x86-64 bị khuếch đại thành ~45 tick trễ lúc xuất phát. Lệnh dừng theo `elapsed_sim_ms` 8220 (tick 412) là tick bắt đầu chạy đều của run khảo sát **trên Mac** (`fixtures/stop-v1/survey.json`), nên trên cloud nó rơi vào giữa pha tăng tốc.

| Sau tick 412 | Mac | Cloud |
|---|---|---|
| Torque về 0 | cả hai bánh 0 ở tick 412 (tick 411: 0.120 / 0.144 N·m) | `torqueZeroTick` 412 (mọi trục của chuỗi cùng 0); torque từng bánh theo tick: **không có** |
| Vận tốc lúc nhận lệnh (412) | 0.4725 m/s | 0.2199 m/s, còn đang tăng |
| Tick đứng yên (`restSpeedMps` 0.01, 25 tick) | 572 | 481 |
| `stopTimeMs` | 3200 | 1380 |
| `stopDistanceM` (lệnh → đứng yên; kiểm lại bằng telemetry) | 0.7957 (0.7953) | 0.1629 (0.1627) |
| `peakDecelerationMps2` / giảm tốc trung bình | 0.178 / 0.148 | 0.175 / 0.159 |
| Quãng đường 0 → 412 | 0.468 m | 0.080 m |
| Trượt cốc tối đa / đổ / trôi sau dừng | 2.81 mm / không / 0.164 mm | 0.66 mm / không / 0.130 mm |
| Trạng thái, served, tick sự cố | `needs_attention`, 0, `EMERGENCY_STOP` 412 | giống hệt |

Đường vận tốc (m/s, telemetry): 412 → 0.472 / 0.220; 430 → 0.424 / 0.170; 450 → 0.372 / 0.108; 470 → 0.317 / 0.044; 481 → – / ≈0.01 (cloud đứng yên); 500 → 0.230 / 0; 530 → 0.141 / 0; 560 → 0.046 / 0; 572 → ≈0.01 (Mac đứng yên).

Cùng vận tốc vào pha trượt (không sạch, chỉ để định hướng): Mac đi qua 0.216 m/s ở tick 505 và từ đó đi 0.151 m trong 1340 ms tới khi đứng yên; cloud từ 0.220 m/s đi 0.163 m trong 1380 ms (+7.6 % thô; chuẩn hoá theo v² thì giảm tốc hiệu dụng 0.154 / 0.148, lệch 3.9 %). Ca Mac S2 (`tray-stop-slow-coast-v1`, 0.231 m/s ở tick 412) đi 0.180 m.

**Kết luận:** hai robot vào pha dừng với vận tốc khác nhau (0.47 so với 0.22 m/s); phép so hiện tại không so cùng điều kiện đầu vào. Không có dấu hiệu pha dừng khác nhau giữa hai kiến trúc (cùng tick torque 0, giảm tốc đỉnh lệch 1.7 %).

## Đề xuất (chưa làm, chờ duyệt)
Ca CLD06 mới, chốt trước khi chạy: MJ-TRAY01, `tray-stop-coast-v1`, seed 7, dừng khẩn thả trôi, nhưng lệnh dừng ở giữa đoạn thẳng đầu tiên thay vì ở tick bắt đầu chạy đều. Đoạn thẳng kéo dài khoảng tick 400 → 830 trên Mac (theo run `tray-v1/a-nominal-s7`); chọn `elapsed_sim_ms` 12 000 (tick 600), cách điểm bắt đầu chạy đều của cloud (~ tick 460) hơn 100 tick và còn chỗ trượt ~0.8 m trước cuối đoạn.
- **Điều kiện đầu vào (kiểm trước, không phải tiêu chí đạt):** trên cả hai bản, trong 25 tick trước lệnh, vận tốc ≥ 95 % vận tốc chạy đều (đúng `cruiseOf`) và |ω| ≤ 0.05 rad/s; |v_cloud − v_Mac| ≤ 2 % v_Mac; |Δyaw| ≤ 0.02 rad. Không đạt → `ENTRY_CONDITION_MISMATCH` (lỗi thiết kế ca, không phải lỗi dung sai).
- **Phép so (giữ dung sai như R4, không nới):** tick dừng, `torqueZeroTick` từng bánh, trạng thái, served, `cupTipped` khớp tuyệt đối; `stopDistanceM`, `stopTimeMs`, `peakDecelerationMps2` lệch ≤ 5 %. Nếu đầu vào đạt mà quãng đường vẫn lệch > 5 %, điều tra runtime, controller và mô hình vật lý trước khi bàn đến tiêu chí.
- **Tham chiếu Mac** phải là run cùng commit, cùng ca; vì vậy ca này cần vào bảng `stop-v1` (hoặc producer tự chạy bản Mac) → đổi script/bảng → candidate 03 (chuỗi đầy đủ, dừng Supabase), rồi deploy lại và ghi CLD06.
- Tách riêng: pha xoay tại chỗ dao động ~6 s và khuếch đại sai khác dấu phẩy động; đáng xem ở controller (`grid-diff-v1` + `exhausted-route-correction`), vì mọi sự kiện theo thời gian sim đều nhạy với nó.
