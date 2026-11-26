# R5 candidate 01 — source `6da4ca94`, Lab `78c9c38` (26/11/2026)

`accepted:false` ở mọi nơi; chưa ai ký chấp nhận. Archive thô nằm ngoài git ở `robot/evidence-archive/r5-chain-6da4ca94/` (guard cần thư mục đã giải nén). Trong cây chỉ có JSON cấp trên và `index.json` (sha256 từng bản ghi, đường dẫn log). Identity ổn định suốt bản ghi.

Ba SHA khác nhau: **candidate** = source `6da4ca945f89…` / Lab `78c9c3883348…` (tuple được ghi); **guard chạy lại** = `f4c72c29` (commit `test:` chỉ nâng timeout của test đọc toàn bộ artifact từ 300 s lên 1 200 s, assertion và Lab pin giữ nguyên); **commit tài liệu** = commit chứa thư mục này (đi sau, làm source identity tiến lên, không đổi tuple của bản ghi).

| Gate | Trạng thái |
|---|---|
| G-DEV1, G-ELE1, G-DOC1, G-STP1, G-WEB3, G-REG6 | `tested` |
| G-VIO1 | `not_run`: VIO01–04, E14 (I/O ảo) bị cắt |
| G-DGN1 | `not_run`: DGN02 (chọn bằng chuột), DGN04 (đánh dấu cảnh báo trên twin) chưa làm; DGN01/03 `tested` |
| G-CLOUD3 | `not_run`: CLD05 (native x86-64), CLD06 (`deploy_order_pending`); CLD04 `tested` theo phép so body bundle hiện có |
| G-BENCH1, G-SAFE1 | `blocked_external` (ngoài 48 case) |

40/48 case `tested`, 8 `not_run`, 0 `failed`. REG06 = bản ghi R4 cùng tuple (`records/r4-qualification.json`, R4 để `not_run` CLD02/CLD03).

## Đọc lại và guard
- Reader trực tiếp trong chuỗi: R4 `problems: []` (330 s), R5 `problems: []` (331 s).
- Guard chính thức trong chuỗi (bước 27 và 31): 11/12, test đọc toàn bộ artifact hết hạn 300 s; bước 31 chạy dưới `|| true` của driver tiếp nối nên dòng `finished ["0","1"]` không chứng minh guard đạt.
- Guard chạy lại sau ghi ở `f4c72c29`, Node 24.22.2: `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r4-candidate-02 pnpm test:acceptance -- sim-extension` → 12/12, exit 0 (322 s); `…/r5-candidate-01` → 12/12, exit 0 (339 s). SHA-256 của hai `qualification.json` trước = sau (R4 `a6c70718…`, R5 `59d2ae52…`). Log: `logs/guard-rerun-f4c72c29-*.log` trong archive.

## Lịch sử chuỗi
Lần thử thứ 4 (driver `run-final-chain-v6.sh`, bắt đầu 25/11 23:21Z). Bước 01–26 exit 0. Bước 27 dừng chuỗi vì timeout guard; chạy tiếp bằng hai driver tiếp nối (`run-r5-continuation*.sh`, cùng tuple, event `continuation` trong `status.ndjson`). Bước 29 lần đầu lỗi vì umask 077 (image không đọc được, `logs/29-container-r5-FAILED-umask077.log`), chạy lại dưới umask 022 đạt. Ba lần thử trước (tuple 841556da, f55c5826) thất bại và được giữ trong archive dưới tên `*-FAILED-*`.

## Giới hạn đã biết (review 26/11, sửa ở candidate kế tiếp)
- Oracle dừng cho `pass` khi thiếu hàng của một trục; allocator nhận điểm chưa biết chu kỳ cho tín hiệu có giới hạn trễ; verifier gói nhận gói thiếu `drive-model.derived.json` khi manifest và checksums nhất quán.
- Diagnostics hiện trạng thái của mẫu đầu trước khi có mẫu; câu gợi ý dừng gọi mọi emergency là thả trôi và so khi thiếu provenance.
- CLD04 so hash body sáu trường thay vì digest đầy đủ, chấp nhận tick dừng 411–413 thay vì đúng tick 412; verifier S4 chưa đối chiếu cửa sổ mất lệnh với tick dừng.
- Mọi số điện là `assumed`/`candidate`; mọi số dừng là mô hình chưa hiệu chuẩn; `hardwareValidated:false`, `controlAuthority:false`.
