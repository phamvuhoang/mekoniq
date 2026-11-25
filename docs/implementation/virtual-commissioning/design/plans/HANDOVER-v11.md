# Handover V11 — sau V10 (21/11/2026)

**V10 xong phần phần mềm, review V08–V10 đã xử lý (xem mục "Xử lý review V08–V10" trong plan 02)** trên nhánh `r4/virtual-commissioning` của hai repo; chưa push, chưa deploy, mọi record `accepted:false`. Chi tiết, rulings, số đo và việc hoãn: [plan 02, "V10 — trạng thái ngày 21/11"](02-workbench-faults-tray.md). Handover V10 ([HANDOVER-v10.md](HANDOVER-v10.md)) vẫn đúng cho studio lỗi.

## Checkpoint

| Thành phần | Revision |
|---|---|
| Source runtime (ghi và verify sau review) | `1012ae3303696d4ec87103b8ea506e2143662769` |
| Source HEAD | `1d2b7ab5` (chỉ thêm evidence; runtime không đổi) |
| Lab pin | `fd0e9b8` (pin `1012ae33`) |
| Lab HEAD | `5221ad2` |
| Campaign `tray-v1` | 11/11, verify exit 0 ở `1012ae33`; raw `robot/evidence-archive/r4-tray-v1-1012ae33/`; tóm tắt `docs/implementation/evidence/virtual-commissioning/v10-tray-2026-11-21/` |
| Campaign `fault-v1` | 23/23, verify exit 0 ở `1012ae33`; raw `robot/evidence-archive/r4-fault-v1-1012ae33/`; tóm tắt `.../v08-faults-recheck-2026-11-21/` |

## Việc tiếp theo

- R4.3 đã đủ bằng chứng phần mềm (G-FLT1, G-TRAY1) trừ CLD02 (image `linux/amd64`, `scripts/r4-cld02.sh`) và CLD03: chưa chạy, cần lệnh của người dùng.
- V11 (belief, `plans/03-belief-and-recovery.md`): hợp đồng belief, bộ ước lượng mô phỏng, gắp theo niềm tin.
- Giữ: lịch lỗi drive là input của run; không sửa `lab-fault-schedule.schema.json`; Python `-B`, `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`; một spec e2e một launcher (`--ui-port 42455 --runtime-port 42456`); chạy engine thật lâu (khay ~1–2 phút/ca), campaign cần cây sạch.
- Bản ghi mẫu thứ hai (`belief-recovery`) thuộc V13.
