# Coffee domain remediation report — 2026-11-05

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

Scope: R01–R05; software BV02/BV06 capacity and headspace; BV04 measurement plausibility; BV08 milk policy; the explicitly reassigned deferred coffee conservation/authorization findings. No staging or commits performed. Root owns runtime export/commit/pin and acceptance ledger updates.

## Behavior implemented

- R01: absent cup observations persist. Before preparation they revoke verification and require a new bound cup observation. After preparation they hold the job; a positive presence report cannot silently resume an uncertain drink. Preparation, quality, pickup and manual handoff are blocked appropriately.
- R02: both pick and place check arm readiness, fault, cleaning and freshness before lease/effect creation. Mock arm periodically reports readiness so normal BV01 remains possible; root subsequently owns arm safety/collision changes.
- R03: only jobs not yet reflected in `ticket.prepared` consume additional order capacity. Sequential two-cup delivery and cancelled remakes conserve the ordered quantity.
- R04: repeated measured-ingredient steps get separate reservations. Explicit optional resource `allocations: [{stepId, amount}]` supports repeated brews whose measured volume cannot specify bean mass. Allocation totals must equal the declared resource requirement. Ambiguous missing allocation is refused before execution rather than inventing a mass/volume conversion. Consumption remains deduplicated by job, step and ingredient.
- R05: ordinary authorized `Fulfillment.HandOff` updates fulfillment, the exact coffee job, cell→human→customer custody, and all leases in one journal transaction. Missing cups and pending transfers reject the whole decision. Human provenance identifies the waiter and allocation. Mission handoff also refuses served quantity when its cup is not loaded on the specified robot.
- Coffee allocations now bind exact `coffeeJobIds`; manual delivery, robot load/handoff and withdrawal honor that binding. Withdrawal of one job shrinks a combined allocation by one instead of cancelling other cups or taking another job's unallocated readiness.
- W07 packaging remains consumed at quality confirmation, with ingredients already booked per coffee step excluded. Consumption uses a stable per-job source ID, so discarded remakes consume new packaging. Packaging waste and unresolved stock exceptions retain the per-job exclusion metadata.
- Modelled quality and milk-temperature evidence require both explicit venue `configuration.applied.beverage.allowModelledMeasurements=true` and device `validation='simulated'`. Production defaults require measured evidence. Only synthetic fixtures opt in.
- A stale giver/receiver transfer half can be refreshed for the same pending command without resending the arm program. Arm and tray receiver must have distinct bound observer identities.
- Optional recipe `policies` freeze revision/provenance with the recipe hash. Capacity uses exact decimals, target tolerances, headspace and explicit ice displacement (m³/kg); it never assumes general 1 ml = 1 g. Milk policy checks batch opening time, cold-chain history, temperature provenance/range and independent freshness at dispense and quality. Same-batch reboot cannot rewrite opening time or clear a broken cold chain.
- Measurement plausibility marks an implausible result unknown/needs-attention, keeps the raw observation and does not consume the implausible amount from stock. Human reconciliation opens the existing stock exception path.
- Mock process faults: `measure-outlier`, `milk-expired`, `milk-warm`, `milk-unknown`. The plant keeps batch history through reboot. Its `restoreCup` permits only an unused removed cup with zero contents and no issued command, then emits fresh bound cup evidence. Runtime agent owns the typed `restoreCup` action and UI flow.

## Acceptance test mapping (exact titles)

`source/tests/integration/coffee-policy.test.ts`:

