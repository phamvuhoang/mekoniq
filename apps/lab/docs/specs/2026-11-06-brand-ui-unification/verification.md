# Verification và release gates

Các hàng dưới mô tả điều kiện kiểm chứng; kết quả thực thi ở [evidence index](../../implementation/evidence/brand-ui-v1/index.json). Kiểm tra HEX trong spec không phải browser test pass. Không sửa trạng thái acceptance cũ của Digital Twin khi đổi giao diện.

## 1. Gate matrix

| Gate | UI requirements | Bằng chứng bắt buộc |
|---|---|---|
| G-UI-ASSET | 01, 03, 10 | Hash logo gốc; SVG không script/external resource; PNG aspect ratio; fonts + OFL; release manifest/check drift trên từng repo |
| G-UI-TOKEN | 01, 02, 04 | Các cặp text/control contrast; CSS aliases đúng; không raw hex mới ngoài token, logo, chart/material allowlist có reason |
| G-UI-LAB | 05, 08 | Sáu route, VI/JA/EN; report/inspector, stale/unknown/failed/blocked; load/handoff giữ nguyên |
| G-UI-SOURCE | 06, 08, 11 | Cloud public/admin/guest + tất cả Tablet routes; login/RBAC, publish pending, checkout và offline/recovery không đổi |
| G-UI-TRIAL | 07, 08, 11 | Sáu HTML, VI/EN; robot/station command semantics, QR guest, map edit, offline; isolated Node-RED tests |
| G-UI-A11Y | 04, 09 | Keyboard, focus, labels, errors, contrast trên DOM thực, 200% zoom, reduced-motion; axe serious/critical = 0 trên các fixture đã scan |
| G-UI-PACKAGE | 09, 10 | Cold build/font local, R-MOCK offline, Tablet offline, Trial LAN; print bill; exported demo compatibility |
| G-UI-RELEASE | 10, 12 | Ba commit + cùng brandVersion, screenshot index, test logs; preview smoke, rollback rehearsal và kết quả phát hành thực nếu có |

## 2. Screenshot matrix

Chụp baseline trước thay đổi và ảnh mới trên cùng browser/OS, viewport, locale, fixtures và clock cố định. Mỗi ảnh ghi repo, commit, route, state, viewport, locale, brandVersion và fidelity. Không mask logo/text/status để làm screenshot pass. Có thể mask timestamp động/canvas render nondeterministic với lý do, nhưng phải kiểm status và legend bằng DOM riêng.

| Surface | Coverage | Viewports |
|---|---|---|
| Lab | Tất cả 6 hash routes, project mẫu có dữ liệu; twin stale/unknown/ARM03; report mixed statuses | 1440×900, 1024×768; tất cả route thêm smoke 390×844 |
| Cloud public | Home, login default/loading/error/429; auth redirect | 1440×900, 390×844 |
| Cloud backoffice | Tất cả route trong inventory với actor có quyền; catalog input/focus/error; settings pending; actor không quyền | 1440×900, 390×844 |
| Cloud guest | Menu/cart/table/order, empty menu, hết hàng, pending/rejected request | 390×844, 768×1024 |
| Tablet | Mọi route trong router + settings/enrollment; chọn fixture hợp lệ theo quyền | 1280×800; POS/kitchen/robot-screen thêm 800×1280; smoke 390×844 |
| Trial | index/setup/station/robot/table/map, menu/dialog, disconnected/retry | 1280×800, 800×1280; table + index 390×844 |
| Print | Bill/checkout/reports đang hỗ trợ in | A4 PDF hoặc giấy receipt theo chức năng hiện có |

Mọi screenshot representative phải chờ `document.fonts.ready`, ảnh decode, state ổn định. Caption tiếng Việt/Japanese dài, số tiền lớn, ID dài không đè nút. Dùng fixture test, không chụp customer/token/secret thật. Lần cập nhật golden snapshot phải review diff thủ công; không tự approve toàn bộ ảnh.

## 3. Assertions hành vi

