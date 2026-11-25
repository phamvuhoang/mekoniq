### Task 5: Requalify final source and record new evidence

Read qualification-inspection.md for verified native runner commands, exact eight historical failures and available image/service identities. Add branch-push-scoped native x86 workflow (workflow_dispatch alone on a new branch file will not start). CLD01 asserts host/image platform and run-view status, not only report status; add a negative IMAGE_STALE test. Native protocol baseline must be captured using immutable pre-fix worker inputs/code on the same architecture, then compared to final worker (Task 1 tool supports response-dir override). Fixed historical Darwin golden is architecture-scoped; report a skip explicitly and do not count it as a native pass. No production deployment or service mutation.

**Files:** Source container integration test/build scripts and image/architecture tests only as needed for genuine defects; new evidence summaries under `docs/implementation/evidence/virtual-commissioning/`; raw new records in workspace `evidence-archive/`.

**Interfaces:** Final source runtime export/re-pin must identify the tested commit and schema/tools digest. CLD01/02 distinguish native architecture from emulation. Accepted remains false.

- [ ] Full source contracts/typecheck/lint/build and required suites; full Python suite; full Lab check:source/typecheck/unit and focused e2e. Report exact skips/failures rather than a synthetic aggregate.
- [ ] Rebuild/run CLD01 from final source revision: complete bench, metrics, release slot and run again. Investigate CLD02 eight failures with root-cause evidence. Fix genuine portability/test-contract defects with failing tests; never weaken claims or tolerances to pass.
- [ ] Use an available genuine x86-64 runner for CLD02 if credentials/infrastructure allow; otherwise provide an executable CI job and exact external blocker. Do not call emulation native. Inspect existing cloud deployment requirements for CLD03; no production deployment in this repair task.
- [ ] Record new drive/CIL/bench campaigns after preregistering revised controller oracle. Verify them and generate checksums. Include fresh TUNE04/TUNE05 and container logs in a new review/qualification record; preserve historical evidence.
- [ ] Re-review whole fix range, resolve remaining load-bearing defects, then root re-pins on the final runtime revision and reruns only checks affected by any subsequent fixes.


Task3 introduces bench-v2 for revised starting profiles, with same16 cases/thresholds and immutable bench-v1 historical binding. Final fresh bench recording must use bench-v2 after its registry/oracle commit; also verify original bench-v1 archive remains compatible. V16/handover consume records by actual campaign version.
