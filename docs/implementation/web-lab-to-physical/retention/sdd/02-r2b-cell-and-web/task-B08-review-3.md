# B08 review 3 — scoped fix2 re-review

Verdict: remaining Important I1 **ADDRESSED**. No new Critical, Important or Minor finding introduced by this fix.

## Scope

Reviewed supplied complete Source diff `922abb77fbd3315038584b63599032db61d1b665..714e37f9b8251663c3d7a3d3e668a0c35ca2d493` and Lab diff `0e3edb8dab9ad8678fa62c58fd08178ed3298db1..4741edfcda3b421197235c50daed7c09b340bedf`, once in their supplied review packages. Read the B08 brief, full fix2 report and main-report addenda. Root's dispatch supplies independently verified clean HEAD identities and completed command/output gate. This is the remaining discriminator finding and fix-introduced regression review, not another full B08 review.

## I1 — ADDRESSED

`packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts:22` now tests `model?.documentType !== 'robot-physical-model'` before `validateNavigationDocument(model).ok`. JavaScript short-circuit evaluation therefore rejects a valid document of the wrong supported type with `SEMANTIC_LOAD_MODEL_BINDING_MISMATCH`, independently of the TypeScript generic assertion. It retains the existing path, stored hash/size, robot, current-input and physical digest binding checks. The unchanged preceding baseline physics byte/self-digest and empty-load schema/population/shape checks remain in the supplied context. Generic navigation validation itself is unchanged.

`tests/support/simulation-study-mutations.ts:27`–`37` constructs the actual substitution: clone input, store the original valid navigation model at the physical-model path, update its scene file ref, reseal the navigation model with the substituted model digest as its physical digest, update the navigation artifact and report model mirrors, then rebind/reseal the empty load and dependent scene/report/physics mirrors. `tests/unit/semantic-study.test.ts:87`–`91` calls `verifiedSimulationInput` before semantic evaluation, asserts the substituted document is valid `navigation-model-2d` and retains coherent robot/current-input/physical digest bindings, then requires incomparable / INPUTS_NOT_EQUIVALENT / SEMANTIC_LOAD_MODEL_BINDING_MISMATCH. Original fixture serialization is preserved.

The retained RED log fails precisely at expected incomparable versus received complete after upstream assertions; its 24 filtered tests are not passes. GREEN records all 51 focused Source tests passing, including the new regression and all eight prior admission negatives. This establishes that the new test exposes the previous discriminator hole rather than merely exercising a stale outer hash.

## New findings and dependency check

No new Critical/Important/Minor findings. The single production addition only narrows this consumer's physical-model admission; genuine physical documents retain the prior evaluation path. Lab changes are pin/artifact identity and generated provenance headers only, with schema/content hashes unchanged. There is no producer/compiler/controller/worker, physics/measurement or UI behavior change in these fix ranges.

One focused outside-diff dependency read: complete `tests/support/simulation-study-mutations.ts:7`–`24`, because the supplied helper hunk begins midway through `resealStudyProfile` and the new substitution depends on its clone/reseal and reference propagation semantics. It clones input; seals the changed load and both scene copies; updates scene/profile/report and physics manifest byte identities. Its implementation is unchanged, and the new caller does not alter the eight existing callers. No other outside-diff product code was read; no helper agent was spawned.

## Evidence checked

Read actual retained logs, not only report summaries:

- `red-discriminator.log`: one intended assertion failure; 24 filtered.
- `green-discriminator.log`: 51 passed / 4 files, explicit EXIT_CODE=0.
- `typecheck.log`, `lint.log`, `contracts-check.log`: explicit EXIT_CODE=0; contract generation matches schema.
- `export.log`, `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`, `lab-sync-check.log`: explicit EXIT_CODE=0; clean Source714e37f export, import/pin, matching engineering contracts, schema53af7456… and protocols1/2. Parsed export identity from its full retained JSON; artifact is b239d962….
- `lab-views.log`: 10 passed / 2 files, explicit EXIT_CODE=0.
- `readback-final.log`: preserved unsuccessful orchestration, null child status versus expected1, EXIT_CODE=1. It does not retain child error/signal; exact cause remains unproven. A configured30s deadline alone does not establish a timeout. This attempt is not counted as a completed nine-case pass.
- `readback-final-2.log` and retained `readback-final.mjs`: successful bounded diagnostic readback, explicit EXIT_CODE=0. Script checks generic upstream integrity before each semantic rejection, actual CLI exit and API/CLI equality, writes exclusive separate output files, and compares original inventory/identity hashes before and after.
- New `fix2/final-identities.json` and actual retained `/tmp/mekoniq-b08-fix2-readback-final-714e37f-20261115-0212/readback-audit.json`: independent read-only SHA256 equals b55e0f19caf81fe8c61ec10c1c70ca3678f908053a1dc2d187e03c10f15a8892. All nine entries record upstream integrity success, CLI exit1 and incomparable; new substitution has the exact model-binding reason. Earlier eight retain their intended semantic reasons.

Additional read-only checks during this review: actual valid readback bytes equal original `semantic-study.json`, SHA2562738b3ab02c44cad745c53f47ef962d2d89c9f8cb7de90bfe9c69dada42b2412; all nine stored mutant input/output hashes equal audit entries; stored new mutant's navigation type/load byte ref/navigation physical digest/current inputs are coherent. Original and fix1 identity JSON hashes match the recorded 1d9abeb3… and200e3c92…; fix1 report SHA remains66f4d72e…; original main-report prefix remains intact. No test/native/browser/suite rerun was needed or performed.

## R73 and limitations

The native producer remains `709a797fa791727d0a8c830e935e0d80192843b0`; validator/export/pinned Source is `714e37f9b8251663c3d7a3d3e668a0c35ca2d493`, Lab `4741edfcda3b421197235c50daed7c09b340bedf`. Reports and separate identity mapping preserve that distinction. Retained original211-file inventory compares non-SQLite byte hashes and SQLite path/size metadata only; SQLite contents were not read or hashed. Integrity checks are not producer authenticity or human acceptance. No original recording was retagged or edited by this review.

R73 permits retained clean-X01 offline readback for this guard-only change. Native/browser/performance reruns remain not_run; no new native acceptance claim follows. Existing single run per engine, uncalibrated dynamics, absent nominal cancel/unknown triggers, optional benchmark not_run and native Linux/device/hardware/human acceptance limits remain. `accepted:false` is preserved. Final B10 still owns the final all-changes tuple.

Out of scope: previously deferred review1 Minor M1 stale-hash negative-test weakness remains deferred; unchanged tests do not create another fix loop here. No additional out-of-scope observation was found.

All scoped findings addressed; no new Critical/Important findings.
