# Coffee delivery shared world v1

B05 physical rig fixture; not a published full-cell scenario. MuJoCo 3.17.0, one model and clock, 10 × 2 ms with one declared 20 ms priming interval. Arm at map origin; AMR dock XY [0.35,0.48591366218667575], yaw pi/2. New horizontal approach and high transfer/withdrawal waypoint; original robot geometry, palm proxy and cup0.32 kg/R0.04 m/H0.1 m are retained. Only replaced static tray is removed; nozzle stand remains. Initial mobile load is empty.

New world global elliptic/impratio10/Newton100 policy preserves per-origin contact parameters and explicit caster pairs. Shared floor sliding friction1.0 differs from baseline mobile physics; no b02a measurement lock applies to the combined world. All dynamics are not_calibrated.

Mesh blobs stay in sibling xarm6-g2-v1/blobs, under its existing NOTICE/vendor manifest. Bundle materialization verifies and copies the listed hashes; no symlinks or external worker paths. Regenerate with node scripts/generate-coffee-delivery-world-fixture.mjs. Coffee creation/removal require source-owned interactions; custody transfer never relocates or welds a cup. Rig offsets mean cup birth XY on the nozzle stand. B06 owns correlated custody and served2.
