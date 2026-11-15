# Task B00R review 1

## Spec Compliance

- ❌ **Issues found:** the owned-process cleanup correction can report an empty family while an orphan controller remains alive. This misses the explicit capture-timing / short-lived-worker requirement (`source/tests/support/owned-processes.ts:43`, `:56`). See Important I1.
- ✅ The supplied source diff integrates the requested expiry cleanup, gripper-back proxy, early MuJoCo mock-drop refusal, native-only metadata exclusion, README correction, recorder cache suppression and large-tree identity fix. The Lab diff carries the touch exit and final feature pin, with generated contents unchanged except provenance headers.
- ⚠️ Exact merge-parent ancestry and current clean Git status are reported by the controller/implementer and consistent with the supplied package commit lists; they are not independently proved by a textual diff. No additional Git commands were run, as instructed. This review does not establish historical absence of interference with the original qualification.

## Strengths

- Ownership roots require both a registered absolute bundle directory with a path boundary and current test-process ancestry. The ordinary paths-with-spaces and similarly prefixed sibling case has a real sentinel test (`source/tests/support/owned-processes.ts:15`, `:26`, `:33`; `source/tests/unit/owned-processes.test.ts:25`). Module/executable filters now narrow owned candidates instead of discovering global signal targets (`source/tests/support/owned-processes.ts:63`).
- The kill path rechecks the PID/start identity and complete command immediately before signalling, preserves non-ESRCH failures, and records target diagnostics (`source/tests/support/owned-processes.ts:68`). Captured descendants in separate groups remain tracked after reparenting; stale PID/group identities are tested (`source/tests/unit/owned-processes.test.ts:60`, `:70`). This is a substantial improvement over the previous global selectors.
- The Webots positive counts still count engines/controllers only, while post-close checks cover the complete owned family (`source/tests/integration/webots-arm-worker.test.ts:111`, `:115`; `source/tests/integration/webots-arm-programs.test.ts:77`, `:80`). The campaign is observed throughout execution (`source/tests/integration/webots-batch.test.ts:53`), although I1 limits the guarantee of that observation.
- Readiness and create share serialized expired-owner cleanup, and gateway shutdown awaits the chain (`source/packages/lab-runtime/src/v2/gateway.ts:55`, `:186`, `:196`, `:273`). The added concurrent GET/POST expiry/eviction tests keep a live owner occupied and prove closure happens once (`source/tests/integration/mujoco-arm-gateway.test.ts:26`).
- The palm proxy extends behind TCP and uses the palm half-diagonal; a separate box/joint transformation verifies enclosure over the gripper range (`source/packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports.ts:45`; `source/tests/unit/xarm6-cell-dock.test.ts:70`). Optional gripper geometry preserves the omitted-field behavior (`source/packages/lab-runtime/src/v2/models/arm-collision.ts:9`).
- Scheduled and immediate MuJoCo arm-drop admission propagates the plant identity before effects, with HTTP rejection and unchanged report/revision checks (`source/packages/lab-runtime/src/v2/fault-schedule.ts:11`; `source/packages/lab-runtime/src/v2/scenario-runner.ts:94`, `:401`; `source/tests/integration/mujoco-arm-gateway.test.ts:96`). Native metadata exclusion is opt-in to nativeToolClosure; portableToolClosure keeps the strict default (`source/scripts/native-sim/tool-identity.mjs:5`, `:14`, `:18`).
- The frozen touch change retains an accessible exit, translated labels and pressed state (`lab/src/styles/main.css:2341`; `lab/src/ui/workspace.ts:349`; `lab/tests/e2e/twin-transport.spec.ts:19`). The source worker README now distinguishes the historical Python-only slice from the integrated provider (`source/robotics/simulation-mujoco/README.md:59`).

## Issues

### Critical (Must Fix)

None found.

### Important (Should Fix)

**I1 — Orphan children created between samples disappear from cleanup verification.**

Location: `source/tests/support/owned-processes.ts:39–48`, particularly line 43; sampling at line 56. Coverage gap: `source/tests/unit/owned-processes.test.ts:80–90`.

The group-retention condition requires a currently live member whose identity was captured previously. Consider a captured worker with PID/PGID 1001. Between observations it starts controller 1002 and exits. The next process table contains controller 1002, PPID 1, PGID 1001, but no worker. The controller was never in `known`, cannot pass the root/ancestry selector, and is not in `owned`. Line 43 therefore deletes the remembered group, and `processes()` returns `[]`. The caller's cleanup assertion passes with a live owned controller. A complete worker lifetime between the 50 ms samples has the same missing-observation problem. Increasing the delay or sampling frequency only narrows the window.

I reproduced the first case against the actual helper, transpiled in memory, with an injected two-snapshot table. No real worker, child process, signal or process-table command was used:

```text
sample 1: [{ pid:1001, ppid:process.pid, pgid:1001,
             started:'old', command:'python --bundle-root /tmp/owned-review/bundle' }]
captured worker: [1001]
sample 2: [{ pid:1002, ppid:1, pgid:1001,
             started:'later', command:'controller' }]
live orphan in table: [1002]
tracker result: []
```

