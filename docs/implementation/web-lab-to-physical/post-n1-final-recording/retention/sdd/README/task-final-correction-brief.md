# One consolidated final-review correction — R2b web lab

Read this first. It is the correction task's requirements. You are the sole implementation owner for the ONE final fix wave, after the ONE integrated review. Do not spawn helpers or reviewers. Root will independently audit your report and dispatch exactly one scoped re-review of this whole fix range.

## Exact starting boundary and full findings

- Source: `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source`, branch `codex/web-lab-to-physical`, clean HEAD `907087c4f2a4d6bc1348f50177c19143d956e9d9`.
- Lab: sibling `lab`, same branch, clean HEAD `bfde031f552c4909941beae2df8a51e3af73c23d`.
- `D` means Source `.superpowers/sdd/README`.
- Read the COMPLETE `D/task-final-whole-branch-review.md`: 43,287 bytes, SHA256 `028367f2bd73fac034a28b1432e1f9177da9dffca815b0f99b5120625e25fe28`. This is the full findings list, including all four Important findings, four Minors, retained dispositions and verification limits. Root has read its entire final text. Do not act from only a summary.
- Report to `D/task-final-correction-report.md`. Create it early; append actual investigation, changes and checks as they occur. Preserve failed attempts, original outputs and receipts. Return only status, commits, short test summary, concerns and report path.
- The original full-branch package is `D/final-whole-branch-package-907087c-bfde031/` if a dependency's net history is needed. Read bounded relevant paths; do not re-review or regenerate the entire branch.

This task must address I1, I2, I3 and I4 together. No external deployment, full release acceptance or physical/native execution is implied. The user priority remains an engaging web simulation, with both hardware paths prepared. Do not reduce the requested outcome to documentation of a known web defect.

## Binding requirements and controller decisions

Read the adopted `docs/implementation/web-lab-to-physical/design/02-r2b-web-lab-spec.md` sections 6–8 and `03-contracts-and-evidence.md` for the affected contracts. Source owns mission/journal/custody and the single real physics worker. Lab renders and replays; it must never infer a custody transition from proximity or a renderer transform. Retain all VI/JA/EN strings, touch/accessibility behavior and explicit stale/unavailable states.

Relevant spec text, verbatim:

> Cốc luôn vẽ theo pose plant/replay. Chỉ interpolation giữa hai mẫu đã nhận, không extrapolation đoán cốc vẫn bám tay. Khi run/boot/revision đổi phải xóa buffer. Camera/mesh/video không tham gia tính metric.

> Performance targets là **tiêu chí đề xuất**, chưa đo: preset cell 1440×900, display frame p95 ≤ 33 ms trên máy ghi; worker+IPC tick p95 ≤ 15 ms để còn ngân sách 1×; pause tới tick cuối ≤ 500 ms tại 1× trên mạng kiểm; mỗi view đóng phải giải phóng geometry/material/listeners. 390 px dùng panel dưới và 2D fallback. Đo ít nhất 3 phút sau warm-up, ghi CPU/browser/DPR/RAM/mạng và dropped samples. Nếu không đạt thì ghi fail/giảm preset có revision; không gọi nội suy 60 FPS là physics 60 Hz.

The old “chưa đo” wording predates the recorded actual failures. Keep the actual numeric targets and main preset; no automatic downgrade, revised easier preset, frozen repaint, changed physics timestep or weakened acceptance is authorized. Report achieved rate separately from selected 1× and display interpolation.

**Prospective policy correction:** earlier recording-only R93 restrictions on changing tables/readers protected immutable evidence; they do not forbid repairing the demonstrated I3/I4 defects under a new code/checker identity. Keep all old candidates and old checker results unchanged. Do not rewrite/reseal old raw results or splice new runs into them. The new reader must be fail-closed under the corrected contract, while old R1/R1.1/R2a reader behavior remains compatible unless a separately justified dependency change is brought to root.

**I3 cloud placement:** move the existing generic `tests/security/payload.test.ts` requirement from the physical `mj-evidence` row to the existing explicit `r2b-regression` row. Preserve every existing suite ID/case/gate and preserve that cloud test as required regression; this is not permission to drop it or borrow an owned-service receipt. Correct the physics-evidence selector to the actual integration file. Genuine current cloud/container/R2a failures remain failures in their proper scope. Do not start/provision/borrow Supabase or Docker services.

