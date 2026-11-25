# Plan 02 — simulation layer evidence index

**Software implemented and tested; no SIL run executed.** The recorded host is macOS arm64 without ROS 2 Jazzy, Gazebo Harmonic or LinuxCNC, so every simulation-in-the-loop command below stopped at its prerequisite gate with `not_run` (exit 2). Nothing here promotes R-SIM, G-SIM-NAV, G-SIM-ARM, G-SIM-E2E or any hardware gate; no physics row passes.

Recorded 2026-11-05. Plan: `docs/plans/2026-11-05-digital-twin/02-simulation.md`. Specs: `docs/specs/2026-11-05-digital-twin/`.

## Code identity

| Repository | Value |
|---|---|
| source branch / HEAD | `feat/lab-digital-twin-v2` / `0101d6cfd0fa876eee235077bd591b313c05be37` (task commits below, then `71bc783` lint, `0101d6c` review fix pass) |
| source plan 02 commits | `02c416a` compile twin worlds from versioned assets · `a8d9e6e` connect isolated Gazebo navigation to lab v2 · `f558db1` record causal simulation clocks and recovery evidence · `d9fcde6` simulate pedestrians and shared robot traffic · `9f20184` validate coffee plant evidence in source domain · `413c40a` couple beverage devices and verified cup transfers · `ff6c2eb` verify food and beverage simulation campaigns |
| lab branch / plan 02 base | `feat/robot-lab` / `730bd1ce5b44848b9becae93f6ab78e7b32329da` (the lab commit that follows carries the fixture, helper, test and these documents) |
| runtime artifact | exported from the clean source checkout with `node scripts/export-lab-runtime.mjs /tmp/mekoniq-lab-runtime-v2` on Node v24.22.2: `dirty:false`, sha256 `f96a65b36bd3520bb04a4282314bdf55867b1257e591271c28f0bf7d948257ec`, schema hash `f112425e636254a6c3d20d75d615b696c426c7d2a5fb185c01a1943095fe0ffd`, protocol 1/2 |
| Linux SIL tools digest | `2256fe7748b40b170a861ba2b58e8bf4a2cae2c796cf9ed7d47e7a23a81c2ed3` over 32 files of `source/robotics/simulation` (distributed separately with the pinned ROS image; not in `runtime.mjs`) |
| Lab import | `node scripts/import-runtime.mjs /tmp/mekoniq-lab-runtime-v2` then `pnpm check:source` → `Verified source 0101d6c…; schema f112425e…; protocol 1/2; Node 24` (re-exported after the review fix pass) |

## Commands actually executed and their results

All source commands ran from `source/` on Node v24.22.2 (nvm) with pnpm 10.32.1; Python from `source/.venv` (3.13, rfc8785, jsonschema). Supabase/Docker was not running, so the Postgres-backed integration suites were not part of this record.

| Task | Command | Result |
|---|---|---|
| 1 | `.venv/bin/python -m pytest robotics/simulation/tests/test_world_compiler.py robotics/agent/tests/test_robotics_assets.py -q` | 24 passed |
| 2 | `pnpm exec vitest run tests/integration/lab-v2-simulated-navigation.test.ts tests/integration/robot-admission.test.ts tests/integration/lab-runtime.test.ts`; `.venv/bin/python -m pytest robotics/simulation/tests/test_nav2_session.py robotics/agent/tests/test_nav2_adapter.py -q` | pass; 83 passed; `ros2 launch lab_world.launch.py` **not executed** (blocked_external) |
| 3 | `pnpm exec vitest run tests/integration/lab-v2-sim-clock.test.ts tests/integration/lab-v2-sim-recovery.test.ts`; pytest `test_clock_barrier.py` | pass |
| 4 | `pnpm exec vitest run tests/integration/lab-v2-zone-bridge.test.ts tests/integration/lab-v2-sil-campaign.test.ts tests/unit/lab-sil-cli.test.ts`; pytest `test_dynamic_scene.py test_two_robots.py` | pass; `node scripts/lab-sil.mjs run --scenario FD07/FD03/FD04 …` → **exit 2 not_run** ([fd07](plan02-sil-fd07.json), [fd03](plan02-sil-fd03.json), [fd04](plan02-sil-fd04.json)); `--scenario FD08` → exit 2 `SCENARIO_UNSUPPORTED` at preflight (FD08 has no runner scenario in the registry; no manifest is written) |
| 5 | `pnpm exec vitest run tests/integration/coffee-simulation-evidence.test.ts tests/integration/coffee-simulation-resources.test.ts` | 11 passed; regression 110/110 |
| 6 | `pnpm exec vitest run tests/integration/beverage-simulator.test.ts tests/integration/beverage-handoff.test.ts`; `.venv/bin/python -m pytest robotics/simulation/tests/test_beverage_cell.py test_cup_transfer.py test_arm_swept_path.py -q` | 9 passed; 14 passed; regression 64/64; `lab-sil.mjs run --scenario BV01 --seed 19 --backend-set coffee-simulation` → **exit 2** (`BACKEND_MISSING:linuxcnc_sim,coffee_io_sim`, `SIL_FIXTURE_MISSING`) |
| 7 | `pnpm exec vitest run tests/integration/lab-v2-scenario-matrix.test.ts tests/integration/lab-v2-simulation-report.test.ts tests/integration/lab-runtime-contracts.test.ts tests/integration/lab-runtime-artifact.test.ts tests/unit/lab-sil-cli.test.ts` | 14 passed, 1 skipped (optional latency measurement) |
| 7 | `pnpm contracts:check`; `pnpm typecheck` (source and lab) | no drift; exit 0 |
| 7 | lab `pnpm exec vitest run tests/integration/simulation-capability.test.ts` | 3 passed |
| 7 | `node scripts/lab-sil.mjs run --campaign food-beverage --seed 23 --repeat 3 --out …/campaign` | **exit 2 not_run** — [campaign manifest](plan02-sil-campaign.json): `PREREQUISITE_MISSING` linux/python-deps/compiler/ros2/gz; `SCENARIO_BLOCKED:BV01` and `SCENARIO_BLOCKED:CAMPAIGN-FD02-FD07-BV01-BV03` with `BACKEND_MISSING:linuxcnc_sim,coffee_io_sim|SIL_FIXTURE_MISSING`; expected runs 12, executed 0 |
| 7 | `node scripts/lab-sil.mjs verify --input …/campaign` | exit 2 (not_run is never a pass) |
| 7 | `node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --json` | exit 2 — [doctor](plan02-sil-doctor.json): node24 ok, python3 ok, image-lock ok; linux, python-deps (system python3 without rfc8785), compiler, ros2, gz missing |

