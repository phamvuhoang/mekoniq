Resume B08 fix round2/5. Root read the full scoped review2; original I1 remains open only for the physical-document discriminator/model binding below. Earlier baseline-profile and empty-load content checks were verified addressed; preserve them.

Read task-B08-brief.md, task-B08-fix-1-report.md and task-B08-review-2.md in this directory. Work in existing Source/Lab feature worktrees only. Exact FIX BASES (previous reviewed heads): Source922abb77fbd3315038584b63599032db61d1b665 / Lab0e3edb8dab9ad8678fa62c58fd08178ed3298db1. No helpers/reviewer, no original-main/evidence changes, no push/merge/deploy/hardware.

## Remaining finding verbatim



The original changed-baseline-profile reproduction is addressed. `packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts:10`–`15` binds the registered profile reference/file, verifies its self-digest, and requires the locked baseline stored-byte SHA256. Lines 16–20 validate the registered empty-load reference, closed load schema/semantics/self-digest, zero population and registered shape. `semantic-study.ts:16` invokes this admission before deriving equivalence. New coherent mutation tests at `tests/unit/semantic-study.test.ts:77` verify generic upstream admission before requiring semantic rejection; the provided retained-X01 readback also proves unchanged valid output.

**Remaining Important admission gap: require the bound document to be a physical model.** At `packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts:22`, `validateNavigationDocument(model).ok` accepts any supported navigation document type. The `RobotPhysicalModelV1` generic cast on line 21 has no runtime effect. The validator dispatches by the supplied `documentType` (`navigation2d/contracts.ts:153`–`164`); a valid `navigation-model-2d` document has the same `robotId`, `inputs` and `modelDigest` fields tested here. Its schema explicitly identifies that different type (`packages/contracts/schemas/navigation-model-2d-v1.schema.json:11`). Consequently the check does not establish that `empty.modelRef` names a validated `robot-physical-model`, as the fix report claims.

I confirmed this with the one allowed focused read-only probe, using actual retained clean-X01 input and the current validator. Command shape was Node24 `node --input-type=module` with `tsImport` of `sealDocument`, `buildSemanticStudy`, `verifiedSimulationInput`, and the existing test `artifact` helper. It read `/tmp/mekoniq-b08-x01-final-709a797-20261115-0110/study-input.json` and made these changes only in memory:

1. Store a clone of the original valid MuJoCo navigation model (document type `navigation-model-2d`) at `physical-model/amr-1.json`, replacing the physical document. Recalculate its stored-byte ref and scene file entry.
2. Rebind and reseal `empty.json.modelRef` to those bytes; update its scene engine reference.
3. Rebind the scene robot navigation model's `physicalModelDigest` to the substituted document's `modelDigest`, reseal the navigation model and its declared artifact copies, then reseal the scene and both scene artifact copies.
4. Recalculate navigation report scene/model/profile references, manifest scene identity and physics manifest scene/profile identity mirrors; recalculate the physics manifest artifact hash and report stored-byte ref. Retain the original common equivalence declaration.

Actual stdout, exit 0:

```text
upstream integrity passed
{"substitutedDocumentType":"navigation-model-2d","status":"complete","reasons":[],"accepted":false}
```

`verifiedSimulationInput` passed before `buildSemanticStudy` returned this result. This does not rely on a stale outer seal. It is an offline input-admission defect: a nonphysical document can supply the claimed physical model binding while the consumer still declares the empty-load/baseline experiment complete. It makes no producer-authenticity or historical-recording claim.

Require `model.documentType === 'robot-physical-model'` before accepting the generic validator result (or use a validator narrowed to that type). Add this coherent replacement/rebinding case as a regression that first passes generic upstream integrity and then returns `INPUTS_NOT_EQUIVALENT` with the model-binding reason. The current eight negatives test changed load-model path/hash, but not a coherent replacement of the referenced document. This remains within ruling73's offline consumer boundary; no native rerun is justified solely by this correction.


## Required correction / evidence
Fix this remaining discriminator and add the coherent rebound-document regression. tests/unit/semantic-study.test.ts and tests/support/simulation-study-mutations.ts are the named covering seams; re-run appropriate existing semantic/profile contract tests for the changed gate and mutator, with RED/GREEN exact commands/output. The new regression must first prove generic upstream integrity succeeds, then assert the intended semantic model-binding rejection. Do not broadly weaken or refactor validators, expand accepted model types, or change producer/controller/physics/schema/UI. Minor M1 stays deferred.

Existing ruling73 still applies without a new exception: pure offline consumer/test correction, no native/browser rerun merely for this guard. Read valid retained original Source709a797 X01 via immutable JSON; write new readback results to a new task-owned directory, verify valid output remains byte-identical and the new coherent substitution plus existing eight mutant boundaries reject. Preserve original producer identity, original recording and original/fix1 identity files. Record the new validator separately. No original SQLite engine/content access; inventory scope must distinguish non-SQLite byte hashes from SQLite metadata as in fix1. Revisit execution scope if you touch a producer/shared runtime/UI boundary beyond this guard.

Use Node24.22.2/pnpm10.32.1 and bounded commands. Source commit -> clean export -> Lab import/sync/check/type/pin, with appropriate cheap affected contract/view checks. Retain exact exit outcomes in the report even for silent successful type/lint commands. Self-review the complete fix range, including runtime document type rather than relying on the TypeScript generic cast. Do not launch a new native campaign or change original artifacts to align identity.

Write task-B08-fix-2-report.md here and append fix2 summary to task-B08-report.md without altering prior prefixes/reports. Include changes, all covering commands/output, valid/mutant readback and producer/validator/pin identities, original-preservation scope, failures/limits. Return short status/commits/checks/concerns/report path. Root will generate scoped review3 from the exact FIX BASES above after reading the complete handoff.
