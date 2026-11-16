# MEKONIQ Restaurant Platform

Nền tảng nhà hàng và robot phục vụ, được thiết kế lại từ bản thử nghiệm `../trial`.

**Trạng thái ngày 2026-11-04:** phần mềm của cả 12 wave W00–W11 (63 task) đã nằm trên `main`. 49 task `verified_local`, 14 task `blocked_external` (chờ tablet/robot thật, nhà cung cấp thanh toán/hóa đơn/kênh bán, project hosted, diễn tập khôi phục, UAT). Chưa task nào `accepted`; `node scripts/verify-completion.mjs` báo NOT COMPLETE. Đây chưa phải chứng nhận production, Gate A, B, C hay D. Xem [trạng thái và cách chạy](docs/implementation/README.md), [bằng chứng từng task](docs/implementation/evidence/) và [Gate A](docs/implementation/gates/A-continuity.md).

## Web Lab → native và physical readiness

[Bản ghi và hướng dẫn dùng web/shared cell/replay](docs/implementation/web-lab-to-physical/README.md) giữ producer Source `981e234` / Lab `d4c3032`, runtime pin và commit công bố riêng. [Lab README](../lab/README.md#shared-cell-final-recording) có lệnh public launcher, chọn thí nghiệm, xuất/import replay và offline mock. [Kết quả cuối](docs/implementation/web-lab-to-physical/final-recording-status.md) ghi đúng mục tiêu hiệu năng chưa đạt, các qualification thiếu/failed và sáu profile chỉ prepared; không suy thành Linux/native/hardware acceptance. [GTM đã cập nhật theo bằng chứng](docs/gtm/2026-11-14-web-simulation/08-final-engineering-readiness.md) giữ demo bốn phút là guided replay và D0 chưa mở.

## Tài liệu trình bày tương tác

- [Engineering Atlas](artifacts/engineering.html): 8 chương về kiến trúc, data flow, offline, robot, chức năng và triển khai.
- [Business Plan](artifacts/business-plan.html): 11 slide với màu sắc như engineering, Nhật mặc định, BOM, mô hình doanh thu và lộ trình robot giao món → pha chế → nấu ăn.
- [Cách mở, bản xem Pages, chỉnh sửa và kiểm thử](artifacts/README.md).

Hai file HTML chạy độc lập/offline, chuyển Việt / Nhật / Anh ngay trên màn hình. Các kiểm thử giao diện của tài liệu được ghi riêng trong `artifacts`; trạng thái triển khai production không thay đổi.

## Nghiên cứu và đề xuất mới

- **[LinkForge + IR-SIM cho MEKONIQ Lab — 2026-11-08](docs/superpowers/specs/2026-11-08-linkforge-irsim/README.md)**: [nghiên cứu code và probe thư viện](docs/research/2026-11-08-linkforge-irsim.md), [plan phát triển theo task](docs/superpowers/plans/2026-11-08-linkforge-irsim/README.md). Đề xuất lịch sử; tích hợp IR-SIM/LinkForge và bản ghi hiện tại được nêu trong [trạng thái cuối](docs/implementation/web-lab-to-physical/final-recording-status.md). R-MOCK và các gate native/hardware giữ trạng thái nghiệm thu riêng.

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

[Implementation plan W00–W11](docs/superpowers/plans/2026-10-30-production-implementation-plan.md) là nguồn yêu cầu. Trạng thái thực thi nằm trong [index task](docs/superpowers/plans/2026-10-30-plan-index.json); không suy từ mã hoặc kiểm thử phần mềm rằng các gate thiết bị/cloud đã đạt.
