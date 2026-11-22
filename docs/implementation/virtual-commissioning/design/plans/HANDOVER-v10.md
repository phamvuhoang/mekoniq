# Handover V10 — sau V09 (21/11/2026)

**V09 xong phần phần mềm** trên nhánh `r4/virtual-commissioning` của hai repo; chưa push, chưa deploy, mọi record `accepted:false`. Chi tiết, rulings và rủi ro mở: [plan 02, "V09 — trạng thái ngày 21/11"](02-workbench-faults-tray.md). Handover V09 ([HANDOVER-v09.md](HANDOVER-v09.md)) vẫn đúng cho runtime.

## Checkpoint

| Thành phần | Revision |
|---|---|
| Source runtime (đã ghi và verify ở V08) | `6d686125697e43c52ae620d2b9c81c0460f9fd2e` (không đổi ở V09) |
| Source HEAD | `af4d81ad` (chỉ thêm ca CLD01 lỗi; không đổi runtime) |
| Lab pin | `1d66e08` (pin `6d686125`) |
| Lab HEAD | `c4bfcee` |

## Kiểm chứng V09

| Kiểm tra | Kết quả |
|---|---|
| Lab unit | **785 đạt**, 1 skip có sẵn (`twin-telemetry-measure`); `pnpm build` đạt |
| e2e `mujoco-faults.spec.ts` (runtime MuJoCo thật, cookie + CSRF cùng origin) | đạt; xem rủi ro mở về lần chạy nguội |
| e2e `replay-offline.spec.ts` | 4/4 (mẫu `drive-fault`: không cần runtime, hash manifest khớp, con trỏ nhảy tới tick 2401) |
| e2e `mujoco-control.spec.ts` (TUNE04) | đạt sau các đổi V09 |
| CLD01, image `linux/arm64` `af4d81ad` | đạt: cell phục vụ 2, ca lỗi có biên nhận, bench, read-only root |
| Chưa chạy | CLD02 (image amd64 / native Linux) cho R4.3, CLD03 |

## Việc cho V10 (khay ba cốc) và sau đó

- V10 là scenario `MJ-TRAY01` (plan 02, spec R4-A §7.4): năm biến thể, oracle Coulomb cho A′ và B, câu gợi ý thiết kế chỉ từ số đo hợp lệ; không hứa cốc trượt. CLD01/CLD02 cho R4.3 làm sau V10.
- Studio lỗi (V09) dùng `health.faultCatalog` làm nguồn; một fault mới của V10 (nếu có) phải vào catalog ở Source, studio tự hiện.
- Mẫu thứ hai (`belief-recovery`, WEB10) thuộc V13.
- Giữ: lịch lỗi drive là input của run, không vào project; `drive-reset` không bao giờ hiện trong studio; không sửa `lab-fault-schedule.schema.json`; Python `-B`, `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`.
- e2e MuJoCo: một spec một launcher, cổng riêng (`--ui-port 42455 --runtime-port 42456`, `--same-origin`); bản ghi mẫu: `LAB_FAULT_SAMPLE_DIR=… test-irsim-e2e.mjs … mujoco-fault-sample.spec.ts` rồi giải nén ZIP vào `public/replays/<id>/`, đổi mọi tài sản `encoding: gzip` thành `…​.bin`, thêm `catalog.json` (băm `manifest.json`).
