# MuJoCo mobility measurement spike — B02a

2026-11-14. **Uncalibrated software measurement; accepted:false.** MuJoCo 3.17.0, Python 3.11.15, arm64/macOS. This is the compiler/worker measurement slice; it does not close G-MJ1, device/native gates, payload safety, commissioning or a campaign.

## Frozen inputs and method

`robotics/simulation-mujoco/fixtures/serve-payload-v1` retains canonical Serve model bytes (`physical-model-amr-1.json` SHA-256 `830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9`), wheel radius 0.09 m, separation 0.36 m, fixed sphere casters and free chassis roll/pitch. Every canonical link mass/COM/full inertia, collider pose/size and wheel axis is checked against the actual MjModel. Inertia readback rotates principal moments back into model axes. The cup is a free 0.32 kg solid cylinder, radius 0.04 m/height 0.1 m, at the unchanged lower tray top (center or +0.05 m tray y); no welds or pose correction.

Numerical inputs were frozen **before** `b02a-locked`: profile digest `1ef1c4de61894e35e89fbbc8cb534c184ef66944e40fed60dedf496f81956480`, numerical-input SHA `c29fe1c6cde3923b31a1b5093d81f3c552bf3c5a3f394c674c0e528079f0396f`. No drive/contact tuning was needed. The lock describes inputs, while the result references their exact byte hashes; no profile hashes its future result. `requiresB02MeasurementLock:false` means the numerical candidate is locked; the measurement result is checked separately, with `status:locked_not_calibrated` deliberately making no calibration claim.

- 20 ms logical tick = 10 substeps × 2 ms; implicitfast, Newton solver, 100 iterations, tolerance 1e-8, gravity [0,0,-9.81] m/s². Contact condim 6, solref [0.02,1], solimp [0.9,0.95,0.001]; remaining engine options use the pinned 3.17.0 defaults.
- Wheel velocity gain 2 Nm s/rad; motoring envelope (0 rad/s,6 Nm), (10,6), (20,0), interpolated from **actual** wheel velocity every substep. Braking uses a separate 6 Nm cap opposing actual motion. Servo targets are bounded by the canonical ±20 rad/s; actual actuator force and clipped-demand substep count are recorded. There is no ideal velocity overwrite.
- Generic contact [0.6,0.005,0.0001] (sliding/torsional/rolling), floor sliding 0.8. Wheel-floor contact therefore uses max=0.8. Explicit caster-floor pairs use [0.02,0.02,0,0,0], avoiding max-mixing with the floor. Fixed caster spheres are a declared **sliding support approximation**, not freely swivelling canonical caster joints. Robot self-contact is masked because canonical connected parts overlap; robot-world, robot-payload and payload-world contacts remain active.
- Independent LiDAR uses `mj_ray` against engine geometry at the actual sensor pose; robot geom group 1 is filtered from its own rays. Wheel odometry integrates wheel angle increments through radius/separation and exact differential-drive arcs, with unwrapped yaw, and receives no truth correction. Loads are measured in their support frame, which remains the declared reference even after loss of contact; `restingOn` separately requires final-state contact and small relative velocity.

