### Spec Compliance

- ❌ Three issues remain at `packages/lab-runtime/src/v2/control/bench-runner.ts:197`, `bench-runner.ts:233`, and `packages/lab-runtime/src/v2/control/drive-io.ts:79`. The recorder can invalidate its own trace, actual compressed reads can exceed the cumulative budget, and a single-provider host publishes envelope entries whose mode constraints it has skipped.

### Strengths

- `bench-signals.ts:65` uses interval displacement for CSV commands. `tests/unit/bench-signals.test.ts:124` integrates complete short and unaligned moves. `tests/unit/tuning-metrics.test.ts:145` exercises both sides of the 250 ms elapsed-time boundary.
- `bench-runner.ts:246` takes chassis velocity from the verified final tick and `bench-runner.ts:252` clears it when a gap covers that tick. `tests/integration/mujoco-bench.test.ts:203` covers a changed recorded value, a declared final gap, a legacy row and a malformed row.
- `tests/integration/mujoco-bench.test.ts:137` checks lease renewal, expiry, retained evidence, worker closure and subsequent slot acquisition. `robotics/simulation-mujoco/tests/test_session.py:333` exercises both repeated-sequence gripper reversals.

### Issues

#### Critical (Must Fix)

None identified.

#### Important (Should Fix)

1. **A recorder failure can invalidate healthy earlier chunks.** `packages/lab-runtime/src/v2/control/bench-runner.ts:197` records a gap for the failed append. The exception reaches `bench-runner.ts:473`, where `lost()` records the same tick again at line 477. The reader rejects these overlapping ranges at line 226, so even the previously verified prefix becomes unavailable. Give gap insertion one owner or merge repeated ranges while retaining the terminal cause. Exercise a failed append after a confirmed chunk through the live run and reread that prefix.
2. **Corrupt file sizes escape the cumulative compressed-read budget.** `packages/lab-runtime/src/v2/control/bench-runner.ts:220` budgets declared sizes, while line 233 passes the full per-chunk limit into every file read and detects a size mismatch afterward. A cold archive with understated sizes can consume substantially more I/O than the 16 MiB review budget. `packages/lab-runtime/src/v2/simulation3d/physics-evidence.ts:45` already compares the file size to the supplied cap before reading. Use the declared chunk size, already bounded by the manifest validation, as its read cap. Preserve a stable typed issue.
3. **A single-provider host publishes partially validated envelope bounds.** `packages/lab-runtime/src/v2/control/bench-runner.ts:54` supplies only the current plant's axes. `packages/lab-runtime/src/v2/control/drive-io.ts:79` skips both mode checks when the axis is absent from that map. `packages/lab-runtime/src/v2/navigation2d/readiness.ts:106` loads only installed scenarios and publishes the full shared envelope at line 107. An arm-only host therefore advertises even a resealed nonzero wheel kd range as healthy. Validate every published axis against its registered bench mode and preserve the envelope identity. Cover an arm-only or wheel-only host with invalid bounds on the other plant.

#### Minor (Nice to Have)

None identified.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The normal runtime and evidence paths have direct regressions. Trace recovery and read-bound enforcement fail in the corruption cases the new verifier is intended to handle, and single-provider health can misstate the admitted envelope.

**Review checks:** No suites rerun. Checked the out-of-hunk recorder failure path at `bench-runner.ts:177` and the read helper at `physics-evidence.ts:44`. Checked physical-unit provenance at `mujoco_worker/mobile_engine.py:283`, fixed arm clock construction at `simulation3d/arm-cell-scene.ts:92`, catalog provider selection at `scenario-matrix.ts:174`, lock and interpreter binding at `simulation3d/mujoco.ts:71`, envelope identities in the provider fixture, schema export at `scripts/export-lab-runtime.mjs:32`, and cold-review inputs at `v2/reclaim-store.ts:6`.
