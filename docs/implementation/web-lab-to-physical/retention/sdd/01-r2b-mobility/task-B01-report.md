# B01 implementation report

Status: implementation and ordered source export/Lab re-pin complete, ready for controller review. No backend enabled, no engine/dependency lock upgrade, no native/hardware qualification, no push/deployment. Source BASE `e137b57`; Lab BASE `09dec0a`. Only the paired worktrees were edited.

## Interfaces frozen for B02

- New generated types live in `packages/contracts/generated/navigation2d.ts`: `LoadProfileV1`, `PhysicsEvidenceV1`, `PhysicsTickRecord`, `ContactAggregate`, `LoadObservation`. They are also re-exported by `v2/navigation2d/contracts.ts`; `LoadProfileV1` is re-exported from `v2/simulation3d/load-profile.ts`. Do not edit generated types.
- `validateLoadProfile(value:unknown):{ok:boolean;reasonCodes:string[]}` is synchronous shape+semantic admission and does not perform filesystem reads. `props[].massKg` is an SI number; `props[].sources.mass` is the existing engineering `SourceRef`. No parallel Scalar representation.
- Profile shape: schemaVersion/documentType/id/revision/digest/calibration/modelRef/supports/props/assumptions. Digest excludes only `digest`, using the canonical document digest rules. `modelRef` is `{path,sha256}` and hashes bytes; it is not the physical model's normalized `modelDigest`.
- Each prop has propId, massKg, six-entry symmetric inertia tensor `[xx,xy,xz,yy,yz,zz]` in COM/model axes, comM, cylinder geometry, friction, closed named sources and discriminated attachment. `free` has supportId + initialPoseInSupport. `fixed_ballast` has parentLinkId + poseInLink; no ballast fixture is supplied. B01 geometry accepts only cylinder; add a versioned geometry branch with tests if later ballast needs a box.
- Pose shape within new payload/physics contracts is `{positionM,quaternionXyzw}`. Existing sim3d snapshots' legacy `position` fields are unchanged. Wire quaternion remains xyzw; B02 must convert only at MuJoCo boundaries and convert readback back.
- Supports are convex CCW local XY polygons with `{supportId,parentBodyId,poseInBody,polygonM,source}`. The profile support frame sits on the tray TOP, not its link center. The cylinder initial center z is half its height. Validator checks unit quaternions within 1e-6, positive mass, physical inertia (positive definite and principal triangle inequality), duplicate IDs, valid convex supports, exact projected rotated-cylinder support footprint, COM support margin 5 mm and initial support height. Profiles have at most 8 props. B02 compiler must additionally resolve model body IDs, verify file hashes/bytes, initial penetration against all colliders and body namespaces.
- Errors: LOAD_MASS_INVALID, LOAD_SCHEMA_INVALID, LOAD_DUPLICATE_PROP, LOAD_DUPLICATE_SUPPORT, LOAD_INERTIA_INVALID, LOAD_SUPPORT_INVALID, LOAD_SUPPORT_UNKNOWN, LOAD_OUTSIDE_SUPPORT, LOAD_SUPPORT_HEIGHT_INVALID, QUATERNION_NOT_NORMALIZED, DIGEST_MISMATCH. Shape failures return before semantic hashing. Zero mass returns exactly `{ok:false,reasonCodes:['LOAD_MASS_INVALID']}` even when caller has not resealed the mutated profile.
- Navigation MuJoCo engine branch is additive: `{id:'mujoco_3d',version,timestepMs:2,substeps,physicsProfileRef,loadProfileRef}`. Both profile refs contain id/revision/path/sha256 and reject path traversal, URLs, absolute paths and backslashes. Schema requires world3d and at most one AMR. Existing IR-SIM/Webots scene branches retain their behavior.
- Controller ruling: engine.timestepMs is PER SUBSTEP, matching ArmCellSceneV1; scene.clock.tickMs is PER LOGICAL TICK. Baseline 2 ms × 10 = 20 ms. `validateNavigationDocument` now enforces that product for MuJoCo via PHYSICS_CLOCK_MISMATCH. `drive-contact-profile.json` distinguishes tickMs=20 and timestepMs=2.
- `snapshot.physics?:PhysicsTickRecord` is optional. Physics records follow the design fields, max 256 contacts/8 loads/1 AMR per tick, bounded finite numeric arrays. `samples` and `saturatedSubsteps` permit up to 100 at schema level; B02 must check against this scene's actual substeps, enforce ascending distinct contact IDs, and compute forces/impulses from all substeps. These producer-dependent semantics are not claimed by B01.
- PhysicsEvidenceV1 is a closed initial envelope with run/boot/scene/profile identities, physics stream chunk refs `{path,sha256,bytes}`, coverage/gaps/terminal reason/metrics policy/assumptions. Chunk paths permit safe JSON/NDJSON names. Full metric policy and coverage consistency are B03 work. B01 adds no physics runtime stream.
- Source AJV registry registers both new schemas, including the optional physics reference, without changing `NAVIGATION_SCHEMA_HASH=hashJson([componentSchema,physicalSchema])`. Python workers already register all schema files by filename/$id and resolve the optional ref without wiring changes; a direct installed-Python validation of a response containing snapshot.physics passed after the final schema ID update. No physical schema was edited merely to add data.

