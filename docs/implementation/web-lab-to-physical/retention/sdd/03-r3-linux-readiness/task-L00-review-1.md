# L00 independent review 1

Verdicts: **spec compliance — REQUEST CHANGES; task quality — REQUEST CHANGES**. Two Important findings remain. No Critical or Minor findings. The static-admission correction substantially closes the earlier transport-only gap, but the OCI readiness boundary and effective checker identity need correction before this task passes review.

This is the first independent review of the entire task, including both implementation commits and the correction, from Source `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` to `2b7d39cdeab06b499e9037aef1a24f1babe03a4f`, and Lab `176bf348b6a839037473cc6d87413093ed17ff54` to `fd4365291f6db7fdcbd72407f94ac7c0f35a20b4`. It is not a scoped correction review. All paths below are relative to the relevant isolated repository.

## Important findings

### L00-R1-01 — OCI provenance accepts incomplete image documents as a ready single-platform image

Location: `source/packages/lab-runtime/src/v2/sil/native-handoff.ts:99`. Supporting fixture: `source/tests/fixtures/native-handoff.ts:13`; positive assertion: `source/tests/unit/native-handoff.test.ts:14`.

The OCI branch verifies the two byte digests, manifest schemaVersion/mediaType/config.digest, and config OS/architecture, but does not validate that these bytes actually form the required image manifest/config documents. The committed positive fixture demonstrates the gap directly: its manifest has no `layers`, and its config descriptor has neither `mediaType` nor `size`; its image config contains only `os` and `architecture`, with no `rootfs`. Nevertheless the positive test requires `prepared:true,nativeReady:true,issues:[]`.

Consequently a consistently resealed truncated record, or a manifest with malformed descriptors or a config-descriptor size inconsistent with the retained config bytes, satisfies readiness. This is separate from whether an operator's inventory is authentic: even within the declared supplied-records-only boundary, the supplied prerequisites are structurally incomplete. R78 requires exact single-platform manifest/config evidence; rejecting a multiarch mediaType alone does not establish that requirement.

Required correction: validate the supported OCI/Docker manifest and configuration shapes and their descriptor relationships, including required fields, descriptor digest/size/mediaType validity and the config descriptor's size against the actual retained config bytes. Do not require a live pull or layer execution. Use a structurally valid minimal synthetic image in the positive test, and coherently resealed negatives for missing/malformed layers, malformed config descriptor, incorrect config size and malformed required config fields. Continue keeping host authenticity and actual image execution outside this pure verifier.

### L00-R1-02 — Reported checker identity does not identify the validator/reference bytes actually used

Location: `source/scripts/native-handoff.mjs:19`, `:21`, `:22`; dependency evidence: imports in `source/packages/lab-runtime/src/v2/sil/native-handoff-documents.ts:15` onward.

The short digest intentionally covers six files. Static admission also imports validators, canonical model/world/PUMA reference documents and schemas outside that set. The CLI reports only `git rev-parse HEAD` for those remaining inputs; it neither checks their working-tree bytes against that commit nor reports/refuses a dirty checker. Changing an imported reference or validator therefore leaves both reported checker fields unchanged while changing admission behavior. A copied checkout where Git lookup fails still returns the same successful assessment with `sourceCommit:null` and only the incomplete short digest.

This matters particularly because exact whole-document equality is the principal boundary that makes the five static adapters safe: the expected bodies must be the recorded pinned corpus. The documented statement that the checker Source commit pins the remaining corpus is true only when the running bytes are actually bound to that commit. The producer's clean export and root audit establish the retained current handoff's identity; they do not enforce this condition for subsequent recipient CLI invocations. This finding does not allege the retained clean package was tampered with and does not demand that the short digest be relabeled a full closure hash.

Required correction: bind effective checker inputs to the reported identity. For example, require and verify the relevant clean Source checkout before assessment and fail closed when the remaining corpus cannot be tied to its commit; alternatively record and verify an effective transitive checker artifact identity. A distinct short digest can remain. Add a focused regression showing that changing an imported model/validator outside the six-file list cannot produce a successful assessment with the same checker identity, plus an explicit copied/no-Git policy. Preserve the independent subject/checker tuples.

## Specification assessment and strengths

