# Serve payload fixture v1

Generate with `node scripts/generate-payload-fixture.mjs [out-dir]`. Inputs are the committed canonical Serve components, project, physical projection and world3d, plus R2a xArm cell-layout cup dimensions. Copied files retain their original byte hashes and projection schema hash. Profile digest excludes its own digest; sceneDigest excludes itself; refs hash bytes.

Three profiles use the lower tray: empty, a centered 0.32 kg solid-cylinder cup and the same cup offset +0.05 m in tray y. Cylinder height 0.1 m/radius 0.04 m; COM at geometric center, inertia derived as a solid cylinder. SI units; pose quaternion xyzw; support polygon in local tray XY. Free payloads are never welded. Dynamics and contact are not_calibrated.

Gain 2 N m s/rad, brake 6 Nm and the drive curve are explicit starting assumptions requiring measurement and lock in B02 before campaigns. The 6 Nm/20 rad/s axle endpoints come from assumed canonical Serve inputs, not a motor datasheet. Friction/solver are assumed.

Dock report compares exact tray transforms with the R2a fixed tray. Legacy waypoints do not match mobile tray height. Proposed dock and new placement/approach targets are unapplied; xArm IK residuals/condition/limits are recorded at the unchanged arm base. AMR/arm sweep remains not_run and cell remains blocked. AMR-only work may continue. This fixture does not enable a runtime backend.
