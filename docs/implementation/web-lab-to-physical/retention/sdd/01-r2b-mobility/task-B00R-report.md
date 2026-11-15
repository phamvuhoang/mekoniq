# B00R — frozen R2a integration and owned native-test processes

Status: **DONE — review fix round 1 implemented, ready for scoped re-review**. Important I1 is addressed with fail-closed observation and a test-only spawn lifecycle observer; its 12 pure regressions and two requested native kill/cleanup checks pass. Current source/Lab are `d271a6c2f776d56e47ca98d1554ff1f13b594579` / `3675dcaf189928cad80ded733ac64838a593d2b2`. Frozen source/Lab ancestry and final clean runtime pin are complete. All required affected source/native checks and the documented mock-runtime touch browser checks pass. The original qualification completed at `2026-11-14T00:40:25Z` (all five pipeline steps exit 0); the controller released the hold before any native worker launched. No required B00R check remains deferred. Historical scheduling checkpoints below are preserved and superseded by the post-hold results. No subagent/reviewer was dispatched. No push, deployment, main-checkout mutation, original-process termination/restart, historical evidence rewrite, hardware action or engine upgrade occurred.

## Repository identities and frozen provenance

All mutations were confined to `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/{source,lab}` on `codex/web-lab-to-physical`.

| Repo | BASE | HEAD |
|---|---|---|
| source | `5235791218c6330c358676fe36ae0ed978be3654` | `d271a6c2f776d56e47ca98d1554ff1f13b594579` |
| Lab | `57705211a231c41e5636566a416737f6bc14faef` | `3675dcaf189928cad80ded733ac64838a593d2b2` |

Source merge commit `456384c` — `fix: integrate frozen R2a baseline and isolate native test processes` — has exact parents BASE and frozen `4f893ac6fb75dff414a3ee42a726defb7935c734`. It includes upstream `0a0d21f` arm/runtime fixes, `02d4d3f` qualification/closure documentation separation, `a8d5450` large-tree Git identity and `4f893ac` native installation-metadata exclusion. It was reviewed against original baseline `086121c73afcdb08240c393dcd87a6f1de861b58`.

Lab merge commit `e5ac57f` — `chore: integrate frozen R2a Lab fixes and pin source runtime 456384c` — has exact parents BASE and frozen `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`. This retains touch watch-mode exit commit `748be82adc650a7a080bf17a1527d1de801bf5ab`. The three UI/test paths (`src/styles/main.css`, `src/ui/workspace.ts`, `tests/e2e/twin-transport.spec.ts`) are byte-identical to frozen upstream after integration. B02b's existing navigation report engine-union compatibility and tests remain untouched.

Both worktrees were clean at BASE and are clean after commits. `git merge-base --is-ancestor` confirms the frozen source input is an ancestor; merge parent inspection confirms both exact tuples. No newer upstream commits were integrated.

## Merged semantics and conflicts

Source Git reported only `robotics/simulation-mujoco/README.md` as conflicted. Resolved its pytest command by retaining the feature's cache/bytecode flags and timeout, preserving upstream conservative geometry/unsupported drop/index wording and current B02b provider section. Reworded the stale B02a future-readiness sentence as an explicit historical Python-only boundary; current Source mobile readiness/shared capacity is now described consistently. Appended a dated B00R note and the process-selector incident to `docs/implementation/post-r2a-baseline.md`; earlier historical identity tables were not rewritten.

The overlapping gateway, arm ports and arm-port tests merged cleanly, but were inspected explicitly instead of taking either whole side:

- Readiness and create await the same serialized expired-owner cleanup; gateway close awaits in-flight cleanup.
- B02b's shared arm/mobile slot remains held through worker close, its startup-attempt checkpoint/unknown latch remains durable before create, and its mobile observation monitor still runs before cancellation/business confirmation.
- Upstream arm proxy still extends behind TCP using `gripperBackM` and the palm's xy half-diagonal radius. The fixture's conservative gripper contact assertions and geometry tests are retained.
- Optional `armPlantId` flows through scheduled and immediate fault admission; `mujoco_arm` rejects mock-custody `arm-drop` before recording or plant effects.
- Native identity excludes egg/dist-info only on native closure; portable closure still uses the strict walker. Recorder pytest disables cache; large-tree identity uses bounded Git output with the upstream buffer fix.

Lab conflicted only in the runtime lock and generated engineering/navigation headers. Before import, restored the feature's old lock from its own HEAD solely so the importer could read the previous pin. Then `import-runtime.mjs` generated the new lock from the clean merged source export and `sync-engineering-contracts.mjs` regenerated both headers from source. No artifact hashes or generated contents were invented. Final lock points to feature source HEAD, never upstream's intermediate pin.

