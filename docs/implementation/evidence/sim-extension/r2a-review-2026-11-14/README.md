# R2a sau code review — 2026-11-14

Runtime được ghi và deploy: source `4f893ac6fb75dff414a3ee42a726defb7935c734`; Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`. Chỉ mục hiện hành: [implementation](../../../README.md).

Các bản sửa trước lần ghi gồm: capsule ARM03 bao cả lòng bàn tay; từ chối fault MuJoCo không hỗ trợ trước khi tạo hiệu ứng; đóng run/worker hết phiên trước readiness và admission; nút thoát chế độ xem trên cảm ứng; recorder tắt pytest cache; tăng buffer cho cây Git lớn; loại metadata Python editable install khỏi định danh native (portable vẫn kiểm nghiêm); bốn test khởi động Python với `-B`.

Chuỗi mới: IR-SIM `candidate-09`, R1 `r1-candidate-07`, R1.1 `r11-candidate-04`, R2a `r2a-candidate-02`; R-MOCK tại Lab `sim-extension-r2a/regression-02`. Mọi recorder exit 0 và định danh ổn định. Source unit trong hồi quy: 551 passed; Lab unit: 520 passed, 1 skipped; guard R-MOCK chạy riêng trên đúng hai commit: 41/41 (log tại Lab `mock-acceptance-02`). Những test skipped giữ nguyên nhãn, không tính là pass.

Guard sau khi đưa bằng chứng vào repo:

| Guard | Đạt |
| --- | --- |
| IR-SIM | 6/6 |
| R1 | 12/12 |
| R1.1 | 12/12 |
| R2a cục bộ | 12/12 |
| Cloud Run bổ sung | 1/1 |

Log máy đọc và đầu ra gốc ở `guards/`. Log gốc giữ nguyên CR/dòng trống cuối tệp để không đổi byte bằng chứng; kiểm whitespace của phần viết tay ngoài evidence đã đạt. Guard Cloud mới có 24 unit test; 10 regression bổ sung đã được chạy đỏ trước khi sửa các đường chấp nhận sai được reviewer tìm thấy. Typecheck và lint đều đạt. Guard/tài liệu không thay runtime, schema hay portable closure, nên Lab và image tiếp tục dùng pin `4f893ac` đã kiểm chứng.

[Cloud Run mekoniq](../../cloud-run/mekoniq-2026-11-14/README.md) đã deploy theo lệnh người dùng, CL01 đạt trên x86-64 thật. Bản bổ sung ràng buộc SHA-256 của R2a gốc; G-CLOUD1 `tested` qua guard riêng, không sửa trạng thái legacy trong qualification gốc. Giữ cả kết quả giả lập amd64 thất bại và lần smoke bị capacity vì chưa archive; producer cuối đã ghi con trỏ SSE kết thúc và archive cả hai run.

Chưa có `acceptance.json`; chưa push main. Kiểm tay Chrome/Firefox/Safari trên build HTTPS mới còn `not_run`; ALG04 thuộc R3, native/phần cứng ngoài phạm vi. Kết quả không chấp nhận bằng chứng thay người duyệt.
