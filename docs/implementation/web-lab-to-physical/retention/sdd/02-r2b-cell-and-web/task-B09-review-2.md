# B09 scoped independent re-review — fix round 1

**Spec compliance: PASS for the I1/I2 fix scope.** **Task quality: PASS for the I1/I2 fix scope.** I1 **ADDRESSED**; I2 **ADDRESSED**. No new fix-introduced Critical, Important or Minor issue identified. This closes the two implementation findings from review 1; it does not qualify the unbuilt container or close the deferred WEB05 gate. `accepted:false` remains required.

Reviewed Source `f419bdc0ef522f037e4a7717374e9135fbe5fce8..3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` and Lab `701ad719c43572c2981a2542f4c6bbec51f656e5..538ba452c81005010a479f337aab0edbad6e5159`. Scope is the supplied 45,896-byte Source and 3,397-byte Lab fix packages, the exact two prior Important findings, and regressions introduced by those fixes. The brief, dispatch, full fix report, append-only main-report addendum and prior review were read.

## I1 — ADDRESSED

Relevant code: `packages/lab-runtime/src/v2/gateway.ts:68`–`:85`, `:309`–`:334`; regression: `tests/security/lab-run-writer.test.ts:27` onward.

The reservation now belongs to the logical run ID. `serialRun` installs a queue tail before executing work and removes that tail only if it is still the current tail. Entry-based action, writer, archive and expiry operations route through that same run-ID queue. Cold reclaim reads its body, reserves the ID, then resolves the live entry and reads proof metadata inside the reservation. The captured outer handler entry no longer decides cold reclaim construction. Another queued operation cannot install/remove the entry while the reclaim awaits its disk lookup, retained hold or epoch write.

The reservation covers factory selection, retained hold, durable `saveControlEpoch`, and installation/update of the entry. The second reclaim reuses the installed runner and takes `max(memory epoch, persisted epoch) + 1`; it does not replace a live runner or create independent queues for the same run. Failure closes a newly opened recovery runner. Existing authority checks still verify the current map entry, session validity, owner/read access and epoch at execution. Expiry cleanup additionally refuses to delete/close a captured entry that is no longer current.

The new delayed-body regression directly exercises the prior failure interleaving: A waits for its body; B completes cold reclaim at epoch 1; B starts a held reconcile action; A's released body must wait for that action, reuse its runner and publish epoch 2. Assertions cover one construction, persisted epoch 2, the former owner's private 404, and `closes === opens` before fixture fallback cleanup. The fallback cleanup is therefore not masking the close assertion. The root handoff inspected the genuine opens-2 RED and passing GREEN/final writer evidence. The initial invalid-fixture timeout is correctly retained as a fixture failure, not defect evidence.

Private proof validation and identity checks remain before factory opening. Reclaim remains `view_reconcile`, clears readers and sets `readOnly`; it does not grant motion. A focused unchanged dependency check confirms public gateway close waits admitted handler promises before invoking v2 run closure and releasing data-root ownership (`packages/lab-runtime/src/gateway.ts:125` onward). The shared queue therefore remains inside the public handler lifetime; moving the queue out of `Entry` does not release the lease before an admitted reclaim finishes.

## I2 — ADDRESSED

Relevant code: `packages/lab-runtime/src/v2/scenario-runner.ts:80`–`:95`, `:146`–`:150`; public refusal mapping: `packages/lab-runtime/src/v2/gateway.ts:51`; regressions: `tests/integration/lab-runtime-persistent.test.ts:75` onward and `tests/unit/world-runner.test.ts:109` onward.

Explicit `reclaimOnly` now validates retained state after the saved manifest identity check and before `new Run`, Source opening, attachment, report readers or persistence. It also avoids the previous pre-validation mkdir/chmod. Validation requires checkpoint/run/tick identity and plant robot collection; admitted coffee station/cell/arm identities; workload/session/tray collections; retained arm identity, boot identity, sequence/tick, six finite joints, gripper and program/modifier/trace collections; and retained coffee plant identity, tick and required collections.

