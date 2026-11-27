# R5 candidate 03 — source `9de1a285`, Lab `a3b2f9f4` (27/11/2026)

`accepted:false` ở mọi nơi; chưa ai ký chấp nhận. Archive thô ở `robot/evidence-archive/r5-chain-9de1a285/` (ngoài Git; guard cần thư mục đã giải nén); CLD05 (CI x86-64 thật, run GitHub Actions `45919345542`, nhánh `r5/cld05` ở `9de1a285`) ở `robot/evidence-archive/r5-cld05-9de1a285/`. Trong cây chỉ có JSON cấp trên và `index.json`. Identity ổn định. Thay thế `r5-candidate-02` (`0d365afd` / `ea54ebe`, còn trong lịch sử git).

| Gate | Trạng thái |
|---|---|
| G-DEV1, G-ELE1, G-DOC1, G-STP1, G-DGN1, G-WEB3, G-REG6 | `tested` |
| G-VIO1 | `not_run`: VIO01–04, E14 cắt (quyết định 26/11) |
| G-CLOUD3 | `not_run` trong record: CLD04, CLD05 `tested`; CLD06 `deploy_order_pending`. Bản bổ sung CLD06 sau deploy thất bại `CLD06_TOLERANCE_EXCEEDED:peakDecelerationMps2` → G-CLOUD3 được cắt theo quyết định trước khi chạy (xem [bản bổ sung](../../cloud-run/mekoniq-r5-cld06-2026-11-27/README.md)) |
| G-BENCH1, G-SAFE1 | `blocked_external` |

43/48 case `tested`, 5 `not_run`, 0 `failed`. REG06 = `r4-candidate-04` cùng tuple (`records/r4-qualification.json`; 54/56, CLD02/CLD03 `not_run`). Bản R4 phát hành vẫn là `r4-candidate-02`.

**Đóng R5:** `checkR5Closing(record, {cut:['G-VIO1','G-CLOUD3'], cloudSupplementIssues})` trên đúng byte của record (sha256 `303fb7a1…`) và bản bổ sung trong cây → `closed:true`, tên phát hành **"R5 không có I/O ảo, CLD06 chuyển sang R6"**. Guard: `LAB_R5_CLOSING=1 LAB_R5_CUT=G-VIO1,G-CLOUD3 LAB_CLOUD_EVIDENCE_DIR=<bản bổ sung> LAB_SIMEXT_EVIDENCE_DIR=<archive>/r5-candidate-03 pnpm test:acceptance -- sim-extension` → 13/13.

## Chuỗi và guard
Driver `run-final-chain-v8.sh` (= v7, chỉ đổi mã candidate), 27/11 01:04Z → 10:39Z, 40 bước exit 0, `finished ["0","1"]`. Guard trong chuỗi: 17c r2b 13/13, 27 R4 13/13 (315 s), 31 R5 13/13 (336 s). Supabase `mekoniq-w00-w04` dừng ở bước 16 và chạy lại ở bước 18. Lần thử trước ở tuple `8994139a` dừng ở bước 02 (TS7006 trong file test CLD06; Supabase không bị dừng), giữ ở `r5-chain-8994139a-FAILED-typecheck`. Tuple, CLD05 và đường lùi được ghi trước khi chạy trong `robot/evidence-archive/r5-candidate-03-tuple.log`.

## Giới hạn còn lại
Mọi số điện là `assumed`/`candidate`; mọi số dừng là mô hình chưa hiệu chuẩn; `hardwareValidated:false`, `controlAuthority:false`.
