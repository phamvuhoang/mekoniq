# B07b fix round 1 — scoped re-review

Verdict: **all addressed; no new Critical/Important breakage found.** I1 and I2 are ADDRESSED. No new Minor breakage was established in the supplied fix diff. This is a scoped fix review, not a replacement whole-branch review or performance acceptance.

## Scope and identity

- Reviewed the supplied complete `lab/.superpowers/sdd/02-r2b-cell-and-web/review-89b4a38..c20108c.diff`, once in bounded passes (lines 1–120, 121–230, 231–320, 321–402), including both commits and all three changed files.
- Fix base: Source `e07685d947bad36a175b930031e0997e2991799e`; Lab `89b4a38aa4b2d9244482646565cb63a598d66902`.
- Reviewed head: Source unchanged `e07685d947bad36a175b930031e0997e2991799e`; Lab `c20108c6f87c6b5dc7e034184d26bd17651b1c03` (`4a44262` + `c20108c`). Runtime artifact remains `329b5480fe52cb1ba78e85e1a072814cb8d49a2b3abb96228bf0439abedc81cb`.
- Read the dispatch, task brief including R71/R72, completed fix report and main report fix1 append. Used the dispatch/root's completed clean-head audit; did not regenerate Git scope or modify Git/index/branches.

## I1 — ADDRESSED

Both cached and fetched Report replay paths now invoke the same `startReportReplay()` boundary (`lab/src/ui/workspace.ts:651–653`, helper at `:431–434`). Before either report is entered, it aborts owned export/world work, clears the live world/view/drawing and playback history, advances generation, closes streams/ticker, clears telemetry/exact poses and cancels the interpolation RAF. The pending flag prevents world polling while the fetched-report path waits (`:187–190`); mounted replay also cannot reopen streams (`:409`). Current-generation checks discard ignored-abort responses and prior stream callbacks.

Frame selection excludes live world attachment during both pending and active replay (`:162–163`), and replay projection executes before the live-world early return (`:165–166`). The cursor projector rebuilds Source business/custody state at the requested time. Shared-cell legacy report replay explicitly removes unavailable physical arm/world-sweep/physics summaries and supplies no world, navigation, payload geometry or physical samples (`:165`). The existing shared-cell `sceneEntities()` dependency returns no physical entities without an exact world (`lab/src/twin/scene.ts:51–53`); the 3D update removes absent objects rather than retaining the preceding scene (`lab/src/viewer/twin3d.ts:341–349`). There is no invented earlier world or custody geometry. The VI/JA/EN unavailable notice links to the verified package replay flow (`workspace.ts:385`), and shared-cell report cursor step is 1 (`:355`), retaining exact H7 selection.

The fix tests cover both matching/fetched paths starting from live H7, immediate abort/history/generation invalidation, cursors 0/5/7/0, future custody exclusion, expiry beyond 500 ms, a forcibly reinserted late world, and a real ignored-abort pending observation. Actual production browser evidence exercises both accessible paths with genuine H7 reports, checks world removal before the held fetch completes, keeps cursor 0 after 550 ms, selects exact terminal 7, and restores live world after exit. Replay remains read-only; the existing request gate remains in place.

## I2 — ADDRESSED

`controlOps()` supplies current `this.view` for live policy while preserving the projected replay view (`lab/src/ui/workspace.ts:302–304`). The rendered primary action (`:315`), action recommendation (`:344`) and transport controls (`:350`) now consume that policy. The paced Pause fallback additionally requires current `runControls.live` (`:352`), preventing retained running geometry from keeping Pause available after read-only/attention/unknown transitions.

Display context still uses the retained coherent frame: queue/custody and attention context stay on `ops(f)` (`:320`, `:340`). Thus old geometry is not joined to newer business facts. Existing actual requests continue to use `this.view` and its current revision (`:479`); this patch creates no Source mutation or hardware authority route. Replay is still busy/read-only for control policy and cannot reach live mutation handling.

R72 is also addressed: live attachment now requires `world.sourceRevision === selectedView.run.runRevision` (`:163`). Within the allowed 500 ms, the old pair retains its own H/revision. After expiry, same-H/new-revision current state cannot reuse the old geometry. The new regression checks old revision 11 retained against acknowledged 12, expiry to unavailable, and restoration only with a matching revision. Existing run/boot/scene/availability admission checks remain unchanged.

Covering tests assert actual rendered primary and transport markup immediately after acknowledged Pause and Resume while the visual frame stays at its older coherent revision; they also cover current read-only, attention and unknown policy, an actual Resume request using acknowledged revision 12, and Pause ACK controls while independent report materialization remains held. The native browser workflow exercises current Pause/Resume and both report replay entries.

