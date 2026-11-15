# L00 implementation report

Status: **DONE_WITH_CONCERNS** — DEP-PREP-01 portable implementation and concrete current-R2b preparation completed; actual native execution remains **not_run / blocked_external**. Current R2b OCI image remains null/unbuilt and WEB05 remains not_run / blocked_environment under R76. No hardware/native/qualification acceptance is claimed. All records remain accepted:false, dynamics not_calibrated.

## Scope and identity

Only the isolated `codex/web-lab-to-physical` Source/Lab worktrees were modified. Original bases were Source `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` and Lab `176bf348b6a839037473cc6d87413093ed17ff54`, both clean. No original main checkout, trial, web, historical evidence, operational port, Docker/cloud/host provision/deployment/push or hardware route was changed. No helper/reviewer/subagent was spawned.

Final commits:

- Source **475ea03d9a2629ceaae890fc6a9f5b92ef503b7e** — `feat: prepare verifiable native simulation handoffs`.
- Lab **d9f4513b27adb3ca82ee736959f09560296b9a7e** — `chore: pin source runtime 475ea03`.

Final clean export: `/tmp/mekoniq-l00-evbHOR/runtime` (dirty:false).

| Identity | Value |
| --- | --- |
| Current subject Source | 475ea03d9a2629ceaae890fc6a9f5b92ef503b7e |
| Current recorded Lab / pin commit | d9f4513b27adb3ca82ee736959f09560296b9a7e |
| Runtime artifact SHA-256 | c216227455ca0b70f16753bde39b8121a96fccf5a5a54d5550f0e1c9fbf1e322 |
| Schema aggregate | dbc7c1d51f72e8871aa079285bd92761e1ccef6705d0aeacecfc5a52607b2e7f |
| Portable closure | 9ff6616edd2b0ec6e0fa5cad35d69f0bc34e097615ee977ad9d30fa903b00437 |
| Current subject OCI image | null / unbuilt |
| Concrete profile SHA-256 | 1ec9ac8bcd7ae9aa0fb5a043ed690f6440ff6e43e6d9e18004421853f18714e9 |
| Prepared manifest SHA-256 | b8582c43a36368a2d878017d6d165af462ab29324f72837e97c89e5fb742810a |
| Checker Source | 475ea03d9a2629ceaae890fc6a9f5b92ef503b7e |
| Checker code/schema/dependency-lock digest | 5f9f245e940b715714a388ed6bba885b2a33f54be83eccf04bbd717d00841151 |

Checker identity is a separate object from subject identity, even though this current package was prepared with the same Source commit. The checker digest covers the CLI, TypeScript validator, shared inventory helper, handoff schema and pnpm lock. A different checker commit never substitutes for runtime/model/engine/profile identity.

