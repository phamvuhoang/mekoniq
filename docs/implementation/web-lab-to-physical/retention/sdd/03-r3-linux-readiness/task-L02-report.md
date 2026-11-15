# L02 implementation report

Status: **DONE_WITH_CONCERNS — executable native preparation complete; native qualification not_run.**

The separate canonical engineering FD01 Gazebo/Nav2 path is implemented and committed. Portable compiler/readback, protocol, prerequisite, clock, evidence and handoff regressions pass. No Linux native host was assigned. No ROS/Gazebo process, native nominal/fault campaign, native SDF conversion, native bag capture, hardware or commissioning was executed. All new native case records remain `accepted:false`, `not_calibrated`, `not_run/blocked_external`. Neither G-NATIVE-AMR nor DEP-NAV-01–04/SEC-01 is closed.

## Scope and identities

All mutations were in the assigned feature worktrees, both `codex/web-lab-to-physical`:

- Source base: `874d05aedfbf573496994fd73016f19ef19e6932`.
- Lab base: `4a207b43c613cf0c1226a9ff3c1990a96ec5ac08`.
- Source final: **`e6db696b2ac1266fdeede8c2a64521cd4064481a`**, `feat: prepare canonical engineering Gazebo lifecycle`.
- Lab final: **`7652851fb9e92e560c70e4e6675b85fa5f445cf4`**, `chore: pin source runtime e6db696`.
- Runtime artifact SHA-256: `89686e9595476379e12b980caccb714d7f0d7fab6560ddd45bf18b5d88ed360d`.
- Schema hash: `07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068`.
- Native tool closure: `6643ae338a7b3ee2e03c5659cbed5e962ae346d01746c1aaabd0ef912f61140f`.
- Portable tool closure: `5c58ddfacb92fc52adc7106cbe03f2758a9dd6ee23f4d64686e33803757774d3`.
- Native compiler-manifest file SHA-256: `03e5eb26079b0b849b148293364dd35eb73d96265364edc569161a892605277b`.
- Clean export: `/tmp/l02-runtime-e6db696-20261115`, `manifest.json` has `dirty:false`.
- Both worktrees were clean after commits and native preflight recording; see `evidence-L02/identities.json`.

The checker identity here means the committed local portable tests and Mac preflight code, not an independent native qualification or host attestation. The final tests cover the implementation tree committed in `e6db696`; the final interpreter-default test adjustment has its own covering `final-factory.log`, and the final not_run manifest identity fields are script-only changes covered by syntax/lint plus the subsequent actual preflight runs. No claim is made that a later Git check audited an already-cached helper import graph. L01's historical checker/probe/subject interfaces were not repurposed.

R85 explicitly authorizes the exact L00 canonical project/scene/model. The older `tests/fixtures/engineering/fd01.project.json` command example is superseded **only for this new native mapping**. Existing legacy/non-native compiler behavior remains covered by its original integration tests. The canonical project's `requestedProfile: engineering-webots-3d-v1` and portable navigation scene engine stay unchanged as source provenance; `native-mapping.json` separately binds target `engineering-rigid-v1` and the engineering environment profiles. There is no general profile-ignore policy.

## Implementation and API

### Compiler and static handoff

`robotics/simulation/compiler/engineering_native.py` accepts exactly the canonical EngineeringProject, NavigationSceneV1 and RobotPhysicalModelV1 from `robotics/simulation-3d/fixtures/serve-3d-v1/`. It emits a distinct native mapping, URDF, gz_ros2_control configuration, world, occupancy map, target bindings, scene index and hashed compiler manifest. It preserves SI link/joint names, inertias, masses, collision shapes, wheel dimensions, sensor parent frame/rate/range/beam count, canonical spawn and semantic target bindings. Friction and all physical parameters remain assumed; ideal velocity actuation is declared.

`robotics/simulation/fixtures/engineering-navigation-v1/{compiler-manifest,native-mapping}.json` are the frozen reproducible native output identities. Portable tests compare freshly compiled bytes against them. The original `compiler/engineering.py` was intentionally left unchanged so existing description and portable compiler bytes retain their old behavior.

`bridge/engineering_launch.py` checks all listed bytes and canonical manifest identity, then independently recompiles into a temporary directory and compares the full manifest. A merely resealed altered plugin/robot is rejected. TypeScript `readEngineeringCompiledWorld()` also checks the frozen manifest, every listed artifact and the original canonical documents.

`native-handoff-documents.ts` recognizes the exact attached native manifest/mapping. Missing mapping remains `NATIVE_ENGINE_MAPPING_UNRESOLVED`; missing manifest outputs become `NATIVE_ARTIFACT_CLOSURE_MISSING`; unresolved/wrong engineering native profile remains `NATIVE_ENGINE_PROFILE_UNRESOLVED`. Adding a factory or mapping does not set nativeReady. Existing OCI/native_apt discrimination and the old unresolved preparation behavior pass handoff unit/security regressions.