## Test-process isolation

New focused test utility `tests/support/owned-processes.ts` establishes roots using **both** current test-process ancestry and an absolute `--bundle-root` under a registered temporary directory. Exact path boundaries and spaces are supported. Executable/module patterns only narrow already-owned targets; they do not discover kill targets. Families retain PID/start identities, PPID descendants and detached worker PGIDs so reparented Webots/supervisor/robot/arm controllers remain visible after worker loss. A stale root/group or controller PID with a new start identity is excluded. Identity and command are re-read immediately before a signal. Diagnostics include only owned directory, PID/PPID/PGID, start identity, run ID and signal; no host command tables/environment are logged.

Production topology was checked from code without native execution: `navigation2d/worker-client.ts` spawns each worker with `detached:true`; `robotics/simulation-3d/webots_worker/engine.py` spawns Webots and all controllers using `Popen` without `start_new_session`. Thus they inherit the worker group. The tracker also retains captured PPID descendants in separate groups and after reparenting. Startup and campaign observation samples while the operation is active (50 ms) and captures its final tree; run action/close boundaries capture again. Healthy-run and explicit pre-kill captures retain the complete child family used by cleanup assertions. Process-table errors fail verification rather than producing a false empty list. Defunct zombie rows are excluded as non-live processes.

Corrected global destructive selectors:

- `webots-faults.test.ts`: exact run-directory owned engine kill and worker-only kill; the captured engine/controller family must still disappear after the worker fault.
- `webots-worker.test.ts`: owned engine identity replaces executable-plus-directory pgrep.
- `tests/support/webots-arm.ts` and `webots-arm-faults.test.ts`: `killProcesses(directory, 'worker'|'engine')` replaces arbitrary host regex kill.
- `tests/support/mujoco-arm.ts` and `mujoco-arm-faults.test.ts`: `killMujocoWorkers(directory)` replaces every host MuJoCo worker kill.

Scoped cleanup helpers cover owned workers plus all descendants. Shared mission/arm helper consumers retain their assertions; standalone Webots/MuJoCo worker/program/readiness tests now register their own directories and capture before close. Webots batch wraps the campaign in observation so orphan-child checking is not reduced to checking a surviving root. Positive live-family count assertions in worker/program tests remain; no child-cleanup assertion was deleted.

Audited IR-SIM `irsim-faults`/`irsim-fleet`: kill candidates are direct children of `process.pid`, narrowed by module and before/after set, so unrelated checkouts cannot enter those target sets. IR-SIM batch's global `under(dir)` is read-only, scoped to its unique temporary output and not a kill selector; actual batch child signals use captured child objects. Recorder signals use captured spawned children/groups. Production batch fault targets already bind the run directory (`workersOf(dir)` / `enginesOf(dir)`); these were not broadened or changed. No global executable-only kill remains in the affected test helpers.

## TDD evidence

All logs are retained under adjacent `evidence-B00R/`. Node `v24.22.2`, pnpm `10.32.1`; safe source test commands additionally used `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`.

Initial ownership RED, before implementation:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/owned-processes.test.ts
```

`b00r-isolation-red.log`: **2 failed**; missing ownership class was `undefined` instead of a function. The expected behavior had no implementation. Initial GREEN (`b00r-isolation-green.log`): **2 passed** with actual generic owned/sibling Node processes, worker-only SIGKILL, surviving sibling and retained orphan child, not native engines.

The directory-with-spaces extension exposed a substantive selector failure: `b00r-isolation-spaces-red.log` has **1 failed / 4 passed**, `expected [] to deeply equal [44252]`. The initial argument parser truncated the registered directory at whitespace, so it could not find its owned root. The corrected parser reads the full bundle argument through the next option, preserving exact directory boundaries.

The operation-observation regression was also RED before sampling: `b00r-isolation-operation-red.log` has **1 failed / 5 passed**, `expected [] to include 45014`. A generic worker spawned a child and exited before returning; without active observation, the orphan was invisible. After implementing observation, the orphan remains a visible leak. Generic child cleanup is confined to PIDs/groups returned by that test's own `spawn`.

Final GREEN, same focused command: `b00r-isolation-final.log`, **6 passed**, exit 0, 964 ms. Cases cover sibling isolation with identical run IDs and similarly prefixed directories (including spaces and multiline bootstrap arguments), detached worker death/reparented live child, external ancestry rejection, separate-group PPID descendants, stale PID/PGID reuse rejection, and worker death before operation return. These are real controlled generic process tests plus deterministic table-edge tests; no native engine or unrelated robot process was started.

## Safe source verification completed

Common environment before commands:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
```

