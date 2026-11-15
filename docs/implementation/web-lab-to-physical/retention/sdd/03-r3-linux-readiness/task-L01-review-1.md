# L01 independent task review — revision 1

**Spec-compliance verdict: CHANGES REQUIRED for the prepared-tooling scope.** The no-host boundary is honored and is not itself a defect: actual DEP-MJ-01 and all sixteen cases correctly remain `not_run`. The complete native exit criterion is still unverified. R81–R84 are legitimate scope rulings and were applied in this review; current R2b executable campaign preparation remains required B10 work under R83.

**Task-quality verdict: CHANGES REQUIRED.** Four Important findings affect the clean-checker boundary, exact-image/readback identity, raw fault proof, and instability evidence retention. One Minor finding concerns a changed historical threshold. No Critical finding identified. No approval or acceptance is implied; retain `accepted:false` and `not_calibrated`.

## Scope and evidence

Reviewed the requirements first, then the complete implementer report, the original-base Source package `298db9b..2f4837d` and Lab package `7698aa6..69032d5` in bounded passes. The reported final commits are Source `2f4837d10d746a7c8c5e5ca5675ec57db4111c28` and Lab `69032d509cc94b178102c386ddf82280996cf74e`. The Source package includes all twenty changed files; the Lab package changes only its runtime pin and two generated headers.

Read the controller handoff and byte-audit material. The root's 184-ref / 9,648,529-byte audit and 179-entry historical closure accounting are byte/identity evidence, not native execution. The distinct preparer, independent-checker and probe short digests are legitimate scopes; parsed-equal export/cache manifests need not have identical whitespace. Neither corrected controller assumption is a finding.

Inspected the retained combined-test result (153 passing tests, five files), Python syntax-only result, and actual not-run readback refusal. Did not rerun tests or recreate missing diagnostics. The transient AJV/schema diagnostics disclosed in the report were not available as separate raw logs; their history is not reconstructed by later passing logs.

Focused outside-diff checks addressed these concrete risks only:

- Historical API mismatch: read frozen `mujoco_worker/session.py`, `engine.py`, and `protocol.py`, plus relevant text ranges of the retained historical runtime for process arguments, bearer/CSRF handling, directory creation, archive/close behavior, run status, arm traces and fault propagation. These reads did not execute the runtime or open SQLite.
- Recipe mismatch: read the frozen M00 document and recovered the relevant Python block / threshold sections after initial output truncation. The recipe's `main`, `Sim.tick`, trace format and command shape are consistent with the harness's calls.
- Image filesystem/environment mismatch: located and read frozen `deploy/lab-runtime/Dockerfile`. Its `/app` worker/schema/runtime paths, engine venv, Node version and `MEKONIQ_LAB_MUJOCO=1` agree with the intended invocation. This is build-source context, not proof of the unresolved installed image.

No source/index/HEAD changes, helper agents, native/engine/container/cloud/hardware execution, or historical evidence changes were made. This report is the only written artifact.

## Strengths

- R81's additive arm-only adapter binds the old Source/Lab/runtime/schema/closure tuple, frozen fixture/schema hashes and whole scene/model mappings. Existing kinds retain their separate validation route. The preparation path copies verified cached bytes and frozen Git objects rather than rebuilding HEAD as R2a.
- The native execution guard precedes Docker commands. The prepared output honestly has `image:null`; the installed engine artifact and assigned host remain prerequisites. Registry digest and config identity are distinguished.
- R82 separates the instrumented historical WorkerSession engine fault from full-runtime worker loss. R84's observer forwards the original spawn and stdin-write calls, records an explicit timing scope, and has portable forwarding/lifecycle refusal coverage. No Lab-to-hardware route was added.
- Serial execution, task-owned container labels, network-none/read-only/nonroot container arguments, incremental stdout/stderr, timeout/abort receipts, immutable output directories and retained failure artifacts are useful boundaries.
- Required seeds/scopes and timing summaries are explicit. Native unit-log substitution is refused, and supplemental records do not upgrade existing release/hardware gate tables.
- Source commit → clean export → Lab pin ordering is recorded, and the Lab diff remains appropriately narrow.

## Important findings

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

## Minor findings

### L01-R1-05 — Historical lift acceptance threshold silently changes from 0.14 m to 0.15 m

**Locations:** `source/scripts/native-sim/mujoco-probe-evidence.mjs:32`, `:41`.

Both summary and raw assertions require measured lift at least `0.15` m. The frozen M00 source cited by this implementation records `liftMinM = 0.14` at line 193, with a **commanded** lift of 0.15 m and measured historical lift of approximately 0.1514 m. Those are distinct quantities. A native result in `[0.14, 0.15)` would satisfy the handed-off threshold but fail this compatibility reader. Keep the historical acceptance threshold, or explicitly document and obtain a controller ruling for a stricter new compatibility criterion. This is a conservative false-rejection issue, not unsafe acceptance.

## Cannot verify from the diff / retained portable evidence

- No assigned native host, exact platform manifest/config, actual installed engine artifact, native inventory authenticity, real Docker isolation behavior, engine trial, fault case, native timing/contact output or 180,000-tick run was available. All sixteen actual cases and DEP-MJ-01 remain `not_run`; nothing here establishes G-NATIVE-ARM or hardware safety.
- No complete successful native record was available to exercise the full reader. Existing tests cover many useful negatives but not the full positive execution/readback path or the mismatches above. The test named “prepared execution on an unassigned host” supplies a missing handoff and therefore does not itself reach the host guard; the separately recorded real prepared Mac invocation supplies that evidence.
- Host assignment/provenance remains operator-attested, not cryptographic authentication. The historical Dockerfile is not an image-layer audit. Native worker/observer timing overhead and real process-exit behavior remain unmeasured.
- The supplied raw logs do not recover the missing intermediate AJV/schema development attempts. Original RED/GREEN and later covering results are recorded, but the disclosure must remain.
- Current R2b image/campaign execution remains `not_run/image_unbuilt`; R83 still requires B10 to implement and independently review its executable adapter before final tooling completion.

The no-host limitation is acceptable for this preparation task. The Important findings must be resolved before calling the prepared tooling complete; native qualification and human acceptance remain separate later gates.
