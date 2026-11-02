# Valetudo robot profile

Status: **protocol-emulator evidence only (`integration_tested` at most).** No physical Valetudo robot, firmware or venue network has been tested. The `valetudo` profile must not be marked `hardware_validated` or `venue_approved` until the supervised hardware proof below has been run on the named robot and firmware. `profileReason` (W06-T01) keeps any Valetudo robot below that level undispatchable.

## Pinned upstream

- Valetudo **2026.10.0** (released 2026-10-18), source <https://github.com/Hypfer/Valetudo/tree/2026.10.0>. The files read at that tag are listed in `tests/fixtures/valetudo/pin.json`. The docs site (<https://valetudo.cloud/pages/usage/capabilities-overview/>, <https://valetudo.cloud/pages/integrations/mqtt/>) does not publish the REST routes; the robot serves them as Swagger, and the router sources at the tag are the reference.
- The fixtures in `tests/fixtures/valetudo/` are shapes transcribed from those sources (`robot.json`, `capabilities.json`, `state-attributes.json`, `map.json`). They are **not** recordings from a robot. Replace or extend them with recordings from the commissioned firmware.

### REST v2 (the default; works with no broker)

| Use | Route | Notes |
|---|---|---|
| Identity | `GET /api/v2/robot` | manufacturer, modelName, implementation |
| Capabilities | `GET /api/v2/robot/capabilities` | array of capability type names |
| Status | `GET /api/v2/robot/state/attributes` | `StatusStateAttribute` value ∈ error, docked, idle, returning, cleaning, paused, manual_control, moving; flag ∈ none, zone, segment, spot, target, resumable, mapping |
| Map + pose | `GET /api/v2/robot/state/map` | ValetudoMap v2, cm coordinates; `robot_position` and `go_to_target` PointMapEntity; served with gzip (`compression()` middleware) |
| Reboot detection | `GET /api/v2/system/host/info` | `uptime` in seconds; a decrease means the host rebooted |
| Go to | `PUT /api/v2/robot/capabilities/GoToLocationCapability` | body `{"action":"goto","coordinates":{"x":<cm>,"y":<cm>}}`; 200 = handed to firmware, 400 = refused |
| Stop | `PUT /api/v2/robot/capabilities/BasicControlCapability` | body `{"action":"stop"}` (start/stop/pause/home) |

### MQTT (only where a suitable LAN broker already exists)

Topic layout is Homie: `<topicPrefix>/<identifier>/...`, with default prefix `valetudo`.

- Commands are `GoToLocationCapability/go/set` (the same JSON as REST, without `action`) and `BasicControlCapability/operation/set` (`START`/`STOP`/`PAUSE`/`HOME`).
- Valetudo **discards retained commands**. The adapter always publishes with `retain:false` at QoS 1.
- Telemetry topics are `StatusStateAttribute/status`, `StatusStateAttribute/flag`, `MapData/map-data` (zlib-deflated JSON) and `$state`/`$nodes`. Properties are published retained.
- A broker that exists only in the cloud does not satisfy offline control (spec).
- Give each robot its own broker credentials and an ACL limited to its own topics, for example in mosquitto `user robot-1` / `topic readwrite valetudo/Robot1/#`, and make sure no public broker or editor is exposed.

## What the adapter requires and refuses

- Required capabilities are `GoToLocationCapability` and `BasicControlCapability`. Without them a command is refused with `CAPABILITY_UNSUPPORTED`.
- **No speed control.** Valetudo has no movement-speed capability (`FanSpeedControlCapability` is suction power). A command with `limits.speedLimitMps` is refused with `SPEED_UNSUPPORTED`, never ignored. The W06-T01 driver registry entry (`valetudo`: delivery+guide, `speedControl:false`, `zones:false`, units `cm`) matches the pinned API and is unchanged:
  - `zones:false` because Valetudo virtual restrictions are static no-go areas, not shared traffic reservations.
  - `docking:true` relies on BasicControl `home`, but this adapter does not send `home` yet.
- **Units and frame.** The domain stores metres. The adapter sends `round(m × 100)` cm in the robot's own map frame. The profile `frame` (for example `valetudo`) must match the binding's frame, or the command is refused with `FRAME_MISMATCH`. Bindings for this driver must be taught in Valetudo map coordinates (`Robot.BindMap units:'cm'`).
- **Map identity.** Valetudo has none: `metaData.nonce` is regenerated per map object. The profile `mapFingerprint` is `sha256(JCS{size,pixelSize,segments})` over the sorted segment ids. TypeScript `parseMap` and Kotlin `NativeRobotTransport.parseSample` compute the same value, and the instrumentation test checks this.
  - A changed fingerprint proves the map changed: the command is refused (`MAP_MISMATCH`), or mid-trip the goal becomes `unknown`/`MAP_CHANGED`.
  - An equal fingerprint proves nothing. Rebinding stays an operator action after any relocalize or reset.