Historical R2a is kept separate: Source `4f893ac6fb75dff414a3ee42a726defb7935c734`; recorded Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`; schema `9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4`; portable closure `3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d`; runtime `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270`; deployed registry digest `sha256:fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009`; local config ID `sha256:f650a2576cf7d44e8f9bf40934d862d8120170dd701e7da502a6ee032d12bd05`. Read existing local cloud/production records only. No historical R2a package was fabricated with newer files, no historical record rewritten, and no image rebuilt/relabelled. Historical HTTP tick4800/served2 and Chrome tick4810/served2 remain accepted:false and are not L01's campaign.

## Implementation and APIs

- `packages/contracts/schemas/native-handoff-v1.schema.json`: versioned strict manifest, subject/checker identities, exact refs, profile/model binding, frames/units, seeds/case policy, package/source locks, accepted:false and not_calibrated.
- `packages/contracts/generated/native-handoff.ts` and `scripts/generate-contracts.mjs`: generated schema types and contracts drift check integration. Existing generated wire/engineering/navigation types were unchanged.
- `packages/lab-runtime/src/v2/sil/native-handoff.ts`: `validateNativeHandoff(root,manifest,inventory?) -> {prepared,nativeReady,issues}`, with code/path/severity (`error` versus `prerequisite`); `readNativeHandoff`, bounded `readHandoffFile`, and `exportNativeHandoff`.
- `scripts/native-handoff.mjs`: exact CLI `export --input DIR --out NEW_DIR` and `verify --input DIR [--inventory FILE]`; fixed checker import only, never executes a manifest string. CLI prints subject/checker identities, `inventoryAssessment:supplied_records_only`, qualification:not_run, accepted:false and not_calibrated. Exit0 means prepared integrity, not native readiness; read the separate boolean.
- `scripts/native-sim/native-inventory.mjs` and `.d.mts`: shared explicit-profile validation and conservative local-fact collector. OS/kernel/ISA/CPU observed locally; origin/emulation/image/subject/software locks remain unknown without actual evidence.
- `scripts/native-sim/{host-preflight,profile-report}.mjs` and declarations: additive collector export; shared SHA validator and optional third argument `{profile,subject}`. The existing `hostPreflight(vmRoot)`, `resourceDecision`, macOS ready_to_provision result and strict two-argument native_apt Ubuntu24.04/Jazzy arm64 behavior are preserved.
- `docs/operations/native-simulation-handoff.md`: package format, recipient verify→resolve→doctor→smoke→cases→archive/verify→reviewer procedure, exact identity distinction, no-host outcome, limits, provenance semantics and explicit native branch separation.
- `tests/fixtures/native-handoff.ts`, `tests/unit/native-handoff.test.ts`, `tests/security/native-handoff.test.ts`: synthetic protocol fixtures only; genuine RED/GREEN for new behavior and hardening. Existing legacy preflight/profile integration tests remain in the combined check.
- Lab changes: only source-runtime lock plus source commit comments in `src/shared/{engineering,navigation2d}.ts`; their contract content hashes did not change.

Export includes only schema-allowed, hash-checked refs; no recursive copying, launch/shell evaluation or extraction. Limits: metadata1MiB, individual files64MiB, 768 refs, declared/actual package payload256MiB. Actual reads are capped by each declared size before allocating, including understated-size attempts; provenance source artifacts have a separate256MiB total cap. Paths/traversal/symlinks/nonregular files/case collisions, file replacement/growth, recognized secret filenames and PEM/OpenSSH private-key content are rejected. Exclusive new output directory; manifest written last; failed output retained. Every exported portable closure file must be present with matching sourcePath/hash/size, schemas reproduce their aggregate, and runtime/Lab receipts/model/profile/engine/tool identities remain consistent.

## R78 architecture ruling

Raised a concrete conflict to root: an OCI-only prerequisite correctly blocks R2b image:null but cannot describe native_apt ROS/LinuxCNC. Root selected **B** and recorded R78 in the task brief/progress. Implemented explicit discriminated installation modes, not a missing-image fallback:

- Subject executionKind `mujoco_image` requires profile installation `oci`. Exact single-platform manifest/config bytes and Linux/ISA identity are checked; a base multiarch index/config ID alone cannot satisfy them.
- Subject `ros2_native` / `linuxcnc_native` requires installation `native_apt`, image:null, exact package/source locks, complete package→source mappings, exact distro/ISA/model/profile/subject inventory and matching retained source artifacts.
- All provenance binds a canonical inventory digest; an unrelated but correctly hashed evidence file is insufficient. Native source artifact bytes and OCI manifest/config bytes are rehashed from bounded paths beneath the handoff root.
- Relabelling a MuJoCo image profile as native_apt, or borrowing ROS/CNC inventory, cannot clear its image requirement. Missing origins/locks/image remain prerequisites. Supplied consistency is explicitly not host authenticity, actual execution, commissioning or qualification.

## Tests, RED/GREEN and failed attempts

All logs are retained under `.superpowers/sdd/03-r3-linux-readiness/evidence-L00/` (absolute root is this Source worktree). No unsuccessful attempt was removed or overwritten. Iteration commands used Node24.22.2 / pnpm10.32.1 with `perl -e 'alarm N; exec @ARGV'` bounds. No pytest/portable worker campaign was run; Python used only for file edits, not engine execution.

| Log | Result and purpose |
| --- | --- |
| red-01.log | Two suites fail because new module absent; legacy preflight2 pass. Initial import failure retained, not the behavioral RED claim. |
| red-02.log | Minimal false-return stub:16 behavioral failures,26 pass; establishes preparation/ready/export/missing helper behavior. |
| red-03.log | After exact closure fixture correction/shared helper work:14 failures,26 pass. |
| green-01.log |41 pass,1 fail: Node24 rejected obsolete tsx loader registration. Fixed to installed `tsx/esm/api` scoped import; no dependency/version change. |
| green-02.log |47/47 including legacy profile integration. |
| red-04.log |2 explicit-profile regressions: null package throws; null forbidden-package entry incorrectly accepted. |
| green-03.log |58/58 after schema-validation of explicit expectations. |
| red-05.log |Missing declared closure member incorrectly allowed. |
| green-04.log |59/59 after closure completeness enforcement. |
| red-06.log |Unrelated, correctly hashed provenance incorrectly allowed. |
| red-07.log |2 failures: unrelated provenance and matching-digest multiarch index. |
| green-05.log |61/61 after canonical inventory binding and actual platform manifest/config checks. |
| red-08-modes.log |R78 mode/profile cases:4 fail;30 filtered tests **not_run** (not passes). |
| green-06-modes.log |65/65 including native_apt exact locks, unresolved source, wrong source bytes and image/native-mode confusion. |
| final-focused.log |65/65 combined check before final bounds finding. |
| red-09-bounds.log |Understated sparse file size incorrectly read/hash-checked;1 fail,24 filtered tests not_run. |
| final-focused-02.log |**66/66**, four files, final tree; understated size rejected before allocation. |

Final combined command set, all exit0:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 120; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/native-handoff.ts scripts/native-handoff.mjs scripts/native-sim/native-inventory.mjs scripts/native-sim/host-preflight.mjs scripts/native-sim/profile-report.mjs tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/fixtures/native-handoff.ts scripts/generate-contracts.mjs
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/unit/native-sim-host-preflight.test.ts tests/integration/lab-v2-native-profile.test.ts
```

Final logs: `final-contracts-02.log`, `final-typecheck-02.log` (Next route type generation + tsc), `final-lint-02.log`, `final-focused-02.log`. Earlier successful checks: `contracts-generate-{01,02,03}.log`, `contracts-check-01.log`, `typecheck-01.log`, `lint-01.log`, first `final-{contracts,typecheck,lint}.log`. `git diff --cached --check` passed before Source commit. No full application build/full repository test suite was claimed; the clean runtime exporter built the actual pinned bundle successfully.

## Clean export, Lab pin and concrete package

Commands and logs, all successful:

1. Source commit475ea03, clean status, then bounded `node scripts/export-lab-runtime.mjs /tmp/mekoniq-l00-evbHOR/runtime` → `clean-export.log`; no allow-dirty flag or dirty final evidence.
2. In Lab: bounded `node scripts/import-runtime.mjs /tmp/mekoniq-l00-evbHOR/runtime`, `node scripts/sync-engineering-contracts.mjs`, `pnpm check:source`, `pnpm typecheck` → `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`. `git diff --check` passed, then pin commitd9f4513.
3. Retained preparation recipe `build-prepared-package.mjs` verifies both clean trees and closure bytes, then assembles current committed project/world/arm component, complete portable closure (including vendor manifests/licenses/NOTICE), clean runtime/manifest and committed Lab lock. Profile candidate follows current Dockerfile's Debian12/amd64, Node24.22.2, Python3.11.2, MuJoCo3.17.0; per-platform package artifact hashes remain explicitly null. It copies data only and executes no subject.
4. `node scripts/native-handoff.mjs export --input /tmp/mekoniq-l00-evbHOR/handoff-input --out /tmp/mekoniq-l00-evbHOR/handoff`, followed by CLI `verify` of that output; both bounded180s → `prepared-package-export.json` and `prepared-package-verify.json`.
5. Actual result: **prepared:true, nativeReady:false**,239 refs,10,703,745 payload bytes. Three PACKAGE_LOCK_UNRESOLVED issues, SUBJECT_IMAGE_UNRESOLVED, HOST_INVENTORY_MISSING. qualification:not_run, accepted:false, dynamics:not_calibrated.
6. Retained copies: `prepared-manifest.json`, `runtime-manifest.json`, `lab-runtime-lock.json`, plus `prepared-package-build.json`; actual transfer directory remains `/tmp/mekoniq-l00-evbHOR/handoff`.
7. Read-only local collector output `mac-local-facts-only.json` is explicitly Mac local facts, with unknown origin/emulation, no model/subject/installation/image or package locks. Checking the handoff against it produced prepared:true/nativeReady:false and expected profile/ISA/OS/origin/lock/provenance blockers in `mac-local-verify.json`. This is **not Linux inventory or native evidence**.

Final Source and Lab `git status --porcelain` were empty after the exported/pinned package and local-fact check. No SQLite record was retained; no process cleanup beyond natural bounded command exits was necessary.

## Self-review, limitations and handoff

- Requirements checked against L00 brief plus R76/R78. Legacy two-argument profile and macOS semantics covered by unchanged existing tests. New declarations track the optional APIs. Complete closure/schema/receipt/model/profile identity and bounded export independently exercised. Source authority, unknown/no-resend, one-world/one-ACK and Lab simulation-only routes were not altered.
- Self-review found and fixed explicit-profile malformed-input acceptance, missing closure coverage, unrelated provenance acceptance, multiarch identity substitution and understated-size memory bypass; their original RED logs remain available.
- NativeReady evaluates supplied consistency and exact prerequisites. Records/hashes are not a cryptographic attestation of a host or Git history. A responsible collector/reviewer must establish authenticity and signatures/trust. No signed commissioning or acceptance was generated.
- Human-selected refs may contain secrets not recognized by filename/private-key scanning; opaque archives are never extracted/inspected semantically. Producer must select reviewed non-secret artifacts. The actual package contains only current committed closure files and generated non-secret preparation data.
- Handoff verification does not run semantic world/model/engine compatibility checks, doctor, smoke or a campaign. Actual native package resolution, Linux host origin, native performance/contact/fault cases, WEB05 container lifecycle/TLS/cloud and hardware/calibration remain not_run or externally blocked. Current OCI image remains null; no Docker retry occurred.
- Native_apt support is a validated preparation/provenance format, not implementation of L02/L04 runners. No arbitrary manifest string is executable. Required locks may be null only while unready.
- The concrete target profile is a current-R2b **prepared candidate**, with complete source payload and unresolved host/image prerequisites; it does not select physical hardware or claim a deployed/current image.
- Temporary exported/runtime/package directories are retained for independent review. Report/logs live under ignored `.superpowers` as dispatched; Source/Lab commits contain the product/runbook/tests and pin, not synthetic/native-looking evidence.

Root owns independent review. Worktrees and branches remain intact; no merge/push/deploy was performed.

Final independent identity/status audit is retained as `evidence-L00/final-audit.json`: both trees clean, exact final Source/Lab commits match the verified subject, prepared manifest digest matches the retained record, prepared:true/nativeReady:false/image:null, accepted:false and qualification:not_run.

## Pre-review clarification and completion correction (root request)

Root identified a real gap against R3 §4 (`04-r3-linux-physical-readiness-spec.md:59`): the current verifier does **not** establish document-level model/units/frame compatibility. The earlier assertion that DEP-PREP-01 was completed was too broad and is withdrawn pending that missing implementation/review. This clarification preserves the original report, commits, clean export, package and test evidence; no code changed and no tests were rerun.

What is checked today:

- Manifest schema/version; presence of project/world/model/profile/schema/engine/tool refs and their source identity/hash/size; full portable closure and schema aggregate identity.
- Manifest `frames` requires only nonempty `world`, `robotBase`, `tool` names and `handedness:right`; manifest units are constrained to m/rad/kg/s. Missing these manifest fields or model/schema refs makes prepared:false.
- Model **file SHA-256** must equal profile.modelSha256; profile document must equal the manifest profile and its file hash must equal subject.profileSha256. Inventory profile/model ID/hash, OS/ISA, package/source locks and subject identity are compared to those declarations.
- Schema files are parsed as JSON objects and hashed; the subject project/world/model contents are **not parsed or validated against those schemas**.

What is missing, and must not simply be deferred to doctor:

