# Final whole-branch brand UI review

Reviewed Source `5c86337..8a52cb6d2d2c5b1a46199642699775caf704b21a`, Lab `357d669..c806dcc`, and Trial `6298f83..7a4a896` against the dated brand specification, verification matrix, implementation plans, task reports/reviews, ledger, and draft evidence README/release receipt. Read-only application review; this report is the only authored workspace file. No services, DB changes, deployments, or subagents were started.

## Strengths

- The independent export architecture is implemented: canonical inputs and four consumers verify at brand `1.0.1`. I independently checked all nine original artwork files against the approved specification hashes, and all 22 canonical payload files against the exact receipt input commit `3f31af9f837a6a5f13c41f27c26154d9c24b5c83`.
- Export/checker code rejects traversal, symlinks, duplicate paths, unknown target payloads and mismatched bytes. Source app builds check canonical inputs as well as exported copies; Lab and Trial checks do not require a sibling Source checkout. Runtime pins and runtime contracts remain independent of brand exports.
- The inspected production changes preserve authentication guards, command handlers/payloads, IDs, permissions, polling, native transport and physical renderer calibration. Original artwork, local fonts, dark root surfaces, readable status labels and scoped print palettes are consistently adopted.
- Source fix `8a52cb6` resolves the two previously reported cancellation treatments and ordinary text-link styling. Its new regression uses populated bill/booking state, checks default/hover/focus/in-flight disabled appearance, observes unchanged cancellation payloads and verifies persisted void/cancel outcomes. Parent reports eight targeted E2E tests and contracts/typecheck/lint/build passing; this reviewer inspected that delta rather than repeating the suites.

## Issues

### Critical

None identified in the reviewed scope.

### Important

1. **P2 — Trial armed reset confirmations have unreadable text.** Files: `trial/data/public/map.html:12` and `trial/data/public/setup.html:18`, with danger fill introduced in `trial/data/public/brand.css:204`. Both page-local `.appbar .btn` rules set the foreground to `var(--fg)` and outrank the shared `.btn.armed` foreground. The first click on map `#defaults` or setup `#reset` adds `armed`; the resulting destructive confirmation has Paper `rgb(246, 248, 244)` text on Danger `rgb(255, 170, 160)`, approximately **1.71:1** contrast. This makes the confirmation label hard to read precisely before resetting operational configuration. Independently reproduced both pages' actual CSS cascade in headless Chrome using a matching toolbar button and reduced motion, without running a service or executing either reset. Give `.appbar .btn.armed` the on-danger/Deep foreground at sufficient specificity and add a regression for both armed confirmation states, including hover. The current default-screen and enabled-primary checks do not cover these states.

### Minor

No additional actionable code finding. Draft evidence is still being finalized; its older migration-pending entries and pre-fix Source receipt must be reconciled with the final code/test scope before claiming qualification complete.

## Validation and limits

- Independently passed canonical and all four consumer receipt checks; Trial `scripts/test-brand.js` passed. Exact original-asset and receipt-commit byte checks passed.
- Independently reproduced the Trial cascade finding in Chrome. Full application suites, remote previews, APK build and operational/native checks were not rerun by this reviewer; their results are supplied evidence and task reports. Review probes used the available Node 26.3.0, while release-suite evidence records Node 24.22.2.
- Whole-range `git diff --check` in Lab/Trial reports the copied OFL license's existing trailing space. This is preserved third-party license content, not a blocking implementation defect.
- Inspected default/hidden-state CSS, semantic button variants, public/backoffice/guest markup, independent runtime/export boundaries and original asset provenance. No further concrete regression was established. This does not establish exhaustive visual or WCAG conformance.
- Browser/mock passes and APK compilation do not establish Android device/WebView persistence, real LAN/robot operations, native/hardware acceptance, full manual zoom/dialog usability, or production release. The draft release receipt correctly distinguishes these outstanding profiles and unchanged production.

## Recommendations

Apply the single Trial foreground fix with targeted armed-state coverage, then re-review only that delta. Finalize the evidence index with actual final SHAs and clearly separated browser implementation, pending acceptance and production status; do not label unavailable profiles as passed.

## Assessment

**Ready to merge? With fixes.** The brand implementation and independent packaging are sound in the inspected scope, and previous Source/Lab/Trial review fixes are present. The remaining Trial reset-confirmation contrast regression should be corrected before merge; production and native acceptance remain separate gates.

## Single scoped final re-review — Trial `23cc7ce`

Reviewed only `7a4a896..23cc7ce` for the reported armed-state finding and new breakage. The new `.appbar .btn.armed` rule has sufficient specificity and uses `--mq-on-danger`; the production delta changes no command, event, data, export or runtime behavior. The P2 is resolved. No new finding was identified in this delta.

The new targeted browser branch clicks each real confirmation once, checks the armed class and confirmation label, verifies the Deep-on-Danger colors, records zero serious/critical axe violations, and confirms that no `siteReset`/`mapReset` command was sent. `trial/.brand-evidence/final-armed.json` contains passing results for both controls. There is no separate explicit `hover()` assertion in that test; the pointer remains over the control after its click. Independently reran CSS-only Chrome probes for default and explicit hover in both page styles: all four measurements returned foreground `rgb(7, 29, 33)` and background `rgb(255, 170, 160)`. No service or reset operation was started by this reviewer.

Correction to the original finding's reach: the actual setup `#reset` is outside the app bar and was already readable; the original synthetic toolbar probe demonstrated the setup stylesheet's susceptibility, not a failing real setup reset. The actual map `#defaults` regression was reproduced in the worker's real-page test. The scoped shared guard and real setup regression are appropriate and do not warrant a second finding.

**Final verdict: Ready to merge — Yes, for the reviewed browser/static implementation scope.** No open blocking code finding remains across Source `8a52cb6`, Lab `c806dcc`, and Trial `23cc7ce`. This supersedes the initial “With fixes” verdict above. Evidence finalization, native/device qualification, manual acceptance and production authorization remain separately tracked; this approval does not mark those gates passed or authorize rollout.
