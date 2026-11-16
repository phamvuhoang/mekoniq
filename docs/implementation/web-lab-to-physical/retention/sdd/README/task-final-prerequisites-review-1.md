# Final prerequisite correction 1 — independent scoped review

**Scoped specification verdict: PASS.** All four dispatched corrections satisfy their assigned preparation and regression requirements.

**Scoped quality verdict: APPROVE.** No new Critical, Important or Minor finding was identified in the supplied fix or its immediate integration. L06-R1-M1 is resolved by this separate final-triage correction; this does not reopen or repeat the closed L06 I1–I3 loop.

Approval permits root to resume final recording at the replacement tuple below. It does not complete B10/L06, final CI, the recording chain, the ONE whole-branch review, native/physical qualification or human acceptance. Automated records remain `accepted:false`; calibration remains `not_calibrated`.

## Scope, method and exact identity

Reviewed FIX_BASE Source `6e5eee9d7d504b0365422eb0ef7096e74e72e210` / Lab `283696be56bdaea1d310a1e56182f49792cf3b2c` through:

- Source `bab05a5311a9db3be447519b3b9ac48eb0e4a90d`, tree `86ced26c4a071704d0e7296387fd08fe2055f768`.
- Lab `1f9b48d6d2767bdcd623f08cfa45ba0f9af33d1d`, tree `e6225d8fb666aab04a00ec5e124a7521c7a3c402`.

Independent Git HEAD/tree/status reads matched both identities and clean trees. Independently compared all nine Source and five Lab changed files with their exact committed bytes and the root handoff's byte counts/hashes. No replacement or widened Git diff was generated.

Read the requirements-first final-recording brief, complete correction dispatch including the legacy-test addendum, complete fresh review dispatch, complete append-only final-recording report, both complete B10 reviews, both complete L06 reviews, and the complete central L06-R1-M1 entry and surrounding closure disposition. Read both supplied patches fully in bounded passes. Independent hash checks matched:

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| `review-final-prerequisites-1-source.diff` | 28,374 | `886dea1ecb334fa13dec5151ba188b0b334c12cd6a4eaa25d78ddaad8af7f0bc` |
| `review-final-prerequisites-1-lab.diff` | 6,860 | `aee5c540198311a6929a53eac3b75e55906aaa9ac6899fc9a38535cdf12b6f19` |
| `task-final-recording-report.md` | 17,250 | `a88ec210dae676cebc0e03d44638827f146602f4c0ea6874068e27c2d277efe8` |

Focused outside-patch reads addressed named integration risks only: the complete CI caller's workdir/start/stop ordering and configured service ports; the recorder's actual command/log/receipt boundary; R3's immutable profile table, native promotion predicate and case-to-gate derivation; and gateway startup ownership plus the explicit scenario registry and unchanged surrounding denial/idempotency tests. Two guessed scenario-module paths did not exist; the test's actual import identified `scenario-registry.ts`. No wider production review was performed.

Read the root handoff's identity, preservation and checked-byte attribution records, the relevant original diagnostics, complete correction RED/GREEN logs, original mock result summaries/failures, cleanup script/log and own-exit receipts. Independently hash-matched all 23 correction receipt files and their log bytes, and compared their argv/cwd/timing/before-after snapshots with the root handoff. Confirmed every final changed file has matching before/after checked bytes at the attributed checks. That establishes attribution, not behavioral coverage of every file by every command. Also hash-verified all 14 original-tuple external files and the mock/cleanup own logs.

No helper, suite/campaign rerun, Docker/cloud/native/browser/physical operation, service provisioning, original SQLite engine open, product edit or evidence edit was performed. Only this report was written. Checks discussed below are retained executions inspected by this reviewer, not new executions by this reviewer.

## Correction dispositions

### 1. Docker published-port admission — resolved

**Locations:** `source/scripts/owned-ci-ports.mjs:7`, `source/scripts/owned-source-ci.mjs:7`, `source/tests/unit/owned-ci-ports.test.ts:8`.

The real CLI calls `requireUnpublishedCiPorts(ports)` before host binds, temporary workdir creation and any Supabase command. A refusal writes a concise JSON result with `CI_PORT_INVENTORY_NOT_RUN`, `accepted:false` and `servicesStarted:false`, then exits 2 before entering the later start/stop region. The existing host-bind loop and cleanup remain after successful inventory admission.

