# B08 fix round 1 scoped re-review

Verdict: **findings remain**. Original Important I1 is **NOT ADDRESSED completely**: the registered physics and empty-load content checks now close the demonstrated mutations, but the new physical-model admission can accept a different navigation document type as the bound physical model.

Reviewed fix bases Source `709a797fa791727d0a8c830e935e0d80192843b0` / Lab `3a904c21bb5805c1f6a4fa3d3bd096873d53ba41`, through Source `922abb77fbd3315038584b63599032db61d1b665` / Lab `0e3edb8dab9ad8678fa62c58fd08178ed3298db1`. Scope is the supplied complete four-file Source fix diff and three-file Lab pin diff, original I1, and direct fix risks. This is not a whole-branch review.

## Original Important I1 — NOT ADDRESSED completely

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

## New findings introduced by the fix

No separate new Critical, Important or Minor regression identified. The issue above is the remaining original I1 requirement in the newly added admission helper. No shared validator/helper implementation changed; existing load admission is reused read-only. Lab changes are pin/provenance only.

## Checks and evidence read

- Read task brief, full fix report, main report fix append, and complete supplied Source/Lab fix diffs once. No changed product file reread or regenerated diff.
- Focused dependency read for whether bytes/file refs and self-digests are actually established: `simulation-input.ts`, `load-profile.ts`, and the `validateNavigationDocument` dispatch in `navigation2d/contracts.ts`.
- Focused schema read for the concrete discriminator risk: `navigation-model-2d-v1.schema.json` and `robot-physical-model-v1.schema.json` document-type and shared identity fields. This led to the single in-memory probe above. No routine test, suite, native or browser rerun.
- Read RED output for all eight mutations (8 failed on complete versus incomparable; 16 filtered tests are not passes), GREEN output (50 passed across semantic/physics/payload/contract files), affected Lab view/replay output (10 passed), Source contract output, type/lint logs, and Lab type/check:source/sync/import output. Empty type/lint logs have no independent exit marker; the report/root handoff supplies their exit-0 confirmation.
- Read export identity output and new `evidence-B08/fix1/final-identities.json`, complete `readback-final.log`, and retained `readback.mjs`. The genuine valid CLI output remains byte-identical, SHA256 `2738b3ab02c44cad745c53f47ef962d2d89c9f8cb7de90bfe9c69dada42b2412`; all eight listed mutants pass upstream integrity and reject semantically. The script writes new outputs exclusively outside the original recording.
- Producer Source remains `709a797`; current validator/export/pinned Source is `922abb7`; Lab is `0e3edb8`; artifact SHA256 is `a8e61a78f9cd683129a3d8d779204c9b9641046060123669b107a22a664d8b99`. No producer/compiler/controller/measurement/UI/fixture/schema change is present in the fix diff. Reports preserve these separate identities and claim no new native/browser/performance qualification.

## Out-of-scope observations and limitations

Original review M1 remains deferred; unchanged stale-hash negatives are not reopened here. The retained inventory proves non-SQLite file bytes plus SQLite file metadata, not SQLite byte contents. Hash consistency is not producer authentication or human acceptance. The historical one-run-per-engine population, untriggered cancel/unknown clauses, `not_calibrated` dynamics, unavailable benchmark/native-Linux/device/hardware gates and `accepted:false` remain unchanged. The reviewer did not open SQLite, rerun engines/browser suites, edit product or Git state, or write to original evidence. Only this ignored review report was written.

**Findings remain: Important I1 requires the physical-document discriminator and a coherent regression.**
