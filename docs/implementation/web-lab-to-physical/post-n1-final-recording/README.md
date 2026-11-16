# Bàn giao local sau N1

Có thể dùng local: web/shared cell MuJoCo, đổi thí nghiệm và xem lại dữ liệu đã ghi qua replay. Producer là Source `0d46403` / Lab `7c97b20`, khác commit công bố tài liệu. Browser/replay, payload 19 ca và cell 8 ca có bằng chứng riêng; sáu profile Linux/hardware mới ở mức **prepared**, chưa chạy native/phần cứng.

Case browser chạy pass không đồng nghĩa artifact reader chấp nhận: reader hiện còn từ chối argv `--output` do producer ghi khác danh sách lệnh nó đợi.

**Còn lỗi, chưa nghiệm thu:** capture 185 giây bị reader từ chối; mock còn 4 assertions thất bại; Webots journey có thêm 1 lỗi mode badge. Lineage kế tiếp giữ refusal/thiếu candidate thật, không dùng kết quả độc lập để thay thế. Các verdict review là lịch sử ở đúng tuple/scope, không đóng những lỗi ghi sau đó. `accepted:false`, `not_calibrated`; D0 chưa mở.

- [Lệnh chạy shared cell và replay](reproduce.md)
- [Kết quả hiện tại và từng failure/not_run](status.md)
- [Việc còn lại cho hai nhánh xArm và custom/PUMA](dispositions.md)
- [Readiness GTM và demo guided replay bốn phút](../../../gtm/2026-11-14-web-simulation/09-post-n1-engineering-readiness.md)

[Raw index](../../evidence/web-lab-to-physical/post-n1-final-recording/index.json), [bản đồ đầy đủ report/review](retention/current-readable-location-map.json) và [nguyên văn rulings](retention/rulings-whole-lines.md) giữ bằng chứng chi tiết. Hai file ảnh/context của lỗi journey đã thiếu trước lần kiểm default đầu tiên; khoảng thiếu được ghi rõ, ảnh trước Run không thay thế chúng. [Thế hệ cũ](../retention/full-readable-copy-map.json) giữ nguyên byte và identity lịch sử.
