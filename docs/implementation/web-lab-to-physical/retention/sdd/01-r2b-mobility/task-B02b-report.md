# B02b — MuJoCo mobile provider integration

Status: DONE_WITH_CONCERNS (bounded, uncalibrated simulation scope; the initially skipped compiler integration case now passes—see final follow-up). Implementation is ready for independent review. Source base: `eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc`. Commit: `3e0c60e4b57fd78b0c007a5361c6b85448c42e69` (`feat: integrate the MuJoCo mobile plant`), 34 files, 845 insertions/79 deletions. `git status --short` is empty after commit. No merge/rebase of newer original-checkout commits, push, deploy, physical execution, full runtime export or Lab mutation was performed. Controller owns review, clean export and Lab pin; the separate frozen-upstream refresh remains controller work.

## Delivered APIs and admission

- `createMujocoCompiler({workerRoot}):CompilerPort` in `engineering/mujoco-compiler.ts`, compiler version `lab-mujoco-compiler/1+<NAVIGATION_COMPILER_VERSION>`, profile `engineering-mujoco-3d-v1`. Exactly one AMR, canonical Serve mechanical/sensor projection, center free cup, locked B02a drive/contact bytes. It refuses unsupported mechanics, extra entities and profile changes. It derives a new MuJoCo project/input identity instead of rewriting the canonical Webots-requesting Serve fixture. The projected physical model has the new input digest; load modelRef is rebound to exact projected bytes and load digest resealed. All referenced canonical model, cell layout, assumptions, physical model, load, drive, stop and controller-policy bytes enter scene.files before sealing. Compile remains `runnable:false`; actual create admission is separate. Registered portable profiles cannot fall back to the native default compiler.
- `mujocoMobilePlant(runtime):PlantPort`, backend/model `mujoco_3d@3.17.0` / `mujoco_serve_diff_drive`, protocol `mekoniq-sim3d/1`. Real Python worker, exactly one velocity per step and empty actor updates. Existing producer create/step payloads and locked physics are unchanged.
- `mujocoFromOptions` returns arm plus mobile capabilities/readiness. Its new optional `bundleFile(digest,path)` enables mobile; old arm-only options still work without engineering. Real describe verifies runtime lock/interpreter; real create smoke validates admitted scene/profile and initial physics. CLI registers compiler before provider creation, passes bundle reader, and only advertises mobile when engineering-backed capability is installed. MJ-FD01 uses FD01 business flow and only the new engineering set. All other scenario/set selection remains as before.
- `MujocoProviderLike.mobile` is optional for old in-process callers. `portableSimulationFromOptions` adds mobile to the existing dispatcher/readiness composition. Export metadata retains old `provider:'mujoco_arm'` and adds `providers:['mujoco_arm','mujoco_3d']`; actual clean export belongs to controller.
- Shared `MUJOCO_SLOT='mujoco_engine'`: slot helpers alias arm/mobile/future cell. Both readiness create probes use one exclusive gate and reserve the same slot before world creation through worker close. A running world blocks either probe; a blocked probe blocks run admission and another probe. Run/arm close now releases only after process close, including terminal/lost/reclaim paths. One runtime world, no retry/resume after an uncertain ACK.

## Explicit policies, observations and provenance

`MOBILE_STOP_POLICY`, `MOBILE_CONTROLLER_POLICY`, `prepareMobileStopMonitor(scene,read)` and `createMobileStopMonitor(scene,load,policy)` live in `simulation3d/mujoco-mobile.ts`. PlantPort adds optional `prepareStopMonitor`, PlantIdentity optional controller/adapter identity and telemetry origin. Legacy callers retain old defaults and serialized identity.

The compiler serializes two server-owned revision-1 policy documents. Runtime admission verifies declaration, byte length, byte hash, ref identity and exact supported document content. Optional refs were added to the MuJoCo navigation-scene engine schema, keeping old B01/B02a scenes valid while the new provider requires both refs. Python uses the same updated closed schema; it accepts the new declared fields normally, without schema bypass or Python code changes. New report engine branch requires all stop/controller/load/physics refs.

