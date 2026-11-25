# S01–S02 Source review

Reviewed `b50e971..d9ebd82` (Cloud `af7505c`, Tablet `d9ebd82`) against the S01/S02 briefs and `lab/docs/specs/2026-11-06-brand-ui-unification/README.md`. Scope: source review, reported evidence inspection, and an independent targeted build-guard unit test. No servers, DB changes, deployments, or application edits.

## Finding

**P2 — Two Tablet cancellation actions acquire the primary green CTA treatment.** `source/apps/tablet-web/src/screens/Checkout.ts:54` creates “Hủy hóa đơn (chưa thu tiền) / Void bill (nothing collected)” with the default button class; `source/apps/tablet-web/src/screens/Reservations.ts:22` does the same for “Hủy đặt bàn / Cancel booking”. The new default in `source/apps/tablet-web/src/styles.css:4` assigns Motion Green (`--mq-primary`) to these controls. They therefore look like affirmative primary actions, while the POS cancel-item and Fleet cancel/stop controls correctly use `danger`. Spec §5 explicitly requires destructive states and says not to turn Stop/Cancel into green CTAs. Apply the existing `danger` class to these two destructive actions and verify with populated bill/booking fixtures. Route-only screenshots and axe do not exercise this semantic distinction.

## Verdict

**Spec: changes requested for the cancellation treatment above.** Cloud's root imports, responsive original artwork, named decorative-image links, local favicon/fonts, scoped CSS, current navigation and named scroll regions conform to the inspected requirements. Tablet retains the native transport, permission/feature guards, polling and DOM helper interfaces; its logo uses original assets and DOM creation. Status text continues to distinguish pending/unknown/confirmed outcomes, rather than relying on color. Print token overrides preserve dark ink and light backgrounds; no image filtering was introduced.

**Quality: otherwise acceptable within browser scope.** The changes are narrowly presentation-focused, with no server handler or command payload changes. App-local build guards cover filtered builds and validate both canonical and exported files. Independently ran `pnpm test:unit brand-app-build` with Node 24.22.2: 1 test passed, including both canonical and public-copy corruption rejection. The supplied report records 137 unit passes, 34 browser passes plus one hardware skip, 43 axe reports with zero violations, and a successful debug APK build; those full suites were not repeated during this read-only review. Root reviewer is handling independent browser preview.

Native device/WebView, LAN/offline persistence and hardware acceptance remain `blocked_external`; APK compilation and browser fixtures do not close them. No objection to that limitation being carried explicitly into acceptance.

Minor polish, non-blocking: Tablet ordinary links still use primary green (`styles.css:4`, `a{color:var(--accent)}`), while spec §3.2 requests Aqua with underline for text links. Set a text-link rule where applicable without changing navigation/current-state treatment.

## Final scoped rereview — `8a52cb6`

Reviewed the actual `d9ebd82..8a52cb6` delta and the supplied fix package. **The P2 finding is resolved:** both bill void and booking cancellation now pass the existing `danger` class, preserving command payloads, version guards, permission checks and handlers. The ordinary-link polish is also resolved by the Aqua/underline rule, with navigation and management-link styles preserved.

The new populated regression test creates records through actual coordinator commands, verifies destructive default/hover/focus and pending disabled appearance, checks submitted payloads, and confirms persisted `voided`/`cancelled` outcomes. Inspected `source/.lab/brand-ui/source-review-green.log`: eight targeted browser tests passed, including the new cases and existing POS/device/cash-print journeys. Also inspected the supplied successful contracts, typecheck, lint and build logs and `source-final/review-fix.json`. This rereview was read-only; those services/checks were not rerun independently.

**Final verdict: approved for S01/S02 browser implementation, with no remaining findings in the scoped delta.** Native device/WebView, LAN/offline persistence and hardware acceptance remain `blocked_external` as before; this approval does not close those gates.