### Factory, Source lifecycle and time

`packages/lab-runtime/src/v2/sil/engineering-native.ts` adds `engineeringNativeProviderFactory({bundleDirectory,environmentProfile,simulationRoot,python?,nativeCase?})`. The factory consumes a compiled bundle plus server options, returns the existing GazeboBackend command/observation contract, and owns a latched `EngineeringClock`, fault receipt and evidence finalization. It admits only FD01, engineering-rigid-v1, an engineering-amd64/arm64 environment profile, and the canonical runtime project.

`cli.ts`, `campaign.ts` and `scripts/lab-sil.mjs` route this path separately. Source's existing FD01 journal/dispatcher/confirmation logic remains authoritative; engineering iterations are paced by actual provider-clock changes and Source timestamps use the resulting 20 ms logical tick. Clock mapping records `providerSimNs`, `sourceTick`, and `receiveMonotonicNs`. Reset, stale feedback and wall deadline stop progress with explicit attention. Legacy BV01 `nativeProviderFactory/createNativeScenarioRun` and engineering-contact refusal remain intact; this does not implement xArm/MoveIt motion, which belongs to L03.

`gazebo-nav2.ts` selects the engineering entrypoint only with an explicit matching environment profile; an engineering selection without that profile cannot fall through to the legacy worker. The engineering worker runs in an owned detached process group; worker exit kills that owned group. Native command receipts preserve unknown/no-resend behavior and an existing worker state directory is refused.

### Prepared ROS/Gazebo path

`launch/engineering_world.launch.py` starts the canonical Gazebo world paused, robot_state_publisher, model spawn, joint-state/diff-drive controller spawners, fixed bridge topics and the existing navigation launch with compiled frames/footprint/initial pose. There is one ros2_control velocity writer per drive joint; no parallel Gazebo DiffDrive writer. The worker stamps Nav2 Twist commands for the Jazzy controller's TwistStamped input.

`bridge/engineering_session.py` uses the existing Nav2 durable goal protocol, adds strict readiness/freshness checks and a separate engineering command guard, leases an engineering ROS domain (101–200), refuses a nonempty graph, uses a run-specific GZ partition and localhost-only ROS transport. Startup advances the initially paused simulation so controllers/localization/sensors can initialize before business dispatch. It checks native process liveness, clock, navigation lifecycle/localization, TF paths, joint identities, scan/joint receipt and simulation timestamps. Cleanup targets the owned launch/recorder and the supervisor-owned process group. These ROS/process behaviors are implemented but not observed on a native host.

The fixed case allowlist is `nominal`, `obstacle`, `no-path`, `cancel`, `worker-loss`. Obstacle/no-path move only compiled dormant case fixtures; cancel follows the first accepted goal; worker-loss exits the owned worker after a retained fault event. No caller names an action, topic, executable, endpoint, launch argument or arbitrary world entity. Negative cases require observed fault evidence, Source attention, zero served/completed outcomes and no repeated effect attempts. Native geometry effectiveness and timing remain unverified until native execution.

### Profile and evidence readiness

`engineering_profile.py`, `native_profile.py` and `scripts/native-sim/profile-report.mjs` retain the generic consistency comparator and add stricter native prerequisites: actual installed dpkg versions, absolute plugin file digests, runtime executable/environment/overlay fingerprints and apt source provenance. Both architecture lock files remain untouched, with unresolved exact package/plugin locks and `qualification:not_run`. Installed consistency is not native-host authenticity; the separate L00 native_apt provenance requirements remain necessary.

The worker records rosbag2 with simulation timestamps and an explicit expected topic allowlist. Normal finalization retains byte-verified copies. Deliberate worker loss uses a read-only SQLite backup and checks a digest of message contents before retaining the recovered copy. Original runtime files are preserved; the artifact list references the verified `rosbag2/` copy. No SQLite was retained in the actual L02 evidence here: native execution never started, and portable SQLite test files remained temporary test data.

`bridge/engineering_bag.py` replays actual SQLite message timestamps, not metadata claims. `assessEngineeringEvidence()` requires every expected topic and continuous clock/TF/odom/joints/scan/pose/contact coverage, with a 500 ms maximum uncovered interval. Static TF and event-driven command/action/AMCL streams require presence. Empty, missing, partial or inconsistent evidence stays not_run. `verify-engineering` rereads the bag and canonical bundle, then reassesses negative cases against Source journal/effects and retained fault observations.

Artifacts include normalized native events (trajectory, contacts, joints, LiDAR, clock), durable native commands, actual inventory, shutdown record, bag files, Source journal/effects, telemetry and assertions. LiDAR nonfinite no-return ranges have an explicit null normalization policy. This is offline coverage replay; independent ROS replay and numerical/physical outcome qualification are not claimed.

