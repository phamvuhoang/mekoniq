Scoped re-review L00 fix round1/5. Full task review already occurred; verdict each existing finding and inspect new fix breakage only.

Requirements: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L00-brief.md
Prior full review: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L00-review-1.md
Full implementation report with appended fix: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L00-report.md

Findings verbatim:

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



Exact FIX BASE: Source2b7d39cdeab06b499e9037aef1a24f1babe03a4f; Labfd4365291f6db7fdcbd72407f94ac7c0f35a20b4.
Exact final HEAD: Source298db9bdbc207b14bdbef78ec8d70adf4e901c71; Lab7698aa628fc9a60598d1337b292bdcec2fe91fdc.
Complete Source fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-2b7d39c..298db9b.diff.
Complete Lab fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-fd43652..7698aa6.diff.
Root check/evidence handoff: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L00-r1-handoff.json; root read entire appended fix report, checked actual 239refs/manifest/runtime/pin/short-checker hashes and preserved35537-byte report prefix plus both old manifests. Recorded115tests/types/lint/contracts/export/pin logs inspected. No native/browser/container run or suite repeat..

Read supplied fix packages once in bounded passes, not reconstructed Git diffs. Reread changed code only if necessary hunk is cut mid-function and state why. Outside-diff checks need a concrete named dependency risk; no broad crawl. Treat report as claims and inspect its exact covering test commands/output; no suite rerun without a specific unresolved code doubt. No native/cloud/Docker/hardware/image execution or historical SQLite opening.

Preserve R78–R81: OCI/native_apt/profile separation, exact static-supported document kinds, current R2b image null/unbuilt and nativeReadyfalse, ROS mappings unresolved, historical arm-only staged toL01. Prepared/consistency is not host authenticity, native execution or acceptance. Review actual fix behavior; a stated plan rationale does not downgrade a defect.

Read-only code/index/HEAD, no helpers/subagents. Write only /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L00-review-2.md. Verdict L00-R1-01 and L00-R1-02 ADDRESSED/NOT ADDRESSED with file:line; list new fix-introduced C/I/M breakage separately, outside-fix observations nonblocking for finaltriage, then explicit fix-round verdict. Return concise finding verdicts/IDs and report path. No implementation fixes.