```sh
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run \
  tests/unit/owned-processes.test.ts tests/unit/xarm6-cell-dock.test.ts \
  tests/unit/arm-collision-geometry.test.ts tests/unit/native-tool-identity.test.ts \
  tests/unit/lab-regression-identity.test.ts tests/integration/sim-recorder-python.test.ts \
  tests/unit/mujoco-drive.test.ts tests/unit/bv01-mock-golden.test.ts
```

`b00r-pure.log`: **8 files / 35 tests passed**, exit 0, 15.72 s. This ran the then-current five ownership tests; the sixth operation test was added and passed in the final focused six-test command above. The recorder Python case runs only a temporary `assert 2+2==4` pytest file, no worker/engine, and confirms no bytecode/pytest cache. Mock BV01 digest and arm-trace goldens were not regenerated.

```sh
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/mujoco-arm-ports.test.ts -t mujocoProgramSet
```

`b00r-arm-geometry.log`: **3 passed / 13 intentionally filtered not_run**, exit 0. Only pure geometry ran; fake worker sessions were deferred.

```sh
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-gateway.test.ts -t 'readiness of the arm plant sets'
```

`b00r-gateway-pure.log`: **8 passed / 5 intentionally filtered not_run**, exit 0, 1.70 s. This uses engine-free HTTP doubles on ephemeral port 0; no native worker/runtime browser server starts. It covers concurrent expired/evicted owner cleanup for both GET/POST, arm-drop admission and status/readiness behavior.

```sh
perl -e 'alarm 60; exec @ARGV' pnpm contracts:check
perl -e 'alarm 120; exec @ARGV' pnpm typecheck
perl -e 'alarm 120; exec @ARGV' pnpm lint
git diff --check
git diff --cached --check
```

All final checks exit 0. Contracts: `Contract generation matches schema.` Typecheck: route generation succeeded and `tsc --noEmit` exit 0. Final lint is clean. An intermediate lint caught `no-unsafe-finally` in the observation helper; fixed by propagating the sampling error after the cleanup finally, then reran lint and the six ownership tests successfully. Final typecheck was rerun after that edit. No broad suite repeat was needed for unchanged areas; reviewed B02b evidence remains the prior evidence for untouched mobile behavior.

## Initial clean export, Lab integration and pin verification

Source committed and clean before export. No workers launched:

```sh
# source worktree
perl -e 'alarm 120; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-r2b-b00r-export-456384c-20261114
# Lab worktree; old feature lock restored from HEAD only to parse the previous pin
perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-r2b-b00r-export-456384c-20261114
perl -e 'alarm 90; exec @ARGV' node scripts/sync-engineering-contracts.mjs
perl -e 'alarm 90; exec @ARGV' pnpm check:source
perl -e 'alarm 90; exec @ARGV' pnpm typecheck
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run \
  tests/unit/twin-shell.test.ts tests/unit/twin-keys.test.ts \
  tests/unit/navigation2d-report.test.ts tests/unit/launcher-output.test.ts \
  tests/unit/mujoco-coffee.test.ts tests/unit/runtime-compatibility.test.ts
```

Export/import/sync/typecheck all exit 0. `check:source`: `Verified source 456384cc9a737083c972babcd9f92ed6a47d7510; schema 73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6; protocol 1/2; Node 24`. Lab units: **6 files / 44 tests passed**, exit 0, 724 ms. No browser/runtime/native launch. Diff and staged diff checks were clean before both commits.

| Export identity | SHA-256 / value |
|---|---|
| Directory | `/tmp/mekoniq-r2b-b00r-export-456384c-20261114` |
| sourceCommit | `456384cc9a737083c972babcd9f92ed6a47d7510`, dirty `false` |
| runtime.mjs artifact | `1bbe1cd7a1e3e8ccbca2e1ad857f6d3a0c26b325b66b104f37d9df248e78a9b8` |
| schema | `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6` |
| portable closure | `9d0bc3c05291c2dbb770dceaf41373b167c747fe43523829513de95b1653445b` |
| native closure | `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7` |

An independent byte SHA-256 calculation verified runtime.mjs equals both manifest and imported Lab lock; source commit/dirty and portable closure fields match too. Source/Lab post-commit `git status --short` are empty. Portable closure changed through the merged worker README; schemas remain B02b's. `.runtime` imports and all exports/logs stay untracked/ignored or outside repositories as prescribed.

