# B05 task review

## Spec Compliance

❌ Issues found. The shared-world implementation and production physical gate meet the main B05 scope, but two recorder failure paths violate the required accurate advanced-gap/readable-prefix behavior. B06 Source-correlated custody/served2/fault workflows and B07 cell UI are correctly deferred; they are not findings here.

**Task quality: Needs fixes.** Both findings are Important, not Critical: the runner remains terminal and does not retry physics, but its durable failure evidence can describe the wrong commit boundary or acquire a malformed duplicate chunk during close.

## Strengths

- `packages/lab-runtime/src/v2/simulation3d/world-step.ts:4` implements prepare → one step → durable append → commit. `packages/lab-runtime/src/v2/scenario-runner.ts:348` persists the exact pending command before send, advances public time only after world/coffee commit, and retains the previous public state on failure. The world branch avoids MockPlant construction/advance and recovery pose reset (`scenario-runner.ts:172`, `:195`, `:228`). The failure tests exercise append, lost ACK, commit, coffee-advance and immediate Source-write boundaries (`tests/unit/world-runner.test.ts:35`).
- `packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts:28` shares the existing engine slot and waits for actual worker close before release. Its independently admitted cup bindings, private arm preparation and recipient-only removal are explicit (`:35`, `:69`, `:72`). Factory tests exercise real worker lifecycle, pending close, initial empty load and preservation of a tray cup (`tests/integration/mujoco-world-rig.test.ts:17`).
- `robotics/simulation-mujoco/mujoco_worker/compile_world.py:14` composes before model creation, preserves explicit origin contact parameters, retains the nozzle and removes only the replaced tray. `world_engine.py:22` creates one model/data pair and `:120` owns ten substeps. World lifecycle intents are checked before mutation (`session.py:250`); no weld or active handoff relocation was introduced.
- `tests/support/world-rig.ts:16` and `tests/integration/mujoco-world-rig.test.ts:40` perform the required real two-slot IPC-worker rig. The retained production inventory records ten distinct boots, 25,030 rows, 250,300 observed substeps, 150 receiver-window ticks per trial and zero arm/mobile contacts. The bounded rig is explicitly distinguished from business custody (`docs/research/mujoco-world-rig/b05/production-campaign-integrity.json:3`).
- The frozen gate is usable under the controller’s narrow completion-lifecycle permission: 38/39 frozen file hashes match; the only mismatch is the recorder, and reversing exactly the documented two completion changes reproduces gate SHA `28d652f8…e6fa3d` from final SHA `6cc7f4ca…1bcea2`. All 140 retained production summary/native-readback/manifest/chunk files match their inventory hashes. The five copied vendor/model/profile/NOTICE files match their old fixtures byte-for-byte; the 22-file world closure matches its declared hashes; generated waypoint vectors equal the direct candidate vectors. See `docs/research/mujoco-world-rig/b05/recorder-completion-fix.json:5` and `production-policy.json:1`.
- Clean Source export identity and Lab pin agree: `lab/config/source-runtime.lock.json:7`, Source `evidence-B05/export.log:3`, `:14`, and `lab-check-source.log` retain the final commit/schema/dirty:false evidence. MuJoCo remains 3.17.0; candidate acceptance remains false and dynamics remain not_calibrated.

## Important findings

### 1. Automatic flush failure records an uncommitted ACK as the logical commit horizon

**Location:** `packages/lab-runtime/src/v2/simulation3d/world-evidence.ts:69`, `:70`, and `:57`.

`append()` assigns `previous = snapshot` before its automatic `flush()`. If that flush fails, the catch derives `lastCommittedTick` and the next target from the already advanced `previous`. For an ACK at tick 1 with the caller still committed at tick 0, the recorder writes `{targetTick:2,lastCommittedTick:1,ackTick:1}`. The runner subsequently supplies the correct `{targetTick:1,lastCommittedTick:0,ackTick:1}`, but `fail()` ignores it because the recorder already has a terminal reason. Thus the durable gap contradicts the retained Source checkpoint and falsely identifies the failed interval.

**Evidence:** A bounded Node 24 in-memory fault probe transpiled the actual diff module, injected failure writing the automatic gzip chunk with `chunkTicks:2`, and observed exactly that incorrect gap both before and after the authoritative Source `fail()` call. Filesystem/admission dependencies were mocked; recorder control flow was unchanged. Existing tests cover rejection before this assignment, not this flush boundary (`tests/unit/world-evidence.test.ts:15`).

