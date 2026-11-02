# W05–W06 Review Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Correct all nine confirmed W05–W06 review findings, verify the integrated behavior, and push the reviewed feature branch.

**Architecture:** Keep venue commands transactional through the existing coordinator, side effects through the durable outbox, and robot completion dependent on native evidence. Repair boundaries between existing components rather than introducing alternate business paths.

**Tech Stack:** TypeScript, SQLite, Next.js, Vite DOM UI, Kotlin/Capacitor, Python/Nav2, Vitest, Playwright.

**Spec:** [Production](../specs/2026-10-30-production-platform-design.md), [continuity](../specs/2026-10-30-offline-continuity-design.md), [capability matrix](../../product/2026-10-30-capability-matrix.md), [master plan](2026-10-30-production-implementation-plan.md).

## Global Constraints

- “Xây lại mã trong `source`; `trial` là nguồn tham khảo hành vi, không phải nhánh để sửa.”
- “Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.”
- “Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit.”
- “Tiền lưu số nguyên theo đơn vị tiền nhỏ nhất; VND là đồng. Không cộng tiền bằng float.”
- “Web/app cung cấp **yêu cầu dừng từ xa**, không phải E-stop vật lý được bảo đảm.”
- Work on `feat/w05-w06-pos-real-robots` from `ba045e8`. Keep the existing footprint/leg-check edits in mission.ts, retarget.ts, scheduler.ts and table-order-amendments.test.ts. Preserve the preexisting generated next-env.d.ts change without including it in commits.
- No trial services, operational ports 1880/1884, real robot endpoints, deployment, hardware claims or force-push.
- Keep Gate A/B and hardware qualification statuses unchanged. Verify with Node 24.22.2, provisioned locally for this repair; the system Node 26.3.0 is not the release runtime.
- Read apps/cloud-web/AGENTS.md and the relevant bundled Next.js guides before editing cloud code.

---

### Task 1: Repair the complete review finding set

One fix wave owns the interacting dispatcher, runtime and UI contracts. The implementer must fix all nine findings, preserve user edits, and leave the patch ready for independent review. No nested subagents. Root owns final commit/push after review.

**Files:**
- Robot: `packages/domain/src/fleet/{admission,reservations,mission,retarget,scheduler}.ts`, `packages/robot-adapters/src/{contract,dispatch}.ts`, `packages/robot-adapters/src/valetudo/{adapter,completion}.ts`, `apps/tablet-android/src/{robot-runtime,robot-executor-bridge}.ts`; native journal/bridge/storage files only if the durable contract requires them.
- Continuity: `packages/sync/src/command-processor.ts`, guest/service handlers as required.
- Financial: `packages/domain/src/billing/split.ts`, `packages/domain/src/reporting/sales.ts`.
- Guest: `apps/cloud-web/src/server/modules/guest/api.ts`, `apps/cloud-web/src/components/guest/TableSession.tsx`, `apps/tablet-web/src/screens/{GuestRequests,Kiosk}.ts`, route visibility if needed.
- Regression tests: existing robot admission/dispatch/Valetudo, financial lifecycle, sales reconciliation, guest cloud/boundaries, maintenance, guest E2E files; focused new test files allowed for integration regressions.
- Evidence: `docs/implementation/review-repairs-w05-w06.md` with findings, RED/GREEN commands, scope and remaining external gates.

**Interfaces:** Consume production command handlers, real SQLite lab, durable effect statuses, typed native ExecutorBridge and ValetudoAdapter, actual UI rendering. Keep historical command identity and money snapshots. Native doubles may replace physical I/O only; they must not fake the behavior under test.

