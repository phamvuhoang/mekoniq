# Domain review fixes: issues 8–11

Date: 2026-10-31. Base: `1713276`, branch `feat/w00-w04-production-foundation`.

## Reproduction and root causes

The initial command was:

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/domain-review-regressions.test.ts
```

**RED: 4 failed, 1 passed.** Each failure came from real commands through the production registry and SQLite-backed restaurant fixture, rather than a mocked decision.

- **8 — cargo:** the first handoff already retained the other table's cargo at this HEAD (passing baseline). The first return to one source unconditionally cleared `mission.loaded` while another source allocation remained loaded. Cancellation trusted that cache. Stop confirmation now derives onboard cargo from allocations including the transaction's allocation changes; cancellation and cancellation observations also inspect allocations. Tests cover kitchen/bar loads, two tables, multiple returns, a deliberately stale false cache, repeated cancellation, and release only after all cargo returns.
- **9 — reconciliation:** `Mission.Create` persisted the active command on `mission` and `robot-command`, while reconciliation looked only on `robot`; the failing challenge had `commandId:null`. Challenge creation now resolves and cross-checks that durable identity. Proof verification also checks it is still current. A real mission's signed executor proof is accepted while the active mission continues to hold the robot; existing malformed/stale/replayed-proof tests remain green.
- **10 — money:** amendment added authoritative quote units to the old total without comparing currencies. A VND order accepted USD menu lines. It now rejects `CURRENCY_MISMATCH` before producing events; order, ticket count, and fulfillment remain unchanged.
- **11 — import:** duplicate payment references were checked during validation only. Two batches approved before either applied could both record the reference. Apply now rechecks current historical receipts inside its existing universal read-set/CAS transaction. Sequential stale approvals and concurrent applies both retain one financial source; retry rejects the losing batch without advancing its cursor.

## Verification

**GREEN: 34 tests in 11 files**, including historical-import SIGKILL/resume, mission queue, reconciliation signatures, order lifecycle, immutable menu snapshots, kitchen allocation, simulated delivery, settlement, and WAN-outage journey:

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/domain-review-regressions.test.ts tests/integration/mission-queue.test.ts tests/integration/robot-reconciliation.test.ts tests/integration/historical-import.test.ts tests/unit/restaurant-domain.test.ts tests/integration/order-lifecycle.test.ts tests/integration/menu-snapshot.test.ts tests/integration/kitchen-allocation.test.ts tests/integration/simulated-delivery.test.ts tests/integration/basic-settlement.test.ts tests/integration/wan-outage-journey.test.ts
```

`pnpm typecheck` and ESLint on the four changed domain modules plus the new regression file pass. These results verify TypeScript domain behavior with SQLite and the simulator. Android execution, physical robots, AP behavior, and soak qualification were not run for this repair.
