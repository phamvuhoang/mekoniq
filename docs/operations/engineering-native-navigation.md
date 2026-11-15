# Canonical engineering Gazebo/Nav2 preparation (L02)

Under ruling R85, this is an executable **prepared** FD01 AMR path for Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic, and `gz_ros2_control`. It has not run on an assigned native host. It is not a qualification, calibration, hardware commissioning, or a Lab hardware route. Candidate records remain `accepted:false` and `not_calibrated`.

## Subject and mapping

Use the unchanged L00 canonical input at `robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json`, its `navigation-scene.json`, and `physical-model-amr-1.json`. The project’s historical requested profile and portable scene engine identity are preserved. `compiler.engineering_native` writes a separate `engineering-gazebo-canonical-v1` mapping and compiler manifest. It never changes those inputs into a Gazebo scene by relabeling them. FD01 is the Source business scenario; the older `tests/fixtures/engineering/fd01.project.json` describes a different reference robot and is rejected by this mapping.

The compiler preserves physical link/joint identities, SI inertials and colliders, wheel radius/separation, LiDAR parent frame and beam/range/rate model. The canonical world supplies obstacle heights and assumed friction. Gazebo consumes one ros2_control velocity writer per wheel. The launcher fills one verified controller-file placeholder, then starts robot_state_publisher, the Gazebo model, controller spawners, the fixed topic bridge, and the existing simulation navigation launch. Nav2 Twist output is stamped by the worker for the Jazzy diff_drive_controller input. Dynamic motor, current, voltage, contact, and friction calibration remain unverified.

The committed `robotics/simulation/fixtures/engineering-navigation-v1/{compiler-manifest,native-mapping}.json` records reproducible static outputs. The native launcher rebuilds the mapping in a temporary directory and compares the complete manifest before starting processes. The TypeScript factory also checks the committed manifest, every file digest and canonical documents. A resealed but different artifact is refused.

For L00 handoff, retain the original canonical document refs and portable engine lock; additionally attach the native manifest, native mapping, and all manifest outputs with source paths under `robotics/simulation/fixtures/engineering-navigation-v1/`. The document validator distinguishes a missing mapping, incomplete native artifact closure, and unresolved native environment profile. Mapping preparation alone never sets native readiness.

## Host qualification prerequisites

The shipped `engineering-amd64` and `engineering-arm64` locks deliberately retain `qualification:not_run`, `packages:null`, and `digests:null`. Only capture and update the architecture actually installed on an assigned host. Do not copy inventory from a container or another architecture.

After clean installation on the assigned host, record `python3 -m bridge.native_profile --profile engineering-amd64` from `robotics/simulation`. The inspector reads installed dpkg versions, hashes every absolute plugin path in the lock’s `digests`, fingerprints `ros2`, `gz`, and distro Python, ROS prefixes and overlays, Python/library/plugin paths, and apt source files. A future qualified lock must bind these actual values through `packages`, `digests`, `runtimePin`, and `aptProvenance`. Preserve forbidden packages. Actual package repository Release/package provenance and the native-host provenance record must also meet L00’s native_apt handoff requirements; this local consistency inspection is not host authenticity.

Required software includes the existing engineering required packages, the SQLite rosbag2 storage plugin, robot_state_publisher, rclpy/tf2_ros, the source navigation package, and the source worker/compiler dependencies. No invented package versions or plugin digests are supplied here. ROS uses its distro Python; portable tests use Python 3.11.

## Prepared execution

Commit Source changes, export a clean runtime, import/sync/check/typecheck Lab, and commit the Lab pin before recording a native case. Use a unique output directory, and preserve failed attempts. On the qualified native host:

```sh
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-amd64 --json
perl -e 'alarm 1800; exec @ARGV' node scripts/lab-sil.mjs run \
  --scenario FD01 --seed 17 --repeat 3 --out "$native_evidence_dir" \
  --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 \
  --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json
node scripts/lab-sil.mjs verify --input "$native_evidence_dir"
```

The engineering repeats use seeds 17, 18, 19. These seeds drive Source scripted timing, not a claim of deterministic ROS/Gazebo physics. The native factory consumes the compiled bundle and server-selected engineering environment profile. No topic, action, executable, or launch option is accepted from a project.

