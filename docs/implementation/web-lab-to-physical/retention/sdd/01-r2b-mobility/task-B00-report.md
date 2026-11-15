# B00 implementation report

Status: complete. Commit `e137b57f23afe5b6114956011bcf7065d03c711b` (`docs: lock post-R2a baseline for R2b`). Exactly one committed file: `docs/implementation/post-r2a-baseline.md` (86 lines). This report is orchestration state, outside the committed change.

## Scope and requirements

Read task-B00-brief.md, recorder, qualification/README, acceptance guard, paired Lab pin, fixture manifest, existing capability/schema/mock golden tests, research README/research and R2b plan. Captured actual worktree HEAD/status and recorded release tuple separately. Source started 086121c73afcdb08240c393dcd87a6f1de861b58; Lab stays 8c5db253155bcbb74b5607606ca65db562b267ff. Both started clean and are clean after commit. Work was confined to the source worktree; paired Lab was read only. Original production checkouts were not mutated.

The baseline records source/Lab/pin/schema/portable/native closure/engine lock/fixture/model/vendor/profile/image identities; byte hashes for relevant schemas, arm ports, fixture manifest and golden; gate statuses, missing acceptance and open limitations. It names the research snapshot delta for tuple, candidate availability, unchanged schemas, clock/substeps, slip ruling, image and final arm ports. No code, schema, tools, runtime, candidate or historical evidence changed; no re-pin or prose tests; no dispatch, push, deployment, paid host or hardware execution.

## Verification performed by B00

- Node PATH v24.22.2; `LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-01 perl -e 'alarm 180; exec @ARGV' pnpm test:acceptance -- sim-extension`: exit 0, 12/12.
- `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/capabilities-mujoco-arm.test.ts tests/contracts/sim3d-mujoco-schema.test.ts tests/unit/bv01-mock-golden.test.ts`: exit 0, 14/14 (5 capabilities, 8 schema, 1 golden), 3 files.
- Closure measurements via existing `closureIdentity`, byte hashes via Node crypto, fixture and immutable candidate identity inspection; read-only pinned artifact manifest comparison.
- `git diff --cached --check`: exit 0 before commit. Commit succeeded; final source/Lab status empty. Commit contains only the baseline document.

Controller-reported verification, attributed separately in baseline: earlier acceptance 12/12, broader source capability/schema/mock golden checks 18/18, Lab `pnpm test:unit` 426/426, and independent MuJoCo pytest 43/43 (9.61 s) with PYTHONDONTWRITEBYTECODE=1 and cache provider disabled. B00 did not rerun Lab or MuJoCo suites.

## Findings and follow-up

Qualification is recorded at source bb16724859ee8377be62389a851ac36ea4a0309a / Lab 832c84fa0bdac2c18d44a4f102337533d1904436. Current Lab still pins that source and its artifact/schema/portable closure, correctly matching the candidate but not current source HEAD. Fresh guard validates historical evidence/pin, not current-HEAD qualification. Seven gates are tested; G-CLOUD1 blocked_external / CL01 not_run; all accepted:false. No acceptance sidecar. R2a arm prerequisites are tested, but B05/B06 retain their own dependency/spike requirements. Engine stays mujoco==3.17.0, not_calibrated.

Current portable closure 3e8fa06c2c8eb2b79e1dc8a64efd8bc5a7f022689f8168bcd88bc7a7c7b70ec2 differs from recorded 6df2f71fc16380756e6342f229afcfaef8ca8822e462d9f53f6baec377e4c745 solely by robotics/simulation-mujoco/README.md bytes. Current native 982b7498a5ee1a67e8a9d07468533f3571e68a9d732c76abe7769dc4749835a4 differs from recorded cddf6bc66fc4d6a5175835776dea4be34dd5ba477aa91e1658bbeeccb53cc9d9 because the original pinned manifest included five generated robotics/agent/mekoniq_agent.egg-info files absent in the clean worktree; all other native files match. Compared against /robot/lab/.runtime/67a1a20cf12f79046c89695324505453c7d6ee6548d530bd98abfb2149d208c7/manifest.json read only. No unresolved closure discrepancy remains.

Controller explicitly plans fresh clean export and paired Lab pin after this documentation commit and before runtime work. Do not fabricate ignored egg-info, alter candidate or reuse historical acceptance. Native amd64 failure cause, real host validation, Cloud Run and physical commissioning remain open, outside B00. Recorder pytest cache issue remains; retain PYTEST_ADDOPTS='-p no:cacheprovider'.
