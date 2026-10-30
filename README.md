# MEKONIQ Restaurant Platform

Nền tảng nhà hàng và robot phục vụ, được thiết kế lại từ bản thử nghiệm `../trial`.

**Trạng thái ngày 2026-10-30: thiết kế đã được người dùng duyệt; đã lập implementation plan gồm 12 wave, 63 task; chưa triển khai mã ứng dụng production.** Các kiểm thử đã chạy là kiểm thử của bản chụp `trial`, không phải chứng nhận cho hệ thống mới.

## Thiết kế đã duyệt và kế hoạch triển khai

1. [Kết quả đọc trial và nghiên cứu nguồn chính thức](docs/research/2026-10-30-trial-and-platform-research.md).
2. [Kiến trúc production, hợp đồng robot, dữ liệu và vận hành](docs/superpowers/specs/2026-10-30-production-platform-design.md).
3. [Offline nhiều thiết bị, phục hồi mạng và nhập bù bảo trì](docs/superpowers/specs/2026-10-30-offline-continuity-design.md).
4. [Phạm vi chức năng và tiêu chí nghiệm thu](docs/product/2026-10-30-capability-matrix.md).
5. [Implementation plan tổng, thứ tự 12 wave và tiêu chí nghiệm thu](docs/superpowers/plans/2026-10-30-production-implementation-plan.md).
6. [Danh mục task và truy vết yêu cầu dạng JSON](docs/superpowers/plans/2026-10-30-plan-index.json).
7. [Stack Next.js/Vercel, Supabase Free và tablet HTML](docs/superpowers/specs/2026-10-30-vercel-supabase-free-stack.md).

Stack được chọn: **Next.js cho web/API trên Vercel; Supabase cho PostgreSQL/Auth/Realtime/Storage**. Supabase **Free** là profile tương thích bắt buộc (Supabase không có tên gói Hobby). Vercel cho triển khai thương mại dùng gói cho phép commercial, baseline Pro. Giới hạn dung lượng, pause, email, backup và kiểm chứng production được quy định trong spec stack; Free không đồng nghĩa tải hoặc SLA không giới hạn.

Tablet giữ hướng **HTML/CSS/JavaScript như trial**, viết module TypeScript và đóng bundle Vite trong Capacitor. Kotlin/SQLite/Keystore và LAN service đảm nhiệm offline; không dựa vào browser thuần hoặc cloud Realtime để phối hợp khi mất Internet. Web quản trị/khách dùng Next.js. Toàn bộ phần mềm có thể phát triển với Next.js và Supabase CLI local; nghiệm thu cloud/provider/phần cứng vẫn cần môi trường tương ứng.

Ràng buộc đã được người dùng xác nhận: **không có máy chủ riêng tại nhà hàng; hệ thống dùng cloud và phải có giải pháp offline khi mất Internet**. Robot qua adapter trên thiết bị sẵn có, ROS 2/Nav2 chạy trên robot. Node-RED là tích hợp tùy chọn.

Offline phải gồm cả nhiều tablet POS/KDS/robot phối hợp khi còn LAN, ghi độc lập khi LAN cũng mất rồi đồng bộ lại, và nhập bù có đối soát cho thời gian bảo trì toàn bộ. Thiết kế đã duyệt dùng một tablet có sẵn làm coordinator LAN; quyền thu bill và điều khiển robot không tự chuyển khi timeout.

Toàn bộ công việc mới nằm trong `source`. Không sửa `trial`, không triển khai vào hệ thống robot đang chạy, không phụ thuộc đợt nâng cấp restaurant feature policy của phiên làm việc khác.

Bước triển khai đầu tiên là [W00-T01: workspace và API lifecycle](docs/superpowers/plans/2026-10-30-wave-00-foundations.md). Mỗi task có file sở hữu, hợp đồng, test, lệnh xác minh và bằng chứng nghiệm thu. Các lệnh trong kế hoạch dành cho giai đoạn triển khai; README sẽ bổ sung lệnh cài đặt/chạy/kiểm thử sau khi có mã ứng dụng thực tế.