- `serve-mobile-stop-v1` byte SHA: `a7d4495eaa110bc617c8ca0ecc4ef78fa1bc7a54e89a3d24041efc3e5072281c`. Absolute roll/pitch strictly above `0.7853981633974483` gives BASE_TIPPED. Finite height outside restZ −0.6/+4 wheel radii, using the existing floor-clamped lower reference, gives PLANT_UNSTABLE. Observed free-load poseInSupport.z at least 0.10m below its initial profile z for five consecutive logical ticks gives LOAD_FELL. Recovery resets the hold counter. Same prop/support identity and valid clock/frame/physics are required; missing or invalid observation gives PHYSICS_OBSERVATION_INVALID, not a fall. Experimental cutoffs, not calibration or safety ratings. Webots constants/semantics are unchanged.
- `serve-mobile-controller-v1` byte SHA: `2a2909801f809ea9d76e122c4b1a2104afbcdeccbf467767198a217fad2513eb`. Controller identity `grid-diff-v1` version `2+mujoco-sent-ramp-v1`; `NavigationControllerOptions.ramp='previous-sent-command-v1'`. Per-robot sent-command state starts at zero on a new run, survives pause/resume/goal transitions and cancel, and follows every actual output including explicit terminal zeros. Cancel targets ramp toward zero. Measured velocity still controls arrival/stopped decisions, obstacle stopping distance and progress. Lost/refused/uncertain steps remain terminal. Legacy controller default remains version 2, measured-velocity ramp.
- Adapter override reaches firmware, Robot.Observe model and reconciliation; mobile AMR TwinSample origin is `physics_sim`, legacy remains `controller_sim`. Report engine is MuJoCo 3.17.0, timestep2ms/substeps10 with real Python/platform/lock. `mujoco-identity-seed-v1` honestly labels the existing deterministic uint32 derivation as identity only, with no NumPy engine RNG; plant has no stochastic dynamics/sensor noise/actors. Priming offset remains engine `(tick+1)*20ms`, logical snapshot `tick*20ms`.
- MuJoCo wire treats CONTACT_CAPACITY_EXCEEDED as fatal alongside PLANT_UNSTABLE. Post-advancement failures are unknown, not safely retryable admission errors. Webots fatal constants are unchanged.
- B03 seam: mobile LiDAR caches the last real publication at `floor(snapshot.tick/publishEveryTicks)*publishEveryTicks`. Recorder checks exact expected tick, original simTimeNs, sensor/robot/frame identity and presence/uniqueness; missing new publication, stale/future sample, absent scan, wrong time/frame are refused. Only actual publication ticks are persisted. Legacy admission and serialized chunks stay unchanged. This does not add a durable physics sidecar.

## Measured integration diagnosis and completed run

Initial real MJ-FD01 failed at tick1 because the recorder expected an every-tick scan; corrected only the explicit mobile recorder branch after controller ruling. Next real mission stopped NO_PROGRESS tick493. Raw stall diagnosis showed tick300 command `[0,-0.030627171957019812]`, measured `[8.433340475180356e-9,-0.0006272467326130541]`; wheel target ±0.061254343914039625rad/s, actual +0.0030580563808212083/−0.0030583581220740607rad/s, torque +0.11639257506643683/−0.11639197158393112Nm, zero saturated substeps. Repeated measured-velocity ramp increments of 0.03rad/s could not overcome modeled caster friction. Controller approved the explicit sent-command policy; no gain/brake/contact/solver tuning occurred.

Raw logs remain `/tmp/b02b-stall-physics.ndjson`, `/tmp/b02b-mission-trace`, `/tmp/b02b-mission-diagnostic.log`, copied under `evidence-B02b/` including `stall-run/`. These are diagnostic run data, not runtime exports. A compact committed durable research note is `docs/research/2026-11-mujoco-mobile-provider-integration.md`, containing immutable inputs, diagnosis, policy hashes and result.

Final real source-driven MJ-FD01 seed7 completes at tick3443, one served order and parking complete, through engineering service, real provider describe/create, dispatcher, source journal and real worker. Integration pauses/resumes at tick1000 without changing the result. Host darwin-arm64, Python3.11.15, MuJoCo3.17.0. Test identity is explicitly `sourceCommit:'test-commit'`, never a qualification candidate.

