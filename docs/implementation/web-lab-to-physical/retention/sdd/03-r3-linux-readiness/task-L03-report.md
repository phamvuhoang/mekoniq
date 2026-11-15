# L03 implementation report — prepared xArm native simulation

Status: **DONE_WITH_CONCERNS**. Portable implementation, protocol/validator checks, prepared X1/X2 launch/readback/lifecycle, additive L00 mapping attachment, clean Source export and Lab pin are complete. **No native Linux host was assigned; X1/X2/X3 native execution remains not_run.** No motion/contact qualification or human acceptance is claimed.

## Scope, bases and final identity

All work used isolated `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source` and sibling `lab`, branch `codex/web-lab-to-physical`. Exact original task bases:

- Source `00d41e7f25ec1294b9bc8e8c81de3d8e1a869316`.
- Lab `82b5f92005673c99ba0d1f434ae4c512800fa75e`.

Final commits:

- Source **`2a7ec9c89935649835fc08eee4ebe81fc6190cf0`** — `feat: prepare fixed xarm native simulation motion`; tree `03e850529dadd8c8b3306c3d3b8837f501648063`.
- Lab **`020b818b6ce0b813c22b8826945a917fe4017816`** — `chore: pin source runtime 2a7ec9c`; tree `51478596a7d6616e1525aafde1c72c931cde87d8`.
- Clean export `/tmp/l03-runtime-2a7ec9c-20261115`, `dirty:false`.
- Runtime artifact `8fbb40b2bdbef61f744f210d6eb4133b41d3346d45194b20b045c3f77292fec5`.
- Schema `9e869f41bd7dbbbae1f26f81b75449b727e7160fdfb1a3b32cf3b23a5cb034e4`.
- Native tool digest `53c4a5ccc2fa3e93305f90e3b26abfa923ca89c9a6097c644f535bac4b976a9d`, 202 refs.
- Portable tool digest `1fb6f053d4903a109a41f862556a02c2fd71c60d5011d94d27463165ad697d82`, 237 refs. This changed because the optional handoff schema belongs to that closure; portable worker code/engine locks did not change.
- Lab pin file SHA-256 `7f6f9e0b2820f2e1742be62e6722cf9777d539a0fedbbe2b5c5ed3d1fa983ea8`.

`evidence-L03/identities.json` verifies both clean heads/trees, export and cached artifact hashes, semantic export/cache manifest equality, all native/portable closure refs against current Source bytes, final test-file attribution and all six refused-case artifact hashes. The export manifest and importer-formatted cached manifest have different byte hashes (`7f94bf66…` and `3161dc0a…` respectively) but identical parsed content. The audit is local byte/receipt consistency, **not an effective Git graph attestation**. Subject and observed-source identity are the committed Source above; no independent native qualification checker was run. Each case explicitly records `checkerScope:source_snapshot_not_git_graph_attestation`.

## Implementation and APIs

`packages/lab-runtime/src/v2/sil/xarm-provider.ts` provides `createXarmSimProvider(serverConfig)`, `xarmProgramHash`, `mapXarmJoints`, and unavailable-by-default motion capability metadata. It returns an existing typed `CellAdapter`, typed `ArmStatusLike` observations with distinct evidence kind, explicit contact refusal and close lifecycle. It accepts only server-owned source/run paths, run/device/cell IDs, X1/X2, exact engineering architecture profile and optional absolute Python interpreter. Extra keys (including robot IP), arbitrary launch/action/trajectory inputs and alternate source roots are refused. Injected transports are permanently `protocol_double`.

`xarm-cli.ts` and builtins-only `scripts/lab-xarm.mjs` provide an actual configured server path to the factory, not merely an unreachable adapter. The public options are `--mode X1|X2 --environment-profile engineering-amd64|engineering-arm64 --case nominal|cancel|restart --out <new-directory>`. Path normalization occurs before the child changes cwd. The runner records command/outcome, separate motion/contact status and artifact hashes. `restart` means an observed cancel followed by refusal to reopen the same durable run; it does not respawn or continue an old controller run. No browser set/provider was enabled. The old AMR factory remains canonical FD01-only; engineering-contact still requires its independent unimplemented process provider and unqualified arm/contact backend.

`native_xarm/policy.py` fixes launch arguments, program/finite trajectory limits, SI joint ordering/signs, source checks and the ten-distinct-trial contact evidence contract. The only approved motion program reaches [0,0,-1,0,0,0] rad over 10 s and moves joint1 0.01 rad over another second. Segment speed is at most 0.25 rad/s; position and finite duration/point bounds apply. MoveIt is loaded by the immutable upstream launch, but the probe uses direct FollowJointTrajectory, **not collision-planned production motion**.

`native_xarm/session.py` durably records intent before ROS I/O, retains first receipts, rejects command-ID conflicts and same-file restart, and permits one active trajectory. Lost ACK/result, cancel timeout, stale/missing actual feedback, reset clock/sequence/boot/epoch and changed controller identity latch unknown. Completion requires an actual successful action outcome plus fresh final-target actual joints observed after dispatch. Cancel ACK alone is not terminal-stop evidence. Source has its own fsynced/renamed journal, serialized writes, synchronous intent guard and late-reply fatal checks. No resend or respawn continuation exists.

`native_xarm/ros.py` uses the fixed Jazzy FollowJointTrajectory action. It separately consumes JointState actual joints and JointTrajectoryControllerState reference/feedback; it checks agreement, receipt/provider ages, endpoint GID identity, clock and exact-time TF to TCP. X1 uses the ROS system clock; X2 uses Gazebo `/clock`. The observer polls at 20 ms while retaining only changed 25 Hz state samples. Original receipt ages survive delayed processing. It captures actual controller joints/interfaces, robot_description, SRDF and planner parameters before motion. An ArmStatusLike does not assert homing: `homed:false` is explicit.

`native_xarm/worker.py` performs actual L02 engineering environment inspection and source/installed-description checks before importing ROS or starting children. It uses a private Gazebo partition and exclusive ROS domain lease, rejects a nonempty graph, retains an attempt marker before execution and refuses reuse. It launches only the fixed vendor simulation profiles plus rosbag2; shutdown touches only owned processes. The Node parent owns the worker process group. After owned processes stop, the L02 read-only SQLite backup helper copies to `verified-bag/`, verifies message content and SQLite integrity, and inspects coverage from the copy. Raw runtime SQLite is never an evidence reference. No SQLite was produced in actual native refusals here; portable test databases remain test temporaries. Missing retention/shutdown evidence fails a native probe close. Independent native bag replay/continuous-coverage qualification is not claimed.

`docs/operations/xarm-native-sim.md` documents installation assumptions, commands, motion/contact distinction, artifact binding, timing limits and remaining qualification steps.

## Source pins and explicit model mapping

