# Model conventions — `models/puma560-reference`

Reference model for the LinuxCNC controller package. It is the LinuxCNC 2.9 sample PUMA 560 (`configs/sim/axis/vismach/puma`, last touched by commit `135b0ce5220bef8f8a34b6825723108b8b9740f1`, 2021-06-20), pinned verbatim. It is **not** a MEKONIQ robot: `mekoniqRobotCode` is null, `referenceOnly` is true, and every mechanical field the sample does not carry (payload, gear ratio, brake, encoder, mass, inertia) stays `unknown` with a reason. Reach and joint limits here are controller test inputs, never coffee-counter numbers.

## Convention

- Modified DH after Craig, the convention `genserkins` implements (`go_dh_pose_convert`): link *i* is `T_i = Rx(alpha_{i-1}) · Tx(a_{i-1}) · Rz(theta_i + thetaOffset_i) · Tz(d_i)`, accumulated from `arm_base`. The HAL pins `genserkins.A-n / ALPHA-n / D-n` carry index `n = i-1`.
- Source units are the sample's: lengths in **inch**, `ALPHA` in **radians** (the sample writes `1.570796326`, which is pinned as written, 7e-10 rad short of π/2), joint commands/feedback and limits in **degrees** (INI `LINEAR_UNITS = inch`, `ANGULAR_UNITS = deg`, startup `G20`). The bridge converts at the boundary: inch → m ×0.0254, deg → rad ×π/180; conversions are tested both ways. Nothing is converted by editing a single INI line while keeping the rest.
- SI output at the Lab boundary: m, rad, s. Poses are `{position, quaternionXyzw}`, quaternion `[x, y, z, w]` normalised with `w ≥ 0`, frame id and timestamp attached. A six-number array without joint names or units is not a valid message.
- Joint order `J1..J6` = LinuxCNC `JOINT_0..JOINT_5`; axis signs all +1; zero offsets 0. `JOINT_4` (J5) homes at 0.1° in the sample to dodge the inverse-kinematics failure at the wrist singularity: that is a reminder to test singularities, not a safety measure.
- Frames: `world → cell_base → arm_base → link_1..6 → flange → tcp`. `cell_base` in the world is a calibration input (`armCollisionProfile.baseInMap` of a project), unknown here; without a revisioned calibration the world overlay is unavailable rather than guessed. `tcp = flange` (`tool-0-notool`); gripper/cup capsules are checker inputs, not this frame.

## Files

| File | Content | Hash |
|---|---|---|
| `manifest.json` | origin, convention, units, joint map/sign/offset, home, frames, reach bound, tolerances, unknown fields, hashes of the other files | the manifest hashes the files below |
| `modified-dh.json` | the six joints: alpha (rad), a and d (inch), thetaOffset, limits/velocity/acceleration (deg) from the INI, home | `manifest.hashes` |
| `frames.json` | frame tree, tool revision, calibration state | `manifest.hashes` |
| `reference-poses.json` | FK oracle cases: nominal, unit conversion, near singularity, unreachable, joint limit | `manifest.hashes` |
| `origin/puma560_dh.hal` | vendored sample text (upstream bytes not verified byte-for-byte) | `origin.files[].vendoredSha256` |

## Oracle and tolerances

`tests/test_model_units.py` holds an **independent** forward kinematics (4×4 homogeneous matrices, Shepperd quaternion extraction) that produced the expected values in `reference-poses.json`; the implementation under test is the quaternion-chain FK shared by the Lab (`arm-kinematics.ts`) and the plan 02 checker (`robotics/simulation/collision/arm_swept_path.py`). Both must agree within the fixture tolerances `fkPositionM 1e-6`, `fkAngleRad 1e-6`; IK residual tolerances `ikPositionM 0.001`, `ikAngleRad 0.0087266463` are recorded for A05. These are fixture numbers, not mechanical accuracy or repeatability. The near-singularity indicator (`|sin q5| < 0.05`; Jacobian rank < 6 at `q5 = 0`) is a fixture rule, not a controller policy. The unreachable case uses the conservative reach sphere `sum(|a| + |d|) + |tool|`, not the real workspace.

The Lab's plan 01 mock table (`PUMA560_REFERENCE` in `arm-kinematics.ts`, revision `bd57344f…`) has different numbers and remains the `mock_kinematic` model of mock mode; it is named in the manifest so evidence never confuses the two revisions.

Run: `python3 -m unittest discover -s tests -p 'test_model_units.py'` from `source/integrations/arm-controller/` (needs `rfc8785` for the checker import; CI runs the same tests under pytest).
