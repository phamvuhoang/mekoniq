# Recovery policy v1

Generate with `node scripts/generate-recovery-fixture.mjs [out-dir]`. `pick-recovery-v1.json` is the bounded recovery table of a failed pick (R4-B §7.2): two rules over a closed catalogue, at most two attempts each. All values `assumed`, `not_calibrated`. A failure the table does not name, a fact that is not observed and an exhausted bound all end in `needs_attention`; the gripper is opened only when the cup is observed not to be between the pads.