- Scene: `ff01c15980dbd6b10ac50988353ae11537255d26d8b0b5ce4e339ff34f575884`.
- Locked physics SHA unchanged: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`.
- Derived load SHA: `493778590f0e6eef07c5482ec645d4f561232adfee45a3ea9ade0c1eca9a5cad`.
- Worker lock: `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84`.
- Trajectory: `def1455d28b3d8dc653327ff06de8effb5412fdfea2dfc5d4af83f547895861b`.
- Sensor: `32c1982ac92b9c43754a00c4cd8edb075abb76f91c4830785790ddda77a02b90`.
- Assertion: `5986b2aa09480aebec7e32768071f106a406a21843879a90a8cdb24815dd0898`.

## TDD and verification evidence

Commands run from the source worktree with Node24.22.2 PATH. Worker runs use `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`. Logs copied from `/tmp/b02b-*.log` to `evidence-B02b/`. All filtered/skipped cases below are not_run, never counted as passes.

Focused command prefix: `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run` (long real mission rounds alarm300/600). The specific files/filters and observed RED → GREEN:

| Behavior | Command suffix | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Compiler/plant first API | `tests/integration/mujoco-mobile-worker.test.ts` | `b02b-red.log`: missing new module, collection failure (0 tests) | real worker/compiler tests in final broad |
| Mobile readiness/shared capacity | `tests/integration/mujoco-mobile-readiness.test.ts` | `b02b-ready-red.log`: 3 failed, mobile undefined | final broad 4 passed |
| Stop boundaries/hold/frame, fatal taxonomy, descriptor | `tests/unit/mujoco-drive.test.ts` | `b02b-policy-red.log`: 6 failed | final focused/broad; final transition run 7 passed |
| Runtime compiler registration | `tests/integration/mujoco-mobile-worker.test.ts` | `b02b-runtime-red.log`: 1 failed/3 passed, PROFILE_COMPILER_UNAVAILABLE | real full mission passed |
| Stiction controller | `tests/unit/mujoco-drive.test.ts` | `b02b-ramp-red.log`: 1 failed/6 passed, `[.03,.03,.03]` instead of `[.03,.06,.09]` | `b02b-transition-green.log`: 7 passed, cancel/goal/arrival-zero continuity and measured arrival |
| Mobile close slot | worker file `-t 'mobile keeps'` | `b02b-close-red.log`: 1 failed/5 filtered, held slot0 instead1 | broad full worker 8 passed |
| Arm close slot | `tests/unit/mujoco-arm-ports.test.ts -t 'shared MuJoCo slot'` | `b02b-arm-close-red.log`: 1 failed/15 filtered | focused/broad armports16 passed |
| Physical provenance | worker file `-t 'runtime option'` | `b02b-origin-red.log`: 1 failed/5 filtered, controller_sim | real full mission asserts physics_sim and SQLite journal model |
| Cached sensor presence/frame/time | worker file `-t 'mobile recorder'` | `b02b-cache-red.log`: 1 failed/7 filtered, absent scan resolved | `b02b-cache-green.log`: 2 passed; broad all8 |

Focused combined `pnpm exec vitest run tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/unit/mujoco-drive.test.ts tests/unit/mujoco-arm-ports.test.ts` passed 4 files/32 tests (`b02b-green-all.log`), before adding two worker negative tests and one readiness negative test. The final broad run below exercised those additions (worker8/readiness4/drive7/armports16). Additional self-review strengthened arrival-terminal-zero coverage; final drive rerun 7 passed.

Exactly one broad regression run:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 600; exec @ARGV' pnpm exec vitest run tests/unit tests/contracts tests/integration/mujoco-*.test.ts tests/integration/irsim-mission.test.ts tests/integration/irsim-recovery.test.ts tests/integration/irsim-evidence.test.ts tests/integration/irsim-readiness.test.ts tests/integration/engineering-runtime-options.test.ts tests/integration/engineering-profile-routing.test.ts tests/integration/webots-readiness.test.ts tests/integration/webots-arm-readiness.test.ts tests/integration/webots-arm-double.test.ts tests/integration/webots-faults.test.ts
```

`b02b-regression.log`: **102 files passed, 3 files failed; 771 passed, 3 failed, 1 skipped; 449.74s**. Included all real MuJoCo arm worker/program/BV01 repeat/readiness/gateway/fault tests, real mobile completion, IR-SIM mission/recovery/evidence/readiness, Webots fault/arm doubles/readiness, legacy mock golden/qualification contracts and all unit/contracts. Three failures addressed narrowly:

