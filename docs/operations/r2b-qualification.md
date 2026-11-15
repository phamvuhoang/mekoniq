# R2b qualification tooling — prepared, final recording pending

This runbook describes prepared tooling. It records no release acceptance, native host result, Docker image build, physical commissioning, deployment, or new browser performance result. All automatic records keep `accepted:false`; human acceptance is a separate hash/profile/scope-bound sidecar. Historical records and their checker revisions stay unchanged.

## Clean tuple and recording order

Finish B10/L06 independent review, commit Source, export the clean runtime, import/sync/check/typecheck and commit the Lab pin. Then run Source CI (`contracts:check`, `typecheck`, `lint`, `build`, `test`) and required Lab checks at that exact tuple. L05 security checks require an explicit `MEKONIQ_COMMISSIONING_PYTHON` (see [commissioning preparation](arm-commissioning-preparation.md)). Use Node24.22.2/pnpm10.32.1 and `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`.

The root controller sequences final recording after both tooling reviews. Record R-MOCK, IR-SIM, R1, R1.1 and R2a at the final Source/Lab tuple, then the current physics/cell/study/web inputs and R2b. Source code/closure changes invalidate reuse at a newer tuple. Evidence publication may be a later documentation commit; keep built-from Source/Lab identities explicit. Run Mac Webots with the GUI unlocked under `caffeinate -dims`.

R2b adds a closed full case table and an explicit `--scope mobility` subset (G-MJ1/G-REG4 only). G-HOST1/WEB06 stays separately blocked_external and cannot suppress local work. The immutable shared core still checks all earlier release tables and their original G-CLOUD1 semantics. `checkQualification` deliberately returns `R2B_ARTIFACT_READBACK_REQUIRED` for R2b. Both recorder and acceptance require `verifyR2bDirectory`; caller booleans and reduced tables cannot bypass it. Input summaries never replace actual registered case artifacts, seed/repeat checks, source journals, physics/world traces, semantic inputs or replay assets.

```sh
# All input paths are freshly recorded absolute outputs of the SAME final tuple.
# --semantic-study names the byte-bound producer INPUT consumed by compare-simulations.mjs.
# --web-record combines a new actual production capture and browser verification outputs.
# --out must not already exist and must be outside both repositories.
node scripts/record-sim-extension.mjs --release r2b --candidate-id r2b-candidate-01 \
  --out /tmp/NEW-r2b-candidate \
  --r2a-record "$R2A_RECORD_DIR" --physics-campaign "$PHYSICS_CAMPAIGN_DIR" \
  --cell-campaign "$CELL_CAMPAIGN_DIR" --semantic-study "$SEMANTIC_STUDY_INPUT" \
  --web-record "$WEB_RECORD_DIR"
LAB_SIMEXT_EVIDENCE_DIR=/tmp/NEW-r2b-candidate pnpm test:acceptance -- sim-extension
```

R2b `--plan` prints the closed table without prerequisite execution. Historical `--plan` semantics remain unchanged and may probe Docker. Do not casually invoke a historical plan under R76. Missing `LAB_CONTAINER_IMAGE` records the local container suite not_run while other local suites continue. A missing/skipped/failed suite never passes. If the image is available at the final prerequisite stage, the R2b recorder supplies `LAB_WEB05_EVIDENCE_DIR` to the existing container lifecycle suite, retaining reports and full replay assets. An explicit `--container-record DIR` can supply an independently recorded same-tuple artifact. No missing container or Linux execution becomes a native pass.

## Actual production capture

Use Lab `scripts/measure-cell-production.ts --exported-runtime --out NEW_DIR` against its clean Source pin and production build. Its version2 capture records browser and observer time origins, browser active-window epoch boundaries, actionId/runId/tick-to-response correlations, and receipt-observation timestamps. These are upper bounds on observed Source receipts; neither worker ACKs nor the display cursor are internal commit timestamps. The achievedRate remains browser-observed cursor pacing. Qualification recomputes observation validity and budgets from raw render/worker/action data, not caller target booleans.

The separate `--verify-browser` invocation records the browser test result and the live-report replay390px screenshot with simultaneous DOM/header count, runtime identity and runId. Preserve old captures; never transfer old185s timings to a new UI tuple. Full new final capture remains pending.

## Current native payload/cell package (R83/R90/R91)

`deploy/lab-runtime/build.sh` uses a clean Source tree and matching clean runtime export to bundle `r2b-campaign.mjs`. Its production module graph includes the registered payload/cell runners/readers and embedded SQLite migration; it imports no test harness. The package records exact input/resource hashes, source/runtime/schema/portable identities, campaign registries, observer hash and `mujoco_cell_v1` profile. The immutable image includes the bundle, package, engine observer, runtime and admitted worker/schema files.

