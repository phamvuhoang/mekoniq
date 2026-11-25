# Independent runtime / Lab remediation review

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

2026-11-05. Verdict: **request changes**, two P2 integration findings below. Review compares working edits/untracked files against source `e152814` and Lab `dfa05c2`; implementers' reports and the remediation plan were read. ARM collision/profile specifics and packaging are outside this review. No implementation files were changed or staged; no fixed-port browser tests or operational services were started/stopped.

## RL01 — P2: Reclaim replaces locked inputs with catalog defaults

Location: `lab/src/ui/workspace.ts:202` (reclaim), `:217` (reset), `:95` (save evidence). Source reclaim response at `source/packages/lab-runtime/src/v2/gateway.ts:111` has the view but no locked project.

After reclaim the workspace finds a catalog preset using only `scenarioId` and assigns it to `runPreset`. That discards the original project edits, seed, and potentially backend/scenario revision. Scene rendering now uses that unrelated project. Reset/rerun then submits the catalog inputs, despite saying it uses the same locked inputs. Saving evidence pairs the reclaimed report with that unrelated project; there is no validation against `manifest.project.hash`.

Executed reproduction: actual `TwinWorkspace`, real catalog and hash implementation, runtime boundary fixture; `review-reclaim.ts` (Node 24 via source tsx). A reclaimed BV01 view/report represented width **7**, AMR speed **0.2 m/s**, seed **99**, project hash `706eed2a1262465b665a732766fe609b40c7184935b87f63de984b5784c429e9`. After clicking reclaim, `runPreset` had width **6**, speed **0.5 m/s**, seed **42**, project hash `dba27dfc48434ac4f6f430cc43a8c1b00fb5696e353edd84aff3ec91f5d4256b`. Clicking reset sent width6/speed0.5/seed42 in the new-run request. This is an actual workspace boundary reproduction, not a claim of full browser execution.

Fix: obtain original locked input data from the proof-protected runtime response (or verified persisted original inputs), and use it for scene, evidence association and new-run requests. Do not reconstruct it from scenario defaults. Reject/disable association/reset until those inputs are available and match the manifest. Regression should reclaim an edited project with a nondefault seed and verify scene, saved project hash, and reset request retain them.

## RL02 — P2: Reclaimed AMR runs expose no usable reconciliation action

Location: `lab/src/twin/coffee-cell.ts:44` (`reconcilable`), `lab/src/ui/operations-panel.ts:20`, `lab/src/ui/workspace.ts:230`.

`reconcilable` requires `attention.subjectId` to equal an entity ID for an AMR. Runtime attention names its mission in `subjectId` and its robot separately in `robotId`; reclaim's additional attention row has neither. Consequently the reclaimed run exposes no Reconcile button and recommends another run instead. The runtime supports the audit, but users cannot invoke it through the new view/reconcile UI.

Executed reproduction: actual source FD01 seed42 → start → step125 → `holdForReclaim()`, then the actual Lab `nextAction` (`review-reclaim-actions.ts`). Result:

- Status `needs_attention`; attention `STOP_REQUESTED {robotId:'amr-1', subjectId:'mission-…', commandId:'robot-command-…'}` plus `RECLAIM_RECONCILIATION_REQUIRED`.
- UI action `twin-rerun`, label **Run again with same inputs**; no reconciliation action.
- Direct source `reconcile {subjectId:'amr-1'}` succeeds and records `nativeState:'unknown'`, confirming this is missing UI routing, not unsupported backend behavior.

Fix: resolve an explicit reconciliation target from robotId / supported mission ownership as well as coffee-job IDs; use the same target for eligibility and submitted subject. A successful audit must retain unknown authority/custody, not release/re-drive the old work. Cover moving and waiting-stop reclaim through the actual workspace action boundary.

## Verified fixes and evidence limits

Executed with Node 24.22.2:

- Source: `lab-v2-runtime-review`, `lab-v2-software-gaps`, `lab-v2-mixed`, `lab-v2-stream`, `lab-human-wait`: **35 passed, 1 skipped**, 5 files, 36.86 s. The skipped measurement remains unrun.
- Lab: `workspace-replay-freshness`, `report-evidence`, `runtime-stream`, `report-human-wait`: **22 passed**, 4 files, 0.377 s.
- Two additional reproductions above used temporary scripts and actual modules; source fixture directories were cleaned.

R06/R07/R11/R12 have meaningful source regressions for idle/waiting/moving localization loss, same-tick publication and reconnect sequence, robot-pair separation, and expiry of open SSE streams. R08/R09 have actual workspace tests against synthetic historical journal snapshots and zero-new-sample freshness changes. R10 covers overlapping missions, partial confirmations, cancelled stops and single-robot availability in both copies. Source tests cover immutable project/scenario snapshots and added manifest hashes, guarded untouched-cup restoration, delay/reorder without duplicate effects, bounded pickup/interlock waits, mixed food/cup load, campaign contention, and custody retained during cancellation before return confirmation. No new defect was reproduced in those reviewed paths.