1. Old arm-only `/health` expected no MJ-FD01. Fixed offering predicate to require installed mobile capability. `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-arm-faults.test.ts -t 'flag on: MJ'`: **1 passed,10 filtered**, `b02b-legacy-health-green.log`.
2. Historical catalog preservation snapshot excluded only the earlier arm addition. Extended its exclusion to the explicitly new mobile set and expected added backend; unchanged legacy BEFORE comparison remains exact. Added mobile-unconfigured/MJ-FD01 set assertion. An intermediate new assertion incorrectly expected `bundle:true`; corrected to existing contract `bundle!==false` (only false is explicit). Final targeted catalog **6 passed**.
3. Unrelated signed arm exporter used fallback system python because `.venv/bin/python` is absent; imports failed `ModuleNotFoundError: jsonschema`. No code/lock/dependency changes. Reran with existing `.venv-mujoco/bin` on PATH. Combined targeted command below: **2 files/9 passed**, `b02b-target-regression-green.log`.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PWD/.venv-mujoco/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/capabilities-mujoco-arm.test.ts tests/unit/export-arm-controller.test.ts
```

The one broad skip is `engineering-runtime-options.test.ts`: “with a catalog and a working compiler the runtime compiles the reference project, serves the scene, and still refuses to start a native run.” Its skipIf probes default `.venv`/system Python for rfc8785/jsonschema/referencing/yaml; that default environment lacks dependencies. **not_run**, not a pass. New mobile runtime compiler integration uses explicit real venv and passed; native compiler execution is outside B02b. Original-checkout R2a qualification was concurrently running but untouched; no observed global process-presence failure occurred in our broad suite.

After TS worker suites finished, sequential Python:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q
```

**87 passed in9.10s**, exit0, no skips (`b02b-python.log`). No B02a worker/fixture/requirements/probe changes.

Final `pnpm typecheck`, `pnpm lint`, `pnpm contracts:check` all exit0; contracts output “Contract generation matches schema.” `node --import tsx packages/lab-runtime/src/cli.ts --help` exit0. `git diff --check` clean. Full runtime export/import/check:source and Lab typecheck are explicitly controller-owned after review and are **not_run** here. No second broad repeat after focused fixes.

## Files and self-review

New implementation: `packages/lab-runtime/src/engineering/mujoco-compiler.ts`, `packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts`.

Engineering/CLI: assembly, gateway portable-profile guard, navigation-compiler engine typing, runtime-options registry and cli option ordering. Runtime: capabilities, gateway capability flags, readiness routing, scenario registry/matrix, navigation2d plant/controller/adapter/evidence/runner/readiness; simulation3d mujoco provider, worker fatal codes and arm close slot. Contracts: engineering-project, navigation-scene, navigation-run-evidence schemas and generated engineering/navigation2d types. Export manifest metadata and worker README. Tests: new mobile-worker/mobile-readiness/drive files; arm-ports close test and catalog preservation update. Committed research note described above.

Self-review checked closure hashes/references, one-AMR refusal, no native fallback, optional old APIs/schema refs, new report/seed identity, exact cached-sensor timing, controller state transitions, observed arrival semantics, slot lifetime through close, unchanged Webots constants/fatal list, and canonical fixtures/physics lock untouched. No subagents or independent reviewer dispatched. Root will dispatch review.

## Remaining boundaries

Dynamics/policies remain not_calibrated; only one registered Serve mechanical/sensor projection, default center load, no noisy sensors/actors and fixed sliding sphere casters. No physical safety or controller-equivalence claim. B03 owns durable physics sidecars/coverage, support/custody windows and metrics; source journal remains delivery authority. B04 owns registered new-run experiments, payload UI/entity samples and launcher engineering flags. B08 must account for the explicit command-ramp policy identity. B09 image must add engineering catalog/compiler closure/dependencies or an explicit portable-only compiler mode; old arm-only image/launcher is not mobile-ready by implication. Clean export/pin and upstream refresh remain controller work. This result does not close G-MJ1, native/device/hardware gates or human acceptance.


## Final compiler integration follow-up — 2026-11-14

