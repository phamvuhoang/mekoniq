# B08 fix2 — Require the bound document to be a physical model

Status: DONE_WITH_CONCERNS; ready for root's scoped review3. Exact fix bases: Source `922abb77fbd3315038584b63599032db61d1b665`, Lab `0e3edb8dab9ad8678fa62c58fd08178ed3298db1`. This corrects only the remaining Important I1 discriminator and its direct regression. Earlier eight profile/load guards stay intact; Minor M1 remains deferred.

## Correction and scope

Source `714e37f9b8251663c3d7a3d3e668a0c35ca2d493` — `fix: require a physical document for semantic load binding` (3 files,22 insertions/3 deletions):

- `semantic-study-profiles.ts`: the model-binding condition now explicitly rejects `model?.documentType !== 'robot-physical-model'` **before** calling the generic supported-navigation-document validator. Thus a valid `navigation-model-2d` with matching robot/inputs/digest fields cannot impersonate the physical document. The TypeScript `RobotPhysicalModelV1` generic cast is not treated as a runtime check. The generic validator itself is unchanged.
- `tests/support/simulation-study-mutations.ts`: adds `substituteStudyPhysicalWithNavigation`, cloning a valid navigation model into the physical-model path, rebinding the load modelRef, resealing the dependent navigation model and its artifact, both scene copies, report model/scene/profile mirrors and physics identity/manifest hashes. Original input is cloned, never changed in place.
- `tests/unit/semantic-study.test.ts`: new regression first establishes successful generic upstream integrity, valid substituted navigation document, matching robot/current inputs and bound digest. With the original equivalence declaration, semantic study must then return incomparable / INPUTS_NOT_EQUIVALENT / SEMANTIC_LOAD_MODEL_BINDING_MISMATCH. It also verifies no mutation of the original fixture.

Lab `4741edfcda3b421197235c50daed7c09b340bedf` — `chore: pin source runtime 714e37f` (3 files,4 insertions/4 deletions): normal Source/artifact pin and generated provenance headers only. No producer/compiler/controller/worker, measurement, physics A/B, fixture bytes, shared validator, schema or UI behavior changed. No helpers or reviewers were delegated; root owns re-review. No original main edit, push/merge/deploy/provisioning/hardware operation occurred.

## RED/GREEN and covering checks

Logs are under `.superpowers/sdd/02-r2b-cell-and-web/evidence-B08/fix2/`. Commands use `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"` (Node24.22.2/pnpm10.32.1). Silent successful checks have explicit `EXIT_CODE=0` markers captured immediately from their command status.

1. **RED**, before production guard: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts -t 'coherent navigation document'`. `red-discriminator.log`: **1 failed /24 filtered**, expected incomparable but received complete. All generic-integrity/document-validity/rebound-field assertions passed before the intended semantic assertion failed. The wrapper displayed the log afterwards and returned0; the RED test failure is the explicit Vitest assertion/result, not claimed as a successful run. The filtered24 are not passes from this command.
2. **GREEN**: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts tests/unit/physics-comparison.test.ts tests/unit/payload-fixture.test.ts tests/contracts/mujoco-payload.test.ts`: exit0, **51 passed /4 files** (semantic25,physics7,payload3,contracts16), no skips. `green-discriminator.log`, explicit EXIT_CODE=0.
3. `perl -e 'alarm 120; exec @ARGV' pnpm exec tsc --noEmit --pretty false`: exit0, `typecheck.log`, explicit EXIT_CODE=0.
4. `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts tests/support/simulation-study-mutations.ts tests/unit/semantic-study.test.ts`: exit0, `lint.log`, explicit EXIT_CODE=0.
5. `perl -e 'alarm 180; exec @ARGV' pnpm contracts:check`: exit0, contract generation matches schema, `contracts-check.log`, explicit EXIT_CODE=0.
6. Entire staged Source/Lab fix ranges self-reviewed, including runtime discriminator evaluation rather than generic-type assertion. `git diff --cached --check` passed before each commit; both worktrees are clean.

## Actual retained readback: producer and validator remain distinct

Ruling73 authorizes this pure offline consumer/test correction to use the original genuine clean X01 recording, **without native/browser reruns**. Producer remains `709a797fa791727d0a8c830e935e0d80192843b0`; new validator is `714e37f9b8251663c3d7a3d3e668a0c35ca2d493`. Old manifests, original/fix1 identity files and earlier reports are not relabeled or rewritten.

Final command:

`B08_FIX2_OUT=/tmp/mekoniq-b08-fix2-readback-final-714e37f-20261115-0212 perl -e 'alarm 360; exec @ARGV' node /tmp/b08-fix2-readback-final.mjs`

Exit0 (`readback-final-2.log`, explicit EXIT_CODE=0). Script retained as `evidence-B08/fix2/readback-final.mjs`; executed from /tmp, no temporary runnable TypeScript under .superpowers. It calls the actual Source CLI with exclusive outputs, bounded90s child deadlines, validates pure-API/CLI equality, preserves original producer claims, and writes only to the new task-owned output directory.