- **Endpoint.** Only the provisioned `http(s)` origin is accepted, on 10/8, 172.16/12, 192.168/16 or `<name>.local`. It may not contain credentials, a path or a query, and redirects are not followed.
  - Bodies are capped after gzip/deflate inflation (`maxMapBytes`).
  - The WebView never passes a URL or a raw request.

## Completion evidence (`packages/robot-adapters/src/valetudo/completion.ts`)

HTTP 200 (or an MQTT PUBACK) never means arrival. A goal is `completed` only if, after the ACK, all of the following hold:

1. A non-retained sample shows `moving` with a `go_to_target` within `goalToleranceCm` of the sent goal. Valetudo has no goal ID, so this is the only goal evidence. Firmware that does not expose `go_to_target` can never confirm arrival.
2. Throughout the trip there is no telemetry gap, no host-uptime decrease (reboot), no `$state` lost, no other status than moving/idle, no other `go_to_target`, and the map fingerprint stays the same.
3. The newest sample is fresh (≤ `freshMs`) and shows the robot idle and stationary: idle samples within `stationaryCm` of each other spanning at least `stationaryMs`.
4. The robot's pose is within `arriveToleranceM` of the goal (`arrivalConfirmed`). No pose means no arrival.

Anything short of that stays pending. At `tripTimeoutMs` it becomes `unknown` (`NO_MOTION_EVIDENCE`, `NO_POSE`, `ARRIVAL_UNCONFIRMED`, `TELEMETRY_GAP`, `REBOOTED`, `TRIP_INTERRUPTED`, `GOAL_REPLACED`, `MAP_CHANGED`) and is never retried automatically.

- No ACK (timeout, 5xx or a dropped connection) gives `unknown`. The same command ID is answered from the journal and never resent.
- A robot `error` status gives `failed` plus `safety_state:fault`. A later non-error status gives `safety_state:clear`. While `robot.safetyState` is set and not `clear`, the domain refuses admission, holds the next leg (`SAFETY_NOT_CLEAR`) and refuses `Mission.Resume`.
  - `safety_state` is robot-level: no command id and no epoch of its own. The forwarder (`startNativeValetudoRuntime`) stamps the robot's current control epoch.
  - The **domain** binds the observer: `Robot.Observe` `safety_state` requires the actor `executor:<robotId>` on the robot's current `ownerDeviceId`, otherwise `OBSERVER_NOT_BOUND`. An owner/manager, another robot's executor, or the old owner device after a handoff (RobotOwnerFenced moves `ownerDeviceId`) cannot set or clear it. The forwarder's local check (dispatchable profile) comes on top of that.
  - Mission events (accepted/completed/failed/unknown/cancelled) stay fenced by commandId + missionRevision + controlEpoch. Their submitters are unchanged (the owner in the W03/W04 labs, `simulator:<id>` in the app simulator).
  - The adapter reports the current state on the first reachable sample (fault or clear), even with no command (for example after a WebView reload). It re-emits that state every round until the domain accepted it (`safetyAccepted`). A fault comes from any reachable sample, a clear only from a fresh one.
  - The domain orders observations by `occurredAt`: one older than the recorded `safetyObservedAt` is `STALE_SAFETY_OBSERVATION`, and a `clear` must be strictly newer, so a replayed old clear never lifts a newer fault.
- **Cancel / STOP.** These send BasicControl `stop`, and the ACK only acknowledges the request (`physicalStopConfirmed:false`). Over MQTT a STOP is only `delivered` (broker PUBACK) and never reported as acknowledged; the cancel still waits for stationary evidence. A new goal is refused (`PREVIOUS_GOAL_ACTIVE` / `STOP_UNCONFIRMED`) until a fresh stationary idle stretch is observed after the stop. Waiting on a timer never counts.

The tolerances are calibration knobs to commission per robot, not values measured on hardware: `arriveToleranceM`, `goalToleranceCm`, `stationaryCm`, `stationaryMs`, `freshMs`, `tripTimeoutMs`, `requestTimeoutMs` and `maxMapBytes`. The emulator rig uses 0.40 m (the trial reference), 5 cm, 5 cm, 2 s, 3 s and 120 s.

## Tablet executor (Android)

Only the native executor sends robot mutations from the tablet. The files are in `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/executor/`, with the bridge in `apps/tablet-android/src/robot-executor-bridge.ts`.

