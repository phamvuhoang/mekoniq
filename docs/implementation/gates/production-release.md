# Production release gate

**Status: not accepted.** `node scripts/verify-release.mjs` on a production manifest fails today, and it must: the evidence below does not exist yet. Local software verification of every module is recorded in `docs/implementation/evidence/` and `docs/implementation/verification.md`; it is not a substitute.

| Gate | Needed | State |
|---|---|---|
| CI (contracts, typecheck, lint, build, unit, contracts, integration, security, bundle scan) | green on the release commit | runs locally; the hosted workflow has never executed |
| Free functional acceptance on a hosted Supabase Free project | report in `evidence/` | `not_verified` |
| Free capacity on a hosted project | provider readings, 70 %/85 % | `not_verified` (local projection only) |
| Production recovery drill (RPO ≤ 5 min, RTO ≤ 30 min) | drill report | `not_verified` |
| Gate A (physical tablets/AP, 24 h soak) | `pnpm test:acceptance -- continuity` with device evidence | `not_accepted` |
| Gate B (supervised robot, signed commissioning, venue acceptance) | `venue_approved` profile | blocked_external |
| Providers selected for the release (payment, e-invoice, channels) | W10 evidence per profile | no provider selected; emulators only |
| Signed APK, Vercel commercial plan, secrets, protected environment | manifest fields | not provisioned |
| Customer UAT and the first live shift | `first-shift.md` results | not performed |
| Single-dispatcher cutover per robot | `cutover.md` executed | enforced in software, not executed |

The full row-by-row inventory is `D-full-scope.md` (generated). The program is complete only when `node scripts/verify-completion.mjs` exits 0.
