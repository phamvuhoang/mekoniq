Scoped re-review: L01 fix round1. Exact heads, fix packages and evidence are supplied; no implementation is active during this review.

Requirements: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L01-brief.md
Prior full review: task-L01-review-1.md in that same directory.
Full report plus appended fix report: task-L01-report.md in that same directory.
Fix BASE (previous reviewed heads): Source2f4837d10d746a7c8c5e5ca5675ec57db4111c28 / Lab69032d509cc94b178102c386ddf82280996cf74e.
Final fix HEAD: Source eeea18db88485e113aafe1cc15edd7f75ced2b66; Lab e8577a5b7f4f6b615aa333b3f86126d06e1f0c05 (both clean).
Source fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-2f4837d..eeea18d.diff (154794 bytes; SHA25691d8b7f4420357df28b82a9a6f2213efc6df60fbffd2575740086f4bf9550f32).
Lab fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-69032d5..e8577a5.diff (3475 bytes; SHA256c845ae555acd9e2f7af0db767eec5cf2b307f72cb86d4651529d4878be457c10).
Root identity/check handoff: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L01-r1-handoff.json and root-L01-r1-byte-audit.json; complete fix appendix and test-isolation correction in task-L01-report.md. Root read all40356B report, final182Vitest/9Python and focused1test/lint/type/pin logs, verified184refs/9648529B, both preserved prefixes,4oldmanifest/artifact sets and51+27logfiles. Byte/identity audit only..

Review only the four findings below and breakage introduced by their fix diff. Do not repeat the full-task review or broaden into unrelated existing code. Read the supplied package once in bounded passes. Read outside diff only for a named concrete dependency risk; explain it. Do not reconstruct Git diffs or rerun recorded suites. One focused check may resolve a specific remaining code doubt; report missing evidence instead of recreating history. No native/Docker/cloud/hardware/engine execution, historicalSQLite opening, helpers, code/index/HEAD mutation. Write only the review report.

L01-R1-05 remains a deferred Minor for B10/final triage; it is not an additional Important fix requirement. Native host/image/engine artifact remain unavailable; neither protocol doubles nor Mac preparation establish native pass. R81 exact historical arm-only subject, R82 component bad-state versus fullruntime worker-loss, R83 currentR2b adapter inB10, R84 explicitly identified passive observation remain binding. Preserve Source authority, oneACK, unknown/noresend/norespawn, immutable old evidence and cleancheckeractualbytebinding. accepted:false/not_calibrated always.

Existing findings, verbatim:

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


For each finding return ADDRESSED or NOT ADDRESSED with precise evidence. Flag only new Critical/Important breakage in this fix as new blockers; other/outside observations go to deferred Minor triage. Explicit final fix-round verdict required. Read covering test commands/output and actual new handoff identities; distinguish byte/static checks from native behavior. Do not infer missing raw history or actual installed-image behavior.

Write /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L01-review-2.md; return concise verdicts/IDs/report path.

Pre-review follow-up inside this SAME fix range: root found inherited recorder --plan unit test called real docker info (30s bounded prerequisite) despite earlier broad NoDocker claims. Report APPENDS a correction; exact real child status/output was not retained, no daemon/container result inferred. The second Source commit only isolates that UNIT test using exclusive owned PATH and argv-recording Docker stub; production --plan remains unchanged.182Vitest/9Python remain prior fix1-tree evidence handed off asbb62601; finaleee HEAD hasfocused1passed/24unselected plusrelatedtypes/lint/cleanexportpin. Root bytecomparison confirms current runtime equals previous runtime after3embeddedSourceidentityreplacements. Review the added isolation change as fix-range code, not a new whole-task pass. No routine suite rerun or real --plan/Docker prerequisite call.
