# B04a — source payload experiments, campaign and mobile telemetry

Status: **DONE** — final exact-commit19 campaign and independent CLI readback pass, retained archive unchanged, full payload integration10pass, clean export and Lab pin verified. No unresolved test failure. Independent review is owned by the controller after this handoff.

Scope: only the two authorized worktrees changed. Original main checkouts, trial/web and historical evidence remain untouched. No push, merge, deploy, provisioning, outreach or hardware operation. Node24.22.2/pnpm10.32.1; Python3.11.15, MuJoCo3.17.0 on macOS26.5 arm64. Native runs sequential. Python bytecode/cache disabled; all test commands bounded. TDD, systematic-debugging and verification-before-completion applied. No subagents.

## Source and Lab identities

Source BASE `f0fb70f9733bc6eb103fe8e8972cd45926af918d` → implementation `94270c8f23721ea04ed360a3299c488425486a16` → `a3a50a38d2cca1584443d32f103d24be979834f6` (physical completion boundary fix) → final **`681b8adb8ed473f7195062773b23fabc3b922cd5`** (journal readback without retained-file mutation). Lab BASE `989632ae5b4b6f1cf8feebf57f0cb9301918d231` → `d4913ec903a0c0de94cd80b162e3d5a151b126cb` → final **`cbeb5817cd65d53182aa080df3e566ad656d4945`** (`chore: pin source runtime 681b8ad`). Both authorized branch `codex/web-lab-to-physical`; source clean at final recording/export.

Final clean export `/tmp/mekoniq-b04a-681b8ad-export-20261114-0954`, dirty:false. Runtime artifact SHA256 `9151185264c5d86b29c73591ccc9433a30d07929546e1d28ce843f825d650b53`; schema hash `d7cd5fbe76e1800e1e17d26d829c05569989ff44498482400c114a10c3842506`; portable closure `be784441c2c4a6967d5e07240d1b5be81f289bddf2923911578da563d13fd5db`; native closure `2c772404529bbb82ad1554be1e44be3b5d0eb02e818a0ebec7d93f37f3c871e7`. Engine lock remains `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84`. Protocol1/2, Node24. Native closure changes because its broad file list includes changed schemas/worker; no Linux or hardware claim follows.

Lab changed only four generated/pin files: `config/source-runtime.lock.json`, `src/shared/engineering-schemas/engineering-project.schema.json`, `src/shared/engineering.ts`, `src/shared/navigation2d.ts`. Sync script generated contract bodies. Mobile provider report/UI import admission remains for B04b.

## Exact source files

- `docs/research/2026-11-mujoco-payload-experiments.md`
- `packages/contracts/generated/engineering.ts`
- `packages/contracts/generated/lab-v2.ts`
- `packages/contracts/schemas/engineering-project.schema.json`
- `packages/contracts/schemas/twin-sample-v2.schema.json`
- `packages/lab-runtime/src/engineering/contracts.ts`
- `packages/lab-runtime/src/engineering/mujoco-compiler.ts`
- `packages/lab-runtime/src/v2/gateway.ts`
- `packages/lab-runtime/src/v2/navigation2d/plant.ts`
- `packages/lab-runtime/src/v2/navigation2d/runner.ts`
- `packages/lab-runtime/src/v2/navigation2d/worker-client.ts`
- `packages/lab-runtime/src/v2/report.ts`
- `packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts`
- `packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts`
- `packages/lab-runtime/src/v2/simulation3d/payload-experiments.ts`
- `packages/lab-runtime/src/v2/simulation3d/physics-evidence.ts`
- `packages/lab-runtime/src/v2/simulation3d/worker-client.ts`
- `robotics/simulation-mujoco/campaigns/payload-v1.json`
- `robotics/simulation-mujoco/fixtures/serve-payload-v1/drive-contact-high-v1.json`
- `robotics/simulation-mujoco/fixtures/serve-payload-v1/drive-contact-low-v1.json`
- `robotics/simulation-mujoco/fixtures/serve-payload-v1/registered-physics.json`
- `robotics/simulation-mujoco/mujoco_worker/__main__.py`
- `robotics/simulation-mujoco/mujoco_worker/mobile_engine.py`
- `robotics/simulation-mujoco/mujoco_worker/session.py`
- `robotics/simulation-mujoco/probe_mobile.py`
- `robotics/simulation-mujoco/tests/test_mobile.py`
- `scripts/lab-mujoco.mjs`
- `tests/integration/lab-v2-software-gaps.test.ts`
- `tests/integration/mujoco-payload-campaign.test.ts`
- `tests/unit/payload-experiments.test.ts`

## Interfaces, inputs and B04b handoff

Development simulation only; dynamics remain `not_calibrated`, all automatic campaign artifacts have `accepted:false`. The engine/clock remain MuJoCo 3.17.0, 20 ms logical ticks, ten 2 ms substeps. Raw tick zero retains priming, while aggregate interval metrics cover `(0,lastTick]`.

`EngineeringProject.mujocoExperimentId` is an optional closed selector on `engineering-mujoco-3d-v1`. Omitting it preserves the existing center-load compiler path. A selection changes the project/bundle/new-run identity; it never mutates a live world. There is no browser path, code or arbitrary physics JSON input. The existing `MJ-FD01` scenario, `mujoco_3d` backend, portable readiness checks and shared `mujoco_arm` world slot are reused. Health advertises `sim3d_payload_experiments_v1` and `mobilePayloadExperiments` only with engineering and an enabled installed/reachable mobile provider. Readiness must still pass for the admitted bundle.

| Selector | Load fixture | Physics fixture | Policy linear/angular caps |
|---|---|---|---|
| payload-empty-v1 | empty | drive-contact-profile | 0.5 m/s, 1 rad/s |
| payload-center-v1 | cup-center | drive-contact-profile | 0.5 m/s, 1 rad/s |
| payload-offset-v1 | cup-offset | drive-contact-profile | 0.5 m/s, 1 rad/s |
| payload-slow-v1 | cup-center | drive-contact-profile | 0.2 m/s, 0.4 rad/s |
| payload-fast-v1 | cup-center | drive-contact-profile | 1 m/s, 2 rad/s |
| payload-friction-low-v1 | cup-center | drive-contact-low-v1 | 0.5 m/s, 1 rad/s |
| payload-friction-high-v1 | cup-center | drive-contact-high-v1 | 0.5 m/s, 1 rad/s |