**Minor disposition:** M1 negative-zero normalization, M2 PUMA oversized traces, M3 remaining native/world negative-fixture precision and M4 inherited malformed JUnit are retained nonblocking follow-ups, with their exact scopes and costs in `D/final-review-controller-dispositions.md`. Do not expand this wave into native/oracle/inherited-recorder cleanup. I3's new membership negatives MUST nevertheless be coherent and specifically semantic; do not repeat M3's weak-fixture pattern in touched checks. If an Important fix actually depends on one of these minors, explain the concrete dependency to root before broadening it.

## Correction and verification requirements

Use systematic debugging and meaningful RED/GREEN tests. Diagnose before changing implementation; an import/setup failure is not a semantic RED. Work sequentially, one hypothesis/change at a time, with focused tests while iterating and necessary broader checks once the final bytes settle. Do not blindly run the full campaign or benchmark repeatedly. If three hypotheses fail or an architectural change is needed, report the actual evidence and your proposed smallest next step to root; remain in this same wave.

### I2 — reclaim authorization

Prove expiry/revocation across held factory, held hold/grant and held persistence boundaries, for cold reopening and an existing entry. Revalidate the same current session before authorized effects and final publication. On rejection, clean up only the newly opened handle/reservation; preserve existing-entry ownership/readers/control consistency and monotonic durable epochs. Do not roll back persisted authority blindly. No worker boot or motion during reclaim. Preserve ordinary proof/contract checks and valid reclaim. Use the existing owned local gateway test harness and injected clock/barriers, not a real service or arbitrary sleeps.

### I3 — complete executed-file coverage

Implement the prospective table correction above. Validate the closed file selectors exist before costly recording. Require the actual normalized executed-file identities and per-file execution outcomes in R2b raw Vitest results, not positive aggregate counters or basename/substrings alone. Account for legitimate Source/Lab cwd layouts without workstation-specific absolute paths. Reject missing, duplicate/ambiguous, substituted/unrelated, failed or skipped required coverage appropriately. Preserve raw failed results and their diagnostic meaning.

Add a portable table-mapping regression and public-reader negatives that coherently recompute hashes/counters while omitting or substituting one required file; prove upstream integrity succeeds before the specific coverage refusal. Cover legitimate complete results and actual failed/skipped result shapes. Keep the older shared qualification policies compatible (an explicit R2b opt-in is preferable to accidental global semantic changes). Execute the corrected physical-evidence row on the changed subject with its real required inputs. The unrelated cloud row may retain the actual owned-service refusal; do not interpret that as complete qualification.

### I4 — active window and actual draw semantics

The reader currently sums only RAF slices that contain a draw and then requires that sum ≥180,000 ms; this is not active wall duration. Derive the required duration from validated active moving-world wall time, and verify actual render-stream coverage, source progression and stream coherence separately. Retain at least 180,000 ms after warm-up, actual draw p95 ≤33 ms, worker p95 ≤15 ms and pause last-step receipt bound ≤500 ms. Preserve all clock/run/action/source identity correlations. Do not trust summary booleans, use RAF as draw cadence, accept frozen redraws as movement or make missing/gapped streams qualify.

Add a coherent positive case with genuine advancing draws slower than RAF but within the 33 ms budget, and coherent negative short-window, frozen/no-progress, missing-draw and gap cases. State metric semantics explicitly in new evidence/docs. Keep original 981/d4 diagnostic numbers and old checker outcomes immutable. A successful corrected reader of a new subject is not a retroactive pass for the old 300.2 ms/2797.283 ms run.

### I1 — real web responsiveness

First inspect the actual committed-state→API→display and pause-click→admission→last-step-receipt paths. Root's retained static/IO observations are hypotheses/context, not a proven fsync cause. Relevant files start at Lab `src/ui/workspace.ts`, `src/twin/live-playback.ts`, world rendering/controller; Source `packages/lab-runtime/src/v2/gateway.ts`, scenario runner/world ports, and the actual durability/scheduling dependencies you identify.

Produce coherent world/view samples and timely rendering with a bounded received-sample buffer or similarly justified approach. Interpolate only between genuinely received committed observations; invalidate on run/boot/revision/gap and never extrapolate missing custody/world state. Timely Pause must coexist with the reviewed priority-control reservation, execution-time authority, same-action identity, lifecycle lease, durable evidence and unknown-ACK safeguards. Avoid two independently advancing reads that can never form a coherent frame. Do not bypass durability, skip physics/evidence ticks, suppress diagnostics or weaken stale-state checks for speed. If a larger persistence/protocol redesign appears necessary, give root a concrete diagnosis and design before implementing it.