## New breakage from the fix

- Critical: none found.
- Important: none found.
- Minor: none established.

The diff fits R71/R72: it changes replay lifecycle/frame selection, current control policy, exact revision fallback and the new notice wrapper, plus covering tests. It does not change normal drawing cadence, Source stepping/worker pacing, measurements, schemas, runtime pin or evidence bytes.

## Checks performed and evidence inspected

This reviewer ran read-only inspection commands only: `cat`/bounded `sed`/`tail` for the dispatch, brief, reports, complete supplied diff and named dependencies; `rg -n` for dependency locations; Python JSON/log summaries; and `view_image` for the final 390 px replay screenshot. The only write is this ignored report. No tests, build, browser/runtime, native, cloud or hardware actions were rerun.

Named outside-diff dependency checks were limited to: generation-gated report/stream completion and replay exit restoration; cursor-projected custody/physical-summary handling and scene removal; current control policy/request revision. No unchanged area was reviewed as a new task.

Inspected the recorded covering commands and outputs under `/tmp/b07b-fix1`:

- `pnpm exec vitest run tests/unit/workspace-generation.test.ts -t 'cell report replay|late retained|acknowledged live|current .* policy'`: RED 7 failed/14 filtered (`boundaries-red.log`), then GREEN 7 passed/14 filtered (`boundaries-green.log`). Filtered cases are not counted as passes.
- Same file with `-t 'same-H newer|ignored-abort'`: R72 RED 1 failed/1 passed/21 filtered (`revision-red.log`); the final covering suites contain the corrected expiry and late-response cases.
- `pnpm exec vitest run tests/unit/workspace-generation.test.ts tests/unit/twin-workspace.test.ts`: 34/34 (`unit-focused3.log`, repeated final markup evidence `unit-final.log`).
- Clean-head `pnpm exec vitest run tests/unit`: 72 files, 493 passed (`unit-clean-head.log`, 5.93 s).
- `pnpm typecheck`, `pnpm check:source`, `pnpm build`: successful recorded outputs in `type-final2.log`, `check-source-final.log`, `build-mobile-final.log`. The source check confirms e07685d/schema/protocol. Existing warnings remain visible; no warning-free claim.
- Recorded production browser command: `perl -e 'alarm 200; exec @ARGV' pnpm --dir ../source exec tsx "$PWD/scripts/measure-cell-production.ts" --exported-runtime --diagnostic --duration-ms 10000 --verify-browser --out /tmp/b07b-fix1/browser-mobile-final`. This takes the affected browser workflow branch, not the 185 s measurement branch. `browser-mobile-final.log` reports 1 passed, 12.4 s test/14.2 s runner and `OWNED_CLEANUP_DONE`; JSON has expected=1, skipped=0, unexpected=0, flaky=0, errors=[] and test duration 12417 ms.
- `browser-mobile-final/build-identity.json` binds the fresh production build to clean Lab c20108c, unchanged Source e07685d/runtime artifact and Node v24.22.2. Build SHA256 is `f1b0b46ffc9d3c89767fcbf77fbfd968ff9196c4067e221a031e0f8c2bd4d8da`.

The completed fix report and main append explicitly preserve the old 185 s results solely for Source e07685d/Lab 89b4a38. No new-head long performance or ACK/UI latency measurement is claimed. Existing true-draw cadence and selected-1× pacing failures, performance acceptance/D0 and B10 final qualification stay open. That distinction is correct under R71.

## Separate nonblocking observations and deferred scope

The final `browser-mobile-final/report-replay-fetched-cursor0-390.png` shows readable, contained unavailable guidance. It also shows a header/language-looking stripe near y813–886. The supplied fix diff contains no header construction change, and the new 390 px assertions prove horizontal fit/note visibility only. There is no captured final DOM/header count that establishes the cause; neither compositor artifact nor duplicate DOM is proven. Carry this visible, unresolved observation into B10 UI qualification rather than attributing it to this fix or claiming it was validated away. The earlier separate offline one-header evidence does not resolve this live-report screenshot.

Original review1 M1 warnings remain deferred in the central index/B10. No unrelated warning cleanup or new acceptance claim is requested.

## Fix-round verdict

**I1 ADDRESSED; I2 ADDRESSED; R72 satisfied. All original scoped findings are addressed, with no new Critical/Important breakage found.** This closes the scoped fix re-review only; final performance and qualification limits above remain unchanged.