The existing operation test waits 180 ms before killing its worker, so the child is already sampled several times. The real fault paths also explicitly capture healthy trees before injecting the fault. Those passing cases do not answer this timing case.

Fix the cleanup guarantee with stronger lifecycle/process-family observation or report uncertain observation as a verification failure instead of silently returning an empty family. Keep leak detection separate from signal authorization: **do not fix this by authorizing kills of all members of a remembered numeric PGID**, because that would defeat the reuse protection. Add a deterministic regression with a previously observed worker and a newly observed orphan, plus an operation that completes without a root sample. No real engine is needed for these regressions.

### Minor (Nice to Have)

- Historical, already resolved validation noise: the abandoned static browser attempt emitted NO_COLOR/FORCE_COLOR warnings and connection-refused errors (`source/.superpowers/sdd/01-r2b-mobility/evidence-B00R/b00r-lab-touch-browser.log:1`, `:10`). The report retains this failed attempt and uses the documented mock harness afterward; its final log has seven passing cases and no matching warning lines. This is not an additional blocking finding or a reason to repeat the browser run.

## Checks and bounded outside-diff inspection

- Read the brief/report first and reviewed both supplied diff files once in sequential sections. One oversized tool result truncated gateway/geometry context; only the missing diff interval was retrieved. No Git diff was re-derived and no repository mutation occurred beyond this ignored report. A narrow helper line-number lookup was used for I1 attribution.
- **Named risk: B02b behavior at merge seams.** Inspected the unchanged runner's startup/observation/close paths and arm-port open/close context absent from the diff: startupAttempt is persisted before create; uncertain startup becomes STARTUP_UNKNOWN; worker close precedes slot release; the mobile stop monitor runs before adapter observation/drain (`source/packages/lab-runtime/src/v2/navigation2d/runner.ts:261`, `:270`, `:275`, `:436`, `:626`; `source/packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports.ts:105`). The retained seam log reports 50 passes and includes shared-slot and false-cancellation regressions (`evidence-B00R/b00r-native-mujoco-seams.log:10`, `:12`, `:20`, `:58`).
- **Named risk: detached native topology.** Worker spawn uses detached:true and a resolved bundle argument (`source/packages/lab-runtime/src/v2/navigation2d/worker-client.ts:52`, `:55`); Webots and controller Popen calls do not start new sessions (`source/robotics/simulation-3d/webots_worker/engine.py:106`, `:175`). Thus I1's same-group orphan is consistent with the production topology.
- **Named risk: Lab B02b helper preservation.** The unchanged engine-version union still handles MuJoCo and retains existing provider gating (`lab/src/reports/navigation2d.ts:25–28`), with the B02b version cases retained (`lab/tests/unit/navigation2d-report.test.ts:143–153`). These files have no B00R diff hunks.
- **Named risk: static browser failure explanation.** The test header requires the mock launcher (`lab/tests/e2e/twin-transport.spec.ts:3`), while workspace initialization opens runtime controls when unpaired (`lab/src/ui/workspace.ts:139`). The immediate conditional popover visibility check at spec line 23 can race loading. The retained static attempt has one failed 390px case, one passing 1024px case and absent-runtime connection failures. The final documented mock log reports 7/7 (`evidence-B00R/b00r-lab-touch-mock.log:23`). The explanation is consistent with the code and logs; the initial failure is not hidden.
- **Named risk: clean export/pin/generated identity.** Independently hashed `/tmp/mekoniq-r2b-b00r-export-b05d8a7-20261114/runtime.mjs`: `dcb380c497b45fac76bb633b1422b41875a59adbcce63a6e670639a922b784a2`, equal to manifest and Lab lock. Manifest source is `b05d8a713e94084a2a6eb4cffa820f3927cdb650`, dirty false. Portable closure at `manifest.portableSimulationTools.closure.digest` is `9d0bc3c05291c2dbb770dceaf41373b167c747fe43523829513de95b1653445b`, equal to Lab lock. Native digest is `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7`. Both source generated-file SHA-256 values match the Lab header hashes (`lab/src/shared/engineering.ts:1`, `lab/src/shared/navigation2d.ts:1`; final pin `lab/config/source-runtime.lock.json:7`).
- Inspected the retained focused result summaries: ownership 6 passed; MuJoCo seams 50 passed; Webots isolation 8 passed / 19 intentionally filtered; mock browser 7 passed. No suites were rerun. The sole executed behavioral probe was the deterministic in-memory table example above; artifact hashing and source/log reads were otherwise read-only.

## Assessment

**Spec compliance:** Needs fixes (I1).

**Task quality:** Needs fixes.

**Reasoning:** The integration seams, final pin and direct signal scoping are well supported. The cleanup tracker still admits a false-empty result for an orphan spawned between samples, so the complete-owned-family cleanup requirement is not yet satisfied; fixing that must preserve the stricter proof required before signalling.
