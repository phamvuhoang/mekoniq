# Independent evidence guard re-review

Reviewed 2026-11-05 by `review_arm_final`. Read-only review of the four evidence findings and their frozen fixes. No implementation files edited.

## Verdict

**All four findings are addressed. No open finding remains in this scoped review.** Final clean-revision regression recording and acceptance remain root-owned and must replace the earlier recording.

1. **Source-only title resolution.** ARM05 and SYS03 delayed/reordered observation cases now use explicit literal test registrations, retaining the shared test bodies and all assertions. The new literal-reference check resolves the previously missing five titles. Lab-present acceptance still requires passed entries from stored machine-readable results; the optional source-only fixture policy is unchanged.
2. **Performance capture cannot pass with no rendering.** The capture rejects page exceptions, empty/null/nonfinite/nonpositive percentiles, missing actual paints, incomplete 10 Hz paint counts, short duration, wrong renderer or wrong workload. The 2D path requires a replacement SVG containing both AMRs and the arm. The 3D path requires actual WebGL draw calls and a nonzero canvas. Source acceptance separately validates those fields and thresholds before accepting the measurement result.
3. **Regression identity.** The recorder freezes clean source and Lab identities before replacing prior evidence, checks them before and after every command, and checks again at the end. The helper includes both index and working-tree changes plus untracked nonignored code. Acceptance checks complete command checkpoints, the recorded commit/tree hashes, exact clean source HEAD, current Lab code hash and current source runtime pin. Later Lab documentation commits are allowed only through the explicit `docs/`, `README.md` and `config/simulation-compatibility.json` exclusions; `config/source-runtime.lock.json`, fixtures, scripts, tests and runtime/UI code remain protected. These excluded paths are not consumed as executable UI/runtime inputs in the reviewed code. The manifest explicitly describes sampled checkpoints rather than claiming continuous filesystem monitoring.
4. **SYS01 render independence.** Active render variants require continuing real DOM draws, measured cadence and nonzero draws during source execution. The suspended variant uses an acknowledged `Debugger.paused` event, keeps the RAF loop enabled, and requires zero draws during the pause while source HTTP steps continue. It then checks resumed rendering and identical normalized journal/effects. Titles and evidence explicitly say debugger suspension; they do not claim OS background-tab behavior or claim that an ineffective lifecycle-freeze command suspended the renderer.

## Independent verification

Node 24.22.2.

- Source: `pnpm exec vitest run tests/unit/lab-regression-identity.test.ts tests/unit/lab-evidence-literal-refs.test.ts` — **11 passed**, 2 files, 6.20 s.
- Lab: `pnpm exec vitest run tests/unit/ui-performance-validation.test.ts` — **12 passed**, 1 file, 123 ms.
- Read and checked the implementer's fresh temporary browser artifacts in `<tmp>/lab-evidence-audit-20261105/`; no duplicate expensive capture was run by this reviewer. The capture contains 600 successful actual paints per profile over at least 60 s, no page errors, desktop frame/paint p95 16.8/19.9 ms and emulated tablet 16.7/1.4 ms. SYS01 records measured active rates approximately 14.99 and 60.00 FPS, zero draws during a 1040 ms acknowledged debugger pause, resumed draws, and identical reports.

The temporary browser test used source pin `7e4999033aff1d00ed696f80d26a013f726ec27b`; it is focused validation, not the final clean-revision acceptance artifact. Root must re-pin and re-record after the remaining source tooling/generated-output commit.

## Claims retained

The performance workload is explicitly synthetic visual telemetry into the actual workspace: two moving AMRs, one schematic arm and six tables. The tablet profile is browser emulation. Physical tablet performance, new-user usability, fresh profiles, network-off/cold boot and Linux/hardware validation remain separate external gates. This review does not mark R-MOCK accepted.
