L00 fix round1/5. Resume original implementation; root read full independent review1 and accepts both Important findings as existing required-boundary gaps. Requirements remain task-L00-brief.md + R78–R81. No plan conflict/ruling needed for these fixes.

Fix BASE Source2b7d39cdeab06b499e9037aef1a24f1babe03a4f / Labfd4365291f6db7fdcbd72407f94ac7c0f35a20b4. Original taskBASEd0f3074/176bf34 retained for full accounting; scoped rereview uses this FIX BASE.

Full reviewer report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L00-review-1.md
Verbatim open findings:

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



Use genuine coherent RED/GREEN tests. I1 positive image must be structurally valid, with resealed negatives reaching OCI structure/descriptor relationships. Consult official OCI/Docker primary specs if needed; no image pull/build/native execution. I2 needs an explicit fail-closed policy for dirty/unbound/copied/no-Git checker inputs or an actual effective artifact identity, preserving subject/checker independence. Do not make a dirty/unverifiable checker silently succeed or introduce a test-only bypass that weakens normal admission. Use bounded isolated fixtures/copies for dirty-input regressions; do not mutate original main/checkouts or retained canonical evidence. If clean-checkout verification changes CLI test setup, document that setup and preserve genuine failed attempts rather than marking them skipped/pass.

Cover amended tests/unit/native-handoff.test.ts, tests/security/native-handoff.test.ts and appropriate focused CLI/checker-identity regressions, plus existing legacy host/profile tests once in final combined check. Source contracts/type/lint for changed surfaces; clean commit→new unique export→Labimport/sync/check/type→pin, and a NEW concrete prepared package/verification at the final identities. Preserve both previous handoff directories and report prefixes; append fixreport with exact commands/output/paths/identities. Old actual logs are not retagged. No physics/browser/container/fullrepo repeat unless the fix touches such a boundary with a concrete reason.

No helpers/subagents. Root owns scoped independent rereview. Return shortstatus/commits/checks/concerns/report path. Do not push/merge/deploy/provision/connect hardware.
