# L02 review 1 — spec compliance and task quality

## Verdicts

- **Spec compliance: CHANGES REQUIRED for the prepared implementation.** The distinct canonical engineering factory, source-versus-target profile binding, real launch/observer/reader code, and fail-closed unresolved-host admission are present. However, the documented canonical command cannot reach compilation with its relative project path, and the live TF guard does not enforce TF freshness. Native qualification remains **not_run / blocked_external**, independently of these code findings; the full L02 native acceptance requirements are not satisfied.
- **Task quality: CHANGES REQUIRED.** Two Important findings below block approval. No Critical or separate Minor findings identified. The test and evidence reporting is candid, and the pin/identity handoff is well supported, but the new tests do not exercise either failing seam.
- **Native gate verdict: NOT QUALIFIED.** No recommendation to close DEP-NAV-01–04/SEC-01 or G-NATIVE-AMR. No hardware or commissioning claim is supported.

## Scope and basis

Reviewed the binding task brief including R78/R85, complete implementer report and both audit appendices, root handoff/byte/historical-lint audits, and the supplied complete original-base diff packages:

- Source `874d05aedfbf573496994fd73016f19ef19e6932` → `e6db696b2ac1266fdeede8c2a64521cd4064481a` (package SHA-256 `4b79e8bcfd6b03b59cc94b6f6b8f2a82b7a373ab60642cd175ca84c6b65b541e`).
- Lab `4a207b43c613cf0c1226a9ff3c1990a96ec5ac08` → `7652851fb9e92e560c70e4e6675b85fa5f445cf4` (package SHA-256 `7890df02663a4c990dc20922cf6af5ee5b5c22e918d01b08980460567f8da2e3`).

This is the task-scoped L02 review, including changed shared seams, not a repeated L01 or whole-branch review. Files in findings are relative to the Source worktree. No code, index, HEAD, pin, or evidence was changed. Only this report was written. No helpers, suite reruns, native/ROS/Gazebo/container/cloud/hardware execution, or historical SQLite access occurred.

The diff packages were read in bounded sections. A truncated display was followed by a narrow continuation read. Outside-diff reads were limited to named inherited-path risks: `nav2_session.py` and `nav2_rclpy.py`/`nav2_adapter.py` for startup, observation, localization and health semantics; `scene_loop.py` for observation receipt freshness and whether it compensates for the new TF guard; `robotics/navigation/launch/navigation.launch.py` and its parameter YAML for actual consumed namespaced launch configuration; `compiler/description.py` for the physical description serialization consumed by the new compiler. Narrow line-number reads identify finding locations. These are source inspection, not execution proof.

## Findings

### L02-R1 — Important — Resolve the engineering project path before changing the compiler working directory

**Location:** `scripts/lab-sil.mjs:124` and `scripts/lab-sil.mjs:127`; affected published command: `docs/operations/engineering-native-navigation.md:28`.

The engineering branch assigns `fixture = o['engineering-project']` unchanged, then invokes `python3 -m compiler.engineering_native --project <fixture>` with `cwd: SIM`, where SIM is `<source>/robotics/simulation`. The preceding existence check interprets the same option in the caller's working directory. Consequently, the R85/runbook invocation from Source with `--engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json` passes existence checking but the compiler tries to open `<source>/robotics/simulation/robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json`. Its `Path(args.project).read_text()` fails before the native bundle exists. This is deterministic even on a fully qualified host.

The legacy path uses an absolute fixture path; the actual-compiler integration test also explicitly supplies `resolve(...)`, so neither covers this public CLI seam. The actual Mac preflight attempts stopped before compilation and cannot reveal it.

**Required correction:** Resolve the engineering input against the caller's directory before passing it to a child with a different cwd; preserve that same identity through CLI arguments. Add a focused portable regression for the documented relative input and its absolute equivalent at the orchestration/argument boundary, without invoking native services. Do not weaken prerequisite admission to test it.

### L02-R2 — Important — A cached TF chain is accepted indefinitely as current feedback

**Location:** `robotics/simulation/bridge/engineering_session.py:91`–`94`; affected command/result guards: the same file's `EngineeringNav2Session.execute()` and `query()`.

The new health guard calls only `self._tf.can_transform(target, source, Time())`. A zero time requests the latest cached transform; it does not assert that the dynamic map-to-base chain is recent. Unlike scan and joint samples directly above it, TF has no provider timestamp or monotonic receipt age check. With `/clock`, scan, and joint traffic still live, stopping a dynamic TF publisher after one valid chain can leave this check true. The inherited Nav2 readiness probe checks lifecycle state, map identity and a cached AMCL pose/covariance, also without an observation age check, so it does not repair this gap. New commands and query results can therefore pass the engineering health boundary using stale spatial feedback.

This is a missing prepared-path refusal, not just an unperformed native experiment. The requirement and report describe strict TF/feedback freshness. The test named `test_native_protocol_refuses_stale_tf_and_keeps_lost_ack_unknown` supplies `TF_MISSING` directly through `FakePorts.health_reasons`; it verifies the consumer of a reported failure, not whether `EngineeringRosPorts` detects stale TF. Bag coverage of the aggregate `/amr_1/tf` topic also cannot ensure that each required dynamic edge was refreshed while other joint TF messages continue.

