# R02 — Guided usability

Status: `blocked_external`; execution: `not_run`. Chưa có người dùng mới tham gia và đồng ý ghi nhận kết quả. Browser automation không thay thế guided test.

Cần ít nhất 5 người mới dùng Lab. Người điều phối giải thích phạm vi mock/native, xin consent và dùng mã U01–U05 thay tên cá nhân trong evidence công khai. Không ghi pairing token, thông tin khách hàng hoặc dữ liệu cá nhân.

| Task | Tiêu chí quan sát |
|---|---|
| Mở package và ghép nối | Mở được UI, nhập code đúng, giải thích được runtime đang dùng |
| BV01 | Chạy tới giao cốc, xác định đúng chủ sở hữu hiện tại |
| Phạm vi bằng chứng | Phân biệt mock, native simulation và hardware chưa kiểm |
| Missing cup | Chèn lỗi, tìm được lý do và đối tượng ảnh hưởng |
| Recovery | Xác nhận kiểm tra trước reconcile; không coi unknown là delivered |
| Replay / export | Tìm thời điểm lỗi và xuất report có revision/source/provenance |

Mỗi người/task cần lưu: hoàn tất hay chưa, số lần cần trợ giúp, lỗi gặp, thời lượng đo thực, severity và issue liên quan. Kết quả chỉ được ghi sau buổi kiểm thử. Không dùng template trống làm bằng chứng PASS. R-MOCK vẫn chờ các gate package/fresh-machine/usability tương ứng.