The mixed cancellation regression ends before the return confirmation; it proves retention before confirmation, not completed return disposition. The source reclaim test proves proof checks, read-only fencing, unchanged execution effects and direct audit; it did not exercise the broken UI routes above.

New browser tests (`twin-plan01.spec.ts`, `twin-inputs.spec.ts`) were reviewed but **not executed** here. Render independence compares fixed source steps driven by Playwright while actual rendering cadence / Chrome frozen lifecycle vary; it does not establish that browser-owned Auto-run continues scheduling requests while Chrome is frozen, nor claim OS-specific background throttling. The performance harness uses actual workspace/renderers with synthetic visual telemetry, clearly records emulated tablet timing, and needs final-revision rerun as the Lab report states. These checks must remain pending until root's clean exported runtime/browser integration and final performance capture complete. Hardware/Linux/human gates are unchanged.

## Scoped re-review — 12:37 local

**RL01 fixed. RL02 partially fixed; request changes remains for waiting-stop reclaim.**

The proof-protected gateway now returns cloned `lockedInput` from its own persisted record. The workspace validates input/run identity, uses the exact project/seed for scene/evidence/reset, and fails closed if inputs are absent. Reviewed tests cover width7/speed0.2/seed99, source rejection of caller replacements, and missing-input admission. No remaining RL01 defect was reproduced.

The explicit known-robot resolver fixes the moving AMR `STOP_REQUESTED` case and uses the same resolved identity in the confirmation request. However, reclaim while already waiting at load/handoff emits only `RECLAIM_RECONCILIATION_REQUIRED` without identity, so no attention row can resolve a target. Source `scenario-runner.ts` `holdForReclaim()` adds this unscoped row after `requestStop()` emits nothing for a completed navigation goal. The new test explicitly expects this row alone to be unresolvable, but the actual runtime produces exactly that case.

Executed reproduction `review-reclaim-wait.ts`: real FD01 seed42, start, step one tick at a time until its first navigation completes at tick691, then `holdForReclaim()`. View contains awaiting `load` with known `robotId:'amr-1'` and mission identity, but attention is only `{reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:691}`. Actual Lab `nextAction` still returns `twin-rerun`. Direct `reconcile {subjectId:'amr-1'}` succeeds and audits `nativeState:'completed'`. Add explicit per-active-robot identities to reclaim attention (or expose safe selectable targets derived from recorded awaiting ownership); do not infer an arbitrary robot when several exist. Cover both moving and waiting-stop reclaim through the UI action boundary.

Executed re-review validation: Lab workspace-reclaim / workspace-replay-freshness / report-human-wait / report-evidence: **21 passed**, 4 files, 0.560 s. Source full lab-v2-stream / lab-process-metrics / lab-human-wait: **19 passed, 1 skipped**, 3 files, 6.16 s.

Also inspected both new comparison implementations and cursor-filtered plantLog replay. Queue and travel durations have defined identities/populations; busy time unions accepted-to-completed intervals and declares incomplete cycles unavailable. No concrete new KPI or plantLog-filter defect was reproduced. Browser/final-pin performance gates remain outside this re-review. Optional arm-profile evidence scope omission was forwarded to root for the separate ARM integration review.

## Final scoped re-review — 12:42 local

**RL01 and RL02 are resolved. Approve the reviewed runtime/Lab remediation scope; no remaining concrete blocker found in this re-review.** This supersedes the request-changes verdict above for these two findings, not the separate ARM/packaging reviews or outstanding integration/acceptance gates.

`holdForReclaim()` now reads source robot/mission state and emits a separately identified attention row for each active mission, including when its navigation is already completed and no stop event is emitted. The generic row remains only when no active robot mission exists. Lab deduplicates resolved targets, requires explicit selection when several are available, rejects unknown/stale targets before submission, and confirms a single known target by name. The runtime audit retains its existing view/reconcile fencing and does not confirm cargo or re-drive effects.

Independently reran `review-reclaim-wait.ts` against the current code: real FD01 still arrives at tick691, but reclaim attention now carries `robotId:'amr-1'`, its mission and command. The actual Lab next action is **Reconcile**. Direct audit records `nativeState:'completed'`; the source regression additionally verifies unchanged effects and served0. Separate source and workspace regressions cover two identified AMRs and explicit target selection.

Executed final scoped checks with Node24.22.2:

- Source: lab-v2-reclaim-targets, lab-v2-runtime-review, lab-human-wait, lab-process-metrics — **14 passed**, 4 files, 4.31 s.
- Lab: workspace-reclaim, workspace-replay-freshness, twin-workspace, report-human-wait, report-replay — **39 passed**, 5 files, 0.647 s.

Rechecked source/Lab comparison copies: executable implementations are identical (only imports/comments differ). Rechecked the replay plantLog cursor filter and report projection around it; no accidental KPI/replay regression identified since the prior review. No implementation edits, staging, fixed-port services or browser claims were made by this reviewer. Final exported-runtime browser execution and performance evidence remain root-owned gates.
