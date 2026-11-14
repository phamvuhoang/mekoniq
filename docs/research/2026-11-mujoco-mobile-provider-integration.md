# MuJoCo mobile provider integration — 2026-11-14

This is B02b software integration evidence, not a mobility qualification or a hardware safety claim. It starts from reviewed source `eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc`. The B02a physics lock, raw probes, canonical Serve fixtures and MuJoCo 3.17.0 dependency lock remain unchanged.

## Inputs and bounded scope

The new `engineering-mujoco-3d-v1` compiler derives an explicit new engineering project digest. It does not rewrite the canonical Webots-requesting Serve project. It admits one AMR whose mechanical/sensor projection matches the registered Serve model, defaulting to the center cup. Different mechanics, extra entities, actors and noisy sensors are unsupported. The physical model's input identity is projected from the new project, then the load's `modelRef` is rebound to those exact bytes and its digest resealed. All model, load, assumption, controller and stop-policy bytes enter `scene.files` before the final scene hash.

Reference byte SHA-256 identities:

- Canonical physical model: `830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9`.
- Unchanged numerical drive/contact profile: `9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3`.
- MuJoCo worker lock: `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84`.
- New `serve-mobile-stop-v1` revision 1 document: `a7d4495eaa110bc617c8ca0ecc4ef78fa1bc7a54e89a3d24041efc3e5072281c`.
- New `serve-mobile-controller-v1` revision 1 document: `2a2909801f809ea9d76e122c4b1a2104afbcdeccbf467767198a217fad2513eb`.

The policy documents are server-owned constants serialized by the compiler; runtime admission accepts their complete content only. Their refs are explicit in the navigation scene and report engine identity. A future registered experiment must create a distinct input identity. No browser request accepts paths or raw dynamics/controller values.

## Observed controller stall and correction

The first real dispatcher run of MJ-FD01, seed 7, stopped with `NO_PROGRESS` at tick 493. The original controller ramps each command from measured body velocity. With the locked fixed-caster plant, each tiny angular increment remained below the command needed to overcome modeled friction. It repeatedly restarted the ramp from almost zero instead of accumulating its command.

At tick 300:

| Quantity | Value |
| --- | --- |
| Sent body velocity `[v,w]` | `[0, -0.030627171957019812]` m/s, rad/s |
| Observed body velocity `[v,w]` | `[8.433340475180356e-9, -0.0006272467326130541]` |
| Left/right wheel target | `[0.061254343914039625, -0.061254343914039625]` rad/s |
| Left/right actual wheel velocity | `[0.0030580563808212083, -0.0030583581220740607]` rad/s |
| Left/right actuator torque | `[0.11639257506643683, -0.11639197158393112]` N·m |
| Saturated substeps | `0` |

Ticks 250, 350 and 400 showed the same equilibrium. The angular acceleration limit is 1.5 rad/s², hence each 20 ms tick adds only 0.03 rad/s to the near-zero observed velocity. No contact, gain, brake, torque or solver parameter was changed to conceal this behavior.

The controller approved a mobile-only correction, `grid-diff-v1` version `2+mujoco-sent-ramp-v1`: acceleration limiting uses the previous sent command per robot. That state starts at zero on a new run, survives goal changes and pause/resume, and tracks every emitted command, including explicit terminal zeros. Cancel/idle targets ramp toward zero. Lost/refused steps end the run; there is no retry or resumed command state after an uncertain step. Actual measured velocity still governs arrival/stopped checks, obstacle stopping distance and progress. Legacy IR-SIM/Webots callers retain controller version 2 and measured-velocity ramp behavior.

A focused stiction regression holds observed velocity at zero and checks commands `[0.03,0.06,0.09]` rad/s across three ticks, cancellation back to 0.06, and continuity into the next goal. The unchanged legacy default produces `[0.03,0.03,0.03]`. This new command behavior is not a claim of equivalence to a physical robot controller; later B08 equivalence work must account for it.

## Real completed source-driven mission

On macOS arm64, Python 3.11.15 and MuJoCo 3.17.0, the real MJ-FD01 seed-7 run completes at tick **3443**, with **one served order** and parking complete. It goes through the engineering service, provider describe/create, shared dispatcher, production source journal, fixed-step runner and real Python worker. Repeated focused verification reproduced the same normalized digests.

- Compiled navigation scene digest: `ff01c15980dbd6b10ac50988353ae11537255d26d8b0b5ce4e339ff34f575884`.
- Derived center-load byte SHA: `493778590f0e6eef07c5482ec645d4f561232adfee45a3ea9ade0c1eca9a5cad`.
- Trajectory digest: `def1455d28b3d8dc653327ff06de8effb5412fdfea2dfc5d4af83f547895861b`.
- Sensor digest: `32c1982ac92b9c43754a00c4cd8edb075abb76f91c4830785790ddda77a02b90`.
- Assertion digest: `5986b2aa09480aebec7e32768071f106a406a21843879a90a8cdb24815dd0898`.

These digests use the test's explicit `sourceCommit: test-commit` identity, not a qualification candidate. The source journal's Robot.Observe payload names `mujoco_serve_diff_drive`; mobile live AMR samples use `physics_sim`. Arrival alone never marks cargo loaded or served: source domain confirmations remain the authority.

## Observation and lifecycle seams

The mobile worker publishes noiseless LiDAR every five ticks and caches the last publication between them. Mobile recorder admission requires exactly `floor(snapshot.tick / publishEveryTicks) * publishEveryTicks`, matching sensor/robot/frame identity and publication `simTimeNs`. Only actual publication ticks are persisted. Missing, stale, future or mistimed scans are refused. Legacy recorder bytes and admission remain unchanged. `mujoco-identity-seed-v1` records the existing deterministic unsigned-32 derivation, but the seed has identity-only meaning: this worker uses no stochastic engine, sensor noise or actors, and the report does not claim a NumPy engine RNG.

The source observation policy stops at absolute roll/pitch **greater than π/4** with `BASE_TIPPED`. Nonfinite state or height outside the initial rest height's −0.6/+4 wheel-radius bounds (floor-clamped lower reference) is `PLANT_UNSTABLE`. A free load whose observed tray-relative center drops **at least 0.10 m below its profile's initial center for five consecutive observed logical ticks** is `LOAD_FELL`. Missing physics, wrong clock, missing load or changed support frame is `PHYSICS_OBSERVATION_INVALID`, never proof of a fall. These are uncalibrated experiment cutoffs, not safety ratings.

Arm, mobile and future cell compositions use one shared MuJoCo engine slot. Readiness create probes reserve that slot and share an exclusive smoke gate; a blocked probe cannot coexist with another world. Arm/mobile keep their slots until worker close completes. Contact-capacity exhaustion is a fatal potentially-post-advancement error: an unverified step records a gap and becomes unknown, never a safe-to-retry admission refusal.

B03 still owns durable physics streams, physics coverage, sustained support/custody windows and campaign metrics. Instantaneous `restingOn` does not prove receipt or delivery. This integration does not close G-MJ1, native/device/hardware gates, or human acceptance.