The helper invokes fixed read-only Docker argv without a shell. It first lists full IDs with `ps --quiet --no-trunc`, admits at most 1,000 unique lowercase 64-hex IDs, and supplies only those admitted IDs to a fixed inspect format. Names, arbitrary selectors and parsed display-port text are not substituted into commands. Both subprocess calls have a five-second timeout and 1 MiB output limit; errors, signals and nonzero exit status refuse before parsing any partial result. A genuine successful empty list is the only no-container shortcut.

Inspect output must contain exactly one structured row per admitted ID. Exact row/binding keys, ID membership/uniqueness, non-null ports objects, valid container-port/protocol keys, binding arrays, IP addresses and canonical bounded decimal host ports are checked. A published conflict on any configured fixed port refuses regardless of IPv4/IPv6 address. Malformed, missing, duplicate, ambiguous or output-limit-truncated inventory cannot become an empty/free result through a catch fallback. No automatic port changes, namespace reuse, remote provisioning, reset/prune or unrelated stop was introduced.

The regression exercises the actual CLI with owned Docker and pnpm executables. Its refusal cases require all three consequences: a non-successful inventory diagnostic, no pnpm invocation and an empty scratch temp root. They cover conflicts, IPv6 conflict, malformed/missing/duplicate container data, failed command, overflow, timeout, bad/duplicate IDs, null ports and invalid bindings/ports. A valid nonconflicting structured inventory reaches the existing owned start-failure/stop boundary and creates its own workdir. A separate owned listener proves host-bind refusal still prevents pnpm/workdir creation and releases earlier binds. The original unrelated Supabase services are not test fixtures.

The semantic RED shows the old CLI creating workdirs and reaching its owned Supabase failure boundary despite the conflict/unreadable variants. The final complete port file passes all 16 tests, including the timeout case in approximately five seconds. The actual changed guard's receipt records exit 2 in 0.662 seconds with `CI_PORT_INVENTORY_CONFLICT:57424` and `servicesStarted:false`. This is a successful refusal observation, not passing service CI.

The original diagnosis is correctly narrowed: all six bind/close operations completed despite OrbStack-published listeners, the real earlier invocation reached its owned workdir/start boundary, and its outer 30-second SIGALRM preceded the inner 300-second start timeout. The exact start delay remains unknown. Neither the withdrawn port-close hypothesis nor the incorrect `/tmp`-only absence inference is used to justify approval. The inventory and bind checks remain sampled prerequisites, as documented; they are not an atomic lock against concurrent unrelated Docker activity.

### 2. Integrated Source lint invocation — resolved

**Locations:** `lab/scripts/record-regression.mjs:62`, `lab/tests/unit/recorder-lint.test.ts:8`.

The actual recorder call is now `pnpm -s exec eslint . --ignore-pattern .superpowers/**`. It excludes exactly the internal generated evidence subtree and leaves the normal authored Source tree and historical scripts subject to their existing lint configuration. No user-selected ignore/pass list or historical manifest mutation was added.

The unchanged recorder `run` boundary executes those argv directly, retains the real displayed command, own exit code, output log and log hash, and performs the existing identity checkpoints. The shell does not expand the ignore glob because the command uses an argv array.

The regression extracts the actual integrated call site and executes it in a scratch project containing a real `no-debugger` violation in an ignored generated file. Generated-only input exits 0; the same violation added to `authored.js` exits 1 and names the authored file without reporting the generated file. This is behavioral invocation evidence, not an assertion against a copied argument array. The old invocation's RED reports the generated violation. Retained per-invocation receipts independently match the successful empty log and deliberate authored-failure log. The authored exit 1 is an expected tested refusal, not a failed corrected suite.

The scratch `node_modules` symlink is explicitly a dependency reference. It is not an archived dependency closure or portable proof. The full corrected mock recorder was appropriately not rerun merely to test this command; its future final invocation remains required.

### 3. L06-R1-M1 arm64 blocker — resolved in final triage

**Locations:** `source/scripts/r3-readback.mjs:36`, `source/tests/unit/sim-extension-qualification.test.ts:490`, `source/docs/operations/native-profile-case-matrix.md:50`.

For the fixed `mujoco-linux-arm64` table entry, DEP-MJ-01 now returns `status:'not_run'`, category `tooling_and_observation`, and the reason `ASSIGNED_HOST_CASE_ARTIFACTS_MISSING; MUJOCO_ARM64_CAMPAIGN_ADAPTER_NOT_IMPLEMENTED`. The absent-host prerequisite remains separately named alongside the adapter gap. The existing derivation carries that exact case into `blockedNativeCases` and the native gate's blockers. The runbook explicitly explains why host assignment alone is insufficient.