1. Logo dùng đúng asset, naturalWidth/height hợp lệ; không HTTP request đến Google Fonts/CDN. Root computed background `rgb(7, 29, 33)` ngay trước và sau hydration.
2. Tab qua skip link, nav, inputs và actions; focus không bị banner/header che. Dialog đóng trả focus. Keyboard không kích hoạt double-submit.
3. Khi submit pending, button disabled/busy đúng; lỗi được đọc qua alert; input và operationId retry không bị mất do đổi wrapper/component.
4. Authenticated admin giữ role restrictions. Guest không nhận menu admin, không tăng quyền từ navigation. Request payload và endpoint không đổi.
5. Offline/unknown vẫn khóa đúng hành động; mock/native/not_run giữ nhãn. Snapshot UI không biến unknown thành success.
6. Touch target theo policy spec; 200% zoom không mất hành động. Body không overflow ngang; vùng table/canvas overflow được phép có label.
7. Reduced-motion không còn hover translate/pulse trang trí; screen reader không nhận live-region spam từ telemetry.
8. QR không bị invert/opacity; bản in không nền đen; checksum/fonts có mặt khi bundle cold boot offline.

Axe chỉ hỗ trợ phát hiện lỗi, không thay kiểm keyboard/chart/Canvas và đánh giá thao tác. Không khẳng định toàn bộ WCAG conformance chỉ từ scanner.

## 4. Lệnh kiểm hiện có

Chạy tại repo tương ứng, Node 24.22.2 / pnpm 10.32.1 cho Lab/Source. Không chạy DB test vào hosted production. Test mới trong plan được thêm vào lệnh bên dưới ở bước implementation.

```sh
# lab
pnpm check:source
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:twin-e2e
pnpm bundle:offline

# source, local isolated DB theo bootstrap/test runner hiện có
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:e2e

# trial, môi trường isolated theo docs/testing.md
npm test
node scripts/smoke-review.js
```

Source e2e có cả fixture local DB và coordinator: giữ harness `scripts/test-runner.mjs`, `playwright.config.ts`, `tests/support/cloud-server.ts`; không đổi sang test server giả cho kết luận auth/integration. Nếu dependency chưa sẵn thì ghi blocked_external/not_run và reason, không skip-to-pass. Build Android/WebView qualification khi có SDK/device: kết quả browser không thay kết quả Android.

## 5. Evidence và rollout

Evidence index ở `lab/docs/implementation/evidence/brand-ui-v1/index.json`; screenshot/log lớn có thể ở artifact store, index lưu URL/path + SHA256 + metadata, không trỏ đường dẫn Downloads riêng. Một record:

```json
{
  "gate": "G-UI-LAB",
  "status": "not_run",
  "repo": "lab",
  "commit": null,
  "brandVersion": "1.0.0",
  "profile": "browser-mock",
  "browser": null,
  "command": "pnpm test:e2e",
  "exitCode": null,
  "artifacts": [],
  "reason": "implementation_not_started"
}
```

Null là hợp lệ chỉ với not_run, chưa biết commit thực thi. Khi chạy phải ghi actual SHA/browser/exitCode. Các giá trị status: planned/not_run/blocked_external/failed/passed/accepted; `accepted` cần người nghiệm thu và thời điểm, không tự suy từ số test.

Phát hành: build/export brand → cập nhật consumers → tất cả gate local → preview Cloud/Lab → kiểm auth và screenshot → promote từng project theo quyền đã cấp cho đợt triển khai → Trial package deploy trong maintenance window đã thống nhất. Cloud `henry-projects/mekoniq` và Lab `henry-projects/mekoniq-lab` là hai project; không tạo project mới. Brand-only không cần Supabase migration/env secret mới.

Rollback: pin lại brand release + revert app migration commit tương ứng; redeploy previous Vercel deployment cho từng project; restore static assets Trial nguyên phiên bản. Không reset DB/robot journal, không rollback business data. Thử quy trình ở preview/isolated environment trước. Nếu trial vận hành chưa được kiểm thực tế, gate Trial vẫn pending dù Cloud/Lab đã deploy.