MuJoCo combines equal-priority geom friction componentwise by max; explicit pairs override it. See [3.17 contact parameters](https://mujoco.readthedocs.io/en/3.17.0/modeling.html#contact-parameters). Contact-frame axes are rows, so forces transform to map using the transpose; canonical pairs are ascending and force is on side b. Positive normal is geom1→geom2. See [contact force API](https://mujoco.readthedocs.io/en/3.17.0/programming/simulation.html#contacts) and [contact pair convention](https://mujoco.readthedocs.io/en/3.17.0/XMLreference.html#contact-pair). Tests independently check gravity balance, sign, multiple-point summation and actual caster friction.

The final probe is 36 bounded runs: empty/center/offset × hold/straight/circle/stop × 3 repeats at seed 7. Each is 500 logical ticks/10 s, with create-style tick-zero priming semantics (engine time=(tick+1)×20 ms). Hold is all zero commands for the full 10 s. Other cases hold 2 s, ramp over 1 s, then straight 0.2 m/s or circle 0.2 m/s + 0.4 rad/s until tick 400; the stop case ramps to 0.5 m/s then requests zero at tick 300. Final targets stay zero. Stop distance is actual XY path length from the first zero-target tick through five consecutive samples below 0.01 m/s and 0.02 rad/s; hold has no stop-distance measurement.

Every final run names the actual per-load navigation scene, its sealed sceneDigest, the load byte hash, the exact locked physics profile and actual engine model readback. All 500 tick records are retained, including commands, engine clock, chassis pose/twist, payload map/support poses, wheel angle/velocity/force/target/saturation, odometry and all-substep contact aggregates. Contact samples count substeps, not contact points; points of a pair are summed before peak/impulse calculations. LiDAR arrays are omitted from these measurement files to bound size; independent engine-raycast behavior has a focused test. This is not an evidence recorder or qualification format.

## Observed results

All 36 final runs remained finite, without bad-state warnings. Every chassis and payload pose at **every tick**, not only endpoints, was compared against the first repeat. Maximum position-coordinate difference: 0 m. Maximum quaternion relative-angle difference: 9.884312124119402e-8 rad (floating-point dot/arccos roundoff on identical orientations), below the declared 1e-6 m/rad threshold. No raw state or odometry is corrected to achieve repeatability.

The table shows repeat 1; full timing/metrics for all repeats are in the summary. Host p95 measures Python engine step plus observations (LiDAR on publish ticks); it is not a realtime guarantee. Payload displacement is XY distance from the pre-step initial pose in the tray frame. Tilt is max absolute roll or pitch. Odometry residual is max actual-drive versus independent wheel-integrated pose error; yaw differences are wrapped.

| Load | Case | Max tilt rad | Max tray shift m | Max odom m / rad | Stop path m | Saturated substeps | Step p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|
| empty | hold | 5.11735e-06 | n/a | 1.5173e-06 / 3.63739e-16 | n/a | 0 | 1.799 |
| empty | straight | 0.000179028 | n/a | 0.0371588 / 3.86042e-14 | 0.00624605 | 0 | 1.748 |
| empty | circle | 0.000269669 | n/a | 0.134036 / 0.2699 | 0.00898484 | 0 | 1.754 |
| empty | stop | 0.000218674 | n/a | 0.048387 / 7.26225e-15 | 0.0316692 | 3 | 1.771 |
| cup-center | hold | 1.2735e-08 | 2.27048e-06 | 1.26187e-09 / 2.50554e-10 | n/a | 0 | 2.160 |
| cup-center | straight | 0.000431646 | 0.00224827 | 0.0712595 / 0.0065364 | 0.0102793 | 0 | 2.239 |
| cup-center | circle | 0.000319315 | 0.000985189 | 0.127232 / 0.253768 | 0.0138165 | 0 | 2.291 |
| cup-center | stop | 0.000963845 | 0.00411354 | 0.0661814 / 0.0175763 | 0.0492981 | 12 | 2.245 |
| cup-offset | hold | 1.44489e-06 | 2.21041e-06 | 1.30152e-07 / 4.19719e-09 | n/a | 0 | 2.013 |
| cup-offset | straight | 0.000456836 | 0.00234603 | 0.0709849 / 0.0143515 | 0.0150011 | 0 | 2.376 |
| cup-offset | circle | 0.000284746 | 0.00121757 | 0.137063 / 0.264922 | 0.00987527 | 0 | 2.393 |
| cup-offset | stop | 0.000819413 | 0.00440815 | 0.0883154 / 0.0424491 | 0.0505259 | 9 | 2.209 |

Largest observed tray shift is 0.00440815 m (offset stop); largest tilt is 0.000963845 rad (center stop). The circle produces up to 0.137063 m and 0.269900 rad wheel-odometry residual. This is a real discrepancy in the fixed-caster/contact fixture; it is retained as observed drag/slip, not silently removed or called localization accuracy. These results do not establish a rated load or calibrated friction/braking curve. No failing finite-state or load-fall case occurred in these bounded probes; stress/fault campaign cases remain subsequent work.

## Artifacts and identity caveat

- Final admitted-input results: [`mujoco-mobility-spike/b02a-locked/summary.json`](mujoco-mobility-spike/b02a-locked/summary.json), SHA-256 `d0e2453711b4f676de5d546ccb29247d1339bc65592f32b6338c93917b1174f5`. It indexes all 36 raw gzip NDJSON byte hashes/sizes and the repeat results. About 12 MB compressed, with no tick gaps; the full set including exploratory data is about 24 MB.
- Exploratory data is preserved under `b02a-initial/`. Those direct-compiler runs passed the correct physical empty/offset loads but retained a center-load scene ref. Their raw actual-load hashes/numerical values are recorded, but their navigation identity is inconsistent. **They do not close the measurement lock or a gate.** The discovered mismatch led to a negative compiler test, per-load scene sealing and the complete final rerun. Initial summary bytes are retained unchanged for auditability.
- Reproduce without overwriting either set: `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 240; exec @ARGV' .venv-mujoco/bin/python robotics/simulation-mujoco/probe_mobile.py --out <new-dir>`. Existing output directories are refused.

Admission verifies closed schemas, confined nonsymlink paths, every stored file byte hash/size, document/profile digests and projection/model identity before constructing the engine. Direct compilation also checks profile identity, canonical support geometry, clock, axes and effort/speed limits; the session supplies already byte-verified documents. Any initial penetration below -1e-6 m is refused before stepping. No unsupported actor/noise/mesh fallback is offered. Mobile commands are validated before stepping; engine bad-state warnings, nonfinite state, clock drift or contact-capacity overflow terminate the run.

B02b still owns TypeScript provider/runtime admission, shared engine slot, readiness, CLI and runner integration; B03 owns durable campaign records/metrics and evidence gaps. Arm compilation and arm session behavior remain separate. This measurement does not advertise a mobile provider, modify Lab, run hardware or deploy.
