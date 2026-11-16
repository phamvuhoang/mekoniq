# Focused context for the final performance review

This is a bounded static read at Source981e234 / Labd4c3032, prompted by the already recorded actual draw p95300.2ms, world pose update p95300.2ms and achieved0.47188883x. No code, thresholds, qualification inputs or recorded results were changed, and no new benchmark was run. It does not assign defect severity or establish the entire performance cause.

The normal live shared-world path differs deliberately from the existing interpolated telemetry path:

- `lab/src/ui/workspace.ts:245` schedules `tick()` every100ms. `tick()` at203–204 calls `refreshWorld()`; that function at191–199 allows only one outstanding world request, fetches the observation, reconciles the exact run horizon when necessary, and paints after installing a matching world observation.
- `lab/src/ui/workspace.ts:222` excludes an existing shared world from `animating()`. The RAF loop at223 therefore does not animate the shared world. `paint3d()` at225 updates it from the exact frame.
- `lab/src/twin/live-playback.ts:17` discards `mujoco_3d` interpolation buffers explicitly so base/payload remain on the same committed observation. This is an authority/correlation constraint, not permission to invent client physics.
- `lab/src/ui/workspace.ts:594` selects five ticks for each paced shared-cell HTTP step. At598–601 it applies the receipt and calculates achieved rate from actual simulation versus wall time. The fresh measured Source step HTTP p50 is202.504ms and p95 is246.469ms; worker IPC p95 is4.837042ms. These observations alone do not locate all Source durability, request scheduling, polling or UI overhead.

The measured actual render CPU p95 is0.5ms, while the interval p95 is300.2ms. That distinction is relevant to investigating update cadence rather than assuming mesh drawing itself consumed300ms. Other UI-triggered paints can occur, so this note does not claim a formal universal10Hz cap from the100ms timer alone.

The final reviewer should assess the recorded unmet active-drawing/display/rate/pause requirements against this architecture and the design's exact-state constraints. Rendering the same stale pose repeatedly or weakening the full-cell requirement would not establish timely observed world progression. Any eventual fix must preserve shared committed horizons, no replay/live-state bleed, custody, lost-ACK handling, reduced-motion behavior and truthful measured rate. These are review questions, not an implemented solution or a new qualification result.