- **Provisioning.** The profile comes from the managed app restriction `valetudoProfile`. It is a JSON object with `robotId`, `executorId`, `controlEpoch` (the robot's current domain control epoch at provisioning), `transport:"rest"`, `endpoint`, `mapId`, `mapRevision`, `mapFingerprint`, `frame`, `leaseMs`, `pollMs`, `onLeaseLoss:"stop"|"continue"`, `requestTimeoutMs` and `maxMapBytes`.
  - Only one executor ID can be bound per robot (`EXECUTOR_ALREADY_BOUND`).
  - `transport:"mqtt"` is refused natively (`TRANSPORT_UNSUPPORTED`) because there is no MQTT client on the tablet.
- **Journal** (`mekoniq-executor.db`, `synchronous=FULL`).
  - The executor records the command ID, hash, control epoch and the `sending` state **before** the goto. It records the receipt and observations after.
  - On open, a row still `sending` becomes `unknown/CRASH_BEFORE_RECEIPT` and is never resent.
  - A control epoch older than the stored one is refused (`STALE_CONTROL_EPOCH`). One more than the stored epoch is accepted as a handoff; anything further ahead is refused (`CONTROL_EPOCH_OUT_OF_RANGE`) and never persisted, so one bad client value cannot fence out later commands. Re-provisioning after handoffs raises the stored epoch, never lowers it.
- **Service.** The foreground `ExecutorService` keeps polling and journaling while the UI is suspended.
  - If the UI lease (any bridge call) lapses and the policy is `stop`, every open goal that was never stopped is stopped. That includes `unknown` goals (`NO_ACK`, or `CRASH_BEFORE_RECEIPT` after a START_STICKY restart with no UI), which are exactly the goals that may be driving. The stop is journaled (`stop_state='pending'`) before the STOP goes out; the goal becomes `unknown/LEASE_LOST_STOPPED`.
  - A STOP that is not acknowledged stays `pending` and is resent on every tick until Valetudo answers 200. STOP is safe to resend; a goto never is.
  - A goal the native side still holds open after the shared rule completed it costs one harmless STOP to an idle robot.
  - The native side never reports `completed`. Arrival is judged from the journaled evidence by the shared TypeScript rule once a live UI reconciles.
- **Cancel vs STOP.** `cancel(commandId)` marks only that command. An operator `requestStop` and the lease-loss stop are robot-wide, because a robot has one physical motion whichever row started it.
- **Robot errors.** `submit` refuses a robot whose fresh status is `error` (`ROBOT_ERROR`) before any goto.
- **Cleartext.** Valetudo serves plain HTTP. Release builds keep cleartext disabled. The debug build only permits `10.0.2.2` (the host protocol emulator) through `network_security_config_debug.xml`. **A venue deployment needs a decision here:** a release network-security config that lists the robot's provisioned host, or TLS in front of Valetudo. This is open.

## Supervised hardware proof (blocked_external)

Run this on the named robot model and firmware, on the venue LAN, with a supervisor at the robot. Record the results in the commissioning evidence (W06-T05) before raising `validation`.

1. Record the fixtures (`/api/v2/robot`, capabilities, attributes, map, host info) from the robot and diff them against `tests/fixtures/valetudo/`.
2. Check that the firmware exposes `go_to_target` while a GoTo runs and clears it at the end, and which status it ends in. If it does not expose `go_to_target`, the profile cannot confirm arrival.
3. Measure and set the tolerances: arrival repeatability, pose noise while stationary, telemetry latency and the poll interval.
4. Exercise STOP and cancel mid-trip, unplugging the AP, rebooting the robot mid-trip, a map reset or relocalize, and a stale goal. Confirm there is no false `completed`, no second goto, and that the next goal waits for stationary evidence.
5. Decide cleartext versus TLS for the release build, and the lease-loss policy for this venue.
6. The spec rules still apply. A Valetudo profile does not prove independent safety and is limited to approved supervised commissioning. It does not by default meet the requirement to carry 20–30 kg among guests.

## Tests

```sh
pnpm test:adapters -- tests/adapters/valetudo-conformance.test.ts      # REST emulator + MQTT fake broker + native bridge fake
VALETUDO_EMULATOR_PORT=18765 pnpm exec tsx tests/support/valetudo-rig.ts   # host emulator for the AVD (prints url + fingerprint)
apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest --max-workers=1 \
  -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.ValetudoExecutorRecoveryTest \
  -Pandroid.testInstrumentationRunnerArguments.valetudoEndpoint=http://10.0.2.2:18765 \
  -Pandroid.testInstrumentationRunnerArguments.valetudoFingerprint=<printed fingerprint>
```
