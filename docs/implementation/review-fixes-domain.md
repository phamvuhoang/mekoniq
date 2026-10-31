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

## Scoped issue 3 safety-transition parity

Checkpoint freshness and enrollment are revalidated at `Ownership.Fence`, `Ownership.Activate`, and `Maintenance.Enter(mode=full_shutdown)`, using the existing `deviceCheckpointComplete` rules and trusted `__scope__.authority.nowMs`. The shared inventory helper checks every currently active device's epoch, completeness, pending count, covered cursors, and expiry. A non-finite trusted clock fails closed. Preparation retains its existing diagnostics; its cached `cursorComplete` or checkpoint hash alone no longer permits these transitions. Ordinary order placement does not acquire this checkpoint prerequisite.

Reproduction used real SQLite-backed command processing, preparing valid checkpoints before advancing time, enrolling another active device, or changing an enrolled epoch. **RED: 8 failed, 2 passed**: Fence/Activate accepted all six changed inventories; full shutdown accepted expired checkpoints and a changed epoch; a newly enrolled device was already blocked by the maintenance hash, and ordinary orders already worked with an expired checkpoint.

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/safety-transition-checkpoints.test.ts
```

**GREEN: 14/14 tests, 3 files**, including existing successful signed handoff and shutdown flows:

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/safety-transition-checkpoints.test.ts tests/integration/ownership-handoff.test.ts tests/integration/maintenance-checkpoint.test.ts
```

This follow-up changes only `checkpoint.ts`, `handoff.ts`, `maintenance-window.ts`, its focused regression file, and this evidence section. No Android, physical-device, or additional broad qualification is claimed.

## Scoped issues 6/7 observation retry identity

Both signed-source ingesters derived a stable operation ID from the original entry ID but regenerated the command's authority fields on every retry. After an accepted response was lost and `Configuration.Apply` advanced policy revision, the existing durable receipt's strict command fingerprint rejected the reconstructed envelope as `IDEMPOTENCY_CONFLICT`.

The ingesters now validate the original journal, enrolled source epoch, and original signature first. They then look up the durable receipt by scope, original derived operation ID, and derived payload hash. A matching receipt returns its original result with `duplicate:true`; only a new source constructs an envelope using current authority. The ordinary command processor's strict fingerprint checks are unchanged.

**RED: 2/2 failed** with the expected idempotency conflict:

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/observation-retry.test.ts
```

The new SQLite-backed tests produce actual recipient-signed `SettlementGrant.Use` and `Continuity.CaptureTicket` journals, discard the accepted ingest response, apply configuration revision 2 through production command processing, then retry. Both return the original venue receipt and preserve journal length and one recovered fact. Invalid signatures retaining the accepted entry ID are rejected before and after the authority change.

**GREEN: 10/10 tests, 2 files** (including existing signed-closure, reconciliation, tamper, replay, and frozen-bill regressions):

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm exec vitest run tests/integration/observation-retry.test.ts tests/integration/settlement-grants.test.ts
```

This repair touches only the two observation ingesters, the focused test, and this evidence section. No Next.js, Android, physical hardware, or broad qualification was run for this follow-up.