Controller correctly clarified that the initially skipped engineering-runtime-options case is portable compile/serve/refuse-native integration, not actual native host execution. The earlier classification above was imprecise. It is now verified with the existing IR-SIM venv; no dependency installation, lock change, source code change or broad repeat.

Exact command from the source worktree:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PWD/.venv-irsim/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/engineering-runtime-options.test.ts -t 'with a catalog and a working compiler'
```

Exit0. **1 file passed; 1 test passed, 2 intentionally filtered/not_run; 2.18s**. The named test “with a catalog and a working compiler the runtime compiles the reference project, serves the scene, and still refuses to start a native run” passed in738ms. The other two cases already passed in the broad run. This resolves the initially skipped case and the default-compiler wiring uncertainty. Source commit remains `3e0c60e4b57fd78b0c007a5361c6b85448c42e69`.


## B02b review fix round 1/5 — 2026-11-14

Base `3e0c60e4b57fd78b0c007a5361c6b85448c42e69`; review `task-B02b-review-1.md`. Both Important findings were verified and addressed one at a time using receiving-code-review, systematic-debugging and TDD. No subagents, upstream merge, export, pin or physical execution. The minor stale README wording remains assigned to B00R by controller.

### Finding 1 — invalid mobile observation could confirm cancellation

Root cause confirmed: tick() appended the new snapshot, observed it through the adapter and drained source events before invoking the mobile monitor. A stopped body velocity plus missing/invalid physics therefore made a cancelling command terminal cancelled; later lost() could not change a terminal goal.

Moved the optional mobile monitor before derived live distance, adapter observation, source draining and valid telemetry. The acknowledged fault tick still advances logical time and is retained in the existing trajectory evidence; the run then becomes lost before any business confirmation derives from it. Legacy providers without this monitor retain their original observation/tilt path. No change to stop thresholds, measurement semantics or policy identity.

New real-runner tests inject missing physics and a wrong physics tick into the first stopped response after a pending cancel. They assert no cancelled source observation, goal unknown, CANCELLATION_RECONCILIATION_REQUIRED for the unknown event, no valid telemetry at that tick, and retained fault-tick evidence horizon.

RED command (Node24 PATH and both Python flags):

```sh
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-lifecycle.test.ts
```

`b02b-fix1-observation-red.log`: **2 failed**, both `expected ['accepted','cancelled'] to not include 'cancelled'`. Initial harness used tick100 before a mission existed; corrected it to wait for the real goal before this RED result. Same focused command after fix: **2 passed**, 4.98s (`b02b-fix1-observation-green.log`).

### Finding 2 — uncertain create/start could respawn the same run

Root cause confirmed: startPlant failed before c.started became true, then execute only recorded ACTION_INTERRUPTED; a new start could create another worker/world under the same run ID. The startup ACK tests apply the actual operation on a real MuJoCo worker, then drop its response by throwing WorkerLostError(outcome unknown). This includes create's real tick-0 priming.

New optional provider contract: `PlantPort.startupPolicy?: {preMutationCreateRefusals: readonly string[]}`. Only `mujocoMobilePlant` opts in. New optional checkpoint `plant.startupAttempt:true` is persisted **before** create is sent. It is replaced by the normal live checkpoint only after create, initial observation validation, start and initial evidence append succeed. An uncertain attempt marks STARTUP_UNKNOWN/lost, suspends the run, reports needs_attention even though the business run never started, and refuses another start with INVALID_STATE:STARTUP_UNKNOWN. Reopen recovers a pending startup latch conservatively and never spawns. The marker has no effect or serialized presence for legacy providers.

The create response classification is phase-aware. Previously ask() labeled all !ok responses not_sent; mobile create now treats an unrecognized explicit refusal as unknown. The closed known pre-mutation allowlist is SCENE_PATH_REJECTED, SCENE_SCHEMA_INVALID, SCENE_UNSUPPORTED, SCENE_DIGEST_MISMATCH, SCENE_FILE_MISMATCH, PROFILE_ID_MISMATCH, DIGEST_MISMATCH, MODEL_DIGEST_MISMATCH, WORLD_CAPACITY_EXCEEDED, PHYSICS_PROFILE_INVALID. These checks occur before MobileEngine construction/priming in the reviewed producer. A transport request known not to have been sent or an allowlisted create refusal clears the latch before any successful create. After a successful create, any startup failure remains terminal regardless of delivery label. PLANT_UNSTABLE and CONTACT_CAPACITY_EXCEEDED are not admission exceptions. Slot release remains after worker close.

Additional tests cover lost create/start ACK → subsequent start and reopen with no second spawn; reopening the actual pre-create in-flight checkpoint captured before sending; explicit post-priming PLANT_UNSTABLE/CONTACT_CAPACITY_EXCEEDED responses; a real worker schema refusal before model construction that permits a later attempt after reopen; and blocked startup close retaining shared arm/mobile capacity.

RED:

```sh
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-lifecycle.test.ts -t 'ACK|process restart'
```

`b02b-fix1-startup-red.log`: **3 failed, 2 intentionally filtered**. Lost ACK tests observed ready instead of needs_attention; crash/reopen test spawned again and returned PLANT_START_FAILED instead of rejecting STARTUP_UNKNOWN. After implementation full then-current lifecycle file **5 passed**, 7.65s (`b02b-fix1-startup-green.log`). After the admission/fatal/capacity boundary cases, full lifecycle file **9 passed**, 11.27s (`b02b-fix1-lifecycle-green.log`).

### Round-1 verification and self-review

Only affected regression suites, no repeat of the earlier broad771 run:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-lifecycle.test.ts tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/unit/mujoco-drive.test.ts tests/integration/irsim-recovery.test.ts tests/integration/webots-faults.test.ts tests/integration/mujoco-arm-worker.test.ts tests/unit/mujoco-arm-ports.test.ts
```

