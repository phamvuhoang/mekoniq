# Drive fixtures v1

Generate with `node scripts/generate-drive-fixture.mjs [out-dir]`. Inputs are the committed Serve physics profile and physical model, the xArm 6 physics and component, and the V01 spike output (docs/research/virtual-drive-spike/results.json).

- `serve-drive-{ideal,nominal,torque-limited,latency,coarse-encoder}-v1.json`, `xarm6-drive-{ideal,nominal}-v1.json`: DriveModelV1, the device. `ideal` has no quantisation, no delay, no watchdog and no enable sequence.
- `serve-control-v1.json`, `xarm6-control-v1.json`: ControlProfileV1, the tuning. Gains equal the R2b gains (wheel kp = velocityGainNmsPerRad, joint kp/kd = physics kp/kv, every ki = 0, no slew), so the ideal drive reproduces the R2b path. One profile lists every drive model it is declared for (driveModelDigests): the experiments vary the device, not the tuning. plantModelDigest is the physical model's modelDigest (AMR) or the SHA-256 of the xArm component file.
- `tuning-envelope-v1.json`: the server's bounds per axis. `integralLimit` is a force limit in N m (ki * imax in the engine's pid actuator); a field an axis does not accept is absent from its entry (revision 2): a velocity axis lists no kd and no slewLimit, a position axis no accelerationLimit; integralLimit.min is 0.01 N m.
- `control-oracle-v1.json`: metric windows and the sustained-oscillation threshold, locked before any campaign.

Every value is `assumed`, every document `not_calibrated`; none is the parameter set of a real driver. Arm brake torque is 3x the gravity torque at home measured in the V01 spike (floored at 1 N m). The gripper's velocityLimitRadS is 10 rad/s, above the 7.7 rad/s its drive joint reaches closing on a cup: it is an OVERSPEED reference (trip at 1.2x), not the 2 rad/s command rate of the R2b program; a world needs one combined drive model and profile, which V05 adds.
