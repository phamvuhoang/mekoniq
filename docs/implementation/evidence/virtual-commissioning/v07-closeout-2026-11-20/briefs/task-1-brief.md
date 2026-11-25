### Task 1: Preserve worker protocol and repair drive semantics

**Files:** `robotics/simulation-mujoco/mujoco_worker/{drive_binding,drive_model}.py`; tests `test_{drive_model,drive_engine,bench,session}.py`; new `tests/test_worker_protocol_regression.py` and fixed fixture corpus under `robotics/simulation-mujoco/tests/data/`.

**Interfaces:** Keep worker protocol/schema unchanged. Preserve full create/start/40 step/getState responses for mobile without drive, mobile CIL and arm without drive, scoped to declared architecture; only genuinely variable identity fields may be normalized by explicit names. Other tasks consume correct accepted-seq semantics and truthful targetApplied.

- [ ] Capture current response bytes before any worker fix. Commit corpus and test separately; prove sensitivity with an isolated mutation of a meaningful response field. Verify the corpus matches the pre-fix revision.
- [ ] Add failing regression for admitted J2 hold with `ki=0, slewLimit=0.5`, nonzero home: no reference jump and no OVERSPEED; cover enable/re-enable with slew-only and slew+integral. Fix reference initialization based on configured slew, not activation-state count alone.
- [ ] Add failing repeated-seq regression for changed target and flags. Equal seq means no new command: retain the last accepted payload for target/enable/quickStop/reset while watchdog advances; reject decreasing seq atomically per existing contracts. Do not make quick-stop from a new seq ineffective.
- [ ] Add failing disable/fault trace regression against the actual actuator target: CSV inactive target zero, CSP chosen hold reference. Update `targetApplied` and substep trace consistently.
- [ ] Close related worker test debts: getState is observational; disabled/quick-stop trace; unsupported bench/drive-conflict refusal; avoid joint-index literals where the tested behavior is not the index mapping. Correct misleading instability test descriptions.

```python
# Regression intent; integrate with the existing real-engine helpers.
assert repeated_sequence_snapshot['targetApplied'] == first_accepted_target
assert disabled_snapshot['targetApplied'] == actual_inactive_actuator_target
# With slew-only, holding a nonzero pose must not seed a reference of zero.
assert not any(axis['fault'] == 'OVERSPEED' for axis in hold_snapshots)
```

- [ ] Run focused tests RED/GREEN, then all `robotics/simulation-mujoco/tests` once; record counts/skips and commit `fix: preserve accepted drive commands and initialize slew holds`.

