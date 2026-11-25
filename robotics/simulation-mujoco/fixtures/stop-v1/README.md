# stop-v1

Drive models and a control profile for the stop-behaviour campaign, derived from the HW-C hardware option (BLVD-KRD drives with BLV-R 60 W motors; HW-A has the same drives but does not compile). Nothing here is calibrated.

- `serve-drive-hw-c-brake-v1.json`: the derived model with `onDisable: brake`. The BLV-R 60 W profile documents no brake output, so the brake torque (6 N m) is the R4 fixture's assumed value and stands for an external brake.
- `serve-drive-hw-c-coast-v1.json`: the same model with `onDisable: coast` and no brake torque. It differs from the brake variant in exactly those two fields.
- `serve-control-hw-c-v1.json`: the R4 control profile with the acceleration limit a pv-only drive ramps with, taken from the profile (1000 (r/min)/s, HP-5143-3E p.103). It lists both drive models.

The encoder counts and the watchdog range of the BLVD-KRD are not documented in a way that changes the R4 model, so the derived model equals the R4 nominal model apart from id and revision (coast digest 256d6bd6bb4c).
