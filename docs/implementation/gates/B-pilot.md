# Gate B — first-restaurant pilot (POS + continuity + robot commissioning, one venue)

Status: BLOCKED

Gate B is **not accepted**. It is blocked on things software cannot supply: no physical hardware, no commissioned robot and no real-device O01/O10/O11 runs exist. Everything below that is marked "software" was run against fixtures and simulators and is **not** evidence for the gate. Gate B covers one restaurant, not all of Mmenu.

## Why it is blocked (external)

| Missing | Needed for | State |
| --- | --- | --- |
| Approved robot model + firmware + venue endpoint | any `hardware_validated` / `venue_approved` profile (R-W06-VALIDATION) | absent; W06-T02 and W06-T05 are `blocked_external` |
| Signed commissioning manifest and signed venue acceptance | dispatching any non-simulator robot | absent (synthetic TEST-ONLY fixtures only) |
| Supported Android tablet pair + venue LAN | O01 (WAN cut with two POS, KDS and a robot delivering), Gate A mandatory Android scenarios | not run |
| Supervised physical runs of O10 and O11 on the commissioned robot | executor death after goal accepted; old un-ACKed move command after recovery | only simulated/emulated so far |
| A map reported by the real robot and operator-taught waypoints | `Robot.BindMap` for the pilot venue | cannot exist before the robot does |
| Gate A passing | entry condition for B | Gate A is itself not accepted (`gates/A-continuity.md`) |

## What software has established (not evidence for this gate)

| Claim | Where |
| --- | --- |
| Trial configuration import is read-only, whitelisted, dry-run first; runtime state rejected; imported robots never dispatchable; duplicates refused | `tests/integration/trial-config-import.test.ts` |
| `trial-service` preset on the same build: UI offers only enabled functions, API refuses disabled ones, a guest "I paid" claim never settles | `tests/e2e/trial-service-preset.spec.ts`, `docs/implementation/trial-service-parity.md` |
| One control source, imported robots blocked, dossier cannot flip to PASS silently | `tests/e2e/pilot-service.spec.ts` (software-checkable parts) |
| Real-device part | `pilot-service.spec.ts` skips with `PREREQUISITE:` unless `MEKONIQ_PILOT_DEVICE` is set, and even then refuses to report a pass |

## Cutover checklist (to be executed at the venue; none of it has been)

Order matters. Stop at the first failed item and keep the trial in control.

1. [ ] Gate A accepted, and the W06-T02 / W06-T05 hardware evidence recorded for the pilot robot model and firmware.
2. [ ] Choose ONE control source for robot motion. Exactly one of `trial` (Node-RED) or the new platform may hold the robot; record which, and who can change it. Never let both issue commands.
3. [ ] Export the trial site configuration by hand (not by the importer). Run `node scripts/import-trial-config.mjs <export>` and review the report: rejected fields must be empty; read the unmapped list.
4. [ ] Close or reconcile every open trial mission and bill before the switch: finish or cancel each robot mission, settle or void each open bill on paper/ledger, and write the list down. The importer does not carry runtime state and will refuse it.
5. [ ] Snapshot the trial state (read-only copy) for the record. Do not copy Node-RED runtime context into production.
6. [ ] Apply the import (`Trial.ImportPreview`, then `Trial.ImportApply` as a manager), then choose the `trial-service` preset and the venue's flags with `Configuration.Apply`.
7. [ ] Commission the robot: it reports its own map, an operator teaches the waypoints with `Robot.BindMap` (explicit units and frame), and the signed profile raises validation. Until then every dispatch is refused.
8. [ ] Shadow mode is telemetry-only: the new platform observes robot state and trial missions without sending any command. Shadow-mode telemetry ingestion is **documented only** here; its implementation is deferred to W11.
9. [ ] Hand control to the new platform (one control source), run one supervised trip, check STOP and cancel, then open the cash shift.
10. [ ] Supervised O01 / O10 / O11 on the pilot tablets and robot; record device model, build, firmware, times and operator.
11. [ ] The actual cutover happens in W11, after the deploy result has been reviewed. Nothing in this wave runs `trial/scripts/deploy.sh`, touches trial ports 1880/1884 or any robot address.

## Rules for whoever fills this in

- Do not change the status line until every item above has recorded evidence from the real venue, robot and devices. `pilot-service.spec.ts` fails if this file claims a pass.
- Simulation, emulator and Gazebo results show behaviour of the software; they say nothing about payload, braking distance, safety certification or VDA compatibility.
- Absent evidence stays `not_run`; do not convert it.
