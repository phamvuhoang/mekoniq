# B09 fix round 1 report — 2026-11-15

Status: DONE_WITH_CONCERNS; I1 and I2 implemented and ready for scoped independent re-review. No Critical or Minor finding was assigned. `accepted:false`. R76 remains in force: container image null/unbuilt; WEB05 `not_run/blocked_environment`. No new ruling, helper, Docker attempt, deploy, push, native campaign or physical motion.

## Fix and export identities

| Item | Value |
| --- | --- |
| Source FIX BASE | `f419bdc0ef522f037e4a7717374e9135fbe5fce8` |
| Lab FIX BASE | `701ad719c43572c2981a2542f4c6bbec51f656e5` |
| Source fix commit | `3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` — `fix: serialize cold reclaim and validate retained state` |
| Lab pin commit | `538ba452c81005010a479f337aab0edbad6e5159` — `chore: pin source runtime 3c917ce` |
| Clean export | `/tmp/b09-fix1-runtime-VrRq1n`, `dirty:false` |
| Runtime artifact SHA256 | `18967bcf397be1e1d43ca86fae2cdae3558be90772981c9c112b071ff54aabae` |
| Export manifest SHA256 | `196e1aebc1c56a97137c578ea5e4d08da3dded171eef2ef09705cf3ff00d753c` |
| Schema hash, unchanged | `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9` |
| Portable tools digest, unchanged | `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9` |
| Image identity | **null/unbuilt** |

Only five Source files changed: `v2/gateway.ts`, `v2/scenario-runner.ts`, and the writer, persistence and world-runner test files. Source diff is +86/-13. Lab changes only its pin and two generated source-identity headers (+4/-4). Both feature worktrees are clean. No deployment, packaging, schema, compiler, native/portable worker or physics-lock files changed in this fix.

The prior static build-context audit remains evidence for Source **f419bdc** / artifact **75beea81c09f7330a03faa14b68e3fb6db8cf0aa5dc60b3138497a1562987f91**. It was not rerun or retagged. Its fake Docker boundary never built an image. The new clean runtime export above is a separate identity, not a container artifact.

## I1 — fixed: one reservation per run ID

Replaced entry-owned queues with a run-ID queue shared by actions, writer changes, archive, expiry cleanup and reclaim. Cold reclaim reads its body first, then reserves that logical run ID, resolves the current entry and rereads the proof-protected disk metadata inside the reservation. The reservation remains held through the retained runner's hold, durable epoch publication and entry installation. Subsequent reclaims reuse the installed runner rather than replacing it. Queue tails are removed only if still the current tail for that ID.

Existing authority checks continue to reject an entry that is no longer current. Expiry cleanup now also checks that its captured entry remains current before deleting/closing it. Private proof validation precedes opening recovery; proof possession still restores only `view_reconcile`. No replacement world or motion grant was introduced.

New deterministic handler-level protocol regression starts request A with a held body, lets B cold-reclaim to epoch 1, holds B's reconcile action, then releases A's body. A must wait for the current runner's action, reuse that runner and publish epoch 2. The test asserts one construction, persisted epoch 2, previous owner's 404 and all constructed resources closed by gateway shutdown. Its finally block also owns cleanup of every test resource if an assertion fails. This is a scheduling/resource-lifetime double, not physics evidence; the existing two-session real HTTP tests remain in the same passing file.

RED `fix1-i1-red2.log`: actual observed opens **2**, asserted **1**. GREEN `fix1-i1-green.log`: 7 passed. The first attempt `fix1-i1-red.log` mistakenly omitted the required reconcile `subjectId`, leaving its test gate waiting until the 45 s test timeout; it is retained as fixture failure, not defect evidence. Correcting the fixture yielded the reproducible opens failure before production code changed. The independent review's original opens2/closes1 probe remains unchanged in `task-B09-review-1.md`.

## I2 — fixed: required retained state before resources

Explicit `reclaimOnly` now checks the retained state before constructing `Run`, Source, plants, adapters or recovery report readers, and before checkpoint persistence. This path also avoids directory creation/chmod before validation. Ordinary direct-runner creation/reopen follows its prior path.

Required checks include checkpoint version/run identity/committed tick and retained plant robot collection; coffee station/cell/arm identities and workload/session/tray collections; arm device/boot identity, nonnegative sequence/tick, six finite joint positions, gripper state and required program/modifier/trace collections; retained coffee plant identity/tick and device/cup/command/modifier/log collections. A shared world additionally needs a schema-valid retained snapshot with matching run ID and committed tick, nonempty boot ID, scene digest and admitted robot/arm presence. An absent whole checkpoint/world keeps `RECOVERY_CHECKPOINT_MISSING`; incomplete required state fails `RECOVERY_STATE_INVALID`. Both are stable HTTP 409 recovery refusals after valid proof; invalid proof still returns private404 without opening a runner or advancing the epoch.

Optional tracking/collision/physics/report coverage is not required merely because a historical checkpoint lacks it. The intact world fixture has unavailable optional coverage and still reclaims. Required arm/world state is not synthesized to fill missing data. No frozen initialization or new observation was added.

Twelve new refusal cases cover missing coffee, arm, joint state, arm boot identity, coffee plant, empty `world:{}`, absent snapshot boot/scene/run identities, mismatched committed tick and shared-world missing coffee/arm. They assert refusal, zero `SourceSession.open` calls, unchanged `run.json` and `journal.db` bytes, unchanged directory listing, and no second world factory call. Test roots are disposable. These corruption cases use real Source/checkpoint handling with mock arm or protocol-world fixtures; they do not claim malformed-state native execution.