- Recognized project/world/model document shape/schema validation; declared model ID versus the actual model document; project/world references versus the supplied canonical model/revision/digests.
- Declared frame names versus actual frames/links/transforms, and units inside the subject documents versus the handoff's SI declarations. A consistently hashed mismatched or even non-JSON model/project/world can currently be prepared; the synthetic fixtures deliberately contain raw `model`/`project`/`world` strings, showing that current tests cover transport identity rather than these semantic relationships.
- The fuller R3 §4 frame/unit mapping (drive/tray/arm base/flange/TCP/sensors as applicable), joint sign/offset/limits and inertia-order relationships are not represented/checked by the current three-name frame object.

Actual installed engine behavior, executable/plugin availability, live TF/clock, numerical/model parity in the simulator and campaign outcomes correctly remain doctor/native-case work. Static document and model/frame/unit compatibility are portable L00 obligations and are an implementation gap, not an external-host blocker. Root should not treat the existing prepared:true result or66 passing tests as proof of that missing scope. Existing identities/evidence remain exact and unchanged.


## Static admission correction — completed portable implementation (R79–R81)

This appendix supersedes the earlier statement that semantic world/model compatibility is entirely external. The report prefix, initial66-test evidence, Source475ea03/Labd9f4513 identities, and `/tmp/mekoniq-l00-evbHOR` outputs remain unchanged and retained as the superseded transport-only candidate. Root’s original review bases remain Source d0f30749c0ddb474f0844c68be63a6f0fa4b1933 / Lab176bf348b6a839037473cc6d87413093ed17ff54. No prior evidence/history/fixture was rewritten.

Added `packages/lab-runtime/src/v2/sil/native-handoff-documents.ts`, called only after transport/receipt/closure checks pass. The adapter parses actual project/world/model bytes; it reuses existing typed project, engineering component/project, navigation/physical/model, arm-cell, world, load, collision and inertia validators. Known subject schemas must match checker schema content. Schema additions require `profile.documents` with explicit kind, canonical/SI revisions, source units/conversion factors, complete applicable frame mapping and joint/controller/sign/offset/limits/inertia-order mapping; `subject.nativeClosureHash` selects a complete native-tools closure where applicable. Mobile-only `frames.tool:null` explicitly means absent, not unknown. Unknown combinations fail explicitly. Engine/tool refs may use the selected native closure as well as the mandatory portable closure; PUMA requires the native closure.

The expected mappings derive from pinned checker reference files, never from arbitrary caller document claims. Whole JSON semantic equality deliberately bounds support to the exact reviewed bodies, in addition to typed and relationship checks. Unsupported coherent documents fail; this does not claim generic arbitrary-project compatibility. The existing standalone navigation validator is unchanged. The CLI checker byte digest now includes the static adapter; its imported validators/reference corpus are also pinned by the checker Source commit. Both identities must be retained.

### Exact supported scope

- `mujoco_world_v1`: exact B05 coffee-delivery-world-v1 project/world/component with complete referenced source files, outer project digest/map geometry, arm base/collision/model revision, frame/joint/unit/limits/inertia, source physical-to-navigation projection and pinned MuJoCo3.17.0 lock. Explicit OCI kind only.
- `mujoco_cell_v1`: exact B06 coffee-delivery-cell-v1 variant, same physical/project/program bytes, plus explicit cell control context/policy. The corrected concrete handoff uses this cell fixture, matching `mj-cell-bv01-v1.json`. The superseded initial package used a B05 world with B06 case names; it remains preserved, not promoted as corrected preparation.
- `xarm_ros_canonical_v1`: exact B06 canonical body/mappings admitted for native_apt ROS preparation only. Always prerequisite `NATIVE_MODEL_MAPPING_UNRESOLVED`, nativeReady:false. L03 must add actual expanded native description/controller/plugin/profile binding; no native URDF/TF/plugin/contact parity is claimed.
- `engineering_navigation_ros_canonical_v1`: exact `robotics/simulation-3d/fixtures/serve-3d-v1/{serve-3d-project,navigation-scene,physical-model-amr-1}.json`, typed EngineeringProject/NavigationSceneV1/RobotPhysicalModelV1, matching input identities, world digest/geometry and exact reprojection. Full mobile tree, drive and sensor frame identities; continuous wheels have explicit absent positional bounds, with existing velocity limits; no invented arm/TCP/tray. Always `NATIVE_ENGINE_MAPPING_UNRESOLVED`, nativeReady:false. L02 must bind its real Gazebo scene/compiler/native profile and exact locks. The portable canonical scene is not represented as Gazebo.
- `puma_controller_reference_v1`: exact native controller `integrations/arm-controller/models/puma560-reference/modified-dh.json`, manifest, frames, reference poses, vendored HAL origin and `configs/sim/puma560/profile.json`, with BV01 project/world from `tests/fixtures/digital-twin/sil/bv01.json`. Manifest referenced bytes, source units inch/degree/alpha-radian, .0254 and pi/180 conversion, modified-DH/TCP, JOINT_0–5 order/sign/offset/limits and existing frames are bound. The existing native model is used, not the illustrative mock’s different DH. Inertia stays unknown, measured physical placement stays null, existing simulation placement separately illustrative; no guessed inertia/calibration/controller abstraction. L04 owns actual trace/runtime/ALG04 evidence.

Shared component checks include connected acyclic frame trees, unique child parents, normalized axes, positive kg mass and valid finite positive inertia; entire pinned bodies additionally constrain sensor/tray/drive identities, finite transforms, joint ordering and limits. Existing engineering inertia storage order is explicitly xx_xy_xz_yy_yz_zz. Static preparation says nothing about installed executable/plugin availability, live TF/clock correspondence or numerical/dynamic fidelity.

### Shared-world adaptation, exact boundaries and producers

