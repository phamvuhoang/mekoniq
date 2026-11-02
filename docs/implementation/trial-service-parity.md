# `trial-service` parity: trial baseline behaviour -> production test and setting

Reference: trial baseline `5eda9b7c89d8c386891b79d56f5a9196afa23143` (read-only), capability matrix row "Tương đương trial (`trial-service`)". The trial code under `../trial` was read for behaviour only; nothing here imports its runtime state.

Status values: **covered** (a test in this repo asserts it), **partial** (part asserted, the rest named), **gap** (no production behaviour or no test; do not claim parity). A "covered" row proves software behaviour on fixtures and simulators only. It says nothing about a physical robot, tablet or Wi-Fi, and Gate B is BLOCKED (`gates/B-pilot.md`).

## How the preset is selected (settings only, same build)

Legacy flag -> independent feature key (`trialFlagFeatures` in `packages/domain/src/policy/presets.ts`, applied by `Configuration.Apply`; dependencies are added, never silently):

| Trial flag | Production key | Notes |
| --- | --- | --- |
| (always) | `fleet`, `fulfillment`, `robot.delivery` | the `trial-service` base profile; `robot.bussing` is in the base profile too |
| `busRobot` | `robot.bussing` | `busRobot=false` switches bussing off (baseline site); a pre-v2 site defaulted it on |
| `callStaff` | `guest.call` | pre-v2 `call` meant callStaff + requestBill |
| `requestBill` | `guest.bill` | an alert only |
| `guide` | `robot.guide` | needs `fleet` |
| `order` | `robot.order` (+ `catalog`, `sessions`) | robot-screen ordering; `qr.order`, `kiosk.order`, `pos.order` are separate flags and stay off |
| `pay` | `payment.transfer.manual` (+ `billing`, `orders`, `catalog`) | the trial's staff-verified transfer. `payment.transfer` is the bank-integrated path (readiness `bank`, never ready) and is NOT enabled. The earlier mapping `pay -> payment.transfer` was changed for this reason |

Off in the preset (and asserted off): inventory, procurement, loyalty, reservations, chain, online, promotion, providers, e-invoice, POS ordering, KDS, printing, cash shifts.

## Behaviour table

