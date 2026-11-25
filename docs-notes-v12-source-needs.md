# V12 Lab half — notes for the source side

## Source needs
- None blocking. The Lab reads `report.perceptionEvidence`, `health.graspModes` and capability `sim3d_belief_grasp_v1` exactly as source `cedda186` advertises them.
- Nice to have (not needed now): while a run is live, `GET /runs/:id/report` carries `perceptionEvidence` (hot read) but the Lab only attaches a report to the frame once `report.outcome.tick <= view tick`, so a live run shows its ghost only after the report is loaded (stop/finish). The ghost during live play needs the report polled; not done.

## Rulings
- `beliefAt` semantics: the newest record not later than the cursor wins. A record with `belief:null` and `dropped:true` (a dropped update) keeps the previous belief (the controller still holds it, so the ghost stays); a record with `belief:null` and `dropped:false` (`OUT_OF_VIEW`, the cup left the stand) ends the belief (`{available:false,reason:'OUT_OF_VIEW'}`); an invalid belief (`valid:false`) is never drawn. Empty or nothing at/before the cursor: `NO_BELIEF_DATA`. Cost if wrong: a ghost may linger across a dropout burst longer than `maxAgeTicks`; the runtime's own gate (BELIEF_STALE) is in the attempts table, not in the ghost.
- No new 3D/2D layer toggle: the ghost is drawn whenever the report has the stream at the cursor (a toggle would need a `Layer` entry and its tests); the legend line says what is drawn.
- Truth shown is `truthAtObservedTick` (scoring data of the record), not the live cup; the real cup is drawn by the twin as before, the ghost is a wire cup and is never placed over it unless the belief really equals the cup.
- The study screen reads the `study` object (or the whole verify/summary JSON) from a local file; there is no runtime route for it.
- The world-cup-nudge experiment is not offered in the browser (REC06 blocked).

## Verification run
- `pnpm typecheck` clean; `pnpm exec vitest run`: 104 files passed, 1 skipped; 833 tests passed, 1 skipped.
- `tests/e2e/mujoco-belief.spec.ts` passed (1/1, 55 s) through `node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-belief.spec.ts`. The launcher itself exits 1 with `MUJOCO_WORKER_LEFT_RUNNING` only because a parallel study on this machine spawns its own MuJoCo workers; the Playwright result is 1 passed.