Existing entity speed caps and wheel limits also constrain the projection. The campaign fixture has no entity cap. Consumers must use the applied navigation kinematics, not infer speed from a selector label. The speed experiment changes policy numbers, its registered `<selector>-navigation-policy` ID, its `payload-experiments-v1` assumption SourceRef/content hash and policy hash, project digest, physical model input provenance/digest/file hash, rebound load modelRef/digest/file hash, navigation projection provenance/kinematics/digest, scene, bundle and run identity. Canonical physical fixture SHA256 stays `830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9`. Mechanical shape, world/assembly, load props/supports, physics bytes, stop policy and controller algorithm/ramp identity remain unchanged. `PAYLOAD_SPEED_DIFFERENCES` enumerates these fields for B08: compare exact values outside the declaration and return incomparable if another field differs. Never ignore all model/policy changes.

The friction variants change only `contact.sliding` numerically, to 0.3 / 0.9, and carry distinct IDs, contact-source assumption text, numerical/document digests and own measurement probe IDs. All other drive/solver/clock/numerics remain baseline. MuJoCo max-geom mixing matters: floor sliding friction stays 0.8, cup sliding friction stays 0.6. The low variant is masked at those contacts and does not establish a lower effective floor-wheel coefficient. The high variant can change effective contact friction. No causal effect is inferred merely because a file hash changed.

| Physics fixture | Exact file-byte SHA256 | Own probe |
|---|---|---|
| baseline | 9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3 | b02a-locked |
| low | c9aec2a6a250e81f4c5c1d1372e88d7d90340b7e42f7526fe90a7ad3d1d4ad9c | b04a-drive-contact-low-v1 |
| high | 9d1f7f3315cfe9df89ed8b8b15361b3fd09d66dedbe4ea5240a5c04b54ecbe8a | b04a-drive-contact-high-v1 |

The existing bounded real-engine probe accepts only these named profile files. Each new variant was run for three loads × hold/straight/circle/stop × three repeats × 500 ticks, with raw gzip observations and model readback. All values were finite; maximum repeat position difference was zero, maximum quaternion-angle difference was 9.884312124119402e-8 rad (low), 9.424321830774485e-8 rad (high), below 1e-6. Baseline probe/profile bytes were preserved. Task handoff identifies retained raw artifact directories and summary hashes; this is development evidence, not qualification.

`node scripts/lab-mujoco.mjs run --campaign payload-v1 --out DIR` records the production runner, source SQLite journal, navigation chunks, B03 physics chunks, input closure, report, process/request trace and artifact hashes. Output must be new. `verify --input DIR` uses `verifyPayloadCampaign(root)`, the same bounded reader used by tests. It ignores summary verdicts. The original eighteen cases remain: nine turns (three loads × seeds 7/19/41), three additional center/seed7 repeats, two braking cancels, two friction runs, and two worker-kill/ACK-loss cases. A nineteenth supplementary cup-fall case is required by the controller's MJ04 ruling. Completed cases count verified assertions, including correctly detected faults, not successful missions. Kill/ACK loss admits exactly the declared terminal unknown advanced tick; corrupt/missing/foreign artifacts are never excused.

The cup-fall input is server-only `payload-cup-forward-impulse-v1`, never a browser selector. It is bound into the source manifest and configuration hash. At logical tick501 the original process applies 30 N along the declared tray support +x (transformed from the committed tick500 support pose at the start of tick501, then held fixed in map over all ten substeps) to the existing free `cup-1` for ten 2 ms substeps: 0.6 N·s. It writes no pose or velocity, clears external force even on a failed step, and cannot inject twice through ACK replay. Its dose is an assumed simulation fault, not a physical impact rating. The worker writes a run/boot/scene/profile/tick-bound receipt; the campaign checks it against retained physics poses and the stop monitor's five-tick load-drop window. Arm and unsupported providers refuse the option. A preceding contact warning remains in the source journal; recording continues in the same world until the registered terminal fall or bounded fault horizon, with no new mission or false served claim.

Mobile telemetry has a separate `TwinPayloadState` observed branch: `payloadKind:'free'`, `propId`, declared `supportId`, `loadProfileSha256`, `sceneDigest`, `geometry`, `positionM`, `quaternionXyzw`. Entity IDs are `payload:<propId>`. Only committed snapshots publish these fields, preserving run/boot/seq/time and `origin:'physics_sim'`, `frameId:'map'`. Entities use `kind:'payload'` and `plant: TwinPayloadState`; AMR-only `distanceM` is explicitly null; `moving` derives from measured payload linear/angular velocity magnitudes and the admitted stopped thresholds. Declared support is a coordinate reference; there is no synthesized coffee ledger ownership. Empty means no payload. Rendering/Three conversion and browser import admission belong to B04b. The optional B03 report physics block remains unchanged; imported reports must preserve its completeness/unavailable distinctions.

The two braking cases additionally bind server-only `payload-brake-observation-v1` (`extraTicks:5`) in the case, source manifest and configuration hash. Ordinary cancellation confirms on the first stopped observation and closes immediately; its B03 five-sample stop metric can therefore remain unavailable. The registered campaign policy retains the same world for five further committed ticks after business cancellation, without changing the journal confirmation or the stop metric definition. Its checkpoint records the exact first/last observation-tail ticks. Run status remains running through this tail, even though the source business journal already records cancellation; it becomes cancelled only after the final committed observation. Single-tick callers and mid-tail reports share that boundary. Reopening an interrupted tail is needs_attention/RECOVERY_UNKNOWN and cannot resume or create a replacement worker. Tail targets remain zero and produce no new dispatch or confirmation. A lost ACK, malformed observation or physical fault still ends the world immediately; it does not receive an observation tail. This completion policy is an input invariant for counterfactual comparisons.


Additional integration handoff:

- Project selector is validated by `engineering-project.schema.json`, generated `EngineeringProject` and `engineering/contracts.ts`. Use ordinary engineering compile/admit/create flow with `mujocoExperimentId`; a browser cannot supply launch perturbation/completion policies. The seven selector IDs above are the entire admitted browser surface. Omitted selector preserves old center compilation.
- `mujocoMobilePlant(runtime, experiment?)` second parameter is a closed server-only union of `payload-cup-forward-impulse-v1` and `payload-brake-observation-v1`. `PlantIdentity.simulationPerturbation` and `.completionObservation` flow to manifest and configuration hash. The two options cannot be combined through this interface. Existing default caller unchanged.
- `SpawnOptions.payloadPerturbationId` is server-only and checked before spawn for unsupported provider; no shared `mekoniq-sim3d/1` request extension. Python CLI enumerates the sole impulse option; arm session refuses it before model creation. Duplicate worker request returns cached ACK and does not advance/inject again.
- `TwinPayloadState` is generated in source `packages/contracts/generated/lab-v2.ts` by additive observed union in `twin-sample-v2.schema.json`. `RunReport.EntityView` is now `AmrEntityView | PayloadEntityView`; narrow on `kind`. Payload `distanceM:null` is deliberate unavailable information, not measured zero. `moving` is actual physics velocity thresholding, including falling after terminal fault. B04b must add this source schema/type branch to its browser validator and render using per-payload geometry, not xArm global cup size.
- Payload IDs are simulation entity IDs (`payload:cup-1`), not coffee custody IDs. Geometry is admitted cylinder radius0.04m/height0.1m, source map coordinates SI, quaternion xyzw. `supportId` is declared reference, not a current contact/custody guarantee. Preserve original top-level run/boot/seq/simTimeNs and physics_sim/frame map provenance. Empty truly has no payload samples/entities. Only committed cp snapshot is projected; arbitrary or pending worker observations never publish.
- `RunReport.physicsEvidence?` retains B03 shape/readers/availability. Tick0 priming remains raw; aggregate contacts/durations cover `(0,lastTick]`. Terminal expected-fault metrics remain unavailable; never render zero success or claim physical delivery from contact. Source journal alone governs mission/served/custody.
- Existing browser endpoints (authenticated session/bearer and normal CSRF for mutations): `POST /lab/v2/engineering/compile` with `{project}` containing the registered selector; `GET /lab/v2/engineering/bundles/<bundleDigest>/manifest`; `GET /lab/v2/engineering/blobs/<sha256>` for a file from that session-owned manifest. Read `navigation-scene.json`, then its admitted loadProfileRef and matching manifest blob; geometry also arrives directly in `TwinPayloadState.geometry`. Use `POST /lab/v2/readiness` with scenarioId/backendSetId/engineeringRef and ordinary `POST /lab/v2/runs` with that engineeringRef plus pinned runtimeIdentity. Existing `GET /lab/v2/runs/<runId>/telemetry`, `/report` and snapshot routes carry the additive payload branch. No new arbitrary path endpoint.
- Readiness still checks admitted bundle, exact worker/schema/profile closure and enabled backend; capabilities alone are not run admission. MuJoCo arm/mobile share one active world slot. Launcher prerequisites: installed source pinned portable closure, `.venv-mujoco` matching requirements.lock, Python3.11/MuJoCo3.17.0, Node24.22.2. Source campaign CLI uses source `.venv-mujoco`; Lab launcher reuses its pin and existing configured provider route. No browser engine or hardware bridge added.
- `verifyPayloadCampaign(root:string):Promise<PayloadCampaignVerdict>` is exported in `payload-campaign.ts`; fields exactly expectedRuns,completedCases,missingArtifacts,faultCases{id,detected,falseServed},issues. CLI verify and integration mutation tests call it directly. Exit0 all assertions; exit1 assertion/corruption failure; exit2 usage or missing pinned Python/MuJoCo prerequisite. It reads retained artifacts and independent B03 physics/navigation oracles, never summary metrics.

## All experiment input differences and invariants

All explicit selectors change project.mujocoExperimentId and therefore current-project provenance in derived physical/load/navigation/bundle/scene/run identities, even when mechanical parameters match baseline. `compileNavigationScene` current-project/world/assembly equality is preserved; no stale canonical.inputs substitution. The canonical physical fixture file and validated mechanics shape remain fixed. Selected loads change the exact load fixture ID/props/free initial attachment transform as registered (empty no props; offset uses admitted B01 cup-offset), with no invented hardware payload properties. Speed variants use center load and unchanged physics numerical profile; only applied numeric policy caps and derived capped navigation kinematics change. Policy id/source/content digest change only when numeric parameters differ from default. Entity cap remains null in campaign and still constrains browser projects; wheel limits unchanged. Controller algorithm `grid-diff-v1` / `2+mujoco-sent-ramp-v1`, sent-command ramp, controller profile bytes and stop policy bytes unchanged.

Friction variants alter drive contact sliding only numerically, plus profile id, contact-source assumption text, numericalInputsDigest, document digest, measurementLock.probeId and raw file hash. Low/high own probe IDs are not falsely b02a-locked. Baseline document digest `1ef1c4de61894e35e89fbbc8cb534c184ef66944e40fed60dedf496f81956480`; low `fa342b45c20e462a3d48a8a6cc7444c643cd4adaeec8dbb8e7854a77d8666562`; high `64efa556fd308f818a3806727eea307b38689821ed06331419285af34cd08626`. These are distinct from the file-byte identities in the table. Solver, engine, motor law, contact dimension/spinning/rolling, damping/mass/inertia, clock and substeps are unchanged. Low input is masked by max-geom friction at floor/cup contacts; it is not evidence of a lower effective contact coefficient.

Seeds7/19/41 alter run PRNG/engineSeed identity. This engine has no stochastic plant/noisy sensor inputs, so seed repetition is identity coverage, not uncertainty quantification. Repeats use identical seed/profile/configuration and compare actual raw physics records. Braking cases have cancelAtTick500 plus the registered completion policy; compare slow/fast with each other, not a baseline mission with a different cancel schedule. Worker-kill/ACK-loss preserve mechanics/scene but change server-owned injected fault input at advancedtick501. Cup-fall changes the explicit perturbation input/manifest/configuration; it must never compare as an unmodified run. B08 must match every unchanged invariant in PAYLOAD_SPEED_DIFFERENCES, permit only enumerated selected/derived fields and reject extra differences as incomparable.

## Actual probes and retained development artifacts

All paths below are new temporary outputs; none are historical qualification records. Probe/campaign accepted:false throughout.

Own physics probes:

