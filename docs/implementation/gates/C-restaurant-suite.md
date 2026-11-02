# Gate C — restaurant suite (inventory, procurement, workforce, promotions, loyalty, bookings, pricing models)

Status: **SOFTWARE-VERIFIED LOCALLY — NOT ACCEPTED for production.** Gate C (plan §2) covers F16–F22 and F26 as workflows with ledger, report and UI. Every row below has a test that ran against the SQLite restaurant lab (and, for the cloud relay, the local Supabase). Nothing here was run on a tablet, with a scale, a printer, a payment provider or a real venue's data, and the mandatory Gate A / Gate B device evidence (`A-continuity.md`, `B-pilot.md`) is still blocked externally. A row is "verified_local", never "accepted".

## F16–F22 and F26 against the evidence

| ID | Workflow the gate needs | Real workflow test (this repo) | State |
| --- | --- | --- | --- |
| F16 | Booking without double-booking; hold lapses without releasing unknown money; deposit is a liability, applied to a bill once, returned/forfeited by explicit decision; check-in opens the table session; waitlist in order | `tests/integration/reservations.test.ts` (13) | verified_local |
| F17 | Deterministic promotions (priority, exclusion, cap, venue-time windows); single-use voucher spent once under concurrency; refund restores usage only under the snapshot policy; shared voucher denied offline without an exclusive allocation | `tests/integration/voucher-limits.test.ts` (12), `cloud-backoffice-relay.test.ts` | verified_local |
| F18 | Points only from a captured settlement, once; reversal bounded by the refund; consent versioned and withdrawable; duplicate phone never auto-merged; erasure keeps the financial ledger; chain balance not spent offline | `tests/integration/loyalty.test.ts` (10) | verified_local (chain-wide settlement of pending points is W09-T02) |
| F19 | Stock leaves once per prepared source event at the recipe version of that time; cancelled prepared food is waste, never restock; stocktake adjusts by delta at the checkpoint | `stock-consumption.test.ts` (12), `stocktake.test.ts` (10) | verified_local |
| F20 | Supplier delivery note unique; partial receipts bounded by the order (+ approved tolerance); returns at the receipt's cost; weighted-average cost | `procurement.test.ts` (9) | verified_local |
| F21 | Immutable punches, manager amendments beside them, permissions only through the identity workflow; not payroll | `workforce-reporting.test.ts` (11) | verified_local |
| F22 | Stock, food-cost and attendance reports reconcile to the ledger and disclose missing/estimated cost and stale/unsynced data | `workforce-reporting.test.ts`, `restaurant-models.test.ts` (price basis) | verified_local |
| F26 | Weighed (integer mass), combo (exact component shares incl. discount), buffet (package order + timer + clock evidence) priced and reported as distinct models; templates for cafe / table service / buffet / robot-only / no-robot / chain | `tests/unit/restaurant-models.test.ts` (8), `tests/integration/restaurant-models.test.ts` (7), `tests/e2e/restaurant-presets.spec.ts` | verified_local |

## Wave acceptance statements

- **Source id and recipe snapshot hold, including historical import:** a historical consumption whose recipe version is gone opens a `stock-exception`; it never uses today's recipe and never moves stock (`stock-consumption.test.ts`).
- **Stocktake never overwrites movements between count and apply** (`stocktake.test.ts`: 10000 − 400 sold − 200 short = 9400).
- **Workforce is not payroll:** reports say so (`basis`), nothing computes pay/tax/overtime (`workforce-reporting.test.ts`).
- **No shared points/voucher spent offline without an exclusive allocation:** vouchers need `GrantEscrow`; chain-scope loyalty accounts deny redemption and keep earnings `pending`.
- **A deposit is a liability, not revenue counted twice:** receipt moves the drawer, not sales; applying it is a tender on the bill; revenue is recognised once at `Bill.Close` (`reservations.test.ts`).
- **Presets enable only implemented modules:** `IMPLEMENTED_FEATURES` (guarded against the command gates by a unit test) is the list; `chain` is a one-branch template that reports `chain` and `online` as deferred; the preview never applies and never enables a missing module. `trial-service` is unchanged (`restaurant-presets.spec.ts`, plus the W06-T06 specs).

## What this gate does NOT establish

- Gate A (physical Android pair, 24 h soak) and Gate B (commissioned robot) remain blocked externally; Gate C's offline claims are software fault-injection only.
- Physical scale, label printer, barcode scanner, stock-count devices, time-clock hardware: none exist; the weighed model accepts only keyed weights (manager approval) or a scale profile a venue approved — a `scale` snapshot is not created by any code here.
- No payment provider / e-invoice / marketplace connector (W10); deposits and refunds of deposit tenders are staff-attested cash/manual transfer.
- Chain-wide rollout, consolidated reporting and shared-balance authority (W09) do not exist; the `chain` template is a single branch.
- The Next.js back-office pages (`/admin/operations`, `/admin/promotions`, `/admin/customers`, `/admin/reservations`) compile and their relay/read paths are tested, but no browser test drives them with a signed-in user.
- Kotlin `LanService.kt` visibility sets were edited for the new aggregate kinds; Kotlin was not compiled or run.

## To close Gate C

1. Gate A and B accepted (or explicitly waived by the release authority for a software-only pilot — a decision, not something this document grants).
2. Run the suites above on the release build with the pilot venue's real catalogue (recipes, suppliers, promotions) in a dry-run import; review `stock`, `food-cost`, `attendance` and `sales` reports against the venue's paper figures for one week.
3. Browser-test the four back-office pages with an owner and a manager account against the hosted-profile Supabase.