## Validation and retained attempts

Evidence root (ignored task records, not a rewritten historical candidate):

`/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/evidence-L02/`

Portable logs are under `portable/`; the original working copies also remain under `/tmp/l02-checks/`. Node was 24.22.2 and pnpm 10.32.1. Portable Python tests used `.venv-irsim/bin/python` **3.11.15**, `PYTHONDONTWRITEBYTECODE=1`, and pytest `-p no:cacheprovider`. No portable root bytecode/cache was created by these tests.

| Evidence | Actual result |
| --- | --- |
| `portable/python-red.log` | 4 RED failures for absent native compiler/launch/clock APIs. |
| `portable/python-green1.log` | First compiler/readback/clock/tamper checks: 4 pass. |
| `portable/ts-red.log` / `ts-green1.log` | New native module absent (2 suite failures), then routing/clock/topic coverage: 4 pass. |
| `portable/python-red-resealed.log` | Resealed tampered native artifact was wrongly accepted: 1 fail, 5 pass before reproduction guard. |
| `portable/profile-red.log` / `python-green2.log` | Missing native prerequisite function: 1 fail, 7 pass; native profile + parity: 14 pass. |
| `portable/protocol-red.log` | Engineering protocol guard absent: 3 fail, 6 pass. |
| `portable/protocol-green1.log`, `protocol-green2.log` | Test-helper import path error, then missing rfc3339-validator dependency: each 3 fail, 6 pass. These were not native failures. |
| `portable/python-dependency.log` / `protocol-green3.log` | Installed rfc3339-validator 0.1.4 and six 1.17.0 in isolated `/tmp/l02-python311`; then 9 pass. Existing worker venvs and package locks were not changed. |
| `portable/handoff-red.log` / `handoff-green1.log` | Exact native handoff mapping still unresolved: 1 fail; after binding, 106 tests pass including existing handoff security/unit coverage. |
| `portable/fault-red.log` / `fault-green1.log` | Missing fixed fault mapping: 1 fail, 9 pass; then 10 pass. |
| `portable/fault-ts-red.log` | Negative-case assessment absent: 1 fail, 3 pass before implementation. |
| `portable/worker-routing-red.log` | Engineering helper without a profile fell through to legacy selection: 1 fail, 3 pass before explicit guard. |
| `portable/final-ts.log` | **127 tests passed in 7 files**, no skips. Exact command below. |
| `portable/final-python.log` | **74 tests passed**, no skips. Exact command below. |
| `portable/final-factory.log` | **4 tests passed** after the final test-only interpreter-default adjustment. On environments without compiler dependencies that single actual-compiler integration test is explicitly skipped/not_run, never a native pass. |
| `portable/final-typecheck.log` | Source typecheck passed. |
| `portable/contracts-check.log` | Generated contracts match schemas. |
| `portable/final-focused-lint2.log` | Changed TypeScript/JavaScript/test files lint passed (empty successful output). `git diff --check` passed. |
| `portable/lint-combined1.log` | **Full `pnpm lint` failed: 27 pre-existing errors in five historical evidence scripts.** No L02 changed file appears in the errors. Root independently verified these files are byte-identical to L02 base and upstream11d25b4; see root's `root-L02-historical-lint-audit.json`. B10 owns exact lint configuration follow-up; no historical evidence was rewritten or broadly suppressed. |
| `export.log` | Clean committed Source export, dirty:false. |
| `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log` | Lab import, generated-contract sync, source verification and typecheck passed. |
| `native-not-run/doctor.json` and per-case logs/manifests | Actual Mac preflight denied native execution; all five cases not_run/blocked_external. |
| `native-not-run/verify-nominal.log` | Verifier printed NOT_RUN and preserved all prerequisite blockers. |

Final TypeScript command (bounded 180 s):

```sh
ENGINEERING_PYTHON="$PWD/.venv-irsim/bin/python" perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run \
 tests/integration/engineering-native-lifecycle.test.ts \
 tests/integration/engineering-native-evidence.test.ts \
 tests/integration/engineering-profile-routing.test.ts \
 tests/integration/engineering-compiler.test.ts \
 tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts \
 tests/integration/lab-v2-native-profile.test.ts
```

Final Python command (bounded 180 s):

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=robotics/simulation:robotics/agent:/tmp/l02-python311/lib/python3.11/site-packages \
perl -e 'alarm 180; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q \
 robotics/simulation/tests/test_engineering_native_parity.py \
 robotics/simulation/tests/test_engineering_compiler.py \
 robotics/simulation/tests/test_engineering_profile.py \
 robotics/simulation/tests/test_engineering_worker.py \
 robotics/simulation/tests/test_native_profile.py \
 robotics/simulation/tests/test_nav2_session.py
