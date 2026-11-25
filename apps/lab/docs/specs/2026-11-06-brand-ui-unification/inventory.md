# Baseline và migration inventory

Khảo sát read-only ngày 06/11/2026. Các kết luận dưới dựa trên source code; chưa chạy visual audit của UI mới.

| Repo | HEAD đã khảo sát | Hiện trạng |
|---|---|---|
| lab | `357d6699b2c618d489a054bb23e1c3bcd567f2d9` | Vite 7, TypeScript, DOM, Three.js; CSS riêng; clean trước khi tạo spec |
| source | `5c86337867389c063b4dbf6b9371266ae3f238bb` | Next 16/React 19 Cloud; Vite/DOM Tablet; `packages/ui` có OfflineBanner/SyncStatus nhưng chưa có design tokens chung |
| trial | `6298f8315ac0c89cb233024c42b8b9c035dd1d9f` | Node-RED 5, CommonJS, static HTML/CSS; clean tại thời điểm khảo sát |

Source có các HTML/artifact và sửa `artifacts/README.md` chưa commit từ công việc trước. Không thuộc migration này; không stage, regenerate hoặc ghi đè chúng. Recheck HEAD/status khi bắt đầu implementation; các SHA trên là baseline tài liệu, không phải khóa cứng cấm tiếp tục phát triển.

## Lab

| Entry / nhóm màn | File hiện có | Migration |
|---|---|---|
| Header và 6 route hash | `src/app.ts`, `src/styles/main.css` | Thay brand-mark ba cột bằng logo; alias tokens, giữ navigation/actions/i18n |
| `#design`, `#restaurant` | `src/ui/engineering-panel.ts`, `src/world/editor.ts`, `src/viewer/robot.ts`, `src/viewer/fallback.ts` | Panel/form/cost/map legend; không thay vật liệu mô phỏng theo global search-replace |
| `#scenarios` | `src/ui/fault-schedule.ts`, `src/scenarios/controls.ts` | Input, disabled capability, fault badge |
| `#twin` | `src/ui/workspace.ts`, `src/ui/operations-panel.ts`, `src/twin/inspector.ts`, `src/viewer/twin3d.ts` | Toolbar/inspector/transfer/ARM03/readiness; giữ trạng thái unknown/stale |
| `#results`, `#deployment` | `src/ui/report-panel.ts`, `src/app.ts` | Reports/tables/evidence/export/preflight |
| Bootstrap/offline | `src/main.ts`, `index.html`, `scripts/build-offline.mjs` | CSS import, icon, local asset/font inclusion |

Token hiện tại: bg `#0b151a`, panel `#121f26`, accent `#b4f375`, muted `#a2b8bf`. Mapping: `--bg→--mq-bg`, `--panel→--mq-surface`, `--raised→--mq-surface-raised`, `--ink→--mq-text`, `--muted→--mq-text-muted`, `--line→--mq-border`, `--accent→--mq-primary`, `--accent-ink→--mq-on-primary`, `--amber→--mq-warning`, `--danger→--mq-danger`. `--blue` cần xét vai trò: info→Aqua; chart series độc lập giữ màu có legend, không đổi mù.

## Source Cloud

Root `apps/cloud-web/src/app/layout.tsx` hiện chỉ render html/body, chưa import stylesheet global. Home/login/backoffice đang dùng nhiều native elements; cần styling và bố cục nhất quán, không chỉ đổi một biến root.

| Routes | Files / scope |
|---|---|
| `/`, `/login` | `src/app/page.tsx`, `src/app/login/page.tsx`: logo, slogan, form, error/busy, responsive |
| `/admin/settings`, `/admin/catalog` | `src/app/(backoffice)/admin/layout.tsx`; `src/components/backoffice/FeatureSettings.tsx`, `VenueLayoutEditor.tsx`, `MenuEditor.tsx` |
| `/admin/operations`, `/admin/promotions`, `/admin/customers`, `/admin/reservations` | `OperationsReports.tsx`, `Promotions.tsx`, `Customers.tsx`, `Reservations.tsx` trong cùng components/backoffice |
| `/admin/chain/configuration`, `/admin/chain/reports` | `ChainConfiguration.tsx`, `ChainReports.tsx`; không thay điều kiện `chain.read` |
| `/menu/[venueId]`, `/table/[token]`, `/order/[venueId]` | `src/app/(guest)/…`; `src/components/guest/{Menu,Cart,TableSession,OnlineCheckout,MiniAppBridge}.tsx` |

Plan tạo global stylesheet, assets public và BrandLogo component. Các `<main>`, fieldset, table đang có được giữ semantics. Không mock đăng nhập production, không nới permission để chụp ảnh. Dùng fixtures isolated của `tests/support/supabase-auth.ts` và `cloud-server.ts` cho authenticated screenshots.

## Source Tablet / Android WebView

Entry: `apps/tablet-web/src/{main.ts,styles.css,ui.ts,router.ts}`. Typography local đã có Be Vietnam Pro; theme hiện nền sáng. Route inventory lấy từ `router.ts`:

- Vận hành: `/device`, `/pos`, `/kitchen`, `/fleet` và alias `/robot`, `/robot-setup`, `/checkout`, `/cash`, `/print`, `/guest-requests`, `/kiosk`, `/robot-screen`.
- Recovery: `/isolated`, `/reconciliation`, `/maintenance`, `/import`, `/recovery`.
- Quản trị: `/reports`, `/inventory`, `/recipes`, `/purchasing`, `/stocktake`, `/staff`, `/promotions`, `/invoices`, `/customers`, `/reservations`, `/models`, `/inventory-reports`, `/settings`.
- Enrollment/error khi chưa có session trong `main.ts`.

Mỗi route phải load theme và giữ `screenFeatures`/permission. Lượt qualification chụp ít nhất một trạng thái meaningful ở mỗi route; empty/loading/error/permission/offline bổ sung theo representative trong verification. Android native transport, enroll và persistence nằm ngoài phạm vi chỉnh sửa.

Alias CSS Tablet: `--bg→--mq-bg`, `--ink→--mq-text`, `--surface→--mq-surface`, `--soft→--mq-surface-raised`, `--muted→--mq-text-muted`, `--line→--mq-border`. Xét `--accent` ở từng selector vì một số chỗ dùng làm text/button; CTA chữ Deep, link chữ Aqua. Thay các hardcoded light backgrounds ở menu item/offline-banner và border input, không invert cả trang.

## Trial

| File | Nội dung cần kiểm |
|---|---|
| `data/public/index.html` | Launcher/home + logo |
| `data/public/setup.html` | Cấu hình/tính năng, các field/table/dialog và feedback lưu |
| `data/public/station.html` | Trạm, hàng đợi, load/handoff, command button lớn |
| `data/public/robot.html` | Màn robot, nhiệm vụ/blocked/offline, nút dừng/hủy hiện có |
| `data/public/table.html` | QR guest, ngôn ngữ, request/bill, mobile |
| `data/public/map.html` | Editor, lane/obstacle/selection, legend |
| `data/public/brand.css`, `logo.svg` | Primitive đã đúng phần lớn nhưng theme sáng, wordmark dựng bằng CSS/font |
| `data/public/vmap.js` | Rà soát màu render; chỉ đổi UI presentation nếu cần |

Alias: `--bg→--mq-bg`, `--fg→--mq-text`, `--card→--mq-surface`, `--soft→--mq-surface-raised`, `--muted→--mq-text-muted`, `--mint→--mq-primary`, `--iq→--mq-info`, `--warn→--mq-warning`, `--danger→--mq-danger`. `--deep`, `--ink`, `--paper`, `--accent` vẫn là primitive; phải sửa selector đang lấy chúng làm foreground trên surface mới. Kiểm `.act`, `.pill.*`, `.toast.*`, `.seg.dark`, `.floor`, SVG fill/stroke và inline style trong HTML.

Không sửa `data/lib`, `data/flows.json`, `data/settings.js`, site configuration hoặc credentials cho mục đích theme. Giữ ID/data-action và command confirmation hiện tại. Software stop/cancel giữ tên và semantics đang có; không ngụ ý thay thế E-stop vật lý.

`scripts/export-web.sh` dùng rsync `--delete` từ `data/public` sang `../web/demo`, loại trừ `transport.js`, `index.html`, `showcase.html`, `lib`, `site.json`. Vì vậy chạy export trong sibling checkout tạm của Trial/Web để kiểm diff; không chạy trên web working tree đang có thay đổi. Fonts/brand export mới phải vào demo; launcher/transport riêng vẫn hoạt động. Mọi publish `web/` là release riêng.

## File mới dự kiến ở bước implementation

| Repo | Files |
|---|---|
| Source canonical | `packages/ui/brand/{tokens.json,tokens.css,components.css,fonts.css,release.json,README.md}`, `packages/ui/brand/assets/*`, `packages/ui/brand/fonts/*` |
| Source tooling | `scripts/build-brand.mjs`, `scripts/export-brand.mjs`, `scripts/check-brand.mjs`, `tests/unit/brand-assets.test.ts`, `tests/unit/brand-contrast.test.ts` |
| Source app wiring | `apps/cloud-web/src/app/globals.css`, `apps/cloud-web/src/components/BrandLogo.tsx`, `apps/cloud-web/public/brand/*`, `apps/tablet-web/public/brand/*` |
| Lab consumer | `public/brand/*`, `scripts/check-brand.mjs`, `tests/e2e/brand-ui.spec.ts` |
| Trial consumer | `data/public/brand/*`, `scripts/check-brand.cjs`, `scripts/test-brand.js`, `scripts/smoke-brand.js` |

`*` ở bảng trên là danh sách file allowlist do `release.json` xác định, không phải quyền ghi đè toàn bộ thư mục. Các path này **chưa được tạo ở runtime** trong task spec/plan.