Main source pin is Jazzy `d837f2e17f7f36043103b367fca3af8172626245`; SDK submodule pin is `f36794320a285c0b4bf1cd8ef181cbff6e3b794a`. `native-vendor.lock.json` records Git blob identities separately from content SHA-256 and retains inspected source files, BSD license and NOTICE. The decoder source additionally fetched at the exact candidate commit has SHA-256 `bcdb75c2d56195d93e4637b790f9804782eacf5cb5d37a77ce31bf8bba9bc55d`, Git blob `d07fcf47b163718db84ffaca54f8e85ab363ff3d`; its blob was checked against the exact official candidate Git tree. A scoped vendor `.gitattributes` retains upstream whitespace bytes exactly.

The old R2a asset lock is byte-identical to the task base (SHA-256 `4bd3e0f6891a6bdeba578daafd9b6073ac6205201fbd5791684234adacb8e4d4`). The canonical component remains `0e2f40ef5a4569ea3e76879ed078fffd55d514b42c25c60072ebd7d27af3445a`. `preserve-audit` reverified all 21 existing imported description/mesh/license documents against their SHA-256 and candidate Git blob identities. Both unresolved architecture locks remain byte-identical. Source descriptions matching does not qualify expanded native URDF, actual installed packages/plugins, controller behavior or contact.

Controller ruling **R87** resolved the upstream 1305 selection trap. `model1300:=false` alone yields model number -1 in the pinned decoder. The immutable `syntheticSimModelSelector` **XI13050520BB00** is passed through upstream `robot_sn` solely as a simulation model selector. It decodes modelType6/modelNum1305/dateCode2005/HD B/massType11/HT_BR2. It is not a hardware serial or commissioning identity and is not browser-configurable. Older/wrong variants are tested; raw readback must independently match nominal inertia, limits and geometry. No vendor code was patched.

The fixed install layout is source `/opt/mekoniq/xarm_ros2`, isolated colcon install root `/opt/mekoniq/xarm_ws/install`, description share `/opt/mekoniq/xarm_ws/install/xarm_description/share/xarm_description`. Build/install the pinned source into that prefix under the L02 environment qualification procedure; no package installation/provisioning occurred here. X1 expected mesh URIs are `package://xarm_description/meshes/...`; pinned X2 emits `file:///opt/mekoniq/xarm_ws/install/xarm_description/share/xarm_description/meshes/...`. The worker verifies `ros2 pkg prefix xarm_description` and actual installed description bytes against the candidate source hashes. Static readers reject other URI roots; there is no arbitrary URI normalization. Different layouts require reviewed profile changes.

`profiles/xarm6-native-mapping.json` explicitly maps J1…J6→joint1…joint6 with positive radian signs, zero offsets; base→link_base; tcp→link_tcp through the G2 0.172 m tool chain. It retains all arm/gripper joint origins/axes/limits, 1305/G2 visual mesh references and nominal masses/COM/inertia tensors. Native standalone placement is explicitly distinct from the requested Source cell placement. Dynamics remain uncalibrated; exact nominal inertia identity is not calibration. No expanded collision-geometry/contact parity is asserted.

## R86 handoff attachment and independent reader

`native_xarm.mapping.produce_mapping()` validates **captured** robot_description and writes new `expanded.urdf` + `mapping.json`. It never generates an alleged native expansion from R2a. The second record binds source commit, subject profile/architecture, target profile, canonical model hash, vendor pin, synthetic selector, evidence kind, raw URDF hash and native controller readback where applicable.

R86 adds optional `refs.nativeMapping` with exactly two references; existing model singularity and immutable engine/tool meanings remain unchanged. Generic safe-path/symlink/size/hash/source/secret checks still apply. The xArm reader bounds raw XML at 4 MB and mapping JSON at 1 MB, forbids DTD/entities, detects malformed markup/duplicates and independently compares the raw expanded joint/tool/visual/inertia/plugin semantics with the pinned projection. It checks record provenance, actual-versus-double kind and native controller joint/interface/SRDF presence. Unknown metadata fields, cross-profile, wrong-mode/plugin, changed selector/model/vendor and resealed substitutions fail closed. Both immutable closure matching sites and static `bySource` dependency lookup exclude generated mapping refs; tests demonstrate they cannot fill missing portable/native tool members.

Missing artifacts remain `NATIVE_MODEL_MAPPING_UNRESOLVED`. Valid protocol-double artifacts retain `NATIVE_MAPPING_PROTOCOL_DOUBLE`; host/package readiness is independently blocked by unresolved engineering locks. Static native mapping consistency never authenticates a host or proves native motion/contact. The synthetic test URDF is labeled `protocol_double_xarm` and is never presented as a native expansion. The L00 source input binding and R85 requested-versus-target distinction are preserved.

## Actual execution and not_run scopes

Executed here: portable protocol/validator/observer/worker-lifecycle doubles, raw mapping checks, SI/sign/order/FK checks, independent RTB FK comparison, native environment refusal, Source build/type/schema/lint checks, clean runtime export, Lab import/sync/check/type, and local identity consistency audit.

Not executed: Linux ROS FakeSystem action server, native Gazebo/Harmonic/MoveIt motion, native xacro expansion/parameter readback, installed plugin behavior/timing, real controller restart/lost-result fault injection, native bag replay or any hardware. Neither Docker nor a Mac Linux container was used. No cloud, host provisioning, hardware connection, main merge, push, deployment, human acceptance, trial/web or operational-port work occurred. No helpers/subagents/reviewers were used; root owns independent review.

After both final commits, six real public CLI preflights were retained under `evidence-L03/native-not-run/`:

| Mode/profile/case | Own exit | Motion | Contact |
| --- | ---: | --- | --- |
| X1 / engineering-amd64 / nominal | 2 | not_run / blocked_external | not_run, 0/10 trials |
| X1 / engineering-arm64 / nominal | 2 | not_run / blocked_external | not_run, 0/10 trials |
| X2 / engineering-amd64 / nominal | 2 | not_run / blocked_external | not_run, 0/10 trials |
| X2 / engineering-arm64 / nominal | 2 | not_run / blocked_external | not_run, 0/10 trials |
| X2 / engineering-arm64 / cancel | 2 | not_run / blocked_external | not_run, 0/10 trials |
| X2 / engineering-arm64 / restart | 2 | not_run / blocked_external | not_run, 0/10 trials |

Each manifest binds committed clean Source `2a7ec9c`, with `accepted:false`, `dynamics:not_calibrated`, and actual missing OS/package/plugin/runtime/apt/vendor-overlay reasons. `evidenceKind` names the **requested producer mode**; the explicit not_run status means no such native evidence was produced. The identity audit confirms no launch.log/raw-bag was created. Other native fault/profile combinations were not attempted and remain not_run, not inferred passes.

