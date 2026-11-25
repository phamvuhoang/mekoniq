# Fault fixtures v1

Generate with `node scripts/generate-fault-fixture.mjs [out-dir]`. `fault-oracle-v1.json` names, for each fault of the R4 catalog, who must detect it, by which code and within how many ticks of its application receipt, and the thresholds of the six invariants. It is locked here and hashed in the campaign record before any run: a deadline is not loosened after a failure.

- `required:false` faults (motor-weak, command-delay, lidar-noise, drive-reset) do not have to be detected; the report still states what the plant did.
- Every value is `assumed` and the document `not_calibrated`; none is a safety parameter or a vendor number.
