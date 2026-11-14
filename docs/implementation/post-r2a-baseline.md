# Post-R2a baseline for R2b (B00)

Captured 2026-11-14 in the isolated `web-lab-to-physical` worktrees. This document consumes the existing R2a evidence; it neither records a new candidate nor grants human acceptance. The user authorized scoped implementation using the tested gates. Production checkouts were not changed. All hashes below are SHA-256; file hashes refer to bytes, while closure/profile/model digests use their existing producers.

## Checkout and recorded release identities

| Identity | Value |
|---|---|
| Source HEAD before B00 | `086121c73afcdb08240c393dcd87a6f1de861b58` |
| Paired Lab HEAD | `8c5db253155bcbb74b5607606ca65db562b267ff` |
| Initial source / Lab status | Both clean (`git status --short` empty) |
| R2a recorded source / current Lab pin | `bb16724859ee8377be62389a851ac36ea4a0309a` |
| R2a recorded Lab | `832c84fa0bdac2c18d44a4f102337533d1904436` |
| Lab artifact | `67a1a20cf12f79046c89695324505453c7d6ee6548d530bd98abfb2149d208c7` |
| Lab schema hash | `9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4` |
| Recorded portable closure / Lab pin | `6df2f71fc16380756e6342f229afcfaef8ca8822e462d9f53f6baec377e4c745` |
| Recorded native closure | `cddf6bc66fc4d6a5175835776dea4be34dd5ba477aa91e1658bbeeccb53cc9d9` |
| Current worktree portable closure | `3e8fa06c2c8eb2b79e1dc8a64efd8bc5a7f022689f8168bcd88bc7a7c7b70ec2` |
| Current worktree native closure | `982b7498a5ee1a67e8a9d07468533f3571e68a9d732c76abe7769dc4749835a4` |

The Lab pin matches the **recorded** source, schema, artifact and portable closure. It does not name current source HEAD. The only tracked change within portable closure paths since the recorded source is `robotics/simulation-mujoco/README.md`; closure hashing includes documentation. Read-only comparison with the original pinned artifact manifest explains both differences: portable lists the same files with only that README changed; native previously included five generated `robotics/agent/mekoniq_agent.egg-info/` files (`PKG-INFO`, `SOURCES.txt`, `dependency_links.txt`, `requires.txt`, `top_level.txt`) absent from this clean worktree. All other native files match. The closure walker includes those generated files despite Git ignoring them. These measurements do not establish current-HEAD qualification. Before new runtime work, export the current clean source and re-pin the paired Lab; the controller will do this after this documentation commit. B00 itself makes no runtime/schema/tool change and performs no export or pin update.

## Evidence and gate boundary

The authority is [r2a-candidate-01/qualification.json](evidence/sim-extension/r2a-candidate-01/qualification.json), file hash `6b59ab2fbf6d49fcbf639b1cac257097e505728d75bba421ec48c6e4bfcff861`; read its [README](evidence/sim-extension/r2a-candidate-01/README.md) for suite counts and rulings. Recording completed at 2026-11-13T13:55:57.755Z with `identityStable:true`. No recording was started or candidate changed by B00. `campaign` and `performance` are null for R2a; engine evidence comes from its recorded suites.

`record-sim-extension.mjs` refuses dirty trees, mismatched pins/closures and mismatched prerequisite records. Its R2a chain carries byte-identical R1.1 `r11-candidate-03`, R1 `r1-candidate-06`, IR-SIM `candidate-08` and Lab R-MOCK regression records from the recorded tuple. The acceptance guard uses the recorder's `checkQualification`, checks artifact hashes and those carried records, and checks the current Lab pin against the recorded pin. It does **not** prove current source HEAD has the recorded closure.

| Gate | Recorded status | accepted |
|---|---|---|
| G-MA1, G-MA2 | tested | false |
| G-RT1, G-RT2 | tested | false |
| G-UI1, G-INT4, G-REG3 | tested | false |
| G-CLOUD1 | blocked_external; CL01 not_run | false |

No `acceptance.json` sidecar exists for this candidate. Top-level `accepted:false`, `acceptedBy:null` and `acceptedAt:null` remain unchanged. Earlier Henry acceptance belongs to superseded candidates in Git history and does not transfer. The arm prerequisites for B05/B06 are tested in this tuple, so those tasks are not blocked by missing R2a arm tests; B05 still needs its R2b dependencies and B06 still requires the shared-world spike to pass. Neither current-HEAD qualification nor physical readiness follows from this baseline. Cloud work needs an explicit deployment target and instruction; native amd64, Linux/ROS and hardware gates remain separate.

## Engine, fixture and compatibility digests

