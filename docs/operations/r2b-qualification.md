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

The replay tests no longer default to a developer's `/tmp` directory. They require `MEKONIQ_RETAINED_INPUTS` and `MEKONIQ_RETAINED_INPUTS_SHA256`. Missing inputs fail explicitly; portable reader tests remain independently runnable. Obtain the retained B06 nominal7 and B04a cup-fall directories and the historical B07a expected export manifest (the `cell-nominal-export` entry) from the preserved task evidence archive, place them under a chosen parent using the relative directory names in the [catalog](../implementation/web-lab-to-physical/retention/retained-input-catalog.json), and place a byte-exact catalog copy in that parent. The catalog's SHA256 is `86f905eee94c022acaafa0c8800c57eb290e4b64628a024b300669ca215c7a15`.

```sh
node scripts/prepare-retained-inputs.mjs /chosen/parent/inputs.json \
  86f905eee94c022acaafa0c8800c57eb290e4b64628a024b300669ca215c7a15 /tmp/NEW-retained-inputs
# Export both selectors printed by the command, then run the retained tests.
pnpm exec vitest run tests/unit/web-replay-reader.test.ts
```

Preparation checks the full inventory, copies into a new owned directory, verifies source stability and output hashes, and prints the new manifest identity. It never opens original SQLite files for write. The corpus is historical evidence, not current-tuple qualification. In particular B06's compound development source identity is deliberately refused by the clean current campaign reader. Corpus availability is an explicit prerequisite; a clone without the separate retained archive cannot claim those tests passed.

## Owned Source CI services

At the final prerequisite stage, `node scripts/owned-source-ci.mjs -- pnpm test` checks fixed service ports, creates a unique `mekoniq-ci-<random>` Supabase project under a new temporary workdir, and stops only that namespace afterward. Port conflicts or start failures are not_run prerequisites. It never resets, stops, prunes or migrates an unrelated service. Auth/Storage and PostgreSQL credentials come from that same new namespace. `setupWave02` requires its receipt and checks the actual owned container ID before any role/migration action. Setting only `MEKONIQ_TEST_DB` is insufficient. Local service credentials stay in process environment/private temporary logs, not committed evidence. This prepared path has not started Docker or Supabase during B10 tooling.

## Deferred findings and warning attribution

The exact five frozen cloud/production evidence scripts remain byte-identical. Scoped ESLint overrides describe their actual Node globals/CommonJS execution format; other product code stays checked. Child test runners choose one color policy. Lab's nested npm build invocation is normalized in the owning script; inherited JSON import warnings remain separately attributable where not changed. Original successful and failed logs remain retained.

L01-R1-05 is addressed by restoring the frozen0.14m lift acceptance separately from the0.15m commanded lift, with threshold regression; historical evidence is not rewritten. B08 frame/goal precision now has coherent resealed tests that assert upstream integrity before semantic rejection; original stale-seal cases remain corruption tests. Broader world/adjacent-physics precision and earlier retained minor findings remain visible for final whole-branch triage. L03 negative-zero normalization and L04 large-trace/oracle capacity remain deferred, not silently resolved. No software evidence closes an unmet native or physical gate.

### Local OCI preparation without publication (R92)

At the final Docker prerequisite stage, `deploy/lab-runtime/build.sh TAG --platform linux/amd64 --oci-out FRESH_DIR` uses an **existing running local docker-container builder** with Buildx and BuildKit at least 0.13. It refuses remote context/builder selectors and unsupported/stopped builders. It does not create or bootstrap a builder, push a registry image, or load an arbitrary OCI tar. A single build requests an OCI directory export and Docker exporter load; failure retains its command receipts. Default build without `--oci-out` remains available for WEB05, but does not supply current native handoff evidence.

The preparation reader verifies OCI descriptor sizes, blob SHA256s, the single Linux/amd64 platform manifest, raw config and layer inventory, then compares loaded `docker image inspect` config ID, OS/architecture, RootFS diff IDs and labels. Both outputs must share the exact config identity. Empty/missing RepoDigests is explicitly a **local export association**, never a registry-manifest observation. Any present conflicting RepoDigest fails. The current adapter repeats these checks in addition to L00's raw platform-manifest-to-config digest validation and R91 package labels.

