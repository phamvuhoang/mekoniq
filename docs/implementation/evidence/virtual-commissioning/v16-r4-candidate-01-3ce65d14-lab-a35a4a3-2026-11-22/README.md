# R4 candidate 01 — source `3ce65d14`, Lab `a35a4a3` (22/11/2026)

`accepted:false` ở mọi nơi; không ai ký chấp nhận. Raw archive 4,8 GB nằm ngoài git ở `robot/evidence-archive/r4-chain-3ce65d14/` (guard cần thư mục đã giải nén). Trong cây chỉ có JSON cấp trên và `index.json` (sha256 của từng bản ghi và campaign).

| Gate | Trạng thái |
|---|---|
| G-DRV1, G-CIL1, G-TUNE1, G-FLT1, G-TRAY1, G-BEL1, G-REG5 | `tested` |
| G-REC1 | `not_run`: REC06 bị chặn (không lực đẩy nào làm kẹp hụt mà cốc còn trong tầm nhìn) |
| G-WEB2 | `not_run`: WEB09 chưa có recorder đo; WEB10 thiếu mẫu `belief-recovery` (WEB07, WEB08 `tested`) |
| G-CLOUD2 | `not_run`: CLD02 cần host Linux x86-64 thật, CLD03 `deploy_order_pending` (CLD01 `tested`) |
| G-CAL1 | `not_run`: chưa có `--calibration-selftest` (ngoài điều kiện đóng R4) |

45/56 case `tested`. Đọc lại: `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r4-candidate-01 pnpm test:acceptance -- sim-extension` (12/12 ở 22/11/2026). Các record release trước (irsim, r1, r1.1, r2a, r2b) cùng tuple nằm ở `records/`; các record 3d8c2a8 trong cây `evidence/sim-extension/` và `evidence/linkforge-irsim/` giữ nguyên (lịch sử, guard của chúng không đổi).
