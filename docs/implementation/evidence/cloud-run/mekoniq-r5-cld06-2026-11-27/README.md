# CLD06 của `r5-candidate-03` trên Cloud Run — thất bại `CLD06_TOLERANCE_EXCEEDED:peakDecelerationMps2` (27/11/2026)

`accepted:false`. Bản bổ sung đầy đủ cho `r5-candidate-03` (`qualification.json` sha256 `303fb7a1…`); `checkCloudRunR5Evidence` đọc lại mọi file theo `checksums.json` và tính lại verdict từ stream: issue duy nhất là `CLD06_TOLERANCE_EXCEEDED:peakDecelerationMps2`.

- **Deploy:** image CI CLD05 `sha256:b3070230…` (không dựng lại), đẩy thành `…/mekoniq-lab-runtime:r5-9de1a285` (`sha256:410f9f13…`), revision `mekoniq-lab-runtime-00007-q9t`, 100 % traffic (`--to-latest`); health công khai `9de1a285`. Đường lùi ghi trước: revision `00005-s68`, Vercel `dpl_3NxQwSoN1F5vP36f34yW6bBdzt9s` (mekoniq), `dpl_69k2Sq7zAyxzAJWguSRrAWDSA28E` (mekoniq-lab).
- **Ca (chốt 27/11 trước khi chạy):** MJ-TRAY01, `tray-stop-coast-v1`, seed 7, dừng khẩn thả trôi ở 12 000 ms (tick 601). Đạt: health, ba digest điện trùng Mac, receipt và torque từng bánh 0 ở 601, `needs_attention`, served 0, cốc không đổ, stream vật lý đủ từng tick ở cả hai bản (`physics/`, `mac/physics/`).
- **Điều kiện đầu vào: đạt** (25 tick trước lệnh; v Mac 0.477–0.483, cloud 0.479–0.481; lệch vận tốc, yaw trong ngưỡng).

| Metric | Mac (arm64) | Cloud Run (x86-64) | lệch | ngưỡng 5 % |
|---|---|---|---|---|
| `stopDistanceM` | 0.8138 | 0.8145 | 0.09 % | đạt |
| `stopTimeMs` | 3 280 | 3 240 | 1.2 % | đạt |
| `peakDecelerationMps2` | 0.1721 | 0.1810 | 5.2 % | **vượt** |

Chẩn đoán (không gate): đứng yên ở tick 765 / 763; tick kết thúc 1 501 / 1 506; quãng đường cả run 3.087 / 2.641 m (hai run tách nhau sau cửa sổ quan sát).

**Kết cục (quyết định trước khi chạy, 27/11):** trượt chỉ ở phép so số với Mac khi health, phần điện và kết cục dừng đều đạt → ghi nguyên kết quả và trace, G-CLOUD3 được cắt (`CUTTABLE_R5`, chỉ khi issue của bản bổ sung là `CLD06_TOLERANCE_EXCEEDED`/`ENTRY_CONDITION_MISMATCH`), R5 đóng là "R5 không có I/O ảo, CLD06 chuyển sang R6", giữ revision mới và push `main`. CLD06 là việc đầu tiên của R6: giảm tốc đỉnh là cực đại trên cửa sổ trượt 5 tick nên nhạy hơn hai metric kia (giữa Mac và container Linux arm64 đã lệch 3.2 % khi chạy thử).

**Tham chiếu Mac (`mac/`)** ghi bằng `record-r5-cloud.mjs reference` từ cây sạch ở tuple candidate, runtime đã pin (`apps/lab/.runtime/4e8d9613…`) chạy native trên Mac với đúng các cờ của `pnpm lab:mujoco -- --mujoco-mobile`, chỉ khác là access key đặt qua `MEKONIQ_LAB_ACCESS_KEY` thay cho mã ghép một lần của launcher: mã ghép hết hạn sau 5 phút, còn bước đọc lại record của producer mất 5 phút 34 giây (lần đầu `HTTP_401_/sessions`). Kết quả trùng bit với lần chạy thử qua launcher ở `eb75e3f3` (0.8137758547027873 m, 3 280 ms, 0.17205201922728128 m/s², đứng yên tick 765). Thô: `robot/evidence-archive/r5-cld06-macref-9de1a285/`, `r5-cld06-9de1a285/`.

## Quyết định phạm vi và triển khai

Phê duyệt phạm vi và triển khai, độc lập với acceptance (record vẫn `accepted:false`, không có sidecar). Cả hai do người dùng trả lời trong phiên Claude Code `ad004a59-4d4c-4106-a3fa-d019b54cd628` (transcript cục bộ, ngoài Git):

1. **2026-11-27T09:35:26Z, trước mọi deploy và run CLD06.** Câu hỏi: nếu trên Cloud Run x86-64 health, phần điện và kết cục dừng khẩn đều đạt nhưng phép so với Mac trượt (vượt 5 % hoặc đầu vào phanh không khớp) thì xử lý thế nào. Trả lời: "Đóng R5, CLD06 sang R6", và với revision Cloud Run và `main` (push `main` là deploy production cả app cloud lẫn Lab): "Giữ revision mới, push main". Đây là ngoại lệ cắt thêm G-CLOUD3 ngoài ngoại lệ E14 của đặc tả; quy tắc máy đọc là `CUTTABLE_R5`/`CLOUD_CUT_FAILURES` ở `scripts/sim-extension-r5.mjs` (commit `a2e9aba6`).
2. **2026-11-27T15:37:58Z, lệnh trọn gói ("ok").** Ghi đường lùi trước; deploy đúng image CI `sha256:b3070230…`, không dựng lại; chờ health `9de1a285`; chạy `execute` với tham chiếu Mac; commit evidence, push `main` (cả khi CLD06 đạt), smoke `lab.mekoniq.app` và `www.mekoniq.app/health/ready`; nếu CLD06 trượt thì theo quyết định 1. Kèm chấp nhận sai khác của tham chiếu Mac (key qua biến môi trường, ghi ở trên). Smoke R4 không nằm trong lệnh và không chạy.

Deploy (revision `00007-q9t`) và push (`ae55a1c5`) diễn ra sau lệnh 2.
