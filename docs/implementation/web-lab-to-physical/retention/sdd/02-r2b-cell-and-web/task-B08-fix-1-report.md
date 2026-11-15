# B08 fix1 — Close registered semantic physics/empty-load admission

Status: DONE_WITH_CONCERNS, ready for root's scoped re-review. Fix bases: Source `709a797fa791727d0a8c830e935e0d80192843b0`, Lab `3a904c21bb5805c1f6a4fa3d3bd096873d53ba41`. Only Important I1 and direct regressions are addressed; Minor M1 remains deferred. Original task bases and original report/identity prefix remain historical facts.

## Changes and boundary

Source `922abb77fbd3315038584b63599032db61d1b665` — `fix: enforce registered semantic study physics inputs` (4 files,79 insertions/2 deletions):

- New `packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts` verifies the **closed registered contents**, rather than profile names, before semantic equivalence is derived. Baseline physics ref id/revision/path must bind to its verified declared file; its self-digest must match; its stored bytes must equal the locked baseline SHA256 `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`. This covers all baseline material, actuator and numerical settings, including unknown fields or invalid self-digests.
- Empty load must use the registered empty ref id/revision/path, pass the existing closed `validateLoadProfile` schema/semantic/self-digest validator, have zero props, and match the entire registered empty document shape excluding only its own digest and current compiled-model byte binding. Shape SHA256 remains `43176b16326df374a96e5e35a7924172f78a040072aacc7383b053a2362b684c`.
- The resealed load modelRef must point to the current `physical-model/<robot>.json` byte identity in the verified scene file listing. That physical document must validate, match robot id/current scene inputs, and have the physical digest referenced by the scene navigation model. Profile reference mirrors in navigation/physics report identities must agree. No additional input identity is normalized away or admitted merely by adding mutable profile names to the common hash.
- `semantic-study.ts` replaces its old name-only condition with this narrow admission before deriving common projection. Valid output format and content are unchanged. `physics-inputs.ts`, physics A/B, producer/compiler/controller/worker/measurement code, fixture bytes, schemas and UI behavior are unchanged. The existing load validator is called without editing it; no shared A/B admission helper was changed/reused, so no extra B04a readback/native campaign was required.
- New test-only `tests/support/simulation-study-mutations.ts` clones input and reseals changed profile document/file ref, scene files/engine refs/scene digest, scene.json/navigation-scene.json, report scene/model mirrors, navigation profile refs and physics identity/manifest mirrors. Existing artifact paths keep their meaning. It never edits a producer recording on disk or changes the producer Source claim. `semantic-study.test.ts` adds8 cases that first prove `verifiedSimulationInput` succeeds, then require semantic rejection with a specific SEMANTIC_* reason. Seven profiles have valid new self-digests; one intentionally invalid self-digest has all outer file/scene/report refs coherently updated. Old M1 corruption fixtures are not relabeled as stronger semantic tests.

Lab `0e3edb8dab9ad8678fa62c58fd08178ed3298db1` — `chore: pin source runtime 922abb7` (3 files,4 insertions/4 deletions): lock Source/artifact identities plus normal generated provenance headers only. No view/schema changes.

## RED and GREEN commands/output

All logs below are in `.superpowers/sdd/02-r2b-cell-and-web/evidence-B08/fix1/`. Commands use Node24.22.2/pnpm10.32.1 through `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`. Bounded commands ran in the specified isolated worktree. No native/browser, device, hardware, deployment, push/merge, install/provisioning, helper agent or reviewer was invoked.

1. **RED**, Source: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts -t 'coherent resealed'` → exit1, **8 failed**,16 filtered/skipped. Each failed because expected incomparable but received complete; the upstream-integrity assertion had passed first. Cases: friction0.99, solver iteration, actuator gain2.01, unsealed physics self-digest, nonempty load, malformed empty load, modelRef hash, modelRef path. `red-admission.log` retains complete output. The filtered16 are not claimed passed by this RED run.
2. **GREEN**, Source: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts tests/unit/physics-comparison.test.ts tests/unit/payload-fixture.test.ts tests/contracts/mujoco-payload.test.ts` → exit0, **50 passed /4 files** (semantic24,physics7,payload3,contracts16), no skipped cases. `green-admission.log`.
3. Source: `perl -e 'alarm 120; exec @ARGV' pnpm exec tsc --noEmit --pretty false` → exit0, no errors, `typecheck.log`.
4. Source: `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/simulation3d/semantic-study.ts packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts tests/unit/semantic-study.test.ts tests/support/simulation-study-mutations.ts` → exit0, no errors, `lint.log`.
5. Source: `perl -e 'alarm 180; exec @ARGV' pnpm contracts:check` → exit0, contract generation matches schema, `contracts-check.log`.
6. Full staged fix diff self-reviewed and `git diff --cached --check` passed before Source/Lab commits. Both relevant worktrees are clean after the commits. No broader schema/UI/producer boundary was introduced.

## Genuine retained X01 readback and coherent mutants

Controller ruling73 explicitly authorizes this **consumer-only** fix to use the genuine prior clean recording rather than rerun native X01. Producer remains Source `709a797fa791727d0a8c830e935e0d80192843b0`; new validator is `922abb77fbd3315038584b63599032db61d1b665`. They are distinct and never substituted into old manifests.