- `/tmp/mekoniq-b04a-probe-low-final-20261114-0925`: summarySHA256 `059d7aaee3f2d1c3a281553c35049cdd5392ad54882fe570da731a731a2563d8`.
- `/tmp/mekoniq-b04a-probe-high-final-20261114-0926`: summarySHA256 `104a334dbba74298feab0786a4264a29f26c6c0d702ac1ad157302401d20baa7`.
- Each36 actual-engine runs, 18,000 raw ticks: three loads × hold/straight/circle/stop × three repeats ×500. Independent raw hash/finite/scene-profile closure and repeat recalculation in `evidence-B04a/probe-independent-check.json`: all finite, max repeat position0, quaternion angle max low9.884312124119402e-8rad/high9.424321830774485e-8rad (<1e-6).
- Command pattern with env below: `caffeinate -dims perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python robotics/simulation-mujoco/probe_mobile.py --physics drive-contact-low-v1 --out <low-final-dir>`; high analog. Logs `probe-low-final.log`, `probe-high-final.log`. Initial low0900/high0901 outputs retained but superseded: a raw scene.files variant declaration omission was found by RED test, fixed in probe, and both fully rerun. Baseline profile/probe output path remains unchanged.
- Real impulse native bounded probe/test logs `impulse-green.log`, `fall-runner-forward.log`, `payload-native-final.log` retain30N support-forward dose and actual fall520. Earlier provisional map-x/side impulse struck tray rod and did not fall; its different ID/frame artifacts in `fall-runner.log` and old development campaign are experimental only. Final changed frame uses a new registered forward ID and binds committed500 pose convention.
- Initial aborted test campaign `/private/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/payload-test-uBXH3z/campaign`: partial, incomplete. Owned processes11407/11400/11388/11566 terminated during early timeout correction.
- Full dirty development `/tmp/mekoniq-b04a-development-20261114-0913`:19 recorded, correctly failed verification due frozen worker.bootId wrapper and provisional side impulse; retained unchanged. Getter wrapper fixed, actual seed/perturbation provenance added, final fast case center-only. No claim that this is qualification.
- `/tmp/mekoniq-b04a-final-94270c8-20261114-0937`: partial superseded recording. Controller identified run status/recovery boundary issue during this run. Verified exact owned node14230, worker14440 (bundle root under this output), caffeinate14240 with parent chain; TERM only those; session exit143; `ps -p 14230,14440,14240 -o pid,ppid,command` showed header/no processes. Shared verify returns expectedRuns19/completedCases6 and explicit missing remaining artifacts. Retained incomplete; not final evidence.
- First complete clean recording `/tmp/mekoniq-b04a-final-a3a50a3-20261114-0943` uses source `a3a50a38d2cca1584443d32f103d24be979834f6`, owned caffeinate -dims and1800s timeout (not the too-short900s example). Its initial19/19 verdict was superseded by the separate readback failure explained below; retained as development evidence. Final replacement is the681b8ad path below.

## RED/GREEN and checks

Environment for all native source commands:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
```

Logs retained under `.superpowers/sdd/01-r2b-mobility/evidence-B04a/`. Tests were sequential native execution, no helper/reviewer agents. Filtered tests are not_run, not passes.

RED tests written before implementations:

- `perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts`: initial admission2failed (`admission-red.log`); focused `-t 'committed payload'`1failed/2filtered (`telemetry-red.log`); `-t 'missing run set'`1failed/3filtered (`verify-red.log`). Selectors/telemetry/reader then GREEN.
- `perl -e 'alarm 90; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_mobile.py -q -k registered_friction`:2failed/44deselected (`friction-red.log`). Native impulse1failed/46deselected (`impulse-red.log`); variant probe scene closure1failed/48deselected (`probe-closure-red.log`). Final entire mobile/contact files56passed.
- Health `-t 'health exposes'`:1failed/5filtered (`health-red.log`); speed provenance1failed/6filtered (`speed-provenance-red.log`); payload distance null1failed/6filtered (`payload-unavailable-red.log`); actual moving1failed/6filtered (`payload-moving-red.log`). All subsequently covered by focused GREEN and final file.
- `tests/unit/payload-experiments.test.ts` provider refusal1failed/1filtered and immutable impulse identity1failed/2filtered (`provider-refusal-red.log`, `impulse-identity-red.log`); final unit3passed. No shared wire schema disturbance added.
- Registered brake window initially1failed/7filtered (`brake-tail-red.log`), then1passed/7filtered (`brake-tail-green.log`). B03 five-observation metric unchanged; no default cancellation extension.
- Concrete controller boundary correction: `perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts -t 'durable terminal boundary'`: RED3failed/7filtered, cancelled instead running (`brake-boundary-red.log`). After status fix, restart RED expected needs_attention but running (`brake-recovery-red.log`); two other failures in that intermediate run were test-only velocity field spelling, corrected to existing vMps/omegaRadps. Final same command **3passed/7filtered**,16.00s (`brake-boundary-green.log`). Covers real single-tick terminal caller, journal-cancelled/report-running midtail, exactly five zero targets/no new effects/confirmations, completed world refusing extra steps; interrupted tail reopen needs_attention/no respawn/step refusal; actual advanced tail ACK loss/no retry/additional observation.

Broader GREEN:

- `caffeinate -dims perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/integration/physics-evidence.test.ts tests/unit/physics-metrics.test.ts tests/unit/mujoco-drive.test.ts tests/integration/mujoco-arm-worker.test.ts tests/unit/mujoco-arm-ports.test.ts tests/contracts/mujoco-payload.test.ts tests/unit/payload-experiments.test.ts`: **10files105passed**,60.98s (`source-regression.log`), before the later completion-tail fix. Existing B03 quota/recovery/metrics included.
- `perl -e 'alarm 180; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_mobile.py robotics/simulation-mujoco/tests/test_contact_metrics.py -q`: **56passed**,4.08s (`python-final.log`). Includes unknown/arm impulse refusal, duplicate-request no-reinjection, measured finite force response/cleared force, variant locks/closure. No Python changes after this test.
- Source actual telemetry/fall focused **2passed5filtered**,6.39s (`payload-native-final.log`); no fall retry, LOAD_FELL520, served0.
- `tests/integration/lab-v2-software-gaps.test.ts tests/unit/payload-experiments.test.ts`: **11passed**,19.72s (`legacy-types-regression.log`). Existing mock test narrows AMR union only; same assertion.
- Final after completion-boundary fix: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-lifecycle.test.ts tests/unit/bv01-mock-golden.test.ts`: **2files17passed**,22.09s (`boundary-legacy.log`). Preserves mock BV01 digest/arm golden and existing mobile startup/recovery/recording behavior.
- `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `git diff --check`: pass before first commit; final tail code typecheck pass (`typecheck-boundary-final.log`) and lint pass (`lint-boundary.log`). Intermediate typecheck test unknown-payload error corrected with an explicit narrow cast; no hidden failed gate.