Add focused meaningful tests for the actual race/cadence/lifecycle changes. Retain real authority/durability/export/close/control tests and complete affected Lab UI/replay checks; screenshots alone cannot prove state integrity. Cover camera Overview/Follow-AMR/phase-follow across the actual route in affected visual evidence, without inventing automatic camera behavior. Check VI/JA/EN and the existing 390/1024/1440 layouts if their behavior is touched. Inspect actual screenshots you capture.

## Identities, commands and process ownership

Use Node 24.22.2/pnpm 10.32.1: prepend `$HOME/.nvm/versions/node/v24.22.2/bin` to PATH. Long runs need the repository's Perl alarm bound; use owned `caffeinate` for long GUI/browser work if needed, without changing OS settings. Set `PYTHONDONTWRITEBYTECODE=1` and `PYTEST_ADDOPTS=-p no:cacheprovider` for Python tools. Follow existing repo instructions. No changes to main, trial, web, the upstream R2a workspace, ports1880/1884 or unrelated processes/services.

Use a fresh task-specific metadata/evidence directory under D and a fresh external temporary output root for raw runs. Existing `test-results`, failure artifacts, 121 published archives and all historical candidates/SDD evidence are not disposable scratch. Pass explicit output paths or use the already documented isolated exact-code layout when a launcher ignores them. Never use broad pkill/killall, git clean, or historical artifact restoration/rewriting. Inventory only owned process resources; full-host process inventories/private SQLite are not public evidence. Preserve the four prior private exclusions and original receipt/log attribution.

Record actual argv, cwd, environment changes/dependency reuse, own exit/signal, before/after Git/file identities, outputs and cleanup for every meaningful check. A process session belongs to you; collect it yourself and report settlement. Root will not consume it. Announce timing captures before starting so root can keep its own work quiet; this is coordination, not a user approval gate. No parallel physics/browser campaign or heavy hashing/build while timing.

Commit the settled Source code in this feature branch; export it through the real public exporter, import/re-pin Lab and regenerate engineering contracts through their normal scripts, then run `pnpm check:source`. Do not fabricate lock hashes or patch generated shared mirrors by hand. Preserve native/portable/schema distinctions; the Lab lock has no nativeClosureHash field. Lab changes need a new exact commit and production build. Record every intermediate commit/failed check honestly; do not amend away a failed producer identity.

At final correction bytes, run the applicable required Source contract/type/lint/build checks and relevant suites, and Lab typecheck/unit/build/pin checks. Full owned-service CI is still unavailable and must not be advertised. Run each appropriate check once after final changes, repeating only if new changes/failures justify it. Relevant existing security/authority/durability tests matter more than raw suite totals.

After a clean new Source/Lab tuple and build are frozen, run the normal exported-runtime production entry with its original full duration (185,000 ms active and 5,000 ms warm-up), correct I4 reader, same-build closed production browser and required strict replay/story scopes. Preserve raw correlation/worker/draw/pose/export/cleanup records and actual screenshots. Use the reviewed current finite HTTP observer/release code. If a new measurement still fails, preserve it and diagnose that actual failure before another changed-subject attempt; never report a successful command exit as passing targets. Keep freeze/commit/build/pin identities exact.

Full cross-release re-recording (mock→IR→R1→R1.1→genuine partial R2a→full R2b and prepared R3) is a dependent follow-up AFTER this correction's scoped review, using the new exact tuple and all existing genuine-partial/service/native boundaries. Do not repeat that entire expensive chain while fixes are still under review. This task does require the focused changed qualification/reader and genuine production proofs above; it is not merely a static implementation handoff. Root will keep the overall user task active through required final evidence/retention.

## Final report and handoff

For I1–I4 give the root cause, actual patch, RED command/output, GREEN command/output, changed files and remaining limits. Include complete receipts/results as file references with bytes/hashes, not only prose pass counts. Include the exact final commits/trees/runtime/schema/portable/native/checker/build identities, full own cleanup state and remaining process sessions. Map all four Minors and every relevant Cannot-verify item to the existing explicit disposition without silently closing them.

Self-review the entire 907087c..new Source and bfde031..new Lab ranges. Confirm no old evidence/qualification statuses changed. Do not spawn review, merge, push, deploy, provision services, unlock the host, change power settings, send external messages, spend money, sign acceptance, move hardware or delete SDD. Root will review the complete report and the whole fix range, then obtain ONE scoped re-review; there is no second broad review or another final fix wave.
