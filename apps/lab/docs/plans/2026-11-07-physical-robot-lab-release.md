# Physical Robot Lab repair, release and guide

**Goal:** Fix the six remaining review groups, verify both repositories, integrate on main, deploy the existing Source and Lab production applications, and publish a new standalone guide with fresh captures.

**Authority:** User request on 2026-11-07 and the six findings from the preceding review. Existing Physical Robot Lab spec remains authoritative. Merge, push and production deployment are explicitly authorized. Continue the established work directly on main; commits are coordinated by the root agent.

**Constraints:** Preserve legacy scenarios and data. Do not touch trial or operational ports 1880/1884. Use Node 24. Do not expose credentials in logs or artifacts. No Linux VM provisioning; native and hardware gates stay not_run unless actually executed. Preserve the 2026-11-06 guide and historical evidence. Application deployment does not close physics/hardware gates.

## Task 1 — Model dimensions

Files: source/packages/lab-runtime/src/engineering/contracts.ts and focused source tests/documentation.

- [x] Write failing cases for process flow/density/reservoir/temperature, actuator torque constant, and incompatible sensor range/noise units.
- [x] Require canonical dimensions for every scalar. If existing unit `1` represents an implicit named field unit, retain only that specific documented compatibility convention; arbitrary alternatives must fail. Preserve existing catalog digests.
- [x] Validate sensor min/max/noise in the same declared dimension. Keep existing numeric range checks.
- [x] Run red then green and the affected source and Python suites.

## Task 2 — Archive snapshots and restore

Files: lab/src/design/assembly.ts, lab/src/project/engineering-store.ts, lab/src/ui/assembly-page.ts, related unit/integration/e2e tests.

- [x] Reproduce same-ID revision imports retaining old assets/recipes; same bytes with differing license metadata; lost migration original/report; 200,000-byte export; delayed restore overwriting edits.
- [x] Keep content bytes addressable by digest, but preserve archive metadata with the current project/history snapshot. Import, edit, Undo, Redo, save and restore must retain the matching metadata. Preserve the public project schema and legacy storage.
- [x] Encode base64 without spreading an entire blob into a function call.
- [x] Do not apply a delayed startup restore after a user edit/import/open operation. Keep that operation undoable.
- [x] Run red then green, full Lab tests and Assembly browser checks.

## Task 3 — Evidence comparison and recorder

Files: lab/src/reports/compare.ts, lab/scripts/recorder-options.mjs, lab/scripts/record-regression.mjs and their focused tests.

- [x] A report with engineering identity and no assessment must produce ENGINEERING_EVIDENCE_NOT_PASSED and unavailable engineering KPIs; legacy report behavior stays unchanged.
- [x] Give browser, mock and offline runs separate screenshot directories inside the fresh output root, and include all resulting artifacts/hashes in the manifest.
- [x] Prove each failure before implementing its fix, then run focused tests.

## Task 4 — Integration, runtime pin and recording

- [x] Independently review Tasks 1–3 and resolve findings.
- [x] Verify source lint, tsc, contracts, applicable unit/integration/security/contract suites, Python simulation; verify Lab typecheck/tests/build/browser flows.
- [x] Commit Source fixes on main; export a clean runtime; import/pin it in Lab and commit Lab fixes/pin.
- [x] Run the physical-robot-lab recorder with a fresh --out and run acceptance with LAB_V2_REGRESSION_DIR pointing at it. Capture exact failures/not_run reasons; do not relabel skipped native checks as passes.
- [x] Push verified main branches and deploy the existing production targets using their established tooling; verify public endpoints and deployment identities. Do not create new infrastructure or run unrelated database migrations.

## Task 5 — Updated standalone guide

Reference: source/artifacts/src/platform-guide/ and source/artifacts/mekoniq-platform-lab-guide-2026-11-06.html.

- [x] Create editable sources for a 2026-11-07 guide, preserving the prior artifact. Keep Vietnamese and offline operation, matching the reference guide.
- [x] Capture fresh Source/Lab screenshots with explicit capture environment, commits, runtime pin and timestamps. Use local synthetic data for authenticated/stateful flows; do not include production customer data or credentials.
- [x] Cover existing platform/Lab functions, Physical Robot Lab contracts/catalog/resolver/compiler/store/UI/evidence, the fixes, release verification and production URLs, and remaining native/shared-project/hardware work.
- [x] Generate the standalone HTML, validate desktop/mobile/offline/filter/print interactions, inspect representative screenshots, and commit the sources, captures, artifact and verification receipt.

## Verification commands

```sh
# Source (Node 24 on PATH)
pnpm lint
pnpm exec tsc --noEmit
pnpm contracts:check
pnpm exec vitest run tests/unit/engineering tests/integration/engineering tests/security/engineering tests/contracts
.venv/bin/python -m pytest robotics/simulation/tests -q

# Lab
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test engineering-design.spec.ts engineering-pairing.spec.ts --workers=1
# Recorder/acceptance paths are chosen as fresh absolute paths at execution and recorded in the release receipt.
```

## Completion receipt

Completed the scoped repairs, portable verification, main integration, production deployment and updated guide. See [release receipt](../implementation/evidence/physical-robot-lab/release-2026-11-07.md) and [current evidence index](../implementation/evidence/physical-robot-lab/README.md). R3 explicitly reuses 19 unchanged successful R2 commands and retries only the two failed commands; historical failures are preserved. Native/hardware and listed UI development remain open.