Fixed OCI config labels bind `org.mekoniq.r2b.campaign-package-sha256` and `org.mekoniq.r2b.campaign-bundle-sha256`. The generated package is a companion artifact `r2b-campaign-package.json` in the current native handoff directory. It is **not** an engine/tool closure filler: L00's schema and closure guard are unchanged. Admission first validates the L00 raw OCI platform-manifest/config digests, then compares package/bundle labels with that admitted raw config, actual inspect output and in-container file hashes. Labels bind bytes; they do not independently authenticate a build or host.

```sh
# Matching assigned native Linux amd64 host only; existing image by config digest, no pull/build.
node scripts/native-sim/r2b-campaign.mjs --handoff "$CURRENT_HANDOFF" --out /evidence/NEW-current-r2b
# Read using the exact recorded clean checker revision, not an arbitrary later HEAD.
node scripts/native-sim/r2b-campaign.mjs --verify /evidence/NEW-current-r2b
```

The historical L01 public helper retains its30minute bound. Current cases have a separate maximum6,100,000ms (registered6000s plus100s orchestration allowance), one registered case per container, no retry/resume after uncertain execution, and incremental stdout/stderr plus owned-exit receipts. The current worker does not inherit L01's25minute outer abort. The total campaign is the finite registry sum (19payload plus8cell cases, at most27×6100s plus bounded inventory/cleanup); per-case receipts identify actual elapsed time. Signals stop only the owned process/container, checking ownership labels before removal. No historical image is overlaid with an ambient checkout. The public complete reader still requires every registered case; an individual-case smoke never qualifies the full campaign.

Image execution remains unbuilt/not_run under R76 until the final Docker prerequisite is available. Current native readiness also requires the matching assigned native host, exact L00 inventory/provenance and actual engine package/library measurements. Mac execution, image packaging, synthetic admission fixtures and imported replay are distinct scopes.

## Retained-input portability

The replay tests no longer default to a developer's `/tmp` directory. They require `MEKONIQ_RETAINED_INPUTS` and `MEKONIQ_RETAINED_INPUTS_SHA256`. Missing inputs fail explicitly; portable reader tests remain independently runnable. Obtain the retained B06 nominal7 and B04a cup-fall directories from the preserved task evidence archive, place them under a chosen parent using the relative directory names in the [catalog](../implementation/web-lab-to-physical/retention/retained-input-catalog.json), and place a byte-exact catalog copy in that parent. The catalog's SHA256 is `d46dfb3e521af516b4b31269f8a3bf755de1301935a6cc0bee9369ef679f9a51`.

```sh
node scripts/prepare-retained-inputs.mjs /chosen/parent/inputs.json \
  d46dfb3e521af516b4b31269f8a3bf755de1301935a6cc0bee9369ef679f9a51 /tmp/NEW-retained-inputs
# Export both selectors printed by the command, then run the retained tests.
pnpm exec vitest run tests/unit/web-replay-reader.test.ts
```

Preparation checks the full inventory, copies into a new owned directory, verifies source stability and output hashes, and prints the new manifest identity. It never opens original SQLite files for write. The corpus is historical evidence, not current-tuple qualification. In particular B06's compound development source identity is deliberately refused by the clean current campaign reader. Corpus availability is an explicit prerequisite; a clone without the separate retained archive cannot claim those tests passed.

## Owned Source CI services

At the final prerequisite stage, `node scripts/owned-source-ci.mjs -- pnpm test` checks fixed service ports, creates a unique `mekoniq-ci-<random>` Supabase project under a new temporary workdir, and stops only that namespace afterward. Port conflicts or start failures are not_run prerequisites. It never resets, stops, prunes or migrates an unrelated service. Auth/Storage and PostgreSQL credentials come from that same new namespace. `setupWave02` requires its receipt and checks the actual owned container ID before any role/migration action. Setting only `MEKONIQ_TEST_DB` is insufficient. Local service credentials stay in process environment/private temporary logs, not committed evidence. This prepared path has not started Docker or Supabase during B10 tooling.

## Deferred findings and warning attribution

The exact five frozen cloud/production evidence scripts remain byte-identical. Scoped ESLint overrides describe their actual Node globals/CommonJS execution format; other product code stays checked. Child test runners choose one color policy. Lab's nested npm build invocation is normalized in the owning script; inherited JSON import warnings remain separately attributable where not changed. Original successful and failed logs remain retained.

L01-R1-05 is addressed by restoring the frozen0.14m lift acceptance separately from the0.15m commanded lift, with threshold regression; historical evidence is not rewritten. B08 frame/goal precision now has coherent resealed tests that assert upstream integrity before semantic rejection; original stale-seal cases remain corruption tests. Broader world/adjacent-physics precision and earlier retained minor findings remain visible for final whole-branch triage. L03 negative-zero normalization and L04 large-trace/oracle capacity remain deferred, not silently resolved. No software evidence closes an unmet native or physical gate.
