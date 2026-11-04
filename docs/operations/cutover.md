# Cutover from the trial system — one dispatcher at a time

The trial system (Node-RED on the robot's Android/Termux device) keeps running until this procedure says otherwise. **Never run both against the same robot.** The platform enforces this per robot (`control-owner`): a robot held by the old dispatcher gets nothing from this platform (`CONTROLLED_BY_OTHER_DISPATCHER`).

## Before (T-1 day, nothing live changes)

1. Dry-run the venue configuration import (`trial-config-import` — read-only; reports every source field it did not carry). Do not migrate running missions or bills.
2. Take a backup and verify it (`backup-restore.md`); note the newest entry time.
3. `pnpm release:dry-run` for the exact build; production gates must be `accepted` or the cutover is **not** allowed to be called production.
4. Commissioning of each robot profile (map binding, safety tests, signed venue acceptance) — outside this repository; a robot without it stays non-dispatchable.

## Cutover (venue closed or between services)

1. Close and reconcile the trial system's open bills and money; finish or cancel its missions and clear loads **by hand**, robot by robot. Write down who and when.
2. `Dispatcher.Hold` each robot (it now carries the old owner), so this platform cannot touch it by accident.
3. Stop the trial dispatcher: disable its flows, revoke its broker/robot credentials or close the broker to it. `Dispatcher.Fence {robotId, evidenceRef}` — the evidence is a pointer to the log/ticket showing step 3; a blank reference is refused.
4. `Dispatcher.Activate {robotId, newOwner:'production', trialReconciled:true}`. It refuses with `OLD_OWNER_NOT_FENCED` until step 3 is recorded and `TRIAL_NOT_RECONCILED` without the statement in step 1.
5. One supervised delivery with a person at the robot and the E-stop in reach; then the first shift (`first-shift.md`).

## Back-out (any time)

1. Stop dispatching: finish or cancel the robot's active missions and reconcile loads (`Dispatcher.Return` refuses `ROBOT_HAS_ACTIVE_MISSION` otherwise).
2. `Dispatcher.Return` hands the record back to the old owner (unfenced). Only then may the trial dispatcher be started again, by its owner.
3. **Never** restore an old financial snapshot over sales made since the cutover; money stays where it was recorded and is reconciled by hand.

Status: documented and exercised in software (`tests/acceptance/first-shift.test.ts`); not executed on a real venue.