B05 producer is `scripts/generate-coffee-delivery-world-fixture.mjs` (read, not executed). It reads original `simulation-mujoco/fixtures/xarm6-g2-v1` arm and `simulation-mujoco/fixtures/serve-payload-v1` mobile inputs. Arm component/physics, mobile physical/drive bytes are copied; empty-load modelRef is rebound to mobile-physical.json and its digest resealed. It changes outer project id/name/revision, collision profile placement/reference, world id/width/height/obstacles and pickup/parking coordinates. It creates the explicit programs, handoff policy, armCell, support/prop binding and numerical/contact policy recorded in the supported full world.

The intentional navigation differences from the copied mobile scene are precisely: `world.id/hash/widthM/heightM/obstacles/boundaries`; `inputs.project.id/revision/digest`; `robots[0].initialPoseMap`; `engine.loadProfileRef`; `engine.physicsProfileRef.path/sha256`; `files`; deletion of `engine.stopPolicyRef`; and resealed `sceneDigest`. Original `navigation.inputs.world` remains source provenance. Original physical and projected navigation model `inputs` remain untouched and equal, and reprojection from the original physical inputs/policy exactly reproduces the nested model. Applying standalone nav cross-input rules to the adapted outer scene reports WORLD_MISMATCH/INPUT_IDENTITY_MISMATCH; the bounded adapter does not suppress an arbitrary list of these errors or replace inputs. It separately checks original model projection and then entire supported outer scene, including all geometry/frame/engine/controller fields.

B06 has no separate generator. Its committed `coffee-delivery-cell-v1/lab-world-scene.json`, adjacent README and prior B06 report record the reviewed adaptation: relative to B05 only `id`, `sceneDigest`, added `controlContextVersion:1`, and added exact `controllerPolicy` differ. That policy is grid-diff-world-v4 with the declared signed bounds, braking/ramp/translation/goal/staging/reverse-approach semantics; equality covers every field rather than permitting an arbitrary policy. All eight original physical/program/project/handoff files are byte-identical. B05 and B06 positives are separately covered. Negative cases reach source-model projection, outer project/world/geometry, model axis/limit/inertia/id and frame mapping errors after coherent hashing.

### Historical arm-only boundary (R81)

The historical R2a runtime4f893ac and its own arm-only files are **not supported** by these document kinds. R81 assigns the distinct old Lab project + ArmCellSceneV1 + frozen component/model/engine/profile/files/schema/frame/unit adapter to L01. L01 must implement/review that exact tuple before admitting the old-image probe. Current B05/B06 worlds, schemas or workers must never be substituted for those historical files. L00 did not reconstruct, execute or rebuild the old image. Root’s read-only old-runtime locator remains L01 context; this correction does not expand into that task.

### Correction test evidence and failed attempts

All paths below are under evidence-L00. Filtered tests are not_run, not passes. Synthetic inventories remain protocol data, never native execution evidence.

- `red-10-static-documents.log`: six genuine prepared:true failures before semantic implementation, with coherently rehashed non-JSON project/world/model, foreign units, unrelated world and nonexistent frame.
- `green-07-static-attempt.log`:71 pass/1 fail because an old transport test assumed worker ref index0 after fixtures changed; corrected test locates its explicit source path. `green-08-static.log`:72/72.
- `red-11-amr-kind.log`:missing AMR binding helper/unsupported-kind failure (not counted as behavioral admission RED). `red-12-amr-admission.log`:new AMR input binding present but real standalone preparation still false before adapter branch. `green-09-amr.log`:74/74.
- `red-13-static-gate-disabled.log`:18 coherently resealed branch negatives fail with **only the new semantic gate temporarily disabled**, transport retained; this is a transparent mutation RED, not claimed as pre-implementation chronology. Exact core restored from retained native-handoff-static-gate-backup.ts before GREEN. Covers xArm axis/inertia/limits/id, outer coherent geometry, profile sign/offset/frame/inertia mapping, schema replacement, unknown kind, PUMA units/order/offset/mock/TCP and AMR input/frame mismatch.
- `green-10-static-negative.log`:92/92. `static-typecheck-01.log`:one TypeScript Extract narrowed revolute-only against the existing revolute|prismatic union to never; corrected type expression, runtime unchanged. `static-lint-01.log`:pass.
- `red-14-source-projection.log`:source-model negative first hit existing WORLD_IDENTITY_INVALID (nested physical digest not updated); preserved. `red-15-source-projection-sealed.log`:fully updated nested digests reached full-world mismatch before source projection. Moved the full-world equality check after original projection validation, retaining the same admissible set and clearer failure. `green-11-static-all.log`:94/94, including B05 positive and explicit MOBILE_PROJECTION_MISMATCH.
- `static-final-contracts.log`, `static-final-typecheck.log`, `static-final-lint.log`:all pass.
- Self-review found missing load-profile schema content comparison. `red-16-load-schema.log`:one genuine prepared:true schema-replacement failure, one existing schema case passes,49 filtered. Added load-profile to known static schema set; final focused/type/lint logs use static-final-*-02.log.

No worker, engine, native doctor, simulator, live TF/clock, Docker or hardware was run. No native gate was closed. Inventories/provenance enforce supplied consistency only; actual host authenticity, origin evidence and qualification remain separately required. Current R2b image remains null/unbuilt under R76 and all package artifact locks unresolved/nativeReady:false. Original two-argument profile and Mac feasibility boundaries are included in the combined checks.


### Final correction validation, clean export and pin

