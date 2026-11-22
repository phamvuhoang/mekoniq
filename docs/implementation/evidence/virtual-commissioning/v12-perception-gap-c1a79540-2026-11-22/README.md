# V12 perception-gap study, re-recorded after the second review (22/11/2026)

`perception-gap-v1`: 92 pick-rig runs on `pick-rig-v1` at source `c1a79540` (clean worktree; Lab pin `6003474` → `c1a79540`), verify exit 0 (92/92, no issue). Raw archive (92 run directories, retained belief streams, reports, run records; 315 MB): `robot/evidence-archive/r4-perception-gap-v1-c1a79540/`. This directory keeps `campaign.json`, `summary.json` (the verifier's `PerceptionStudyV1`) and `SHA256SUMS.txt`. `accepted:false`, `not_calibrated`; modelled perception error, not camera data. It supersedes `v12-perception-gap-def9c240-2026-11-21/`, which the fixed reader no longer verifies (stream manifests without record counts, no recorded stage/tick on attempts).

A first re-record at `c0dca439` completed 82/92: the verifier's nudge check read the cup's truth from the belief stream and a stale profile has no sample right after the commit. The witness is now the run's own per-tick props trace (`c1a79540`). That recording is not kept.

Reading it (first-try `lifted` share per registered point):
- Fixed program at 20 mm: 4 of 10 lifted; 4 dropped the cup, 2 stopped `unknown`; 14 unexpected contacts.
- Belief modes: 7–8 of 10 at 20 mm and at sigma 2–15 mm; the rest are `refused` by the ARM03 capsule gate before any motion, or arm stops after contact (bias x 10 mm: 2 `unknown`, 3 contacts). No belief point missed a grip.
- `stale-nudge` (registered `world-cup-nudge-v1`, no recovery policy): 0/10 lifted, all `grip_not_established`, 1370 unexpected contacts.
- No ranking and no safety threshold are claimed.