Copy the verified output's `layout/` and `local-image-association.json` into the recipient handoff's `local-image/`; retain `platform-manifest.json` and `image-config.json` as the inventory-provenance raw files, and the output's `r2b-campaign-package.json` as the companion at handoff root. Set the subject's manifest/config digests from the verified association. Finish the existing L00 recipient inventory/host assignment process; the local output itself is not a native-ready handoff. The adapter retains the admitted layout blobs, association and actual inspect observation in its output. Missing layout, wrong loaded image, incompatible exporter/builder or unresolved recipient inventory remains not_run/refused. Actual build/export/load has not been executed during B10 tooling.

Dependency policy: clean source/export identity and all consumed bundle-input bytes are bound, using the same installed Vite/esbuild dependency resolution as the runtime exporter. A frozen install is the reproduction prerequisite. These labels and hashes do not independently authenticate the build machine or prove native execution.

Primary references checked 2026-11-15: [Docker exporter overview](https://docs.docker.com/build/exporters/), [OCI/Docker exporter parameters](https://docs.docker.com/build/exporters/oci-docker/), and [builder inspection](https://docs.docker.com/reference/cli/docker/buildx/inspect/). Multiple exporters require compatible Buildx/BuildKit; OCI directory output uses `tar=false`.

### Partial qualification records

R2b `artifactDispositions` is provisional per-case metadata. The mandatory asynchronous directory verifier recomputes it from actual artifacts and rejects a caller-supplied mismatch. Missing input/cases remain not_run, corruption or an observed assertion failure remains failed, and a missing WEB05 image does not erase independently qualified mobility/cell/web-reader evidence. Gates require every registered case. Synchronous structural success remains insufficient and the historical public dispatcher always returns `R2B_ARTIFACT_READBACK_REQUIRED` for R2b.

### Current browser and WEB05 observation contracts

`verifyR2bDirectory` performs the mandatory async readback. `assessCapture` derives active/full-cell drawing duration from RAF samples, bounds render events to the browser clock window, and binds each worker step to the Node clock origin and an observed HTTP action/tick interval. Worker observations outside the active window remain explicitly partitioned before/after it. Actual Source step progression, one correlated pause response and the final/stable/post-export horizon are required. Missing data produces unavailable metrics or failure. The existing33ms render,15ms worker and500ms last-step receipt targets remain; the last metric is an observer receipt upper bound, not internal commit time. ACK-to-UI latency has no newly imposed budget.

After a clean final Source export and Lab pin/build, `measure-cell-production.ts --exported-runtime --verify-browser --out NEW_DIR` prepares a separate browser invocation. It records clean Source/Lab identities and the exact production-dist inventory before/after, the Playwright argv/own exit/result hash, and a unique invocation ID in the JSON reporter metadata. The closed required case is `WEB-CELL-LIVE-REPLAY-390-v1` in `mujoco-cell.spec.ts`; aggregate passing stats alone cannot qualify it. The case records its own test/run identity, simultaneous390px DOM and screenshot, screenshot dimensions/hash and DOM hash. Readback requires the same Lab commit and dist bytes as the long capture; the two flows may have different run IDs. Standard Lab typecheck covers the e2e producer; the standalone measurement script also needs a targeted TypeScript check because `scripts/` is outside the default Lab tsconfig.

At the deferred Docker prerequisite stage only, `LAB_WEB05_EVIDENCE_DIR=NEW_DIR` on the existing container suite retains `lifecycle-observations.json`: ordered command argv, own exit/signal/stdout/stderr, and HTTP method/path/status/request/response observations. Known credentials and proof fields are redacted at collection; no request authorization headers are retained. WEB05 version2 binds those observations to one invocation, exact image/config ID, health tuple, active recovery run, finished run and named mounted volume. The reader derives contention refusal, kill/restart, read-only reclaim/resume refusal, zero workers and nonempty unchanged committed chunk hashes. It requires identical standalone/package replay manifests and binds the independently opened captured report to an observed post-reclaim report of the same finished run/horizon/source. The earlier report must show completed/served2; after reopening, the existing read-only needs_attention state and newly finalized stream metadata are retained explicitly, not relabelled as the earlier state. Incomplete suite execution retains observations and a failed/incomplete record; it cannot become a successful lifecycle assertion. This is preparation, not an actual container result.

For this working copy, lint authored Source with `pnpm exec eslint . --ignore-pattern '.superpowers/**'`: ignored SDD retention includes generated historical runtime bundles. A fresh clone has no such retained ignored bundles. This exclusion does not waive any versioned product or frozen historical script.
