# MEKONIQ arm controller package (`source/integrations/arm-controller`)

Self-contained controller package for the coffee-cell arm: LinuxCNC configuration for the pinned PUMA 560 reference model, the local
command bridge/arbiter, the QtVCP HMI, packaging and tests. It is exported as an installable artifact for a Linux IPC
(`scripts/export-arm-controller.mjs` in `source/`); the Lab talks to it only through the typed bridge contract, never through LinuxCNC's
Python/HAL API. Spec: `lab/docs/specs/2026-11-05-digital-twin/arm-hardware.md`; plan: `lab/docs/plans/2026-11-05-digital-twin/03-arm-hardware.md`.

**Status:** simulation only. No MEKONIQ robot, drive, IPC or safety circuit is chosen; `hardware.enabled` is false in every profile and
can only change through provisioning. Nothing in this package is hardware evidence.

## Layout

| Path | Owner | Content |
|---|---|---|
| `models/puma560-reference/` | A01 | pinned model: manifest, modified DH (inch/rad/deg), frames, reference poses, vendored sample; `docs/model-conventions.md` |
| `configs/sim/puma560/` | A02 | `mekoniq.ini` (inch/deg, `G20`, genserkins, `DISPLAY = qtvcp -f mekoniq_arm`), `machine.hal` (virtual loopback HAL + fault fixture signal), `puma560-dh.hal`, `tool.tbl`, `profile.json` (stale/lease/disconnect/channel bounds, program allowlist) |
| `programs/` | A02 | allowlisted G-code (`demo-six-axis.ngc`, hash in the profile) |
| `packaging/dependencies.lock.json` | A02 | candidate pins (Debian 12 amd64, LinuxCNC v2.9.10 / bookworm package, PyQt5 5.15.9, QScintilla 2.13.3); `verified:false` until a clean host records a run |
| `scripts/smoke-sim.sh`, `scripts/smoke_driver.py` | A02 | terminal smoke: start → home → run → pause → resume → stop → controller fault → no auto-resume, recorded as JSON; `blocked_external` (exit 2) without LinuxCNC |
| `bridge/` | A03 | protocol, arbiter (one owner), journal (durable outcomes), LinuxCNC port, local socket service |
| `hmi/mekoniq_arm/` | A04 | QtVCP `.ui`/handler/`.qss` that goes through the arbiter |
| `packaging/`, `scripts/install-sim.sh`, `scripts/verify-*.{sh,py}` | A06 | release manifest schema, trust policy, installer/verifier |
| `tests/` | all | stdlib `unittest` (also collected by the CI pytest job) |

## Commands

```sh
cd source/integrations/arm-controller
python3 -m unittest discover -s tests -p 'test_model_units.py'      # A01: model/unit oracle (needs rfc8785 for the plan 02 checker import)
python3 -m unittest discover -s tests -p 'test_linuxcnc_sim.py'     # A02: config/lock/profile/program checks, smoke script refusal, driver sequence on a fake controller
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir /tmp/mekoniq-arm-sim-evidence   # Linux host with LinuxCNC only
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir /tmp/mekoniq-arm-sim-evidence --gui   # GUI smoke (QtVCP fullscreen)
```

`smoke-sim.sh` stages a private config with absolute program/model paths and the custom QtVCP files, replaces `[DISPLAY] DISPLAY` with `scripts/smoke_driver.py` (terminal run) and
starts `linuxcnc`; the driver records every step's requested vs observed state (`smoke-driver.json`), the wrapper adds host, profile/model/lock
hashes and the LinuxCNC log (`smoke-sim.json`). A recorded `pass` is a software controller sequence on a virtual HAL: it says nothing about
drives, timing, load, grip or safety. On any host without LinuxCNC the record is `blocked_external` / `not_run` and the exit code is 2.

## Boundaries

- Units: the pinned sample is inch/deg with `G20`; the bridge converts to SI at the Lab boundary (see `docs/model-conventions.md`).
- One control owner at a time (`none`, `local_operator`, `lab_simulation`, `authorized_cell_job`), decided by the arbiter on the controller;
  the HMI and the Lab bridge are both non-real-time clients of it. Physical safety is an independent circuit, never this software.
- No EtherCAT/IgH/lcec, no real-time kernel claim, no VM timing presented as IPC evidence. The hardware stack is a separate, gated profile.
- Programs run by id + sha256 from the profile allowlist; MDI text, HAL commands, file paths, Python and network endpoints are refused at the bridge.

Smoke output directories must be fresh: earlier `smoke-sim.json` or `smoke-driver.json` records are never reused. A GUI that opens and closes does not pass the HMI checklist; the wrapper records `manual_verification_required/not_run` until independent operator evidence is supplied. Use the wrapper for GUI launch so the custom screen is staged on QtVCP’s configuration search path.
