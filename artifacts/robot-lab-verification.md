# Robot Lab HTML — kiểm chứng 2026-11-04

[HTML độc lập](robot-lab.html) · [Ảnh xem trước desktop](robot-lab-preview.png)

## Nội dung

9 trang, mặc định tiếng Việt, hỗ trợ Việt/Nhật/Anh. Robot SVG và các sơ đồ được nhúng trực tiếp; không font, thư viện, ảnh hoặc dịch vụ bên ngoài. Nội dung dựa trên `lab/docs/implementation/progress.md` và runtime W11 đã pin ngày 2026-11-04.

Có thể thay số khay 2–4, tách lớp robot, chọn bàn, đi từng bước tải/giao có xác nhận, chọn tình huống lỗi và tua timeline báo cáo. Đây là tương tác minh họa trong tài liệu; không kết nối runtime, không phát lệnh robot và không xuất candidate thật. Trang phạm vi phân biệt S01 đã có với backend/scenario/apply còn thiếu. Các số 3 s / 5 s / 1 món được ghi là ví dụ, không là benchmark.

## Kiểm thử

- Syntax JavaScript và build bằng Python standard library: PASS.
- Chrome headless, mở `file://` với network offline: PASS.
- Ba deck × 3 ngôn ngữ × 4 viewport (1440×900, 1024×768, 768×1024, 375×812): **336 lượt PASS**; riêng Lab là **108 lượt**.
- **27 nhóm kiểm tra tương tác PASS**, bao gồm 6 nhóm mới cho Lab: cấu hình/tách lớp, chọn bàn, xác nhận tải/giao, bốn lỗi, replay/phím/ngôn ngữ, giới hạn tính năng/ngày tài liệu.
- **0 lỗi JavaScript, 0 request HTTP(S), 0 tràn ngang**.
- Giữ trạng thái khi đổi ngôn ngữ; phím mũi tên trên slider không chuyển trang; điều hướng Home/End và reduced motion: PASS.
- In/PDF: render đủ 9 trang Lab; có xuất PDF test tiếng Nhật. Các deck cũ được kiểm tra hồi quy cùng lượt.
- Đã xem ảnh desktop của trang mở đầu, báo cáo và mặt bằng; xem mobile tiếng Nhật của hành trình giao món. Các trang desktop tiếng Việt kiểm thêm đều cao 900 px tại viewport 1440×900.

## Tái chạy

Từ `source/`, với Node 24 và dependencies đã cài:

```sh
python3 artifacts/build.py
node --check artifacts/src/core.js
node --check artifacts/src/robot-lab.js
PLAYWRIGHT_MODULE=$(node -p "require.resolve('playwright', {paths:[require.resolve('@playwright/test')]})") \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
ARTIFACT_QA_OUTPUT=/tmp/mekoniq-lab-artifact-qa \
node artifacts/tests/presentations.cjs
```

Kết quả chi tiết local: `/tmp/mekoniq-lab-artifact-qa/report.json`; screenshot và PDF cùng thư mục. Chưa kiểm Safari, thiết bị thật hoặc viewer nhúng.

HTML: **92,008 bytes**, SHA-256 `20dd6edb081bee3752c081e99fb8903eebb8df1b3deb1108f16c702deb7daf24`. Sửa `src/robot-lab.js` / `src/robot-lab.css`, rồi build lại; không chỉnh trực tiếp HTML sinh ra.
