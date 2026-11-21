# Perception fixtures v1

Generate with `node scripts/generate-perception-fixture.mjs [out-dir]`. Each `perception-*.json` is a modelled perception error (bias, noise, latency, dropout, view region, maximum age) for the simulated pose estimator of R4-B: it is a parameter model, not camera data, and every value is `assumed`, `not_calibrated`. `perception-ground-truth-v1` has no error at all (the comparison point). `perception-regions-v1.json` registers the view region (the nozzle stand top) and the work region a believed cup position must lie in before a grasp is planned.