## Post-review fix pass (source `0101d6cfd0fa876eee235077bd591b313c05be37`)

A fresh reviewer found two routes to a false physics pass and an unobservable worker; all Critical/Important findings were fixed test-first in one pass (`lab/.superpowers` ledger, "Final:" lines; the Lab re-pin below follows that commit):

- The worker's capability answers `available:true` / `evidence:sil` only when its launch process is alive, `/clock` is seen and every robot's Nav2 lifecycle reports ready; otherwise `available:false`, `evidence:none` with reasons. The orchestrator refuses an unavailable backend before the journal exists (`BACKEND_UNAVAILABLE:<reasons>`).
- `SIM.no-contact` passes only with a live contact-sensor report for every robot and zero contacts; `SIM.min-separation` is computed from the worker's footprint-separation samples (`SEPARATION_NOT_COMPUTED` / `FOOTPRINT_OVERLAP` otherwise). Nothing passes on an empty list.
- The worker scene loop (`bridge/scene_loop.py`) runs on the world clock and emits per-robot telemetry, contact-sensor liveness, contacts and separation, drives scripted actors/blockers and fires worker-scoped faults once (`localization-lost` = kidnap teleport); orchestrator-scoped faults (map change, duplicate/reordered observations, sensor drop/stale, disconnect/reboot as a link fault) fire in the orchestrator and are recorded in `faults.json`. Transfer barriers are requested at every load/handoff confirmation (`barriers.json`).
- Durable goal rows are journaled before the send (`SEND_INTERRUPTED` after a crash, never a resend); the compiled Nav2 overlay (initial pose, footprint/radius, speed) is merged into a per-robot params file for the launch; worker stderr is inherited and stdin errors guarded; `ROS_DOMAIN_ID`/`GZ_PARTITION` derive from the run id; one `requiredBackends` formula serves matrix, CLI and orchestrator; allowed-contact windows are validated (gripper/held-cup, grasp/release, world revision, span).
- Verification after the pass, Node 24.22.2: source typecheck/lint exit 0; Python `263 passed, 1 skipped`; the SIL physics/campaign/report/matrix/argv tests and the SQLite-backed integration families green (counts in the ledger).

## What the software proves and what it does not

- **Proven in software:** world compilation is deterministic and hashed; the worker protocol, Nav2 goal semantics, durable journal-before-send, scene loop bookkeeping, clock barrier, telemetry ingest, fault schedule, zone bridge and SIL orchestrator behave as specified against protocol doubles and fake ports; the coffee process model, cup transfer evidence rules and the ARM03 capsule swept-path checker pass their unit/integration tests in TypeScript and Python with cross-runtime hash parity; the scenario matrix covers FD01–FD08, BV01–BV08, SYS01–SYS06 and the campaign; evidence records are schema-valid and separate business pass from physics `not_run`.
- **Not proven:** anything that needs a running Gazebo/Nav2 or LinuxCNC: the real `RosPorts` (rclpy scene node, `gz service` pose/pause calls, Nav2 lifecycle health) has never executed; contacts, separation, physical stop, sensor evidence, closed-loop arm control and plant telemetry from a real worker remain unverified. The coupling of the beverage cell remains `open_loop_visualization` (mock arm). No hardware readiness, calibrated spill, physical grip or food-safety claim follows from any row here.
- **Known gaps carried forward:** `linuxcnc_sim` backend and the BV01 SIL fixture (`SIL_FIXTURE_MISSING`, plan 03); FD08 has a SIL fixture but no runner scenario, so `lab-sil.mjs` cannot run it; `reboot` is a link reboot in the orchestrator (the worker process is not restarted); a Linux host run of `lab-sil.mjs run --campaign food-beverage`; the Lab UI shows the support matrix only through `src/scenarios/support.ts` (no new screen).
