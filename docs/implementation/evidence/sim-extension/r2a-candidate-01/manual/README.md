# Kiểm tay R2a (Task Q02 bước 2) — `not_run`

| Kiểm tay | Trạng thái |
|---|---|
| Lab đã deploy (hoặc bản build phục vụ qua HTTPS) nối runtime cục bộ `http://127.0.0.1:4176` trên Chrome, có ảnh hộp hỏi quyền và ảnh run `completed` | `not_run` |
| Như trên, trên Firefox | `not_run` |
| Ảnh thông báo trên Safari | `not_run` |

**Lý do:** chưa có gì của R2a được push hay deploy. Push `main` của `lab/` là deploy production (`mekoniq-lab.vercel.app`), việc đó cần lệnh của người dùng; chưa có lệnh nên không có Lab HTTPS nào chạy mã R2a để kiểm. Không có ảnh nào trong thư mục này.

Các kiểm tay này không thuộc gate nào (spec `2026-11-12-realistic-arm-web-ui-design.md` §6.4). Phần tự động gần nhất là RT04 (`lab-e2e-remote-origin`: Lab phục vụ từ một origin khác điều khiển BV01 mock trên runtime cục bộ, Playwright Chromium, không qua HTTPS và không có hộp hỏi quyền thật của trình duyệt). Khi đã deploy: làm lại ba dòng trên và ghi vào một bản ghi kế tiếp, không sửa bản ghi này.