X3 is separately blocked by **G2_MIMIC_CONTACT_NOT_OBSERVED**, not a demonstrated unsupported result. Five upstream mimic declarations and the README concern are risk provenance, not executed plugin evidence. The structural ten-trial assessor requires distinct IDs, grip/release, independent support/receiver observations and raw/mapping/collision-exclusion hashes, but deliberately retains the native G2 blocker. No trial ran. DEP-XARM-01/02/SEC-01 native motion and DEP-XARM-03 contact remain open. A different tool needs its own profile; this work does not substitute a non-G2 model.

## Validation chronology and failures retained

All logs/receipts are under `.superpowers/sdd/03-r3-linux-readiness/evidence-L03/`. `run-check.mjs` uses spawnSync and preserves each command's own exit, argv, cwd, timeout, environment, before/after HEAD/tree/status/diff hash and changed/untracked file hashes. It writes fresh names with exclusive creation. Node was 24.22.2/pnpm10.32.1. Portable Python was `.venv-irsim/bin/python` 3.11.15, with `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_ADDOPTS=-p no:cacheprovider`; existing L02 isolated Python dependencies were reused. Native preflight used the actual Mac `python3` solely for introspection, not ROS execution.

- `red-python`/`red-ts`: creation-stage absent-module errors (exits 2/1), not behavioral assertion failures.
- `red-mapping-python`: 15 passed, missing mapping module failed. `red-mapping-ts`: absent reader plus original invalid attachment attempt failed; this exposed singular model refs and led to R86 rather than weakening tool identity.
- `red-ros-python`: missing ROS client/worker modules; 16 passed, 2 failed.
- `green-python-1`: **18 passed**; `green-ts-1`: **7 passed**. These are intermediate bytes/scopes only.
- `red-concurrency-ts`: its one-transport-send assertion passed; the accepted-answer count was zero rather than one. Two concurrent pre-dispatch persist calls could share `.tmp` before inFlight was set, and a rename error latched uncertainty. This was a concurrent intent/durable-write refusal, **not demonstrated duplicate sends**. Synchronous intent admission and later serialized persistence fixed the race. `green-ts-2`: **11 passed** on that intermediate scope.
- `red-cli-ts`: missing public runner module. `red-observer-python`: changed publisher endpoint did not latch restart and completion accepted pre-dispatch actual feedback; both behavioral negatives were fixed.
- `red-geometry-ts`: raw mapping lacked required geometry readback checks. `typecheck-1` failed on inferred optional undefined in a JsonObject return; an explicit CellExecutionState return type fixed it. `green-python-2`: **23 passed**. Focused lint passed.
- `combined-ts`: **136 passed, 1 failed**; RTB's 20-pose FK test executed and passed (not skipped). The single failure was an unchanged routing assertion expecting MoveIt to say “not implemented” after the implementation became “not qualified”; the assertion now distinguishes that backend from the still-unimplemented process provider. `combined-python`: **89 passed**. `typecheck-2` passed.
- `red-retention-python` and `red-copy-python`: missing shutdown/verified-copy behavior. The prepared worker now records retention blockers and verifies a copied SQLite snapshot without modifying the original.
- `red-selector-python`: missing selector decoder + absent nominal inertia enforcement. R87 and the pinned decoder/expanded-readback checks resolved these.
- `final-ts`: **136 passed in 7 files**; `final-python`: **92 passed**. These combined receipts precede the final URI/late-reply refinements; they are not presented as full-suite checks of later bytes. `final-typecheck`, `contracts-check`, `final-lint` passed.
- `red-mesh-uri-python`: Gazebo package URI was wrongly accepted. After exact mode-specific installed-share binding, `final-mapping-ts` **20 passed** and `final-worker-python` **27 passed**, with `final-typecheck-2` and `final-lint-2` passing.
- `red-late-source-ts`: an in-flight query could return completed after Source close; the fatal latch is now rechecked after awaited I/O/persistence. `red-receipt-python`: a delayed callback refreshed receipt age; it now retains the original controller/joint receipt timestamp. Final `selfreview-ts`: **13 passed**; `selfreview-python`: **28 passed**; `selfreview-typecheck` and `selfreview-lint` passed.
- `preserve-audit` passed. `diff-check` found one extra blank line at EOF; it was removed, and `diff-check-2` passed. This newline-only edit is the only tested-source byte difference after final self-review checks, explicitly recognized by the identity audit. The scoped vendor whitespace attributes were added after behavioral checks; no upstream snapshot bytes changed.
- Export, Lab import, sync, check:source and typecheck each exited 0; Lab pin committed afterward.
- First `identity-audit` incorrectly required byte-equal export/cache manifests despite importer formatting, exited 1. It did not expose an artifact mismatch. Preserved original script/log; `identity-audit-2` uses semantic manifest equality, independently verifies both byte hashes and all artifact/closure content, and passed.

The known full-repository lint failure (27 errors in five unchanged historical evidence scripts) was not rerun or changed; B10 owns it. This is an actual changed-files lint pass, not a full CI claim. No broad unaffected suite was repeated solely to update a timestamp. Exploratory reads included a nonexistent common.urdf.xacro URL (404), nonexistent helper paths and one glob miss; these were not qualification attempts. All actual check failures and original logs remain retained.

## Self-review and remaining limits

Self-review checked immutable simulation-only configuration, upstream variant selection, source/installed-file provenance, raw mapping semantics, closure-role separation, receipt ordering, one-flight/no-resend behavior, late-result latching, actual/reference distinction, original receipt freshness, restart identity, contact separation, owned shutdown and verified-copy retention. Meaningful late-reply and delayed-receipt negatives were added before those fixes. Final Source and Lab are clean, and no historical evidence or runtime lock was fabricated to clear a gate.

The remaining material limits require an assigned native Linux host: actual launch/parameter names and service availability, expanded model/plugin compatibility, endpoint/TF timing, native motion/stop/fault matrix, bag capture/replay, and ten G2 contact trials. Direct finite trajectories have no collision planner guarantee. The current public runner is a probe/preparation tool with explicit identity limits; formal qualification still needs L01's audited checker and the native gates. No substitute for human commissioning, native execution, dynamics calibration or device evidence is claimed.

## Exact command receipts

The table below is generated from retained own-exit receipts. Every row has a same-stem `.log` and `.receipt.json` containing full output, cwd, environment and Source/Lab identity. Commands were run in Source except `lab-*`, which ran in Lab; absolute paths are preserved in receipts.