```

Additional development attempts preserved in tool history: `.venv-mujoco` and `.venv-webots` lacked PyYAML; `.venv-irsim` supplied compiler deps. No packages were installed in those environments. The first helper search used nonexistent requirements filenames and returned file-not-found. The direct ROS docs page was access-denied, so official Jazzy upstream source was used. Lab's initial pin commit omitted the two regenerated source-commit headers; the agent immediately amended its own new, unpushed commit to include them, yielding final7652851. The generated files had already passed typecheck before that commit.

No broad full Source build or entire repository test suite was run. Clean runtime export exercised bundling; focused combined coverage and source/Lab typechecks covered the changed seams. Root owns independent review.

## Actual native matrix after commit and pin

The doctor reported the actual host as Darwin arm64, with shell `python3` 3.15.2. That interpreter was used only for failed native preflight/inventory introspection; portable compiler/protocol tests used Python 3.11.15, and the prepared ROS path requires target-distro Python. Missing Linux/ROS/Gazebo/compiler dependencies and unresolved engineering-amd64 inventory blocked every native run before compilation/provider launch. The actual Mac report is not native inventory evidence.

| Requested case | Requested seeds/repeats | Actual native execution | Record |
| --- | --- | --- | --- |
| nominal | 17,18,19 / 3 | not_run, blocked_external | `native-not-run/nominal/run-manifest.json` |
| obstacle | 17 / 1 | not_run, blocked_external | `native-not-run/obstacle/run-manifest.json` |
| no-path | 17 / 1 | not_run, blocked_external | `native-not-run/no-path/run-manifest.json` |
| cancel | 17 / 1 | not_run, blocked_external | `native-not-run/cancel/run-manifest.json` |
| worker-loss | 17 / 1 | not_run, blocked_external | `native-not-run/worker-loss/run-manifest.json` |

All preflight commands exited2. `native-not-run/cases.json` indexes the actual records and doctor exit. Runtime inventory capture on a real host, exact apt package/plugin locks, clean native install/doctor, upstream/legacy smoke, actual SDF readback, three-seed native nominal execution, real obstacle/no-path/cancel/worker-loss outcomes, actual rosbag coverage and independent native replay remain **not_run**. No native engine mapping or plugin hash was invented to close those gates.

## Prepared command and API references

The committed runbook is `docs/operations/engineering-native-navigation.md`. Its canonical R85 command is:

```sh
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-amd64 --json
perl -e 'alarm 1800; exec @ARGV' node scripts/lab-sil.mjs run \
 --scenario FD01 --seed 17 --repeat 3 --out "$native_evidence_dir" \
 --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 \
 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json
node scripts/lab-sil.mjs verify --input "$native_evidence_dir"
```

Use a fresh output directory and one fixed `--engineering-case` for each fault run. No hardware or cloud route is enabled.

Official API references consulted (Jazzy/Harmonic, not installed-version qualification): [gz_ros2_control](https://control.ros.org/jazzy/doc/gz_ros2_control/doc/index.html), [diff_drive_controller](https://control.ros.org/jazzy/doc/ros2_controllers/diff_drive_controller/doc/userdoc.html), [rosbag2 record CLI source](https://github.com/ros2/rosbag2/blob/jazzy/ros2bag/ros2bag/verb/record.py), [rosbag2 recorder source](https://github.com/ros2/rosbag2/blob/jazzy/rosbag2_transport/src/rosbag2_transport/recorder.cpp), [TF listener source](https://github.com/ros2/geometry2/blob/jazzy/tf2_ros_py/tf2_ros/transform_listener.py), and [Nav2 parameter defaults](https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_bringup/params/nav2_params.yaml). TF remapping was implemented on a separate node because Jazzy's listener constructor has no `tf_topic` keyword. Jazzy's controller input is TwistStamped, so the worker explicitly stamps Nav2 Twist output. No upstream source was vendored or unpinned package lock claimed.

## Self-review and remaining concerns

- Admission stays fail-closed: legacy fixture, noncanonical/resealed physical model, unsupported scenario/set/profile and altered native artifacts are rejected. The existing BV01/coffee/arm factory is not used for engineering FD01.
- Source owns business journal, commands and confirmations. Protocol tests cover failed/no-path/cancelled outcomes, stale TF/feedback, clock reset and lost ACK without resend; native process behavior itself is not claimed tested.
- Canonical input provenance is preserved independently of the native target mapping. Native profile/tool requirements are distinct from static compiler consistency. Both package/plugin lock files stay unresolved.
- Missing expected bag topics/time coverage, unobserved faults, replay attempts and false completion cannot become a passing prepared assessment. Candidate acceptance remains false regardless of a portable pass.
- Actual ROS/Gazebo startup, controller/TF behavior, clock/pacing under load, process-tree teardown, fault fixture placement, sensor/contact fidelity and bag recovery need assigned-host validation. Portable protocol doubles and synthetic SQLite coverage tests do not satisfy those gates. The native contact sensor currently observes the base collider; native whole-body/contact qualification must be assessed on the real engine before any stronger contact claim.
- Only the exact one-AMR canonical subject is mapped. Other engineering projects, xArm/MoveIt contact work, measured dynamics, full independent ROS message replay and hardware are outside the delivered L02 native preparation evidence.
- Full repository lint remains failing for unchanged historical evidence files, confirmed by root; changed-file lint passes. This is an explicit integration limitation, not a silently skipped gate.
- No push, main merge, deployment, Docker retry, cloud/native host provisioning, robot connection, operational port mutation or human acceptance signature occurred. Original main checkouts, trial and web were untouched.

## Audit appendix — exact final lint and syntax command scope

Appended after root's export/pin audit; no code, heads, existing report bytes or existing log bytes changed, and no checks were rerun.

The final focused lint invocation ran in the Source worktree with Node 24.22.2 selected:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/sil/engineering-native.ts packages/lab-runtime/src/v2/sil/campaign.ts packages/lab-runtime/src/v2/sil/cli.ts packages/lab-runtime/src/v2/sil/native-handoff-documents.ts packages/lab-runtime/src/v2/backends/gazebo-nav2.ts scripts/lab-sil.mjs scripts/native-sim/profile-report.mjs scripts/native-sim/tool-identity.mjs tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/engineering-profile-routing.test.ts > /tmp/l02-checks/final-focused-lint2.log 2>&1
cat /tmp/l02-checks/final-focused-lint2.log
git diff --check
```

