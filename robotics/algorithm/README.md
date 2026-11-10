# Algorithm checks (`algorithm_checks`)

Independent oracles for the MEKONIQ arm kinematics and the `pid-v1` controller. Python computes numbers; **every comparison and verdict is made in TypeScript** (`packages/lab-runtime/src/v2/algorithm/`), so an oracle never grades itself.

- One invocation per request, `python -I -B -m algorithm_checks`: one JSON line on stdin (`{"protocol":"mekoniq-algorithm/1","op":…,"payload":…}`, at most 1 MiB), one JSON line on stdout. Nothing else reaches stdout; it takes no paths, modules or code.
- Ops: `rtb_fk`, `rtb_jacobian`, `rtb_ik` (Robotics Toolbox 1.5.0, modified-DH, SI); `pid_response` is added with the PID oracle. NaN, infinity, a wrong shape or an unknown op is an explicit error, never a value.
- `rtb_ik` answers per pose `{ok, q, reason?}`. `reason` is `Q0_OUT_OF_LIMITS` (the start is outside the joint limits) or `IK_NOT_CONVERGED`; the solver is seeded (`seed=0`).
- `oracle-profile-v1.json` holds the thresholds. They bound the agreement of two implementations and are not a measured capability of any robot. Its digest (canonical JSON) travels in every `AlgorithmResultV1`.

## Provisioning

```sh
node scripts/bootstrap-portable-simulation.mjs algorithm   # .venv-algorithm from requirements.lock (hashes, Python 3.11, no network at run time)
node scripts/portable-licenses.mjs                          # licenses.json
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=robotics/algorithm .venv-algorithm/bin/python -m pytest robotics/algorithm/tests -q
```

`requirements.lock` is `uv pip compile requirements.in --python-version 3.11 --generate-hashes`. `robot-descriptions` is installed as a dependency of `roboticstoolbox-python` but must never be imported (it downloads models); a test asserts it stays out of `sys.modules`. `xacro 2.1.1` ships no license metadata, so `licenses.json` lists it as `UNKNOWN (no metadata)`; that needs a human license review before any redistribution.

## Scope

- `pid-v1` (`packages/lab-runtime/src/v2/control/pid.ts`) is checked here but **no plant uses it yet**: in Release 1 the Webots plant drives wheel motors by velocity (design D09). Release 2 puts it in the MuJoCo wheel-speed loop.
- ALG04 (joint trace of a running LinuxCNC bridge) is Release 3 and is `not_run` in Release 1.