| Receipt stem | Own exit | Exact process command |
| --- | ---: | --- |
| `red-python` | 2 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `red-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts` |
| `red-mapping-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `red-mapping-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t mapping` |
| `red-ros-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `contracts-generate` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm contracts:generate` |
| `green-python-1` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `green-ts-1` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts` |
| `red-concurrency-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t concurrent` |
| `red-cli-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t 'server CLI'` |
| `green-ts-2` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts` |
| `red-observer-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `red-geometry-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t 'mesh readback'` |
| `typecheck-1` | 2 | `perl -e 'alarm 290; exec @ARGV' pnpm typecheck` |
| `focused-lint-1` | 0 | `perl -e 'alarm 110; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-provider.ts packages/lab-runtime/src/v2/sil/xarm-mapping.ts packages/lab-runtime/src/v2/sil/xarm-cli.ts packages/lab-runtime/src/v2/sil/native-handoff.ts packages/lab-runtime/src/v2/sil/native-handoff-documents.ts packages/lab-runtime/src/v2/capabilities.ts tests/integration/xarm-native-contract.test.ts scripts/lab-xarm.mjs scripts/native-sim/tool-identity.mjs` |
| `green-python-2` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `combined-python` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py robotics/simulation/tests/test_engineering_native_parity.py robotics/simulation/tests/test_engineering_profile.py robotics/simulation/tests/test_native_profile.py robotics/simulation/tests/test_nav2_session.py -q` |
| `combined-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/xarm6-rtb.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/engineering-profile-routing.test.ts tests/integration/lab-v2-native-profile.test.ts` |
| `typecheck-2` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm typecheck` |
| `red-retention-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k prepared_worker -q` |
| `red-copy-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k retained_bag -q` |
| `red-selector-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k 'selector or inertia' -q` |
| `pin-decoder` | 0 | `perl -e 'alarm 55; exec @ARGV' .venv-irsim/bin/python .superpowers/sdd/03-r3-linux-readiness/evidence-L03/pin-decoder.py` |
| `contracts-check` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm contracts:check` |
| `final-lint` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-provider.ts packages/lab-runtime/src/v2/sil/xarm-mapping.ts packages/lab-runtime/src/v2/sil/xarm-cli.ts packages/lab-runtime/src/v2/sil/native-handoff.ts packages/lab-runtime/src/v2/sil/native-handoff-documents.ts packages/lab-runtime/src/v2/capabilities.ts tests/integration/xarm-native-contract.test.ts tests/integration/engineering-profile-routing.test.ts scripts/lab-xarm.mjs scripts/native-sim/tool-identity.mjs` |
| `final-python` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py robotics/simulation/tests/test_engineering_native_parity.py robotics/simulation/tests/test_engineering_profile.py robotics/simulation/tests/test_native_profile.py robotics/simulation/tests/test_nav2_session.py -q` |
| `final-ts` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/engineering-profile-routing.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/lab-v2-native-profile.test.ts` |
| `final-typecheck` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm typecheck` |
| `red-mesh-uri-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k fixed_installed_share -q` |
| `final-lint-2` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-provider.ts packages/lab-runtime/src/v2/sil/xarm-mapping.ts packages/lab-runtime/src/v2/sil/xarm-cli.ts packages/lab-runtime/src/v2/sil/native-handoff.ts packages/lab-runtime/src/v2/sil/native-handoff-documents.ts packages/lab-runtime/src/v2/capabilities.ts tests/integration/xarm-native-contract.test.ts tests/integration/engineering-profile-routing.test.ts scripts/lab-xarm.mjs scripts/native-sim/tool-identity.mjs` |
| `final-mapping-ts` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/engineering-profile-routing.test.ts` |
| `final-typecheck-2` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm typecheck` |
| `final-worker-python` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `red-late-source-ts` | 1 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t 'late result'` |
| `red-receipt-python` | 1 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k delayed_callback -q` |
| `selfreview-lint` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-provider.ts packages/lab-runtime/src/v2/sil/xarm-mapping.ts packages/lab-runtime/src/v2/sil/xarm-cli.ts tests/integration/xarm-native-contract.test.ts` |
| `selfreview-python` | 0 | `perl -e 'alarm 290; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| `selfreview-ts` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts` |
| `selfreview-typecheck` | 0 | `perl -e 'alarm 290; exec @ARGV' pnpm typecheck` |
| `preserve-audit` | 0 | `perl -e 'alarm 55; exec @ARGV' .venv-irsim/bin/python .superpowers/sdd/03-r3-linux-readiness/evidence-L03/audit-preservation.py` |
| `diff-check` | 2 | `git diff --cached --check` |
| `diff-check-2` | 0 | `git diff --cached --check` |
| `export` | 0 | `perl -e 'alarm 290; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l03-runtime-2a7ec9c-20261115` |
| `lab-import` | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/import-runtime.mjs /tmp/l03-runtime-2a7ec9c-20261115` |
| `lab-sync` | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/sync-engineering-contracts.mjs` |
| `lab-check-source` | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| `lab-typecheck` | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| `native-X2-engineering-amd64-nominal` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-amd64 --case nominal --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X2-engineering-amd64-nominal` |
| `native-X1-engineering-amd64-nominal` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X1 --environment-profile engineering-amd64 --case nominal --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X1-engineering-amd64-nominal` |
| `native-X1-engineering-arm64-nominal` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X1 --environment-profile engineering-arm64 --case nominal --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X1-engineering-arm64-nominal` |
| `native-X2-engineering-arm64-cancel` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-arm64 --case cancel --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X2-engineering-arm64-cancel` |
| `native-X2-engineering-arm64-nominal` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-arm64 --case nominal --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X2-engineering-arm64-nominal` |
| `native-X2-engineering-arm64-restart` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-arm64 --case restart --out .superpowers/sdd/03-r3-linux-readiness/evidence-L03/native-not-run/X2-engineering-arm64-restart` |
| `identity-audit` | 1 | `perl -e 'alarm 55; exec @ARGV' .venv-irsim/bin/python .superpowers/sdd/03-r3-linux-readiness/evidence-L03/identity-audit.py` |
| `identity-audit-2` | 0 | `perl -e 'alarm 55; exec @ARGV' .venv-irsim/bin/python .superpowers/sdd/03-r3-linux-readiness/evidence-L03/identity-audit-2.py` |

`identity-audit-2.log` and `identities.json` are the final clean-export/pin/receipt attribution records. Native manifests and their artifact hashes are also listed in `identities.json`.


---

# L03 fix round 1/5 — prepared-code corrections (2026-11-15)

Status: **DONE_WITH_CONCERNS for the authorized portable fix work; independent prepared-code re-review pending. L03 native qualification remains incomplete/not_run.** This append addresses code findings L03-R1-01 through L03-R1-04. **L03-R1-05 is NOT ADDRESSED**, per R88: no assigned native Linux host, no X1/X2 native execution or X3 contact trial; required qualification is neither waived nor passed. No helpers/reviewers, ROS/Gazebo launch, xacro expansion, cloud, Docker, hardware or deployment were used in this fix round.