| Item | Value |
|---|---|
| Engine | `mujoco==3.17.0`; portable Python 3.11 |
| MuJoCo requirements.lock | `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84` |
| Oracle profile digest | `5a79d629e9768464c215200804acc8bcdd93e839b41234cab2b715483d629b61` |
| Fixture | `xarm6-g2-v1`, modelRevision `e60fd6ca4431e6b1a37282f7e88a79931b47a0cc3ac52c76e9cc8c219bac057c` |
| Fixture manifest.json file | `51bad5842206673d9f417a5f0f4813ac904f64b12a53cbfb403e1e12294b3407` |
| Vendor | xArm-Developer/xarm_ros2 `ac736c92b02de7ca7e0be6f737d77d46707464d8`, BSD-3-Clause; manifest and NOTICE retained |
| sim3d-worker-v1.schema.json file | `094725811f6d2d160aca23ab4456776d1bc3597638044f62ff27a37fb36a8830` |
| arm-cell-scene-v1.schema.json file | `c5acf75b8194cb306fee9714c2b9f3e24d1d55b7851b507c249607731f38901e` |
| twin-sample-v2.schema.json file | `a229356dec024a4518b5035540cb24641094ee1126c3efc79262c8de7e01e26b` |
| mujoco-arm-ports.ts file | `c44a3fc6a555c8b13f384ae27976892ff341adfcbde3842b8a3c4f5c413ec152` |
| RT05 recorded image | `mekoniq-lab-runtime:record-11189`, linux/arm64, `sha256:59709619781dcbbda040da88df058734f11bb1cd6fdeaefef8365a25650bd114` |

The image revision is the recorded source commit. It was built and removed by the recorder; this document makes no availability claim for that local image. RT05 proves the recorded arm64 container run. Emulated amd64 stopped with `PLANT_UNSTABLE`/`BADQACC`; native amd64 remains untested and the cause remains unknown. Container success does not prove arm contact gates. Dynamics remain `not_calibrated`: manufacturer nominal geometry/mass/inertia and assumed controller/contact/layout parameters are not measurements of a physical robot.

Existing goldens were read, never regenerated:

- `tests/unit/bv01-mock-golden.test.ts`, test “mock-default BV01 (seed 42) keeps its outcome digest and arm trace”: outcome `9cfda98a693941cde4e0ecbfe028d48471877c6f8440295fc26e7e5061a1a2a2`; arm trace `70ff6e4014be2e7db90b986aefc679fb00810ebaa813c3214bbf6a8f2e1beeff`. Test file hash `b3f7ea126b04b47d26b34644fd6f0fa58e9eddea4d5a29108552f05cfe299133`.
- `robotics/simulation-mujoco/fixtures/xarm6-g2-v1/fk-golden.json`, fixture-listed file hash `87dc76938e7687fb9543046c0fc1c3c8b522bf78c0ec286d9cd6d88206137d90`.
- Existing schema/capability tests preserve pre-M01 AMR/Webots messages and backend sets. Future R2b changes must retain mock BV01, IR-SIM chunks, Webots bytes, archive-reader compatibility and R2a arm behavior; B00 adds no replacement golden.

## Delta from the research snapshot

The external research README captured source `5e3029e03f822e64ebf2fdaea2362ce8ce4ec857`, Lab `09f3d097e6381468e4dd75375fc050cce03695ba`, pin `85437650591e5e059e427f175497dce135ab5f39`, and no R2a candidate. Those are historical research identities. The actual recorded and checkout tuples above supersede them for implementation planning.

- Schema: no contract-schema changes between the research source and this source HEAD. The optional gripper/prop fields already exist in `mekoniq-sim3d/1`; R2b payload/physics contracts are future work, not delivered by R2a.
- Clock/substeps: preserve one logical 20 ms tick, ten 2 ms MuJoCo substeps. Research already noted the clock/substep guard. The final RT03 ruling now records equal paced/unpaced evidence for the same action sequence, while paced steps are capped at 50 ticks and cannot reproduce the old 500-tick action sequence. UI speed affects pacing only.
- Slip: preserve TCP-relative measurement, not world displacement (already noted by research). The final MA06 ruling explicitly allows failure at the lift check as `TRANSFER_REJECTED`/`needs_attention`, with `CUP_DROPPED` latching when contact is lost; never `completed` and never an automatic gripper-open command. This is not a mobile payload/slosh model.
- Image: the final candidate now supplies a concrete arm64 image identity and passing RT05 evidence. The research amd64 limitation remains open.
- Arm ports: `arm-cell-scene.ts`, `mujoco-arm-ports.ts` and `mujoco.ts` changed after the research snapshot. Final ports still place the cup at the nozzle, use a static tray and remove transferred cups from the arm scene when custody goes to the AMR mock; contacts are static allowed pairs. They do not implement a free body riding a mobile tray or phase-specific shared-world handoff. Preserve these R2a semantics and build the new composition separately.

