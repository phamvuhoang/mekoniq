# Brand Foundation Implementation Plan

> **For agentic workers:** Use `executing-plans` task-by-task; checkbox steps below.

**Goal:** Một nguồn token/asset/CSS có version, dùng offline được ở ba repo.
**Architecture:** `source/packages/ui/brand` là canonical, consumers nhận file export kiểm hash; không thêm React dependency cho Lab/Trial.
**Tech Stack:** JSON, CSS, Node ESM, Vitest; font WOFF2 và assets gốc.
**Spec:** [Sections 1–5](../../specs/2026-11-06-brand-ui-unification/README.md).

## Global Constraints

Áp dụng nguyên văn [global constraints](README.md#global-constraints). Brand v1 `1.0.0`; không dùng ngày/HEAD động trong nội dung CSS. Không tạo symbol/wordmark thay cho artwork gốc.

## F01 — Canonical tokens, assets và component states

**Files — Create (Source):**
- `packages/ui/brand/tokens.json`, `tokens.css`, `components.css`, `fonts.css`, `README.md`.
- `packages/ui/brand/assets/`: ba SVG và các PNG gốc cần dùng, tên giữ nguyên.
- `packages/ui/brand/fonts/`: Be Vietnam Pro 400/700 Latin/VI, JetBrains Mono 500 và OFL.
- `scripts/build-brand.mjs`, `tests/unit/brand-assets.test.ts`, `tests/unit/brand-contrast.test.ts`.
- `packages/ui/brand/gallery.html`: fixture nội bộ để xem toàn bộ component states, không là product route.

**Interfaces:** `tokens.json` có `{schemaVersion:1,brandVersion:"1.0.0",primitives:Record<string,string>,semantic:Record<string,string>}`. Keys là tên CSS variable đầy đủ; semantic value là HEX hoặc `var(--mekoniq-…)`. `build-brand.mjs` xuất tokens.css deterministic từ JSON, validate alias không cycle/unknown. CSS dùng `.mq-*` contract của spec.

- [x] Đọc status/HEAD ba repo, local Next guide trong `source/apps/cloud-web/node_modules/next/dist/docs/` trước khi đụng app. Chụp baseline reference theo Q01 trước migration. Giữ các file dirty ngoài scope.
- [x] Viết test asset/token: so original hashes với spec manifest; SVG không `<script>`, `<foreignObject>`, event attribute, URL external; giữ colors logo. Test reject unresolved alias và tính contrast từ sRGB. Ví dụ core assertion:

```ts
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
const t = JSON.parse(readFileSync('packages/ui/brand/tokens.json', 'utf8'));
test('brand values and readable CTA contract', () => {
  expect(t.primitives['--mekoniq-deep']).toBe('#071D21');
  expect(t.primitives['--mekoniq-motion']).toBe('#B9FB75');
  expect(t.primitives['--mekoniq-logo-orange']).toBe('#FFAA76');
  expect(t.semantic['--mq-on-primary']).toBe('var(--mekoniq-deep)');
});
```

- [x] Chạy `pnpm exec vitest run tests/unit/brand-assets.test.ts tests/unit/brand-contrast.test.ts` trong Source; xác nhận failure vì chưa có canonical files, không do sai test runner.
- [x] Copy assets **nguyên byte** từ spec `assets/`, fonts từ Tablet/Trial đã khảo sát; ghi provenance/license. Tạo toàn bộ primitive/semantic values theo bảng spec, gồm UI extension. Generator serialize declaration theo key ổn định và LF; không rewrite SVG. Thêm CSS baseline sau vào components và hoàn thiện state gallery:

```css
.mq-button { min-width:44px; min-height:44px; padding:10px 16px;
  border:1px solid var(--mq-control-border); border-radius:10px;
  background:var(--mq-surface); color:var(--mq-text); font:inherit; }
.mq-button--primary { background:var(--mq-primary); color:var(--mq-on-primary); }
.mq-button--danger { background:var(--mq-danger); color:var(--mq-on-danger); }
.mq-button:focus-visible { outline:2px solid var(--mq-focus); outline-offset:3px; }
.mq-button:disabled { background:var(--mq-surface-raised); color:var(--mq-text-muted); cursor:not-allowed; }
@media(prefers-reduced-motion:reduce) {
  .mq-button { transition:none; animation:none; }
}
```

- [x] Gallery phải gồm field, checkbox, select, table, alert, badge, nav, logo, default/hover/focus/disabled/busy/destructive. Không style checkbox bằng `input {width:100%}`. CSS font-face URL dùng `./fonts/…`; assets được phục vụ cùng namespace `/brand` ở mọi app. Typography/radius/spacing/motion dùng token thay vì copy giá trị tùy ý.
- [x] Chạy generator hai lần, diff bằng 0; chạy hai tests. Browser đọc gallery với keyboard/reduced motion; ghi ảnh reference. Test contrast đủ các foreground/background ở spec và từng status trên surface/raised, không chỉ Deep.
- [x] Commit riêng Source: `feat(ui): add MEKONIQ brand foundation`; stage đúng files task, không `git add .`.

## F02 — Versioned export và kiểm drift

**Files — Create:** Source `scripts/export-brand.mjs`, `scripts/check-brand.mjs`, `tests/unit/brand-export.test.ts`, `packages/ui/brand/release.json`; Lab `scripts/check-brand.mjs`; Trial `scripts/check-brand.cjs`. Consumers được sinh: Source `apps/{cloud-web,tablet-web}/public/brand/`, Lab `public/brand/`, Trial `data/public/brand/`.

**Interfaces:**

```text
node scripts/build-brand.mjs
node scripts/export-brand.mjs --target <brand-directory>
node scripts/check-brand.mjs --dir <brand-directory>
node scripts/check-brand.mjs --dir <brand-directory> --against <release.json>
```

Các CLI Source mới cần implement. Consumer Lab/Trial checker dùng `--dir`, `--against` cùng nghĩa. Check không cần sibling repo; `--against` dùng khi đối chiếu release từ artifact đã tải. Exit 0 match, 1 invalid/mismatch/unsafe target. Export chỉ allowlist brand, không toàn public/. Consumer receipt giữ sourceCommit của canonical inputs; không lấy commit app consumer.

- [x] Test trong temp directory: export lần đầu pass; sửa một byte logo/font fail checker; path traversal/absolute manifest path/duplicate path fail; file lạ trong target làm export fail mà không xóa; missing font fail; không sửa byte ngoài target; lần export hai không đổi hash.
- [x] Chạy `pnpm exec vitest run tests/unit/brand-export.test.ts` và quan sát expected fail trước implementation.
- [x] Implement path resolution bảo vệ symlink/path traversal, validate release schema, stable SHA256 và atomic staging/replacement từng export directory. Lấy `sourceCommit` từ commit F01 của canonical inputs đã commit; reject nếu input canonical dirty. File generated release và outputs không được tính là input dirty; document allowlist rõ trong README. Manifest không self-hash.

```js
// Định dạng mỗi record trong release.json; SHA phải tính từ bytes thật.
const entry = {path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
```

- [x] Generate release, export vào bốn app public paths và Trial, thêm checker vào build/CI hiện có từng repo (Trial dùng CommonJS). Consumer build chỉ gọi checker của chính repo; không tự truy cập Downloads, mạng hoặc Source checkout. Source CSS import canonical ở package, public copy phục vụ font/assets; checker đối chiếu copy này.
- [x] Chạy tests và checker từng target; thử build consumer khi không có sibling Source bằng temp checkout. Kiểm `/brand/fonts/...` và logo paths trong CSS/HTML không 404. Ghi brandVersion/hash vào task evidence.
- [x] Commit từng repo, subjects `chore(ui): pin MEKONIQ brand assets v1`. Thư mục public hiện có không bị xóa; giữ Lab `business-plan.html`.

**Done:** `1.0.0` có contract/asset tests, consumer tự check được, chưa claim UI đã migrate.

## Kết quả thực thi

Các bước implementation/browser đã hoàn tất; xem [evidence](../../implementation/evidence/brand-ui-v1/README.md) và commit trong index. Checkbox không có nghĩa nghiệm thu production/native. Android đã build APK; kiểm trên thiết bị còn `blocked_external`.