Run upstream/legacy smoke separately before these cases. Native nominal, obstacle/no-path, cancellation and worker-loss cases remain `not_run` here. Protocol tests exercise their command outcomes; they are not plant evidence. Use `--engineering-case obstacle`, `no-path`, `cancel`, or `worker-loss` with a unique output directory per case. The server fixes each case: a blocker on the first kitchen route, four barriers around the kitchen target, cancel after the first accepted goal, or abrupt loss of the owned worker. Negative cases require explicit attention, zero served/completed outcomes and no command replay. Native campaign evidence remains required before DEP-NAV-01–04/SEC-01 or G-NATIVE-AMR is proposed.

## Ownership, time and evidence

Each run owns a worker process group, a ROS domain lease in 101–200, a run-specific GZ partition and localhost-only ROS transport. It refuses a nonempty ROS graph and an existing worker state directory. A worker exit triggers cleanup of its owned group. Normal shutdown stops the owned launch, flushes the bag, and writes shutdown blockers. Source issues business commands and confirmations; Gazebo produces observations only. A lost acknowledgement stays unknown with its original durable command receipt. The worker is never restarted to continue the run.

The world starts paused; startup enables simulation integration for controllers, TF, sensors and localization to initialize. Business dispatch waits for live prerequisites. `clockMapping` records provider nanoseconds, source logical tick (20 ms), and monotonic receipt time. A reset or stale clock latches failure; TF, scan and joint freshness checks refuse commands/results when observation quality is insufficient. The fixed-step portable runners are unchanged.

The TF observer records each required edge when TransformListener writes it into the buffer. Both dynamic edges (`map` → `odom`, `odom` → `chassis/base`) require a receipt within 500 ms and a provider timestamp no more than 500 ms behind `/clock`. AMCL's owned configuration postdates `map` → `odom` by up to one second; the odometry edge permits at most 500 ms ahead. Future dating never extends the receipt deadline. Unrelated wheel TF cannot refresh these deadlines. The fixed `chassis/base` → `lidar/head` edge must arrive through the static listener and does not expire. Missing, stale or wrong-kind edges block readiness; a failure after readiness latches, makes results unknown and rejects new commands. Existing command receipts still prevent resends. These checks are covered with portable ROS transport doubles; their timing on an assigned native host remains unqualified.

`native-events.jsonl` contains normalized trajectory, contact, joint, LiDAR and clock observations; nonfinite LiDAR no-return values become null with an explicit policy. `native-commands.json` retains the durable Nav2 goal receipts. Source `journal.json`, `effects.json`, assertions and telemetry remain authoritative for business outcomes. Inventory, shutdown, event/command files and finalized rosbag copies have artifact hashes. A rosbag is recorded with simulation timestamps and an explicit topic allowlist. The recorder’s original files stay in `.native/raw-bag`; `rosbag2/` is a byte-verified finalized copy for retention/replay. After the deliberate worker-loss case, the parent uses a read-only SQLite backup and checks the message-content digest before retaining the recovered copy; it never treats missing recovery data as a pass.

Offline verification rereads actual SQLite topic timestamps rather than accepting `metadata.yaml`. Every expected topic must contain messages; continuous clock/TF/odom/joints/scan/pose/contact topics must cover the run with no gap over 500 ms. Static TF and event-driven command/action/AMCL topics require presence. Missing/partial bags produce `not_run`. Full decoding/independent physical trajectory assertions on an assigned native host remain required for qualification; this portable verifier does not attest host authenticity.

## API references used

- [Jazzy gz_ros2_control](https://control.ros.org/jazzy/doc/gz_ros2_control/doc/index.html): Harmonic pairing, system plugin, controller manager and ROS namespace/remapping.
- [Jazzy diff_drive_controller](https://control.ros.org/jazzy/doc/ros2_controllers/diff_drive_controller/doc/userdoc.html): TwistStamped input, wheel interfaces and timeout.
- [Jazzy rosbag2 record implementation](https://github.com/ros2/rosbag2/blob/jazzy/ros2bag/ros2bag/verb/record.py): explicit topics, hidden topics, SQLite storage and simulation timestamps.
- [Jazzy TF listener implementation](https://github.com/ros2/geometry2/blob/jazzy/tf2_ros_py/tf2_ros/transform_listener.py): TF topic remapping is on the node; the constructor has no `tf_topic` keyword.
- [Jazzy Nav2 defaults](https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_bringup/params/nav2_params.yaml): map/base/odom frames and navigation parameter structure.

These are versioned upstream API references, not exact installed package/plugin locks.
