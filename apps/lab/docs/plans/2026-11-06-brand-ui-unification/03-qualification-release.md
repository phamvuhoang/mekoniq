# UI Qualification & Release Implementation Plan

> **For agentic workers:** Use `executing-plans` task-by-task. Không gọi pass cho test chưa chạy.

**Goal:** Chứng minh sự đồng bộ và các hành vi cũ hoạt động, phát hành/rollback được độc lập.
**Architecture:** Evidence matrix theo repo/commit/brandVersion; preview trước release, không DB migration.
**Tech Stack:** Existing Playwright harnesses, Vitest/node:test, browser screenshots, Vercel CLI, offline bundles.
**Spec:** [Verification](../../specs/2026-11-06-brand-ui-unification/verification.md).

## Global Constraints

Áp dụng [global constraints](README.md#global-constraints). Local fixture data cho screenshots; không chụp secrets/customer production. Runtime pin và simulation status giữ nguyên. Đợt implementation phải xác định quyền deploy áp dụng cho phạm vi hiện tại; không mặc định plan này tự publish mọi app.

## Q01 — Baseline, regression và visual acceptance

**Create:** Lab `docs/implementation/evidence/brand-ui-v1/index.json`, `README.md`; repo-local screenshot outputs theo test harness. **Modify:** ba brand browser suites từ app tasks và CI scripts tương ứng để chạy checkers. **Create (Source):** `tests/e2e/brand-a11y.spec.ts` nếu dùng shared browser assertions, local fixture helpers trong `tests/support/brand-fixtures.ts`.

**Interfaces:** evidence record theo spec verification §5; screenshots liên kết hash + metadata, không yêu cầu cùng thư mục runtime. Browser versions được pin theo lockfile và môi trường chụp; cùng OS/browser cho before/after.

- [ ] **Trước L01/S01/S02/T01:** chụp baseline theo inventory và matrix; dùng test users/local DB. Màn không dựng được fixture ghi reason, tạo fixture tối thiểu hợp lệ trước khi kết luận coverage; không chụp login thay màn admin.
- [x] Thêm computed-style assertions/keyboard/overflow/asset network checks vào từng harness. Nếu thêm axe dùng dev dependency pinned, không bundle vào app; chạy offline. Ví dụ kiểm cùng state và asset availability:

```ts
await page.evaluate(async () => { await document.fonts.ready; });
const broken = await page.locator('img').evaluateAll(images =>
  images.filter(image => !(image as HTMLImageElement).complete ||
    (image as HTMLImageElement).naturalWidth === 0).map(image => image.getAttribute('src')));
expect(broken).toEqual([]);
await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 29, 33)');
```

- [ ] Chạy matrix có meaningful state cho mọi route; snapshot chỉ cập nhật sau review diff. Accessibility scan serious/critical = 0 trong tested fixtures; chạy keyboard và reduced motion riêng. Kiểm 200% zoom, hidden/permission, selected, error, busy, offline, mock/native labels và print.
- [x] Chạy các commands trong spec verification §4; lưu logs đúng HEAD. UI-only không yêu cầu rerun physics/native controller để nghiệm thu màu, cũng không được dùng pass UI để đóng native gate. Rerun tests rộng hơn khi thay shared DOM helper làm ảnh hưởng workflow.
- [x] Mở các ảnh đại diện VI/EN/JA, confirm logo/font consistency, không crop text/total/status, phân biệt primary/destructive. Ghi accepted/rejected từng screenshot group và người review, không chỉ boolean screenshot generated.
- [ ] Commit `test(ui): qualify cross-app brand consistency`; evidence chưa đủ giữ not_run/blocked, ghi next action cụ thể.

## Q02 — Offline, packaging, preview và rollout

**Modify:** app build wiring và `lab/scripts/build-offline.mjs` chỉ nếu test phát hiện assets thiếu; Trial export script chỉ nếu target allowlist cần bổ sung. **Create:** `lab/docs/implementation/evidence/brand-ui-v1/release.md` và deployment receipts trong nơi lưu evidence của từng repo.

**Interfaces:** brandVersion/checksum giống nhau giữa apps; app release vẫn độc lập. Cloud/Lab projects giữ tên hiện có; Trial service config/DB không đổi.

- [ ] Build từ checkout sạch đã pin, export/check từng app. Cold run brand gallery/consumer với external network blocked; test Lab `bundle:offline` + R-MOCK và Trial LAN theo harness. Nếu native module/env thiếu ghi blocked đúng profile, vẫn kiểm static asset/font paths.
- [ ] Dùng test print workflow để kiểm Paper background/Dark Ink, QR và total còn đúng. Build Tablet WebView, kiểm offline reload/enrollment/error với môi trường Android sẵn có; thiếu device không gọi accepted Android.
- [x] Tạo preview cho `mekoniq-lab` và `mekoniq` từ đúng commits trong scope deploy được cho phép; check assets/root theme/hydration/login guard và không leak private source/evidence. Ghi preview deployment IDs và URL, Node 24, build commands; không sửa Supabase/env secrets chỉ vì theme.
- [ ] Rehearse rollback ở preview: previous app commit/brand bundle dựng lại được; previous release assets không bị mất. Trial dùng isolated static restore, không khởi động production flows.
- [ ] Khi đủ acceptance và authorization của đợt triển khai: promote Lab, smoke six routes; promote Cloud, health/live + ready và auth/guest flow bằng account được phép; Trial update trong cửa sổ vận hành đã thống nhất, smoke operator. Nếu một app chưa rollout, index nêu deployedVersion của từng app, không gọi toàn hệ thống đồng bộ production.
- [ ] Release receipt lưu actual commits, brandVersion, asset hashes, gate results, deployment URLs/IDs, previous rollback targets, blockers. Không lưu tokens/cookies/secret values. Commit docs `docs(ui): record brand rollout evidence` sau verification.

**Điều kiện kết thúc:** tất cả UI-01…12 đã có evidence pass trên các profile được cam kết; mọi exception có owner/reason, không đếm là pass. Release production và test isolated được ghi riêng.

## Trạng thái qualification

Browser matrix, checksums, local regression, remote preview smoke và representative image review đã chạy. Các checkbox có nhiều profile được giữ mở khi chưa có đầy đủ bằng chứng: baseline không cùng mọi viewport, manual 200% zoom chưa nghiệm thu, native Android thiếu thiết bị, Cloud production rollback chưa chuyển alias. Không coi những phần này là pass. Xem [release receipt](../../implementation/evidence/brand-ui-v1/release.md) cho phạm vi chính xác.
