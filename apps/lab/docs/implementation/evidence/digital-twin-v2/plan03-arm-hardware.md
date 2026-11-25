# Plan 03 — arm controller and hardware gates: evidence index

**Software implemented and tested; no controller run.** The recorded host is macOS arm64 without LinuxCNC, Qt/QtVCP, ROS 2 or a Linux
install target, so every Linux-only check (LinuxCNC smoke, QtVCP GUI smoke, clean-host install/rollback/systemd, release signing by the
signing station) stopped at its prerequisite gate with `blocked_external` / `not_run`. Nothing here promotes the controller PoC, G-SIM-ARM,
R-SIM or any hardware gate; no transfer over `linuxcnc_sim` is verified (the simulation profile has no gripper or cup sensor).

Recorded 2026-11-05/06. Plan: `docs/plans/2026-11-05-digital-twin/03-arm-hardware.md`. Spec: `docs/specs/2026-11-05-digital-twin/arm-hardware.md`.

## Code identity

| Repository | Value |
|---|---|
| source branch / HEAD | `feat/lab-digital-twin-v2` / `14d62c471fed0560d6a84921371240e6f4470e6f` |
| source plan 03 commits | `a10993c` A01 model pin · `f0e7236` A02 LinuxCNC sim profile · `6549363` A03 bridge/arbiter · `281be7b` A04 QtVCP HMI · `48dd86c` A05 adapter/session/evidence · `6bf0834` A06 export/trust · `99ebf5d` CI split · `1495188` test · `14d62c4` review fix pass |
| lab branch / plan 03 base | `feat/robot-lab` / `2d5fed3` (plan 02 re-pin); `18d8bd8` arm telemetry/evidence rows; the re-pin commit follows |
| runtime artifact | `node scripts/export-lab-runtime.mjs` on Node v24.22.2 from the clean checkout: sha256 `9b5b72ee3428df18348ccb81929c66d7a0c3c32d51ca08e423728583e681b3a7`, schema hash `8b398544fdeb8127da0697a086283f055126075696a573dd4e8be40b00d56881` (29 schemas: + `arm-command`, `arm-observation`), protocol 1/2, SIL tools digest `8e746cbac317…` over 33 files |
| Lab import | `node scripts/import-runtime.mjs …` then `pnpm check:source` → `Verified source 14d62c4…; schema 8b398544…; protocol 1/2; Node 24` |
| arm controller artifact | `node scripts/export-arm-controller.mjs … --allow-unsigned` from the clean checkout: version `0.1.0+14d62c4`, 43 files, **unsigned** (no release key exists) → [manifest](plan03-arm-artifact-manifest.json); the installer refuses it → [refusals](plan03-arm-trust-refusals.json) |

## Commands actually executed and their results

All source commands ran from `source/` on Node v24.22.2 (nvm) with pnpm 10.32.1; Python from `source/.venv` (3.13). Supabase/Docker was not
running, so the Postgres-backed integration suites were not part of this record.