## Initial scheduling deferral — now closed by post-hold checks

**Historical checkpoint, not the final handoff state:** all real Webots/MuJoCo/IR-SIM worker runs, worker doubles, runtime/browser checks and Python engine suites were initially **not_run, not pass**. This was the controller's explicit scheduling hold: the original checkout still has global selectors/assertions and can kill our corrected workers in the opposite direction. The initial read-only progress snapshot (retained in `evidence-B00R/original-progress-readonly.json`) showed regression, candidate-09, R1 and R1.1 passed; `r2a-candidate-02` **running** since `2026-11-14T00:31:31Z`. No original files/processes were changed, killed or restarted. No exact effects of the earlier B02b global-kill incident can be inferred from later passing logs; the incident remains recorded in the baseline note.

The controller later released this hold after the completed read-only snapshot (`evidence-B00R/original-progress-completed-readonly.json`). Actual scoped commands and results are recorded below. IR-SIM recovery was not repeated: its helper/code is unchanged by B00R and the controller explicitly directed reuse of B02b fix-round1's seven passing recovery cases. Unchanged Python worker/fixture/lock suites likewise reuse reviewed B02b evidence; no engine version or producer code changed. Selected filters below intentionally leave unrelated cases not_run, and never count them as passes. Native Linux/ROS/device/hardware gates and future full qualification remain separate.

## Self-review and concerns

Self-review inspected BASE→HEAD diffs, clean merge parents, all selectors and their caller API changes, root argument parsing and path boundaries, process-group/PPID topology, child cleanup assertions, PID/start reuse behavior, sampled startup/campaign capture and healthy pre-kill capture, diagnostics, README conflict resolution, B02b lifecycle/slot preservation, optional fault admission propagation, native-only metadata exclusion, strict portable closure, new export identities and source-generated Lab headers. No unrelated refactoring, B03 implementation or production process API was added.

Named review risks: process-table parsing/ownership traversal and native selector caller coverage; retain testing of real controller descendants after worker death. Sentinel tests and the affected real Webots/MuJoCo engine, worker-loss and controller-cleanup checks pass on this macOS host after hold release. Linux process-format/runtime behavior remains a separate unverified platform gate. Sampling is test-only and adds process-table overhead during startup/campaign, not simulation tick semantics. The required affected B00R runtime/native/browser checks are closed by the post-hold results below; future full qualification remains a separate task. Integration does **not** requalify old historical candidates or grant human acceptance; dynamics remain `not_calibrated`, no gate/acceptance status changed.

Controller owns the separately dispatched independent review. Required targeted engine/browser checks are now complete. The prior incident's exact targets remain unknowable from retained logs; this uncertainty is preserved rather than interpreted as proof that original workers were untouched.

## Changed files

source:

- `docs/implementation/post-r2a-baseline.md`
- `docs/superpowers/plans/2026-11-12-realistic-arm-web-ui/04-qualification.md`
- `packages/lab-runtime/src/v2/fault-schedule.ts`
- `packages/lab-runtime/src/v2/gateway.ts`
- `packages/lab-runtime/src/v2/models/arm-collision.ts`
- `packages/lab-runtime/src/v2/scenario-runner.ts`
- `packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports.ts`
- `robotics/simulation-mujoco/README.md`
- `scripts/native-sim/tool-identity.mjs`
- `scripts/record-sim-extension.mjs`
- `tests/integration/lab-v2-arm.test.ts`
- `tests/integration/lab-v2-bv01-sil.test.ts`
- `tests/integration/lab-v2-native-wire-deadline.test.ts`
- `tests/integration/lab-v2-sil-review.test.ts`
- `tests/integration/mujoco-arm-faults.test.ts`
- `tests/integration/mujoco-arm-gateway.test.ts`
- `tests/integration/mujoco-arm-programs.test.ts`
- `tests/integration/mujoco-arm-readiness.test.ts`
- `tests/integration/mujoco-arm-worker.test.ts`
- `tests/integration/sim-recorder-python.test.ts`
- `tests/integration/webots-arm-faults.test.ts`
- `tests/integration/webots-arm-programs.test.ts`
- `tests/integration/webots-arm-worker.test.ts`
- `tests/integration/webots-batch.test.ts`
- `tests/integration/webots-faults.test.ts`
- `tests/integration/webots-worker.test.ts`
- `tests/support/mujoco-arm.ts`
- `tests/support/owned-processes.ts`
- `tests/support/regression-identity.ts`
- `tests/support/webots-arm.ts`
- `tests/support/webots-mission.ts`
- `tests/unit/arm-collision-geometry.test.ts`
- `tests/unit/lab-regression-identity.test.ts`
- `tests/unit/mujoco-arm-ports.test.ts`
- `tests/unit/native-tool-identity.test.ts`
- `tests/unit/owned-processes.test.ts`
- `tests/unit/xarm6-cell-dock.test.ts`

