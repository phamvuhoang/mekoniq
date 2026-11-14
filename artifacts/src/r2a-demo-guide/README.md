# R2a · hướng dẫn demo Web & Local

[Mở HTML độc lập](../../mekoniq-r2a-demo-guide.html). Mặc định tiếng Việt, chuyển được 日本語 / English. Nội dung, ảnh, CSS và JavaScript đều nhúng trong một file; không cần server hoặc Internet để đọc. HTML không gọi runtime, triển khai hay chạy lệnh. Các nút URL chỉ mở trang khi người đọc bấm.

Hướng dẫn gồm chọn đường Web/Local, trình tự demo MuJoCo xArm 6, dữ liệu khớp, nhịp chạy, camera/watch mode, báo cáo/replay, bảng backend và xử lý lỗi. Lệnh được sao chép để người vận hành tự chạy. Checklist chỉ giúp chuẩn bị buổi trình bày, không tạo kết quả kiểm thử.

## Trạng thái nội dung

Snapshot ngày 2026-11-14, runtime source `4f893ac6fb75dff414a3ee42a726defb7935c734`, Lab dùng khi ghi evidence `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`.

- Cloud Run project `mekoniq`, `asia-southeast1`, URL chuẩn `https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app`. Image có mock và MuJoCo; CL01 HTTP đã chạy trên Linux x86-64. Lượt kiểm cuối đo 71,3 giây qua HTTP, gồm mạng và xử lý. G-CLOUD1 là `tested` qua guard bổ sung `cloud-run` gắn đúng SHA-256 của bản ghi R2a; JSON gốc giữ `blocked_external`, không phải trạng thái triển khai hiện tại. Origin web được phép là `https://mekoniq-lab.vercel.app`.
- Production Lab chưa được push bản pin mới tại thời điểm snapshot. Hướng dẫn Web ghi rõ điều kiện cập nhật build; không khẳng định UI production đã kiểm.
- Bản ghi phần mềm mới đã đạt kiểm tự động; nghiệm thu con người và kiểm tay Chrome/Firefox/Safari HTTPS → loopback còn chưa chạy.
- Cloud có một worker slot MuJoCo. “Chạy lại cùng đầu vào” trong cùng tab lưu bằng chứng và archive run cũ trước khi tạo run mới. “Ngắt kết nối” không archive.
- Mô hình chưa hiệu chuẩn; máy pha và AMR vẫn là mock. HTML không chứa khóa truy cập hay mã ghép nối.

`facts.json` giữ các định danh và nguồn ảnh; đọc lại các nguồn trước khi cập nhật trạng thái. Nội dung được viết trong `build.py` bằng `tr(vi, ja, en)`; `style.css` và `app.js` giữ trình bày và tương tác. Không sửa HTML đầu ra trực tiếp. Builder riêng này không thay đổi builder dùng chung của các deck cũ.

## Build và kiểm

Từ `source/`:

```sh
python3 -B artifacts/src/r2a-demo-guide/build.py
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
node --check artifacts/src/r2a-demo-guide/app.js
perl -e 'alarm 120; exec @ARGV' node artifacts/src/r2a-demo-guide/verify.cjs
```

Browser check dùng `@playwright/test` hiện có của source và Chrome đã cài trên macOS. Có thể chỉ định `PLAYWRIGHT_CHROMIUM` đến binary Chromium khác. `--static` chỉ kiểm hash, bản dịch, lệnh bằng `bash -n`, anchor, liên kết nguồn và ảnh; không được xem như browser check.

`build-manifest.json` chứa hash đầu vào, đầu ra và ảnh. `verification.json` ghi kiểm trình duyệt. Ảnh xem trước: [desktop](desktop-preview.png), [mobile](mobile-preview.png). Mỗi ảnh được chụp từ một trang Chromium mới, không tái dùng trang đã chạy kiểm print/media; có kiểm DOM chỉ chứa một toolbar ở đầu trang. Cách này loại ảnh raster lặp từng xuất hiện khi chụp sau chuỗi print/resize trên Chrome 157. Kiểm trình duyệt chỉ mở file HTML; không khởi động engine hay dịch vụ ở cổng vận hành.

## Ảnh gốc và căn cứ thao tác

Bốn PNG được sao chép nguyên byte từ `docs/implementation/evidence/sim-extension/r2a-candidate-02/screens/` của source. SHA-256, đường dẫn gốc và kích thước có trong `facts.json`; verifier đối chiếu với ảnh trong bản ghi. Ba ảnh thuộc bài MuJoCo, ảnh watch mode thuộc kịch bản mock. Chúng là ảnh kiểm tự động cục bộ, không phải ảnh production đã deploy. Không chỉnh sửa, dựng lại hoặc thêm lớp hình ảnh lên ảnh bằng chứng.

Hành vi UI được đối chiếu với Lab `src/ui/{run-bar,operations-panel,transport,workspace,report-panel}.ts`, `tests/e2e/mujoco-coffee.spec.ts` và launcher trong `package.json` / `scripts/`. Phạm vi R2a theo `docs/superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md`. Liên kết nguồn trong HTML cần cấu trúc repository; gửi riêng HTML vẫn đọc đủ nội dung và ảnh.
