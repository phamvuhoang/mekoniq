# Task 1 worker protocol and drive semantics

Worker fix commit `f4bd7734` followed the separate regression commit `edb11dd9`.

## Protocol regression

`edb11dd9` precedes all worker changes. It stores the exact request streams, mobile bundle with pinned nominal CIL overlay, arm scene/component/physics, and normalized NDJSON responses from `faee938d`. The arm reuses content-addressed blobs from the repository. There are 43 responses per case for create, start, 40 steps and getState. The comparison normalizes only the value under `bootId`; every other response byte is compared. The captured platform is Darwin arm64, macOS 26.5, with Python 3.11.15 and MuJoCo 3.17.0.

```sh
git diff --exit-code faee938d -- robotics/simulation-mujoco/mujoco_worker robotics/simulation-mujoco/fixtures packages/contracts/schemas
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 90; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests/test_worker_protocol_regression.py -q
```

- The pre-fix working tree passed all 3 corpus tests in 1.65 s. A `git archive faee938d` of the worker, scenarios and schemas replayed with the committed inputs passed all 3 in 1.93 s.
- In that isolated archive, changing `build_mobile` from `time = str(tick * TICK_NS)` to `time = str(tick * TICK_NS + 1)` failed both mobile byte comparisons at the changed digit. The arm passed, for 2 failures and 1 pass. The mutation touched only the temporary archive.
- The corpus README's capture and override commands were run verbatim on Darwin arm64. The isolated `a93ae08d` worker generated a new corpus and the repaired checkout matched all 3 streams in 1.74 s. The same command can generate native x86-64 data on that runner. Native x86-64 remains pending for the qualification task.

## Red and green

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 90; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests/test_{drive_model,drive_engine,bench,session}.py -q -k 'repeated or dropped_during_enable or decreasing_seq or inactive_telemetry or quick_stop_runs or j2_slew_hold or trace_at_stop or unsupported_bench or its_drive_documents or get_state_carries or goes_quiet or interlock_uses or actuator_spec_refuses_boolean or effective_inertia_of' --tb=short
```

- Before the fix, 21 failed, 13 passed, 127 were deselected. The slew-only J2 reference was `[0.0]` when the actual pre-step position was `-1.1477966401366557` rad. The slew-plus-integral case passed as a positive control. Repeated target `2.0` displaced the accepted `0.75` target, repeated flags disabled, re-enabled, quick-stopped or reset drives, and a dropped target replayed after enabling. Changed repeats also altered mobile pair admission and world movement admission. All four inactive CSV/CSP disable/fault traces reported the old target, and the real wheel bench reported `2.0` with `data.ctrl` at `0.0`. All six direct boolean checks admitted invalid numeric fields.
- After the fix, 34 passed and 127 were deselected in 1.80 s.

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests -q -rs
git diff --check
```

- The final complete worker suite passed 264 tests, zero skipped, in 25.77 s. `git diff --check` passed.

## Self-review

- Slew reference initialization follows the compiled `slewmax` configuration. Enable and re-enable seed J2 from actual position and clear the integral when present. The admitted 25-tick holds stay within 0.01 rad without a fault.
- Equal sequences retain the last accepted payload. The watchdog still advances while enabled, reset requires a fresh rising edge, and a target dropped while not enabled requires a new sequence to enter the channel. Mixed-sequence refusal occurs before any axis is mutated. The session change agreed with the parent uses effective commands for pair limits, the world movement interlock, and the dock-drift gripper target. Per-axis mode and bounds validation still checks every received command.
- `targetApplied` and the trace use the same target the drive sends to the actuator, including zero for inactive CSV and the chosen hold for inactive CSP. Regressions cover injected overspeed and actual wheel actuator input on disable and fresh quick stop.
- Readback checks compare the stored snapshot without advancing plant, sequence, or watchdog clocks. Unsupported bench and drive-conflict checks prove refusal before engine construction. The inertia tests derive the joint from authored arm/gripper or mobile IDs using compiler names, independently of the drive binding. The instability tests distinguish a real overspeed trip from an injected engine warning.
- The full response schema and historical evidence are untouched. Only task files under `robotics/simulation-mujoco/` are included in the commits. The archived corpus lives under `tests/`, which the runtime exporter and image builder exclude.
