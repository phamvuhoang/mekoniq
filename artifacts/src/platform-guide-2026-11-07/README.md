# Hướng dẫn Source & Physical Robot Lab · 07/11/2026

Tài liệu tiếng Việt độc lập, giữ nguyên phong cách guide 06/11. Không sửa guide cũ hoặc deck VI/JA/EN. Nội dung ứng dụng có VI/JA/EN vẫn được bảo toàn; guide mới dùng tiếng Việt như tài liệu tham chiếu.

Đích source: `source/artifacts/src/platform-guide-2026-11-07/`.
Đích HTML: `source/artifacts/mekoniq-platform-lab-guide-2026-11-07.html`.

## Build và kiểm tra

Từ repository Source:

```sh
python3 artifacts/src/platform-guide-2026-11-07/build.py
node artifacts/src/platform-guide-2026-11-07/verify.cjs --static
node artifacts/src/platform-guide-2026-11-07/verify.cjs
```

Khi đang staging ở thư mục độc lập, build mặc định ghi HTML trong chính thư mục staging. Có thể dùng `--out /absolute/output.html`; verify nhận `--artifact=/absolute/output.html`. `PLAYWRIGHT_CHROMIUM` chọn executable đã cài. Verify dùng `@playwright/test` từ Source; không cài dependency hoặc tải browser. Browser verification tạo `desktop-preview.png`, `mobile-preview.png`, `verification.json`; static verification tạo `verification-static.json`. Các bước kiểm browser chỉ chạy khi operator gọi verify, không chạy trong build.

`build.py` chỉ đọc dữ liệu cục bộ, nhúng bytes ảnh/CSS/JS và dùng `bash -n` kiểm cú pháp lệnh. Nó không chạy dịch vụ, migrate, Git, test sản phẩm hoặc deploy. Không có archive fallback. Thiếu facts/ảnh, digest sai, commit lệch hoặc gate native bị gán pass sẽ fail build.

## Các file duy trì

- `build.py`: bộ tạo HTML và nội dung tiếng Việt; chia hàm nội dung theo chủ đề.
- `style.css`, `app.js`: phong cách, responsive, print, filter/search, lightbox và copy/fallback.
- `feature-inventory.json`: F01–F30, L01–L24 và P01–P10; đây là inventory, không là release receipt.
- `release.json`: facts do người điều phối cung cấp sau verification/deploy; không có default pass.
- `capture-manifest.json`, `screenshots/`: ảnh mới và metadata bên dưới.
- `build-manifest.json`: SHA-256 của artifact/inputs/ảnh, commits/runtime identity và nội dung shell blocks đã kiểm cú pháp.
- `verify.cjs`: static hash/structure/scope/anchor/resource/secret/shell checks; browser checks responsive, search/filter, empty/reset, pixels/modal/Escape/focus, copy/denied-clipboard fallback, print, no-JS và zero external requests/errors.

## `release.json` — giao diện bắt buộc, schemaVersion 1

Tất cả trường dưới bắt buộc. Không đưa giá trị secret, cookie, pairing token, database URL/password vào bất kỳ string nào. Trạng thái từ tập `pass`, `fail`, `not_run`, `skipped`, `blocked`; các giá trị khác bị từ chối.

```text
{
  schemaVersion: 1,
  generatedAt: ISO-8601 timestamp có timezone, ngày >= 2026-11-07,
  source: {commit: 40 lowercase hex, branch: "main"},
  lab: {commit: 40 lowercase hex, branch: "main"},
  runtime: {
    sourceCommit: 40 lowercase hex,
    artifactSha256: 64 lowercase hex,
    schemaHash: 64 lowercase hex
  },
  checks: [{name, status, command, summary, evidence}],
  deployments: [{repo, url, id, commit, verifiedAt, status, smoke}],
  gates: [{id, status, reason, evidence}]
}
```

`checks` không được trống. `name`, `command`, `summary`, `evidence` là string không trống. `summary` ghi counts/skips/blocker chính xác theo log thực; `evidence` ghi đường dẫn receipt/log/manifest, không được tự gán pass từ tên suite. Native prerequisite exit 2 có thể ghi `not_run` và lý do; assertion fail phải ghi `fail`.