The retained copy is `evidence-L02/portable/final-focused-lint2.log`. The recorded tool-shell exit status was **0**, with no lint diagnostics. **The ESLint subprocess exit status was not separately captured**: this shell invocation ended with `git diff --check`. The empty log therefore records the exact lint scope and absence of diagnostics; it is not an independently captured numeric ESLint exit receipt. This clarifies the earlier table's “empty successful output” wording.

The standalone JavaScript syntax command actually used was:

```sh
node --check scripts/lab-sil.mjs
```

It produced no diagnostics. That tool shell then ran the following Python AST check and returned **0**; the Node syntax subprocess exit status was not separately captured:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv-irsim/bin/python - <<'PY'
import ast
from pathlib import Path
for path in [*Path('robotics/simulation/bridge').glob('engineering*.py'),Path('robotics/simulation/compiler/engineering_native.py'),Path('robotics/simulation/launch/engineering_world.launch.py')]:
    ast.parse(path.read_text());print(path)
PY
```

Chronology correction: the standalone `node --check` preceded the final script-only addition of `subjectCommit`, `engineeringCase`, `accepted` and `dynamics` to engineering not_run manifests. No second standalone syntax check was run after that addition. The final script was subsequently linted by the exact focused command above and actually parsed/executed after the clean commit/pin by the recorded doctor, five case preflights and nominal verifier. Those executions preserve their actual `not_run` results; they are not a substitute claim of an independently logged final-tree `node --check` exit status. The earlier report's general “syntax/lint plus subsequent actual preflight” wording should be read with this chronology.

## Audit appendix — focused lint exit gap closed

At root's explicit request, the exact focused lint argv above was run **once** on unchanged Source `e6db696b2ac1266fdeede8c2a64521cd4064481a`, with Node `v24.22.2`. A Node harness invoked `perl` with `['-e', 'alarm 120; exec @ARGV', 'pnpm', 'exec', 'eslint', ...the exact eleven file paths above]`, captured the child result directly, wrote new evidence using exclusive creation, and returned the captured child exit code. No later shell command masked that result.

**Actual focused lint exit code: 0. Signal: null. Spawn error: null.** The new log contains no diagnostics. Source HEAD was checked before and after, remained exactly `e6db696b2ac1266fdeede8c2a64521cd4064481a`, and the tracked/untracked worktree status was clean before and after.

- Log: `evidence-L02/portable/final-focused-lint-unmasked.log`.
- Numeric exit receipt, full argv, Node version and checked Source identity: `evidence-L02/portable/final-focused-lint-unmasked.receipt.json`.

This closes the focused-lint exit-status gap disclosed in the preceding appendix. The earlier logs and report bytes remain preserved. No code, commit, export or Lab pin changed; no broad suite or standalone syntax check was rerun. The full-repository historical-evidence lint limitation remains unchanged.


## L02 fix round 1 — prepared TF freshness corrected; CLI finding disputed

Status: **READY_FOR_SCOPED_REVIEW / native qualification not_run.** This appendix supersedes the original report's broad stale-TF coverage claim: the original protocol test injected a reason and did not detect an expired cached chain. The actual engineering observer and health guard now enforce per-edge freshness. R1 remains disputed and pending independent scoped re-review; it is not silently closed or parked.

Fix bases were Source `e6db696b2ac1266fdeede8c2a64521cd4064481a` and Lab `7652851fb9e92e560c70e4e6675b85fa5f445cf4`. Original task bases remain unchanged. Work stayed in the assigned Source/Lab feature worktrees. No helpers were used.

### Finding dispositions

**L02-R1 — existing normalization demonstrated, no redundant production edit.** Inspection of the exact FIX_BASE showed that `SCHEMA.run['engineering-project']` is `path`, `parse()` resolves every path with `resolve(v)` against the caller's cwd, and the public entrypoint passes that parsed object to `run()`. Thus `fixture` is already absolute before the compiler changes cwd. Root independently checked the same committed code and instructed the implementer to preserve it, add the real argv regression and report the honest initial result.

The new `tests/integration/engineering-native-cli.test.ts` invokes the actual public Node CLI from Source, once with the documented relative canonical input and once with its absolute equivalent. A child-process-only preload in `tests/support/engineering-cli-probes.mjs` doubles external host/probe results and the native runtime transport; it leaves the production parser, doctor/report validation, prerequisite admission and orchestration unchanged. The real canonical Python compiler runs from `robotics/simulation`. Assertions inspect its actual `--project` argv, the subsequent runtime `--fixture` argv, the changed child cwd, and equality of the two generated compiler manifests. Both paths reach the same absolute file. There is no production test bypass, new launch flag or host qualification claim. Real-host refusal is separately recorded below.

The first CLI regression was **already GREEN**, exit 0, on unchanged `scripts/lab-sil.mjs`; no RED was fabricated. The script remains byte-identical to FIX_BASE. On machines without the portable compiler dependencies this one test is explicitly skipped/not_run, following the adjacent compiler tests; all recorded runs here used Python 3.11.15 and executed it without a skip. R1's review verdict is for the independent scoped reviewer to reconcile with this evidence.

**L02-R2 — fixed and regression-tested.** `_ObservedTfBuffer` wraps the real tf2 buffer supplied to Jazzy TransformListener. It records the exact dynamic/static setter calls after forwarding them to tf2, under a small observer lock. Only the two canonical dynamic edges (`map`→`odom`, `odom`→`chassis/base`) and fixed sensor edge (`chassis/base`→`lidar/head`) are retained, so unrelated wheel TF cannot refresh localization/odometry receipt ages. The actual `EngineeringRosPorts._node()` wiring and `health()` are exercised by portable tests; native transport and the action server are doubles, not manually injected health reason strings.

Each dynamic edge needs an observation no more than 500 ms old by monotonic receipt, and a timestamp no more than 500 ms behind current provider `/clock`. AMCL's owned `robotics/navigation/config/nav2_params.yaml` has `transform_tolerance: 1.0`; the guard permits map→odom up to one second ahead, and odom→base up to 500 ms ahead. These bounded future allowances do not extend the receipt deadline. The required sensor edge must come from the static setter, may carry timestamp zero, and does not expire. A static transform cannot substitute for either dynamic edge. The existing cache connectivity check remains in addition to freshness. Sampling monotonic time while holding the observer lock avoids treating a concurrent callback's receipt as a future receipt.

Failure after readiness uses the existing fatal latch, rejects new goals, and makes query results unknown even if a fake action server has already returned SUCCEEDED. Existing durable receipts remain authoritative: accepted/unknown repeated IDs never cause another send. Missing TF, old provider stamps despite new receipt, receipt expiry while provider stamps and all other streams remain fresh, both stopped dynamic edges, unrelated wheel traffic, static sensor validity, wrong transport kind, excessive future timestamps, clock reset, lost ACK and late success are covered. The runbook now states this exact policy. Real native timing/TF compatibility remains unqualified.

The implementation uses the documented setter seam in [Jazzy TransformListener](https://github.com/ros2/geometry2/blob/jazzy/tf2_ros_py/tf2_ros/transform_listener.py). [Jazzy AMCL](https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_amcl/src/amcl_node.cpp) and the owned Nav2 YAML establish the future-dated map transform policy. These source/API checks do not attest installed packages or native behavior.

### RED/GREEN and final tree attribution

All new logs, numeric exit receipts and helper audit scripts are in `evidence-L02/fix1/`. The existing `portable/`, `native-not-run/`, old export and original report bytes were preserved. `run-check.mjs` executes the recorded argv with `spawnSync`, saves stdout/stderr, captures `result.status` directly and returns it. Each receipt contains exact cwd/argv/environment, start/end times, before/after HEAD, committed tree, status, binary diff hash and hashes of changed/untracked file bytes. No trailing command masks the process exit.

- `red-tf.log`: **6 failed, 13 passed**, own exit **1**, before the observer implementation. The actual health guard returned no reason for both stale edges and old provider samples, accepted a static replacement for localization, and accepted a new command after TF expiry.
- `green-tf.log`: **19 passed**, own exit **0**, on the first observer implementation. Additional boundary/result tests and the lock-time sampling adjustment followed; this initial GREEN is not presented as final coverage.
- `initial-cli.log`: **1 passed**, own exit **0**, proving R1's existing path normalization before any CLI production edit (none was made).
- `combined-python.log`: **85 passed**, no skips, own exit **0**, covering all final production Python bytes and final Python test bytes across the six affected engineering/profile/Nav2 suites.
- `combined-ts.log`: **128 passed in 8 files**, no skips, own exit **0**, covering CLI/compiler, lifecycle, evidence, routing, native profile, handoff unit/security seams.
- After that combined run, the only code change was the new CLI test's interpreter discovery, aligned with adjacent tests (`ENGINEERING_PYTHON`, then `.venv/bin/python`, then `python3`, explicit skip if unavailable). `final-cli.log` ran the final test: **1 passed**, no skips. `final-typecheck.log` and `final-focused-lint.log` both exited **0** on these final bytes. No production code changed after the combined checks; no unchanged broad suite was rerun.
- Source typecheck and changed TypeScript/JavaScript lint also passed before that test-only adjustment. `diff-check.log` exited **0**. Full repository lint was intentionally not rerun: the original 27 historical-evidence errors remain retained, root-audited unchanged, and assigned to B10. This is not a full lint pass or a broad CI claim.

`identity-audit.log` / `identities.json` verify that the final committed Python files match the combined Python receipt and the final CLI/helper files match the final CLI/lint/typecheck receipts. The final Source tree is `365ef73ebaa86cf490f8d6d43c54cc604758f916`; the final Lab tree is `a5b06e2e3cb12bc5f744aeb3a994d8868a545a67`. Tests were run on FIX_BASE plus the recorded worktree bytes, then those bytes were committed. This attribution does not falsely claim the later commit existed when the tests ran.

The execution environment was Node **v24.22.2**, pnpm **10.32.1**, portable Python **3.11.15**, `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_ADDOPTS='-p no:cacheprovider'`, `ENGINEERING_PYTHON=<Source>/.venv-irsim/bin/python`, and `PYTHONPATH=<Source>/robotics/simulation:<Source>/robotics/agent:/tmp/l02-python311/lib/python3.11/site-packages`. The isolated dependency directory was reused from the original L02 attempt; no venv, package or profile lock was changed. Native doctor uses actual shell `python3` (**3.15.2** on Darwin), solely for preflight introspection; it is not the portable or target ROS interpreter.

Exact argv and own exits follow. Each row's `.receipt.json` records the full absolute cwd and environment; each `.log` retains its output. All commands below were in Source except the four `lab-*` rows, which were in Lab. Perl bounds are part of the argv; the harness also supplied its recorded millisecond timeout.

| Receipt/log stem | Own exit | Exact process command |
| --- | ---: | --- |
| `red-tf` | 1 | `perl -e 'alarm 170; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q robotics/simulation/tests/test_engineering_native_parity.py` |
| `green-tf` | 0 | `perl -e 'alarm 170; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q robotics/simulation/tests/test_engineering_native_parity.py` |
| `initial-cli` | 0 | `perl -e 'alarm 80; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-cli.test.ts` |
| `combined-ts` | 0 | `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-cli.test.ts tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/engineering-profile-routing.test.ts tests/integration/engineering-compiler.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/integration/lab-v2-native-profile.test.ts` |
| `combined-python` | 0 | `perl -e 'alarm 180; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q robotics/simulation/tests/test_engineering_native_parity.py robotics/simulation/tests/test_engineering_compiler.py robotics/simulation/tests/test_engineering_profile.py robotics/simulation/tests/test_engineering_worker.py robotics/simulation/tests/test_native_profile.py robotics/simulation/tests/test_nav2_session.py` |
| `source-typecheck` | 0 | `perl -e 'alarm 300; exec @ARGV' pnpm typecheck` |
| `focused-lint` | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint tests/integration/engineering-native-cli.test.ts tests/support/engineering-cli-probes.mjs` |
| `final-cli` | 0 | `perl -e 'alarm 80; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-cli.test.ts` |
| `final-typecheck` | 0 | `perl -e 'alarm 300; exec @ARGV' pnpm typecheck` |
| `final-focused-lint` | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint tests/integration/engineering-native-cli.test.ts tests/support/engineering-cli-probes.mjs` |
| `diff-check` | 0 | `git diff --check` |
| `preserve-before-commit` | 0 | `node .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/preserve.mjs` |
| `export` | 0 | `perl -e 'alarm 300; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l02-fix1-runtime-00d41e7-20261115` |
| `lab-import` | 0 | `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/l02-fix1-runtime-00d41e7-20261115` |
| `lab-sync` | 0 | `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs` |
| `lab-check-source` | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm check:source` |
| `lab-typecheck` | 0 | `perl -e 'alarm 180; exec @ARGV' pnpm typecheck` |
| `native-doctor` | 2 | `perl -e 'alarm 80; exec @ARGV' node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-amd64 --json` |
| `native-nominal` | 2 | `perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 3 --out .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/nominal --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case nominal` |
| `native-obstacle` | 2 | `perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 1 --out .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/obstacle --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case obstacle` |
| `native-no-path` | 2 | `perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 1 --out .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/no-path --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case no-path` |
| `native-cancel` | 2 | `perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 1 --out .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/cancel --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case cancel` |
| `native-worker-loss` | 2 | `perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 1 --out .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/worker-loss --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case worker-loss` |
| `native-verify-nominal` | 2 | `perl -e 'alarm 70; exec @ARGV' node scripts/lab-sil.mjs verify --input .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/native-not-run/nominal` |
| `identity-audit` | 0 | `node .superpowers/sdd/03-r3-linux-readiness/evidence-L02/fix1/identity-audit.mjs` |

The only intentional failing check was the retained RED run; native preflights/verifier correctly exited 2. Exploratory read/tool mistakes were not qualification attempts: one lookup used nonexistent config/template paths; one read looked for the Lab importer from Source; an early manifest summary used nonexistent `portableTools` instead of `portableSimulationTools`; one parallel-call expression had a JavaScript syntax error before any subprocess ran. Each was corrected by a narrow read or valid call. No failed check was overwritten or hidden by a later shell exit.

### Clean commit, export and Lab pin

- Source: **`00d41e7f25ec1294b9bc8e8c81de3d8e1a869316`**, `fix: expire cached engineering transform feedback` (5 files; production change confined to engineering TF observation/health, plus regression tests and runbook).
- Lab: **`82b5f92005673c99ba0d1f434ae4c512800fa75e`**, `chore: pin source runtime 00d41e7` (pin and two regenerated source-commit headers).
- New clean export: **`/tmp/l02-fix1-runtime-00d41e7-20261115`**, manifest `dirty:false`.
- Runtime artifact SHA-256: **`fbca966393c5fdb0216c1e826d16aea133f4632ae7cee514a7de0d04825435c6`**.
- Native tool digest: **`f7236fd861ea3fcdee0364b0a92425c19b06952283f86dd35c05cd3754ea3a59`**, 180 refs.
- Portable tool digest: **`5c58ddfacb92fc52adc7106cbe03f2758a9dd6ee23f4d64686e33803757774d3`**, 237 refs, unchanged.
- Schema hash: **`07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068`**, unchanged.

Export, Lab import, contract sync, `check:source`, and Lab typecheck each exited 0 with own receipts. The identity audit checked both clean Git heads/trees, export/cache manifest agreement, exported/cached runtime hashes, and every native/portable closure ref against actual Source bytes. `fix1/identities.json` records subject, checker, pin, export and case-manifest hashes. No original export was replaced.

### Native outcome and preserved limits

After the new commits/pin, the actual Mac doctor and all five preflights were recorded anew. The observer/subject Source is `00d41e7`; the Lab pin is `82b5f92`. Every case manifest is under `fix1/native-not-run/<case>/run-manifest.json`, binds the new Source commit, and states `status:not_run`, `result:blocked_external`, `accepted:false`, `dynamics:not_calibrated`:

| Case | Requested seeds/repeats | Native execution | Own preflight exit |
| --- | --- | --- | ---: |
| nominal | 17,18,19 / 3 | not_run | 2 |
| obstacle | 17 / 1 | not_run | 2 |
| no-path | 17 / 1 | not_run | 2 |
| cancel | 17 / 1 | not_run | 2 |
| worker-loss | 17 / 1 | not_run | 2 |

The nominal verifier also exited 2 and printed NOT_RUN. Linux, compiler dependencies in native Python, ROS 2/Gazebo and resolved environment inventory are absent. No native compilation/launch/campaign/bag capture was started by these commands. Neither engineering package/plugin lock changed; native readiness and acceptance remain false. Actual installation, native startup/physical readback, real TF timing and topology, the required native nominal/fault matrix, shutdown/bag recovery, independent ROS replay, and G-NATIVE-AMR / DEP-NAV-01–04/SEC-01 remain unqualified. Whole-branch CI remains B10/L06 work.

R85 canonical source/profile provenance, fixed native mapping manifests, original CLI, and both architecture locks are byte-identical to FIX_BASE. The original **25,692-byte** report prefix still hashes to **`6fd0359cda1e0a09b24ecd73deb8fc2ac57bf1b40f7ad876ee400a123ac1e1c1`**. `preserve-before-commit.log` verified all **86** original evidence-file hashes; a post-append preservation receipt is retained separately. No old logs/report bytes were rewritten. No helpers, native/Docker/cloud/hardware operation, main merge, push, deployment, operational port change or human acceptance signature occurred.