lab:

- `config/source-runtime.lock.json`
- `src/shared/engineering.ts`
- `src/shared/navigation2d.ts`
- `src/styles/main.css`
- `src/ui/workspace.ts`
- `tests/e2e/twin-transport.spec.ts`


## Post-hold native validation — complete

The original scheduling context above is historical. The controller explicitly released the hold after the original pipeline completed at `2026-11-14T00:40:25Z` (all five steps exit 0). No original state/process was modified.

Completed sequentially, with the same Node/Python flags:

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/mujoco-arm-ports.test.ts tests/integration/mujoco-arm-gateway.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-worker.test.ts tests/integration/mujoco-arm-programs.test.ts tests/integration/mujoco-arm-readiness.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-faults.test.ts -t 'SIGKILL of the worker'
```

`b00r-native-mujoco-seams.log`: **5 files/50 tests passed**, no skips, 63.25s. Full arm ports16, gateway13, mobile worker8/readiness4/lifecycle9. Real MJ-FD01 tick3443 retains scene/controller/trajectory/sensor/assertion identities from B02b; real MJ-BV01 HTTP completes tick4800. All lost ACK, startup latch, observation-before-cancellation, shared-slot through close, upstream drop admission, geometry and worker-double cases pass.

`b00r-native-mujoco-cleanup.log`: **3 files/11 tests passed**, no skips, 8.04s. Real arm pick/place completes with contact grip, ARM03 pass and expected conservative gripper contacts; standalone worker/program/readiness owned cleanup checks pass.

`b00r-native-mujoco-fault.log`: **1 passed/10 intentionally filtered not_run**, 16.59s. Exact owned MuJoCo worker target logged as PID/PGID50150, run `abd8a4a5-6280-4751-9edf-da9abcc36a96`, directory `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mj-run-SVe8aw/run`. Worker-only SIGKILL yields WORKER_LOST/TRANSFER_UNKNOWN and owned process cleanup passes.

Self-review correction before Webots validation: the initial tracker returns the owned worker in addition to Webots/controllers. Two existing `>=3` positive live-process assertions must retain their original engine/controller-only meaning; otherwise the worker could mask a missing controller. They now filter engine/controller rows **after ownership**, while their post-close assertion still checks the entire owned family, including worker. This changes only two Webots test assertions/helpers; a corrective source commit/export/Lab pin follows successful focused checks. Unchanged50 MuJoCo seam tests will not be repeated for this test-only correction.

Webots focused isolation command (after the positive-count correction), exit0:

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/webots-faults.test.ts tests/integration/webots-worker.test.ts tests/integration/webots-arm-faults.test.ts tests/integration/webots-arm-worker.test.ts tests/integration/webots-arm-programs.test.ts -t 'WB05|killing Webots|SIGKILL|close leaves|after close'
```

`b00r-native-webots-isolation.log`: **5 files / 8 passed / 19 intentionally filtered not_run**, 90.72s. Covers real mid-route cancel, mission engine kill, mission worker-only kill with engine/controller cleanup, standalone engine kill, arm worker-only kill, arm engine kill, arm worker close and arm programs close. The positive live counts include engine/controllers only; the worker cannot mask a missing controller. Full owned-family post-close checks pass. Representative exact worker targets logged: arm PID/PGID53268 with run7de7ed89-82ff-4e44-a501-ee1ab0a10bea, mission PID/PGID62526 with runab824f84-91c0-43f3-8a37-8bed67d26cb1. Engine targets log their own PID plus the captured worker PGID and unique absolute run directory. No global pgrep-derived kill target was used.


Batch observation integration, after the focused fault/cleanup checks:

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/webots-batch.test.ts -t 'smoke campaign on the real Webots'
```

`b00r-native-webots-batch.log`: **1 passed / 3 intentionally filtered not_run**, exit0,148.36s. The campaign's two same-seed missions and mid-route cancel all pass, repeated poses agree within the existing tolerance, the provider remains webots_3d and the observed owned worker/engine/controller family is empty after completion.

## Touch browser investigation and final result

Initial direct static-server command (no runtime), retained transparently as a failed harness attempt:

```sh
CI=1 LAB_PW_JSON=/tmp/b00r-lab-touch-browser.json LAB_PW_OUTPUT_DIR=/tmp/b00r-lab-touch-browser \
  perl -e 'alarm 120; exec @ARGV' pnpm exec playwright test twin-transport.spec.ts --grep 'watch mode can be exited by touch'
