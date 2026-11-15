# B00R2 independent review 1

Spec-compliance verdict: **PASS for the bounded frozen-history import.**

Task-quality verdict: **PASS.** No Critical, Important or Minor defect identified in the reviewed task delta. Finding IDs: none. This verdict does not qualify R2b, close B09/WEB05, or grant human acceptance.

## Scope and reviewed identities

Reviewed the dispatch, task brief and implementer report, all four controller packages in full, the provenance summary and complete machine-readable inventory summaries, and the independent root Git-object/export handoff. The implementer report was treated as claims; the bounded diffs and independent audit supply the supporting evidence.

| Repository | Original feature BASE | Frozen import | Final HEAD |
| --- | --- | --- | --- |
| Source | `3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` | `11d25b47a18adafb88ac21adc249499109996bc5` | `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` |
| Lab | `538ba452c81005010a479f337aab0edbad6e5159` | `a7449541e118d01f65af0ad1466e0c963a173f3c` | `176bf348b6a839037473cc6d87413093ed17ff54` |

Prior upstreams are Source `4f893ac6fb75dff414a3ee42a726defb7935c734` and Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`. The root handoff establishes clean final trees, no unaccounted incoming paths, no feature overlaps, and an unchanged Source runtime tree. No merge conflict or conflict resolution is present. Source has no changed feature-only path; Lab has only the four explicit README/pin/header changes below.

Read and independently recomputed the bytes/SHA-256 of these supplied packages:

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `root-B00R2-platform.diff` | 21328 | `b4927b2cb53243e7d720ca1c071358de54309f9b559719777db2cd4a77daf722` |
| `root-B00R2-guide-editable-and-manifests.diff` | 111786 | `9e9c9ba054ec43590b0a6d2e49b6824553737c924c1de6e11a3a33a5931e52e5` |
| `root-B00R2-docs.diff` | 58878 | `07b30edb712e65ff9db9c3228435065ca2308a8fa83d4dc8be012f34f53cc95d` |
| `root-B00R2-lab-own-changes.diff` | 6627 | `076e038404e5c4eee9c4f6f96a75b36f6af50bcd680a12b654e8cb09d6bd6a14` |

An initial 500-line guide read was truncated by tool output in the Python builder. Bounded subsequent slices recovered the omitted builder/facts/CSS/verifier text; this was the reason for those overlapping reads. No changed checkout code was reread or broad codebase search performed.

## Provenance and coverage accounting under R77

The full original-base packages remain retained: Source standard diff 154315121 bytes / `82d40cf2cfa108b09d695df43c6f2405ee01851e421b7ed66dc458c951f2151f`; Lab standard diff 2144213 bytes / `7caed2fd661db128c55b69efff35f9b5e8426d1d3c202ee3735a126775b6459a`. Complete no-renames binary patches are Source 530076779 bytes / `4b5433d2559e2ba17dc733930d55dd411fbaf9098a334a50831b67a8d2b661e2`, and Lab 25888473 bytes / `70a10f742aa34cc3e7873605398dd81ff2c087707c3ffd4b87ac6873c485c1d6`. These identities are recorded by the independent root handoff; this reviewer did not reconstruct or manually stream the large patches.

The complete inventories contain all 8841 Source incoming rows (4465 added, 4371 deleted, 5 modified) and all 229 Lab rows (116 added, 113 deleted). Programmatic inspection of every inventory row reproduced the sole Source mismatch, no Lab mismatch and no overlaps. Root independently checked every row against Git objects and also checked 354 Source and 226 Lab feature-only paths. The inventory checks establish exact mode/object/deletion provenance, not the semantic correctness of historical physics records.

All imported groups are accounted for:

- Five platform paths: cloud evidence guard, test-runner alias, focused unit suite, retained-data acceptance suite and historical deployment environment example. All are explicit code-review inputs, exact frozen objects.
- Sixteen artifact paths: artifacts index; guide README, editable JS/Python/CSS/verifier, build manifest, facts, verification receipt; generated HTML; four original image copies; desktop/mobile previews. Every editable source and manifest/receipt was read. Generated HTML/images/previews use the root audit's exact frozen blob/mode equality under R77 rather than manual binary/base64 review.
- 8820 Source documentation/evidence paths: the implementation README, operations guide and qualification-plan changes were read explicitly. Historical additions/deletions use full inventory equality. Incoming deletions remove candidate-08 (1604), r1-candidate-06 (2589), r11-candidate-03 (25), and r2a-candidate-01 (153) from the tree and preserve them in Git history.
- Lab's 229 historical paths replace the 113-path regression with regression-02 and add three mock-acceptance-02 files. They exactly match the frozen import, including deleted-path absence.
- Four own Lab changes were read: README, source-runtime lock and generated engineering/navigation provenance headers. There is no generated body or legacy compatibility-record change.

The only incoming mismatch is Source `docs/implementation/README.md`: frozen blob `e2d58e682eea3e17b449605dca22dc0c84861659`, final `e20309c6d7a69ea92121723eee677bcc362c43f1`, both mode 100644. Its additive R2b section explicitly separates the imported R2a guide/deployment/evidence from the active runtime, states the null/unbuilt image and WEB05 not_run, and preserves authority and acceptance limits. This is a justified reconciliation, not an evidence rewrite. No executable artifact source, feature overlap, mismatch or imported group was silently excluded.

## Spec compliance and strengths

The imported cloud guard (`scripts/cloud-run-qualification.mjs:1`) performs stored-data reads only. It verifies checksum entries before semantic use, restricts paths, requires the provenance inventory, binds the exact original qualification bytes and candidate, requires R2a local gates and accepted:false, and compares source/Lab/artifact/schema identity across qualification, deployment, health and reports. Deployment revision/image/traffic/origin and secret-reference checks are separate from outcome checks. MuJoCo completion requires the expected scenario/backend/mode, tick/time/clock, two delivered jobs, no stop or attention and not_calibrated. Reconnect validation requires a contiguous business-event sequence through its recorded cursor, and smoke cleanup must cover both reports' runs. The acceptance wrapper also applies the original qualification guard. Unit coverage includes rehashed semantic contradictions, incomplete provenance, unsafe paths, prefix-only streams, omitted deployment identity and incomplete cleanup. No cloud producer is invoked by these tests or by the new alias.

The offline guide preserves VI/JA/EN text, image labels, keyboard route navigation, focus restoration, copy fallback, reduced motion, print and no-JavaScript reading. It uses no new framework, browser engine or runtime connection. The builder verifies input images and shell syntax; the verifier checks artifact/input/original-image hashes, production-browser evidence identity and scope, translations and source links. The static path exits before browser launch. The inherited browser receipt remains historical. The guide's 4800 HTTP and 4810 production-UI results are explicitly scoped to different step batches and do not promise selected UI pacing as CPU performance.

The operations/qualification documents retain original G-CLOUD1 blocked_external semantics and describe tested only through the separate immutable supplement. The active Source/Lab READMEs identify these as historical R2a claims. Source remains mission/journal/custody authority; this delta adds no Lab-to-hardware route and changes no runtime/schema/engine/tool behavior.

The new Lab pin names Source `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` and artifact `dd30b291d0211de31dcee2a5a3e659b355e6501677d9fce08abed3788eb857b7`. Schema `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9` and portable tools `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9` are unchanged. Root's successful export audit binds the clean export and Lab pin and establishes that exactly three source-identity sites explain the bundle difference from B09: approvedCommit, gateway sourceCommit and CLI Source display. Its earlier one-occurrence assumption and failed audit are transparently recorded; there is no hidden product change.

The retained R2a qualification SHA-256 remains `5db76df9886b96df37e1a335d285b42b3e9f8dd5d21ef2df542a1a5fa82a84ad`, historical runtime `4f893ac...` and recorded Lab `a6ec316...`. These are separate from the current export identity. Historical HTTP completed4800/served2 and production Chrome completed4810/served2 establish no new R2b image, container/native success or acceptance. R76/B09 remain open as documented.

## Findings

Critical: none. Important: none. Minor: none. No plan-mandated defect identified. No deferred minor coverage/polish item is required by this review.

## Verification and cannot verify from diff

No suites were rerun. Root's command/identity gate inspected the retained command JSON and unabridged logs: 24 guard units and one retained-data acceptance passed, with Source types/changed lint, guide static/syntax and clean export/import/sync/check:source/Lab types passing. Inherited checksum-bound log whitespace is explicitly retained (198 Source findings across 12 paths, one Lab finding); focused code/pin whitespace checks pass. This review's fresh commands only read review inputs and inventory JSON and recomputed the four bounded package hashes. No code, index or HEAD mutation, cloud/native/browser/container execution, secret access, SQLite opening or helper delegation occurred. The report is the sole write.

Cannot verify from this diff/review, for the controller:

- The correctness of every historical tick/physics/browser result was not re-proved. Exact inherited bytes and retained guard checks establish provenance only, as R77 permits.
- Current deployed service state, cloud lifecycle/secret rotation behavior, external documentation/prices and historical authorization were not independently checked. Operations statements are retained dated claims, not current execution authorization.
- Tests-first chronology and actual external producer execution are not established by the code diff. Recorded commands/results are reviewed through the supplied root gate, not repeated here.
- New R2b qualification, current image availability, WEB05, native hardware fidelity, commissioning, manual cross-browser HTTPS-to-loopback checks and human acceptance remain outside this task. No success in this review closes those gates.

These limits are consistent with the task and R77; none is an omitted B00R2 implementation requirement.