The prepared arm64 fixture now has coherent arm64 architecture and a null image. It first passes public directory verification, then checks the case, blocked row and native gate together. The RED reaches the intended comparison and displays the former external-only case/blocker values; it is not an earlier handoff-admission failure. The GREEN preserves native `not_run`, `accepted:false` and the prepared required-case list.

The immutable required-case/scope table is unchanged: full arm64 still requires DEP-MJ-01 and DEP-SEC-01 in addition to preparation. The only existing MuJoCo native promotion predicate still requires amd64. No arm64 collector/campaign, native result, unsupported-feature pass or reduced gate was introduced. Other profile limitations and physical/calibration boundaries remain intact. This resolves the previously deferred diagnostic Minor, not arm64 native readiness, and does not claim that the earlier L06 Important-finding fix resolved it.

### 4. Four stale legacy assertions — resolved with invariants preserved

**Locations:** `source/tests/integration/lab-v2-contracts.test.ts:201`, `:234`; `source/tests/integration/lab-v2-mock.test.ts:135`, `:147`, `:159`, `:175`.

Gateway startup intentionally acquires `.runtime-owner.sqlite` before serving requests (`gateway.ts:53`, `v2/data-root.ts:13`). Both denial tests now assert that exact legitimate startup baseline and require the same complete root listing after denied requests. This permits the existing ownership lease while still rejecting every additional run/artifact entry. There is no blanket hidden-file filter.

The successful gateway test asserts the same exact baseline, verifies refusal leaves it unchanged, and checks that creation adds exactly one run directory. It reads that directory's `run.json` and binds its runId to the returned run. After the existing repeated, conflicting, stale and other-session actions it requires the same complete created directory set. The new expectation therefore does not merely replace the old assertion with an unbound count.

The registry expectation remains an explicit closed literal list, with MJ-FD01 and MJ-CELL-BV01 in their registered positions. It is not derived from the implementation registry. The disabled-backend health scenario list remains a separate unchanged assertion. Network spies, disabled-backend/hardware refusals, access-mode/capability checks, session isolation, action response equality and conflict/stale-revision checks remain intact. No production authority was changed to satisfy these assertions.

The independently inspected original `source-referenced.json` is 282 passed / 4 failed / 1 skipped, 287 total. Its four failures are the two empty-root expectations, the old registry list and the one-root-entry assertion. The measurement skip is the explicit LAB_V2_MEASURE opt-in and remains `not_run`. The first correction attempt's registry-order mistake is retained as 29 passed / 1 failed. The final `legacy-green2` executes both entire affected files and records 30/30 passing, on the final test bytes.

## Verification adequacy and evidence attribution

| Retained invocation | Actual outcome | Review meaning |
| --- | --- | --- |
| `source-red` | 8 failed / 1 passed / 47 filtered; exit 1 | Seven missing early-admission failures and the coherent per-case arm64 diagnostic failure. Filtered cases are not_run. |
| `source-port-broad` | 2 files / 18 passed; exit 0 | Expanded actual-CLI inventory cases plus owned config checks. |
| `source-combined` | 5 files / 104 passed; exit 0 | Final port/config, qualification, native-readback and R2b-reader scopes. |
| `lab-lint-red` | 1 failed; exit 1 | Old integrated command genuinely lints the generated debugger violation. |
| `lab-lint-green` | 2 files / 16 passed; exit 0 | Corrected invocation behavior and existing recorder tests. |
| `legacy-green2` | 2 files / 30 passed; exit 0 | Both complete affected legacy test files, without filtering. |
| `actual-owned-ci-refusal` | exit 2; conflict 57424; servicesStarted false | Actual prerequisite refusal only. |

These scopes overlap and must not be summed. The initial scratch quoting SyntaxError is not a semantic RED. The first explicit registry-order correction failure is also distinct from the established original stale expectations. Both remain preserved. Source full contracts/typecheck and scoped lint of the seven changed code/test files have own exit 0; Lab typecheck, final-pin typecheck and check:source have own exit 0. Empty lint/diff logs are supported by receipts rather than treated as proof on their own. No full final Source build/test or browser/engine chain was executed during this correction.

Before/after changed-file hashes bind the pre-commit checks to the final committed bytes. The checks are not falsely described as all having started at clean final HEAD. The five-file combined selection includes the earlier 37-test native reader scope, but this review does not repeat its closed L06 I1–I3 assessment or promote protocol fixtures to native evidence.

