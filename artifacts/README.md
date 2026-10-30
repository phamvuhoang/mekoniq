# MEKONIQ — interactive presentations

Hai bản HTML tự chứa, chuyển trực tiếp **Tiếng Việt / 日本語 / English**. Mở bằng trình duyệt hoặc gửi riêng từng file; không cần cài ứng dụng, chạy server hay tải thư viện/font từ Internet.

| Tài liệu | HTML độc lập | Bản xem riêng tư trên Pages |
| --- | --- | --- |
| Engineering Atlas · 8 chương | [engineering.html](engineering.html) | [Mở bản kỹ thuật](https://chatgpt.com/space/page_0c0b52bccf7481918e5a45ac0ad84ea6) |
| Business Plan · 11 slide | [business-plan.html](business-plan.html) | [Mở Business Plan](https://chatgpt.com/space/page_86729025d6548191a54021ac49b24dd6) |

## Nội dung và cách dùng

**Engineering:** bản đồ kiến trúc có thể chọn từng thành phần; luồng order và mất ACK; bốn chế độ kết nối; dữ liệu/quyền sở hữu; robot adapters; 30 nhóm chức năng và preset; Supabase Free; lộ trình 12 wave / 63 task.

**Business Plan:** vấn đề vận hành; hành trình sản phẩm; nhóm khách hàng; tính liên tục khi offline; biểu đồ BOM; mô hình doanh thu minh hoạ có thanh điều chỉnh; lợi thế cần kiểm chứng; lộ trình robot giao món → pha chế → nấu ăn và đề xuất demo/pilot.

- Business Plan mặc định **日本語**, thứ tự chuyển **日本語 / EN / VI**; engineering giữ **VI / 日本語 / EN**. Lựa chọn được nhớ riêng cho từng bản. Đổi ngôn ngữ giữ trạng thái tương tác và đổi định dạng số.
- Nút điều hướng hoặc **← / →** đổi trang; **Home / End** đến trang đầu/cuối. Phím của input/slider giữ chức năng nhập liệu.
- Chạm các nút trong sơ đồ, chế độ mạng, preset hoặc wave để xem chi tiết.
- Nút **pause/play** điều khiển animation; hỗ trợ `prefers-reduced-motion` của thiết bị.
- Trên desktop có **toàn màn hình** và **in / lưu PDF**. Bản in gồm toàn bộ deck bằng ngôn ngữ đang chọn. Nếu viewer nhúng hạn chế quyền in/toàn màn hình, mở HTML độc lập.
- Có thể mở sẵn bằng `?lang=ja`, `?lang=en` hoặc `?lang=vi`; bookmark `#data-flow` hay `#business-model` giữ vị trí trang.

HTML hoạt động offline, bao gồm mọi sơ đồ SVG, animation và tương tác. Các liên kết đến tài liệu nguồn bên ngoài cần Internet. Bản xem Pages cần quyền truy cập tài khoản; gửi file HTML khi cần chia sẻ độc lập.

## Phạm vi thông tin

Nội dung phản ánh **thiết kế đã duyệt ngày 2026-10-30**, không phải hệ thống production đã triển khai. Business Plan ghi nhận trạng thái được người dùng cập nhật: **code đang chạy nội bộ, chưa demo bên ngoài**. Robot pha chế và nấu ăn là hướng R&D tương lai, ngoài phạm vi 12 wave hiện tại. Các tương tác là minh hoạ, không gửi lệnh tới robot hoặc dịch vụ thanh toán.

BOM 28,12 triệu đồng lấy từ brief phần cứng của người dùng, chưa phải báo giá xác nhận. Các đầu vào doanh thu là giả định minh hoạ; deck không công bố khách hàng, doanh thu thực tế, định giá hoặc quy mô thị trường chưa có bằng chứng. Phí thuê minh hoạ có thể chỉnh từ 0,3 đến 15 triệu VND/nhà hàng/tháng. Các giới hạn cloud phải được kiểm tra lại khi triển khai.

Nguồn thiết kế trong repository:

- [Kiến trúc production](../docs/superpowers/specs/2026-10-30-production-platform-design.md)
- [Offline và nhập bù bảo trì](../docs/superpowers/specs/2026-10-30-offline-continuity-design.md)
- [Next.js/Vercel và Supabase Free](../docs/superpowers/specs/2026-10-30-vercel-supabase-free-stack.md)
- [30 nhóm chức năng](../docs/product/2026-10-30-capability-matrix.md)
- [Kế hoạch 12 wave](../docs/superpowers/plans/2026-10-30-production-implementation-plan.md)

## Chỉnh sửa và build

Sửa nội dung/ngôn ngữ trong `src/engineering.js` hoặc `src/business-plan.js`; styles và điều hướng dùng chung ở `src/core.css`, `src/core.js`. Mỗi chuỗi `tr(vi, ja, en)` có đủ ba bản dịch. Không sửa trực tiếp HTML đã sinh.

Từ thư mục `source`:

```sh
python3 artifacts/build.py
node --check artifacts/src/core.js
node --check artifacts/src/engineering.js
node --check artifacts/src/business-plan.js
```

Build chỉ dùng Python standard library, sinh hai file dưới 256 KiB/file. Bản xem Pages là bản chụp đã tải lên; chỉnh file local không tự cập nhật Pages. Khi xuất bản lại, thay embed trong Page hiện có và kiểm tra biên nhận/lần đọc lại.

## Kiểm thử

Acceptance script chạy với Playwright và Chromium/Chrome. Ví dụ dùng Chrome đã có trên macOS, cài Playwright vào thư mục tạm:

```sh
npm install --prefix /tmp/mekoniq-artifact-qa playwright --no-audit --no-fund
PLAYWRIGHT_MODULE=/tmp/mekoniq-artifact-qa/node_modules/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node artifacts/tests/presentations.cjs
```

Có thể trỏ `CHROME_PATH` tới Chrome/Chromium trên hệ điều hành khác hoặc bỏ biến này để dùng browser do Playwright quản lý. `ARTIFACT_QA_OUTPUT` đổi thư mục kết quả; mặc định là `/tmp/mekoniq-artifact-qa-results`.

Lần kiểm tra ngày 2026-10-30: **228 tổ hợp trang/ngôn ngữ/viewport**, 21 nhóm tương tác, không lỗi JavaScript, không tràn ngang và không request mạng ngoài. Script kiểm tra Nhật mặc định/thứ tự ngôn ngữ, giới hạn phí thuê 15M, lộ trình ba thế hệ robot, nội dung trạng thái, input/định dạng số, giữ trạng thái khi đổi ngôn ngữ, điều hướng hash/phím, reduced motion, tạm dừng animation, và render bản in toàn deck. Đã xem trực tiếp các ảnh desktop/mobile đại diện. Xem [verification.json](verification.json) để biết môi trường, checksum và kết quả.

Business Plan đã được cập nhật và đọc lại trên Page cũ; Engineering vẫn dùng bản đã xuất bản trước đó. Kiểm thử giao diện được thực hiện với HTML độc lập trên Chrome; chưa kiểm thử trực quan viewer Pages đã đăng nhập, Safari hoặc thiết bị tablet thật. Đây là kiểm thử **tài liệu HTML**, không phải nghiệm thu phần mềm production hay robot.