| # | Trial baseline behaviour | Production setting | Test | Status |
| --- | --- | --- | --- | --- |
| 1 | Stations/tables/dock as points, imported read-only | `Trial.ImportPreview/Apply` | `trial-config-import.test.ts` "baseline site imports points and robots..." | covered (config only) |
| 2 | Floor plan, route graph, x/y coordinates | not importable: no map identity | import report lists `floor`, `map`, `points.*.x/y` as unmapped | gap by design: operator re-teaches with `Robot.BindMap` |
| 3 | Robot identity, dock, driver (`valetudo`, `sim`) | imported robot, `integration_tested`, never dispatchable | `trial-config-import.test.ts` "imported robots are not dispatchable...", `pilot-service.spec.ts` | covered |
| 4 | Unknown driver | refused | `trial-config-import.test.ts` "an unknown driver is refused..." | covered |
| 5 | Teaching points / MQTT topic (`valetudo.points`) | not imported; need map identity | import report unmapped list; stale references block | covered (refusal), teaching itself = gap until hardware |
| 6 | Multi-table delivery with queued work | `fleet`, `robot.delivery` | `mission-queue.test.ts`, `simulated-delivery.test.ts` | covered (simulator) |
| 7 | Trays / payload limits | robot manifest, admission | `robot-admission.test.ts` "payload, speed, footprint and capability..." | covered (simulator) |
| 8 | Tray confirmation / hand-off at the table | `Mission.ConfirmStop`, `Fulfillment.HandOff` | `simulated-delivery.test.ts`, `kitchen-allocation.test.ts` | covered (simulator) |
| 9 | Cancel while loaded returns the cargo | `Mission.Cancel` | `simulated-delivery.test.ts` "cancel loaded mission...", `mission-queue.test.ts` | covered (simulator) |
| 10 | Bussing / clear a table, dishes go to the dish point | `robot.bussing` | `guest-boundaries.test.ts` "a loaded bussing mission routes a cancel to unload...", preset spec (off with `busRobot=false`, API `FEATURE_DISABLED`) | partial: flag gating covered; dish-point routing not asserted |
| 11 | Call robot / guest guide to a table | `robot.guide` | `guest-boundaries.test.ts` "guide missions need a known destination...", preset spec (off by default) | partial: no end-to-end guide on a bound map |
| 12 | Call staff alert, dedupe per table/type | `guest.call` | `guest-boundaries.test.ts` "service calls coalesce...", preset spec (accepted when on, `FEATURE_DISABLED` when off) | covered |
| 13 | Bill request is an alert, never settles | `guest.bill` | `guest-boundaries.test.ts` "acknowledging a bill request never closes...", preset spec (no bill/payment created) | covered |
| 14 | `callStaff` off / `requestBill` on independently | independent keys | preset spec baseline (both off) and demo (both on); mixed combinations are not run | partial |
| 15 | Menu -> order on the robot screen | `robot.order` | `guest-boundaries.test.ts` "robot-screen ordering follows the paired robot...", preset spec (screen offered only when on) | partial: order from a robot at a table not driven in the preset spec |
| 16 | Menu, categories, integer prices | menu kept as an unpublished draft | `trial-config-import.test.ts` "the demo menu is kept as an unpublished draft..." | partial: publish to the catalog is a separate manager step, not run |
| 17 | Pay: customer says "I paid"; staff verify | `payment.transfer.manual`, `Payment.Claim`, `Payment.VerifyManual` | preset spec "pay branch" (claim leaves the bill unpaid; guest and cashier refused; manager attestation captures once; retry not doubled), `basic-settlement.test.ts` | partial: covered only with the extra setting `qr.order` (a deviation from the pure preset, used so a bill can exist without a POS; the robot-screen order path needs a robot at the table and is not driven) |
| 18 | Bank / account / name shown to the guest | not imported (`payment` is unmapped) | import report | gap: no production setting for the transfer instructions |
| 19 | Prepare a bill from the open orders of a table | `billing` | preset spec pay branch (`Bill.Prepare`), `financial-lifecycle.test.ts` | partial: the bill is created from a QR guest order, which needs the extra setting `qr.order` outside the pure preset |
| 20 | Close refused while the table has new orders or a delivery heading there | not asserted for the preset | none | gap |
| 21 | UI shows only enabled functions | `screenFeatures` in `apps/tablet-web/src/router.ts` | preset spec baseline and demo (navigation and direct URL) | covered on the tablet web UI; Android native shell not run. `/robot-screen` stays whenever `fleet` or `robot.order` is on (status and safety notice always render; only guest ordering follows `robot.order`) |
| 22 | API refuses disabled functions | per-command feature guard | preset spec baseline (`FEATURE_DISABLED` for 8 commands) | covered |
| 23 | Pre-v2 `features.call`, `busRobot` default on, schema marker | import migration | `trial-config-import.test.ts` "legacy features map...", `schema.migrated` | covered |
| 24 | Runtime state (missions, orders, bills) is never carried over | import rejects it, zero effects | `trial-config-import.test.ts` first test, `pilot-service.spec.ts` | covered |
| 25 | Retarget a delivery on the way | `packages/domain/src/fleet/retarget.ts` | not asserted by this task; `table-order-amendments.test.ts` and `tests/adapters/valetudo-conformance.test.ts` mention retargeting but were not reviewed for parity | gap (unverified) |
| 26 | Slow mode / speed limit | speed control capability | `robot-admission.test.ts` "an admitted speed limit reaches every robot command" (simulator); Valetudo cannot control speed | partial: no guest slow-mode screen |
| 27 | Customer cancel policy `request` / `direct` | none | none | gap: no production setting; import reports `customerCancel` unmapped |
| 28 | Request station per site (`service.requestStation`) | none | none | gap: alerts go to staff screens; routing to a named station is not configurable |
| 29 | Timing (`loadSec`, `handoffSec`, `remindSec`, `standbySec`, battery thresholds) | recorded on the `trial-import` record only | `trial-config-import.test.ts` (recorded values) | gap: nothing enforces them yet; robot manifests carry their own `minBattery` |
| 30 | Role tabs (kitchen, bar, dish, manager) | production RBAC | `device-status.spec.ts` chef route guard; roles are reported unmapped | partial: roles are not migrated |
| 31 | Alerts and KPI dashboard | not in the preset (`reporting` off) | none | gap |
| 32 | Valetudo MQTT control and telemetry | adapters | `tests/adapters/*` belong to W06-T02 (blocked_external for hardware) | not this task; hardware unproven |
| 33 | One control source at a time | executor binding, epoch fencing | `pilot-service.spec.ts` | partial: software fencing only; trial-vs-platform exclusivity is a cutover procedure |

## Limitations of this run

- The development lab always starts from the restaurant fixture venue (tables `table-1/2`, stations `kitchen/bar/wash`, simulated robot `sim-1`). Cloud enrollment of an EMPTY venue and pairing real tablets cannot be driven in the dev lab, so the preset spec uses the real configuration commands (`Trial.ImportPreview/Apply`, `Configuration.Apply`) on that venue. Enrollment of a brand new venue is not exercised here.
- Imported demo robots (`R1..R3`) carry no driver and become simulators; they have no map or bindings and are refused by admission.
- The preset spec does not drive a robot trip: dispatch needs a bound map and a commissioned profile that do not exist for imported robots.