The original report remains an unchanged 31,609-byte prefix (SHA-256 `e1286018bb57fd1e6a771bda5c322c79008229609e4d6b935852c157aa058884`). `evidence-L03/fix1/pre-fix1-report.md` and its identity preserve it. Original task bases remain Source `00d41e7f25ec1294b9bc8e8c81de3d8e1a869316` / Lab `82b5f92005673c99ba0d1f434ae4c512800fa75e`. Fix review bases are Source `2a7ec9c89935649835fc08eee4ebe81fc6190cf0` / Lab `020b818b6ce0b813c22b8826945a917fe4017816`. Scoped review must include **both** new Source commits and both Lab pins from these fix bases, not HEAD~1.

## Finding disposition and final behavior

| Finding | Prepared-code disposition | Evidence and remaining limit |
| --- | --- | --- |
| R1-01 visual transforms/scales | Fixed in Python producer and independent TS consumer | Every canonical visual mesh has identity xyz/rpy and unit scale, with legal omitted URDF defaults equivalent to explicit values. Duplicate origins, extra geometry, altered scale/translation/rotation fail. Native-kind records with coherently recomputed raw hashes still fail semantics. No actual expansion or collision/contact qualification asserted. |
| R1-02 invalid graph/tool link | Fixed in both readers and positive protocol fixture | Exact connected acyclic native graph, unique nodes/children, declared endpoints, pinned world attachment and end-effector alias. Missing TCP/eef/world, extra/disconnected link, extra/cyclic/dangling/altered joint fail. Canonical R2a bytes remain unchanged. |
| R1-03 open control/plugin semantics | Fixed in both readers | Exact mode-specific arm and G2 control blocks, joint/interface/limit bindings, seven transmissions, G2 URDF mimic relations and five plugin bindings, Gazebo selfCollide declarations, X2-only Harmonic control plugin. Extra hardware parameters, wrong/extra/nested plugins, wrong interfaces/joints/mimics and parameter-path substitutions fail even with resealed native-kind records. Static declaration validation does not validate external parameter-file contents or installed behavior. |
| R1-04 lost ACK mislabeled not_run | Fixed at public CLI lifecycle implementation | Durable startup/command-attempt state is separate from successful ACK. Lost ACK, rejected action, thrown transport and startup uncertainty are `executed/fail` (attempted case, not proof of actual motion). Explicit preflight refusal alone is `not_run/blocked_external`. Receipts are durable before dispatch; original failure survives failed cleanup. Tests use doubles and retain `protocol_double`. Actual preflight receipts remain legitimate not_run. |
| R1-05 native completion | **NOT ADDRESSED — external qualification incomplete** | Actual X1/X2 provenance, installed package/plugin/parameter identity, real expansion/readback, motion/fault/stop/controller-restart evidence and X3 ten trials or observed unsupported outcome are absent. 0/10 contact trials; unobserved G2 is not proven unsupported. Same-run reopen refusal is not controller restart evidence. Direct FollowJointTrajectory is not collision-planned motion. |

## Implementation and APIs

- `packages/lab-runtime/src/v2/sil/xarm-mapping.ts` and `robotics/manipulation/native_xarm/mapping.py`: retain existing validator/producer APIs and metadata binding; enforce graph, geometry, mimic and complete control-extension semantics. The XML parser remains bounded, and generated mapping refs still cannot satisfy immutable closure entries. Existing handoff schema/model/tool role semantics are unchanged.
- `robotics/manipulation/profiles/xarm6-native-mapping.json`: adds expected identity visual transforms/unit scales, exact pinned native graph and canonical-to-native alias explanation. `link6 → joint_eef → link_eef` is an identity transform; vendor `gripper_fix` attaches to `link_eef`. `world_joint` fixes world→link_base at identity. This corrects the old collapsed native projection without changing R2a canonical data or TCP endpoint equivalence.
- `profiles/xarm6-sim-extensions.json`: static XML semantic expectation manually projected from the pinned vendor macros; **not xacro output or native evidence**. The arm control block is named for the mode hardware plugin; the G2 block is XArmGripperSystem. Arm joints1–6 and drive_joint expose position/velocity command and state interfaces; arm position/velocity and gripper velocity limits match upstream. Transmissions and five G2 mimic plugin declarations are checked, including drive_joint bindings and numeric fields. Both modes retain the upstream G2 mimic declarations; accepting their names is not asserting Harmonic support.
- X1 uses package://xarm_description mesh URIs; X2 uses file:///opt/mekoniq/xarm_ws/install/xarm_description/share/xarm_description. Existing fixed install/root/hash checks remain. X2 declares gz_ros2_control-system / gz_ros2_control::GazeboSimROS2ControlPlugin and `/tmp/launch_params_<suffix>` generated by the pinned uf_robot_utils helper. `native_xarm/worker.py` fixes TMPDIR to `/tmp` for this declared profile. Target data explicitly labels parameter contents `unresolved_separate_from_raw_declaration_mapping`; no reader opens/authenticates that external YAML. Installed content and native behavior are separate unresolved gates.
- `packages/lab-runtime/src/v2/sil/xarm-cli.ts`: keeps `runXarmCase` and public CLI options unchanged. New fsynced/renamed `source-lifecycle.json` records provider_start_requested → provider_ready → command_attempted or preflight_refused, startup disposition, command ACK disposition and shutdown errors. Command bytes with ack:null are synced before dispatch; received ACK replaces that record. Case `executed/fail` means attempted, not a claim of observed movement. Exit1 versus exit2 follows that distinction. Source unknown/no-resend protections are unchanged.
- `tests/fixtures/xarm-native-protocol.urdf` is now structurally valid, with the complete graph/control/transmission/mimic declarations. It remains a synthetic protocol fixture. Both mode positives and malformed/coherently resealed negatives are covered by `tests/integration/xarm-native-contract.test.ts` and `robotics/manipulation/tests/test_native_xarm.py`. New `tests/integration/xarm-native-cli.test.ts` tests lost ACK, rejection, startup/preflight, pre-dispatch durability and cleanup failure using explicitly labeled lifecycle doubles.
- `docs/operations/xarm-native-sim.md` records corrected aliases, closed raw declaration scope, external YAML/native limitations, attempted-case semantics and R88. `native-vendor.lock.json` adds ten exact pinned source snapshots, with license/NOTICE retained. Lab changes are only runtime pin and generated provenance headers (three files).

## Pinned upstream inspection and projection

