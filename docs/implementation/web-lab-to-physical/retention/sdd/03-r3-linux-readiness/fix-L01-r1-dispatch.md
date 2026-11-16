L01 fix round1/5 — complete reviewed Important finding list supplied; proceed.

Resume the original L01 implementation. Requirements remain task-L01-brief.md, implement-L01-dispatch.md, R81–R84 and the full task report. Read task-L01-review-1.md when available. Fix BASE Source2f4837d10d746a7c8c5e5ca5675ec57db4111c28 / Lab69032d509cc94b178102c386ddf82280996cf74e. Original task BASE stays298db9b/7698aa6 for historical full-task review; scoped re-review will use this fix BASE.

No helpers. Root does not change product code. Fix all Critical/Important findings below in one batch; keep Minor observations for explicitly tracked final triage unless directly necessary to the fix. Preserve all historical subject bytes, old prepared packages and the prior report prefix. Native/Docker/cloud/hardware remain unexecuted; no retry of Docker underR76. No current R2b adapter substitution (B10 ownsR83).


### L01-R1-01 — Check helper bytes before importing them, including the supplement entrypoint

**Locations:** `source/scripts/native-sim/mujoco-probe.mjs:12`, `:15`, `:146`; `source/scripts/native-sim/prepare-mujoco-r2a.mjs:8`, `:9`, `:34`; `source/scripts/record-sim-extension.mjs:202`.

The new CLIs statically import `native-inventory.mjs`, the process/evidence helpers and historical JSON reference/profile before their CLI bodies call `checkedCheckerCommit()`. ESM evaluates these modules first. A modified helper can therefore execute before refusal, and a helper/reference loaded before an on-disk restoration remains cached even if both subsequent disk audits see clean Git bytes. Reusing the checking function does not bind the already loaded module graph to the bytes it later reads.

The recorder's dynamic import reaches `copyMujocoProbeSupplement`/`readMujocoProbeSupplement` without invoking this guard at all: the `mujoco-probe.mjs` direct-CLI branch is deliberately skipped when imported. That path cannot rely on the new CLI's pre/post checks.

This regresses the L00 clean-checker load/check/use boundary raised by the controller. Use a minimal trusted bootstrap to check the complete relevant byte graph before importing the assessment/reference modules, and preserve an effective after-assessment check for every supported entrypoint, including the recorder supplement. Tests should exercise these new entrypoints with a dirty imported helper and cached/reference-byte mismatch, not only the old native-handoff CLI. No exploit code was run during review.

### L01-R1-02 — Readback does not enforce the recorded checker pin or exact historical image prerequisite

**Locations:** `source/scripts/native-sim/mujoco-probe.mjs:91`, `:98`, `:106`, `:131`.

`verifyMujocoProbe` never reads or validates `manifest.checker`. Its observer comparison covers five staged files, but excludes the orchestrator/reader itself, the baseline reference and the full checker tuple. Changing or removing `manifest.checker` in an otherwise valid record is therefore invisible to readback; the top-level manifest is intentionally outside its own artifact list. The documented same-observer-code-pin requirement is not enforced, and the supplement simply republishes the unchecked checker claim.

There is also an admission asymmetry: execution requires `subject.image.manifestDigest === baseline.historicalRegistryDigest`, while readback only cross-compares the supplied handoff, recorded image-inspect fields and measured subject. The static arm adapter binds historical source/runtime fields but does not impose that exact registry digest. A self-consistent different image for the same source/runtime can therefore satisfy the reader without satisfying the execution path's exact-old-image rule. Readback likewise omits the execution path's measured forbidden-package / single-required-package checks.

Bind the record's checker identity to the clean reader pin (or a separately explicit reviewed compatibility policy), and apply the exact historical image and measured package prerequisites during independent readback too. A missing native image remains `not_run`; this finding does not request a build or relaxation of the known historical digest.

### L01-R1-03 — Fault qualification trusts derived observations without checking their retained raw sources

**Locations:** `source/scripts/native-sim/mujoco-probe.mjs:115`, `:116`, `:117`, `:123`; `source/scripts/native-sim/mujoco-probe-evidence.mjs:66`.

For business/worker-loss cases, readback checks `run-wire.json` against `raw.wire` and only reads `complete:true` from `wire.jsonl.seal`. It never parses the actual observer-owned `wire.jsonl`, checks the seal's `totalBytes`, or refuses a retained `.incomplete` marker. Thus a truncated/missing raw wire file or an omitted raw resend event can coexist with matching derived arrays and a complete seal and still pass after normal artifact-list regeneration. Byte hashes protect whatever list was supplied; they do not establish that the derived subset represents the complete observed stream. This is directly material to R84's missing/overflowed/incomplete-trace refusal requirement.

