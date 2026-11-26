# R5 candidate 02 — source `0d365afd`, Lab `ea54ebe` (26–27/11/2026)

`accepted:false` ở mọi nơi; chưa ai ký chấp nhận. Archive thô nằm ngoài git ở `robot/evidence-archive/r5-chain-0d365afd/` (guard cần thư mục đã giải nén); bằng chứng CLD05 (CI x86-64 thật, run GitHub Actions `45805202818` trên nhánh `r5/cld05`) ở `robot/evidence-archive/r5-cld05-0d365afd/native/`. Trong cây chỉ có JSON cấp trên và `index.json` (sha256 từng bản ghi, log, `SHA256SUMS` của CLD05). Identity ổn định suốt bản ghi. Thay thế `r5-candidate-01` (source `6da4ca94` / Lab `78c9c38`, còn trong lịch sử git).

| Gate | Trạng thái |
|---|---|
| G-DEV1, G-ELE1, G-DOC1, G-STP1, G-DGN1, G-WEB3, G-REG6 | `tested` |
| G-VIO1 | `not_run`: VIO01–04, E14 (I/O ảo) bị cắt theo quyết định người dùng 26/11 |
| G-CLOUD3 | `not_run`: CLD04, CLD05 `tested`; CLD06 `not_run` `deploy_order_pending` (ghi bổ sung dưới `evidence/cloud-run/` sau deploy) |
| G-BENCH1, G-SAFE1 | `blocked_external` (ngoài 48 case) |

43/48 case `tested`, 5 `not_run`, 0 `failed`. REG06 = bản ghi R4 cùng tuple `r4-candidate-03` (`records/r4-qualification.json`; 54/56, CLD02/CLD03 `not_run`). Bản R4 phát hành vẫn là `r4-candidate-02`.

## Đọc lại và guard
Một lần chạy driver `run-final-chain-v7.sh`, 26/11 11:49Z → 21:17Z, mọi bước exit 0, `finished ["0","1"]`. Guard chính thức trong chuỗi với timeout 1 200 s: bước 27 (`r4-candidate-03`) 13/13, bước 31 (`r5-candidate-02`) 13/13. Không cần chạy lại.

Lần thử trước ở cùng tuple dừng ở bước 04 vì màn hình khóa (`SCREEN_LOCKED`), giữ trong archive dưới tên `r5-chain-0d365afd-FAILED-screen-locked`.

## Đã sửa so với candidate 01
Oracle dừng đòi đủ hàng mọi trục trong cửa sổ quan sát; S4 đối chiếu mất lệnh với tick dừng; run report mang `stopReport`; allocator báo `LATENCY_UNKNOWN`; verifier gói kiểm hai chiều manifest/checksums/file và render lại tài liệu; câu gợi ý dừng lấy brake/coast từ `onDisable`; Diagnostics không hiện trạng thái trước mẫu đầu, chọn bằng chuột trong twin (DGN02) và đánh dấu cảnh báo (DGN04) có e2e; gói tải về dạng ZIP; CLD04 so digest đầy đủ và đúng tick 412; CLD05 chạy trên host x86-64 thật.

## Giới hạn còn lại
Mọi số điện là `assumed`/`candidate`; mọi số dừng là mô hình chưa hiệu chuẩn; `hardwareValidated:false`, `controlAuthority:false`.