The fixed upstream commit remains `d837f2e17f7f36043103b367fca3af8172626245`, tree `716c810e5cf34dcef317454dd601bcb6826bea9b`; SDK pin and old R2a asset lock are unchanged. Fix inspection fetched the official recursive Git tree and exact raw files, verified SHA-1 using the Git blob header, retained the raw inputs under `fix1/upstream/`, then pinned the necessary additional files below. This is **source inspection**, not installed closure, expansion or native qualification. Existing common.link.xacro defines identity visual origin defaults and no scale; common gripper visual calls pass zero origins. The vendor macro declares the world/eef nodes and attaches the gripper to link_eef. Root confirmed this is the required R1-02 correction, not a new canonical model. The synthetic selector XI13050520BB00 remains unchanged and is never a hardware identity.

| Added upstream snapshot (relative to vendor-source; exact pinned link) | SHA-256 | Git blob SHA-1 |
| --- | --- | --- |
| [xarm_description/urdf/xarm6/xarm6.ros2_control.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm6/xarm6.ros2_control.xacro) | `8bd4f1708880c7eb384bcc8dd3b979f6550257881b332741b726ddbc4408ef48` | `0d41e443b8431c301e29d9f08df44ea5d347158e` |
| [xarm_description/urdf/xarm6/xarm6_robot_macro.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm6/xarm6_robot_macro.xacro) | `754c352b96c09c4150508d69a0d0547a3b410efce79eb78c187c5d090e60da9a` | `f3b2623511e229811d51e68d476952d215830473` |
| [xarm_description/urdf/xarm6/xarm6.gazebo.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm6/xarm6.gazebo.xacro) | `45502e8d9dbfdc50a23fd7174e14ec71aa9cdc07e9981240551a1e3c8ac3d137` | `99ed6c0d9c4325426871f07951017b9ee3876b15` |
| [xarm_description/urdf/xarm6/xarm6.transmission.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm6/xarm6.transmission.xacro) | `536f1bcdf87ac6f08c6511dd89235a322803007628caf6beed7ed652dcfd7d6d` | `d0bde66fe4530983d0cdfbccc7292e091dd95bde` |
| [xarm_description/urdf/common/common.gazebo.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/common/common.gazebo.xacro) | `a59da43657e269866019aa5693fcecc9daee150828719e7194cb464f186eae00` | `c5ada1a78bdfbf8f3266f1857966330a386c9298` |
| [xarm_description/urdf/xarm_device_macro.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm_device_macro.xacro) | `571dd90dd5ae4d8aa549686a253050e0576d0ef29755121cd2d7a95b24649eda` | `b8f87c8540ee1ff3c516d7a2c125e4e1e4b29efd` |
| [xarm_description/urdf/xarm_device.urdf.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/xarm_device.urdf.xacro) | `effbda7f945fcee8347c8e1f3bec59bbeea38f60a6e9a5b75aea221b3ed4e81a` | `2e34d8870a44a0582cc0c9dea48451a05c9746bb` |
| [xarm_description/urdf/gripper/xarm_gripper.urdf.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/gripper/xarm_gripper.urdf.xacro) | `e1987b755501636b7ba32518d98ecb5fc8c6d2c4b1c45a49d332d6672f22c8cb` | `dd1731764327674f4eb882e5a66ab89694741e11` |
| [xarm_description/urdf/gripper/xarm_gripper.transmission.xacro](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/gripper/xarm_gripper.transmission.xacro) | `83a1298210243871e0039cf58b2a09a9c24e0848432e02a4da960ec8efbdf771` | `4c8e4170608f899b3d5ad790d6bb6359b483e77e` |
| [uf_ros_lib/uf_ros_lib/uf_robot_utils.py](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/uf_ros_lib/uf_ros_lib/uf_robot_utils.py) | `91f99f87d6c5467b02d3da4d9778e7db13b7d95bacc528329c35e22a0d7abd63` | `9deef8d48ab6b4e466ea58101efc1082861daba5` |

The final native target has 16 joints and 17 links. All twenty retained native source snapshots match the pinned Git tree; all original twenty-one canonical description source identities, R2a component/vendor files and both unresolved engineering environment locks are unchanged.

## TDD chronology, scopes and own-exit receipts

All new evidence is under `evidence-L03/fix1/`; no original receipt, export, cache or report bytes were rewritten. Each check below has separate `.log` and `.receipt.json` files with its own numeric exit, exact argv/cwd/toolchain/env and before/after Source/Lab byte identities. The receipt helper uses Node24.22.2, pnpm10.32.1, portable Python3.11, PYTHONDONTWRITEBYTECODE=1 and no pytest cache; no rclpy/native interpreter was installed. Filtered/deselected tests are not_run for that invocation, not passes.

1. `red-mapping-ts` failed on accepted 1000× scale; `red-mapping-python` had seven expected-rejection failures: scale, displaced visual, already-missing TCP, orphan, cycle, unknown Gazebo plugin and empty control. The pre-correction fixture already lacked TCP; that RED intentionally retains the malformed original bytes. Empty-control mutation likewise preserves the existing deficient control. TS stops at its first assertion, so it is not claimed to demonstrate all seven in that output.
2. `red-cli`: lost ACK, actual action rejection and startup error incorrectly became not_run; three failures, one legitimate preflight pass. The fixes then reached `green-mapping-python` 35 passes and `green-ts` 18 passes at their recorded intermediate bytes.
3. Added mode/default/resealed interface/mimic/graph and lifecycle-durability coverage. `final-ts` passed 123 tests (66 security handoff,37 unit handoff,15 xArm contract,5 CLI); `final-python` passed37. Source types/contracts and changed-file lint passed. These are the first fix's pre-numeric-lexical final checks, not a claim of checking later bytes. No routing behavior changed; no unaffected broad suite was repeated.
4. First clean fix tuple Source97af81b / Lab4a32dc9 was exported and pinned, with two actual public preflight refusals. Self-review then found Number('') coercion of an empty plugin offset, and Python float('0_0') accepting non-URDF underscore notation. `red-numeric-ts` failed on accepted emptyOffset; `red-numeric-python` failed on accepted underscore offset. Neither is fabricated duplicate-send or native behavior evidence.
5. The second fix closes scalar/vector numeric lexing in both readers: only finite decimal/scientific values, with legitimate signed/fractional/exponent notation retained. Reject empty/whitespace, hex and underscore forms before conversion. `selfreview-ts` passed15 xArm contracts; `selfreview-python` passed12 selected mapping/readback/mode/numeric tests,26 deselected. This is **not a 38-test full-suite claim**. Types and changed-file lint passed again. Final-byte audit selects these later receipts for the four changed files and the earlier covering receipts for unchanged files. Counts overlap and must not be added. Original implementation's 136/92,20/27,13/28 and earlier milestones remain historical at their own bytes, untouched by this appendix.

