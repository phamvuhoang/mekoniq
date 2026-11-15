# B07b fix1 report — I1/I2

Status: DONE_WITH_CONCERNS. I1/I2/R72 are implemented and covering verification passes; scoped independent re-review is pending. No performance or physical acceptance is claimed.

## Exact base, commits and pin

- FIX BASE Source `e07685d947bad36a175b930031e0997e2991799e`, Lab `89b4a38aa4b2d9244482646565cb63a598d66902` (reviewed clean).
- Source remains exactly `e07685d947bad36a175b930031e0997e2991799e`; no runtime/schema/physics/persistence/tool bytes changed.
- Lab fixes: `4a4426286fba5d0899870944dfe587865373f114` — isolate report replay and current control policy; `c20108c6f87c6b5dc7e034184d26bd17651b1c03` — contain only the new replay-unavailable guidance on mobile and add its fit assertion.
- Final Lab `c20108c6f87c6b5dc7e034184d26bd17651b1c03`. Source pin remains artifact `329b5480fe52cb1ba78e85e1a072814cb8d49a2b3abb96228bf0439abedc81cb`, schema `6efad9fb9d30d10767ab10452eb941a0de56c67cc21f3362d76d29512202030e`, tools `375d352c7e27271e4b8560a002d1dd89c4df3564df465544f40415382d4eb91a`. No export/re-pin was needed.
- Only `lab/src/ui/workspace.ts`, `lab/tests/unit/workspace-generation.test.ts`, `lab/tests/e2e/mujoco-cell.spec.ts` changed. No helpers, push/merge/deploy/hardware or original archive/SQLite mutation.

## I1 — isolate report replay from the live terminal world

Both cached matching-report and asynchronous matching-report paths now use one `startReportReplay()` boundary. Before loading/entering either, it aborts the owned live world/export work, clears retained world/view/drawing/playback state, increments generation, clears live telemetry and active interpolation poses/RAF, closes live streams/ticker, and sets a pending-replay guard. The asynchronous branch cannot start another world poll while it waits. Existing current-generation report checks remain; late ignored-abort responses cannot restore an old world into replay. Mounted replay does not reopen live streams; exiting restores the normal live read path.

`frame()` explicitly excludes live world selection during pending/active replay and projects the report cursor before the live-world return. Shared-cell report replay does not pretend its legacy report contains the exact world stream: world/navigation/payload drawing/samples and unprojected physical arm/world-sweep/physics report summaries are unavailable. The original report is not mutated. Source business/custody state continues through the existing cursor projector; a fake future-owner fixture proves H7 terminal custody cannot appear at cursor0. `WORLD_NOT_RECORDED_IN_REPORT` explains the missing geometry in VI/JA/EN and points to export/extract/import through verified package replay. Cell report cursor step is1 so a genuine H7 terminal remains selectable. The dedicated no-runtime offline workspace is unchanged.

## I2 and R72 — current action policy, coherent retained display

A dedicated `controlOps()` supplies current `this.view` to existing `runControls`/`nextAction` for live primary/transport/action recommendations. Display `ops()` still uses the retained frame for queue/custody/attention context; newer business facts are not joined to older geometry. Replay remains read-only. Paced Pause fallback also requires current `runControls.live`, so a stale running visual cannot keep Pause available after current read-only/attention/unknown state. Actual requests continue sending the current view/revision.

R72 adds exact `world.sourceRevision === selected view.run.runRevision` to live attachment, alongside prior identity/horizon checks. Within≤500ms the wholly coherent old pair may display at its original H/revision. After expiry, a same-H/new-revision view cannot attach older geometry; it stays unavailable until a matching observation. No new revision is stamped onto old geometry.

## Regression evidence

All commands ran in the feature Lab worktree with Node24.22.2/pnpm10.32.1. New logs/artifacts are under `/tmp/b07b-fix1`; original B07b files/index remain unchanged.

- RED: `pnpm exec vitest run tests/unit/workspace-generation.test.ts -t 'cell report replay|late retained|acknowledged live|current .* policy'` —7failed,14filtered; `boundaries-red.log`. Actual failures cover missing clear/abort/generation reset, late live-world override, stale Pause/Resume and readonly/attention/unknown availability.
- Initial GREEN same filter —7passed; `boundaries-green.log`.
- R72 RED: same file `-t 'same-H newer|ignored-abort'` —1failed/1passed/21filtered; `revision-red.log`. Old geometry still attached after same-H revision expiry; the ignored-abort replay guard already passed.
- Covering suites `pnpm exec vitest run tests/unit/workspace-generation.test.ts tests/unit/twin-workspace.test.ts` —34passed; `unit-focused3.log`, final markup repeat `unit-final.log`. Tests exercise both report paths, immediate history/epoch invalidation, ignored-abort late response, cursors0/5/7 and after500ms, source/custody projection, no live cell world, exact retained H/revision, current primary/transport Pause/Resume, readonly/attention/unknown, Resume request's current revision, and Pause ACK controls while full report materialization is held.
- `pnpm typecheck` passes (`type-final2.log`). An earlier type check found the manually typed Lab report omitted the dynamic worldSweep property; an inline optional unknown deletion type corrected only this UI projection (`type.log` retained). No Source/schema change.
- `pnpm check:source` passes (`check-source-final.log`), verifies unchanged Source e07685d/schema/protocol.
- `pnpm build` passes on clean final head (`build-mobile-final.log`). No stale dist was used as final evidence.
- Final clean-head complete unit run: `pnpm exec vitest run tests/unit` —72files/493passed (`unit-clean-head.log`,5.93s). Earlier complete493pass output also retained as `unit-combined.log`.