```

`b00r-lab-touch-browser.log`/JSON: **1 failed (390px timeout30s) /1 passed (1024px)**, exit1. The failure screenshot and context show the runtime-unreachable popover covering the phone viewport/watch button, while Vite reports expected connection refusal to absent4176. Inspection confirms the workspace initially opens its runtime box when unpaired; the test's immediate conditional visibility check can race rendering/background health state. The spec header documents testing through the mock launcher. We did not change UI or loosen any touch assertion based on the standalone failure. Failure screenshot/context/JSON are retained under `evidence-B00R/static-touch-attempt/` and adjacent JSON.

The proper documented harness was then run after confirming4175/4176 free (read-only lsof; never terminated another listener):

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
unset CI NO_COLOR
export LAB_PW_JSON=/tmp/b00r-lab-touch-mock.json LAB_PW_OUTPUT_DIR=/tmp/b00r-lab-touch-mock
perl -e 'alarm 240; exec @ARGV' pnpm test:mock-e2e -- twin-transport.spec.ts
```

`b00r-lab-touch-mock.log` and `b00r-lab-touch-mock-twin-transport.json`: **7 passed,0 skipped**, exit0,12.7s. Both exact touch cases pass (390px661ms,1024px565ms), including visible44px exit, aria-pressed and restored controls. The related keyboard/live/replay/modal transport cases pass too. Launcher used final pinned sourceb05d8a7/artifactdcb380c497b4, a fresh temporary journal and only mock backends; it stopped exactly its owned runtime/UI. No product or touch-test change was needed.

## Initial review submission: corrective commits, clean export and pin

After self-review's positive-count correction passed the focused Webots tests, source corrective commit **`b05d8a713e94084a2a6eb4cffa820f3927cdb650`**, `test: preserve owned Webots engine and controller counts`, changes only three already-touched test files: two engine/controller-only positive filters with full-family post-close assertions, plus accurate ownership comments. It is a child of source merge456384c. Final scoped ESLint on those three files and full source typecheck exit0 (`b00r-corrective-lint.log`, `b00r-corrective-typecheck.log`). No production/schema/worker/fixture/physics bytes changed, so the unchanged50 passing MuJoCo seam cases and prior pure checks were not redundantly rerun.

Source was clean before exporting final HEAD; then Lab imported/synced/checked/typechecked and committed **`ee72e960566830d4a30609328c6dc8b88f7e9c44`**, `chore: pin source runtime b05d8a7`, a child of Lab mergee5ac57f. Exact commands:

```sh
# source
perl -e 'alarm 120; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-r2b-b00r-export-b05d8a7-20261114
# Lab
perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-r2b-b00r-export-b05d8a7-20261114
perl -e 'alarm 90; exec @ARGV' node scripts/sync-engineering-contracts.mjs
perl -e 'alarm 90; exec @ARGV' pnpm check:source
perl -e 'alarm 90; exec @ARGV' pnpm typecheck
```

All exit0. check:source verifies final sourceb05d8a7, schema73a81d17…, protocol1/2,Node24. No runtime launch during export/import. The browser harness subsequently exercised that exact final pin. Source and Lab final `git status --short` are empty; frozen ancestry is retained.

| Final identity | Value |
|---|---|
| source HEAD | `b05d8a713e94084a2a6eb4cffa820f3927cdb650` |
| Lab HEAD | `ee72e960566830d4a30609328c6dc8b88f7e9c44` |
| Export | `/tmp/mekoniq-r2b-b00r-export-b05d8a7-20261114` |
| manifest dirty | `false` |
| Artifact SHA-256 | `dcb380c497b45fac76bb633b1422b41875a59adbcce63a6e670639a922b784a2` |
| Schema hash | `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6` |
| Portable closure | `9d0bc3c05291c2dbb770dceaf41373b167c747fe43523829513de95b1653445b` |
| Native closure | `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7` |

The runtime byte hash, clean manifest source identity and imported Lab lock are independently compared again at final handoff. No required B00R targeted native/browser check remains pending. Source has107 distinct scoped passing cases across safe/native runs (repeated geometry/gateway/ownership checkpoints are not double-counted), Lab44 focused unit cases plus7 documented mock-browser cases pass. No new candidate was recorded or accepted; no historical qualification identity is changed. The original global-kill incident remains documented with unknown historical target identity.