Initial clean export and Lab pin commands (all exit0, superseded by the reader-fix final tuple below):

```sh
perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-b04a-a3a50a3-export-20261114-0944
# From Lab:
perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-b04a-a3a50a3-export-20261114-0944
node scripts/sync-engineering-contracts.mjs
perl -e 'alarm 120; exec @ARGV' pnpm check:source
perl -e 'alarm 120; exec @ARGV' pnpm typecheck
```

Logs export.log/lab-import.log/lab-check-source.log/lab-typecheck.log. Lab check binds source/schema/protocol/node. Export artifact hashes independently checked in the matching identity files.

## Limitations / not_run / self-review

Development simulation only, not_calibrated and accepted:false. No whole-branch CI/build, new qualification candidate or hardware/device/native-Linux/ROS/Gazebo/LinuxCNC gates closed. No B04b browser/UI/offline/replay acceptance tests, no B05/B06/B08 feature claims. Lab mobile importer remains intentionally unadmitted; B04b is required. Full IR-SIM/Webots regressions not rerun in B04a: wire bytes/default paths unchanged; unsupported perturbation provider refusal has focused test. Prior B03 runs remain prior evidence, not claimed reruns. Final source campaign and fresh temporary-copy mutations are this task's explicit actual proof.

Self-review checked closed browser selector/default preservation; exact profile-byte admission/probe ids; current-project physical provenance with fixed canonical mechanics; telemetry through independent mobile record/entities path; default arm/shared slot behavior; bounded reader paths/size/hash/journal/raw physics requirements; original18 preserved plus mandatory19th; named perturbation input/receipt frame/once-only finite force; stopped policy and B03 interval rules unchanged; physical completion vs business cancellation and restart/ACK loss; clean export/pin. No arbitrary force API, teleport/qpos manipulation, invented custody or measured-zero substitution added. Exact artifact identity is not an external trust signature: a fully forged archive whose producer and every hash are rewritten still requires an external trust anchor. Automatic summary is never the assertion authority.

## Measured input-identity audit from the final clean compilation

`evidence-B04a/registered-input-identities.json` retains all seven byte-verified bundle/project/scene/physical/load/navigation/policy digests, effective kinematics and recursive exact changed-field lists relative to center. This is a derived audit of the final campaign's retained compiled blobs, not input rewriting. B08 must also compare reference copies of declared changed fields: `navigation.navigationPolicyRef.id/hash` mirror `policy.id/hash`; scene embeds the same model/policy and their content-addressed file refs/bytes. The declaration's semantic policy/model entries do not authorize other navigation fields. Controller explicitly accepted these expanded reference details as a B08 handoff: PAYLOAD_SPEED_DIFFERENCES is descriptive, and no comparator consumes it in B04a. B08 must make its allowed-difference definition exhaustive and tested before exposing comparison; this report does not claim an already enforced counterfactual comparator. Exact recursive lists in this audit/report make those references explicit.

Both speed variants change exactly these non-scene document fields relative to center (plus file hashes and closure identities derived from them):

- project: `project.mujocoExperimentId`.
- physical: `physical.inputs.project.digest`, `physical.modelDigest`.
- load: `load.digest`, `load.modelRef.sha256`.
- navigation: `navigation.inputs.project.digest`, `navigation.kinematics.maxAngularRadps`, `navigation.kinematics.maxLinearMps`, `navigation.modelDigest`, `navigation.navigationPolicyRef.hash`, `navigation.navigationPolicyRef.id`, `navigation.physicalModelDigest`.
- policy: `policy.hash`, `policy.id`, `policy.parameters.maxAngularRadps`, `policy.parameters.maxLinearMps`, `policy.source.contentSha256`, `policy.source.documentId`, `policy.source.locator`.

Scene additionally mirrors the following exact declared changes (array indexes are this canonical fixture ordering):

`scene.engine.loadProfileRef.sha256`, `scene.files[3].sha256`, `scene.files[7].sha256`, `scene.inputs.project.digest`, `scene.policy.hash`, `scene.policy.id`, `scene.policy.parameters.maxAngularRadps`, `scene.policy.parameters.maxLinearMps`, `scene.policy.source.contentSha256`, `scene.policy.source.documentId`, `scene.policy.source.locator`, `scene.robots[0].model.inputs.project.digest`, `scene.robots[0].model.kinematics.maxAngularRadps`, `scene.robots[0].model.kinematics.maxLinearMps`, `scene.robots[0].model.modelDigest`, `scene.robots[0].model.navigationPolicyRef.hash`, `scene.robots[0].model.navigationPolicyRef.id`, `scene.robots[0].model.physicalModelDigest`, `scene.sceneDigest`.

Effective slow caps0.2m/s,0.4rad/s; fast1m/s,2rad/s. Both retain wheel radius0.09m, wheel separation0.36m and both wheel limits20rad/s.

### payload-center-v1

