# W00–W04 review repair verification

Date: 2026-10-31. Review base: `1713276`. Work remains on `feat/w00-w04-production-foundation` in the existing checkout. No merge, push, worktree, trial change or live robot action was performed.

The original suites passed without covering the thirteen reported failures. This repair adds targeted regressions and keeps the original Gate A limitations separate from software defects.

| Review | Fix and evidence |
| --- | --- |
| 1 | Cross-identity provisioning requires delegation and permission containment; another owner's identity is denied. [Cloud](review-fixes-cloud.md) |
| 2 | Native effect rows store/read the inner payload; migration preserves existing IDs, receipts, signatures, status and attempts. [Native](review-fixes-native.md) |
| 3 | Checkpoint TTL and live enrollment/epoch completeness gate safety transitions, not unrelated sales commits. [Native](review-fixes-native.md) |
| 4 | Cloud I/O leaves the Capacitor plugin handler; deadline/close cancellation closes native sockets. [Network](review-fixes-network.md) |
| 5 | Signed config and authority revision update atomically; UI rereads the resulting native session before stamping commands. [Native](review-fixes-native.md) |
| 6 | Local grant-return signing and verified recipient return ingestion follow distinct validation paths. [Native](review-fixes-native.md) |
| 7 | Observation filtering precedes batching; terminal intent receipts advance venue acknowledgment. [Native](review-fixes-native.md) |
| 8 | Mission cancellation/return derives onboard cargo from all allocations before releasing the robot. [Domain](review-fixes-domain.md) |
| 9 | Reconciliation binds the active persisted mission command and rejects stale challenges. [Domain](review-fixes-domain.md) |
| 10 | Amendments reject a different quote currency without writes. [Domain](review-fixes-domain.md) |
| 11 | Import apply rechecks payment references under transaction read-set CAS. [Domain](review-fixes-domain.md) |
| 12 | GC writes a terminal collected state and progresses past twenty rows. [Cloud](review-fixes-cloud.md) |
| 13 | All uncollected uploads retain reservations, including missing/rejected/expired resumable states. [Cloud](review-fixes-cloud.md) |

## Environment and migration

The additive `20261031000100_cloud_storage_reservations.sql` migration was applied transactionally to the dedicated local PostgreSQL 17 database on port 57422. Earlier migrations were not rewritten. The test helper recognizes and upgrades a pre-fix local storage schema; normal deployments use the migration ledger. Cloud regressions use real local Auth/PostgreSQL/Storage.

One combined test attempt was interrupted during severe host load (load average above 120). Supabase Auth's baseline health request also timed out, and the Kotlin compiler stalled. Those HTTP/connection timeouts and interrupted runs are not recorded as successful checks. After stopping only this task's test run, local Auth health recovered (200 in 0.073s). Final verification is serialized and Gradle uses one worker with in-process Kotlin compilation.

## Results at handoff

Production repair revision: `8f99082` (six focused fix commits after `1713276`). Later documentation records the checks below.

| Check | Actual result |
| --- | --- |
| Typecheck, ESLint, contracts generation check | Passed |
| Serialized workspace production build | Passed: Next.js, Vite, package checks and Capacitor sync |
| Unit / TypeScript contracts / Python contracts | 18 / 7 / 14 passed |
| Cloud repair regression plus existing device/storage cases | 16/16 passed against real local Auth/PostgreSQL/Storage before the runtime outage |
| Restaurant domain regression | 34/34 passed in the scoped run |
| Live safety checkpoint follow-up | 14/14 passed, independently rerun by the primary agent |
| Verified observation retry after policy advance | 10/10 passed with settlement cases; forged sources still rejected |
| Native core | 27/27 passed: Archive 2, review regressions 9, storage 12, provisioning 2, runtime queue 2 |
| Native network | Final targeted rerun 2/2 passed; one-second heartbeat/cancel and two-second EOF assertions unchanged |
| APK build | Passed: debug, unsigned release and instrumentation APKs; no device install. Release SHA-256 `2adcbcbb6f3547d041828601b523a741d162976e8fce4ca6248de0423e7d77a3`; aapt excludes debug receiver/debuggable/test-only flags |
| Full integration, post-recovery attempt | **Not green**: cloud/HTTP cases still timed out and another setup hit database connection timeout; the run was stopped |
| Continuity/browser aggregate after repairs | Not rerun to completion against this unstable runtime; earlier wave evidence remains historical |

The initial all-JVM invocation was 28/29, with a TCP fixture startup timeout. After explicitly waiting for a live stalled request, the network pair passed separately. Thus all 29 distinct JVM cases have passed in scoped runs; no clean 29/29 aggregate invocation is claimed.

The dedicated database was restarted without resetting its volume. Docker restart/start commands initially timed out; a subsequent start returned success, PostgreSQL progressed through `57P03` recovery, and `SELECT 1` succeeded. The subsequent full integration attempt still timed out in cloud/HTTP paths. Restarting only the dedicated Auth container also completed, but the final DB-backed Auth admin readiness call still did not complete within five seconds (while Auth health itself returned 200). No other Docker project was restarted. This is a current software validation limitation, separate from Gate A. Do not merge on the strength of the targeted tests alone.

The native evidence also records an unreproduced static advisory about the runtime's cached ACK level after an owner transition. It is outside the thirteen reported repairs and is not represented as fixed. A clean full regression and assessment of that advisory remain before any merge decision.

## Qualification limits

Physical tablets/AP, Doze/power/storage failure, full peer checkpoint/handoff qualification, deployment signing and the 24-hour soak remain outstanding. The network regression exercises the installed Capacitor Bridge and real local HTTPS/TCP on JVM; it does not certify Android radio behavior. Gate A stays unaccepted.


## Recheck before merge

On a stable dedicated local runtime, run `pnpm test`, `pnpm test:acceptance -- continuity --software-only` and `pnpm test:e2e`. Keep the mandatory physical/device/24-hour qualification separate. The new migration must be applied through the migration ledger on any other database; no existing migration was rewritten. No reset or volume deletion was used during this verification.