- Genuine valid `/tmp/mekoniq-b08-x01-final-709a797-20261115-0110/study-input.json` → CLI exit0,complete, output **byte-identical** to the original study, SHA256 `2738b3ab02c44cad745c53f47ef962d2d89c9f8cb7de90bfe9c69dada42b2412`. Original12 pass/6 untriggered not_run/0fail, accepted:false and percentiles:null remain unchanged.
- New `navigation-as-physical` fixture: generic upstream integrity passes; substituted document is valid navigation-model-2d with coherent rebound digests/refs. CLI exit1,incomparable, INPUTS_NOT_EQUIVALENT and **SEMANTIC_LOAD_MODEL_BINDING_MISMATCH**.
- All earlier eight boundaries also pass generic upstream integrity and CLI exit1: friction/solver/actuator → SEMANTIC_PHYSICS_BASELINE_REQUIRED; deliberately unsealed profile digest → SEMANTIC_PHYSICS_DIGEST_MISMATCH; nonempty → SEMANTIC_EMPTY_LOAD_POPULATION_NOT_EMPTY; malformed empty → SEMANTIC_EMPTY_LOAD_INVALID; model hash/path → SEMANTIC_LOAD_MODEL_BINDING_MISMATCH. All9 mutated inputs/output JSON are retained under `mutants/`, explicitly synthetic offline negatives, never native observations.
- Complete new audit: `/tmp/mekoniq-b08-fix2-readback-final-714e37f-20261115-0212/readback-audit.json`, SHA256 `b55e0f19caf81fe8c61ec10c1c70ca3678f908053a1dc2d187e03c10f15a8892`, with each input/output hash and actual child exit.
- Original211-file inventory unchanged: byte hashes for non-SQLite files and file metadata for SQLite. **No SQLite engine/content access**. This inventory does not claim to hash SQLite contents. Original identity JSON SHA stays `1d9abeb3e282c38f7c13a0d7d6f93edd8d71cdbd06e10004f3125c71249f9eee`; fix1 identity JSON SHA stays `200e3c921082b6a55fc431d713f3d7cbf27bbe9a9bee09caba271ac4ec155038`.

### Preserved unsuccessful readback orchestration

First attempt used `/tmp/b08-fix2-readback.mjs`, outer180s and child30s, output `/tmp/mekoniq-b08-fix2-readback-20261115-0142`. The valid original and first substitution/friction/solver/actuator outputs were produced, then the harness failed `null !== 1` on a child result; wrapper exit1 is retained in `readback-final.log`. The first harness did not retain that child's error/signal, so its exact cause is not proven solely by that null status (a30s timeout was configured). This is not a successful9-case readback and is not counted as such. Its files are preserved; a direct substitution CLI probe also returned exit1 and the intended model-binding reason. No lingering owned CLI process remained. The final attempt added child diagnostics and a bounded90s allowance, then completed all9 cases with explicit exit outcomes, without product changes or native execution. `readback.mjs` preserves the first harness and `readback-final.mjs` the successful one.

## Clean export/pin and affected Lab checks

Each command below returned0 with an explicit EXIT_CODE=0 in its named log:

| Worktree | Command | Log / result |
|---|---|---|
| Source | `perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-b08-fix2-export-714e37f-20261115-0143` | export.log; clean714e37f |
| Lab | `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-b08-fix2-export-714e37f-20261115-0143` | lab-import.log |
| Lab | `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs` | lab-sync.log |
| Lab | `perl -e 'alarm 120; exec @ARGV' pnpm check:source` | lab-check-source.log; verifies714e37f/schema53af.../protocol1+2 |
| Lab | `perl -e 'alarm 120; exec @ARGV' pnpm typecheck` | lab-typecheck.log |
| Lab | `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs --check` | lab-sync-check.log; contracts match |
| Lab | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study-view.test.ts tests/unit/report-replay.test.ts` | lab-views.log; **10 passed /2 files**, no skips |

Final separate tuple: `evidence-B08/fix2/final-identities.json` asserts current Source/validator/export/pinned Source714e37f, Lab4741edf, both trees clean, export dirty:false and runtime bytes matching the pin. Native producer709a797 is explicitly different.

- Runtime artifact SHA256: `b239d9620d544d90f876be403034b5917887ecf45c86a689587baf19989fb787`.
- Unchanged schema hash: `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9`.
- Unchanged portable tools digest: `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9`.
- Original and fix1 identity files remain unchanged; fix1 report SHA remains `66f4d72ea8a87e0fe680e71a9868d26d5e7d5cf0284311cc999516c731678aee`. Prior main-report prefix saved at `evidence-B08/fix2/pre-append-report.md` and preserved before appending this fix summary.

## Limits

Root owns scoped review3; the remaining I1 discriminator is now implemented and covered, not asserted independently reviewed. M1 stays deferred. Native/browser/performance execution for fix2 is not_run by ruling73 for this guard-only boundary; no old record is relabeled. Existing uncalibrated mechanics, one-run population, absent unknown/cancel triggers, optional benchmark not_run, lack of native-Linux/device/hardware acceptance, and accepted:false remain. FinalB10 records the final all-changes producer tuple. No new producer/shared-runtime/UI boundary or architecture blocker arose.
