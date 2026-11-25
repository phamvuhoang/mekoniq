# S01–S02 Source implementation report

Status: web implementation and local browser verification complete; native device acceptance remains `blocked_external`.

## Changes

- Cloud: canonical token/font/component imports at the root, scoped dark styles across public/login, eight authenticated admin routes and three guest routes; original responsive PNG/SVG artwork, slogan, local favicon, current navigation, named keyboard-scroll table regions, readable status/error/draft states, secondary/destructive/disabled controls, autofill and print styles. Existing auth guards, endpoints, permission conditions, state and payloads remain intact.
- Tablet: canonical imports with semantic aliases across every routed surface, responsive original artwork, 56px controls, dark fields/cards/offline states, print ink overrides, local fonts and enrollment presentation. Native transport, DOM helper interfaces, feature/permission guards, language key, polling interval and retry map remain intact.
- Both app build scripts run their own `check:brand` before compilation, including filtered Vercel builds. The check validates the canonical directory and the app public copy against the canonical receipt. A temporary-copy regression corrupts both canonical and app files and confirms rejection.
- The route sweep found inventory report tables overflowing at 800px and cash adjustment selects without accessible names after cash journeys populated shifts. These are fixed with a named keyboard-scroll region and localized ARIA labels.

## Verification

Node 24.22.2 was selected via `/Users/hoangpham/.nvm/versions/node/v24.22.2/bin`.

| Command | Result | Evidence under `source/.lab/brand-ui/` |
|---|---|---|
| `pnpm test:e2e tablet-brand cloud-brand` before UI edits | Both tests failed on missing dark body background | Initial terminal red evidence; original Cloud transparent body, Tablet transparent body over light root |
| `pnpm contracts:check` | Passed | `source-contracts.log` |
| `pnpm test:unit` | 137 passed, 28 files | `source-unit.log` |
| `pnpm typecheck` | Passed | `source-typecheck.log` |
| `pnpm lint` | Passed | `source-lint.log` |
| `pnpm build` | Passed; includes app-level receipt checks and Capacitor sync | `source-build.log` |
| `pnpm test:e2e` | 34 passed, one physical pilot skipped; 35 total | `source-final-e2e.log` |
| `pnpm test:e2e cloud-brand tablet-brand` | 5 passed, including enrollment and polling focus | `source-brand-e2e.log` |
| `pnpm test:e2e cloud-brand guest-table cloud-catalog` after final guest-logo/favicon polish | 4 passed | `source-cloud-final-e2e.log` |
| `pnpm test:unit brand-app-build` | Passed; both app checks reject canonical and public-copy drift | `source-app-build-guard.log` |
| `ANDROID_HOME=/Users/hoangpham/Library/Android/sdk pnpm --filter @mekoniq/tablet-android android:build` | Debug APK built successfully | `source-android-build.log`, `source-final/android-build.json` |

Browser coverage includes real local Supabase sign-in and an actor without configuration permission, all eight admin routes, durable pending menu publication without replacing applied prices, signed guest submission without duplicate orders, full POS/refund/reconciliation/reporting journeys, device acknowledgement distinctions, restaurant/preset/service-model routes, offline notices, keyboard focus retained with a live polling snapshot, 40px compact artwork, local font loading, reduced-motion mode, disabled actions and print colors. New brand tests collect page errors and hydration mismatch console errors; none were recorded.

Axe 4.14.0 runs WCAG 2 A/AA, WCAG 2.1 AA and WCAG 2.2 AA tags against rendered surfaces, with serious/critical assertions. All 43 retained reports have zero violations of any severity for those tags. This is automated browser coverage, not a claim of complete accessibility certification.

## Visual evidence

`source/.lab/brand-ui/source-final/` contains 129 route matrix screenshots: 13 Cloud routes and 30 Tablet routes at widths 390, 800 and 1280. Tablet screenshots use kiosk and robot-display actors for those device routes. 7 additional captures show login failure, enrollment, offline/local acknowledgement, a focused unsent draft, pending catalog publication and a guest request with an unknown restaurant acknowledgement. `index.json` identifies the final selected files and commit IDs; older exploratory screenshots are not part of that manifest.

## Limits and resolved harness issues

- Native APK compilation and bundled font entries are verified. `adb devices` lists no connected devices. Enrolled WebView/tablet-pair, LAN/offline persistence, hardware robot and supervised pilot checks remain `blocked_external`; browser fixtures do not close those gates. The existing physical pilot test stays skipped for that reason.
- The first Android attempt lacked SDK configuration; setting the existing local SDK through `ANDROID_HOME` resolved it without committing local SDK paths.
- Test-only corrections scoped the login alert away from Next's route announcer, selected the first of two existing offline notices, checked print metadata that actually exists on DeviceStatus, waited for responsive image selection, and reused the existing fixture for focus testing so the coordinator's 16-lab cap remains unchanged. No production behavior was changed to satisfy tests.
- No deployment, push, main merge, runtime pin/schema change or native launcher icon/splash change was performed. Unrelated presentation artifacts were left untouched.

## Commits

- S01 Cloud: `af7505cf912e12acfa6f033a8d6c7ab235200d86` — `feat(ui): apply MEKONIQ dark theme to Cloud`
- S02 Tablet: `d9ebd82ae91da1d2cb80fb7d1bdd72f8df99d556` — `feat(ui): align Tablet surfaces with MEKONIQ brand`


## Review follow-up — `8a52cb6d2d2c5b1a46199642699775caf704b21a`

Addressed the P2 in `S01-S02-review.md`: Tablet's populated unpaid-bill Void and requested/confirmed booking Cancel actions now pass the existing `danger` class. Their command closures, permissions, payloads and expected versions are unchanged. Ordinary text links use Aqua and underline; main navigation and management links retain their existing green/current-state treatment.

Added `tablet-destructive-brand.spec.ts`. It creates a real unpaid prepared bill and requested booking using the coordinator fixture, checks danger foreground/border and a non-primary background in default/hover states, verifies keyboard focus, holds each actual cancellation request to test native disabled styling, then releases it and verifies accepted original command identities/reasons plus persisted `voided`/`cancelled` snapshots. A plain DOM anchor checks the text-link adapter without adding product navigation; existing navigation links are also checked.

Fresh follow-up verification:

- Red: `pnpm test:e2e tablet-destructive-brand` — 2 tests failed for the original green cancellation/link styling, after correcting fixture setup/locators. Evidence: `source/.lab/brand-ui/source-review-red.log`.
- Green: `pnpm test:e2e tablet-destructive-brand cash-print full-pos device-status` — 8 passed. Evidence: `source/.lab/brand-ui/source-review-green.log`.
- `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build` — all passed; logs are `source/.lab/brand-ui/source-review-{contracts,typecheck,lint,build}.log`. The build includes app-local brand checks and Capacitor sync. Contracts were not edited.
- Full browser/unit and APK counts above remain the prior S01/S02 evidence; those entire suites/APK compilation were not repeated for this scoped follow-up. Native device/hardware gates remain `blocked_external`.

Two populated-state screenshots and their hashes are recorded in `source/.lab/brand-ui/source-final/review-fix.json`; they supplement the original matrix manifest. Commit: `8a52cb6d2d2c5b1a46199642699775caf704b21a` — `fix(ui): preserve destructive Tablet cancellation states`. No deployment/push/merge was performed; unrelated artifacts remain untouched.