`runtime.sourceCommit` phải trùng Source release commit: release pair là code đã test/deploy/export, trước commit thêm tài liệu guide. Source và Lab commit cuối chỉ chứa guide/evidence nếu phát sinh được ghi bổ sung ngoài release code identity; không đổi pin để chạy theo commit tài liệu.

`deployments` phải có cả `source` và `lab`. `url` chính xác `https://www.mekoniq.app` hoặc `https://mekoniq-lab.vercel.app`; `id` là deployment ID thực; `commit` trùng release code commit tương ứng. `verifiedAt` có timezone, ngày >= 07/11. `smoke` không trống, ghi phạm vi thực đã kiểm (công khai/authenticated/local). Không suy login screen hoạt động thành nghiệp vụ/auth pass.

`gates` phải có đúng đủ ID `G0`, `G1`, `G2`, `G3`, `hardware`. Mỗi `reason`/`evidence` là string không trống. Trong release này G1/G2/G3/hardware chỉ nhận `not_run` hoặc `blocked`; deployment/pure/browser pass không đóng các cổng này. G0 chỉ nhận pass khi biên bản có kiểm hợp đồng/assembly/compile phù hợp.

## `capture-manifest.json` — giao diện bắt buộc, schemaVersion 1

```text
{
  schemaVersion: 1,
  capturedAt: ISO-8601 timestamp có timezone,
  images: [{
    id, title, file, repo, environment, url, capturedAt,
    revision, runtimePin, scope, sha256, width, height
  }]
}
```

- `id`: duy nhất, chỉ `[a-z0-9-]+`; gallery lặp toàn manifest, không hardcode số ảnh hoặc ID.
- `title`, `url`, `scope`: string không trống. `url` có thể là URL localhost đầy đủ với hash route. Không đưa URL chứa token/credential/query bí mật.
- `file`: đường dẫn tương đối từ thư mục source guide, **bao gồm** `screenshots/`, ví dụ `screenshots/lab-assembly.png`. Chỉ PNG/JPEG/WebP; mọi ảnh phải nằm dưới `screenshots/` sau resolve.
- `repo`: `source` hoặc `lab`; cần ít nhất một ảnh mỗi repository.
- `environment`: `production-public`, `local-fixture` hoặc `local-compiler-preview`. Scope ghi rõ dữ liệu tổng hợp/mock/compiler preview và không có engine native khi áp dụng. `production-public` chỉ dành trang công khai production thực.
- `capturedAt` cả cấp manifest và từng ảnh: có timezone, ngày >= 07/11/2026; không sao metadata lịch sử sang ảnh mới.
- `revision`: full 40-hex commit release code của repository tương ứng; root xác minh screenshot server/build thực đang dùng commit này. Không chỉ ghi HEAD nếu server cũ còn chạy.
- `runtimePin`: full 40-hex Source runtime commit hoặc JSON `null` nếu ảnh không dùng runtime. Có giá trị phải khớp release.runtime.sourceCommit.
- `sha256`: raw file SHA-256 64-hex, được build/verify tính lại.
- `width`, `height`: số nguyên pixel dương của ảnh thực.

Ảnh tối thiểu hữu ích (ID tùy chọn): Source production login, settings, catalog, POS, checkout; Lab production home, Assembly, estimates, compiler preview, Twin, results. Để ảnh cùng page mà khác environment phải ghi scope riêng. Không dùng lại ảnh guide cũ, screenshot historical evidence hoặc screenshot native giả bằng fixture. Số ảnh được tính từ manifest ở mọi nơi.

## Phạm vi và giới hạn

Build không tự đọc trạng thái Git/deployment để tránh đổi snapshot khi làm tài liệu. Facts do người điều phối khóa và xác minh. Source refs là link tương đối cần checkout; nội dung/ảnh đầy đủ offline kể cả khi gửi riêng HTML. Các đường dẫn code được kiểm tồn tại lúc author; trạng thái A01–D04 phân biệt implementation với qualification. G1/G2/G3/hardware, shared Designer/Twin project, trình sửa entity binding, inspector/exploded engineering, stability UI và exact ratings/measured data vẫn mở theo phạm vi được giao.

Nếu release pair thực có Source code identity khác runtime pin do commit tài liệu/evidence, phải ghi rõ hai danh tính và sửa validator/receipt có chủ đích; không giả claim rằng artifact được export từ commit chưa export.