The root audit supplies the fresh clean 60-file export/import/pin and complete schema/closure preservation audit. This reviewer verified the final changed-file bytes and checked-receipt attribution, not every closure member or all 1,040 prior indexed entries again. Recorded preparation identities are:

- Runtime `e280572231e51db029dc3db7a9c67dfd1b63a1417d0527ccbd20786683a45ba0`; raw manifest `98924033c8a47ea533e80f0c1f54e4235e429000c71bfb128c436acc67fa9f04`.
- Schema `c2bdaca0b5ce9b03ee52a8c497719f4ea83b2cbb0e23c4e18365099fd163fa12` (58); native `35aebff4ba065eae48c088a91c94fd7a08af6fd723560e0fdb68cbdc112cce0b` (226); portable `778c336cd3bcffa975cbea2967915f27fd5f94124ec986e75f2dac031d55df93` (238).
- Checker at exact Source bab05a5: `a71ce7c0419047b59a4b2a853d09df0f2efaa06c23c216cb506d9788eaaffa28`.

The original successful Source build and arm64 image stay at Source 6e5eee9 / Lab 283696b. The image tag `mekoniq-final:6e5eee9-web05`, config `sha256:1b2bcbc1eb37fb1dd0606922df85ab6e9869fd7aedff6acc02d05d04935eb941`, is not a replacement-tuple image. OCI still refuses with `LOCAL_BUILDER_REQUIRED`; the existing builder was not changed to manufacture readiness. Docker arm64 on this Mac is not an assigned native Linux target.

## Original mock interruption and cleanup

The retained ownership proof identifies recorder PID 63988 by its exact external-output argv and three descendants (65435, 70954, 70997). The cleanup script freezes the proved recorder and signals only that enumerated hierarchy leaf-first with SIGINT, then resumes the recorder to deliver its pending signal. The recorded observation after two seconds has no remaining enumerated PID and no TERM target. There is no broad pattern kill in this cleanup. Its own receipt exits 0; the mock wrapper's own receipt is `exitCode:null`, `signal:SIGINT`.

This supports cleanup of the recorded owned hierarchy; it is not a new system-wide process audit or proof about unrelated processes. The recorded old Docker inventory contains the eight pre-existing unrelated Supabase containers and no newly created owned-ci container. None becomes an authorized test namespace through this review.

The original mock records Source typecheck/contracts exit 0, unexcluded lint exit 1 with 1,647 problems, and the referenced suite's 282/4/1 result. Source unit was interrupted without a complete result; subsequent steps remain not_run. No completed mock qualification or invented manifest is inferred. The report preserves its earlier mistaken hypothesis and then explicitly corrects it, rather than rewriting original observations.

## Cannot verify and retained limits

1. Full real owned-service start/status/test/cleanup, Source CI and Auth/Storage/PostgreSQL isolation at the replacement tuple remain unexecuted. Current fixed-port occupancy remains a prerequisite refusal. Portable CLI stubs prove the admission boundary, not actual Supabase lifecycle success, and sampled inventory/binds do not prevent subsequent concurrent external changes.
2. The replacement-tuple image/build/WEB05 lifecycle, final mock → IR-SIM → R1 → R1.1 → R2a → payload/cell/study/web → R2b/R3 prepared recording/readback chain, final production performance, 390px DOM/screenshot behavior and stripe diagnosis remain pending. No original-tuple result transfers merely because some bytes or closures are unchanged.
3. Actual native Linux/ROS/Gazebo/xArm/LinuxCNC/MuJoCo host execution, package/image/installed-host trust, native timing/contact/controller/security outcomes and physical operation remain unverified. The arm64 adapter, complete security collectors and other inherited unimplemented/unobserved capabilities remain missing; explicit blockers do not establish execution or unsupported-feature passes.
4. Consistent hashes and receipts do not authenticate execution, host provenance, reviewer signatures or the entire Git graph. The original L01 exact-clean-checker reproduction requirement remains. Subject, observer/checker, installed-host and later publication identities must remain distinct. No original retained SQLite engine behavior, WAL recovery or native bag payload semantics was checked here.
5. Final retention/publication completeness, clone-layout/link audits, deferred browser/documentation dispositions, physical dossiers/calibration/conformance, human acceptance and the ONE final whole-branch review remain root-controlled work. Earlier full B10/L06 Cannot-verify scopes remain applicable except for the specific local preparation corrections approved here. No physical or acceptance gate is closed by this scoped approval.

No additional correction is required by this review. Resume only the authorized final-recording scope at the reviewed replacement tuple, preserving the original failures, immutable historical evidence and all outstanding qualification limits.