- projectDigest: `77f0a996daef4b4c54e22865149d64fa6d7a4b467873cad6157361b5d547374b`
- bundleDigest: `36d9b9b6454c26a91a967078ffd8df021abb923fb685666a9b2d7358f1b4d966`
- sceneDocumentDigest: `dc90f74bdeb9ddbb88bfae21fe0fad6c0e456dacf1165a598b56406b87e9f710`
- sceneFileSha256: `2b6d210787d8fc67950c3364fbdb735f11c5a11e55b30b8d57332135f71fda1c`
- physicalModelDigest: `0a9197303c622f92fcffb8e3b814a8d14b07377dd502c3a2c6f51c1f6f7f0623`
- physicalFileSha256: `9a416e1c783c01627c402171ef4ccbaf60e05d4d67a2d04724bd71d90d262a41`
- loadDocumentDigest: `d9d0552f29c9dc2452bb2c20a4d041321a6456284dc684dc96b49343f7476ec7`
- loadFileSha256: `0290f280969726aadde1137c502f128738912e4b08c9328b1af4fd6c914ecfc5`
- physicsProfileFileSha256: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`
- navigationModelDigest: `ddb6cee06cea50c51e9b85b256630ee48b56453e4872817ebca85379952ecf92`
- policyHash: `e27ac0cb974b24838ad4c88d2739c8d3e1e56b4b6ddb31d7e0feab5af9a4f1f8`
### payload-empty-v1

- projectDigest: `b9fa77ec97522fe10cbc4636a4dcd3f30b31d1edb93fa97d4a2ad8b3ced6c668`
- bundleDigest: `bb58c68e70247e65238e1714180162032c667d90ab16cd6f7c0afcc875fb1ba0`
- sceneDocumentDigest: `0af049c7afb44f2dc1d65a5db89e440f8cd8967f54f76cb5c32827b5ce7a8d83`
- sceneFileSha256: `ebd431d2f526bb85f9d0cef1d8195734bf7ab4d07a8c0d8d1dcda327b0ba7b41`
- physicalModelDigest: `ede7c2d902cf126724659e39e20fe6e4b7a5774a5da072d5fa544f7482d8625d`
- physicalFileSha256: `9d935e14f2c17b941dff819021116bde5293d8765974cf9c3c2defbda956c402`
- loadDocumentDigest: `7b081c2cfb81acad21cc32b7073cc3d37cbc7a8b5b3ba5e8e61e1fa267707f17`
- loadFileSha256: `93b12965a96bdbf8fa7f26fa65a4a968879927129069ccb50a32765ad30a0b9a`
- physicsProfileFileSha256: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`
- navigationModelDigest: `535f3c045af0f184c6a1c99b3f22bf7dbfeb9649b3bf1d5f88056f78af3feb85`
- policyHash: `e27ac0cb974b24838ad4c88d2739c8d3e1e56b4b6ddb31d7e0feab5af9a4f1f8`
### payload-fast-v1

- projectDigest: `6237b7debc0c8d42951c4a68c9a024eb5ceaa8c71d19c70598c6485714c7b567`
- bundleDigest: `be061271d966a0e7d48d30fa8ef7af3e90f29e23650637658f3bce81132e4de1`
- sceneDocumentDigest: `e57f4e1b24dbf360086cc333fb891c38ab9aa3c39e66bfbda66de3deafbc4be1`
- sceneFileSha256: `f42d6c61e5b8ca6e5b1193d1b5d710724c0db6c5354b4bdf9fab177a41ead20f`
- physicalModelDigest: `83e3aceb84e377ce4292f50e67bd648ff3dc286327c592b358171f60dd74c2b6`
- physicalFileSha256: `ec46194a6067b4b7c4264d5376dc99ed97e1c4cf12ee124f9b89db1523c33cb6`
- loadDocumentDigest: `e3182251c2939a928a088969ce4c30143257d654ade2342f1d7203a99e89dd2e`
- loadFileSha256: `57c6d01b01fabe9a914f685eb6574f145626489ddc74dfb88234797c00df4372`
- physicsProfileFileSha256: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`
- navigationModelDigest: `d4b200f2161489533bf08483a734763c48503713d72e461c320f9cfa3576c653`
- policyHash: `597a742bb9aa11b22ca01329670f23beb3ad035cdc779ca8e84174dcf626ffb1`
### payload-friction-high-v1

- projectDigest: `54ba9fc6413aae5c7f76991a338e16c837da3a4daeb42ac1d4b7b450ede25bc8`
- bundleDigest: `aae209859fff2ee353d9bb6a140080900afc9de5612e426cdf82ac92c40f4f76`
- sceneDocumentDigest: `d8745de200f446a7919de3155b472c8887d37d0f97a141577009274a66fcb06f`
- sceneFileSha256: `a93e2fad5634dd5fb30c621ce1a8e0fd042018bdeeaf27ce3ac1d5ebcc725f19`
- physicalModelDigest: `e6d45da322f211166e6e3079f165299fd9f5631e41e68bbf9539bda360a87969`
- physicalFileSha256: `0aa54b16a3b8d2cae73b1a94bb4f05daf49ffd3954e1888dbc8811798c35401f`
- loadDocumentDigest: `93a4ead3f848496d80704f4eaadf16c1c1e0adb79e7e79b8b84d269930a62ef4`
- loadFileSha256: `c2acbe1b4d1227739493047ddadd410a738e0cd346f9d3aac9e649291f75696b`
- physicsProfileFileSha256: `9d1f7f3315cfe9df89ed8b8b15361b3fd09d66dedbe4ea5240a5c04b54ecbe8a`
- navigationModelDigest: `558db8aca2b531843aaa2d9e8f709c72635a257cad26d3bf2e5aa045ba8722e3`
- policyHash: `e27ac0cb974b24838ad4c88d2739c8d3e1e56b4b6ddb31d7e0feab5af9a4f1f8`
### payload-friction-low-v1

- projectDigest: `0a2eb1f5c552cff55de3f0d43f875c9e0d859fbb8bcd349b3ef00c62276673e6`
- bundleDigest: `34e0b1b9ec3e3120f4c5067325c9fb3cdb4fb61e89bb741e9e3b9d14f258648d`
- sceneDocumentDigest: `2e93413f5d4db1ae0ddd08281074511ec0f381bfac9231f38df26229ee6364f5`
- sceneFileSha256: `6400c6c96d8d11d5ddbcd40c4449b28eb300eaa48cd8ad2e0bab97879f93132a`
- physicalModelDigest: `e0ef8d2aafe1321de0117c3d6fe5354e45518efd6345c980f7e37111b8bb8a40`
- physicalFileSha256: `df8f125466b5e333215a4c62cf7561fe991168ba9cd30b61046891b979802037`
- loadDocumentDigest: `76f56c2618bd07a9f81be1abc56c0ca283bed5482d2e2c1312b0c0681fbdeabf`
- loadFileSha256: `63eda45f650fb053a190e392651ca66d4fce78a5e8ed9980117380e090b8f4a7`
- physicsProfileFileSha256: `c9aec2a6a250e81f4c5c1d1372e88d7d90340b7e42f7526fe90a7ad3d1d4ad9c`
- navigationModelDigest: `439881d2955c4cc74dd57bbe0b53e992619ef943460255e52f50338b0249c5e6`
- policyHash: `e27ac0cb974b24838ad4c88d2739c8d3e1e56b4b6ddb31d7e0feab5af9a4f1f8`
### payload-offset-v1

- projectDigest: `5fe52577b2aa84a06b6c861974f06eff297e2e82e9927c9876612ba1b37ee61b`
- bundleDigest: `fafa6571d2fc052a06bde596d66740ee8cec62cb0831005434c41daf41717b26`
- sceneDocumentDigest: `443d992b198b7156fbffd86cbba1fb8325dca418c0777baa28bfad5f5b6fa0e0`
- sceneFileSha256: `59eb1106a0bf35c1884455952f23915e60548b1b09f555e78e1ca3bcbb5a1bec`
- physicalModelDigest: `7911d0ffabcc5711e81259bd3607f5d1f8c242f28b73777f2ca840793574e53d`
- physicalFileSha256: `c8967916576c4bf765427337559252a1ffec9b3a144a4d6fe7e8c0f14aec0652`
- loadDocumentDigest: `40c36cf57813fa3747428a2c21a49421f0603ed3a8409a3c1277043f7172fa05`
- loadFileSha256: `70b65bfc4f8f6cde0cc6b0be9f8520db42dc0940054d311c16fca96f54276fdd`
- physicsProfileFileSha256: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`
- navigationModelDigest: `2da7fd3c9729d8a38ec7eb1a9ad1c6fbc40cfbbd235bb09540070a4cefedc282`
- policyHash: `e27ac0cb974b24838ad4c88d2739c8d3e1e56b4b6ddb31d7e0feab5af9a4f1f8`
### payload-slow-v1

