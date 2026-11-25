# Final whole-branch review

Reviewed independent isolated repositories:
- lab: `1cb6235..1fedd21`
- source: `e999273..87e6ccb`

Verdict: **Not ready for handoff until the four Important findings below are fixed.** No Critical findings. Scope is the documented first web MVP and source-backed S01 business simulation, not full G1, native adapters, Gazebo, or physical commissioning. The explicit deferred scope is appropriate and is not itself a review failure.

## Important 1 — real S01 reports have incorrectly ordered events, breaking metrics and replay

**Location:** source `packages/lab-runtime/src/session.ts:128–129`; consumer lab `src/reports/metrics.ts:9`.

`buildSnapshot()` flattens `store.journal()` without imposing durable causal order. The underlying SQLite query has no ORDER BY; its scoped unique index includes TEXT producer_sequence, so after sequence 9 it returns entries in lexical order: 1,10,11,...,15,2,...,9. A complete S01 therefore emits events at 0s, 2s, 3s, then 0s and 1s. `parseReport()` correctly rejects this backwards time progression. The normal successful real-source journey consequently shows “Invalid report; metrics cannot be derived.” Read-only replay falls back to the same unordered snapshot events rather than providing a valid ordered replay.

**Proof:** Executed the production LabSession against a fresh temporary SQLite directory, then start → step1000 → confirm → step1000 → confirm → step1000. Run completed, but calling lab `summarizeReport(await session.report())` threw `Error: INVALID_REPORT`. The printed event sequence contains parking MissionCompleted at 3s followed by OrderAccepted at 0s. Temporary session was closed and removed.

**Fix:** Sort the Lab journal read model by the durable integer `entry.sequence` using BigInt (the harness has one producer), preserving event order inside each entry. Use the same stable order consistently for report journal and snapshot events. Do not sort solely on timestamps: multiple causal commands share a simulation timestamp. Do not rewrite signed journal contents.

**Regression:** Complete a real-source S01 exceeding nine journal entries and assert numerically monotonic durable sequence, causal tie order, successful `summarizeReport` and `openReplay`, travel=3000ms, expected attempts=3, and served=1. Extend actual runtime browser E2E to assert visible metrics and absence of the invalid-report message; assert replay ordering. Re-export and repin the runtime after the source correction.

## Important 2 — tiny imported projects can hang or crash rendering

**Location:** lab `src/project/schema.ts:23–27`; `src/viewer/fallback.ts:7`; `src/viewer/robot.ts:160`; `src/app.ts:438`.

The structural import validator accepts any safe integer tray count and any finite positive world dimensions. Renderers use these values directly as `Array.from({length:trays})`, a tray mesh loop, and `Array.from({length:world.width+1})`. The JSON byte/object limits do not bound that work. An imported project can make the design or restaurant screen throw, allocate enormous output, or freeze the browser. Import persists it before rendering, so an affected saved project can also break subsequent loads.

**Proof:** `validateProject({...defaultProject(), design:{...design,trays:4294967296}})` succeeds; passing the accepted count to `robotSvg` immediately throws `RangeError: Invalid array length`. A world width of `1e20` also passes the validator. No enormous allocation was attempted in the review.

**Fix:** Apply explicit structural computational bounds before storing imported inputs and defensively cap renderer iteration. Bounds should align with the public source contract where appropriate; incomplete/invalid engineering configurations can remain editable without allowing unbounded geometry generation. Ensure an import error preserves the previous usable project.

**Regression:** Reject or safely render very large finite tray counts and world dimensions, including safe-integer boundary values. Verify a failed import does not change IndexedDB/current project and normal 2–4 tray designs still work. A small invalid engineering value, if deliberately supported, should display issues without generating unbounded meshes.

## Important 3 — imported active project is lost from the UI on reload

**Location:** lab `src/app.ts:1091–1094`, with startup selection at `src/app.ts:95–97` and normal mutation selection at `src/app.ts:130–132`.

Import stores the new project and replaces `this.project` but does not change `mekoniq-active-project`. On reload, startup reopens the previous project (or the default ID). There is no project picker to recover the newly imported project. Undo/redo across an import also changes project identity without updating the active selection.

**Proof:** Browser reproduction in a fresh isolated Playwright context: save default project with 2 trays (R02); import a different ID `import-review`, revision12, 4trays. Before reload the UI correctly shows R12/4trays, while localStorage still says `mekoniq-service-lab`. Reload shows R02/2trays. The original code/index/HEAD were unchanged.

**Fix:** Centralize active-project selection and update the persisted selection whenever identity changes through import, undo, or redo. Handle selection-storage failure consistently with the existing storage warning behavior.

**Regression:** Import a different project ID, reload, and assert imported identity/revision/configuration. Also import → undo → reload and import → undo → redo → reload, checking the selected project rather than only stored records.

## Important 4 — accepted incomplete/imported worlds can crash the editor or its update action

**Location:** lab `src/app.ts:475–477,499–508,1168–1174`; import at `src/app.ts:1091–1094`.

The schema deliberately permits incomplete worlds, including `points:[]` and arbitrary valid point IDs. The restaurant page assumes there is always a selected or first point and dereferences `p.name`, `p.x`, and `p.y`. Empty points therefore crash rendering instead of showing the existing missing-station validation. For a nonempty imported world lacking the prior `worldSelected`, rendering visually falls back to the first point but does not synchronize `worldSelected`; submitting the displayed coordinate form searches the stale ID, gets undefined, and throws on `point.x`.

**Proof:** Direct code path: `validateProject` accepts an empty points array; `restaurant()` selects `world.points[0]!`, which is undefined. For a changed point ID set, the display fallback and submit lookup use different identities. This also arises after undo/redo changes worlds, not only through hostile inputs.

**Fix:** Normalize selected world-object identity whenever the project/world changes; render an explicit empty-state editor with a usable add action when no point exists. Submission must use a validated current selection and avoid modifying history/project state before detecting a missing target.

**Regression:** Import an empty world and navigate to Restaurant without a page error; retain a way to add points. Import a world whose IDs exclude the prior selection, edit the visually selected point immediately without manually changing the selector, and assert that exact point changed. Repeat through undo/redo.

## Review notes and boundaries

- Production command registry, authorization, SQLite journal, dispatcher, and SimulatorAdapter are genuinely reused; source does not import the prototype or contact hardware. Explicit load and handoff are maintained.
- Gateway authentication, ownership, origin/host checks, CSRF, body/admission limits, and terminal-action guards were inspected. No additional critical issue was found in those boundaries.
- Frozen run-world presentation, conservative stationary footprint admission, unknown Valetudo footprint, dirty-artifact rejection, content-addressed runtime pinning, and sanitized unverified report references remain consistent with the documented safety/evidence limits.
- Draft export does not grant native capability; docs clearly defer source apply/rollback, native adapters, additional scenarios, full G1, and hardware acceptance.
- Existing tests were inspected. Targeted source/report and browser import reproductions above were run on Node24. The full platform suite was intentionally not rerun for this read-only review.
- Both reviewed repositories remained clean after targeted verification. The temporary Vite process started by this review was stopped. No source/lab implementation, index, or HEAD was mutated, and the original workspace source/trial were not accessed for mutation.
