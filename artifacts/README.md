# MEKONIQ — interactive presentations

Các bản HTML tự chứa, chuyển trực tiếp **Tiếng Việt / 日本語 / English**. Mở bằng trình duyệt hoặc gửi riêng từng file; không cần cài ứng dụng, chạy server hay tải thư viện/font từ Internet.

| Tài liệu | HTML độc lập | Bản xem riêng tư trên Pages |
| --- | --- | --- |
| Engineering Atlas · 8 chương | [engineering.html](engineering.html) | [Mở bản kỹ thuật](https://chatgpt.com/space/page_0c0b52bccf7481918e5a45ac0ad84ea6) |
| Business Plan · 11 slide | [business-plan.html](business-plan.html) | [Mở Business Plan](https://chatgpt.com/space/page_86729025d6548191a54021ac49b24dd6) |
| Robot Lab · 9 trang | [robot-lab.html](robot-lab.html) | File HTML local, chưa xuất bản |
| Digital Twin · trạng thái & triển khai · 06/11/2026 | [digital-twin-status-2026-11-06.html](digital-twin-status-2026-11-06.html) | Báo cáo tiếng Việt, offline; chưa xuất bản |
| R2a · demo Web & Local · 14/11/2026 | [mekoniq-r2a-demo-guide.html](mekoniq-r2a-demo-guide.html) | VI/JA/EN, offline; chưa xuất bản |

## Hướng dẫn demo R2a

[HTML R2a](mekoniq-r2a-demo-guide.html) trình bày chức năng và các bước demo xArm 6 trên MuJoCo: ghép nối Web/Local, điều khiển 1× và tăng tốc, xem khớp, camera/watch mode, báo cáo và replay. Có lệnh/URL sao chép, ma trận backend và xử lý lỗi. Bốn ảnh gốc từ bản ghi kiểm UI cục bộ R2a; không phải ảnh production. Snapshot ghi rõ Cloud Run HTTP đã đạt, production Lab còn chờ bản pin mới và chưa nghiệm thu bởi con người.

Nguồn và builder riêng: [src/r2a-demo-guide/README.md](src/r2a-demo-guide/README.md). Build bằng `python3 -B artifacts/src/r2a-demo-guide/build.py`; kiểm bằng `node artifacts/src/r2a-demo-guide/verify.cjs` từ source. HTML không chạy engine hay đọc khóa truy cập. Xem [kết quả kiểm](src/r2a-demo-guide/verification.json), [desktop](src/r2a-demo-guide/desktop-preview.png) và [mobile](src/r2a-demo-guide/mobile-preview.png).

## Báo cáo Digital Twin ngày 06/11/2026

[Báo cáo HTML](digital-twin-status-2026-11-06.html) tổng hợp Plans 01–03 sau remediation R01–R12: 16 nhóm hoàn thành phần mềm, 10 nhóm còn tích hợp/nghiệm thu, 8 nhóm chưa thực hiện. Có tìm kiếm/lọc trạng thái, nguồn evidence, ba hướng dẫn deploy (mock / Gazebo-Nav2 / LinuxCNC SIM), sao chép lệnh, rollback, next steps và in/PDF toàn bộ nội dung. Không kết nối runtime hay chạy lệnh từ HTML. Đây là snapshot source `a89a077`, Lab `3a92e65`; không tự theo HEAD và không đóng acceptance gate.

Nội dung/builder riêng ở `src/digital-twin-status.py`, styles và tương tác ở `src/digital-twin-status.css` / `.js`. Không sửa trực tiếp HTML đã sinh. Build từ `source/` (cần sibling `lab/` chứa evidence snapshot):

```sh
python3 artifacts/src/digital-twin-status.py
node --check artifacts/src/digital-twin-status.js
```

Mở file trực tiếp trong trình duyệt, không cần server hoặc Internet. Nút in xuất cả ba hướng dẫn deploy và toàn bộ nhóm chức năng, kể cả khi bộ lọc đang bật. Liên kết source/evidence tương đối cần giữ cấu trúc workspace; gửi HTML riêng vẫn đọc được toàn bộ nội dung báo cáo.

Đã kiểm bằng Chrome/Playwright offline ở 320, 375, 768, 1024 và 1440 px: không tràn ngang, không lỗi JavaScript/request mạng; bộ lọc, tìm kiếm không dấu, tab/bàn phím, clipboard, local source links, no-JS và toàn bộ nội dung in đều pass. 14 khối lệnh qua `bash -n` (không chạy deploy). Xem [verification](digital-twin-status-verification.json) và [ảnh xem trước](digital-twin-status-preview.png).

## Nội dung và cách dùng

**Engineering:** bản đồ kiến trúc có thể chọn từng thành phần; luồng order và mất ACK; bốn chế độ kết nối; dữ liệu/quyền sở hữu; robot adapters; 30 nhóm chức năng và preset; Supabase Free; lộ trình 12 wave / 63 task.

**Business Plan:** vấn đề vận hành; hành trình sản phẩm; nhóm khách hàng; tính liên tục khi offline; biểu đồ BOM; mô hình doanh thu minh hoạ có thanh điều chỉnh; lợi thế cần kiểm chứng; lộ trình robot giao món → pha chế → nấu ăn và đề xuất demo/pilot.

**Robot Lab:** giới thiệu bằng hình robot SVG, cấu hình 2–4 khay/tách lớp, linh kiện và sơ đồ chức năng, mặt bằng chọn bàn, hành trình S01 có xác nhận tải/giao, bốn nhóm thử lỗi, timeline/replay, gói candidate draft và phạm vi hiện tại. Mặc định tiếng Việt. Các tương tác là minh họa độc lập, không chạy runtime Lab hay phát lệnh robot. Nội dung theo [tiến độ Lab ngày 2026-11-04](../../lab/docs/implementation/progress.md); source W00–W11 đã có code, Lab vẫn chỉ mở S01 business simulation. Xem [kiểm chứng deck Lab](robot-lab-verification.md).

- Business Plan mặc định **日本語**, thứ tự chuyển **日本語 / EN / VI**; engineering giữ **VI / 日本語 / EN**. Lựa chọn được nhớ riêng cho từng bản. Đổi ngôn ngữ giữ trạng thái tương tác và đổi định dạng số.
- Nút điều hướng hoặc **← / →** đổi trang; **Home / End** đến trang đầu/cuối. Phím của input/slider giữ chức năng nhập liệu.
- Chạm các nút trong sơ đồ, chế độ mạng, preset hoặc wave để xem chi tiết.
- Nút **pause/play** điều khiển animation; hỗ trợ `prefers-reduced-motion` của thiết bị.
- Trên desktop có **toàn màn hình** và **in / lưu PDF**. Bản in gồm toàn bộ deck bằng ngôn ngữ đang chọn. Nếu viewer nhúng hạn chế quyền in/toàn màn hình, mở HTML độc lập.
- Có thể mở sẵn bằng `?lang=ja`, `?lang=en` hoặc `?lang=vi`; bookmark `#data-flow` hay `#business-model` giữ vị trí trang.

HTML hoạt động offline, bao gồm mọi sơ đồ SVG, animation và tương tác. Các liên kết đến tài liệu nguồn bên ngoài cần Internet. Bản xem Pages cần quyền truy cập tài khoản; gửi file HTML khi cần chia sẻ độc lập.

## Phạm vi thông tin

Engineering và Business Plan phản ánh **thiết kế đã duyệt ngày 2026-10-30**, không phải hệ thống production đã triển khai. Business Plan ghi nhận trạng thái được người dùng cập nhật: **code đang chạy nội bộ, chưa demo bên ngoài**. Robot pha chế và nấu ăn là hướng R&D tương lai, ngoài phạm vi 12 wave hiện tại. Các tương tác là minh hoạ, không gửi lệnh tới robot hoặc dịch vụ thanh toán. Robot Lab có mốc nội dung riêng ngày 2026-11-04 như mô tả ở trên.

BOM 28,12 triệu đồng lấy từ brief phần cứng của người dùng, chưa phải báo giá xác nhận. Các đầu vào doanh thu là giả định minh hoạ; deck không công bố khách hàng, doanh thu thực tế, định giá hoặc quy mô thị trường chưa có bằng chứng. Phí thuê minh hoạ có thể chỉnh từ 0,3 đến 15 triệu VND/nhà hàng/tháng. Các giới hạn cloud phải được kiểm tra lại khi triển khai.

Nguồn thiết kế trong repository:

- [Kiến trúc production](../docs/superpowers/specs/2026-10-30-production-platform-design.md)
- [Offline và nhập bù bảo trì](../docs/superpowers/specs/2026-10-30-offline-continuity-design.md)
- [Next.js/Vercel và Supabase Free](../docs/superpowers/specs/2026-10-30-vercel-supabase-free-stack.md)
- [30 nhóm chức năng](../docs/product/2026-10-30-capability-matrix.md)
- [Kế hoạch 12 wave](../docs/superpowers/plans/2026-10-30-production-implementation-plan.md)

## Chỉnh sửa và build

Sửa nội dung/ngôn ngữ trong `src/engineering.js`, `src/business-plan.js` hoặc `src/robot-lab.js`; styles và điều hướng dùng chung ở `src/core.css`, `src/core.js`. Robot Lab có styles riêng tại `src/robot-lab.css`. Mỗi chuỗi `tr(vi, ja, en)` có đủ ba bản dịch. Không sửa trực tiếp HTML đã sinh.

Từ thư mục `source`:

```sh
python3 artifacts/build.py
node --check artifacts/src/core.js
node --check artifacts/src/engineering.js
node --check artifacts/src/business-plan.js
node --check artifacts/src/robot-lab.js
```

Build chỉ dùng Python standard library, sinh ba file dưới 256 KiB/file. Bản xem Pages là bản chụp đã tải lên; chỉnh file local không tự cập nhật Pages. Khi xuất bản lại, thay embed trong Page hiện có và kiểm tra biên nhận/lần đọc lại.

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
