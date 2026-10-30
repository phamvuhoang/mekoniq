# Phạm vi chức năng MEKONIQ và tiêu chí nghiệm thu

Ngày: 2026-10-30. Trạng thái: **phạm vi đã được người dùng duyệt; tất cả chức năng dưới đây chưa được triển khai trong `source`**.

## 1. Cách hiểu “đầy đủ như Mmenu”

Đối chiếu nhóm tính năng công khai, sau đó định nghĩa hành vi MEKONIQ kiểm thử được. Không sao chép UI, nhãn hiệu hoặc khẳng định có mọi chức năng bên trong Mmenu. Mục tiêu toàn chương trình vẫn bao gồm quản trị nhà hàng đầy đủ; các mốc bên dưới là thứ tự xây, không phải loại bỏ các nhóm chưa có ở bản đầu.

Nguồn:

- **M1**: [Mmenu trang chủ](https://mmenu.io/vn/vi): các nhóm chức năng công khai.
- **M2**: [Mmenu quản lý chuỗi](https://mmenu.vn/vn/vi/blog-news/tai-sao-chuoi-nha-hang-can-su-dung-phan-mem-ban-hang-chuyen-sau?id=4746).
- **M3**: [Mmenu QR/Zalo](https://wordpress.mmenu.io/vn/quet-ma-qr-va-dat-mon-mmenu/).
- **T**: luồng đã thấy trong baseline `trial`; xem báo cáo nghiên cứu.
- **ĐX**: chi tiết MEKONIQ đề xuất; chưa xác minh Mmenu có hành vi giống hệt.

Mốc **A**: nền móng cloud/offline và một luồng chạy xuyên suốt; **B**: phục vụ/POS tại một nhà hàng; **C**: bộ quản trị nhà hàng mở rộng; **D**: chuỗi và hệ sinh thái tích hợp. Không triển khai máy chủ riêng tại nhà hàng. Mỗi mốc đều phải vượt cổng chất lượng production tương ứng; A không được gắn nhãn toàn bộ sản phẩm hoàn tất.

## 2. Danh mục sản phẩm

| ID | Module / nguồn nhóm | Nội dung MEKONIQ cần xây | Tiêu chí nghiệm thu tối thiểu | Mốc |
|---|---|---|---|---|
| F01 | Tổ chức, nhà hàng, người dùng — M1/M2, ĐX | Tenant, chi nhánh, tài khoản, vai trò, ca và thiết bị | Người dùng/thiết bị không đọc hay ghi được dữ liệu ngoài scope; thao tác nhạy cảm có audit | A |
| F02 | Cấu hình sản phẩm — yêu cầu người dùng | Bật/tắt module, preset, phụ thuộc, readiness, revision | API từ chối chức năng tắt; tắt giữa ca không làm mất đơn/tiền/nhiệm vụ đang chạy | A |
| F03 | Menu — M1, T | Danh mục, món, đa ngôn ngữ, giá, modifier/size/topping, khung giờ và tình trạng còn món | Server tính giá; giỏ lỗi thời được báo rõ; đơn đã nhận giữ snapshot giá/cấu hình | A→B |
| F04 | Bàn, khu vực, phiên phục vụ — ĐX, T | Sơ đồ bàn, mở/đóng phiên, chuyển/gộp bàn, số khách | Hai thu ngân không gộp cùng một phiên hai lần; QR phiên cũ không thêm món sang khách mới | B |
| F05 | Gọi món đa kênh — M1/M3, T | Nhân viên, QR, tablet tại bàn, kiosk và màn robot | Gửi lặp không tạo nhiều order; phân biệt đã lưu trên thiết bị, đã nhận xử lý và đã đồng bộ cloud | A→B |
| F06 | Vòng đời order — M1, ĐX | Dine-in, takeaway, sửa món, ghi chú, thứ tự ra món, hủy có lý do/quyền | Sửa món đã chuyển bếp tạo thay đổi có theo dõi; không âm số lượng hoặc mất lịch sử | B |
| F07 | KDS/bếp/bar — M1 | Chia theo trạm, nhận/chế biến/sẵn sàng, ưu tiên, báo hết món | Chỉ số lượng đã sẵn sàng được phân bổ vào lượt giao; reconnect không mất ticket | A→B |
| F08 | Điều phối giao và thu dọn — T | Multi-stop, khay theo robot, load/handoff/return/unload, gọi robot | Hủy khi có tải tạo bước trả đồ; xác nhận đích cũ không kết thúc điểm mới | A→B |
| F09 | Đội robot đa giao thức — yêu cầu người dùng | Registry, capability, adapter, map binding, telemetry và command journal | Cùng nghiệp vụ chạy với simulator và các adapter đã đạt bộ conformance; thiếu capability không được gán | A→B/D |
| F10 | Thu ngân và bill — M1, chi tiết ĐX | Tạm tính, giảm giá có quyền, tách/gộp bill, service charge, tax profile, làm tròn | Tổng các phần tách bằng bill gốc; thay đổi cấu hình không sửa bill đã chốt | B |
| F11 | Thanh toán — M1, T, chi tiết ĐX | Tiền mặt, xác nhận giao dịch tại terminal ngoài, chuyển khoản thủ công, cổng thanh toán | “Khách báo đã trả” không thành settled; partial/mixed tender không thu trùng; webhook được kiểm chứng | B/D |
| F12 | Hoàn/hủy và đối soát — ĐX | Void trước thu; refund từng phần/toàn phần; đối soát ca/ngày | Refund không vượt tiền đã thu còn được hoàn; giao dịch đảo có liên kết bản gốc và lý do | B |
| F13 | Ca thu ngân, két tiền — ĐX | Mở/đóng ca, tiền đầu ca, thu/chi, chênh lệch, phê duyệt | Báo cáo ca khớp ledger theo từng phương thức, kể cả refund và giao dịch muộn | B |
| F14 | In và thiết bị — ĐX | Phiếu bếp, tạm tính, receipt, in lại, hàng đợi máy in | Mất máy in không mất order; bản in lại có dấu và audit; timeout mơ hồ không tự in vô hạn | B |
| F15 | Gọi nhân viên, hỗ trợ, dẫn khách — T | Call staff, request bill, báo nhầm món, guide có kiểm tra capability | Yêu cầu lặp được gộp; guide không gán robot không biết đích; xử lý thủ công luôn có đường vào | B |
| F16 | Đặt bàn và danh sách chờ — ĐX | Lịch đặt, giữ chỗ có hạn, check-in, no-show, đặt cọc | Không overbook tài nguyên theo khoảng giờ; chuyển đặt cọc vào bill có ledger | C |
| F17 | Khuyến mãi — M1, chi tiết ĐX | Theo món/bill/khung giờ/chi nhánh; voucher; quy tắc cộng dồn | Hai lần dùng mã giới hạn cùng lúc không vượt hạn mức; hoàn tiền hoàn tác theo chính sách đã lưu | C |
| F18 | CRM và loyalty — M1 | Hồ sơ khách, lịch sử, đồng ý liên hệ, điểm và hạng | Điểm có ledger; không cộng hai lần; mất Internet không tiêu trùng số điểm chung chuỗi | C→D |
| F19 | Kho và công thức — M1/M2 | Nguyên liệu, đơn vị, định lượng phiên bản, kho, stock ledger, kiểm kê, hao hụt | Trừ kho một lần tại mốc nghiệp vụ định sẵn; món đã chế biến bị hủy ghi hao hụt, không tự nhập lại | C |
| F20 | Mua hàng — ĐX | Nhà cung cấp, đề nghị/đơn mua, nhận hàng một phần, trả hàng, giá vốn | Nhận nhiều đợt không vượt quy tắc; chứng từ kho và số lượng mua truy vết được | C |
| F21 | Nhân sự vận hành — M1 có phân quyền; chi tiết ĐX | Lịch ca, chấm công, quyền theo trạm, phê duyệt hành động | Nhân viên bếp không tự settlement/refund; khóa người dùng chặn phiên theo chính sách | B→C |
| F22 | Báo cáo — M1/M2 | Bán hàng ròng, món, ca, thuế/phí cấu hình, payment, kho/giá vốn, KPI robot | Báo cáo khớp ledger và hiển thị thời điểm dữ liệu; CSV đúng timezone/ngày kinh doanh | B→C |
| F23 | Chuỗi — M2 | Menu dùng chung, override chi nhánh, phát hành cấu hình, dashboard hợp nhất | Một chi nhánh offline không làm dừng các chi nhánh khác; nhận cấu hình không ghi đè bill/mission đang chạy | D |
| F24 | Online và kênh ngoài — M1/M3 | Web đặt hàng, Zalo Mini App, giao hàng/POS ngoài qua connector | Không xác nhận nhà hàng đã nhận khi thiết bị vận hành chưa ACK; ID ngoài không tạo order trùng | D |
| F25 | Hóa đơn điện tử và xuất kế toán — ĐX | Provider interface, phát hành, truy vấn kết quả, điều chỉnh theo provider | Chỉ báo phát hành khi có mã/trạng thái của provider; timeout phải query trước retry; sandbox và nghiệm thu thật | D |
| F26 | Buffet, combo, nhiều mô hình — yêu cầu người dùng, ĐX | Gói buffet theo thời gian, combo, món theo cân, eat-in/takeaway | Mỗi kiểu giá có test riêng; preset không âm thầm bật luồng chưa được hỗ trợ | C |
| F27 | Tích hợp tự động hóa — T, ĐX | Node-RED gọi API/webhook được cấp quyền; extension có schema | Tích hợp không bypass RBAC, feature policy hoặc tự publish lệnh vào topic robot | B→D |
| F28 | Vận hành production — yêu cầu người dùng | Backup/restore, migration, audit, observability, cập nhật, runbook | Khôi phục đã được diễn tập; restart không mất giao dịch đã ACK hoặc chạy lệnh robot cũ | A→D |
| F29 | Offline và đồng bộ — yêu cầu người dùng đã xác nhận | Dữ liệu cục bộ trên tablet, outbox/inbox, ownership, đồng bộ lại, trạng thái mạng rõ ràng | Ngắt WAN giữa commit/ACK không tạo hai hóa đơn hoặc hai lệnh robot; dữ liệu chưa đồng bộ không bị ghi đè; không cần máy chủ tại nhà hàng | A→B |
| F30 | Gián đoạn toàn bộ và nhập bù — yêu cầu người dùng đã xác nhận | Maintenance window, mẫu phiếu dự phòng, export, CSV/form import, dry-run, duyệt và đối soát | Giữ ngày phát sinh/ngày nhập; nhập lại không tăng doanh thu lần hai; không tự gửi bếp/thu tiền/điều robot từ chứng từ lịch sử | A→B |

F21 là quản lý nhân sự vận hành; chưa bao gồm hệ thống tính lương/thuế thu nhập. F25 là tích hợp kế toán/hóa đơn, không thay thế sổ cái kế toán tổng hợp. Các phạm vi đó chỉ mở rộng khi có yêu cầu riêng, không được gán nhãn đã có.

## 3. Những cấu hình sản phẩm cần hỗ trợ

Preset là cấu hình khởi tạo có version, quản lý được sửa theo quyền. Không fork mã theo nhà hàng.

| Preset | Nhóm thường bật | Nhóm tùy chọn |
|---|---|---|
| Tương đương trial (`trial-service`) | Trạm/điểm, fleet, giao nhiều bàn, khay, thu dọn, gọi robot, xác nhận trên màn robot, cảnh báo/KPI | Gọi nhân viên/dẫn khách/menu–gọi món/yêu cầu thanh toán theo các cờ của trial đã khảo sát; không bắt buộc bật bộ quản trị nhà hàng mở rộng |
| Quán cà phê/quầy nhanh | POS, menu/modifier, takeaway, bar/KDS, payment, ca | QR, loyalty, kho, robot |
| Nhà hàng phục vụ tại bàn | Bàn/phiên, menu, order, bếp, POS, payment | QR, booking, giao robot, thu dọn, dẫn khách |
| Buffet/lẩu/nướng | Bàn, gói/thời gian, order bổ sung, KDS, POS | Robot nhiều lượt, kho, membership |
| Chỉ dùng robot với POS có sẵn | Điểm/trạm, mission thủ công, fleet, audit | Connector POS để nhận món sẵn sàng; không bắt buộc bật POS nội bộ |
| Nhà hàng chưa có robot | Menu, bàn, KDS, POS, báo cáo | Kho, CRM, booking; mọi thao tác robot ẩn và API nhận việc mới bị tắt |
| Chuỗi | Các module của từng chi nhánh + quản lý tập trung | Triển khai cấu hình theo nhóm, kênh online, loyalty dùng chung |

“Chỉ robot” vẫn cần người dùng, địa điểm, audit và điều phối; không yêu cầu catalog/POS. “Không robot” giao món bằng nhân viên qua cùng fulfillment, không tạo mission giả.

`trial-service` là yêu cầu nghiệm thu riêng: sau khi cài và provision thiết bị/robot được hỗ trợ, nhà hàng chọn preset và chỉnh setting để dùng tập chức năng trial trên **cùng bản phát hành production**, không sửa source, fork theo nhà hàng hoặc build riêng. Kho, mua hàng, CRM/loyalty, đặt bàn, quản lý chuỗi và các connector ngoài không được thành điều kiện bắt buộc của preset này. Nếu bật gọi món/thanh toán, preset chỉ kéo theo các dependency nghiệp vụ cần thiết; UI vận hành giữ phạm vi đã chọn. Identity, audit, đồng bộ và kiểm soát an toàn vẫn hoạt động.

Mốc đối chiếu là baseline trial `5eda9b7c89d8c386891b79d56f5a9196afa23143` trong báo cáo nghiên cứu. Các hành vi production về quyền, chứng cứ hoàn thành robot và xác nhận thanh toán vẫn áp dụng. Import setting không tự migrate mission/bill đang chạy, tạo map binding hợp lệ hoặc chứng minh một model robot mới đã tương thích.

## 4. Quy tắc bật/tắt bắt buộc

- Quyền sử dụng module, cấu hình nhà hàng, quyền người dùng, readiness và capability là các điều kiện riêng.
- Tắt QR ordering không tắt POS ordering; tắt robot ordering không tắt robot delivery; tắt chuyển khoản không tắt tiền mặt.
- Tắt nhận việc mới dùng trạng thái `draining` để hoàn tất/hủy/hoàn tiền công việc đã nhận. Không xóa lịch sử.
- Refund, đối soát và xem chứng từ đã tồn tại vẫn được phép theo quyền dù kênh bán đã tắt.
- Dừng robot, báo lỗi, audit và ràng buộc an toàn không phải feature thương mại để tắt.
- Khi không còn robot phù hợp, task giữ chờ với lý do hoặc nhân viên chọn giao thủ công; không tự nhận robot thiếu khả năng.
- Không mặc định hỗ trợ một chuẩn/chassis khi mới có tên adapter hoặc một mock.
- Offline nhiều thiết bị, mất cả LAN và bảo trì toàn bộ tuân theo [spec continuity](../superpowers/specs/2026-10-30-offline-continuity-design.md). Khi tách mạng, các thao tác cần trạng thái dùng chung có giới hạn và đường ghi nhận/đối soát, không hứa nhất quán tức thời giữa thiết bị không liên lạc được.

## 5. Điều kiện để công bố chức năng có thật

Một dòng chỉ được chuyển thành “đã hoàn thành” khi có domain, lưu trữ, API, giao diện cần thiết, quyền, kiểm thử và tài liệu vận hành phù hợp. Với connector/driver, cần thêm cấu hình đã nghiệm thu, trace giao thức và thử lỗi/reconnect.

Không dùng trạng thái thành công giả để thay cho payment provider, hóa đơn điện tử, máy in hoặc robot. Mô phỏng/sandbox phải được hiển thị và tách dữ liệu khỏi production.
