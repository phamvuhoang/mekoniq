# L00 scoped fix review 2

Fix-round verdict: **PASS**. **L00-R1-01 — ADDRESSED; L00-R1-02 — ADDRESSED.** No new fix-introduced Critical, Important or Minor findings.

This is a scoped re-review of the two findings from review 1 and breakage introduced by their corrections. It is not another full-task review. Reviewed supplied packages: Source `2b7d39cdeab06b499e9037aef1a24f1babe03a4f..298db9bdbc207b14bdbef78ec8d70adf4e901c71` (62,754 bytes), Lab `fd4365291f6db7fdcbd72407f94ac7c0f35a20b4..7698aa628fc9a60598d1337b292bdcec2fe91fdc` (3,433 bytes). Paths below are relative to the indicated repository.

## Existing finding verdicts

### L00-R1-01 — ADDRESSED

Locations: `source/packages/lab-runtime/src/v2/sil/native-handoff.ts:22`, `:23`, `:24`, `:25`, `:113`; positive fixture `source/tests/fixtures/native-handoff.ts:13`; regressions `source/tests/security/native-handoff.test.ts:47`, `:48`, `:49`.

The OCI branch now requires supported manifest/config shapes before admitting readiness. Config and layer descriptors require mediaType, SHA-256 digest and nonnegative safe integer size; the selected OCI/Docker family determines accepted config/layer media types. Config descriptor size must equal retained config byte length, and its digest remains bound to the subject's retained config identity. Required rootfs type/diff IDs are validated, layer/diff-ID counts agree, and supplied history must have the matching nonempty-layer count. The existing Linux/ISA and exact subject image checks remain.

The positive fixture now contains a complete one-layer manifest/config record rather than the prior truncated documents. Fourteen coherently resealed negatives cover missing/malformed layers, layer descriptor fields, missing/wrong config descriptor, config-size mismatch and missing/malformed rootfs/diff IDs. They require preparation to remain valid while readiness fails with precisely HOST_PROVENANCE_ARTIFACT_INVALID. Resealing updates retained image bytes, descriptor digest/size where appropriate, subject image identity and the fixture's inventory/provenance seals; the wrong-size case intentionally retains the wrong descriptor size. The valid Docker-family positive tests the second supported family.

This addresses the supplied-document prerequisite defect without fetching layer blobs or claiming actual image execution. The explicitly documented support bound excludes empty-layer images, other digest/media types, indexes and generic artifact records; this does not silently relabel unsupported records as ready.

### L00-R1-02 — ADDRESSED

Locations: `source/scripts/native-handoff.mjs:12`, `:15`, `:16`, `:18`, `:27`, `:28`, `:38`; focused actual-CLI regressions `source/tests/security/native-handoff-checker.test.ts:11`, `:12`, `:13`, `:14`.

Before importing the validator/reference corpus, the CLI requires a SHA-1 Git checkout at the checker root, valid HEAD and clean tracked/index/untracked status. It additionally hashes actual regular-file bytes with Git blob framing and compares them to HEAD tree identities across the declared repository-owned input scopes. This catches concealed modifications even when index flags make status clean. Symlinked files/parents and excessive corpus size/count fail closed. The check repeats before output and requires the same HEAD. A copied/no-Git checker now returns failure without a prepared assessment; sourceCommit:null is no longer a successful fallback.

The five actual-CLI cases cover a clean independently committed checker, changes to both an imported model and validator outside the short-digest set, no-Git refusal, and assume-unchanged concealment. The clean positive expressly preserves independent subject/checker commits. The six-file short digest remains a separate identity, now accompanied by enforced repository-byte binding. The documented operator trust boundary for Node/dependencies is consistent with this correction; the pure in-process API does not claim to bind its caller's environment.

## Fix-introduced breakage

None found at Critical, Important or Minor severity. Lab changes are the matching source/runtime pin and generated provenance comments; schema and generated content identities are unchanged. The changed readiness checks remain inside the OCI branch, preserving native_apt/profile separation. Current R2b image:null and unresolved locks still block readiness; no static adapter, ROS mapping or historical arm-only support was expanded.

## Evidence and bounded dependency check

Read the task brief, prior full review, entire appended fix report, complete supplied fix packages and root-L00-r1-handoff.json. Inspected the retained OCI RED/GREEN and checker RED/GREEN logs: the old implementation produced the reported 13 OCI false-readiness failures and 3/4 checker failures; the corrected suites record 103/103 and 5/5 passes respectively. The final focused log records 115/115 tests across security, unit, actual checker CLI, legacy native profile and host preflight. The report supplies the exact five-suite command and changed-file lint command. Inspected contracts/typecheck/lint output: contracts match, route generation/tsc completes without failure output, and final lint output is empty. These are retained execution results, not reruns by this reviewer.

The named outside-diff risk was whether the new checked scopes actually contain the static adapter's fixed reference imports. Inspected only the import/binding portion of native-handoff-documents.ts: its canonical model/world/schema inputs fall under packages, robotics, integrations and tests/fixtures. In particular, the PUMA profile is under integrations/arm-controller/configs, within the checked integrations tree. No omitted direct reference dependency was established; no broad dependency crawl or independent re-review of existing validators was performed.

Read retained clean export/Lab import/sync/check/typecheck evidence and the root byte/identity handoff. Root reports clean final Source/Lab heads, 239 checked refs, runtime `802b58db…`, manifest `010c1002…`, schema `07e01e8e…`, portable closure `9e84b636…`, checker short digest `c75a5b6f…`, and preserved prior report prefix/old manifests. Those identity results are controller-audited evidence, not a reviewer claim of native execution or a fresh reconstruction of historical subjects.

## Outside-fix observations and limits

No new outside-fix observation is raised for blocking triage. Previous full-review observations and external limits remain unchanged. Prepared/supplied consistency does not authenticate host origin or prove installed behavior, layer contents, execution, native parity, calibration or acceptance. Current image is null/unbuilt, nativeReady remains false for the concrete handoff, ROS mappings remain unresolved, and the historical arm-only adapter remains staged to L01 under R81. R78–R81 are preserved.

Only this review report was written. No helper agents, code/index/HEAD mutation, routine suite rerun, native/browser/cloud/Docker/hardware execution or historical SQLite opening occurred.

**Explicit fix-round verdict: PASS — both existing Important findings are addressed; no fix-introduced findings require another correction round.**