RED `fix1-i2-red2.log`: all 12 failed, through accepted recovery or late state errors rather than the required refusal. First attempt `fix1-i2-red.log` also exposed Vitest trying to print resolved runner objects containing closed databases; the fixture was changed to return the literal `RECOVERY_ACCEPTED` on unexpected success, retaining the opened runner separately for cleanup. This improved failure reporting without changing production. GREEN `fix1-i2-green.log`: 13 passed / 23 unselected not_run, including intact world reclaim. The HTTP error-mapping test independently failed 500 versus 409 in `fix1-refusal-http-red.log`, then passed with stable codes in the full focused regression.

## Verification and exact commands

Logs are retained under `.superpowers/sdd/02-r2b-cell-and-web/evidence-B09/`. Commands ran in the existing Source worktree with `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"` (Node 24.22.2 / pnpm 10.32.1). Python-bearing tests set bytecode/cache suppression as below. No dependency was installed.

```sh
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts -t 'delayed cold reclaim'
# RED attempts: fix1-i1-red.log and fix1-i1-red2.log
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts
# First I1 GREEN: fix1-i1-green.log; final committed-head check: fix1-writer-final.log
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts tests/unit/world-runner.test.ts -t 'explicit.*reclaim refuses'
# RED attempts: fix1-i2-red.log and fix1-i2-red2.log
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts tests/unit/world-runner.test.ts -t 'explicit.*reclaim'
# GREEN: fix1-i2-green.log
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts -t 'cold recovery state refusals'
# RED: fix1-refusal-http-red.log
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts tests/security/web-replay-gateway.test.ts tests/integration/lab-runtime-persistent.test.ts tests/unit/world-runner.test.ts
# GREEN: fix1-regression.log
```

Related regression: **48 passed, 0 skipped**, 4 files, 14.37 s: writer 8, replay/public download shutdown 4, persistent runtime 13, world runner 23. This includes current-authority/expiry/transfer/private404 cases, local process exclusion/SIGKILL recovery, held public worker/download/SSE cleanup, direct world reopen regressions and the new refusal cases.

The intact **actual Darwin arm64 MuJoCo** test passed in that run (3.513 s): advance arm to tick 20, public close, exact-owned worker set empty, reopen, cold/repeated reclaim without a worker, retained arm state and scene bytes unchanged. It uses existing portable Python 3.11.15 / MuJoCo 3.17.0 and test manifest identity, not a qualification candidate. Its log explicitly prints `accepted:false` and the Mac-only scope. No B06 campaign or actual container test was rerun. The previously recorded PID identities belong only to the original run; this fix does not retag those PIDs to new execution. Local process tick20 remains mock lease/persistence evidence. Mobile runner code was unchanged, so no extra mobile campaign was needed.

Source gates:

```sh
perl -e 'alarm 300; exec @ARGV' pnpm contracts:check
perl -e 'alarm 300; exec @ARGV' pnpm lint
perl -e 'alarm 300; exec @ARGV' pnpm typecheck
```

Contracts and lint passed (`fix1-contracts.log`, `fix1-lint.log`). First typecheck failed because TypeScript no longer narrowed `body.proof` inside the asynchronous queue callback (`fix1-typecheck.log`). Captured the already-validated string in a local constant; final typecheck passed (`fix1-typecheck-final.log`). The final committed-head writer rerun passed **8/8** (`fix1-writer-final.log`) after that typing fix. It repeats the changed gateway cases only; do not add it to 48 as distinct coverage. `git diff --check` passed. No whole repository build/test or native/browser campaign is claimed for this scoped fix.

After the Source commit, clean export and Lab validation:

```sh
perl -e 'alarm 300; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/b09-fix1-runtime-VrRq1n
# In sibling Lab:
node scripts/import-runtime.mjs /tmp/b09-fix1-runtime-VrRq1n
node scripts/sync-engineering-contracts.mjs
perl -e 'alarm 300; exec @ARGV' pnpm check:source
perl -e 'alarm 300; exec @ARGV' pnpm typecheck
```

All passed: `fix1-clean-export.log`, `fix1-lab-import.log`, `fix1-lab-sync.log`, `fix1-lab-check-source.log`, `fix1-lab-typecheck.log`. `fix1-runtime-export-path.txt` records the export path. The Lab lock's artifact/schema/tool tuple matches the clean export. The full FIX BASE→HEAD Source and Lab diffs were self-reviewed; no unrelated file changed.

## Evidence preservation and remaining scope

The original main report is preserved byte-for-byte as the prefix before its dated append-only fix addendum: **21480 bytes**, SHA256 `c3635559793e64e434830b371a12409d12ee5c69003fb235c5ce5c8f044b69de`, compared with root's `pre-fix1-report.md`. Original logs, failed probes and historical recordings were not rewritten. New tests use unique temporary roots, close owned resources, and never mutate original raw archives/databases.

Both findings are addressed at their named boundaries; independent scoped re-review is pending. The unchanged qualification concern is Docker unavailability: final diagnostic still refers to owned client 60963, timeout 15.013 s, TERM exit 143, no valid server metadata. No repeat attempt/reset occurred. Actual image arm/mobile/cell compile/readiness/run, competing named-volume containers, crash-release/committed chunks, no world resume and finished replay remain B10's open WEB05 cases under R76. Public TLS/WEB06, Cloud Run, native amd64 and hardware remain unqualified; L00 must retain unresolved R2b image origin and `nativeReady:false`. All acceptance remains false.
