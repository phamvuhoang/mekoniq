# R2a — cập nhật production ngày 2026-11-14

Người dùng cho phép push main của source và Lab để cập nhật production. Hai push đều thành công; Vercel Git integration dựng đúng commit và gán các domain production. Bản ghi này là bằng chứng triển khai và kiểm tự động, chưa phải sự chấp nhận của người duyệt (`accepted:false`).

| Thành phần | Commit / revision | Kết quả |
| --- | --- | --- |
| Source | `d1a2522a89f17d0f9d8d2c444975778844f74425` | READY, `www.mekoniq.app` |
| Lab | `a7449541e118d01f65af0ad1466e0c963a173f3c` | READY, `mekoniq-lab.vercel.app` |
| Runtime Lab ghim | `4f893ac6fb75dff414a3ee42a726defb7935c734` | Lock production khớp health Cloud Run |
| Cloud Run | `mekoniq-lab-runtime-00002-9lx` | 100% traffic, image amd64 giữ nguyên |

Đây là snapshot của lần triển khai được kiểm; commit tài liệu và hướng dẫn chứa bản ghi này đến sau các commit trong bảng. Runtime, schema và portable tool không đổi trong commit tài liệu đó, nên Lab và Cloud Run vẫn giữ pin `4f893ac`.

## Kết quả

- `/health/live` và `/health/ready` trên `www.mekoniq.app`: HTTP 200, lần lượt `live:true` và `ready:true`; trang chủ source và Lab đều HTTP 200. Các ID deployment, commit, alias và trạng thái READY nằm trong `production-deployments.json`.
- Chrome 157.0.8103.78 tự động mở **Lab production thật**, ghép nối tới `https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app` bằng khóa đọc trực tiếp từ Secret Manager, kiểm pin và schema, chọn preset MuJoCo và chạy qua các nút UI. Không thay thế request hoặc dùng runtime giả.
- `MJ-BV01`: `completed`, phục vụ `2`, tick `4810` / `96.2 s` mô phỏng, không có attention; engine `mujoco_3d`, `not_calibrated`, kiểm va chạm ARM03 `pass`. Canvas có mesh xArm 6 gồm 14 link, hai giá đỡ và không báo cốc rơi. Không có lỗi JavaScript của trang.
- Từ lúc bấm tự chạy đến khi kiểm báo cáo: **78 411 ms** ở lựa chọn 16×. Số này gồm mạng và xử lý UI/báo cáo; không phải tốc độ CPU hay phép đo nhịp 1×. Có 229 request step hoàn thành, gồm bước đầu 250 tick và 228 nhóm 20 tick.
- Run do phép kiểm tạo đã được archive thành công sau khi đóng browser context. Khóa và session token không được ghi vào bản ghi, câu lệnh, trace hoặc ảnh; ảnh chỉ chụp sau khi ô khóa đã bị gỡ khỏi DOM.

`browser-smoke.json` giữ kết quả bốn nhóm kiểm và cleanup; `production-mujoco-report.json` giữ báo cáo thực; `production-mujoco-completed.png` là ảnh màn hình cuối. `browser-smoke.cjs` là producer, nhận khóa qua stdin. `cloud-service.json` xác nhận revision và digest image đang phục vụ trong project `mekoniq`, vùng `asia-southeast1`.

## Lần kiểm đầu và số tick

`browser-attempt-01/` giữ nguyên lần kiểm đầu bị báo failed: producer mới đặt nhầm kỳ vọng `4800` tick của phép kiểm HTTP CL01 cho UI, trong khi báo cáo UI trả `4810`; cleanup vẫn thành công. Không có thay đổi mã ứng dụng giữa hai lần.

Đã đối chiếu [log UI R2a có sẵn](../../sim-extension/r2a-candidate-02/suites/lab-e2e-mujoco-coffee.log): UI trước deploy cũng kết thúc ở `4810`. `lab/src/ui/workspace.ts` tạo run với bước đầu `250` tick, rồi tự chạy mỗi nhóm `20`; `scenario-runner.ts` tính trạng thái sau cả nhóm tick được yêu cầu. Phép kiểm HTTP CL01 dùng nhóm `50` và ghi `4800`. Producer lần cuối kiểm đúng baseline UI `4810`, đồng thời kiểm đồng hồ, trạng thái, số phục vụ, attention và kết quả vật lý như trên.

## Phạm vi còn mở

Đây là Chrome tự động qua HTTPS từ Lab tới Cloud Run. Kiểm tay hộp hỏi quyền Chrome/Firefox và thông báo Safari khi Lab HTTPS nối runtime **cục bộ** vẫn `not_run`. Bản ghi này không thay thế kiểm tay, bằng chứng phần cứng, hiệu chuẩn hoặc sidecar chấp nhận. Các qualification IR-SIM/R1/R1.1/R2a và bản bổ sung CL01 trước đó được giữ nguyên.

`checksums.sha256` bao phủ toàn bộ file của bản ghi, trừ chính nó.
