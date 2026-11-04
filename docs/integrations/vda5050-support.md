# VDA 5050 support

**Pinned version: 2.0.0, protocol emulator only.** Profile `vda5050-2.0.0` (`kind: robot-protocol`, `mode: simulation`, `integration_tested`). Not hardware validated; no vehicle, factsheet, broker or trace has been used. The plan's "VDA 5050 3.x research baseline" is **not** implemented: a version needs its own pinned official schema and profile, and the rig fails its prerequisite for any version but 2.0.0 (`createVdaRig({version:'3.0.0'})`).

## Subset implemented (`packages/robot-adapters/src/vda5050/`)

| Area | What is done |
|---|---|
| Topics | `uagv/v2/<manufacturer>/<serialNumber>/{order,instantActions,state,connection}`; vehicles are isolated by manufacturer + serial; messages for another vehicle are dropped and counted |
| Order | one stop = one order (`orderId` = mission, `orderUpdateId` = mission revision), nodes at even sequence ids starting at the vehicle's current node (an update starts at `lastNodeSequenceId`), one odd-numbered edge with `maxSpeed` from the mission's speed limit; the target must be a node id (`locationRef`), never a coordinate; not retained, QoS 1 |
| State | structural validation of the fields we rely on; completion = same `orderId` **and** `orderUpdateId`, `lastNodeId` = target, no remaining nodes/edges, not driving, every action finished; FATAL error or FAILED action = failed; `order*` FATAL error right after dispatch = rejected |
| Ordering | duplicate / out-of-order (header id and timestamp) / retained / wrong-version / malformed messages are dropped and never complete anything; a header-id restart with a newer timestamp is a controller reboot → running missions become `unknown` |
| Instant actions | `cancelOrder` (finished = cancelled, failed = not cancelled, unanswered = unknown), `startPause` as the stop *request* (`physicalStopConfirmed` is always false — the E-stop stays hardware), `stateRequest` builder |
| Connection | `ONLINE` / `OFFLINE` / `CONNECTIONBROKEN`; nothing is sent when not online; a broken connection turns running missions `unknown` until fresh state resumes them |
| Claims | `executor: 'native'` (production mutations go through the native executor's journal); validation above `integration_tested` is refused by the constructor |

## Assumptions to verify on a real vehicle (not facts)

1. The first order of a mission may carry any non-negative `orderUpdateId` (we send the mission revision). Some controllers want 0 for a new `orderId`.
2. Two-node orders (current node → target node) are enough; vehicles that need intermediate nodes/edges must have them in their own master-control graph and a profile that says so.
3. Rejections surface as `order*` errors in the next state message.
4. 2.0.0 field list in `orders.ts` / `state.ts` was written from the public specification by hand; the official JSON schemas have not been loaded here.

## Not done — inputs a person must supply (profile `vda5050-2.0.0` draft requirements)

- The official pinned schema files and the exact spec version the vendor implements (2.0.0 / 2.1.0 / 3.x), the vehicle's **factsheet** and a **recorded trace**.
- A LAN MQTT broker with per-vehicle ACLs on the venue network, and the native MQTT transport in the executor (the TS adapter speaks to the `Vda5050Transport` port; the emulator rig implements it in memory). A cloud-only broker means `offlineExecution: false`.
- Supervised runs on the real vehicle (navigation, cancel, broker reconnect, reboot, map change, obstacle, E-stop) with evidence in `docs/implementation/evidence/`, then `hardware_validated` / `venue_approved`.
