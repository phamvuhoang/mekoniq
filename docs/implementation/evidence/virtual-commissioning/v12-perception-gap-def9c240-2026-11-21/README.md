# V12 perception-gap study, corrected (21/11/2026)

`perception-gap-v1`: 92 pick-rig runs on `pick-rig-v1` at source `def9c240` (clean worktree), verify exit 0 (92/92, no issue). Raw archive (92 run directories, retained belief streams, reports, run records; 315 MB): `robot/evidence-archive/r4-perception-gap-v1-def9c240/`. This directory keeps `campaign.json`, `summary.json` (the verifier's `PerceptionStudyV1`) and `SHA256SUMS.txt`. `accepted:false`, `not_calibrated`; modelled perception error, not camera data. It supersedes `v12-perception-gap-2026-11-21/` (source `cedda186`), which was recorded before the review fixes: its commit was decided at job start instead of at the start of the descent, its contact counts were a constant 0 and `CUP_DROPPED` runs were labelled grip-not-established.

What changed the numbers: the belief grasp commits when the arm holds at its approach (the belief error is measured there, so it is smaller than before); outcomes and contacts come from each run's report; the verifier binds profile, run, source commit and the nudge.

Reading it (first-try `lifted` share per registered point, Wilson 95 %):
- The fixed program lifted 4 of 10 at 20 mm; 4 dropped the cup, 2 stopped `unknown`; 14 unexpected native contacts in total.
- The belief modes lifted 7–8 of 10 at 20 mm. The rest are `refused` by the ARM03 capsule self-collision gate (`ARM_COLLISION`, link-1/link-4; the same offset directions of seeds 3 and 4) before any motion, or arm stops after contact (`unknown`: bias x 10 mm ×2). No belief point missed a grip.
- `stale-nudge` (registered `world-cup-nudge-v1`, 14.4 N, no recovery policy in the study): 0/10 lifted, all `grip_not_established`, 1370 unexpected contacts (the closed gripper pressing on nothing after the cup was knocked off its support). The nudge now fires at the start of the descent.
- No ranking and no safety threshold are claimed. Seeds are registered; the interval describes the registered offset directions and noise draws.