For a shared world, an empty `world` object no longer passes: a retained snapshot must match run ID and committed tick, carry boot and scene identities, pass the existing Sim3D response schema, and contain the required robot/arm presence. The validator dependency was checked: `navigation2d/contracts.ts:123`–`:126` delegates to the registered Sim3D response schema, rather than merely asserting the TypeScript type. These checks do not require optional tracking, collision, physics or report coverage solely because an older checkpoint lacks it.

The new validation is gated by `reclaimOnly`; ordinary direct creation/reopen keeps the existing directory setup and does not execute the new state validator. The attachment continuation confirms the explicit recovery path retains frozen arm ports and the retained-world path, skips initialization, and reaches persistence only after successful validation. No new worker/world construction or synthetic retained observation was added.

The twelve new invalid-state cases cover missing coffee, arm, joints, boot identity and coffee plant, plus empty world, missing world boot/scene/run identity, mismatched committed tick, and missing shared-world coffee/arm. Each checks the stable refusal, zero Source opens, byte-identical checkpoint and journal, unchanged directory entries, and (for world cases) no additional world construction. Public HTTP coverage verifies wrong proof remains private 404 without factory opening, both recovery refusal codes map to 409, and failed recovery leaves epoch zero. The unchanged intact-world case demonstrates admission with unavailable optional coverage.

The root handoff inspected twelve genuine invalid-state RED failures, the focused GREEN, the separate 500→409 HTTP mapping RED/GREEN, and the related 48-test passing log. The actual Darwin arm64 intact arm test in that log covers retained state/scene preservation and cold/repeated reclaim without respawn after public close. That is valid intact-state Mac lifecycle evidence; malformed-state fixtures remain protocol/mock evidence, and neither is container qualification.

## Fix-introduced findings

None identified. The full fix package contains only the two runtime files and three relevant test files. The Lab package changes only the Source commit/artifact identity and two generated identity headers; schema and tool digests are unchanged. No deployment, worker, physics-lock, hardware route, UI or historical evidence change is present in these packages.

## Evidence and limits

This review inspected code and test assertions and used the explicit root evidence gate for executed results. It did not rerun tests. Root checked 48 related passing tests (zero skipped), the later committed-head writer 8/8, contracts/lint/final typecheck, clean export and Lab import/sync/check/type, clean heads, the actual runtime/pin SHA, and the unchanged original main-report prefix. The later 8/8 repeats coverage and is not added to 48. The final local proof constant only captures an already-validated string for TypeScript narrowing.

The reviewed Lab pin records Source `3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` and artifact SHA256 `18967bcf397be1e1d43ca86fae2cdae3558be90772981c9c112b071ff54aabae`, matching the root-verified clean export. The prior static build-context audit remains tied to `f419bdc` / `75beea81`; it is not evidence of a build at this fix commit.

R76 remains unchanged: image identity **null/unbuilt**; WEB05 **not_run/blocked_environment**. Actual image compile/readiness/arm/mobile/cell execution, named-volume container competition, crash release/committed chunks and finished replay remain B10 gates. Native amd64, public HTTPS/WEB06, Cloud Run and hardware remain unqualified. L00 must retain unresolved R2b image origin and `nativeReady:false`. These are unchanged out-of-scope qualification limits, not reopened I1/I2 implementation findings or new passes.

## Review method

Read the supplied diffs once. The combined tool response truncated the middle of the Source package, so the scenario-runner and persistence-test section was read in one bounded recovery pass; no diff was reconstructed. The changed hunks ended before attachment and action/archive/close continuations, so those continuations were read once to resolve the specific resource-ordering and queue-lifetime risks. The only additional code dependency reads were public gateway shutdown ordering and the referenced Sim3D validator. One exploratory schema-path glob did not match; it changed nothing and did not affect the validator check.

No helper agents, product/index/HEAD changes, test/native/browser/container runs, probes, deployment, historical-evidence rewrite or portable-root mutation. The only written file is this requested review report.