## Verification and remaining work

On 2026-11-14, with Node v24.22.2 / pnpm 10.32.1:

```sh
LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-01 \
  perl -e 'alarm 180; exec @ARGV' pnpm test:acceptance -- sim-extension
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run \
  tests/unit/capabilities-mujoco-arm.test.ts \
  tests/contracts/sim3d-mujoco-schema.test.ts tests/unit/bv01-mock-golden.test.ts
```

The candidate guard passed 12/12 in B00; the selected schema/capability/mock-golden command above passed 14/14 (8 + 5 + 1). The controller also reported the same guard 12/12, source capability/schema/mock-golden tests 18/18 and paired Lab `pnpm test:unit` 426/426 before B00, with no intervening code change. The controller independently ran MuJoCo pytest: 43/43 in 9.61 s with `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS="-p no:cacheprovider"`. These are current-checkout regression checks, not a newly recorded qualification. The recorder's pytest cache issue remains: use the cache-provider override when recording or running workers.

Before dependent runtime implementation: reconcile current export/pin and closure identities, retain engine lock and old goldens, then follow B01 onward. Before a new qualification: clean source/Lab, matching new pin/closures, full required suites and new evidence directory. Human acceptance, Cloud Run deployment, native host execution and hardware commissioning remain outside this task.

## Frozen upstream refresh — 2026-11-14 (B00R)

The isolated R2b source branch integrates frozen R2a source `4f893ac6fb75dff414a3ee42a726defb7935c734` (including `0a0d21f`, `02d4d3f`, `a8d5450`, `4f893ac`) onto reviewed feature base `5235791218c6330c358676fe36ae0ed978be3654`. The paired Lab integrates `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`, including the touch watch-mode exit fix `748be82`, onto feature base `57705211a231c41e5636566a416737f6bc14faef`. Its runtime pin and generated headers are regenerated from the clean merged feature source, rather than taking upstream's runtime artifact identities.

The refresh preserves serialized expired-owner cleanup through readiness/create/gateway close, conservative palm/gripper sweep geometry and early MuJoCo `arm-drop` refusal. It also retains B02b's shared arm/mobile slot until process close, startup-unknown durable latch and observation-before-cancellation checks. Native tool identity now excludes Python installation metadata; portable tool identity remains strict. The recorder suppresses pytest cache generation, large Git trees are captured without truncation, and qualification prose points to the evidence index without making closure documentation candidate-specific. The worker README now identifies B02a's earlier Python-only boundary as historical and describes the integrated Source mobile provider.

Incident retained: B02b's regression executed the existing Webots worker-kill test with a global module-name selector while the original checkout's qualification was active. The retained test log has no target IDs, so the exact workers killed and whether any belonged to the original pipeline cannot be established. Earlier global-empty failures listed transient PIDs 31619/31632/31633, whose ownership was not captured. Read-only original logs later show the campaign 20/20 pass and Webots suite exits 0; those observations do not prove isolation or erase the incident.

B00R replaces global Webots/MuJoCo fault-kill selectors with ownership established from this test process's ancestry and registered absolute bundle directories. Cleanup covers owned workers, engines and controller descendants, including captured reparented children and detached process groups. PID start identities are revalidated before signalling; directory boundaries exclude similarly prefixed sibling runs. Generic sentinel tests prove a sibling survives a worker fault and that an orphan controller remains visible as a cleanup leak. The original IR-SIM fault helpers already limit candidates to direct children of their own test PID and compare before/after workers; recorder process-group signals use captured spawned children. Those selectors were audited without launching engines.

Original qualification `/Users/hoangpham/source/prv/robot/.qualification/r2a-final-20261114-xqub7yqk/progress.json` still reported `r2a-candidate-02` running (started 2026-11-14T00:31:31Z) at this refresh. No original files, qualification state or processes were altered or restarted. Because its old global kills/assertions can interfere in the opposite direction, real Webots/MuJoCo/IR-SIM worker and runtime-browser checks are explicitly **not_run** until the controller releases the scheduling hold. Pure ownership, geometry, identity, mock-golden and engine-free gateway tests plus contracts/typecheck/lint support this integration; they do not replace the deferred engine checks. Export/import performs no worker launch. Exact commands, results, new feature/pin identities and deferred suites are in the B00R implementation report.

All earlier recorded identities and gate statuses above remain historical. Integrating these code corrections does not requalify an old candidate, transfer acceptance or close native/device/hardware gates. New candidates remain `accepted:false` until human review.