Final **95/95** tests passed in `static-final-focused-02.log`:51 security +37 unit +5 unchanged legacy native profile integration +2 unchanged host preflight. Contracts check passed in `static-final-contracts.log`; full Source typecheck (Next route types plus tsc) and changed-file lint passed in `static-final-typecheck-02.log` / `static-final-lint-02.log`. Earlier full changed-file lint also covered inventory/preflight/profile/generator and passed; those files did not change in this correction. `git diff --check` and staged diff check passed. These are focused checks, not a claim of full repository suites or native execution. Contracts generation logs04/05 remain retained.

Commands use Node24.22.2/pnpm10.32.1 and explicit perl timeouts:

```sh
perl -e 'alarm 120; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/native-handoff.ts packages/lab-runtime/src/v2/sil/native-handoff-documents.ts scripts/native-handoff.mjs tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/fixtures/native-handoff.ts
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/unit/native-sim-host-preflight.test.ts tests/integration/lab-v2-native-profile.test.ts
```

Committed Source correction, then exported from clean Source to a **new unique directory** with bounded `node scripts/export-lab-runtime.mjs <base>/runtime` (`static-clean-export.log`). Imported into Lab using bounded `node scripts/import-runtime.mjs <base>/runtime`, synchronized contracts, ran `pnpm check:source` and `pnpm typecheck`, checked diff and committed the exact pin. Logs: `static-lab-import.log`, `static-lab-sync.log`, `static-lab-check-source.log`, `static-lab-typecheck.log`. All exit0. The clean exporter built the actual runtime bundle. Neither checkout has tracked/untracked changes.

Retained recipe `build-static-prepared-package.mjs` checks clean Source and Lab, verifies exported closure bytes, uses B06 cell inputs and `nativeDocumentBinding('mujoco_cell_v1')`, then assembles only selected allowed refs. It does not run the subject. `static-prepared-package-build.json`, `static-prepared-package-export.json` and `static-prepared-package-verify.json` record the clean construction, bounded export and independent CLI verification. Copies are `static-prepared-manifest.json`, `static-runtime-manifest.json`, `static-lab-runtime-lock.json`; `static-final-audit.json` independently rechecks clean Git status, exact identities and actual manifest digest.

Final Source/checker commit: `2b7d39cdeab06b499e9037aef1a24f1babe03a4f` (`fix: validate native handoff document compatibility`). Final Lab pin commit: `fd4365291f6db7fdcbd72407f94ac7c0f35a20b4` (`chore: pin source runtime 2b7d39c`). Export/package base: `/tmp/mekoniq-l00-static-Ee1bDp`; concrete transfer: `/tmp/mekoniq-l00-static-Ee1bDp/handoff`.

| Identity | SHA-256 |
| --- | --- |
| schemaHash | `07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068` |
| portableClosureHash | `9e84b636309e418ae467b73450574c0d99f80142090c08648394067bad2716b2` |
| runtimeArtifactSha256 | `139c32dac4861e5aa419520c5321208df0aa3e7c33ca765c6725b058147cee2b` |
| profileSha256 | `59186eb128e36759ab928d9794ef55586a09ddab71fe8b722bce7507df853972` |
| manifest | `64e8049c0f72836540fa3b85199852f1c09af734141f09afe568977c4ca39b32` |
| checker tool | `1c62c33fed19ccd2b10af5cfca2d271c013f2ad632d12e6415803636413db85a` |

Concrete result: **prepared:true, nativeReady:false**, `239` refs / `10,724,081` bytes; nativeClosureHash:null for this OCI subject, image:null. Exactly three PACKAGE_LOCK_UNRESOLVED prerequisites, SUBJECT_IMAGE_UNRESOLVED and HOST_INVENTORY_MISSING. Supplied inventory assessment remains supplied_records_only; actual execution/qualification:not_run, accepted:false, dynamics:not_calibrated.

Checker tool digest ordering is: scripts/native-handoff.mjs; packages/lab-runtime/src/v2/sil/native-handoff.ts; packages/lab-runtime/src/v2/sil/native-handoff-documents.ts; scripts/native-sim/native-inventory.mjs; packages/contracts/schemas/native-handoff-v1.schema.json; pnpm-lock.yaml. Each filename plus newline precedes its exact bytes. The checker Source commit pins the remaining imported validator/reference corpus; the short tool digest is not claimed to be a full transitive closure or host attestation.

Self-review confirmed positive and coherent-negative boundaries across current shared world/cell, pinned PUMA, standalone AMR and canonical xArm; exact whole-scene/model scope, legacy APIs and OCI/native_apt distinction remain explicit. Existing historical/failed artifacts are preserved. Remaining concerns are intentional external boundaries: L01 old-arm adapter/image probe; L02 AMR native mapping; L03 expanded xArm model/plugin mapping; L04 actual PUMA controller/trace/runtime; real inventory/authenticity, image construction, package lock resolution, native cases, calibration and hardware acceptance. No Docker/cloud/provision/deploy/push/merge, native run or physical connection occurred. Root owns independent review from the unchanged original bases.


## Review1 fix round1/5 — L00-R1-01 and L00-R1-02

Root accepted both Important findings from independent `task-L00-review-1.md`; no plan conflict or new scope ruling. Fix bases are Source2b7d39cdeab06b499e9037aef1a24f1babe03a4f / Labfd4365291f6db7fdcbd72407f94ac7c0f35a20b4. Original full-task bases d0f3074/176bf34 remain unchanged for accounting. The preceding35537 bytes are preserved exactly; evidence-L00/r1-report-prefix.json records their length/SHA-256. Both prior `/tmp/mekoniq-l00-evbHOR` and `/tmp/mekoniq-l00-static-Ee1bDp` packages are untouched. This appendix records the changed checker contract rather than retroactively relabeling prior assessments.

