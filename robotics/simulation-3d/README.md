# Webots 3D plant (`webots_worker`)

The 3D plant behind the shared fixed-step runner. Webots R2025a is a **host install** (never bundled, never installed by a launcher); this directory holds only the code
that talks to it and a hash-locked Python 3.11 venv (`.venv-webots`, `requirements.lock`).

- `webots_worker/compile.py` writes the world (`.wbt`) from a `NavigationSceneV1` (engine `webots_3d`, with `world3d`) and the `RobotPhysicalModelV1` of each robot. Pure and deterministic: same inputs, same bytes. It maps links, joints, inertia and sensors one to one and never goes through URDF. It refuses a model without mass or inertia, a joint other than fixed/continuous, mesh geometry, a path that leaves the bundle, a time step that does not divide 20 ms, a missing `world3d`, and a two-wheel base without a support point ahead of and behind the axle (`NO_THIRD_CONTACT`, it would tip over in 3D).
- `fixtures/serve-3d-v1/` is the Serve robot plus two passive ball casters (`assumed`: 0.035 m radius, 0.15 kg each, mounted so they touch the floor plane the wheels touch) and `world3d.json` (heights and frictions, `assumed`). Regenerate with `pnpm exec tsx scripts/export-sim3d-fixtures.ts`. `robotics/navigation-2d/fixtures/serve-demo-v1` is untouched; IR-SIM keeps using it.
- Wheels are velocity motors named `left_wheel_motor`/`right_wheel_motor` (`..._sensor` for the position sensors) with the joint's velocity and effort limits; the drive's torque-speed curve is not in the physical model, so the torque limit is constant. Every physical value is `assumed`: results are `not_calibrated`.
- The robot links carry collision shapes only (no visual `Shape`), so a Webots LiDAR does not see the robots' own bodies. Whether the other robot must be visible to it is decided in W06/W07 against the engine.

```sh
node scripts/bootstrap-portable-simulation.mjs webots
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=robotics/simulation-3d .venv-webots/bin/python -m pytest robotics/simulation-3d/tests -q
```
