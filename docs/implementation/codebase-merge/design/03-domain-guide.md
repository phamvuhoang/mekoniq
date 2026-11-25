# Hướng dẫn ngắn — cài subdomain và domain sau khi gộp xong

[Tổng quan](README.md) · [Spec §5.7–§5.8, §5.12](01-spec.md#57-vercel-và-domain-mg-d04) · [Plan M8, M9](02-plan.md)

Làm sau khi M7 (cutover) xong. Mọi bước ở đây là thay đổi production, làm khi người dùng ra lệnh. Team Vercel: `henry-projects`.

## Chi phí

Không phát sinh. Vercel không tính phí theo subdomain hay theo domain gắn vào project; chứng chỉ TLS tự cấp và miễn phí. `mekoniq.app` đã trả tới 31/10/2027 và đã có bản ghi DNS wildcard `*`, nên không cần thêm bản ghi nào. Cập nhật biến môi trường của Cloud Run chỉ tạo một revision mới, không có phí riêng.

Nếu màn hình thêm domain của Vercel hiện bất kỳ khoản phí nào thì dừng lại: bước đúng không mua gì cả (lệnh mua là `vercel domains buy`, không dùng ở đây).

## A. Lab về `lab.mekoniq.app`

Runtime cloud chỉ cho **một** origin, nên làm đúng thứ tự.

1. **Thêm domain vào project Lab.**
   `vercel domains add lab.mekoniq.app mekoniq-lab --scope henry-projects`
   (hoặc Dashboard → `mekoniq-lab` → Settings → Domains → Add).
   Kiểm: `curl -sI https://lab.mekoniq.app | head -1` trả `200`. Chứng chỉ có thể cần một hai phút.
2. **Đổi origin của runtime cloud.**
   `gcloud run services update mekoniq-lab-runtime --project=mekoniq --region=asia-southeast1 --update-env-vars=LAB_ALLOW_ORIGIN=https://lab.mekoniq.app`
   Lệnh tạo revision mới; run đang chạy trên cloud sẽ mất. Từ lúc này chỉ địa chỉ mới ghép được với cloud.
3. **Kiểm.**
   `curl -s https://lab.mekoniq.app/source-runtime.lock.json` và `curl -s https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health` phải cùng `sourceCommit`. Mở `https://lab.mekoniq.app`, ghép bằng khóa truy cập, chạy một bước.
4. **Chuyển hướng địa chỉ cũ.** Dashboard → `mekoniq-lab` → Settings → Domains → `mekoniq-lab.vercel.app` → Redirect to `lab.mekoniq.app`.
5. **Sửa hai file ví dụ trong repo** (`deploy/lab-runtime/mekoniq.env.example`, `deploy/lab-runtime/README.md`) theo Task M8 của plan.

Dự án Lab lưu trong trình duyệt ở địa chỉ cũ không tự sang địa chỉ mới; xuất ra rồi nhập lại nếu cần giữ.

**Lùi:** chạy lại lệnh ở bước 2 với `https://mekoniq-lab.vercel.app`, bỏ chuyển hướng ở bước 4.

## B. Trang marketing về `mekoniq.app`

App cloud giữ nguyên `www.mekoniq.app`. Chỉ đổi chủ của tên gốc `mekoniq.app`.

1. **Gỡ `mekoniq.app` khỏi project `mekoniq`** (hiện là bản ghi chuyển hướng 308 sang `www`).
   Dashboard → `mekoniq` → Settings → Domains → `mekoniq.app` → Remove. Giữ nguyên `www.mekoniq.app`.
   **Không dùng `vercel domains rm mekoniq.app`**: lệnh đó gỡ domain khỏi cả tài khoản, không phải khỏi project.
2. **Gắn vào project marketing.**
   `vercel domains add mekoniq.app mekoniq-serve --scope henry-projects`
   Giữa bước 1 và 2, `mekoniq.app` trả lỗi trong vài giây.
3. **Kiểm.**
   `curl -sI https://mekoniq.app | head -1` trả `200` và nội dung là trang marketing; `curl -s https://www.mekoniq.app/health/ready` vẫn trả `{"ready":true}`; đăng nhập app ở `www` như cũ.

Sau bước này, `mekoniq.app/<đường dẫn của app>` (ví dụ `/login`) trả 404 thay vì chuyển sang `www`. Nếu có link kiểu đó đang lưu hành, thêm redirect cho các đường dẫn đó vào `web/vercel.json`.

**Lùi:** gỡ `mekoniq.app` khỏi `mekoniq-serve`, thêm lại vào `mekoniq` với Redirect to `www.mekoniq.app`.

## Thêm subdomain khác về sau

Một lệnh, không cần DNS: `vercel domains add <tên>.mekoniq.app <project> --scope henry-projects`.