- The manifest is versioned and strict at its top-level/ref boundaries, with separate subject/checker tuples, Source/Lab receipts, schema aggregate, portable/native closures, runtime/profile/model hashes, required/forbidden packages, seeds, SI units, frames, and fixed Source/lost-ACK policies. Unknown manifest launch fields and roles cannot become executable instructions.
- Transport checks bound ref count, declared total bytes and individual reads; understated files are rejected before allocation. Export copies only declared refs, refuses an existing output, rechecks bytes and writes the manifest last. No input-supplied module/command execution or archive extraction was introduced. Secret filtering is correctly described as limited defense in depth.
- The correction parses real documents and applies existing validators plus bounded full-body equality. It does not merely approve a hash or a kind label. Frame trees, axes, inertia, joints/limits, IDs and source-to-projected navigation relationships are checked. Required known schemas are compared to the checker corpus.
- R79/R80 are implemented with five explicit kinds. B05/B06 separately retain source physical/navigation-model identity while binding the outer project/world and exact supported adaptation. There is no arbitrary input replacement or error-ignore mask. Coherently resealed source-projection, outer geometry, axis/inertia/limits/ID, mapping, schema and PUMA/AMR negatives materially test semantic refusal after transport resealing.
- PUMA uses the existing controller reference model, manifest, frame/pose hashes, vendored HAL origin and exact controller profile. Its inch/degree/radian conversion, JOINT ordering/sign/offset/limits and illustrative placement are explicit; no physical calibration or inertia is invented. ROS canonical AMR/xArm always retain their unresolved native mapping prerequisite.
- R81 is documented as a genuine unsupported historical arm-only shape assigned to L01. L00 does not silently substitute newer files or claim exact historical-image preparation. This ownership adjustment is accepted scope, not a review defect.
- OCI/native_apt are discriminated by subject execution kind. Native package/source maps and actual retained source bytes are checked; unknown provenance, unresolved locks, wrong ISA/model/subject and image:null block readiness. The current R2b image remains unbuilt. Native readiness is kept distinct from qualification, acceptance, host authenticity and device permission.
- The two-argument legacy profile validator's predicate is unchanged; macOS hostPreflight/resourceDecision behavior is unchanged apart from an additive collector export. The generic collector leaves origin/emulation/image/subject/software locks unresolved. The third argument is explicitly an in-memory expectation check; disk provenance belongs to the handoff verifier.
- Lab changes consist of the exact new runtime pin and regenerated source-commit comments; engineering/navigation generated content hashes remain unchanged. No application route, hardware path, native execution or qualification acceptance is added.

Neither finding is mandated by an approved plan requirement. They are implementation gaps at the required admission/identity boundaries. The deliberately narrow static body support and the native L01–L04 follow-up obligations are not defects in L00.

## Test and evidence assessment

Read the complete task brief, R78–R81 and full implementation report including its preserved first handoff, explicit withdrawal, correction and final evidence. Read the complete supplied Source original-base package (129,077 bytes) and Lab package (3,657 bytes) in bounded passes; no Git diff was reconstructed. Line locations for the findings were extracted from those supplied new-file hunks.

The semantic negative tests use real pinned documents and resealing helpers. Their assertions exclude transport/hash/receipt failures in the central semantic helper, so the correction is materially stronger than self-confirming transport fixtures. The source-projection negative explicitly expects MOBILE_PROJECTION_MISMATCH. However the OCI positive fixture is structurally too weak, as L00-R1-01 describes. Some inventory negatives also invalidate their provenance seal; the implementation predicates are present, but resealing those tests would better isolate their intended refusal reason. This latter observation is not a separate blocking finding.

Inspected existing final focused-test, contracts, typecheck and lint logs. The focused log records 95 passed tests (51 security, 37 unit, 5 unchanged legacy integration, 2 unchanged preflight); contracts generation matches; typecheck records route generation and tsc invocation without failure; the final lint log is empty. No tests were rerun. The report correctly distinguishes genuine pre-implementation RED, mutation RED with the semantic gate disabled, stale-seal failures and incidental type/index failures; none was treated here as stronger evidence than recorded.

Read root-L00-handoff-static.json. Its independent audit records 239 refs / 10,724,081 bytes, no mismatches, exact final commits, runtime `139c32da…`, manifest `64e8049c…`, schema `07e01e8e…`, portable closure `9e84b636…`, image:null and preserved report prefix. These are controller-audited byte/identity results, not a new reviewer rehash or proof of native behavior. The clean retained concrete handoff can remain a prepared artifact with nativeReady:false while the general verifier is corrected.

## Focused checks outside the diff

Named risk: adding native-inventory/Ajv/schema imports to profile-report/host-preflight could break the exported native-tool closure if those scripts were executed from that closure. Read only the exporter import/bundle boundary and `scripts/native-sim/tool-identity.mjs`. The exported native closure is explicitly Python/controller resources and schemas, while the runtime exporter bundles JavaScript dependencies; the handoff CLI runbook requires a checker Source checkout with pinned dependencies. No omitted standalone script dependency defect was established. This was not a broad dependency crawl. Three guessed tool-identity paths did not exist; the exporter’s actual import led directly to the relevant file.

Also checked R3 spec §4 and its adjacent R78/R79 clarification to resolve whether incomplete OCI prerequisite documents and effective checker/model identity fall within preparation. One initial guessed `specs/` path did not exist; the exact root-level spec was then read. No unrelated requirements were expanded into this task.

## Cannot verify from diff / external limits

- Authentic host origin, package provenance trust/signatures, actual installed software, image availability and execution, timing/TF/controller behavior, calibration, native performance and hardware remain unverified; supplied consistency is not attestation.
- Actual WEB05 container execution remains blocked under R76. No cloud/Docker/native/hardware action, historical SQLite open or image reconstruction was attempted.
- The report's old-image tuple and complete export/pin history are supported by supplied report/root audit, not independently reconstructed from historical runtime/image contents during this review.
- No full repository suite or runtime campaign was run or inferred. Imported existing validators were assessed at the new call sites and through bounded whole-body checks, not broadly re-reviewed.

Only this review report was written. Code, index and HEAD were not mutated; no helper/subagent was spawned. Controller owns follow-up and cross-task checks.
