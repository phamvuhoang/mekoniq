# W05–W06 review repairs

The nine review findings are repaired on the existing production branch. This is software regression evidence; Gate A/B and physical robot qualification remain unchanged.

## Findings and regression evidence

| Finding | Observed failure before repair | Repair and covering tests |
|---|---|---|
| R1 Traffic | Concurrent dispatch executed both robots (`[1,1]`) although the second explicit reservation was `pending/ZONE_SERIALIZED`. | Every restaurant decision that issues movement acquires a conservative venue movement reservation in the same command transaction. All contenders mutate a shared per-zone aggregate, including initial empty-zone contention. Dispatch requires the granted fallback reservation and holds pending/unknown granular reservations. Known-idle mission completion releases/promotes the fallback; unknown holders remain held. `robot-review-repairs.test.ts` covers explicit conflict, TTL/unknown, concurrent unmapped missions, normal completion promotion, and original-command dispatch once. |
| R2 Retarget | Real `Session.Move` through runtime/native transport produced STOP ACK then permanently failed the replacement effect. | Valetudo exposes its local execution hold before the dispatcher claims an unsent command. Cancellation/stationary evidence releases the hold; STOP ACK alone does not. The replacement payload, ID and expiry are unchanged. Real order→kitchen→allocation→mission→move regression checks `goto:table-1, stop, goto:table-2`. |
| R3 Recovery | Reloading after a confirmed effect produced no completion and no original mission identity. | Runtime restores accepted/unresolved active commands from durable effects before telemetry. Adapter binds native hash, target and full command identity; rejected, mismatched, stale or unbound evidence cannot complete/replay. Forward failures retain original event identities for retry. Superseded commands are restored only while their replacement remains unsent. Tests cover unresolved effects, failed completion commit, invalid hash/native rejection/epoch/owner, and retarget→replacement→reload→completion→next mission. |
| R4 Guest uncertainty | A real SQLite-committed order with a lost relay receipt appeared `unreachable` after relay expiry. | Expiry displays `unknown`; pending/unknown orders protect the original operation and block replacement submissions. The late definitive receipt recovers the original order with exactly one kitchen ticket. Guest browser disables new ordering while unresolved and no longer claims non-delivery. |
| R5 Maintenance | Guest alias reached `GUEST_TOKEN_REQUIRED` during draining instead of `MAINTENANCE_DRAINING`. | Full-shutdown preparation covers `Guest.PlaceOrder`, `Mission.Guide`, `Mission.Bus` and additive `Order.Amend`. Cancellation amendment and STOP paths stay outside the new-work guard; cloud-only mode is unchanged. `maintenance-checkpoint.test.ts`. |
| R6 Split | Two coupons 99999 + 100001 against 100000×2 split into `[-1,1]`. | Allocate positive charge capacity first, then constrain reversals to the remaining capacity of each child line. Preserve each original charge, component total and money unit. Quantity/equal zero-total children now `[0,0]` and close normally. Mixed remainder-heavy fixed coupons, service/tax and existing quantity/equal cases remain conserved. |
| R7 Revenue | Prepared-bill tender replacement reported net 40000/returns 10000 for a closed 50000 bill. | Revenue returns count only applied refund amounts whose stored `billStatus` is `closed`. Prepared tender reversals remain cash-flow refunds. Exact regression returns net 50000/returns 0/refund 10000/reconciliation difference 0; existing post-close and unapplied refund coverage passes. |
| R8 Seating | Empty staff UI had no “Open table session” action; browser timed out waiting for it. | Authorized guest-request screen offers `Session.Open` on free configured tables, refreshes before token creation, and refreshes conflicts. No POS order is required. Robot-only ordering exposes this route; disabled sessions hide opening and occupied tables offer their existing seating. Browser creates the first seating through UI with POS disabled. |
| R9 Cart | After accepted kiosk order, the replacement UI retained one visible cart line. | Accepted draft clears before screen refresh. In-flight editing is guarded; empty/repeated submissions are blocked. Unknown/rejected results retain cart and operation ID. Browser covers kiosk and robot accepted empty cart/send disabled, plus a lost committed reply retried under the same ID with one order. |

## Focused verification

Runtime: first R7 RED/GREEN used the available Node 26.3.0. Subsequent runs use Node 24.22.2, matching the release major:

```sh
export PATH=/Users/hoangpham/.npm/_npx/e524fa135108820b/node_modules/node/bin:$PATH
pnpm exec vitest run tests/integration/robot-review-repairs.test.ts tests/integration/robot-admission.test.ts tests/integration/table-order-amendments.test.ts tests/adapters/robot-dispatch.test.ts tests/adapters/valetudo-conformance.test.ts tests/integration/financial-lifecycle.test.ts tests/integration/sales-reconciliation.test.ts tests/integration/maintenance-checkpoint.test.ts tests/integration/guest-cloud.test.ts
```

