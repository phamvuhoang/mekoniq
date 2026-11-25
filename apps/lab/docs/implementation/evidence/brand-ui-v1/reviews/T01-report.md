# T01 — Trial static UI

Implementation commit: `7a4a896` (`feat/brand-ui-v1`). Brand export remains **1.0.1**, all 22 manifest files unchanged.

## Changes and scope

All six HTML screens load local tokens/fonts/components before the Trial adapter. The adapter supplies dark surfaces, Motion primary controls, readable disabled/offline states, red destructive controls with Deep text, focus, reduced motion, print ink aliases and preserved command sizes. Home uses the original horizontal PNG, compact views the original icon. Favicon is byte-identical to the supplied SVG.

Page-specific presentation colors and typography were migrated, menu inputs/selects gained accessible names, compact station preview stacks, and the robot header grows when controls wrap. Parent approved the narrowly scoped `common.js` BRAND HTML-template change because it generated the typed wordmark; its behavior/interfaces are unchanged. No flows, settings, credentials, runtime libraries, API/WS/MQTT routes, handlers, IDs or production ports were changed. The only dependency addition is pinned dev dependency `axe-core@4.14.0`.

## Validation

All commands used Node 24.22.2 via `PATH=/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:$PATH`.

- Red test: `node scripts/test-brand.js` failed before migration, missing index tokens.
- `npm test`: exit 0. Includes static UI test and 22-file brand checker; existing scenario/adapter/site/health/review scripts passed. Node-test groups: feature policy 22/22, billing 15/15, guest policy 34/34, review followup 13/13; no failures or skips.
- Fresh `SMOKE_HOLD=1 node scripts/smoke-review.js`: 7/7 integration checks, `SMOKE_OK`, held only isolated Node-RED 1891/MQTT 1886. Static files are copied at startup; the final run uses the latest UI.
- `node scripts/smoke-browser.js`: 6/6, `BROWSER_OK`, including both tablet orientations, competing/own saves, stale map responses and temporary Web mobile layout.
- `node scripts/smoke-feature-policy.js`: 18/18, `FEATURE_POLICY_BROWSER_OK`. Run before final caption/header/accessibility-label corrections; includes ordering, policies, confirmations, real retry/disconnect and billing. No runtime changes followed.
- `node scripts/smoke-brand.js`: matrix of 6 screens × VI/EN guest preferences × 1280×800 / 800×1280 / 390×844. Valid guest `t=T01` and robot `robot=R1` routes. All 36 layouts have no document horizontal overflow, Deep body background, local loaded UI font, retained applicable 72/92px command heights and zero serious/critical findings under axe WCAG 2A/2AA/2.1AA/2.2AA tags. Operational screens preserve their existing VI/bilingual text; this does not claim new EN translations.
- Activated-state scans: genuine order checkbox changes make Save enabled; actual robot order/table/quantity clicks; actual isolated delivery command exposes active/inactive trays. All three scans contain no serious/critical violations. Additional checks cover real EN switch/reload persistence, keyboard focus, 40px original compact icon, actual socket-close offline text without opacity loss, and print Dark Ink.
- Initial scans found and fixed legacy dark text on dark cards, Paper text on Motion, inactive tray text on pale surfaces, and menu inputs lacking labels. The enabled-Save harness was corrected to toggle an already-enabled default flag before asserting Save.
- `npm run pack`: exit 0; every one of 22 release file SHA256 values verified directly inside the tar, including local fonts and original assets.
- `git diff --check`: clean.

Browser environment: `PLAYWRIGHT_MODULE=/Users/hoangpham/source/prv/robot/source/node_modules/@playwright/test`, `PLAYWRIGHT_CHROMIUM=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; axe uses the pinned Trial dev dependency.

## Export and rollback rehearsal

The existing export script ran in a temporary sibling Trial/Web checkout. All **54** applicable public exports match the Trial files byte-for-byte; Web `transport.js`, `index.html`, `showcase.html` hashes stayed identical. Temporary Web served only on 1892. The real Web working tree was not exported or published.

Rollback rehearsal used a separate temporary static directory: copy current public → replace with `git archive 6298f83 data/public` → compare eight baseline screen/style/icon hashes against `git show` → restore all **56** current public files → compare all hashes and pass the 22-file brand 1.0.1 checker. The checker correctly rejected the `/var` symlink spelling; rerun with the resolved `/private/var` path passed.

## Evidence and limits

Evidence is uncommitted at `trial/.brand-evidence/`: 36 matrix PNGs, offline screenshot, three activated-state screenshots/JSON findings, `matrix.json`, `states.json`, export/rollback/pack receipts, and command logs. Root should copy curated evidence to Lab. No private fixture/state/credentials are committed.

No deployment, push, main merge, physical robot/tablet, Safari, hardware E-stop, native device, bank transfer or VietQR scan validation was performed. Existing hardware/native acceptance gates remain open. The suite checks serious/critical axe findings; it does not claim every accessibility guideline or manual usability gate is accepted.

## Final P2 review correction — 23cc7ce

Commit `23cc7ce` changes only the Trial adapter and the existing browser smoke. `.appbar .btn.armed` now explicitly uses `--mq-on-danger`, winning over the page app-bar foreground selector without changing any handler, confirmation duration or reset behavior.

Red → green evidence used real first clicks on `setup.html?tab=backup` → `#reset` and `map.html` → `#defaults`. Before the fix, Map computed Paper on Danger and axe reported 1.7:1 contrast; Setup's reset already passed. After the fix, both controls retain the armed class and “Chạm lần nữa…” label, compute Deep/Danger, and emit **zero `siteReset`/`mapReset` commands on the first click**. The tests close each page without clicking again. Both full-page WCAG 2A/2AA/2.1AA/2.2AA scans have zero serious/critical findings.

Commands: `npm test` exit 0 (no failures/skips), `BRAND_ARMED_ONLY=1 node scripts/smoke-brand.js` first failed on the foreground assertion, then passed `BRAND_ARMED_OK` against a fresh isolated Node-RED copy. `git diff --check` passed. Environment overrides are the same Node 24/Playwright/Chrome paths documented above. No production reset was attempted.

Evidence: `trial/.brand-evidence/final-reset-armed.png`, `final-defaults-armed.png`, `final-armed.json`, `final-armed-red.json`, `trial-brand-final-red.log`, `trial-brand-final-green.log`, `trial-brand-final-unit.log`. Evidence remains uncommitted. Scope: two implementation files; this private report is amended separately for root.

The fresh final `SMOKE_HOLD=1 node scripts/smoke-review.js` subsequently completed all seven integration checks and printed `SMOKE_OK` / `HOLD`; log is `trial/.brand-evidence/trial-brand-final-review-green.log`. The held harness was then terminated for cleanup; operational ports were untouched.

### Artifact receipts refreshed after final fix

On `23cc7cecf1dd503b9730e3573252e279b439649b`, reran the export in the existing temporary sibling checkout: all 54 applicable public files match current Trial bytes, and the three Web-owned transport/launcher/showcase hashes remain unchanged. Rebuilt `npm run pack`; verified all 22 manifest brand files directly inside the archive and verified packed `data/public/brand.css` matches the current adapter, SHA256 `006f6f2a75375df506d6579f1925c58e64f113168db96952ed17bdf656f84c64`. Receipts `trial/.brand-evidence/final-export.json` and `final-pack.json` explicitly record the full fix commit; the ordinary export/pack receipts are refreshed too. No services were started for this artifact refresh.
