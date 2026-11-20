### Task 2: Make bench signals, traces, metrics and cleanup trustworthy

Carry from approved Task 1 review: add a focused worker session regression for repeated-seq gripper target reversal under dock-drift (session.py around line 373 uses accepted target, existing world test varies only wheels). Existing production fix is correct; prove the test detects reverting that consumer in an isolated mutation or against the pre-fix code, without changing live production code merely to create RED. Test file test_session.py; no extra worker behavior change requested.

Additional audited residual requirements: shared admission vectors assert reason-code parity, not just admitted boolean; envelope bounds must be consistent with axis mode (CSV kd zero and mode-specific limits); reject zero/nonfinite direct sampler inputs; reject invalid runTick before trace allocation. Verify wheel/arm provider clock/engine/lock/schema agreement for bench readiness just as the world path does, and read envelope from the actual admitted provider root. Catalog component revisions must be finite positive integers; catalog axes use the shared mode/unit helpers, experiments use the closed ID type, and catalog failures are surfaced as bounded health reason codes instead of stderr only. Add exact missing-kind refusal reason coverage. See qualification-inspection.md for base-code locations/status. The idle lease is host resource cleanup, distinct from simulated drive deadlines; expose its duration and expiry meaning. Total retained disk and cold review after restart need an explicit policy: preserve traces, refuse automatic resumed execution, provide bounded read-only access or clearly documented retrieval; do not silently delete evidence to solve retention.

**Files:** `packages/lab-runtime/src/v2/control/{bench-signals,bench-runner,tuning-metrics,gain-suggest,bench-campaign}.ts`, schema/type registration under `packages/contracts`, relevant `tests/{unit,contracts,integration,security}` bench files. Bench lifecycle wiring may touch `v2/{gateway,run-manager}.ts` if required by the existing ownership boundary.

**Interfaces:** Preserve existing bench request/result compatibility; add a versioned trace manifest schema with generated TS types. Unknown/corrupt trace never supplies valid metric samples. Expose wheel measurement/no-slip assumptions in server-owned data consumed by Lab. Engine release after a bounded idle lease preserves evidence and requires an explicit new run/reclaim.

- [ ] Short wheel trapezoid RED: distance .01, peak 2, acceleration 100, atTick 5 currently emits zero. Use exact displacement per tick divided by tick duration; assert discrete integral for .01 and .015, including unaligned ramps. Validate both sign restrictions and total duration. Preserve CSP behavior and fixed-step truth.
- [ ] Settling RED: indices 5..129 at 2 ms provide 248 ms, not 250 ms. Count elapsed observation time, test exact hold boundary.
- [ ] Trace RED: gap tick 200 with retained valid chunks must yield null/unavailable affected metrics; null gap and malformed coverage/chunk ranges return typed issues, never TypeError/500. Implement schema plus semantic coverage/overlap/identity checks in the shared reader. Test truncated/hash-corrupt/overlapping/missing/explicit-gap traces and verify the report uses only verified data.
- [ ] Remove optional-anchor fail-open behavior from production validation; make truncated/unavailable windows explicit. Consolidate duplicated metric-unit/unavailable helpers and schema aliases only within touched modules.
- [ ] Ensure priming-tick instability becomes an honest bench result, collision is covered through a real runtime path if a deterministic scenario exists, and host/plant/profile identities remain attached. Keep refusal validation before engine acquisition.
- [ ] Add bounded server bench inactivity cleanup for the live orphan case (default 60 s since last successful control progress, configurable/testable clock). On expiry, stop worker/release slot, retain durable trace and explicit terminal reason; do not resume/retry commands or erase proof. Test idle expiry, active progress, completed run and a subsequent run acquiring the slot.
- [ ] State that wheel metrics measure wheel angular speed and effective inertia/gain suggestions assume no slip; include a measurable body-motion comparison if available without changing the worker protocol. Do not claim wheel speed equals ground speed. Implement any new fields with schema/type tests.

```ts
expect(sumVelocityTimesDt(shortTrapezoid)).toBeCloseTo(0.01, 12);
expect(traceAtDeclaredGap.every(s => s.actual === null)).toBe(true);
expect(metrics.rmsError.available).toBe(false);
expect(nextRunAfterIdleExpiry).toBeDefined();
```

- [ ] Run focused unit/contracts/integration/security RED/GREEN, contracts:check/typecheck/lint; commit focused changes. Root re-pins Lab after source commits.

