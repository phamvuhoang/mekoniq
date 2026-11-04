# W00–W04 verification record

Subsequent review repairs (13 software findings, 2026-10-31) are tracked in [review repair verification](review-repair-verification.md). This document retains the original implementation measurements.

Date: 2026-10-30. Branch: `feat/w00-w04-production-foundation`; base: `62a98bd32afabbe3e98f002bb573be6ed2b945d5`. Work stayed in the existing `source` checkout, with no worktree. `trial` and `web` remained clean on `main`.

Final implementation commit: `b04440ea7e7206c24a08fb317668f9cd925ab019`. This document and collected reports are recorded in the following evidence commit. No push, merge, hosted deployment or live robot change was performed.

Collected JSON reports retain the measuring HEAD and dirty flag. Checks ran on the reviewed working content later committed as the implementation revision above; they are not evidence of a clean earlier commit.

## Verified software

| Check | Observed result |
| --- | --- |
| Frozen pnpm install, contract generation check | Passed; generated contracts match schema |
| TypeScript, ESLint, production Next.js/Vite build + Capacitor sync | Passed |
| `pnpm test` | 14 unit + 7 TypeScript contract + 115 integration tests passed; 32 integration files |
| Python contract validation | 14 passed |
| Playwright | 6 passed, including menu/config administration, portrait role/status UI, restaurant journey and historical import |
| Continuity developer suite | 23 passed: O01–O22 behavioral checks plus registration |
| Native JVM | 17 passed, including atomic handoff receipt/state installation and peer inventory merge |
| Android instrumentation | 6 passed: identity 2, SQLite atomicity 3, Activity lifecycle 1 |
| Two API33 emulator APKs | Signed pinned TLS pairing; WAN-unavailable session/order; owner restart and duplicate receipt; disconnected transport retains local pending intent |

Commands are listed in [implementation README](README.md). Node 24.22.2, pnpm 10.32.1, PostgreSQL 17.6 in the dedicated local Supabase project; Android JDK21/Gradle8.14.3/AGP8.13.0/Kotlin2.1.20/SDK36. Local image identities are in [local-images.json](local-images.json). Dedicated AVDs were stopped after qualification; unrelated devices/services were untouched.

A concurrent review run initially collided with Next.js's one-dev-server lock. The serialized full rerun passed all 115 integration tests. This was a lab coordination failure, not a passing behavioral test. Debug managed-device fixture contamination was also corrected before the clean 6/6 instrumentation run.

## Review corrections

The final review required transactional cloud ownership/policy advancement from signed facts, native inventory installation, scoped order projections, and signed final ownership/checkpoint installation on a replacement coordinator. Durable receipts and original command identities must survive that transition; unknown external effects never replay automatically. Final cloud authority regression: 5/5 passed, including active checkpoint/original receipt export, canonical historical import reconstruction, complete peer inventory and rejection of missing metadata or unauthorized historical producers. Native regression rejects an incomplete receipt count atomically, replaces preparing ownership with verified active ownership, preserves device metadata/version progression, and returns the original duplicate receipt without appending or dispatching work. The scoped reviewer confirmed the corrections; no remaining P1 was found in that review.

Handoff packages are explicitly bounded to 1,000 entries, 10,000 snapshots and 4 MiB. Pending/gapped history, unavailable historical keys or an oversized package block provisioning. A larger-history paginated transfer is not qualified by this release; see the [recovery runbook](../operations/coordinator-recovery.md). Native checkpoint exchange is implemented but its two-peer integration is not verified.

Final unsigned release APK SHA-256: `3bd900fef67925d15693ff531ae3262012a89a6e5fd5819f5ca4c2d20333e13f`. Final Gradle JVM/debug/instrumentation/release build passed after workspace dependency installation and Capacitor asset sync. The release manifest excludes the debug receiver, `debuggable` and `testOnly`. This is a build artifact, not deployment signing or hardware approval.

## Gate A remains unaccepted

`pnpm test:acceptance -- continuity` intentionally exited 1 after all 23 software tests passed: mandatory Android O01, O02, O04, O06, O07, O08, O13, O21 and O22 evidence is not complete. Emulator TLS and one Activity pause do not establish physical Wi-Fi/AP behavior, screen-off/Doze, power-loss, device storage exhaustion, encrypted SAF recovery, peer checkpoint exchange or a real 24-hour soak. Robot execution is simulated; deployment release signing and real robot/provider qualification remain outside this result.

[Task index](../superpowers/plans/2026-10-30-plan-index.json) distinguishes local verification from mandatory external qualification. All 28 task files under [evidence](evidence/) retain their own scope and limits. W01-T05 and W04-T06 stay `blocked_external`; later waves stay `planned`. See [Gate A](gates/A-continuity.md) and the [support matrix](tablet-support-matrix.json).

## Waves 09–11 (chain, integrations, provider/protocol framework, production tooling)

Local verification on one machine (Node 26.3 here, Node 24 required by the repo; PostgreSQL 17 local Supabase): unit 48, TypeScript contracts 37 (+ `tests/contract` 48), adapters 48, providers 34, security 17, integration 463 of 464 (the one failure, `lab-runtime-artifact`, needs Node 24 and fails the same way on `main` before these waves), acceptance first-shift 6 and release-manifest 8, load-budget 3 and Free-capacity 3 (against stored artifacts), `pnpm typecheck` and `pnpm lint` clean, `pnpm build` clean.

Per task: W09-T01…T04 `verified_local`; W10-T01 `verified_local`; W10-T02…T06 and W11-T02…T05 `blocked_external` (no provider, hardware, hosted project, device or drill exists — see each evidence file); W11-T01 `verified_local` with release-blocking items listed. **Nothing is `accepted`: `node scripts/verify-completion.mjs` exits 1 and `gates/D-full-scope.md` is generated from the index.** All provider results are against our own emulators (`rig.emulated`).

An independent whole-branch review found six Important defects, fixed with tests in the closing commit: cloud-only facts (`Voucher.ReceiveEscrow/ReturnEscrow`, `ExternalOrder.*`, `Payment.RecordProvider`, `Invoice.Record`) can no longer be typed on a tablet (`CLOUD_SOURCE_REQUIRED`); provider money captured after our own expiry becomes unapplied funds (`LATE_CAPTURE`); an unknown refund is re-sent under the same id and the refund limit is re-checked inside the claim; the channel sweeper keeps reading after a decision (cancellation answers, late venue acceptance); the release workflow deploys `--prod` only for production and links the environment's own Supabase project; chain configuration is merged over a branch's own features and a refused branch is retried. The review also made the tenant sweep stricter (only 401/403/404 count) and exposed an existence oracle in `POST /v1/venues/:venueId/commands` (now scope-checked first).