## B00R review fix round 1/5 — 2026-11-14

Review: `task-B00R-review-1.md`, Important **I1 — Orphan children created between samples disappear from cleanup verification**. Source round BASE `b05d8a713e94084a2a6eb4cffa820f3927cdb650`; Lab round BASE `ee72e960566830d4a30609328c6dc8b88f7e9c44`. No other review finding is in this fix scope. Previous merge, touch, baseline, original-qualification and incident evidence above is retained unchanged.

### Verified cause and bounded correction

The old tracker deleted a remembered group whenever no previously captured member survived. A new controller created after the last sample and reparented before the next sample therefore disappeared from verification. Also, an entire short worker lifetime could fall between the 50ms samples; observing a different historical root did not prove that worker was captured. The existing180ms generic test covered neither timing case.

The correction is confined to `tests/support/owned-processes.ts` and `tests/unit/owned-processes.test.ts`; no production API/hook or runtime/physics/worker code changed.

- A remembered group with newly seen members but no known surviving identity now latches `OWNED_PROCESS_OBSERVATION_UNCERTAIN`. Those rows never enter the signal-authorized set. `processes()` and completed `observe()` fail verification instead of certifying an empty family. The uncertainty persists even if a later snapshot is empty. Reuse of a group leader with a different start identity remains excluded.
- A bounded **test-only** Node diagnostics observer sees every asynchronous ChildProcess birth in this Node executor. The `child_process` channel publishes the actual ChildProcess; its spawn event provides the PID and exact `spawnargs`. Only an exact `--bundle-root` argv element under a registered directory enters lifecycle tracking. Its birth alone grants no signal authority: positive PID/start/directory/ancestry capture and pre-signal identity revalidation remain required.
- Every matched birth must acquire its own PID/start sample. Missing sampling at spawn/exit latches uncertainty, so a whole unsampled worker lifetime fails even when another sampled root already exists. Callback errors are caught and latched; they do not escape the diagnostics subscriber. Process-table polling supplements lifecycle observation rather than substituting for it.
- Observer records use WeakRef ownership and prune dead records at dispatch. The diagnostics callback retains no scopes; per-child one-shot spawn/exit listeners last only for that child's lifecycle, and closed birth records are removed. There is no growing strong registry of scopes.
- This diagnostics event is experimental, so the helper explicitly rejects Node versions other than repository pin24.22.2. Generic short-lifetime tests prove event delivery under that pin; unsupported delivery cannot silently pass those tests by falling back to sampling.
- Scope is deliberately **asynchronous roots created in the observed Node process/executor**, not arbitrary external creators. A registered root observed under another process latches uncertainty even if a direct root was sampled. Source audit confirms the affected mission/arm providers call shared `spawnWorker` directly in this Node process. `navigation2d/batch.ts:284` calls `createFixedStepScenarioRun` directly, which uses the Webots plant and shared spawnWorker; there is no JS subprocess/fork/worker-thread worker-creator route. Thus the batch's native roots satisfy the observer precondition. An external/synchronous creator would need explicit lifecycle integration before this helper could certify complete observation; a historical sampled root is no substitute. The real batch was not repeated in this fix round, per controller scope.

Controller approved this test-only diagnostics choice after separately checking Node24.22.2's channel publication and its experimental documented status. Local builtin `internal/child_process` source and a generic Node spawn probe also confirmed delivery. No production lifecycle hook was added.

### RED/GREEN evidence