## Deterministic fixture and provenance

`generatePayloadFixture(outDir:string):Promise<void>` is exported by `scripts/generate-payload-fixture.mjs`; CLI: `node scripts/generate-payload-fixture.mjs [outDir]`. The script locates repository inputs relative to itself and uses tsx's programmatic loader solely to call the existing xArm kinematics helper. It never starts an engine or accesses the network.

`robotics/simulation-mujoco/fixtures/serve-payload-v1` contains canonical Serve project/components/physical model/world3d copied byte-for-byte, empty/cup-center/cup-offset profiles, explicit assumptions.json, drive-contact profile, navigation scene, dock report, README, NOTICE and byte manifest. Two independent temporary generations are compared against each other and against the committed fixture bytes by the real generator test.

- Selected support: lower `tray-1/plate`, 0.4 × 0.46 m, unchanged. Its top pose in chassis/base is approximately `[-0.1359136622,0,0.4278425908]` m; ground height adds 0.09 m wheel radius. No tray geometry revision is necessary for the cup or its 50 mm +y offset.
- Cup: radius 0.04 m, height 0.1 m, empty 0.02 kg + drink 0.3 kg = 0.32 kg from R2a cell-layout. Uniform solid-cylinder COM/inertia is an explicit assumed mass distribution with derived tensor, not a calibrated cup/fluid model. Center support pose `[0,0,0.05]`; offset `[0,0.05,0.05]`.
- Wheel radius/separation remain 0.09/0.36 m, copied original physical model bytes. The physical projection sourceSchemaHash remains unchanged. Legacy fixture and BV01 golden tests verify old data.
- Drive initial values: velocityGainNmsPerRad=2, brakeTorqueNm=6; motoring curve `(0 rad/s,6 Nm),(10,6),(20,0)`. Source assumptions and canonical axle effort/speed provenance are explicit. `requiresB02MeasurementLock:true` means B02 must measure/lock these before a campaign. This is not a rated payload, hardware motor curve, braking claim or controller validation.
- New assumed friction/solver/distribution/attachment provenance resolves to actual assumptions.json bytes by SourceRef SHA. Cup geometry/mass resolves to existing R2a cell-layout bytes. Derived and original canonical sources retain SourceRef kind/locator/hash. No vendor files were newly copied; existing xArm vendor NOTICE/license/commit/SHA remain authoritative in xarm6-g2-v1.
- Scene.files lists copied inputs, assumptions and profile files with stored byte hashes/sizes. Profiles are written/hashable before sceneDigest, preventing a digest cycle.

## Dock feasibility

The report explicitly carries T_map_base, T_map_AMR, T_AMR_tray, T_map_tray, T_base_TCP and T_base_approachTCP; pinned physical/cell-layout/arm-component/program byte hashes and xArm model revision identify the inputs. A candidate dock places the mobile lower tray at map XY (0.35,0.35), yaw zero, with unchanged arm base at map origin. Tray top is 0.5178425908 m versus the old fixed tray 0.06 m: old placement waypoint is 0.4578425908 m too low and cannot be reused.

Actual xArm solvePose(XARM6_SI), seeded from the original xArm place joints with rngSeed 1701, reaches both placement and approach at the mobile tray. Placement distance from base is 0.7694046186 m, position residual about 3.09e-10 m, orientation residual 1.06e-10 rad, condition 53.48. Approach position/orientation residuals and condition are also recorded along with returned joints and model limits. These are kinematic solves, not proof of collision-free motion.

The proposed fixture diff is UNAPPLIED: regenerate the offline xArm placement/approach target at the computed height, replace the fixed R2a tray collider with the AMR support, preserve nozzle support and arm base. No pedestal/tray edit is required by these IK results. Full AMR/arm approach/release/withdraw sweep remains `not_run`, so `accepted:false`, `blocksCell:true`, `blocksAMROnly:false`. B05 must check full colliders and sweep before adopting the dock or waypoint revision.

## Red/green and validation

