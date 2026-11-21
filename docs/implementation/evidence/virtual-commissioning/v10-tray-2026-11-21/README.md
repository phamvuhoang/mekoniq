# V10: MJ-TRAY01 campaign tray-v1 (2026-11-21)

Recorded at source `b1983ca9` (clean tree, host arm64, MuJoCo 3.17.0), 11 cases: tray-nominal-v1 x3 seeds, tray-low-friction-v1, tray-accel-high-v1, tray-torque-limited-v1 and tray-person-crossing-v1 x2 seeds each. `node scripts/lab-mujoco.mjs verify --input <dir>` exits 0 with no issues. `accepted:false`, every number assumed and `not_calibrated`.

The raw archive (166 MB) is outside git at `robot/evidence-archive/r4-tray-v1-b1983ca9/`; `SHA256SUMS.txt` lists its files (not catalog/ or engineering/) and its own sha256 is `db5209afc207643e0cc2eedab4906c5e7521f2d8baf6856ce53159223d5bda3f`. `campaign.json` is the table, `summary.json` the verdicts read back from the durable records.

## What the records say (read, not promised)

| Variant | Outcome | Largest window slip | Tray acceleration (limit) | Verdicts |
|---|---|---|---|---|
| A nominal | completed, served 3 (5635 ticks, 112.2 s) | 0.96 mm | 0.71 (0.5) | SERVED_ALL, SLIP_BELOW_WARN, SLIP_BELOW_FAIL pass |
| A' low friction | completed, served 3 (5627 ticks) | 4.14 mm | 0.87 (0.5), Coulomb bound 1.47 | COULOMB: no_slip_expected |
| B high acceleration | needs_attention at tick 1295 (NO_PROGRESS), served 0 | 32.7 mm | 1.89 (2.5) | COULOMB: slip_expected_and_found at tick 378; MISSION_OUTCOME inconclusive |
| C torque-limited | needs_attention at tick 3977, served 0 | 0.94 mm | 0.56 (0.5) | MISSION_OUTCOME inconclusive |
| D person crossing | completed, served 3 (6134 ticks); stopped 63 ticks near the person, no contact, resumed | 0.96 mm | 0.71 (0.5) | all pass |

Seeds are identity only in this engine, so the runs of one variant are identical. B and C end without the mission done: a recorded result, not a failed oracle. At every tested navigation limit from 1.0 m/s2 up the planner assumes a deceleration the assumed drive cannot deliver (overshoot, CONTACT, NO_PROGRESS or LOAD_FELL); only 0.8 completed. The cups creep about 40 mm over a whole mission far inside the friction cone (MuJoCo friction is soft); slip is therefore read over a 25-tick window.
