# B06 fix round1 — I1 concurrent report publication

Status: DONE_WITH_CONCERNS; I1 addressed and ready for scoped independent re-review. No new physical campaign or qualification acceptance is claimed. Evidence remains accepted:false/not_calibrated.

## Before/after heads and scope

- Source before: `c49d5bfea6087811ace89874c092d0d62001eead`. Source after: `0624b5ad4645a5a7cc655b11084f5ce8d7e79a75` — `fix: coalesce concurrent world report publication`.
- Lab before: `b11768f581cb310993123e8e3d2da3390d1fad82`. Lab after: `4fabc5a5638d78a0289f09a9af240af858e98b4b` — `chore: pin source runtime 0624b5a`.
- Branch remains `codex/web-lab-to-physical`; Source and Lab are clean. No push/deploy/merge, native engine, cloud/hardware or original checkout was used.

Only I1 changed. Production diff is in `packages/lab-runtime/src/v2/beverage/arm-plant-report.ts`: coalesce an in-flight content-addressed write by its resolved destination path. Both report callers await that publication. `finally` removes only the matching entry after success or failure; later calls still read and verify the existing file digest. Errors propagate and rejected promises are not cached. Different destinations remain independent.

The exact temp write/fsync/atomic rename/directory fsync sequence still runs through the unchanged shared `writeDurable` helper. Its fixed temporary names, recorder serialization, failure horizons and recovery behavior were not changed. Expensive report materialization stays outside the Source action queue. This is an in-process publication fix; cross-process data-root exclusion remains B09 scope. Legacy non-content-addressed publication is unchanged.

The other two changed Source files are tests: `tests/unit/world-runner.test.ts` adds a nonnative report seam and same-H/action-progress regression; `tests/unit/world-report-files.test.ts` adds retry/conflict coverage and extends different-H stability to props. No controller, step/ACK, physics, Source custody/authority, clock, schema, evidence format or valid serialized trace/props bytes changed. Lab changes are only the pin and two generated Source provenance headers.

Validated diff SHA256: `ce3280b3577a86b5c70b7e86b65fef9ba30214485b602876e5846dd09c3c0b22` (`evidence-B06/r1-fix.patch`). `r1-validation-provenance.json` records all three validated file hashes. `r1-source-commit.json` verifies those exact bytes were committed as0624b5a. Thus the pre-commit retained-copy validation is mapped to the final committed validator without relabeling its original recording.

## Deterministic RED and GREEN

Logs are in `evidence-B06/`. Commands use Node24.22.2/pnpm10.32.1 with explicit PATH.

- `r1-same-h-red.log`: two real `ScenarioRun.report()` calls capture H2 through the existing nonnative world fixture. First publication is held and the test waits until both identical destination reads return ENOENT. Old code starts two publishers; the deterministic overlap/precondition assertion fails2≠1. This does not claim our API test reproduced the reviewer’s ENOENT rename exception; that actual helper-level exception remains the review’s separate probe.
- `r1-same-h-first-green.log`:11/11 after the publication fix. The real API assertions show both same-H report promises resolve, trace AND props references are equal/readable/hash-valid at ticks0..2, and a Source step advances2→3 while publication is held. Trace and props publication are independently paused and checked, so a props-only race is covered too.
- `r1-failed-entry-cleanup-red.log`: temporarily removing entry cleanup makes the later retry reuse PUBLICATION_FAILED and fail. The mutation was restored before final checks.
- `r1-final-api-green.log`:12/12 after restoration. Failure releases in-flight entries; retry succeeds; later tampered content is refused with ARM_EVIDENCE_HASH_CONFLICT and is not overwritten. Successful writes leave no temporary report file. Different-H trace and props references remain readable and distinct; legacy ARM03 not_run is preserved.
- `r1-publication-regression-green.log`:46/46 across `world-runner`, `world-report-files`, `arm-plant-report`, `world-evidence` and `world-sweep`. This includes recorder publication/failure horizons, prefix capture/readback and full-sweep regressions.
- `r1-typecheck.log`, `r1-lint.log`: exit0. `git diff --check` was clean.

Commands:

```sh
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/world-runner.test.ts -t 'two same-H'
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/world-runner.test.ts tests/unit/world-report-files.test.ts tests/unit/arm-plant-report.test.ts tests/unit/world-evidence.test.ts tests/unit/world-sweep.test.ts
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/world-report-files.test.ts tests/unit/world-runner.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
```

## Retained nominal validation and preservation