### L00-R1-01: complete supplied OCI/Docker record prerequisites

Verified the finding: the former positive fixture omitted manifest layers/config descriptor mediaType/size and configuration rootfs, while receiving nativeReady:true. The core now validates required supported manifest/config shapes using typed Ajv predicates, then binds descriptor relationships. The synthetic positive has a complete one-layer image record; the layer contents are deliberately not materialized because these tests establish supplied-record structure, not image execution.

Supported record types are OCI image manifest v1 and Docker distribution image manifest v2 with SHA-256 descriptors. Config descriptor media type must match the selected image family; its digest must equal the retained config identity and its size must equal actual retained bytes. Every layer descriptor requires a valid supported media type, SHA-256 digest and nonnegative safe integer size. OCI tar/gzip/zstd (including nondistributable variants) and Docker gzip/foreign layers are explicit; at least one layer is required by this bounded support. Required OS/architecture/rootfs fields and rootfs type/layer diff-ID syntax/count are checked. Present optional config/history fields are type-checked; nonempty history layer count must match if history exists. Existing exact subject image/provenance/OS/ISA checks remain. Unknown media types, algorithms, indexes, empty-layer/generic-artifact records are unsupported. No registry/pull/layer read or execution occurs; layer descriptor correctness is distinct from actual layer contents and trusted host origin.

