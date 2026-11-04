# Source-backed Robot Lab runtime

This package is a **development-only** local business simulator. It reuses `createProductionRegistry`, `authorizeVenueCommand`, `processCommand`, the production SQLite journal, outbox dispatcher, and `SimulatorAdapter`. It does not import `tests/support`, connect to robot endpoints, or provide physical safety evidence.

The runtime is integrated with the W00–W11 code on `source/main`. The separate `lab/` repository selects an exported artifact through `config/source-runtime.lock.json`; updating source does not update an installed Lab runtime. Synthetic waypoints and the robot's `bindingRevision` come from the same Lab world revision. Observations use the server-owned `simulator:sim-1` identity on `lab-coordinator`, as required by W06 observer ownership checks. Production admission and observation checks remain unchanged. The presence of native adapters and later restaurant modules in source does not enable additional Lab backends or scenarios; this gateway still exposes only S01 business simulation. Source release/UAT acceptance remains governed by the [implementation gates](../../docs/implementation/gates/D-full-scope.md).

Use Node 24. From a clean source checkout:

```sh
node scripts/export-lab-runtime.mjs /tmp/mekoniq-lab-runtime
node /tmp/mekoniq-lab-runtime/runtime.mjs --port 4176 --data-dir /tmp/mekoniq-lab-runs
```

The CLI prints a random pairing token valid once for five minutes. Enter it in the local Lab UI at `http://127.0.0.1:4175`. The gateway binds `127.0.0.1` only. Its session cookie is HttpOnly and SameSite Strict; mutations require the separate CSRF token and an allowlisted Origin. All run reads and reports enforce session ownership. Session lifetime is one hour; restarting the gateway expires browser sessions. No token is returned by health or saved into a report.

`--allow-dirty` on the exporter is for development tests only and produces `dirty:true`; consumers must reject such artifacts. The artifact embeds its source commit, schema hash, runtime code, dependencies, and source SQLite migration. It works without the original checkout or `node_modules`. `manifest.json` contains its SHA-256, public schema filenames, package version, protocol major, and Node requirement. The schema hash covers sorted schema filenames followed by their exact bytes, including existing source wire schemas.

## Protocol v1

- `GET /lab/v1/health`: public runtime identity, backend availability, supported scenarios. Only `business_sim` / `S01` is implemented.
- `POST /lab/v1/sessions` with `{token}`: creates a session, sets the cookie, returns `{csrfToken}`.
- `POST /lab/v1/runs` with `{project,scenarioId:'S01',seed,sourceCommit,mode?:'business_sim'}`: validates and creates a run, returns the snapshot with HTTP 201.
- `GET /lab/v1/runs/:id`: coherent snapshot, including complete source event history; polling is supported.
- `POST /lab/v1/runs/:id/actions` with `{actionId,expectedRevision,kind,payload?}`: `start`, `step` (`{ms:0..60000}`), `confirm`, `cancel`, or `injectFault` (`{fault:'blocked'|'clear'|'offline'|'online'|'reboot'|'duplicate-completed'}`). No raw restaurant command, identity, robot address, shell, or native mode is accepted.
- `GET /lab/v1/runs/:id/report`: actual source events, signed journal records, outbox effects and attempt counts, faults, pinned source commit, and honest coverage limitations. No private keys or external paths.
- `GET /lab/v1/runs/:id/events`: authorized, HTTP 501; SSE is deferred. Consumers must poll snapshots and cannot claim SSE cursor or reconnect coverage.

The JSON body limit is 1 MiB. A gateway instance allows 10 sessions, 20 runs including in-flight creations, and 1,000 actions per run. Failed admissions release their reserved slots. Actions serialize within a run. Completed and cancelled runs reject all fresh actions before changing state; exact receipt replays remain idempotent. An action ID can replay its original snapshot only for the exact same request; changed payloads or stale revisions are conflicts.

## Durable journey and recovery

S01 submits real source commands in order: Session.Open → Order.Place → Kitchen.Ready → Fulfillment.Allocate → Mission.Create. The simulator emits production Robot.Observe events. An observed kitchen arrival requires an explicit `confirm` before loading. An observed table arrival requires a separate explicit `confirm` before `served` changes. Parking is a second source standby mission; the harness confirms that stop only after its source arrival evidence. UI timers never emit arrivals.

Each run has a fresh synthetic organization, a scoped SQLite WAL journal, a persisted per-run P-256 signing key (0600), a private artifact directory (0700), a fixed synthetic clock, and an atomic harness checkpoint. The profile/map bindings compile only from the supplied simulation world. Authored semantic points are already handoff waypoints; bindings preserve their exact `(x, y)` coordinates. Furniture geometry is separate. Source observations alone update displayed robot positions. Re-emitted completions with the exact identity of a source-completed command are recorded in the bounded `ignoredObservations` report field; they do not re-enter or weaken source command identity checks.

The harness marks an action in flight before mutation. On reopen, it finds active mission identity from durable source state, including a commit that beat its checkpoint. Lost adapter goals become `needs_attention`; source `Robot.Observe unknown` holds the robot resource. It does **not** rebuild or resend motion. Missing checkpoints beside existing files fail closed. A durable arrival awaiting human confirmation can resume with fresh observation identity. A reboot or uncertain dispatch also holds unknown without retries. `cancel` follows source cancellation and observations; unresolved cargo remains `needs_attention`.

`createLabSession({...})` can reopen a known run directory for controlled diagnostics. The HTTP API does not expose arbitrary paths or a gateway-restart run recovery browser UI. Pairing/session state is intentionally process-local. Existing evidence remains in the run directory; no production journal is restored or replayed.

Source admission independently rejects shared point/obstacle IDs, target points inside furniture, and stationary service robot footprint collisions with furniture or world bounds. The illustrative service chassis is 0.55 × 0.6 m; admission conservatively uses its circumscribed circle for every target orientation. This is stationary geometry validation, not a collision planner. Reports preserve Valetudo footprint/radius as null and mark its clearance check unavailable; only point obstruction can be checked for that unmeasured chassis. Native geometry remains unverified in both cases.

The seed is recorded for scenario provenance. S01 currently has fixed inputs and no stochastic model; UUIDs, keys, and journal IDs differ across runs. Business simulation does not prove planner avoidance, dynamics, payload limits, firmware compatibility, physical stopping, native executor crash recovery, or hardware readiness. S02–S12, Gazebo/ROS/Valetudo, and hardware controls remain unavailable.

## Validation

```sh
node node_modules/vitest/vitest.mjs run tests/integration/lab-runtime*.test.ts tests/integration/simulated-delivery.test.ts tests/integration/app-simulator.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/generate-contracts.mjs --check
```

Integration tests exercise source journal and effect behavior, gateway boundary failures, corrupted/reopened checkpoints, uncertain sends without retries, cancellation, and a bundled CLI running from an unrelated temporary directory with no source-relative migration path.
