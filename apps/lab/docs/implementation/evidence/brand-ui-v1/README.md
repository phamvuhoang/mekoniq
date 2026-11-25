# MEKONIQ Brand UI v1 — implementation evidence

Ngày thực thi: 2026-11-06. **Implementation đã hoàn tất và review cuối thông qua**; các profile nghiệm thu còn mở được liệt kê trong index. Ba repo dùng nhánh `feat/brand-ui-v1`. Bộ nhận diện chung **1.0.1**: Deep Teal, Motion Green, IQ Aqua, Energy Orange, Paper White; logo gốc và font tự host. Màu logo được giữ nguyên byte. Không thay DB, API, quyền hoặc lệnh robot.

Nguồn yêu cầu: [spec](../../../specs/2026-11-06-brand-ui-unification/README.md), [plan](../../../plans/2026-11-06-brand-ui-unification/README.md). [Index máy đọc](index.json) ghi trạng thái từng gate; [release receipt](release.md) ghi preview, giới hạn và rollback. Không cộng các loại test thành tỷ lệ production readiness.

## Kết quả theo ứng dụng

| Phần | Phạm vi đã triển khai | Kiểm chứng |
|---|---|---|
| Foundation | Canonical tokens/CSS, logo/font/OFL, gallery; exporter và checksum checker độc lập | 7 test foundation; chống drift, traversal, alias lỗi, version reuse; gallery axe không có vi phạm |
| Lab | Sáu workspace, VI/JA/EN, logo responsive, inspector/report, trạng thái và focus | 188 unit pass/1 skip; 27 browser pass/12 runtime-dependent skip; 7 paired mock pass; offline BV01 pass |
| Source Cloud | Public/login, tám màn admin, menu/table/order; auth và pending publication giữ nguyên | Full Source: 137 unit pass; 34 E2E pass/1 physical pilot skip; build/typecheck/lint/contracts pass |
| Source Tablet | 30 route, enrollment/offline, vùng bảng cuộn có tên, nút thao tác và print | 129 ảnh route Cloud/Tablet + 7 ảnh trạng thái; 43 báo cáo axe không vi phạm; APK debug build thành công |
| Trial | Sáu trang Node-RED và shared brand template | npm test pass; 7 integration, 6 browser regression, 36 matrix + 3 activated-state + 2 armed-confirmation axe scans; export/package/rollback pass |

Các lần chạy nhắm mục tiêu sau sửa review được ghi riêng trong logs; không cộng lại vào full-suite count. Native Android/WebView chưa kiểm trên thiết bị. Kết quả UI/mock không đóng gate native simulation hoặc hardware.

## Ảnh và review trực quan

[Baseline](baseline.json) có 55 ảnh trước migration. [Danh mục toàn bộ ảnh](screenshots.json) ghi hash, commit và kích thước ảnh. [Source manifest](source/index.json) chọn 180 file có hash (136 ảnh, 43 axe report, một Android receipt). Ảnh hậu kiểm dùng nhiều viewport để kiểm responsive, không phải golden pixel-diff với baseline. Timestamp và dữ liệu có thể khác giữa các lần chạy.

| Nhóm ảnh đại diện | Review kỹ thuật | Nội dung |
|---|---|---|
| [Lab desktop](lab-twin-1512.png), [Japanese](F05-engineering-desktop-ja.png) | Root reviewer: phù hợp phạm vi hình ảnh đã xem | Logo gốc; dữ liệu/nhãn mock và not-run còn rõ; không che controls |
| [Cloud catalog](source/cloud-admin-catalog-1280.png) | Root reviewer: phù hợp phạm vi hình ảnh đã xem | Font VI/EN; form/bảng, pending và disabled phân biệt |
| [Trial station](trial/station-vi-800.png) | Root reviewer: phù hợp phạm vi hình ảnh đã xem | Khay, robot, queue và command status rõ; dark surfaces nhất quán |
| [Tablet mobile](source/tablet-pos-390.png) | Root reviewer: phù hợp phạm vi hình ảnh đã xem | Icon compact, navigation wrap, tổng tiền và nút đủ chỗ |

Đây là review kỹ thuật của agent, chưa phải nghiệm thu người dùng. Axe hỗ trợ kiểm DOM; không chứng nhận toàn bộ WCAG, canvas, vật lý hoặc người dùng mới. Không có ảnh chứa dữ liệu khách hàng production; fixtures được tạo trên local services.

Môi trường: macOS 26.5 arm64, Google Chrome 156.0.8078.80, Node 24.22.2, pnpm 10.32.1, axe-core 4.14.0. Nhật ký ở [logs](logs/); review độc lập ở [reviews](reviews/).

Source fix cuối `8a52cb6`: thêm 8 lượt browser targeted pass cho cancellation/link và regression, build/typecheck/lint/contracts pass; APK được build lại cùng commit. Trial fix cuối `23cc7ce`: xác nhận Reset dùng Deep trên Danger, 2 trạng thái thật không phát lệnh reset, npm test và 7 integration pass. [Final review](reviews/final-review.md) đã đóng finding cuối.