The worker-loss `SOURCE_UNKNOWN` assertion similarly reads `raw.checkpoint.coffee.arm.programs`, but readback never compares that checkpoint with the retained post-close `runtime/.../run.json` copy. `injection.json` is also not compared with `raw.injection`. Copying/hashing journal files does not establish those separate asserted values. The bad-state branch requires state/input filenames to exist and links only the final two responses; it does not check that the retained requests/compiled scene/state evidence describes the claimed injection.

Re-derive wire assertions from the original sealed stream, require its complete lifecycle and byte accounting, and bind injection/checkpoint claims to their retained files. Ensure missing/truncated/contradictory raw inputs cannot be replaced by internally consistent summaries. Add focused reader negatives for these substitutions. This is not a request to infer Source behavior from component bad-state; the R82 scopes should remain separate.

### L01-R1-04 — Nominal BADQACC/PLANT_UNSTABLE paths do not retain the requested engine state

**Locations:** `source/scripts/native-sim/mujoco-probe-engine.py:39`, `:45`, `:102`.

Only the deliberately injected bad-state case saves before/injected/after engine NPZ states and compiled MJCF. Nominal M00 delegates to the frozen recipe, which dumps its pose/contact trace only after `run_program` and `analyse` finish. If the engine/analysis throws first, the harness's `finally` writes only RSS. The long-run case likewise saves its result only after all 180,000 ticks and otherwise retains no state snapshot or partial samples. Consequently the exact native instability this task is intended to investigate can leave stdout/stderr and resource usage but no retained qpos/qvel/qacc/ctrl state; even a normally returned warning failure only has the limited recipe pose summary.

The brief explicitly requires archiving inputs/state/warnings when native amd64 remains BADQACC/PLANT_UNSTABLE. Preserve bounded failure/last-state and warning evidence for nominal M00 and long-run execution as well, with separately identified observer instrumentation and unchanged historical recipe/subject bytes. This defect exists in prepared tooling even though it cannot yet be exercised on an assigned native host. Do not fabricate native failure evidence or claim an investigation has run.



Cover amended behavior with meaningful failing regressions first, then focused GREEN including existing L01 tests and affected L00/recorder checks. Include actual CLI/import-order/identity cases where needed; do not infer entrypoint behavior solely from pure-function tests. Retain failed outputs without overwriting prior logs. Keep tests isolated in owned temporary Git snapshots when they need dirty/noGit inputs, never mutate real checkout bindings to test refusal. Covering test files and exact commands will be named with final findings.

Commit Source clean, export to a NEW temporary directory, import/sync/check/typecheck Lab and commit pin if runtime/schema/tooling changes. Regenerate current-observer historical preparation and not_run exercise only if changed interfaces/identity require it; old subject staysSource4f893ac/Laba6ec316/runtime55dd3585. Keep previous2f4837d handoff/probe byte identities and native not_run statuses unchanged.

Append full fix report to task-L01-report.md, with exact findings addressed, changed files, RED/GREEN commands/output, covering checks and limitations, Source/Lab/export identities and preserved old artifact/report-prefix hashes. Do not rewrite the initial report. Return concise status/commits/checks/report path. Root will read and independently audit, then request ONE scoped re-review of the fix diff.

Covering tests: tests/unit/mujoco-native-probe.test.ts, tests/security/native-handoff-checker.test.ts, tests/unit/sim-extension-qualification.test.ts, plus new focused actual-entrypoint security cases in tests/security/mujoco-native-probe-checker.test.ts and Python state-retention regressions in robotics/simulation-mujoco/tests/test_native_probe_retention.py (or explain a more appropriate existing test location). Use portable subprocess/fault fixtures, no new native/Docker campaign. If exact-image prerequisites prevent a complete native-positive reader fixture, document that limitation; do not add a production bypass or label synthetic data as native execution. Negative cases must coherently reseal prerequisite artifacts so they actually reach the claimed boundary.

Root accepted all four Important findings as implementation defects; none is mandated by plan text, so no contradictory ruling is needed. L01-R1-05 lift threshold is Minor and is deferred to B10/final triage, not another task fix-loop requirement. Preserve that observation and do not silently introduce a different baseline policy.

Prior report snapshot is evidence-L01/pre-review-fix1-report.md and identity JSON. Original handoff /tmp/mekoniq-L01-preparation-g53avI/handoff manifest SHA25676f3a4fda8ef1b7c21695d1f261ce6a9d08758e401d0beb5be21883783547e30; preserve it and sibling native-not-run. Root audit root-L01-handoff.json records all old identities and distinguishes preparer/checker/probe digests. Append report and use new artifact directories for fix output.