- projectDigest: `f3e019badc165c5ded511c824e06d013705feec0a5519bfebd854d573a6e7464`
- bundleDigest: `6bda693b914366f3f23a9afb9d249de6a803513004625ef1fcf7687a841eca7e`
- sceneDocumentDigest: `663f4528fd7bc629c951aed931ef96b2d62aad18ab0ea4212b43ffc0eb25c0c9`
- sceneFileSha256: `df1f4d82745fae6a4720e12531c502185fdbe811ae74f1c59a728ad852f44342`
- physicalModelDigest: `510a385be6c1ba5efe17bd0c342aad7f2358294921c068e3756221fd61c16c3a`
- physicalFileSha256: `01107f217a2167ae2877d30487c1528c73abdfdf325295e7546bbc55d16fcd84`
- loadDocumentDigest: `dc587a0f45ee0ef0a19e8b611a7cb17fe3b8fd3c5f617f8f250ecdcd21c2d20b`
- loadFileSha256: `40844e65bca727e60c6446c816d19177383b35b1079bbb64bb0409751a8a34b5`
- physicsProfileFileSha256: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`
- navigationModelDigest: `ff3b3ca75aa0f7d0c60463e44251b3ebc3655824db60daf892917368a9f7c0e8`
- policyHash: `20ea6cfa68e7edd8342f13e8500732fe7e4bf931bf4bf1f154ba7aea3747655b`

## Journal reader correction after first clean19

The a3a50a3 actual run finished19/19 (three expected faults detected/no false served) but a separate CLI verify failed0/19 with UNLISTED_ARTIFACT. Root cause: Node DatabaseSync({readOnly:true}) opened retained WAL-mode journal.db and created unlisted journal.db-wal (empty) and journal.db-shm. First verify therefore polluted its own archive. The a3a50a3 output remains unchanged as failed round-trip evidence, not final qualification. No unlisted-artifact check was relaxed.

For focused RED, copied the archive to `/tmp/mekoniq-b04a-reader-red-fixture-a3a50a3-20261114-0954`, then removed only the unlisted reader-created sidecars in that test-only copy after checking none belonged to case.artifacts and each WAL was zero bytes. `reader-fixture-restoration.json` retains exact paths. Original retained evidence was never rewritten. Added repeated shared verification test: first19/19 then second unexpectedly0/19 (UNLISTED_ARTIFACT), **1failed/9filtered**,6.36s (`reader-no-mutation-red.log`).

Fix: bounded verified journal artifacts copied into unique owned `payload-journal-read-*` temporary directory (including a recorded WAL/SHM if present), DatabaseSync opens only that copy, closes in inner finally, removes only owned temp in outer finally. All original artifact byte/hash checks and strict unlisted check remain. Expanded integration proof inventories every path, size and SHA256 before/after successful readbacks and each missing/skip/seed/profile/corrupt/fault failure. First repeated readback/mutation GREEN1passed/9filtered,28.10s; stronger complete-inventory result appended below. No physics numerics/probes/lifecycle implementation changed.

Focused command: `PAYLOAD_CAMPAIGN_EVIDENCE=/tmp/mekoniq-b04a-reader-red-fixture-a3a50a3-20261114-0954 perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts -t 'actual 19-run'`. Final recording must be at corrected source/export commit, not this restored test fixture.

## Final reader correction identity/checkpoint

Source681b8adb8ed473f7195062773b23fabc3b922cd5 and Labcbeb5817cd65d53182aa080df3e566ad656d4945 are the final pair. Repeated successful readbacks plus all six failure mutations, with every path/size/hash unchanged: **1passed/9filtered,29.71s** (`reader-inventory-final.log`), after rechecking each SQLite copy byte/hash immediately before writing to owned scratch. Final reader `pnpm typecheck`, focused ESLint and diff check exit0 (`typecheck-reader-final.log`, `lint-reader-final.log`). Earlier lifecycle/numerical tests not repeated for this reader-only correction.

Re-exported with180s bound to `/tmp/mekoniq-b04a-681b8ad-export-20261114-0954`; imported with120s bound, sync script, `pnpm check:source` and `pnpm typecheck` with120s bounds all exit0. Logs export-final/lab-import-final/lab-check-source-final/lab-typecheck-final. Runtime/schema/portable/native identities independently checked in `final-identities-681b8ad.json`; both worktrees clean. Final pin changes only lock and generated commit headers.

Replacement final command: `caffeinate -dims perl -e 'alarm 1800; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign payload-v1 --out /tmp/mekoniq-b04a-final-681b8ad-20261114-0954`. This is the source commit used for final export. The previous a3a50a3 numerical record is superseded because its old readback mutated SQLite sidecars; it is never relabeled final.

## Final exact-commit actual campaign and repeated readback