Final result/commit appended below. Typecheck and full lint pass. No Python producer/fixtures/locks/schemas changed, so Python suite was not repeated for this TypeScript-only fix. Self-review traced the producer's admission codes, checked the durable-before-send ordering and successful-create phase distinction, verified that pending latches survive close/reopen, confirmed no source cancellation derives from rejected mobile physics, and checked optional fields preserve old-provider branches and bytes. Files: navigation2d/{plant,runner}.ts, simulation3d/mujoco-mobile.ts and new integration/mujoco-mobile-lifecycle.test.ts.


Round-1 affected regression result (`b02b-fix1-regression.log`): **7 files passed / 1 failed; 59 passed / 2 failed; no skips; 104.20s**. All mobile9 lifecycle +8 worker +4 readiness +7 drive, IR-SIM recovery7, MuJoCo arm worker3 + ports16 passed. Webots fault tests5 passed; two failed only the global process-empty assertion after all functional assertions: “WB05 cancel mid-route” and “WB05 killing Webots”. Both saw PIDs31619/31632/31633. Those PIDs had exited before inspection; no Webots processes remained. The original-checkout qualification was still running and was not touched; ownership of the transient PIDs was not captured, so interference is plausible rather than proven. No test assertions or implementation were changed to handle these two failures.

Reran only those two after confirming no Webots process:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/webots-faults.test.ts -t 'WB05 cancel mid-route|WB05 killing Webots'
```

**1 file / 2 passed, 5 intentionally filtered (not_run), exit0, 9.71s**, `b02b-fix1-webots-rerun.log`. No unresolved failing case remains. Real MJ-FD01 again completed tick3443 with the exact scene/controller/trajectory/sensor/assertion identities recorded above; no physics/policy byte change. Final typecheck/full lint/diff-check pass. All round-1 logs copied into `evidence-B02b/`. Source commit recorded below after commit; controller review and export/pin remain pending by design.


### Important test-isolation concern discovered by controller after this run

Controller inspected the existing `webots-faults.test.ts` “WB05 killing the WORKER” case: it performs global `pgrep -f ' -m webots_worker --run-id'` and SIGKILLs every result. That case **did run after the two global-empty failures**, and `b02b-fix1-regression.log` records it passed in3075ms. It prints neither the matching worker IDs nor kill targets. The prior empty-process failures list Webots/controller PIDs31619/31632/31633, but their ownership was not captured. Therefore the statement above that original qualification was “not touched” is limited to direct task actions: the regression suite may have killed unrelated original-checkout workers. We cannot establish exact kill targets from retained logs. All logs are preserved; no native cases were rerun after this discovery. The subsequent two scoped cases already completed before the controller's notice; their filter excluded the global-worker-kill case.

Controller owns read-only original-qualification inspection and a separate test-isolation correction in B00R. This concrete external-process risk is an outstanding concern in the handoff; it is not hidden behind the successful scoped reruns. No original repository files were modified and no additional process was killed by this agent's direct commands. The mobile lifecycle implementation findings are fixed, but the existing global-kill test must not run concurrently with other Webots workers.

Round-1 commit: `5235791218c6330c358676fe36ae0ed978be3654` (`fix: make MuJoCo mobile lifecycle failures terminal`), 4 files/113 insertions/6 deletions. Post-commit `git status --short` is empty. Both Important implementation findings addressed; status DONE_WITH_CONCERNS due the concrete existing global-worker-kill test isolation concern described above. No export/pin/upstream merge performed.


## Lab compatibility and source pin — 2026-11-14

Controller-owned clean source export/import exposed the new MuJoCo engine union branch in Lab: `src/reports/navigation2d.ts:engineVersionOf` assumed every non-Webots engine had `.version`, so Lab typecheck failed. Controller delegated this minimal cross-repository compatibility/pin follow-up after source review approval.

Repository: `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab`. Lab BASE `cef5b6c29382e542678370b9a0da69d5f8c95351`; Lab HEAD **`57705211a231c41e5636566a416737f6bc14faef`**, `chore: pin source runtime 5235791`. Source remains **`5235791218c6330c358676fe36ae0ed978be3654`**. Lab post-commit status is clean. No original checkouts, source implementation, native execution, browser/native process management, push or deployment touched in this follow-up.

`engineVersionOf` now switches explicitly: IR-SIM returns `.version`; Webots and MuJoCo return `.engineVersion`. Comments distinguish synced contract understanding from render admission. `NAVIGATION_PROVIDERS` remains exactly `['irsim_2d','webots_3d']`; MuJoCo navigation evidence stays unsupported with no provider label/rows or IR-SIM/Webots mislabel. Full mobile report/UI admission remains B04.

The commit includes only the five pre-existing legitimate controller import/sync/pin changes plus the helper and focused regression:

- `config/source-runtime.lock.json`
- `src/shared/engineering-schemas/engineering-project.schema.json`
- `src/shared/engineering-schemas/navigation-run-evidence-v1.schema.json`
- `src/shared/engineering.ts`
- `src/shared/navigation2d.ts`
- `src/reports/navigation2d.ts`
- `tests/unit/navigation2d-report.test.ts`

Export directory inspected: `/tmp/mekoniq-r2b-b02b-export-5235791-20261114` (outside both repositories). Manifest source commit5235791, dirty:false, schema hash `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6`. Runtime artifact SHA-256 **`87f97b19766407d67564ce018b9ea70382995f6203966f200591ad3474453279`** matches the actual runtime.mjs bytes. Portable closure digest **`336b6aa753cfc4e9a24712132729717f0e038fd821c366ff47ff393bab17608c`** matches the imported lock. Controller performed export/import/sync; this follow-up inspected their intended diffs and ran check:source successfully.

All commands below run from the Lab worktree with `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`:

```sh
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/navigation2d-report.test.ts -t 'engine version follows|synced MuJoCo engine typing'
```

RED (`b02b-lab-compat-red.log`): **1 failed, 1 passed, 11 intentionally filtered**. Exact failure: expected undefined to be '3.17.0'. The admission-boundary regression already passed and remains enforced. First post-fix typecheck caught test-helper inferred literals, corrected to use the existing typed `report().navigation2d` fixture; production helper type error was resolved.

Final checks:

```sh
perl -e 'alarm 60; exec @ARGV' pnpm typecheck
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/navigation2d-report.test.ts tests/unit/launcher-output.test.ts tests/unit/mujoco-coffee.test.ts
perl -e 'alarm 60; exec @ARGV' pnpm check:source
```

All exit0. **3 files/24 tests passed, no skips, 549ms** (`b02b-lab-compat-green.log`). Typecheck passed (`b02b-lab-compat-typecheck.log`). check:source output: “Verified source 5235791218c6330c358676fe36ae0ed978be3654; schema 73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6; protocol 1/2; Node 24” (`b02b-lab-compat-source.log`). Diff/staged diff checks clean. Logs copied to source ignored `evidence-B02b/`. Self-review verified only intended pin/generated/helper/test changes were staged. Controller scoped Lab review remains before B00R.