- BV02-capacity / BV06-capacity: `BV02/BV06 capacity model includes headspace and explicit ice displacement before reservation or effects`
- Policy contract/frozen identity: `BV02/BV06 capacity policy is schema validated, frozen with the recipe and rejects missing ice conversion assumptions`
- BV04-outlier domain: `BV04 implausible terminal measurement is held with raw evidence and never booked as real stock consumption`
- BV04-outlier runtime: `BV04 mock outlier fault preserves model quantity while source refuses implausible sensor evidence`
- BV08-milk-policy table cases: `BV08 missing milk policy blocks dispense with its reason`, `BV08 expired milk policy blocks dispense with its reason`, `BV08 warm milk policy blocks dispense with its reason`, `BV08 unknown milk policy blocks dispense with its reason`, `BV08 stale milk policy blocks dispense with its reason`, `BV08 broken_chain milk policy blocks dispense with its reason`
- BV08 reboot/domain: `BV08 reboot cannot reset batch opening time or cold-chain failure; a documented new batch with fresh temperature permits milk`
- BV08 reboot/process: `BV08 mock reboot preserves opened milk batch and failed cold-chain evidence`
- BV08 quality: `BV08 cold-handling evidence lost after milk dispensing blocks quality and fulfillment readiness`
- Corrected cup model: `operator mock cup correction reobserves only an unused removed cup`
- R03 delivered counting: `R03 two cups of one line prepare and deliver sequentially, without counting delivered jobs again`
- R04 explicit mass allocation: `R04 explicit per-step bean allocations support repeated brews when measured volume cannot specify bean mass`

`source/tests/integration/coffee-review.test.ts` (12 cases):

- `R01 removal in cup_verified persists absence and requires a new cup verification before any effect`
- `R01 removal in started persists absence and requires a new cup verification before any effect`
- `R01 removal in between_steps blocks later preparation, quality and pickup`
- `R01 removal in verifying blocks later preparation, quality and pickup`
- `R01 removal in ready_for_pickup blocks later preparation, quality and pickup`
- `R02 pick rejects fault, offline and stale arm without a new lease or effect`
- `R02 place rejects fault, offline and stale arm without a new lease or effect`
- `R03 quality-counted coffee occupies prepared capacity once and cancellation allows a remake within order quantity`
- `R04 repeated milk steps reserve independently and conserve measured consumption, remaining reservation and dedup`
- `R05 waiter manual handoff atomically serves, records human custody and releases every coffee lease`
- `R05 manual handoff of removed cup refuses the entire fulfillment decision`
- `R05 manual handoff of transfer_pending cup refuses the entire fulfillment decision`

`source/tests/integration/coffee-conservation.test.ts` (9 cases):

- `modelled measurements require venue and device opt-in: venue_disabled`
- `modelled measurements require venue and device opt-in: device_not_simulated`
- `modelled measurements require venue and device opt-in: explicit_simulation`
- `quality consumes W07 cup/lid once, excludes already dispensed beans, and a discarded remake consumes new packaging`
- `withdrawal preserves the other cup of a line under a separate allocation`
- `withdrawal preserves the other cup of a line under a combined allocation`
- `stale giver evidence can be refreshed for the same transfer without resending the arm command`
- `tray transfer refuses an arm and receiver configured to share the same observer identity`
- `mission customer handoff refuses served quantity when its bound coffee cup is not loaded on that robot`

## Verification and red/green evidence

All commands used Node 24.22.2 with Node 24.22.2 first on `PATH`.

- First R01–R05 regression run: **12 failing**, with expected rejection/omitted-state/incorrect-stock assertions. After the fixes, **38 passed** across review, job, recovery and transfer files. Enabling arm freshness initially exposed BV01's missing arm idle heartbeat; adding genuine periodic modeled status restored the existing BV01 test.
- First policy run: **10 failing / 1 passing**. New failures covered missing capacity admission, unknown policy schema, all milk interlocks, reboot bypass and implausible measurement consumption. Then **11 passed**.
- Mock outlier fault was first rejected `INVALID_FAULT`; mocked batch metadata and `restoreCup` were absent. After implementing those paths, the expanded coffee gate passed **52 tests**.
- Post-dispense milk policy and explicit bean allocations each failed before their fixes, then passed.
- Five deferred minor regressions failed before fixes: modelled evidence production admission, omitted packaging, wrong allocation withdrawal, stale giver evidence and same-observer transfer. All then passed; later parameter cases cover combined allocations and both opt-in requirements.
- Mission handoff conservation regression failed with an accepted fulfillment (no `CUP_HANDOFF_NOT_READY`) before its guard, then passed.
- Final coffee/inventory gate: ten files, **94 passed, no skips** (63 coffee tests plus 31 stock/kitchen/restaurant regression tests). Exact command uses the six `coffee-*.test.ts` files plus `kitchen-allocation.test.ts`, `stock-consumption.test.ts`, `restaurant-models.test.ts`, `stocktake.test.ts`.
- `pnpm typecheck`: passed.
- `pnpm contracts:check`: passed; generated contract matches schemas.
- Scoped ESLint: passed after removing one unused test import.
- A broader combined run also ran `lab-v2-contracts.test.ts`: its recipe/schema assertions passed, but one unrelated reclaim-route assertion expected 404 and received 422 while the runtime agent was changing reclaim validation. Runtime agent was notified. Do not describe that combined 113-test command as wholly green; it returned **112 passed / 1 failed** before the fresh ten-file gate.