- [x] **1. Add failing regressions, then implement each repair in small RED/GREEN cycles.** The nine acceptance cases below are mandatory. Expected numbers and states are independently derived.

  **R1 — Traffic enforcement:** Two non-zone-enforcing robots request the same zone; first gets granted, second pending/ZONE_SERIALIZED. Dispatching the second must make zero execute calls until safe release. Unknown holders never expire into movement. Cover real mission-to-dispatch wiring, not just Zone.Reserve. When a route lacks granular zone mapping, use a conservative venue-wide serialized movement boundary instead of treating missing reservations as permission. Concurrent dispatch cannot both acquire a conflicting movement right; STOP/cancel remain available.

  ```ts
  expect(secondReservation.value).toMatchObject({status:'pending',reason:'ZONE_SERIALIZED'});
  expect(secondExecuteCalls).toBe(0);
  // After evidence-backed release/promotion, the waiting original command executes once.
  expect(secondExecuteCallsAfterRelease).toBe(1);
  ```

  **R2 — Retarget sequencing:** Drive a real ValetudoAdapter through NativeExecutorTransport; Session.Move/retarget queues cancel(old) and execute(new). STOP request ACK alone must not permanently fail the replacement or admit movement early. Wait for cancellation/stationary evidence, preserve the original replacement command identity and expiry, then execute once. Timeout/unknown must remain held; do not blindly resend an ambiguous goto or weaken PREVIOUS_GOAL_ACTIVE/STOP_UNCONFIRMED.

  ```ts
  expect(callsBeforeStationary).toEqual(['goto:old','stop']);
  expect(replacementEffect.status).not.toBe('failed');
  expect(callsAfterStationary).toEqual(['goto:old','stop','goto:new']);
  ```

  **R3 — WebView recovery:** Restart startNativeValetudoRuntime after a confirmed native acceptance while mission remains executing. Recover the active command from durable data before polling; do not re-send goto. Native journal samples moving→stationary at target must produce a valid Robot.Observe that advances the original mission. Restore missionId/revision/controlEpoch and command hash, including unresolved-effect recovery. Rejected/stale/unbound recovery must remain held, and completed events must survive a failed forward/refresh rather than silently disappear.

  ```ts
  expect(nativeGotoCount).toBe(1);
  expect(completion.payload).toMatchObject({missionId,missionRevision:1,controlEpoch:1});
  expect((await lab.state('mission',missionId)).stops[0].status).toBe('awaiting_action');
  ```

  **R4 — Guest receipt uncertainty:** When the coordinator has committed a guest order but its relay receipt is lost, expiry must show unknown/unconfirmed, not claim non-delivery. Keep pending-order protection and original operation identity until the venue supplies a definitive receipt. Test late receipt recovery and the guest-facing state, including no invitation to submit a replacement order.

  ```ts
  expect(expiredPendingRequest.status).toBe('unknown');
  expect(await kitchenTicketCount()).toBe(1);
  ```

  **R5 — Maintenance aliases:** After Maintenance.Prepare(full_shutdown), reject new Guest.PlaceOrder, Mission.Guide and Mission.Bus with MAINTENANCE_DRAINING, as Order.Place and Mission.Create already do. Reject additive Order.Amend as new work if it would also bypass draining. Existing completion/cancellation/refund and STOP must remain usable. Cloud-only maintenance must preserve local operations.

  ```ts
  expect(result.code).toBe('MAINTENANCE_DRAINING');
  expect(newRobotCommands).toBe(0);
  expect(newKitchenTickets).toBe(0);
  ```

  **R6 — Nonnegative split bills:** A line priced 100000×2 with fixed coupons 99999 and 100001 has net 0. Quantity split, one unit each, must yield [0,0], preserving each charge total and all money components. Also test mixed lines and remainder-heavy discounts/taxes, including equal splits. Do not clamp/drop money or merely reject a valid split; apportion reversals within allocated positive capacity.

  ```ts
  expect(split.value.totals).toEqual(['0','0']);
  // Each child closes normally; totals and each original charge remain conserved.
  ```

  **R7 — Revenue vs tender reversals:** Bill50000 → cash50000 → refund10000 while prepared → terminal10000 → close. netMinor=50000, returnsMinor=0, cash-flow refund=10000, reconciliation difference=0. Post-close refunds must still reduce revenue, and unapplied overpayment refunds must not. Use Refund.Record's stored billStatus to distinguish the events.

  ```ts
  expect(report.totals).toMatchObject({netMinor:'50000',returnsMinor:'0'});
  expect(report.reconciliation).toMatchObject({expectedMinor:'50000',collectedMinor:'50000',differenceMinor:'0'});
  ```

  **R8 — Open a seating without a POS order:** Provide an authorized staff UI action for a free configured table that calls Session.Open and refreshes before issuing a QR/kiosk token. The guest's first order must not require a prior staff order or pos.order. Keep sessions and relevant channel policy/permissions; handle occupied/conflict states. Verify empty venue UI through Playwright without setup API Session.Open, including sessions enabled with pos.order disabled.

  **R9 — Guest cart acceptance:** Clear the accepted draft before refresh renders its replacement UI, while retaining contents and operation ID on unknown/rejection. After successful kiosk and robot orders, visible cart is empty and send disabled. A second click must never submit items:[]. Avoid refresh races erasing a newly edited draft.

- [x] **2. Run focused covering tests after each change.** Use `pnpm exec vitest run <changed tests>` and serialized Playwright runs; no parallel Next.js dev instances. Record the failing pre-fix assertion and successful post-fix results in the report.
- [x] **3. Complete cross-component verification.** Run typecheck, lint, contracts check, relevant full TypeScript suites, Python suites and selected E2E. If native files change, run the available local Gradle/JVM/build verification and describe any instrumentation prerequisite accurately. Do not claim physical acceptance from mocks or fixtures.
- [x] **4. Self-review and hand off.** Keep all nine findings traceable to tests. Write `docs/implementation/review-repairs-w05-w06.md` and the task report with exact commands/results and risks. Do not stage, commit or push from the implementer; root reviews the final diff, commits only the related files, then performs the user-authorized normal push.