## Actual affected production browser path

Same clean unchanged exported Source CLI + freshly built Vite UI through the existing owned harness; `--verify-browser` executes the browser workflow, not the185s timing branch:

`perl -e 'alarm 200; exec @ARGV' pnpm --dir ../source exec tsx "$PWD/scripts/measure-cell-production.ts" --exported-runtime --diagnostic --duration-ms 10000 --verify-browser --out /tmp/b07b-fix1/browser-mobile-final`

The real H7 run first exports/imports its exact verified package as before. It then pauses and loads an actual matching report; entering legacy Report replay makes no extra report GET, clears world geometry, reaches cursor0, stays there after550ms, and selects terminal7 with step1. Exit restores actual worldH7; Resume uses current controls. For the fetched-report path, an owner-authorized real Source Pause changes the current status while the old running report is cached. Only report transport is held; Source creates the real response, no response data is invented. Replay clears world immediately while waiting; releasing the owned routes loads the actual matching report and keeps cursor0/world-unavailable after550ms. Read-only replay leaves Source H unchanged. The new message also gets a390px fit assertion/screenshot. Held unit/network responses prove deterministic isolation, not performance. Existing actual Pause/Resume/stable-H/new-run portions still run. No broad B06 campaign or unrelated offline matrix rerun.

Preserved successful development attempts: `browser-attempt1.log`1pass13.4s and `browser-final.log`1pass12.3s on4a44262 before the small text-container wrapper. Final c20108c fresh-build result: **1passed12.4s** (14.2s runner), `browser-mobile-final.log`, JSON result in `browser-mobile-final/browser-result.json`; `OWNED_CLEANUP_DONE`. Production build SHA256 `f1b0b46ffc9d3c89767fcbf77fbfd968ff9196c4067e221a031e0f8c2bd4d8da`, recorded in `browser-mobile-final/build-identity.json` with final Lab c20108c and empty status, unchanged Source/runtime artifact. Screenshots: `browser-mobile-final/report-replay-matching-H7-unavailable.png`, `report-replay-fetched-cursor0-unavailable.png`, `report-replay-fetched-cursor0-390.png`. The390px case checks no document horizontal overflow and visible unavailable guidance. Final native Source run identity is retained in `live-H7-identity.json`; authentic package/manifest and browser runtime identity are adjacent. Cleanup audit confirms all observed owned PIDs gone, Source exit0 and no4175/4176listeners; browser/worker teardown used owned contexts only. Warnings about NO_COLOR/FORCE_COLOR and existing build/import/environment warnings are retained; M1 remains deferred and no warning-free claim is made.

## Performance/remaining scope (R71)

Normal live draw cadence, Source step/worker/pacing code and all Source guarantees are unchanged. Current control rendering on Pause/Resume ACK changes intentionally: old visual retention no longer delays available controls. R72 changes only stale/mismatched geometry fallback. Root R71 explicitly waived another185s for this narrow UI round; **new-head long performance/ACK/UI latency was not rerun**. Original e07685d/89b4a38 measurements remain only that exact tuple, not c20108c performance. The original true draw/pacing failures and performance acceptance/D0 remain open. B10 must measure final all-changes qualification and explicit shared clock/window anchors. No artificial redraw, reduced samples, weakened checks or redefined targets.

Root preserved original37563B report/SHA`9b96af81607bfa86c7956ac6d7939aaf48975c8d730aad1c23583cde18dfc87b` as `evidence-B07b/pre-fix1-report.md` and `pre-fix1-report-identity.json`. The main task report gets an append only; original `/tmp/b07b-evidence/final-handoff-index.json` and all raw185s artifacts are untouched. A separate fix handoff index will list new evidence/report hashes.

## Final self-review and handoff

Reviewed scoped base89b4a38→c20108c diff: replay entry/epoch/history reset, frame projection order, physical-summary absence, exact integer terminal cursor, late response guard, matching-revision attachment/expiry, current policy versus retained display context, action revision, stream restoration and localized fallback fit. No general operations policy/Source authority/cadence logic was rewritten. `git diff --check` and final Source/Lab status are clean. Final Source e07685d, Lab c20108c, pin unchanged; reports are ignored task artifacts. New evidence index `/tmp/b07b-fix1/handoff-index.json`; no prior evidence/index was overwritten. Remaining concerns are the original performance/D0/qualification work and deferred M1 warnings, not a claim that this fix round passed independent review.
