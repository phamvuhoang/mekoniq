# V12 perception-gap study (21/11/2026)

`perception-gap-v1`: 92 pick-rig runs on `pick-rig-v1` at source `cedda186` (clean worktree), verify exit 0 (92/92, no issue). Raw archive (92 run directories, retained belief streams, reports, run records; 316 MB): `robot/evidence-archive/r4-perception-gap-v1-cedda186/`. This directory keeps `campaign.json` and `summary.json` (the verifier's `PerceptionStudyV1`). `accepted:false`, `not_calibrated`; modelled perception error, not camera data.

Reading it: the proportion is the first-try `lifted` share per registered point (Wilson 95 %). Two things the table shows plainly:

- `refused` outcomes are the ARM03 capsule self-collision gate (`ARM_COLLISION`, link-1/link-4) refusing certain cup offsets before any motion (seeds 3 and 4 of the 20 mm directions, in every point that uses those seeds). They are a property of the offset direction, not of the belief error, and are not hidden.
- `unknown` outcomes (σ 10 mm: 1; bias x 10 mm: 2) are arm stops after contact during the approach, never recovered.
- The fixed program lifted 4 of 10 at 20 mm; the belief modes lifted 7–8 of 10 (the rest refused/unknown). No point misses a grip and keeps the cup on the stand, so the recovery table has no natural trigger in this cell (see the V13 ledger).
- `stale-nudge` uses the registered `world-cup-nudge-v1` (14.4 N), which the closing gripper absorbs (10/10 lifted).
- No ranking and no safety threshold are claimed. Seeds are registered; the interval describes the registered offset directions and noise draws.
