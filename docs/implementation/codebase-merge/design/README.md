# MEKONIQ — Gộp `lab` vào `source` thành một codebase

**Ngày thiết kế:** 2026-11-20 · **Trạng thái:** đề xuất; người dùng đã chốt ba hướng ở [§0](#0-hướng-đã-chốt-với-người-dùng-2011), chưa duyệt toàn bộ spec. Chưa có thay đổi nào trong `source/`, `lab/`, `web/`, Vercel, Cloud Run hay GitHub. Bộ này chỉ gồm tài liệu.

**Yêu cầu:** code đang chia hai repo (`source` và `lab`) trong khi chỉ có một domain `mekoniq.app`. Lập spec/plan gộp hai codebase làm một, đặt trong `docs/` để không ảnh hưởng các phiên đang implement trong hai repo.

**Một câu:** đưa Lab vào repo `mekoniq` tại `apps/lab` bằng một lần nhập giữ nguyên toàn bộ lịch sử và SHA, giữ nguyên cơ chế pin runtime và ngữ nghĩa evidence; sau đó phục vụ Lab tại `lab.mekoniq.app` và trang marketing tại `mekoniq.app`. Chuẩn bị và diễn tập trong một clone riêng; chỉ chạm vào hai cây làm việc trong một cửa sổ cutover sau khi R4 đã về `main`.

## 0. Hướng đã chốt với người dùng (20/11)

1. **Domain của Lab là `lab.mekoniq.app`, với điều kiện không phát sinh chi phí.** Đã kiểm: không có phí ([spec §5.7](01-spec.md#57-vercel-và-domain-mg-d04)). Hướng dẫn cài đặt ngắn ở [03](03-domain-guide.md), làm sau khi gộp xong.
2. **Cutover sau khi R4 quay về `main`.** Đường làm sớm giữa hai task R4 không dùng.
3. **Trang marketing `web/` cũng về domain này.** Chỉ đổi domain; repo `mekoniq-web` không gộp vào monorepo. Cách xếp hostname là lựa chọn của tôi, xem [§5](#5-lựa-chọn-tôi-tự-quyết-cần-người-dùng-xem) mục 1.

## 1. Đọc theo thứ tự

| Tài liệu | Nội dung |
|---|---|
| [01 — Spec](01-spec.md) | Lý do, hiện trạng đã kiểm, các hướng đã cân nhắc, thiết kế, yêu cầu đo được, rủi ro |
| [02 — Plan](02-plan.md) | Task M0–M10, lệnh, kết quả mong đợi, điểm dừng cần lệnh của người dùng, đường lùi |
| [03 — Hướng dẫn domain](03-domain-guide.md) | Các bước ngắn để bật `lab.mekoniq.app` và đưa marketing về `mekoniq.app` |

Đường dẫn bắt đầu bằng `source/` hoặc `lab/` tính từ workspace `robot/`. Bộ này nằm ở workspace `robot/docs/`, ngoài các repo, cùng lý do với bộ R4: recorder và build từ chối cây có file chưa theo dõi.

## 2. Hiện trạng đã kiểm ngày 20/11

| Mục | Giá trị |
|---|---|
| `source` | GitHub `phamvuhoang/mekoniq`, 417 commit, 4.228 file. `main` = `33847b9`. Đang checkout `r4/virtual-commissioning` = `9805ec6` (hơn origin 10 commit), **cây đang có thay đổi chưa commit** (việc V06 của phiên khác) |
| `lab` | GitHub `phamvuhoang/mekoniq-lab`, 329 commit, 2.195 file (1.654 là docs/evidence). `main` = `65a4593`, pin `3d8c2a8`. Đang checkout `r4/virtual-commissioning` = `c233594`, pin `9805ec6`. **Không có CI** |
| `web` | GitHub `phamvuhoang/mekoniq-web`, site tĩnh, cây sạch trên `main`, không hardcode hostname nào |
| Vercel `mekoniq` | repo `mekoniq`, root `apps/cloud-web`; phục vụ `www.mekoniq.app`; `mekoniq.app` chuyển hướng 308 về `www` |
| Vercel `mekoniq-lab` | repo `mekoniq-lab`, root repo; chỉ có `mekoniq-lab.vercel.app` |
| Vercel `mekoniq-serve` | repo `mekoniq-web`; chỉ có `mekoniq-serve.vercel.app` |
| Team và DNS | `henry-projects`, gói Pro. `mekoniq.app` đăng ký qua Vercel, hạn 31/10/2027, đã có bản ghi wildcard `*` trỏ về Vercel |
| Cloud Run | chỉ cho **một** origin trình duyệt (`LAB_ALLOW_ORIGIN`), file mẫu ghi `https://mekoniq-lab.vercel.app` |
| Phụ thuộc chéo | Lab đọc `../source` ở 5 script và 5 test integration; source đọc `../lab` ở recorder R1–R3, một test unit và một script chuẩn bị R2a |

## 3. Tóm tắt thiết kế

1. **Một repo, Lab ở `apps/lab`**, là thành viên của pnpm workspace sẵn có (`apps/*`), một lockfile.
2. **Nhập bằng `git subtree add`, không rewrite.** Mọi SHA của Lab mà evidence đã ghi vẫn tra được trong repo gộp. Đã thử trong clone tạm cho cả `main` và nhánh R4: cây Lab trùng byte, merge sạch.
3. **Giữ nguyên pin, export/import runtime và cặp (source, Lab) của evidence.** Trong repo gộp, "commit source" là commit cuối cùng đụng tới đường dẫn ngoài `apps/lab`; "commit Lab" là commit cuối cùng đụng tới `apps/lab`. Một helper nhỏ thay cho các lệnh `git rev-parse HEAD` ở khoảng mười chỗ.
4. **Pin trên `main` không đổi qua lần gộp**, nên bản web và runtime Cloud Run vẫn khớp nhau. Việc gộp không cần deploy lại Cloud Run.
5. **Ba project Vercel giữ nguyên**; `mekoniq-lab` trỏ sang repo `mekoniq` với Root Directory `apps/lab`.
6. **Ba hostname trên một domain:** `www.mekoniq.app` là app cloud (không đổi), `lab.mekoniq.app` là Lab, `mekoniq.app` là trang marketing.
7. **Diễn tập trước, cutover sau.** M0–M6 làm trong clone `robot/.worktrees/merge-monorepo`, không đụng hai cây đang dùng. M7 (cutover) chạy sau khi R4 về `main`, khi hai cây sạch và có lệnh của người dùng.

## 4. Ảnh hưởng tới các phiên đang chạy

- **Tới hết M6: không có.** Mọi việc diễn ra trong clone riêng; clone chỉ đọc `.git` của hai repo. Hai lưu ý: không chạy e2e của clone trên cổng 4175/4176 khi phiên khác đang dùng, và không chạy việc nặng CPU khi phiên khác đang ghi evidence (các test thời gian đã từng flake).
- **M7: cần tạm dừng khoảng 1–2 giờ**, sau khi R4 đã về `main`. Sau M7, `robot/lab` là symlink tới `source/apps/lab`, nên đường dẫn `lab/...` trong các plan cũ và trong `CLAUDE.md` vẫn đúng.
- **M8, M9 (domain): không đụng cây nào.** Chỉ đổi cấu hình Vercel và một biến môi trường của Cloud Run.

## 5. Lựa chọn tôi tự quyết, cần người dùng xem

Lý do ở [spec §4–§5](01-spec.md#4-các-hướng-đã-cân-nhắc):

1. **Marketing ở `mekoniq.app`, app cloud giữ `www.mekoniq.app`.** Không dời app sang `app.mekoniq.app`: Supabase Auth, webhook của kênh bán và thanh toán, và cấu hình tablet có thể đang trỏ vào `www`, và tôi không đọc được các cấu hình đó. Hệ quả cần biết: `mekoniq.app/<đường dẫn của app>` hôm nay chuyển hướng sang `www`, sau khi đổi sẽ trả 404 của trang marketing.
2. Lab nằm ở **`apps/lab`**, giữ tên package `mekoniq-robot-lab`.
3. **Chỉ chuyển chỗ, không tái cấu trúc.** Giữ pin, export/import, các file sinh trong `src/shared/`. Không gộp script trùng, không bỏ cơ chế pin.
4. **Giữ lịch sử và SHA**; repo `mekoniq-lab` được archive (chỉ đọc), không xóa.
5. Thư mục local giữ tên `robot/source`; `robot/lab` thành symlink.
6. `trial/` không nằm trong lần gộp; `web/` chỉ đổi domain, giữ repo riêng.
7. Lab tạm đứng ngoài `eslint` của root nếu lần chạy đầu có lỗi (nó chưa từng qua eslint); bật sau ở việc riêng.

## 6. Câu hỏi còn mở

1. Mục 1 ở trên: chấp nhận marketing ở `mekoniq.app` và app ở `www.mekoniq.app`, hay muốn marketing chiếm cả `www` và dời app sang `app.mekoniq.app`? Hướng sau cần kiểm kê trước mọi nơi đang trỏ vào `www` và chưa có trong plan.