Original recording is `/tmp/mekoniq-b08-x01-final-709a797-20261115-0110`. Original `study-input.json`, reports, scene/model/raw artifacts, recording headers, final study and prior `evidence-B08/final-identities.json` remain unchanged. The readback audit compares a211-file inventory before/after: non-SQLite bytes/hashes and SQLite file metadata; **SQLite contents were never read and no SQLite engine was opened**. Original identity file SHA256 stays `1d9abeb3e282c38f7c13a0d7d6f93edd8d71cdbd06e10004f3125c71249f9eee`.

Actual command, Source:

`B08_FIX1_OUT=/tmp/mekoniq-b08-fix1-readback-20261115-0130 perl -e 'alarm 180; exec @ARGV' node /tmp/b08-fix1-readback.mjs`

Exit0. Script retained as `evidence-B08/fix1/readback.mjs` (executed from /tmp, no temporary runnable TypeScript under .superpowers). It imports the actual new Source validator and test-only resealing utility, reads the original JSON immutably, runs the real `scripts/compare-simulations.mjs` CLI with exclusive new outputs, and validates pure-API/CLI equality. Each original native report retains its original Source709a797 identity. All synthetic mutants are explicit offline negative fixtures under the new directory, not engine observations.

- Genuine valid CLI: exit0,complete, byte-identical to original `semantic-study.json`, SHA256 `2738b3ab02c44cad745c53f47ef962d2d89c9f8cb7de90bfe9c69dada42b2412`. Common projection remains `58cd652a07fd4592503545ae10834780910c9bcd9e429e9de5670aa7b831d1d2`;12 pass/6 untriggered not_run/0fail,accepted:false,percentiles:null unchanged.
- Every mutant passes generic upstream document/file/report identity verification before reaching semantic admission. Each actual CLI exits1, produces incomparable and includes INPUTS_NOT_EQUIVALENT plus the reason below. No stale scene/file seal supplies the rejection.

| Offline mutation | Semantic rejection |
|---|---|
| baseline sliding0.6→0.99, resealed | SEMANTIC_PHYSICS_BASELINE_REQUIRED |
| baseline solver iterations100→101, resealed | SEMANTIC_PHYSICS_BASELINE_REQUIRED |
| baseline actuator gain2→2.01, resealed | SEMANTIC_PHYSICS_BASELINE_REQUIRED |
| changed sliding with deliberately stale profile self-digest, outer refs resealed | SEMANTIC_PHYSICS_DIGEST_MISMATCH |
| name empty retaining a genuine valid cup population, resealed | SEMANTIC_EMPTY_LOAD_POPULATION_NOT_EMPTY |
| name empty with an unregistered field, resealed | SEMANTIC_EMPTY_LOAD_INVALID |
| empty current-model SHA binding changed, resealed | SEMANTIC_LOAD_MODEL_BINDING_MISMATCH |
| empty model path redirected to canonical file, resealed | SEMANTIC_LOAD_MODEL_BINDING_MISMATCH |

Full actual log: `readback-final.log`. New output/audit: `/tmp/mekoniq-b08-fix1-readback-20261115-0130/readback-audit.json`, SHA256 `27c6d248ddc1a0caf51fc4bd7383c054baa239a03cf0ef8a0eb137057bcef023`. Exact mutant input/output hashes and stored profile refs/digests are in that audit and sibling `profile-mutation-identities.json`; all mutated input/output JSON files are retained under `mutants/`. The original successful recording and original final-identities.json were not rewritten. No native X01 or browser/performance rerun was requested or claimed.

## Clean export, pin and affected Lab checks

- Source `perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-b08-fix1-export-922abb7-20261115-0131` → exit0,dirty:false (`export.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-b08-fix1-export-922abb7-20261115-0131` → exit0 (`lab-import.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs` → exit0 (`lab-sync.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' pnpm check:source` → exit0, verifies922abb7/schema53af...,protocol1/2,Node24 (`lab-check-source.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' pnpm typecheck` → exit0 (`lab-typecheck.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs --check` → exit0,engineering contracts match (`lab-sync-check.log`).
- Lab `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study-view.test.ts tests/unit/report-replay.test.ts` → exit0, **10 passed /2 files**, no skips (`lab-views.log`). Same output schema/UI behavior is retained. Broad suites/build/browser/native campaigns were not repeated for this narrow consumer boundary.

Final tuple in new `evidence-B08/fix1/final-identities.json`:

- Producer/retained native recording: **709a797fa791727d0a8c830e935e0d80192843b0**.
- Validator / current Source / export / pinned Source: **922abb77fbd3315038584b63599032db61d1b665**.
- Lab: **0e3edb8dab9ad8678fa62c58fd08178ed3298db1**.
- New runtime artifact SHA256: `a8e61a78f9cd683129a3d8d779204c9b9641046060123669b107a22a664d8b99` (independently matched export bytes and pin).
- Unchanged schema hash: `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9`.
- Unchanged portable tools digest: `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9`.
- Source/Lab clean,dirty:false,Nodev24.22.2, protocol1/2. No old identity JSON field was modified to claim this new validator produced the old native recording.

## Limits and remaining concerns

I1 is implemented and verified; root owns independent scoped re-review. M1 is explicitly deferred, and this fix does not claim to upgrade the earlier corruption-only mismatch/whitelist tests. The new I1 regressions themselves are coherent/resealed and assert semantic reasons. All automatic evidence stays accepted:false. Original dynamics remain not_calibrated; one run/engine, no measured ground truth, nominal cancel/unknown not exercised, optional benchmark not_run, no native-Linux/device/hardware or commissioning acceptance. Fix1 native/browser execution is not_run **by ruling73 for the pure consumer/test boundary**, not silently passed. FinalB10 still records the final all-changes producer tuple. No unresolved architecture/scope blocker or producer change arose.