Result: **9 files, 112 tests passed** (8.33 seconds).

- `pnpm typecheck`: passed after correcting a test fixture's inferred optional JSON fields.
- Scoped ESLint on the changed runtime, domain, dispatcher, tablet and new regression files: passed.
- `pnpm exec playwright test tests/e2e/guest-review-repairs.spec.ts tests/e2e/guest-table.spec.ts`: initial kiosk/uncertainty coverage **2 passed**, 22.0 seconds.
- Expanded `pnpm exec playwright test tests/e2e/guest-review-repairs.spec.ts`: **3 passed**, covering kiosk/robot, receipt-loss retry, POS-disabled, robot-only and sessions-disabled surfaces. One intermediate run had only an ambiguous heading selector; narrowed to level 2.
- Parent's independent Python fixture/contract run: **178 passed** (reported 0.96 seconds).

The parent completed combined TypeScript suites, contracts/lint/build and all E2E verification below. No Kotlin/native schema changes were needed.

## Scope and external gates

The preexisting fleet footprint/leg-check and amendment changes were preserved. No `trial/`, `web/`, operational ports, robot endpoints, deployment, staging, commits or push were touched by the implementer. `next-env.d.ts` is generated by Next.js test startup and must remain at its pre-task user version, outside this commit.

Movement without a proven route-zone mapping is conservatively serialized for the venue and held through the mission, reducing throughput. Existing in-flight commands without a reservation are not newly sent by replay; native evidence can still reconcile already accepted work. Recovery tests replace physical I/O/native journal reads only; they exercise the production SQLite store, coordinator commands, transport, Valetudo adapter and runtime. They do not establish native-device or physical arrival acceptance. Unknown evidence and expired original commands require reconciliation; the repairs do not create replacement goals automatically.

## Scoped review follow-up: recovery while cancelling

Independent review reproduced a FIFO starvation case: after `Mission.Cancel` committed but before STOP dispatch, reloading recovered an older native acceptance. The domain correctly rejected it with `CANCELLATION_RECONCILIATION_REQUIRED`, but retaining that permanently inapplicable acceptance at the queue head prevented the later stationary `cancelled` event from reaching the mission.

Added a real runtime regression with the exact reload window. RED: native reconcile was `cancelled` while mission remained `cancelling`. The forwarder now treats only recovered acceptance/progress rejected for this cancellation disposition as definitively inapplicable and removes them from the queue. Transient failed commits retain the same original event for retry; that regression still passes.

Node 24 commands:

```sh
pnpm exec vitest run tests/integration/robot-review-repairs.test.ts -t 'recovered acceptance during cancellation'
pnpm exec vitest run tests/integration/robot-review-repairs.test.ts tests/adapters/valetudo-conformance.test.ts
```

First command failed before the fix at the expected mission-status assertion. After the fix, covering suites: **2 files, 34 passed** (10 runtime review regressions + 24 Valetudo conformance). Final isolated check changed only the runtime forwarder, its regression and this evidence/report; no servers, native files or physical I/O were used.

## Final independent review and verification

Scoped independent review confirmed all nine findings addressed, with no remaining Critical/Important regression. It caught the R3 cancellation-forwarding case documented above; the implementer reproduced it, added the regression, and the reviewer verified the narrow correction.

Final code runtime: Node **24.22.2**, pnpm **10.32.1**. Cloud tests used the isolated local Supabase instance with `npm_config_loglevel=error pnpm_config_loglevel=error`.

| Command | Final result |
|---|---|
| `pnpm exec vitest run tests/unit tests/contracts tests/integration tests/adapters` | **62 files, 362 passed**, 69.10 seconds, after the final R3 correction |
| `pnpm exec playwright test` | **23 passed, 1 skipped**, 35.2 seconds; skipped physical pilot prerequisite remains unchanged |
| `.venv/bin/python -m pytest robotics/agent/tests tests/hardware tests/contracts/test_schema_python.py -q` | **178 passed**, Python 3.13.3 local runtime |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm contracts:check` | Generated contracts match schema |
| `pnpm build` | Passed: cloud, tablet, packages and Capacitor asset sync; no Gradle/device qualification claimed |
| `git diff --check` | Passed |

The complete browser run preceded only the final three-line native event disposition correction; its 34 covering native adapter/runtime tests and the final 362-test suite passed afterwards. Existing user footprint checks are included. The unrelated initial `apps/cloud-web/next-env.d.ts` content was restored exactly and excluded from the commit. Integration follows the user's explicit instruction to commit the repairs and push `feat/w05-w06-pos-real-robots`; no merge, deployment or hardware-gate promotion is part of this repair.