Primary references consulted read-only: [OCI manifest schema v1.1.1](https://raw.githubusercontent.com/opencontainers/image-spec/v1.1.1/schema/image-manifest-schema.json), [OCI configuration schema v1.1.1](https://raw.githubusercontent.com/opencontainers/image-spec/v1.1.1/schema/config-schema.json), [CNCF Distribution Docker v2 manifest](https://distribution.github.io/distribution/spec/manifest-v2-2/). These informed required shape/descriptor relationships; the implementation deliberately supports the stated bounded image types rather than claiming a full general OCI artifact validator.

### L00-R1-02: bind actual checker corpus to its Git identity

Verified the finding: isolated copies with a changed imported model/validator, or without Git, previously returned successful assessments with unchanged short digest and unchanged/null checker commit. The CLI now requires a clean verifiable SHA-1 Git Source checkout whose top-level directory is its own root, a valid HEAD, and clean tracked/index/untracked status. Before importing the data validator/reference corpus, it reads HEAD tree entries and compares actual regular-file bytes to their Git blob identities across scripts, packages, robotics, integrations, tests/fixtures, package.json, pnpm-lock.yaml, tsconfig.json and .gitignore. These scopes cover the repository-owned imports and canonical reference corpus outside the six short-digest files. Raw comparisons catch hidden index flags as well; symlinked files/parents and excessive corpus count/size are refused (20000files/64MiB perfile/256MiB total). It repeats checks after assessment and requires unchanged HEAD before emitting success.

No-Git/copied-without-Git policy is explicitly fail-closed (`CHECKER_GIT_REQUIRED`), not successful sourceCommit:null. Dirty checkout yields `CHECKER_CHECKOUT_DIRTY`; concealed byte mismatch `CHECKER_INPUT_MISMATCH`; changed final HEAD `CHECKER_CHANGED_DURING_ASSESSMENT`. Failures emit NATIVE_HANDOFF_FAILED, exit1 and no prepared assessment. No bypass option was added. The six-file toolSha256 remains a distinct short byte identity, now paired with an enforced Git binding. Subject identities remain independent; clean synthetic checker commit and unrelated synthetic subject are tested successfully.

The trust boundary remains repository-owned checker bytes. A responsible operator provisions trusted Node/pnpm/dependencies from the pinned lock; this does not attest node_modules/OS or defend against a malicious process replacing trusted executables. The pure in-process API does not claim an effective checker identity; its caller owns environment binding. Retained CLI output enforces the new policy. Because dirty development checkouts now correctly refuse the CLI, its positive assertion moved from the unit export test to a dedicated actual-CLI suite with a temporary independently committed checker snapshot. The export unit still tests selected-ref copying. Snapshot fixtures copy only relevant code/reference/lock files, use the local installed dependency symlink, create an isolated test Git commit with hooks/signing disabled, and delete only their owned temporary directories. No real checkout or retained evidence is mutated by these tests.

### RED/GREEN and covering checks

All logs are retained in evidence-L00; filtered tests are not_run. No failed attempt was erased or treated as success.

| Log | Actual result |
| --- | --- |
| r1-red-01-oci.log |13 genuine coherent nativeReady:true failures;2pass (existing missing descriptor rejection and new valid Docker positive);51filtered. Manifest/config/subject/inventory/provenance seals are all updated, so failures exercise record semantics. |
| r1-green-01-oci.log |103/103 unit+security pass after required shape/relationships and valid fixture. |
| r1-red-02-checker.log |3 genuine successful-assessment failures for changed imported model, changed imported validator and copied/no-Git checker; clean independent checker positive passes. |
| r1-red-03-checker-hidden.log |4 failures including index assume-unchanged concealment,1clean positive pass, before identity gate implementation. |
| r1-green-02-checker.log |5/5 actual CLI cases pass under the enforced checkout binding. |
| r1-final-focused-01.log |115/115:66security +37unit +5checker CLI +5legacy native profile integration +2legacy host preflight. |
| r1-final-contracts-01.log |Contract generation matches schema. No schema change this round. |
| r1-final-typecheck-01.log / r1-final-lint-01.log |Initial check failure: Ajv inferred required-field-only type lost optional history; explicit any was disallowed. Replaced with explicit typed manifest/config/descriptor interfaces and unknown inputs; runtime behavior unchanged. |
| r1-final-typecheck-02.log / r1-final-lint-02.log |Full Source Next route generation+tsc, and all changed TS/JS lint pass. No repeat suite solely for type-only declarations. |

Commands use Node24.22.2/pnpm10.32.1 and perl alarm180 (focused iterations120/180):

```sh
pnpm contracts:check
pnpm typecheck
pnpm exec eslint packages/lab-runtime/src/v2/sil/native-handoff.ts scripts/native-handoff.mjs tests/fixtures/native-handoff.ts tests/fixtures/native-handoff-checker.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/security/native-handoff-checker.test.ts
pnpm exec vitest run tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/security/native-handoff-checker.test.ts tests/unit/native-sim-host-preflight.test.ts tests/integration/lab-v2-native-profile.test.ts
```

The focused pre-implementation commands selected `resealed OCI|valid Docker` and the dedicated checker suite. Every actual tool command had its explicit perl timeout; no mock or skipped test was used as native execution evidence. No engine/physics/browser/container/full-repository campaign was needed or run. R78–R81, legacy behavior, image:null/current R2b, no host, accepted:false and not_calibrated limits remain unchanged.


### Fix1 clean export, committed Lab pin and final concrete handoff

Source and staged diff checks passed, then Source was committed cleanly. Bounded `node scripts/export-lab-runtime.mjs <new-base>/runtime` built a clean actual runtime export; `r1-clean-export.log` records success. In Lab, bounded `node scripts/import-runtime.mjs <new-base>/runtime`, `node scripts/sync-engineering-contracts.mjs`, `pnpm check:source`, and `pnpm typecheck` all exited0 (`r1-lab-import.log`, `r1-lab-sync.log`, `r1-lab-check-source.log`, `r1-lab-typecheck.log`); diff check passed, then the new pin was committed. No allow-dirty output was promoted.

`build-r1-prepared-package.mjs` is a distinct retained assembly recipe; it verifies clean trees and closure bytes before copying only allowed current B06 cell subject refs. The old recipe/output paths remain unchanged. `r1-prepared-package-build.json` records its new manifest/identities. Bounded `node scripts/native-handoff.mjs export --input <new-base>/handoff-input --out <new-base>/handoff`, then independent CLI `verify --input <new-base>/handoff`, both succeeded with the new enforced clean-checker gate (`r1-prepared-package-export.json`, `r1-prepared-package-verify.json`). All export/pin/package commands used perl alarm120/180.

Final Source/checker: `298db9bdbc207b14bdbef78ec8d70adf4e901c71` (`fix: bind native handoff image records and checker identity`). Final Lab pin: `7698aa628fc9a60598d1337b292bdcec2fe91fdc` (`chore: pin source runtime 298db9b`). New base `/tmp/mekoniq-l00-r1-BkDjXu`; concrete transfer `/tmp/mekoniq-l00-r1-BkDjXu/handoff`.

| Identity | SHA-256 |
| --- | --- |
| schemaHash | `07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068` |
| portableClosureHash | `9e84b636309e418ae467b73450574c0d99f80142090c08648394067bad2716b2` |
| runtimeArtifactSha256 | `802b58db276ae16097d3b1d896ee252e96c8e3afa33e1f6081c885582a0efe9b` |
| profileSha256 | `59186eb128e36759ab928d9794ef55586a09ddab71fe8b722bce7507df853972` |
| manifest | `010c10024179c6cd03e52efbd0c01d150795f219747ffb5c56ca36146cc9772e` |
| checker tool | `c75a5b6fb4f69a0170fa7cc77a6463e9e382bf319763bee7b1a7b340236d6caf` |

Concrete result: prepared:true/nativeReady:false,239refs/10,724,081bytes, image:null, nativeClosureHash:null for this OCI profile. Three PACKAGE_LOCK_UNRESOLVED, SUBJECT_IMAGE_UNRESOLVED and HOST_INVENTORY_MISSING remain. Assessment is supplied_records_only, qualification:not_run, accepted:false, dynamics:not_calibrated. No structurally valid synthetic OCI record is presented as actual host/image evidence.

Exact retained copies: r1-prepared-manifest.json, r1-runtime-manifest.json and r1-lab-runtime-lock.json. `r1-final-audit.json` verifies both trees clean, actual manifest digest, exact subject/checker/pin identities and the unchanged35537-byte prior report prefix (SHA-256 a473337a44262bc29b0c3099f6bb4890f44daa21c463dc14209756fad0ac71bd). Prior transfer manifests were read-only rehashed and still equal b8582c43a36368a2d878017d6d165af462ab29324f72837e97c89e5fb742810a and64e8049c0f72836540fa3b85199852f1c09af734141f09afe568977c4ca39b32. No prior failed/superseded identity or log was rewritten.

Self-review: both findings have concrete runtime predicates and genuine pre-fix failures. Clean checker snapshots preserve subject/checker independence and prove dirty/unbound copies cannot emit the prior successful identity. Corpus hashing also resists Git index concealment. Required OCI fields/descriptors/rootfs relationships are checked after coherent provenance sealing; unsupported image formats fail readiness without falsely invalidating prepared transport. The recorded clean final package passed the same production CLI identity gate. Root owns the scoped rereview from2b7d39c/fd43652 to these final heads.

Remaining limitations are unchanged and explicit: no assigned host, no built current image, no native run/doctor/TF/controller trace, and no calibration/hardware acceptance. L01 retains old arm-only adapter ownership; L02/L03 retain native mapping obligations; L04 retains actual controller/trace/runtime proof. No helpers, cloud/Docker/provision/deploy/push/merge, original-main mutation or physical connection occurred.