Ruling55 permits reuse for this publication-only correction. Original Freeze04 three nominal/five fault recordings, failed diagnostics, input identities and prior reports were not rewritten or relabeled. The original recording still identifies `9f68476f784cfe58bf7eaa66969656b9e3d266f9+B06:d7360b57a8a2a424e609a84e905f52741afe625b13758153dbafc6c2ba3bd162`. Its implementation commit is6db8997; final initial package wasc49d5bf. Post-R1 validating code is0624b5a, mapped by the exact patch/file hashes above.

Verified isolated copy: `/tmp/b06-r1-retained-3ji3jz8l/run`, copied from `/tmp/mekoniq-b06-nominal-7-1iGdiu`. All82original case files and copied bytes matched their retained inventory before use. Only derived trace/props files were removed from the copy, forcing first publication. Original SQLite files were never connected; the actual Source report path opened only the isolated copy.

`/tmp/b06-r1-retained-3ji3jz8l/validate.ts` (SHAe04959fdcce60c2b85f46bdef69aa3e930537fc1929ac9539fb4cd6b9954d642) calls two actual `ScenarioRun.report()` requests concurrently, using a world-factory refusal seam. Both resolve at H10850; worldFactoryCalls=0. Each trace/props reader returns10851samples with exactly the original paths and hashes:

- Trace SHA `64f10abcdecb1fbc9bb760c7237a085a55cbb9f5751915cff9131b0f8e1be00c`.
- Props SHA `b001afaa893b5d423117492a4db7b877a8e5838ed99cd79d72307fbcea794123`.

The named full sweep rechecks10850intervals and52446native interval-contact aggregates with zero failure/unexpected contact, equal to the original geometry/native results. Prefix coverage and finalization are true on this closed copy; the original saved live report’s capture-time streamFinalized:false remains unchanged. Original run9821d890-85d2-41f0-91f8-d070ab7c222a, boot941a44c4-43aa-49c5-aae3-c34baa735609 and scene0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d are retained.

Artifacts: `r1-retained-copy-pointer.json`, the copy’s `copy-proof.json`, `summary.json`, `report-a.json`, `report-b.json`, and `r1-retained-nominal-readback.log`. Command: `perl -e 'alarm 180; exec @ARGV' pnpm exec tsx /tmp/b06-r1-retained-3ji3jz8l/validate.ts`. This is post-fix readback/publication validation, not a new native execution or historical freshness revalidation. No receipt timestamps were reset.

After validation, all82original nominal files still matched. A separate read-only rehash then confirmed all469original campaign files across the three nominal/five fault cases unchanged (`r1-validation-provenance.json`). Of the Freeze04 inventoried files, only the report publisher and its report-file test differ; the additionally changed baseline world-runner test was outside that inventory. Shared recorder, controller/worker/physics/authority inputs are unchanged. The initial full handoff report is preserved at `.superpowers/sdd/02-r2b-cell-and-web/evidence-B06/r1-original-task-B06-report.md` with SHA `3368d92f81156586af91da9fd86e2a793be777302a9f8b715b5be6b03acfb693`; the original handoff gains only an explicit R1 addendum.

## Clean export and Lab pin

Clean export: `/tmp/b06-r1-export-insr8le1`; dirty:false. Runtime artifact SHA `453e625ff76e26e9f02a7dc438a67db8627e6ce27e83b28c6962adad4bf4d7a3`; manifest SHA `97cc2d4e47094b704e945d944a6c632268dc5e28fc912136181015371c496949`; manifest65810B. SchemaHash remains `a149a3a724dc811841e976a5e0dc343c88a608b638bc451bf8eed04395d13f80`; portable tool digest remains `43c5b81d47ce5f1957714201624e1d20c9d1032b140326047fa2dcdc6c8c87f3`.

`node scripts/export-lab-runtime.mjs <export>` passed from clean Source. Lab `node scripts/import-runtime.mjs <export>`, `node scripts/sync-engineering-contracts.mjs`, bounded `pnpm check:source` and `pnpm typecheck` passed; the pin was committed, and committed `pnpm check:source` passed. Logs: `r1-export.log`, `r1-lab-import.log`, `r1-lab-sync.log`, `r1-lab-check-source.log`, `r1-lab-typecheck.log`, `r1-lab-check-source-committed.log`. Exact export/pin records are `r1-export-summary.json`, `r1-source-commit.json`, `r1-lab-commit.json`.

No R1 native campaign was run, as explicitly authorized for this filesystem-only fix. Original end-to-end pacing, broader turn-offset robustness, B07/B09/B10/native-host/hardware and calibration limitations remain unchanged. No new concern or unrelated fix was introduced; I1 is ready for scoped re-review.