Environment for all source commands:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/owned-processes.test.ts
```

`b00r-fix1-owned-red.log`, before implementation: **3 failed /7 passed**, exit1,1.05s. Deterministic worker1001→new orphan1002 expected uncertainty but no error was thrown. The two whole-worker-lifetime operations (with/without an already sampled root) incorrectly resolved instead of rejecting. Fake process-table snapshots make these failures independent of timing; short actual Node children prove diagnostics-event delivery without any engine.

An additional external-creator regression was RED before its guard: `b00r-fix1-external-red.log`, **1 failed /10 passed**, exit1,1.12s, because a sampled direct root incorrectly certified an indirect worker.

Final GREEN, same focused unit command: `b00r-fix1-owned-green.log`, **12 passed**, exit0,1.35s. Original6 sibling/reparenting/reuse cases remain; six new cases cover newly seen orphan uncertainty, whole unobserved worker lifetime with and without a sampled historical root, reused group with no signal authority, unsupported external creator, and callback observation error latching. Uncertain/reused tests spy on process.kill and require **zero calls**; generic test cleanup uses only its own captured spawn objects/groups. No real engine is needed for these regressions.

### Requested affected native checks only

Executed sequentially after the pure checks; the original qualification had completed and its hold remained released:

```sh
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/webots-faults.test.ts -t 'WB05 killing the WORKER'
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-faults.test.ts -t 'SIGKILL of the worker'
```

`b00r-fix1-webots-kill.log`: **1 passed /6 deliberately filtered not_run**, exit0,5.52s. Owned worker PID/PGID92424, run `d3608807-994c-47e5-8481-a72cd526b05f`, unique directory `webots-faults-MvULO5`. The worker-only fault remains unknown/needs_attention, no resend, and the complete owned worker/Webots/controller family cleans up.

`b00r-fix1-mujoco-kill.log`: **1 passed /10 deliberately filtered not_run**, exit0,22.28s. Owned worker PID/PGID93269, run `d80f47c7-f132-4be3-a146-9249f130c80d`, unique directory `mj-run-naTBix/run`. It reports WORKER_LOST/TRANSFER_UNKNOWN and the owned family cleans up. Both exact targets are logged; no global worker/module selector was used.

No107-case full repeat, mobile mission repeat, batch repeat, Python engine repeat or browser repeat occurred. Their unchanged implementation evidence is reused as explicitly directed; filtered cases are not counted as passes.

```sh
perl -e 'alarm 120; exec @ARGV' pnpm typecheck
perl -e 'alarm 60; exec @ARGV' pnpm exec eslint tests/support/owned-processes.ts tests/unit/owned-processes.test.ts
git diff --check
git diff --cached --check
```

All exit0; full typecheck and scoped lint are clean (`b00r-fix1-typecheck.log`, `b00r-fix1-lint.log`). No schema/contract change, so the earlier contracts check was not repeated. Self-review checked both file diffs, exact argv admission, unsupported Node behavior, weak observer lifetime, callback error containment, independent birth proof, latched uncertainty, reused-group exclusion and the unchanged per-PID signal revalidation.

### Corrective commit, clean export and re-pin

Source HEAD **`d271a6c2f776d56e47ca98d1554ff1f13b594579`**, `fix: fail closed on incomplete native process observations`, contains only those two test files. Source was clean before export. Lab HEAD **`3675dcaf189928cad80ded733ac64838a593d2b2`**, `chore: pin source runtime d271a6c`, contains only regenerated lock plus the two source contract provenance headers; generated bodies and schema hashes remain unchanged. Both trees are clean.

```sh
# source
perl -e 'alarm 120; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-r2b-b00r-fix1-export-d271a6c-20261114
# Lab
perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-r2b-b00r-fix1-export-d271a6c-20261114
perl -e 'alarm 90; exec @ARGV' node scripts/sync-engineering-contracts.mjs
perl -e 'alarm 90; exec @ARGV' pnpm check:source
perl -e 'alarm 90; exec @ARGV' pnpm typecheck
```

All exit0 (`b00r-fix1-{export,lab-import,lab-sync,lab-source,lab-typecheck}.log`). check:source: `Verified source d271a6c2f776d56e47ca98d1554ff1f13b594579; schema 73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6; protocol 1/2; Node 24`. Export/import launched no workers.

| Current identity after review fix1 | Value |
|---|---|
| Source BASE→HEAD | `b05d8a713e94084a2a6eb4cffa820f3927cdb650` → `d271a6c2f776d56e47ca98d1554ff1f13b594579` |
| Lab BASE→HEAD | `ee72e960566830d4a30609328c6dc8b88f7e9c44` → `3675dcaf189928cad80ded733ac64838a593d2b2` |
| Export directory | `/tmp/mekoniq-r2b-b00r-fix1-export-d271a6c-20261114` |
| manifest dirty | `false` |
| Runtime artifact SHA-256 | `9e68fb4185d0c0a1f1ee49fc01eb8919ee0ef183f64f418baa3542c0592f3606` |
| Schema SHA-256 | `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6` |
| Portable closure | `9d0bc3c05291c2dbb770dceaf41373b167c747fe43523829513de95b1653445b` |
| Native closure | `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7` |

Runtime bytes/manifest/Lab lock are independently compared again at handoff. Original frozen source and Lab ancestry remains in both branches. This correction changes test verification guarantees, not qualification acceptance or physical behavior. No original checkouts, qualification state/processes, historical artifacts, deploys or hardware were changed. All logs remain under ignored evidence-B00R. I1 is implemented and targeted checks pass; controller owns scoped re-review, and this report does not claim review approval.
