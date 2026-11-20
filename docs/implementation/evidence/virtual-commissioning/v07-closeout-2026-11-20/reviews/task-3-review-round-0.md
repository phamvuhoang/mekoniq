### Spec Compliance

- ❌ Needs fixes at frozen head 0b068d0a. Exact-head tests and the corrective diff remain pending.
- The registered v2 mobile/cell oracle objects and the 16 bench cases, metric expectations and sample gate match v1. Evidence in robotics/simulation-mujoco/campaigns/cil-v2.json:61 and bench-v2.json:16.

### Strengths

- campaign-source-evidence.ts:26–30,50–59 verifies each signed entry, compares durable outcomes and attention, then cil-campaign.ts:177–185 applies the oracle.
- drive-run.ts:69–77 and cil-campaign.ts:160–216 enforce full wire-command replay and verified same-profile repeats with a verified nominal comparator for torque.
- diff-drive-base.ts:69–92 and tests/unit/diff-drive-base.test.ts:95–109 enforce actual emitted jerk and preserve the coupled motion bounds. drive-experiments.ts:11–16 records the ideal compatibility boundary.

### Issues

- Important — navigation2d/controller.ts:273 resets best to Infinity on a waiting retry after an unsuccessful exhausted-route correction. At line 315 this resets stagnant at an unchanged pose. Preserve physical progress across replacement plans.
- Important — world-drive-report.ts:25–28 ignores a second recorded velocity. At lines 39–47 an absent setpoint also throws instead of reporting the verified prefix. Enforce single-world cardinality and return incomplete evidence on failed replay.
- Important — mujoco-world-ports.ts:95 reports from the live in-memory admission even when the durable bundle is missing or damaged. Bind live and reopened reports to the same retained admission.
- Important — cell-campaign.ts:85–86,99–105 permits standalone verification to skip drive replay if the campaign header drops its optional drive experiment. Require drive presence to agree with the recorded scene, checkpoint and report.
- Important — cell-campaign.ts:93,108 validates the world's boot and scene against the checkpoint but misses its run ID on fault cases. Bind the verified world ID to the Source run.
- Important — cell-campaign.ts:110–112 skips the registered WORLD_UNKNOWN attention code for worker loss and lost ACK. Require it at the original report horizon.
- Minor — bench-campaign.ts:64 takes all cases from the current registry before selecting the historical registry at line 66. Both tables match today.
- Focused reads checked the progress timer at navigation2d/controller.ts:311–318, command and publication semantics at simulation3d/world-evidence.ts:35–51,88–103, schema cardinality at world-evidence-v1.schema.json:168–171,222–249, and joint-follower.ts:20.
- Focused reads checked physical axis validation at physics-evidence.ts:38, signed payload validation at contracts/src/validate.ts:28–31, the original mj-cell-bv01-v1.json fault registrations, scenario-runner.ts:408–409 and both v1 campaign tables.

### Assessment

**Task quality** Needs fixes. The reported final checks and the follow-up correction remain under review.
