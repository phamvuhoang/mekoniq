# R4 candidate 02 — source `0650ecbd`, Lab `de4d0c3` (25/11/2026)

`accepted:false` ở mọi nơi; chưa ai ký chấp nhận. Raw archive nằm ngoài git ở `robot/evidence-archive/r4-chain-0650ecbd/` (guard cần thư mục đã giải nén). Trong cây chỉ có JSON cấp trên, `index.json` (sha256 từng bản ghi) và vài bản tóm tắt.

| Gate | Trạng thái |
|---|---|
| G-DRV1, G-CIL1, G-TUNE1, G-FLT1, G-TRAY1, G-BEL1, G-REC1, G-CAL1, G-WEB2, G-REG5 | `tested` |
| G-CLOUD2 | record R4 ghi `not_run` (CLD03 `deploy_order_pending` lúc ghi); sau lệnh deploy ngày 25/11, supplement [`cloud-run/mekoniq-r4-2026-11-25`](../../cloud-run/mekoniq-r4-2026-11-25/README.md) chứng minh CLD03 trên Cloud Run thật (guard `cloud-run` đạt); không sửa `qualification.json` |

55/56 case `tested` trong record; case còn lại là CLD03, được supplement Cloud Run bổ sung. Đọc lại: `node scripts/r4-readback.mjs <archive>/r4-candidate-02 <source> <lab>` → `issues: []` (5 phút 18 giây); `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r4-candidate-02 pnpm test:acceptance -- sim-extension` → 12/12. Lưu ý: test chính của guard có timeout cứng 300 s, record 3,7 GB cần khoảng 320 s; lần chạy đầu quá hạn 300 s, lần chạy lại với timeout nâng lên tạm thời (đã hoàn nguyên, không commit) đạt 12/12 (`logs/27-acceptance-guard*.log` trong archive).

## Số đo
- **WEB09** (build production, 1440×900, Chrome/ANGLE Metal, dpr 1; giới hạn 33 ms): đồ thị 5.010 mẫu/trục, rAF p95 16,7 ms (max 16,8 ms, 61 s); lớp belief trên replay offline: rAF p95 16,8 ms, thời gian vẽ p95 1,9 ms, nhịp render p95 18,5 ms, hình ma có trong 82,8 % lần vẽ (≥ 80 %), 78,8 s phát. `records/web09.json`.
- **REC06** (`mj-cell-recovery-v2`, 11/11 case): 3 seed (7, 42, 99) với nudge v2 đã đăng ký: lần gắp đầu `grip_not_established`, lần thử lại `lifted`, phục vụ 2 cốc; các case nominal, cup-fall, dock-drift, lost-ack, worker-loss, cancel-held khác đạt như đăng ký. Chương trình gắp hai bước là chương trình có phiên bản (xem ledger), không phải chứng minh cho chương trình cũ.
- **Nghiên cứu sai số nhận thức**: 92/92 lượt, điểm cuối là kết thúc lượt gắp cốc đầu tiên (`records/perception-gap-v1-summary.json`).
- **Native CLD02**: GitHub Actions run 45382425302 trên Linux x86-64, 322 passed, image `sha256:840c286e…bbcbee1` (`records/native-handoff.json`, `records/native-image.json`).
- **CAL**: chỉ tự kiểm synthetic; không có revision đã hiệu chuẩn, G3 vẫn `not_run`.

## Điều cần biết
- Hosted platform CI (run 45382425254): unit, contracts, adapters, python đạt; integration đỏ ở 20 file cần công cụ portable runner không có (MuJoCo, Webots, IR-SIM, LinuxCNC), giống `main` từ 12/11. Các file đó chạy trên Mac ở bước `pnpm test` của chuỗi (2000 unit, 140 contracts, 1521 test integration đạt, 9 skip, 212 file đạt và 1 file skip).
- Chuỗi chạy theo nhiều lần dừng/tiếp (xem `LEDGER-note-attempt3.md` trong archive): các bước chỉ phụ thuộc Source (container, WEB05, physics, cell, study, `pnpm test`, 6 campaign, calibration) được ghi khi Lab ở `0399ecf`; sau khi sửa legend belief ở Lab (`de4d0c3`), các bước phụ thuộc Lab (regression, IR-SIM, r1, r1.1, r2a, build, web capture/verify, r2b, r4) được ghi lại ở `de4d0c3`. Record chưa có lần chạy liền một mạch.
- Các lỗi tìm thấy khi ghi: `upgrade-recovery` xung đột với guard owned CI (sửa ở Source `0650ecbd`), umask 077 làm image không đọc được (chỉ sửa script chuỗi), spec `mujoco-cell` lỗi thời, legend belief không theo cursor replay 3D (sửa ở Lab).
- Lab `de4d0c3` và chuỗi commit Lab chưa push; Source `0650ecbd` đã ở nhánh `r4/virtual-commissioning` trên GitHub.