Final source **681b8adb8ed473f7195062773b23fabc3b922cd5**, output `/tmp/mekoniq-b04a-final-681b8ad-20261114-0954`. Run command above exit0; shared verifier **expectedRuns19/completedCases19, missingArtifacts[], issues[]**, worker-kill/ack-loss/cup-fall detected:true and falseServed:false. All19 original case inputs/source commits checked against this clean export commit; accepted:false remains. Original18 preserved plus one required supplementary actual cup-fall.

Independent subsequent CLI command `perl -e 'alarm 180; exec @ARGV' node scripts/lab-mujoco.mjs verify --input /tmp/mekoniq-b04a-final-681b8ad-20261114-0954` also exit0,19/19 (`verify-final-681b8ad.log`). Complete original archive inventory before/after byte-identical: **1,643 paths,1,453 files,112,432,483 bytes**; inventory SHA256 `8542ed9eedb5b2f7411bf335cf1c547270f005950bc8c7fa4b129153957a3bbb`. Retained campaign-inventory.py and before/after JSON establish no verifier side effects on the supplied archive.

Summary SHA256 `8c9a0df3a381de055a01fbb436b296a326c7bcfa9e275f383dc2c2186ef0e3c7`; campaign.json SHA256 `f8ea3b13d140d760009891b28502c56ce22b947dfb6acac4d43cc0703f26518b`. Full retained assertion summary/dose/receipt in `evidence-B04a/final-campaign-assertions.json`; original per-case records include report, input, bundle, actual request trace, journal.db, navigation chunks and physics chunks with hashes.

| Case | Last committed tick | Outcome | Served | Physics coverage |
|---|---:|---|---:|---|
| turn-empty-s7 | 3451 | completed | 1 | complete |
| turn-center-s7 | 3443 | completed | 1 | complete |
| turn-offset-s7 | 3666 | completed | 1 | complete |
| turn-empty-s19 | 3270 | completed | 1 | complete |
| turn-center-s19 | 3227 | completed | 1 | complete |
| turn-offset-s19 | 3461 | completed | 1 | complete |
| turn-empty-s41 | 3288 | completed | 1 | complete |
| turn-center-s41 | 3276 | completed | 1 | complete |
| turn-offset-s41 | 3463 | completed | 1 | complete |
| repeat-center-s7-r1 | 3443 | completed | 1 | complete |
| repeat-center-s7-r2 | 3443 | completed | 1 | complete |
| repeat-center-s7-r3 | 3443 | completed | 1 | complete |
| brake-slow | 519 | cancelled | 0 | complete |
| brake-fast | 551 | cancelled | 0 | complete |
| friction-low | 3443 | completed | 1 | complete |
| friction-high | 3436 | completed | 1 | complete |
| worker-kill | 500 | needs_attention | 0 | declared expected terminal incomplete |
| ack-loss | 500 | needs_attention | 0 | declared expected terminal incomplete |
| cup-fall | 520 | needs_attention | 0 | declared expected terminal incomplete |

Nominal16cases have complete independent navigation/physics coverage, actual turning commands, finite contact impulse/tilt/position and yaw odometry metrics. Empty loads correctly have unavailable load displacement; loaded cases have it available. Three extra center/seed7 repeats match baseline raw physics records exactly. Both brake cases cancel at500: slow tail514→519 with measured stopDistanceM1.8994654808289085e-5m; fast546→551 with measured stopDistanceM0.0012173671971239836m. Those are uncalibrated measured simulation metrics, not a hardware braking-distance claim or automatically comparable causal effect outside the declared inputs.

Worker-kill and ACK-loss each advance the actual engine to501, retain the real501ACK, but source remains committed500 with exactly the unknown501 STEP_ACK_LOST gap, terminal/incomplete physics and source RobotCommandObserved unknown. Kill is the captured owned worker PID after actual applied step before delivery; loss drops that actual ACK before runner delivery. One spawn,501unique requests,no resend/respawn; attempted retry refused.

Cup-fall actual injection at501 from committed500 support pose,10substeps,30N support+x/0.6Ns, map-held force, original run/boot/profile bound. Its measured before→after pose displacement is 0.02520553076959742m (<0.05m non-teleport bound). Actual source monitor LOAD_FELL at520 after exactly five consecutive below-threshold support-relative observations; preceding observation above threshold. No physics gaps, retained committed horizon520, one spawn,520requests, zero served, extra step refused. Physics terminal LOAD_FELL stays incomplete/unavailable; it is a passing expected-fault assertion, not a successful mission. Actual receipt forceMapN [0.034104216777046115, 29.999980610748224, -0.0005070778116320744] and supportPoseMap {"positionM": [1.996758668658612, 1.4735369340495097, 0.5178357702526177], "quaternionXyzw": [-7.22522856823075e-06, 4.728131362411246e-06, 0.7067047448296171, 0.7075085890367316]}.

## Final completion checks

Full required source integration file at final source681b8ad, using the fresh final19 recording and private temporary copies for all mutations:

```sh
PAYLOAD_CAMPAIGN_EVIDENCE=/tmp/mekoniq-b04a-final-681b8ad-20261114-0954 caffeinate -dims perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts
```

**1file/10passed, no skips,47.81s** (`payload-integration-final.log`). Includes all selector/provenance/health/schema/telemetry checks, original19 roundtrip plus repeated no-mutation readback, missing run/unexplained skip/wrong seed/wrong profile/corrupt physics manifest/wrong expected fault rejection, actual engine fall/no retry and three real braking-boundary modes. Mutation tests inventory all files/bytes/hashes on each success/failure and mutate only their private copy; original final evidence remains untouched.

All seven final compiled bundle manifests and each referenced blob independently rechecked; manifest-byte maps equal the earlier measured seven-selector identity audit, confirming its exact hashes/diffs apply to final681b8ad. Only source/run provenance changed with the reader-only correction; mechanics/solver/profile/probe bytes unchanged.

Final source and Lab status/diff checks clean. No owned campaign/test process remains active after successful tool exits; no host settings or unrelated processes changed. Full report is ignored task-workspace evidence, as requested; product changes are committed only in authorized worktrees. No push/merge/deploy/provision/hardware action. Independent review and B04b remain controller-owned next steps. B08 descriptive declaration/reference expansion limitation remains explicit above; it is not an implemented comparator claim.
