# Foundation review — F01/F02

Verdict: approved for the scoped foundation remediation. Re-reviewed Source `3f31af9` and `b50e971` against `526d500`; all three findings below are resolved. Source canonical and both Source consumers verify at `1.0.1`, with sourceCommit `3f31af9f837a6a5f13c41f27c26154d9c24b5c83`. Lab/Trial re-export remains pending by execution sequencing; this approval does not claim cross-repo version alignment. No canonical or exported files were modified by this review.

Re-review validation: asset/contrast tests passed (4); the isolated Source build-gate regression passed (1), and canonical plus both Source consumer checks passed. The generator now handles whitespace aliases. `.mq-check` supplies a 44px minimum label target and is used in the gallery. The implementation agent reports a measured 44px gallery label; this review confirmed the CSS/markup without repeating browser measurement. No new findings in the scoped diffs.

## Original findings — resolved

1. **P2 — Source build does not verify canonical inputs against the release.** `source/package.json:38` checks only the two public copies against `packages/ui/brand/release.json`. A changed canonical `components.css` or `fonts.css` leaves both checks green, although Source is intended to import canonical CSS and Lab/Trial retain the old release. The exporter dirty-input guard does not help builds that do not invoke export. Add canonical-directory verification to the build gate so an unexported canonical change fails, and cover this case using a temporary fixture.

2. **P2 — Alias validation misses valid CSS whitespace syntax.** `source/scripts/build-brand.mjs:6` recognizes only `var(--name)` with no whitespace. Reproduced in memory: both `var( --mekoniq-unknown )` and a self-cycle `var( --mq-bg )` are accepted and serialized. CSS permits that whitespace, so these generate unresolved/cyclic values instead of rejecting them as required by F01. Parse/normalize variable references or reject unsupported value syntax before serialization; test whitespace aliases as well as the compact form.

3. **P2 — Shared checkbox fixture misses the required 44px target.** `source/packages/ui/brand/components.css:17` gives the checkbox a 24×24px box; `gallery.html:1` wraps it in an unstyled inline label, with no 44px minimum hit area or padding. F01/global constraints require targets at least 44×44px. Keep the visual checkbox size if desired, but supply a styled label/hit-area contract and use it in the gallery.

## Validation and scope

- `pnpm exec vitest run tests/unit/brand-assets.test.ts tests/unit/brand-contrast.test.ts`: 3 tests passed.
- Canonical receipt verification, Source `npm run check:brand`, and standalone Lab/Trial CLI checks: all passed, 22 payload files per directory.
- Lab/Trial `brand-check.cjs` are byte-identical to Source's implementation. Review found no additional concrete traversal/symlink/schema/byte-copy/provenance defect in the present exporter/checkers. Current artwork/font payloads and receipts verify successfully.
- Export integration tests were inspected but not run because their export calls rewrite canonical `release.json`; no canonical/consumer mutation was authorized for this review.
- Browser rendering was not rerun. The checkbox finding follows the explicit box size and absence of a label hit-area rule; no broader visual acceptance claim is made.