| Check (relative log/receipt basename) | Own exit | Exact argv (cwd is Source unless name starts lab-) |
| --- | --- | --- |
| [red-mapping-ts.log](evidence-L03/fix1/red-mapping-ts.log) / [receipt](evidence-L03/fix1/red-mapping-ts.receipt.json) | 1 | `perl -e 'alarm 110; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t fix1` |
| [red-mapping-python.log](evidence-L03/fix1/red-mapping-python.log) / [receipt](evidence-L03/fix1/red-mapping-python.receipt.json) | 1 | `perl -e 'alarm 110; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k fix1 -q` |
| [red-cli.log](evidence-L03/fix1/red-cli.log) / [receipt](evidence-L03/fix1/red-cli.receipt.json) | 1 | `perl -e 'alarm 110; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-cli.test.ts` |
| [green-mapping-python.log](evidence-L03/fix1/green-mapping-python.log) / [receipt](evidence-L03/fix1/green-mapping-python.receipt.json) | 0 | `perl -e 'alarm 110; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| [green-ts.log](evidence-L03/fix1/green-ts.log) / [receipt](evidence-L03/fix1/green-ts.receipt.json) | 0 | `perl -e 'alarm 110; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/xarm-native-cli.test.ts` |
| [final-ts.log](evidence-L03/fix1/final-ts.log) / [receipt](evidence-L03/fix1/final-ts.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts tests/integration/xarm-native-cli.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts` |
| [final-contracts.log](evidence-L03/fix1/final-contracts.log) / [receipt](evidence-L03/fix1/final-contracts.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm contracts:check` |
| [final-typecheck.log](evidence-L03/fix1/final-typecheck.log) / [receipt](evidence-L03/fix1/final-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [final-python.log](evidence-L03/fix1/final-python.log) / [receipt](evidence-L03/fix1/final-python.receipt.json) | 0 | `perl -e 'alarm 110; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -q` |
| [final-lint.log](evidence-L03/fix1/final-lint.log) / [receipt](evidence-L03/fix1/final-lint.receipt.json) | 0 | `perl -e 'alarm 110; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-mapping.ts packages/lab-runtime/src/v2/sil/xarm-cli.ts tests/integration/xarm-native-contract.test.ts tests/integration/xarm-native-cli.test.ts` |
| [preservation.log](evidence-L03/fix1/preservation.log) / [receipt](evidence-L03/fix1/preservation.receipt.json) | 0 | `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/audit-preservation.py` |
| [diff-check.log](evidence-L03/fix1/diff-check.log) / [receipt](evidence-L03/fix1/diff-check.receipt.json) | 0 | `git diff --cached --check` |
| [export.log](evidence-L03/fix1/export.log) / [receipt](evidence-L03/fix1/export.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l03-fix1-runtime-97af81b-20261115` |
| [lab-import.log](evidence-L03/fix1/lab-import.log) / [receipt](evidence-L03/fix1/lab-import.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/import-runtime.mjs /tmp/l03-fix1-runtime-97af81b-20261115` |
| [lab-sync.log](evidence-L03/fix1/lab-sync.log) / [receipt](evidence-L03/fix1/lab-sync.receipt.json) | 0 | `node scripts/sync-engineering-contracts.mjs` |
| [lab-check-source.log](evidence-L03/fix1/lab-check-source.log) / [receipt](evidence-L03/fix1/lab-check-source.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| [lab-typecheck.log](evidence-L03/fix1/lab-typecheck.log) / [receipt](evidence-L03/fix1/lab-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [lab-diff-check.log](evidence-L03/fix1/lab-diff-check.log) / [receipt](evidence-L03/fix1/lab-diff-check.receipt.json) | 0 | `git diff --cached --check` |
| [public-X1.log](evidence-L03/fix1/public-X1.log) / [receipt](evidence-L03/fix1/public-X1.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' node scripts/lab-xarm.mjs --mode X1 --environment-profile engineering-arm64 --case nominal --out /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/native-not-run/X1-engineering-arm64-nominal` |
| [public-X2.log](evidence-L03/fix1/public-X2.log) / [receipt](evidence-L03/fix1/public-X2.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-arm64 --case nominal --out /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/native-not-run/X2-engineering-arm64-nominal` |
| [final-identity.log](evidence-L03/fix1/final-identity.log) / [receipt](evidence-L03/fix1/final-identity.receipt.json) | 0 | `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/identity-audit.py` |
| [red-numeric-ts.log](evidence-L03/fix1/red-numeric-ts.log) / [receipt](evidence-L03/fix1/red-numeric-ts.receipt.json) | 1 | `perl -e 'alarm 110; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts -t 'fix1 closes'` |
| [red-numeric-python.log](evidence-L03/fix1/red-numeric-python.log) / [receipt](evidence-L03/fix1/red-numeric-python.receipt.json) | 1 | `.venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k numeric_spelling -q` |
| [selfreview-ts.log](evidence-L03/fix1/selfreview-ts.log) / [receipt](evidence-L03/fix1/selfreview-ts.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm exec vitest run tests/integration/xarm-native-contract.test.ts` |
| [selfreview-lint.log](evidence-L03/fix1/selfreview-lint.log) / [receipt](evidence-L03/fix1/selfreview-lint.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/xarm-mapping.ts tests/integration/xarm-native-contract.test.ts` |
| [selfreview-python.log](evidence-L03/fix1/selfreview-python.log) / [receipt](evidence-L03/fix1/selfreview-python.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' .venv-irsim/bin/python -m pytest robotics/manipulation/tests/test_native_xarm.py -k 'native_readback or mapping or mode_graph or numeric_spelling' -q` |
| [selfreview-typecheck.log](evidence-L03/fix1/selfreview-typecheck.log) / [receipt](evidence-L03/fix1/selfreview-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [selfreview-diff-check.log](evidence-L03/fix1/selfreview-diff-check.log) / [receipt](evidence-L03/fix1/selfreview-diff-check.receipt.json) | 0 | `git diff --cached --check` |
| [export-final.log](evidence-L03/fix1/export-final.log) / [receipt](evidence-L03/fix1/export-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l03-fix1-final-runtime-20261115` |
| [lab-import-final.log](evidence-L03/fix1/lab-import-final.log) / [receipt](evidence-L03/fix1/lab-import-final.receipt.json) | 0 | `node scripts/import-runtime.mjs /tmp/l03-fix1-final-runtime-20261115` |
| [lab-sync-final.log](evidence-L03/fix1/lab-sync-final.log) / [receipt](evidence-L03/fix1/lab-sync-final.receipt.json) | 0 | `node scripts/sync-engineering-contracts.mjs` |
| [lab-typecheck-final.log](evidence-L03/fix1/lab-typecheck-final.log) / [receipt](evidence-L03/fix1/lab-typecheck-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [lab-check-source-final.log](evidence-L03/fix1/lab-check-source-final.log) / [receipt](evidence-L03/fix1/lab-check-source-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| [lab-diff-check-final.log](evidence-L03/fix1/lab-diff-check-final.log) / [receipt](evidence-L03/fix1/lab-diff-check-final.receipt.json) | 0 | `git diff --cached --check` |
| [public-X1-final.log](evidence-L03/fix1/public-X1-final.log) / [receipt](evidence-L03/fix1/public-X1-final.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' node scripts/lab-xarm.mjs --mode X1 --environment-profile engineering-arm64 --case nominal --out /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/native-not-run-final/X1-engineering-arm64-nominal` |
| [public-X2-final.log](evidence-L03/fix1/public-X2-final.log) / [receipt](evidence-L03/fix1/public-X2-final.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' node scripts/lab-xarm.mjs --mode X2 --environment-profile engineering-arm64 --case nominal --out /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/native-not-run-final/X2-engineering-arm64-nominal` |
| [final-identity-2.log](evidence-L03/fix1/final-identity-2.log) / [receipt](evidence-L03/fix1/final-identity-2.receipt.json) | 0 | `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/identity-audit-final.py` |

The recorded final-byte attribution in `identities-final.json` covers every one of the 22 changed Source files from FIX_BASE. There were no post-check product edits beyond committing those checked bytes. Source contracts are unchanged by the numeric-only follow-up, so the passing earlier contracts check was retained. Changed-file ESLint is not full-repository lint: the original B10-owned historical failures remain unresolved, and no full CI pass is claimed.

## Clean tuples, exports and preservation

Source commits: `97af81ba9e4d4c6e6633384dad23d0f201a06817` (four findings) followed by `7b5b3a17e501f125efac18749ad5b8123940ce7c` (numeric self-review). Lab commits: `4a32dc9dad587bba9db32babf3797a5166eb93e1` then `58d082a9d57ea9216fa123ebb5d676ae1421b550`. The fix review spans both commits from2a7ec9c/020b818. No amend/rebase/squash hid the intermediate tuple or attempts.

| Identity | Final value |
| --- | --- |
| sourceCommit | `7b5b3a17e501f125efac18749ad5b8123940ce7c` |
| sourceTree | `5a0a6783109235645ee5d003d9f53eddb1158ef8` |
| labCommit | `58d082a9d57ea9216fa123ebb5d676ae1421b550` |
| labTree | `d7b286768637f7df87bae968f5a27701b3f417e0` |
| export | `/tmp/l03-fix1-final-runtime-20261115` |
| runtimeArtifactSha256 | `108e6233183a0646cc09ddb4e376a6a5fda3262cc964d7be242e991b3c08863a` |
| schemaHash | `9e869f41bd7dbbbae1f26f81b75449b727e7160fdfb1a3b32cf3b23a5cb034e4` |
| nativeToolsDigest | `1d738a3cb17b63f6cf9702554e99a59de51cbbcf1b2ae72b25cd43048f480e50` |
| nativeToolsFiles | `213` |
| portableToolsDigest | `1fb6f053d4903a109a41f862556a02c2fd71c60d5011d94d27463165ad697d82` |
| portableToolsFiles | `237` |
| manifestSha256 | `3ae99664dfb2ce993a12f433ae9a7bda5361407fd06742c05566da554d71bc1e` |
| cacheManifestSha256 | `a6942acac622d10808702b4a84f1097c2710ab37a0abb19f006fa0235de2be71` |
| labPinSha256 | `8ec8a78bcc85599c201535dae0fd671867c57bf72d73f141819f8ec0f2c44ee7` |

Both worktrees are clean. Clean export→Lab import→generated sync→check:source/typecheck→pin checks passed for each tuple. The exported and cached manifest JSON objects are identical; importer formatting gives different byte hashes, recorded explicitly. Runtime bytes and closure-member hashes were checked against the Source tree. This is a local byte/receipt consistency audit, **not effective Git-graph attestation or host authentication**. Native closure has213 files; portable closure remains237 with unchanged digest; schema hash remains unchanged.

`fix1/identities.json` preserves the first fix tuple, `/tmp/l03-fix1-runtime-97af81b-20261115`, artifact b8b6096d994e7028e7f0ac87f142673db64d8de12e16c5773146574d6809e1fa and its two attempts. `identities-final.json` describes the final tuple and verifies the intermediate export/cache/case hashes. Original2a7ec9c export/cache and all140 original L03 evidence files,86 L02 and63 L02-r1 files remain byte-identical according to their root indexes. The original report is preserved as a prefix. No prior numeric test count is relabeled as final.

## Actual executions, native not_run and self-review limits

Four real public CLI invocations in this fix round were **preflight-only**: X1/X2 engineering-arm64 nominal for each clean tuple. Each returned numeric exit2; no launch.log, native process, native-started.json or raw-bag was produced. The six original actual preflight refusals are untouched. Repeating cancel/restart and amd64 refusal matrices was unnecessary for this parser/phase fix; their original receipts remain historical, not attributed to the new commits. Native actual movement/external stop/controller-restart remain not_run.

Final manifests under `fix1/native-not-run-final/` bind the final clean Source commit, target profile and environment request. source-lifecycle.json records `{phase:preflight_refused,startup:preflight_refused,command:not_attempted,shutdownErrors:[]}`. Reasons retain missing native OS/platform, apt/package/plugin/runtime inventory and vendor overlay; requested evidenceKind is ros2_fake_system or gazebo_actual, explicitly **not an observation that those modes ran**. Motion and contact are not_run/blocked_external, accepted:false, dynamics:not_calibrated and contact0/10. Final manifest hashes:
- `X1-engineering-arm64-nominal`: `548029702b7d6f8eb752ad25de95f2074d267cd3f796c7900f88426b3bfff961`
- `X2-engineering-arm64-nominal`: `e821722e0df51f6cfc219794b25ad58bb111aad966d212cefcd9212e9f5eccd3`

Self-review checked both producer and independent consumer, pinned graph/control sources, defaults, alias equivalence, coherent resealing and immutable-role separation; caught and corrected the numeric coercion after preserving the first tuple. Unknown/no-resend paths remain covered. Exact native expansion, ROS API compatibility on the host, controller timing, generated YAML contents, installed provenance, mimic/contact physics, collision configuration and independent native bag replay remain unverified. R1-05 is an unmet requirement, not a spec pass or an observed unsupported verdict. L03 prepared-code review may proceed separately under R88; human acceptance and DEP-XARM-01/02/SEC-01/03 remain closed. No runtime/UI hardware capability was enabled.

Final append audit: `evidence-L03/fix1/preservation-final.log` and `.receipt.json` record own exit0 for `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L03/fix1/audit-preservation.py`, after this report was appended. It verified the unchanged original report prefix, original140 L03/86 L02/63 L02-r1 files, original export/cache, canonical model/environment locks and all20 pinned vendor snapshots.