Evidence logs are under `.superpowers/sdd/01-r2b-mobility/evidence-B01/` (ignored work notes; not qualification evidence).

- Initial requested negative/positive contract+fixture tests were written before production code; red run failed because the load-profile validator and fixture generator modules were absent (two failed suites, no assertions executed). This is the expected missing-implementation stage requested by the task brief.
- Added dock evidence test failed on `ik.execution='not_run'` before actual xArm solving was implemented; green after.
- Added capacity test failed because two valid AMRs were accepted before MuJoCo branch maxItems=1; green after.
- Added clock-product test failed with no issue for 2 ms × 9 before semantic enforcement; green after.
- Added provenance test failed on the unmaterialized assumptions document reference before assumptions.json and exact byte refs; green after.
- Final combined contracts + necessary legacy unit regressions: 17 files / 129 tests pass, including all 12 contract files (105 tests), new fixtures, IR-SIM golden/fixtures, Serve Webots fixture bytes, engineering fixture bytes and mock BV01 outcome/arm trace.
- Final focused B01 run: 2 files / 19 tests pass after dock input identity additions. Covers zero/negative/nonfinite mass, impossible inertia, quaternion, duplicate prop, offset outside support, path escape, 9 props, unknown field, stale digest, required profile refs, contact capacity, single AMR and logical/substep clock relation.
- pnpm contracts:generate and contracts:check pass; generated types are schema-derived. pnpm typecheck and pnpm lint pass. git diff --check passes.
- Real installed Python environments, PYTHONDONTWRITEBYTECODE=1 and PYTEST_ADDOPTS='-p no:cacheprovider': MuJoCo worker session suite 25 pass; Webots protocol+snapshot suites 26 pass. These are compatibility/unit tests, not native or device qualification.

## Completed ordered handoff

Source BASE `e137b57f23afe5b6114956011bcf7065d03c711b`; source HEAD `26199b8e3cddb3bb7b21b52a7e2c004d89b7ced6` (`feat: define payload profiles and MuJoCo mobility evidence`). Source tree is clean.

After that commit, `node scripts/export-lab-runtime.mjs` produced a clean export under the ignored evidence-B01/runtime-export directory; large stdout was redirected to runtime-export.log. Paired Lab imported that export and ran ordinary generated-contract sync. Artifact SHA `7f7043a95823d280358fc4407459eb0f442c337bf311e2be2ce17f6b094d1125`, full schema hash `a83e24cc35876f95f7aa2417752d92a92f91807a031397c273befcc520d6062d`, portable tools digest `49649d173db52fbc410bbef8f68ac10a1823b5d14dfa62a1bc0cd62206c967c9`. The portable digest changes because the new payload fixture is inside the already pinned tool tree; engine version, requirements locks and closure policy were not upgraded.

Lab BASE `09dec0a9c19ba574b8bd86b8a0b51d1d887b709e`; Lab HEAD `1604e05fc5e74c1abac2279efc9dd29f4a7f1c24` (`chore: pin source runtime 26199b8`). Only three Lab files change: config/source-runtime.lock.json, sync-generated shared/navigation2d.ts and the source commit header in shared/engineering.ts. No UI/provider behavior changes. Inspection of every Lab Ajv consumer found none imports sim3d-worker/navigation-scene schemas; their component/physical/navigation-run-evidence schemas did not gain refs. Therefore no additional schema wiring or invented validator/test was necessary.

Lab validation: `pnpm check:source`, `node scripts/sync-engineering-contracts.mjs --check`, `pnpm typecheck` pass. Full `pnpm exec vitest run tests/unit`: **64 files / 426 tests pass**, no skips. `git diff --check` passes. Lab unit output is stored as evidence-B01/b01-lab-units.log. Both source and Lab were committed only after the relevant checks.

## Review boundaries and remaining work

B01 does not advertise a mobile backend or scenario. B02 owns worker/compiler/readback/forces/odometry and controller measurement lock, and must reject bad model IDs/refs/penetration before creating MuJoCo. B03 owns durable physics streams and metric coverage. B05 owns one-world collider sweep and offline xArm programs; dock still blocks cell qualification. All dynamics remain not_calibrated, automatic accepted remains false. No runtime worker was started against hardware, no device/native gate closed, and no main checkout, trial, web, operational port or historical evidence was modified.

Environment correction: B01 generated runtime export relocated intact on 2026-11-14 from ignored .superpowers/sdd/01-r2b-mobility/evidence-B01/runtime-export to /tmp/mekoniq-r2b-b01-export-26199b8-20261114. ESLint walks dot directories despite Git ignore and was linting bundled dependencies; source lint remains unchanged. All future full runtime exports go outside both repos; reports/logs stay in plan workspace.