**Fix:** Preserve the pre-attempt append/commit horizon independently, use the attempted ACK tick as target, and allow the Source-owned failure boundary to remain authoritative. Add a focused automatic-flush failure regression asserting both checkpoint and manifest gap values.

### 2. Closing after a published flush failure republishes the same rows with an impossible tick range

**Location:** `packages/lab-runtime/src/v2/simulation3d/world-evidence.ts:61`, `:70`; close caller `packages/lab-runtime/src/v2/scenario-runner.ts:550`.

`flush()` advances `m` and publishes its manifest before clearing the WAL and `lines`. If WAL clearing or intent cleanup fails after publication, those rows remain in memory although the manifest already owns them. Terminal `finish()` unconditionally calls `flush()` again. It uses `m.lastTick + 1` as the start but the old `previous.tick` as the end and writes the same rows a second time. The incomplete run therefore gains malformed chunk ordering instead of preserving only its published prefix and explicit uncertainty.

**Evidence:** A second bounded in-memory probe injected failure clearing `pending.ndjson` after publishing ticks 0–1. Before finish, chunk ranges were `[[0,1]]`; after finish they were `[[0,1],[2,1]]`. The existing reader rejects that extra chunk at its order check (`world-evidence.ts:76`). This is separate from the permitted active-prefix completion fix.

**Fix:** Track publication/cleanup stages and retire published in-memory rows before fallible cleanup, or make terminal finish preserve the already published prefix without reflushing it. Add a focused failure-after-manifest-publication/close regression; assert no duplicate or reversed chunk range and that the original prefix remains readable.

## Minor retained validation noise

- `evidence-B05/source-focused-final.log:34` retains a real 60-second timeout in the legacy fake-arm placement-refusal test: 107 passed/1 failed in that invocation. `arm-refusal-followup.log:7` shows the exact case passing subsequently, and the prior suite passed. This is unresolved timing noise, not an observed functional regression and not an all-green original invocation. Keep the limitation visible; no additional campaign was run for this review.
- `evidence-B05/commit-whitespace.log:1` reports inherited NOTICE whitespace. The copied NOTICE is byte-identical to its existing licensed source; preserve those vendor bytes and describe the authored-file check separately. This does not require changing vendor text.

## Scoped checks and limits

- Reviewed the supplied Source/Lab diff packages in bounded passes, with structural JSON summaries and hash checks instead of dumping large evidence/fixture files. No Git diff/log, suite/campaign rerun, native worker launch, product edit or process cleanup occurred.
- Read existing logs for baseline golden (17), helper (7), recorder completion regression (13), real factory (2), Python world/legacy (94), production gate (10), final-reader audit, contracts/typecheck/lint and export/pin checks. Filtered/skipped cases remain not_run. The final 108-case invocation is accounted for as 107 pass/1 timeout plus a passing focused follow-up.
- Named cross-seam risks checked in unchanged code: `navigation2d/adapter.ts:75` resolves explicit Source target poses rather than stale fixture targetBindings; `scenarios/coffee.ts:101`, `:194`, `:195` confirm the direct submit/store and coffee-advance boundaries protected by the world context. These checks did not reveal another blocking defect.
- Diff-context exception: the runner hunks ended inside schedule/action/reclaim context. Read only `scenario-runner.ts:401–437` and `:464–488`, plus a focused search for remaining `this.plant` references, to rule out unguarded calls after removing world MockPlant construction. Renderer-truncated initial output was recovered in bounded ranges. Recorder code was re-extracted from the supplied diff for the isolated probes; no changed source file was reread for them. The first probe attempt lacked the VM `structuredClone` global and was corrected before obtaining results.
- ⚠️ This task review does not independently establish complete legacy IR-SIM/Webots/archive behavior or full-branch cleanliness; those require the controller’s existing baseline/final branch gates. No broad validation was repeated. Full Source custody/served2 qualification and UI remain B06/B07 scope.
- Any fix beyond the two already authorized completion-lifecycle lines needs an explicit assessment of affected evidence against the frozen policy; the prior waiver is not a blanket recorder or physical-gate waiver.
