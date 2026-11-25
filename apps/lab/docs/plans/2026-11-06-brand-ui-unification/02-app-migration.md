# App Migration Implementation Plan

> **For agentic workers:** Use `executing-plans` task-by-task. Không tự dispatch subagents.

**Goal:** Migrate mọi màn trong inventory sang brand v1, giữ hành vi nghiệp vụ.
**Architecture:** Consumer CSS aliases + app-specific layout. React components ở Cloud; DOM/HTML giữ stack hiện có.
**Tech Stack:** Vite/TypeScript/DOM/Three.js, Next/React, CSS, Node-RED static HTML, Playwright.
**Spec:** [Design](../../specs/2026-11-06-brand-ui-unification/README.md), [inventory](../../specs/2026-11-06-brand-ui-unification/inventory.md).

## Global Constraints

Áp dụng [global constraints](README.md#global-constraints). F01/F02 phải pass trước. Screenshot baseline đã lưu trước đổi UI; không đổi fixtures để che lỗi visual. Mỗi task kết thúc bằng commit riêng, test logs và ảnh trước/sau.

## L01 — Lab: reference implementation

**Modify:** `lab/src/styles/main.css`, `src/app.ts`, `src/main.ts`, `index.html`; các UI file đúng inventory khi cần class/aria. **Create:** `lab/tests/e2e/brand-ui.spec.ts`. **Inspect:** `src/ui/*`, `src/viewer/{robot,fallback,twin3d}.ts`, `scripts/build-offline.mjs`.

**Interfaces:** nhận `/brand/{tokens,fonts,components}.css`, assets từ F02. Giữ nguyên hash routes, `data-action`, runtime client và report model.

- [x] Viết test trên existing Playwright config, đi qua sáu route có sẵn. Check brand background/logo name/size, không overflow body, tab focus, long VI/JA labels. Ví dụ:

```ts
import {test, expect} from '@playwright/test';
test('Lab uses canonical dark theme and accessible brand', async ({page}) => {
  await page.goto('/#design');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 29, 33)');
  await expect(page.getByRole('link', {name:'MEKONIQ Robot Lab', exact:true})).toBeVisible();
  await page.setViewportSize({width:390, height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

- [x] `pnpm exec playwright test tests/e2e/brand-ui.spec.ts` phải fail màu/asset ở baseline. Ghi log nguyên nhân.
- [x] Import CSS brand trước app styles, map alias theo inventory. Thay ba cột logo ở `app.ts` bằng image, giữ link #design và product suffix. Layout skeleton:

```html
<a class="brand mq-brand" href="#design" aria-label="MEKONIQ Robot Lab">
  <img class="brand-horizontal" src="/brand/assets/MEKONIQ_Horizontal_White_Transparent_v2.png" width="1420" height="300" alt="">
  <img class="brand-compact" src="/brand/assets/MEKONIQ_Icon_Transparent.svg" width="40" height="40" alt="">
  <span class="brand-lab">ROBOT LAB</span>
</a>
```

- [x] CSS chỉ hiện một ảnh theo breakpoint, giữ tỷ lệ/clear space; thêm `color-scheme:dark`, font-face local. Chỉnh CTA, inputs, tabs, tables, dialogs, inspectors, overlays DOM và report badges theo contract. Không replace tất cả HEX trong renderer: axis/obstacle/material có allowlist và legend.
- [x] Rà sáu workspace, keyboard, three locales, unknown/stale/busy/error/disabled. Thêm giới hạn 44px đúng controls; không tăng canvas hit marker làm đổi tọa độ scene.
- [x] Chạy `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:source`, `pnpm test:e2e`, `pnpm test:twin-e2e`. Chụp suite brand sau khi font load; kiểm console và asset errors. `check:source` không được sửa pin runtime để chữa lỗi unrelated.
- [x] Commit `feat(ui): align Lab with MEKONIQ dark brand`; ghi screenshot/evidence L01. Đây là reference cho các app sau, không ép layout của Lab vào POS.

## S01 — Source Cloud: public, login, admin và guest

**Create:** `source/apps/cloud-web/src/app/globals.css`, `src/components/BrandLogo.tsx`, `source/tests/e2e/cloud-brand.spec.ts`. **Modify:** `src/app/layout.tsx`, `page.tsx`, `login/page.tsx`, `(backoffice)/admin/layout.tsx`, các `components/backoffice/*.tsx`, `components/guest/*.tsx` trong inventory.

**Interfaces:** `BrandLogo({compact?:boolean, href?:string, label?:string})` render original asset trong link có tên. CSS common được import từ `packages/ui/brand`; scope app `.cloud-app`, admin/guest class riêng. Các server handlers và endpoint không đổi.

- [x] Đọc guide Next local như AGENTS.md yêu cầu. Tạo e2e dùng `startCloud`/`createSupabaseActor` theo `cloud-catalog.spec.ts`; thêm actor thiếu permission và guest fixtures theo `guest-table.spec.ts`. Tests phải có: login error/busy, authenticated nav, forbidden access, menu published pending không đổi giá đã áp dụng, guest submit không gửi trùng.
- [x] Test root background, logo và focus trên login fail ở baseline. Test chạy qua `pnpm test:e2e` theo runner local DB, không dùng hosted env. Tránh tự gán `actor` vào production layout để bypass auth.
- [x] Thêm BrandLogo và CSS, import ở root trước render. Header/login wrappers chỉ phục vụ layout, giữ controlled inputs/hooks nguyên. Ví dụ structure:

```tsx
// globals.css import đặt ở đầu root layout; giữ lang vi hiện có.
return <html lang="vi"><body className="cloud-app">{children}</body></html>;
// BrandLogo: decorative image nằm trong link có accessible name.
return <a className="mq-brand" href={href} aria-label={label}>
  <img src={compact ? '/brand/assets/MEKONIQ_Icon_Transparent.svg'
    : '/brand/assets/MEKONIQ_Horizontal_White_Transparent_v2.png'} alt="" />
</a>;
```

- [x] Thêm slogan ở home/login, label nguyên ngữ; admin responsive nav vẫn chỉ render link theo quyền hiện tại. Style field/fieldset/select/checkbox riêng, table scroll wrapper, alert/live-region, draft/pending banner, guest cart/checkout/empty-state. Xem toàn bộ routes inventory, không chỉ login.
- [x] Guest images/QR không filter; dùng `@media print` cho nội dung có in. Không cần font remote hoặc `next/font/google`. Input autofocus/focus ring không bị dark autofill phá.
- [x] Chạy `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:e2e`; lưu screenshot login/admin/guest theo matrix. Check browser console/hydration và CORS/CSRF/auth regressions qua existing journeys.
- [x] Commit `feat(ui): apply MEKONIQ dark theme to Cloud`; ghi mọi blocked test thực, không dùng login smoke để kết luận admin đã nghiệm thu.

## S02 — Source Tablet và Android WebView

**Modify:** `source/apps/tablet-web/src/styles.css`, `main.ts`, `ui.ts`, các `screens/*.ts` trong inventory nếu cần class/aria, `index.html`; `packages/ui/src/{OfflineBanner,SyncStatus}.ts` chỉ khi cần presentation. **Create:** `source/tests/e2e/tablet-brand.spec.ts`.

**Interfaces:** DOM helpers và ScreenContext không đổi; thêm class mq-* vào elements do helpers tạo. Các permission, route, feature guards và native transport giữ nguyên.

- [x] E2e dùng coordinator fixture existing `playwright.config.ts`. Test logo, route theme, offline banner readable, focus còn trên form khi snapshot mới, quyền khóa đúng action; check primary target ≥56px. Core assertion:

```ts
await page.goto('/device');
await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 29, 33)');
await page.emulateMedia({reducedMotion:'reduce'});
await page.setViewportSize({width:800, height:1280});
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
```

- [x] Chạy test mới và xác nhận fail visual trước edit. Reuse actual session fixtures; không coi browser offline mạng là bằng chứng native persistence.
- [x] Alias variables + replace hardcoded light card/field/warning theo inventory; DOM brand img bằng `document.createElement`, không innerHTML cho dữ liệu dynamic. Giữ `/device` link, language storage key, poll interval, retry map.
- [x] Migrate mọi screen gồm enrollment/recovery/inventory/print theo inventory. Desktop dense và touchscreen profiles khác spacing nhưng cùng semantic tokens. Đảm bảo flags hidden/disabled vẫn đúng; print bill không nền đen. Ví dụ:

```css
@media print {
  body { background:#fff; color:var(--mekoniq-ink); }
  .topbar, .main-nav, .header-actions { display:none; }
  .panel, .record { background:#fff; color:var(--mekoniq-ink); box-shadow:none; }
}
```

- [x] Chạy Source typecheck/lint/build và e2e, gồm full-pos/restaurant-journey/device-status/cash-print. Xác nhận `@capacitor/core` flow không thay; build Android và kiểm WebView khi có môi trường. Nếu chưa có, ghi `blocked_external` riêng; browser tests vẫn chạy.
- [x] Commit `feat(ui): align Tablet surfaces with MEKONIQ brand`; lưu screenshot toàn route, không thay native app icon/splash.

## T01 — Trial: static UI trên LAN

**Modify:** `trial/data/public/brand.css`, `index.html`, `setup.html`, `station.html`, `robot.html`, `table.html`, `map.html`, `logo.svg`; `vmap.js` chỉ khi cần đổi màu presentation. **Create:** `trial/scripts/test-brand.js`, `scripts/smoke-brand.js`. **Inspect:** `common.js`, `transport.js`, `scripts/export-web.sh`, `docs/testing.md`.

**Interfaces:** load `brand/tokens.css`, `brand/fonts.css`, `brand/components.css` trước legacy `brand.css` bằng relative URL để chạy Node-RED và `/demo/`. `logo.svg` copy Q SVG gốc để link favicon cũ vẫn hợp lệ. Không đổi HTTP/WS/MQTT routes, IDs, handlers.

- [x] Node test kiểm file references, checksum và không remote font; browser script dùng `PLAYWRIGHT_MODULE`/`PLAYWRIGHT_CHROMIUM` theo harness hiện có. Add screenshots sáu HTML, computed dark bg, wrap language, warning/offline labels và 72/92px command targets.

```js
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
for (const file of ['index','setup','station','robot','table','map']) {
  const html = readFileSync(`data/public/${file}.html`, 'utf8');
  assert.ok(html.includes('brand/tokens.css'), `${file}: missing brand tokens`);
  assert.ok(!html.includes('fonts.googleapis.com'), `${file}: remote font`);
}
```

- [x] `node scripts/test-brand.js` fail trước migration. Chạy smoke trong temp Node-RED state theo `docs/testing.md`, không `npm start` với `data/settings.js` production.
- [x] Load styles, alias variables theo inventory, thay wordmark CSS/text bằng original PNG/icon. Xử lý `.act`, pills, toasts, map lane/selection và hardcoded `<style>` ở từng HTML; giữ red destructive semantics và input IDs. Ví dụ shared load:

```html
<link rel="stylesheet" href="brand/tokens.css">
<link rel="stylesheet" href="brand/fonts.css">
<link rel="stylesheet" href="brand/components.css">
<link rel="stylesheet" href="brand.css">
```

- [x] Bỏ hover translate/pulse trang trí trong reduced-motion. Check không làm mờ banner offline, giữ nhãn software stop/cancel và xác nhận hai bước đang có; không thêm E-stop software mới.
- [x] Chạy `npm test`, `node scripts/test-brand.js`, `node scripts/smoke-review.js`, browser smoke + smoke-brand theo held environment. Kiểm table guest 390px, robot/station portrait và map legend.
- [x] Export thử sang sibling Web checkout tạm; checksum transport/index/showcase trước/sau phải giữ nguyên. Không chạy rsync --delete vào working tree Web chưa kiểm status. Ghi diff generated files và xử lý tương thích selector mới với launcher riêng nếu có, không publish Web.
- [x] Commit `feat(ui): align Trial operator screens with MEKONIQ brand`; chỉ static UI/tests/docs, không flow/state/credentials. Trial vận hành thật chưa được update ở task test này.

## Kết quả thực thi

Các bước implementation/browser đã hoàn tất; xem [evidence](../../implementation/evidence/brand-ui-v1/README.md) và commit trong index. Checkbox không có nghĩa nghiệm thu production/native. Android đã build APK; kiểm trên thiết bị còn `blocked_external`.