Domain tests use the real production registry, authorization and SQLite journal, with least-privilege station/observer/waiter principals. Seeded device/mission fixtures are explicit boundary-state fixtures; no hardware services ran. Mock runner tests use the exported source runtime directly.

## Files and ownership

Source changes: beverage `job.ts`, `module.ts`, `recipe.ts`, `resources.ts`, `recovery.ts`, new `policies.ts`; fulfillment `allocation.ts`, `handoff.ts`; kitchen `ticket.ts`; inventory `ready.ts`, `consumption.ts`; cell adapter `contract.ts`, `mock-coffee.ts`; coffee recipe schema + generated types; synthetic session evidence opt-in; top-of-file server coffee recipes and fault list; coffee support and six coffee integration files (three new). The initial arm status heartbeat is preserved in `mock-arm.ts`, subsequently owned by root for arm safety work. Runtime agent owns the rest of `scenarios/coffee.ts` and action schema.

Lab fixtures `fixtures/recipes/espresso.json` and `iced-milk-coffee.json` match server recipes, now **revision 2**. Existing revision 1 recipes remain immutable and schema-compatible; optional absent policies are legacy behavior, not evidence that their capacity or cold-handling policy was checked. The new mock acceptance profile uses revision 2 with explicit illustrative policies.

No Linux/Gazebo/LinuxCNC/controller/HIL/live/physical-stop/food-safety validation is claimed. Values are illustrative models. Old schema-compatible recipes without policies require a new recipe revision to opt into those checks. Unknown outcomes remain held for human reconciliation; no automatic replay of brew, dose or arm commands was introduced. Root must still run/assess the full CI and independent review and update final R-MOCK acceptance separately.

## Independent-review follow-up — duplicate resource identity (R04)

The reviewer found that duplicate resource rows could share the movement dedup identity. This was reproduced before the follow-up fix using the real coffee fixture, production authorization and SQLite journal: recipe registration was accepted; the completed milk step held two consumed reservations of 80 ml each, but stock moved only once (`-80`) and on-hand was 1920 from 2000. The same job/step/ingredient identity must not represent two resource declarations.

`parseRecipe` now rejects duplicate `resourceId` values before registration. `validateCoffeeRecipe` now performs matching semantic uniqueness checks by `resourceId` and by each resource allocation's `stepId`; unlike JSON Schema `uniqueItems`, this also rejects duplicate identities whose amount fields differ. Domain admission already rejected duplicate allocation step IDs and now has an explicit regression for it. Valid repeated ingredient steps remain supported through one resource row with per-step allocations or matching-unit target quantities.

New exact test titles in `coffee-review.test.ts`:

- `R04 rejects identical duplicate resource ids before stock reservations can share a movement identity`
- `R04 rejects different_amount duplicate resource ids before stock reservations can share a movement identity`
- `R04 schema semantic admission rejects duplicate resource ids and duplicate allocation step ids even when amounts differ`
- `R04 production recipe admission rejects duplicate allocation step ids`

Red: three failing assertions (two production registration cases and schema-semantic admission), with the existing repeated-step conservation and domain allocation-uniqueness cases passing. Green: `coffee-review`, `coffee-policy`, `coffee-conservation`, `coffee-job` and `lab-v2-contracts` — **72 passed across five files**, no skips. `pnpm typecheck` and scoped ESLint passed. The earlier reclaim-route contract failure no longer reproduced in this fresh run.

Follow-up touched only `source/packages/domain/src/beverage/recipe.ts`, `source/packages/lab-runtime/src/v2/contracts.ts`, `source/tests/integration/coffee-review.test.ts` and this report. No schema-byte/generated-type changes were required for semantic identity checks. No stage or commit. Coffee changes frozen again after verification.