| Task | Command | Result |
|---|---|---|
| A01 | `python3 -m unittest discover -s tests -p 'test_model_units.py'` (from `integrations/arm-controller/`) | 12 passed: pinned LinuxCNC 2.9 sample DH (commit `135b0ce`), both-way inch/deg ↔ SI, independent matrix FK oracle vs the quaternion FK of the plan 02 checker (≤1e-9), quaternion order/sign, near-singularity, unreachable, joint-limit, unknown MEKONIQ fields |
| A02 | `python3 -m unittest discover -s tests -p 'test_linuxcnc_sim.py'` | 10 passed: INI/HAL/tool/program/profile/lock checks, smoke refusal, driver sequence on a fake controller |
| A02 | `bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir …` | **exit 2 not_run** — [record](plan03-arm-smoke.json): `HOST_NOT_LINUX`, `LINUXCNC_MISSING`, `LINUXCNC_PYTHON_MODULE_MISSING`; GUI smoke not executed |
| A03 | `python3 -m unittest discover -s tests -p 'test_arbiter.py'` / `test_bridge_protocol.py` / `test_bridge_recovery.py`; `pnpm contracts:generate && pnpm contracts:check`; `pnpm exec vitest run tests/contracts` | all OK; contracts generation matches; 39 passed (shared message fixture validated by both runtimes) |
| A04 | `python3 -m unittest discover -s tests -p 'test_hmi_actions.py'` | OK: pure action policy, handler against the real arbiter, static bypass/.ui/.qss/trilingual checks; GUI smoke **not executed** (`docs/hmi-acceptance.md`) |
| A05 | `pnpm exec vitest run tests/integration/lab-v2-arm.test.ts tests/integration/lab-v2-arm-collision-evidence.test.ts tests/security/lab-v2-arm-authority.test.ts` | passed, incl. the **real Python bridge service** (fake controller) over a Unix socket and **Python/TS checker parity** through `python3 -m collision`; `python3 -m unittest … test_handoff_admission.py` OK (18 fixture cases) |
| A05 | lab `pnpm exec vitest run tests/integration/arm-evidence.test.ts`; `node scripts/test-mock-e2e.mjs arm-simulation.spec.ts coffee-journey.spec.ts` | 5 passed; e2e 2 passed on the pinned runtime `14d62c4` |
| A06 | `python3 -m unittest discover -s tests -p 'test_release_*.py'`; `pnpm exec vitest run tests/unit/export-arm-controller.test.ts` | OK: manifest schema, Ed25519 RFC 8032 vector, tamper/wrong/unknown/revoked/expired/missing policy, cache stamp, downgrade (semver core, then signed exportedAt), installer provenance, trust-policy update signing, install/rollback with calibration compatibility on a temp prefix; exporter signs with an ephemeral key and the Python verifier accepts it |
| A06 | `node scripts/export-arm-controller.mjs <dir>` (no key) | **exit 2** `SIGNING_KEY_REQUIRED`; with `--allow-unsigned`: unsigned manifest, `verify-signature.py` exit 3, `install-sim.sh` exit 3, installer run from inside the artifact exit 3 `INSTALLER_FROM_ARTIFACT` |
| all | `node scripts/lab-sil.mjs doctor --backend linuxcnc_sim --json` | **exit 2** — [record](plan03-doctor-linuxcnc.json): linux, linuxcnc, linuxcnc-python missing; python3, bridge-deps, profile, checker ok |
| all | `pnpm lint`; `pnpm exec tsc --noEmit`; `pnpm exec vitest run tests/unit tests/contracts tests/security/lab-v2-arm-authority.test.ts`; SQLite integration families; Python CI lines | clean; clean; 114 passed; 46 files, 365 passed / 2 skipped; 263 passed / 1 skipped + 86 passed |

## Final review and fix pass (source `14d62c4`)

A fresh reviewer (model fable) graded the branch "with fixes": 1 Critical (ARM03 evidence could report pass on a recorded collision) and
10 Important. All were fixed test-first in one pass: the evidence result follows the checker verdict; the arbiter binds release/renew/
reconcile to the owner token, takes the owner kind from the socket channel (operator HMI on `local.sock`, Lab on `bridge.sock`), uses random
lease ids, broadcasts every lifecycle change as `arm.event.v1`, verifies the staged program file and word allowlist, detects a controller
restart under a live bridge, records outcomes per job and completes pause/resume/cancel only on an observed transition; both clients renew
their lease, correlate replies by `requestId` and reconcile without an owner after losing it; the service never blocks on a stalled client
(`SEQ_GAP:n`); the HMI has no software E-stop; the installer refuses to run from the artifact it verifies, the trust cache stamp is mandatory,
an equal version exported earlier is a downgrade, a trust policy is replaced only when signed under a currently active key, and the
exporter never empties a foreign directory. Deferred minors are listed in the final hand-over message and in `docs/implementation/progress.md`.

## What the software proves and what it does not

- **Proven in software:** the pinned reference model and its unit/frame rules; the LinuxCNC simulation profile is internally consistent
  (INI/HAL/tool/program hashes); the bridge protocol, one-owner arbitration with token/channel binding, journal-before-send, duplicate ids,
  unknown outcomes that are never resent, restart/epoch and fault semantics, lifecycle events; the HMI policy; the Lab adapter and arm session
  (controller_sim samples, attachments, ARM03 only from the geometric checker with not_run on missing checker/trace/geometry revision); the
  coffee pickup admission oracle in both runtimes; the artifact manifest/signature/trust/install/rollback chain with ephemeral keys.
- **Not proven:** anything that needs LinuxCNC, Qt or a Linux host: the real `LinuxcncPort`, the smoke sequence on a virtual HAL, the QtVCP
  HMI on screen, the systemd service, a clean-host install, release signing with the real key; any arm transfer evidence (no gripper/cup
  sensor in the sim profile: completion events carry null grip fields and the domain never confirms a pickup); a controller-backed BV01 in the
  SIL campaign (orchestrator gap); dynamics, grip force, calibration, accuracy, safety, hardware readiness.
- **Known gaps carried forward:** `dependencies.lock.json` is a candidate until a clean host verifies it; `trust-policy.json` ships no key;
  the demo/cup programs are XYZ-only until the ABC convention is pinned on the controller; `admitPickup` is a pure oracle not yet wired into a
  runtime path; the Lab ARM03 row reads the plan 02 mock evidence shape (the plan 03 record is not yet in `RunReport`).
