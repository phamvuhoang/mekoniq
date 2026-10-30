# MEKONIQ Restaurant Platform

Nền tảng nhà hàng và robot phục vụ, được thiết kế lại từ bản thử nghiệm `../trial`.

**Trạng thái ngày 2026-10-30: đã nghiên cứu và có thiết kế đề xuất; chưa triển khai mã ứng dụng production.** Các kiểm thử đã chạy là kiểm thử của bản chụp `trial`, không phải chứng nhận cho hệ thống mới.

## Tài liệu để duyệt thiết kế

1. [Kết quả đọc trial và nghiên cứu nguồn chính thức](docs/research/2026-10-30-trial-and-platform-research.md).
2. [Kiến trúc production, hợp đồng robot, dữ liệu và vận hành](docs/superpowers/specs/2026-10-30-production-platform-design.md).
3. [Offline nhiều thiết bị, phục hồi mạng và nhập bù bảo trì](docs/superpowers/specs/2026-10-30-offline-continuity-design.md).
4. [Phạm vi chức năng và tiêu chí nghiệm thu](docs/product/2026-10-30-capability-matrix.md).

Ràng buộc đã được người dùng xác nhận: **không có máy chủ riêng tại nhà hàng; hệ thống dùng cloud và phải có giải pháp offline khi mất Internet**. Backend TypeScript chia module và PostgreSQL đặt trên cloud; ứng dụng tablet lưu dữ liệu/giao dịch cục bộ và đồng bộ; robot qua adapter trên thiết bị sẵn có, ROS 2/Nav2 chạy trên robot. Node-RED là tích hợp tùy chọn.

Offline phải gồm cả nhiều tablet POS/KDS/robot phối hợp khi còn LAN, ghi độc lập khi LAN cũng mất rồi đồng bộ lại, và nhập bù có đối soát cho thời gian bảo trì toàn bộ. Đề xuất dùng một tablet có sẵn làm coordinator LAN, không thêm máy chủ riêng; quyền thu bill và điều khiển robot không tự chuyển khi timeout.

Toàn bộ công việc mới nằm trong `source`. Không sửa `trial`, không triển khai vào hệ thống robot đang chạy, không phụ thuộc đợt nâng cấp restaurant feature policy của phiên làm việc khác.

Sau khi thiết kế được duyệt: lập kế hoạch triển khai chi tiết, xây mã theo các mốc có nghiệm thu trong thiết kế, và cập nhật README bằng lệnh cài đặt/chạy/kiểm thử thực tế. Không có lệnh khởi chạy production ở trạng thái hiện tại.
