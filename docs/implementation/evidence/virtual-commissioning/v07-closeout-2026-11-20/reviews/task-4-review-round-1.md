### Spec compliance

❌ Two new regressions remain at Lab commit 32f42548948b607e79ca2d99b4dbcd0d0a22cc3d. The correction addresses the five original Important findings and the independent-storage Minor finding. Exact-head verification passed.

### Original findings

| Finding | Verdict and evidence |
| --- | --- |
| Contradictory terminal report and missing bench request | Addressed. src/ui/control-panel.ts:168–172 validates the echoed request, including axis, signal, experiment and profile reference. Lines 185–200 bind report status and tick to the terminal action or verified reclaim, require previously known tuning, and preserve a matching original completed result after reclaim to needs_attention. tests/unit/control-workbench.test.ts:582–592,630–643 exercises both acceptance and refusal. |
| Impossible action receipts can archive automatically | Addressed. src/ui/control-panel.ts:43–58,268–273,292–307 checks the prior state, action, revision and tick span. Unknown mutations bypass automatic close. The correction admits terminal-at-start, zero-advance terminal STEP and the extra revision from idle expiry. tests/unit/control-workbench.test.ts:593–600,652–658,670–675 covers these paths. The focused outside-diff check of Source packages/lab-runtime/src/v2/control/bench-runner.ts:321,370–373 confirmed the exact idle reason and revision increment. |
| CREATE with missing or empty proof starts a worker | Addressed. src/scenarios/controls.ts:159–160,223–225 records a known ID on the unusable-proof error. src/ui/control-panel.ts:275–285 requires a matching ready receipt at tick/revision zero and persisted proof before START. Lines 149–157,167,378–380 describe and restrict recovery when the issuing credential has gone. tests/unit/control-workbench.test.ts:608–616,645–650 and tests/unit/twin-runtime-remote.test.ts:506–509 cover this. |
| Disconnect during known-ID START or STEP loses reread | Addressed for confirmed CREATE. src/ui/control-panel.ts:260–272,282–290 preserves the request, run ID, last confirmed tick and in-flight action. Lines 96–100,138–145,174–189,314–317,378–380 restore the issuing target and bound the recovered result. tests/unit/control-workbench.test.ts:617–639,660–668 covers re-pair, retarget and the actual final-STEP reread through reclaim and archive. The separate late-CREATE priority problem appears below. |
| Health accepts the wrong joint or wheel order | Addressed for the original cases. src/control/workbench.ts:128,135–143 enforces ordered wheel IDs, selected joint ID, profile membership and uniqueness. tests/unit/control-workbench.test.ts:601–607 covers reversed wheels, a mismatched joint, and duplicate use. A new malformed-type failure in the same check appears below. |
| One malformed storage value hides other proof entries | Addressed. src/runtime/run-entries.ts:3–13 decodes legacy and per-run JSON independently and checks per-entry shape. src/scenarios/controls.ts:159–160 validates proof strings and src/ui/control-panel.ts:92 validates marks. tests/unit/twin-runtime-remote.test.ts:501–505 keeps a valid proof visible despite three differently malformed entries. |

### Issues

#### Critical

None.

#### Important

1. **A stale CREATE receipt displaces a newer session’s displayed result.** src/ui/control-panel.ts:260–265 uses target-key equality to append with keep(), including when the original session is no longer active. consider CREATE A held in the network, followed by disconnect, re-pair to the same runtime, and completion of bench B. When A finally returns, its callback at lines 275–281 appends A after B before the operation checks whether the session changed. Lines 361–363,418 use the last displayed history item. A is unread, so the next render replaces B’s result with A’s recovery notice and disables B’s export. If A arrives while a different target is active, appending A to the saved history can produce the same change when returning to A’s runtime. A timed-out CREATE can also resolve after a newer run in the original session. Preserve the late ID and its recovery action without changing the current selection or displacing recent completed results. Exercise A resolving after B has completed, including same-target re-pair. The existing test at tests/unit/control-workbench.test.ts:676–683 parks the *second* START and never delivers a late first CREATE.

2. **An invalid axis value can break workspace rendering.** src/control/workbench.ts:136–138 interpolates a.axis into the expected joint ID before checking its type or enum membership. A valid JSON catalog row with axis equal to {"toString":null} and an otherwise ordinary axisIds array throws TypeError. It escapes the validation call instead of rendering BENCH_CATALOG_INVALID. The previous enum check rejected this input. Validate the axis as a registered string before constructing the drive ID and add the malformed object to tests/unit/control-workbench.test.ts:601–607. A standalone JavaScript check confirmed this exact interpolation throws “Cannot convert object to primitive value.”

#### Minor

None open from the initial review.

### Assessment

**Task quality — Needs fixes.** The late-CREATE regression affects recovery selection during an ordinary network/session race. The new health coercion can prevent the panel from rendering a controlled refusal for a malformed response.

At this exact head, the implementation report at task-4-report.md:61–63 records successful typecheck, source verification and 761/761 Vitest cases across 97 files with zero skipped. Real cookie/CSRF Control and remote bearer 1×/16× each passed once with zero retries or skips. No suite was rerun by the reviewer. The review used the frozen six-file correction diff and the focused contract/coercion checks identified above.