**Required correction:** Validate the relevant dynamic TF chain against actual provider time and a bounded receipt policy, with a distinct treatment for legitimately static sensor transforms. Latch a reason when the dynamic transform expires, refuse new effects/results through the existing unknown/no-resend boundary, and add portable tests of the actual engineering health guard with a cached-but-stale dynamic transform while the other streams remain fresh. Keep missing-TF, static-TF, clock-reset and no-resend behavior covered.

**Primary compatibility source:** Jazzy's official [`tf2_ros.buffer.Buffer.can_transform` implementation](https://raw.githubusercontent.com/ros2/geometry2/jazzy/tf2_ros_py/tf2_ros/buffer.py), especially its zero-time semantics and call to `can_transform_core`. The docs.ros.org API page returned Access Denied; official upstream source was used instead. This source establishes API semantics, not installed-host behavior.

## Strengths and requirement assessment

- **R85 identity is respected.** The native compiler accepts the exact canonical project, navigation scene and physical model, retains source documents including the original requested profile, and emits a separate `engineering-gazebo-canonical-v1` target mapping for `engineering-rigid-v1` and the two named engineering environment profiles. The frozen manifest and reproduction checks reject altered/resealed output. The old reference fixture is not repurposed, and the existing non-native compiler remains unchanged.
- **A distinct executable path really exists.** The factory routes to an engineering worker and a concrete ROS/Gazebo launch, not to the legacy fixture. Missing engineering profile selection is refused. Source's scenario/journal/dispatcher and scripted confirmations remain the business authority. The native code contains canonical URDF/controller/world/map generation, launch, observations, durable Nav2 command handling, bag recording and offline reading.
- **Unknown host inventory remains unready.** Neither architecture lock is invented or falsely qualified. The inspector reads actual package state, plugin bytes, runtime/overlay identities and apt source files; the report distinguishes consistency from host authenticity. The task's exact package/plugin/install provenance requirements remain pending actual target capture.
- **Clock and ownership design is explicit.** Provider clock maps to 20 ms Source ticks and monotonic receipt watchdogs; reset/stall latches failure. A worker state directory cannot be resumed, and existing command receipts preserve unknown/no-resend semantics. Domain lease, partition, server-owned case/action/topic settings, detached worker group and owned cleanup are concrete code, with native behavior still unobserved.
- **Evidence refuses obvious gaps.** Producer distinction, expected topic presence, actual SQLite timestamp coverage, bounded gaps, artifact hashes and case assessments are implemented. Synthetic SQLite and protocol doubles are clearly described as portable tests. Fault fixtures and case names are fixed; cancel/worker-loss/no-path assessments inspect completion/replay outcomes. Actual native geometry and fault effectiveness are not inferred from those tests.
- **Lab change is a pin only.** The Lab diff updates the source runtime lock and generated source-commit headers. Root's supplied audit ties the clean export, 57 schemas, 180 native and 237 portable closure refs, cache and pin together; I did not duplicate that byte audit. No new Lab-to-hardware route appears.
- **Recorded validation is useful but bounded.** Root reviewed 127 TypeScript and 74 Python test results, with the later focused four-test result separately attributed. Contracts, Source/Lab typechecks and the unmasked focused ESLint exit 0 are retained. Full lint has 27 errors in five unchanged historical evidence files, byte-confirmed by root and assigned to B10. That existing limitation is not a new L02 regression or a full lint pass.

## Cannot verify from this diff / retained evidence

1. **Exact target host/package/plugin qualification and clean installation.** Both engineering locks remain unresolved; Darwin preflight output is not Linux inventory. Actual apt repository/package provenance and native-host authenticity are not established by matching local source-list hashes.
2. **Successful startup and engine compatibility.** No native run proves the launch/controller activation, namespace/TF behavior, stamped velocity path, paused startup, LiDAR/contact publication, ROS discovery or renderer setup. Static source inspection does not close these gates.
3. **Native physical readback and fidelity.** Portable tests inspect generated URDF fields and deterministic bytes. They do not perform Gazebo's SDF conversion/readback of the instantiated links, joints, collider transforms, inertias or sensor frames. Dynamics remain `not_calibrated`; the report explicitly limits contact observation to the base collider. Whole-body/contact qualification remains pending.
4. **Required nominal and fault campaigns.** All five actual case records are `not_run/blocked_external`; nominal requested seeds 17/18/19 but none executed natively. There is no actual upstream/legacy smoke, three-seed nominal result, obstacle/no-path/cancel/worker-loss native outcome, or proof of physical fault placement/effectiveness.
5. **Native shutdown and recovery.** Process-tree teardown, no-orphan behavior, abrupt worker loss, rosbag flush and SQLite backup after actual process death are prepared, not observed. Portable copy tests do not establish native recovery completeness.
6. **Actual bag replay and physical outcome qualification.** The offline reader assesses topic timestamps and coverage; it does not independently decode/replay ROS trajectories or verify numerical/physical agreement. No actual native bag was retained in L02. The report appropriately does not claim independent physical replay.
7. **Whole-branch compatibility and broad CI.** The supplied focused regression results support the changed seams, not a full Source build/test run or whole-branch audit. Historical lint remains a disclosed integration limitation.

The missing assigned native host explains these execution limits. It does not excuse L02-R1 or L02-R2, which are reviewable defects in the prepared path. After correcting them, preparation can be reconsidered separately from the still-open native qualification requirements.
