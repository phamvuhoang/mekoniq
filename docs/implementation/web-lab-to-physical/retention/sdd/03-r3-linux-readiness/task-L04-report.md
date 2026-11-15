# L04 — PUMA/LinuxCNC actual-joint trace and scoped ALG04

Status: **DONE_WITH_CONCERNS — portable preparation complete; native L04 qualification remains incomplete.** No assigned Debian LinuxCNC host was available. DEP-CNC-01/02/03, full ALG04, SEC-01, GUI, physical motion and calibrated dynamics have not been qualified. All actual native/GUI requests in this task were Mac preflight refusals, not controller runs. Root owns independent review.

## Scope, bases and decisions

Only the isolated `source` and `lab` worktrees under `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/` changed, on `codex/web-lab-to-physical`. Original task range: Source `7b5b3a17e501f125efac18749ad5b8123940ce7c` → final Source below; Lab `58d082a9d57ea9216fa123ebb5d676ae1421b550` → final Lab below. No amend/rebase/squash concealed the first tuple. No helpers/reviewers, Docker retry, cloud/provisioning, push/merge/deploy, original-main mutation or physical connection occurred. No SQLite was opened or retained. No R2a engine/model/lock or historical qualification record was edited.

Read task brief/dispatch first, relevant L00 PUMA/native_apt and L03 final-interface report sections, native model conventions and bridge units. Applied test-driven development and verification-before-completion skills. Root confirmed receive brackets without invented controller time. One concrete closure conflict was raised: nativeTools previously omitted controller scripts/packaging. Root recorded **R89** authorizing both immutable directories in nativeTools; generated traces/run inventory remain evidence outside the closure. The existing native_apt admission rules and public clean-checker/full-Git-graph gate are unchanged.

## APIs and changed files

| Source path | Behavior |
| --- | --- |
| `integrations/arm-controller/scripts/smoke_driver.py` | New `sample_actual_joints`, `controller_epoch`, `trace_record`, `LinuxcncController.assert_epoch`; additive optional `run_sequence(..., before_action=...)`, wired by native `main`. Actual/desired joint arrays, raw degrees and radians, independent IDs, kernel-boot/PID/start-time epoch, host receive bracket. Missing vectors stay null; unavailable controller time/synchrony stay explicit. Guards before actions and across polls refuse observed restarts. Interrupted terminal actions retain preceding steps and failed action; output files use exclusive creation. |
| `integrations/arm-controller/scripts/prepare_smoke.py` | The SIM backend label alone no longer admits caller-edited INI/HAL. Stages byte-matching reviewed INI, virtual HAL/DH HAL, profile, tool and cup geometry only. |
| `integrations/arm-controller/scripts/smoke-sim.sh` | Refuses every nonempty evidence directory; binds actual trace path/size/SHA when present, keeps supplied subject commit, accepted:false and native timing not_run. Existing terminal-versus-GUI separation remains. |
| `integrations/arm-controller/scripts/runtime-inventory.py` | Adds source package/version and unchanged binary ISA/version mapping, dpkg argv/exit/stdout/stderr/hash, OS-release and apt source-file identities. Does not pretend these are resolved retained archive/source/trust proofs; no native_apt installation claim on Mac. |
| `integrations/arm-controller/packaging/dependencies.lock.json` | Preserves existing candidate pins, adds explicit unresolved nativeQualification fields. No Debian package was resolved or installed; no ARM64↔amd64 relabeling. |
| `packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts` | New `validateLinuxcncTrace(unknown)` and `runLinuxcncAlg04(checker, input)`. Pinned native PUMA manifest/DH/frames/tool/profile, units/raw-SI conversion, nonempty independent samples, joint limits, clock/sequence/receive brackets and unique IDs are checked before RTB. Epoch coverage splits; no interpolation or continuous-trajectory pass. RTB takes supplied actual joints only. |
| `scripts/lab-algorithm.mjs` | Additive `linuxcnc --trace FILE --out DIR [--python PATH]`; old `run` behavior preserved. Retains input byte SHA, separate supplied subject commit and actual local checker checkout identity, profile/lock digests and structured ALG04 result. Output must be new. |
| `scripts/native-sim/tool-identity.mjs` | R89 adds immutable arm-controller/scripts and packaging directories; existing sort, cache/metadata exclusions and symlink refusal remain. Native closure rises from 213 to 225 files. |
| `tests/integration/linuxcnc-alg04-evidence.test.ts` | Sixteen tests: negative admission boundaries, epochs, real RTB numeric subset over explicit protocol-double inputs, exact actual-input assertion, public CLI byte/identity output and numerical fail winning over not_run. |
| `integrations/arm-controller/tests/test_actual_trace.py` | Ten protocol tests: raw/converted fields, no synthetic clock/Cartesian substitution, missing samples, unsafe HAL refusal, native package/source ISA parser, restart during poll, failed-step retention, truthful init failure, pre-action guard and main wiring. |
| `integrations/arm-controller/tests/test_smoke_launch.py` | Existing status double now supplies the epoch dependency; no test-only sampler fallback in production. |
| `tests/unit/native-tool-identity.test.ts` | Recorder/package-lock membership and byte-mutation coverage, existing metadata/worker regression; fixture roots now include prior manipulation/navigation/native-fixture closure members. |
| `docs/operations/linuxcnc-native-sim-handoff.md` | Exact native commands, independent roles, model/clock/metric semantics, trust/package/GUI obligations, R89 and remaining native limitations. |

Lab changes are only `config/source-runtime.lock.json` and regenerated Source-commit headers in `src/shared/{engineering,navigation2d}.ts`. Contract/schema contents, canonical PUMA model/DH/frames, bridge routes, runtime authority and hardware capabilities are unchanged.

## Evidence semantics and remaining limits

The source model is the native controller PUMA table, never the illustrative mock or xArm. It keeps inch lengths, degree joints, radian alpha, JOINT_0–5/J1–6 signs/offsets/limits, exact modified DH and arm_base→tcp/tool-0-notool. Inertia/physical placement remain unknown/not_calibrated. `actual_position` is not six joint angles. No velocity default or zero-motion proof was added.

The sampler reads `joint_actual_position` and `joint_position` independently. Its one host monotonic bracket covers polling/field reads, not controller sample time or field synchrony. `controllerTime:null`, clock unavailable and synchrony unavailable remain explicit; neither cycle_time nor echo_serial becomes a synthetic clock. Native host API/epoch compatibility has not run. Process lookup is deliberately refused if ambiguous/missing. The before-action guard and before/after-poll identity checks are observations, **not atomic controller-side fences**: restart after the guard and before an NML write remains unqualified. A hard kill before final flush can leave no trace; absent/partial trace cannot qualify anything. No resend, respawn or automatic continuation was added.

ALG04 separates:
- Within-poll `maxObservedCommandActualDeltaRad`, explicitly not synchronized following-error qualification.
- `maxFkTranslationResidualM` / `maxFkRotationResidualRad`: RTB versus TypeScript FK on the independently supplied actual angles, with exact native DH; this is numerical consistency, not native controller accuracy.
- Controller Cartesian-versus-DH/TCP residual: not_run, `CONTROLLER_CARTESIAN_DH_TCP_ENDPOINT_NOT_ESTABLISHED`; no invented comparable work/tool-offset endpoint.

`numericVerdict` may pass for the numerical subset. Overall ALG04 remains not_run due to unavailable native clock/synchrony, execution authenticity and continuous motion coverage. A numeric failure remains fail. Explicit protocol_double test data cannot qualify a host. An input JSON native_capture label or supplied subject commit is not authentication. The new CLI records local checker identity but does not replace the native-handoff public clean-checker/full-Git-graph verifier. No actual native trace or production ALG04 candidate was created in this task; test CLI outputs were temporary protocol-double fixtures. Existing public-checker tests use isolated test repositories, not a qualification claim for this task.

## RED → GREEN and failed attempts

Every failed attempt remains in `evidence-L04/`, with own command, Source commit/tree/status, changed file SHA256s, numeric exit, full output, byte count and output SHA256. Receipt runner is `evidence-L04/check.py`; output is captured directly from the one subprocess, not inferred from a trailing cat/diff. Older successful checks are not relabeled as running on a later clean commit.

- `red-python`: tooling failure, stock Python3.11 had no pytest; **not behavioral RED**. Existing `.venv-algorithm` Python3.11 enabled `red-python-02`: four real failures (sampler absent and modified HAL admitted).
- `red-ts`: fourteen expected missing-consumer assertion failures. `green-ts-01`:14/14, including real RTB on test input.
- `red-cli`: absent report raised ENOENT; retained as first test-shape attempt. `red-cli-02` corrected the assertion and failed explicitly on missing retained trace report. `red-inventory` failed missing source-package parser. `green-wiring`:15/15.
- `typecheck-01`: checkerId incorrectly used robotics-toolbox; corrected to existing `rtb_kinematics`. `typecheck-02` and final typecheck passed.
- `red-epoch-failure`: terminal exception exposed lost step history; epoch test also had an incomplete double (missing lc). `red-epoch-02` fixed the double and explicitly failed because no restart was refused across a poll.
- `green-python-02`: collection failed because `.venv-algorithm` lacked rfc8785/jsonschema; **not behavioral RED**. Existing `.venv-irsim` Python3.11 supplies those dependencies; combined controller tests then passed.
- `red-init-reason` exposed misleading missing-module labeling for ambiguous native process identity; corrected reason is controller initialization failure.
- `red-closure` failed because recorder/package files were absent from nativeTools; R89 expansion passed combined closure tests.
- Initial complete tuple had 138 TS tests and 69 Python tests +8 subtests passing. Final initial Python run `combined-python-final-02` pins PATH to Python3.11 for wrapper subprocesses too. Earlier wrapper subprocesses inherited the Mac default Python3.15.2, though their pytest worker was Python3.11; they are retained, not presented as final interpreter proof.
- Late self-review after the first clean tuple found the next-action restart window. `red-pre-action-guard` explicitly failed on absent guard and `red-pre-action-wiring` showed four controller actions sent before failed epoch admission. Follow-up `guard-python-final` passed 71 tests +8 subtests, including native-main wiring, with Python3.11 throughout. The follow-up touched only smoke_driver, its new tests and the runbook. Unchanged TS/type/contracts/lint checks remain attributed to the first implementation bytes; the final audit maps all 13 final Source paths to those checked bytes plus the guard follow-up.

No package install/network repair or portable dependency lock mutation was used to fix test tooling. Node24.22.2/pnpm10.32.1 were used through the receipt runner, and Python tests use PYTHONDONTWRITEBYTECODE=1/PYTEST_ADDOPTS=-p no:cacheprovider. Test subprocess groups/resources are managed by existing deadline/fixture cleanup. No unrelated process cleanup occurred.

## Actual checks and receipts

The table lists every retained check receipt. `SOURCE` and `LAB` abbreviate the exact isolated paths above in rendered argv only; each linked receipt keeps the unabridged argv/cwd and byte identities. Empty output is accepted only with that check's own exit0. Targeted selections' skipped/deselected tests are not counted as passes. Discovery reads and edits are not verification receipts.

| Receipt/log stem | Exit | Exact argv (path prefixes abbreviated) |
| --- | --- | --- |
| [red-python.log](evidence-L04/red-python.log) / [receipt](evidence-L04/red-python.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' /opt/homebrew/bin/python3.11 -m pytest tests/test_actual_trace.py -q` |
| [red-ts.log](evidence-L04/red-ts.log) / [receipt](evidence-L04/red-ts.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts` |
| [red-python-02.log](evidence-L04/red-python-02.log) / [receipt](evidence-L04/red-python-02.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py -q` |
| [green-ts-01.log](evidence-L04/green-ts-01.log) / [receipt](evidence-L04/green-ts-01.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts` |
| [green-python-01.log](evidence-L04/green-python-01.log) / [receipt](evidence-L04/green-python-01.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py -q` |
| [typecheck-01.log](evidence-L04/typecheck-01.log) / [receipt](evidence-L04/typecheck-01.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [red-cli.log](evidence-L04/red-cli.log) / [receipt](evidence-L04/red-cli.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts -t 'public CLI'` |
| [red-inventory.log](evidence-L04/red-inventory.log) / [receipt](evidence-L04/red-inventory.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py -q -k inventory` |
| [red-cli-02.log](evidence-L04/red-cli-02.log) / [receipt](evidence-L04/red-cli-02.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts -t 'public CLI'` |
| [green-wiring.log](evidence-L04/green-wiring.log) / [receipt](evidence-L04/green-wiring.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts` |
| [red-epoch-failure.log](evidence-L04/red-epoch-failure.log) / [receipt](evidence-L04/red-epoch-failure.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py -q -k 'epoch_change or terminal_failure'` |
| [red-epoch-02.log](evidence-L04/red-epoch-02.log) / [receipt](evidence-L04/red-epoch-02.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py -q -k epoch_change` |
| [green-python-02.log](evidence-L04/green-python-02.log) / [receipt](evidence-L04/green-python-02.receipt.json) | 2 | `perl -e 'alarm 170; exec @ARGV' SOURCE/.venv-algorithm/bin/python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py tests/test_release_security.py -q` |
| [changed-lint.log](evidence-L04/changed-lint.log) / [receipt](evidence-L04/changed-lint.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts scripts/lab-algorithm.mjs tests/integration/linuxcnc-alg04-evidence.test.ts` |
| [typecheck-02.log](evidence-L04/typecheck-02.log) / [receipt](evidence-L04/typecheck-02.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [combined-python.log](evidence-L04/combined-python.log) / [receipt](evidence-L04/combined-python.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' SOURCE/.venv-irsim/bin/python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py tests/test_release_security.py -q` |
| [red-init-reason.log](evidence-L04/red-init-reason.log) / [receipt](evidence-L04/red-init-reason.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' SOURCE/.venv-irsim/bin/python -m pytest tests/test_actual_trace.py -q -k native_identity_failure` |
| [red-closure.log](evidence-L04/red-closure.log) / [receipt](evidence-L04/red-closure.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/native-tool-identity.test.ts` |
| [combined-python-final.log](evidence-L04/combined-python-final.log) / [receipt](evidence-L04/combined-python-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' SOURCE/.venv-irsim/bin/python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py tests/test_release_security.py -q` |
| [combined-ts.log](evidence-L04/combined-ts.log) / [receipt](evidence-L04/combined-ts.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts tests/unit/native-arm-tunnel.test.ts tests/unit/native-tool-identity.test.ts tests/unit/lab-algorithm-cli.test.ts tests/security/algorithm-checker.test.ts` |
| [combined-ts-final.log](evidence-L04/combined-ts-final.log) / [receipt](evidence-L04/combined-ts-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm exec vitest run tests/integration/linuxcnc-alg04-evidence.test.ts tests/unit/native-arm-tunnel.test.ts tests/unit/native-tool-identity.test.ts tests/unit/lab-algorithm-cli.test.ts tests/security/algorithm-checker.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/security/native-handoff-checker.test.ts` |
| [diff-check-final.log](evidence-L04/diff-check-final.log) / [receipt](evidence-L04/diff-check-final.receipt.json) | 0 | `git diff --check` |
| [contracts-final.log](evidence-L04/contracts-final.log) / [receipt](evidence-L04/contracts-final.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm contracts:check` |
| [changed-lint-final.log](evidence-L04/changed-lint-final.log) / [receipt](evidence-L04/changed-lint-final.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts scripts/lab-algorithm.mjs scripts/native-sim/tool-identity.mjs tests/unit/native-tool-identity.test.ts tests/integration/linuxcnc-alg04-evidence.test.ts` |
| [typecheck-final.log](evidence-L04/typecheck-final.log) / [receipt](evidence-L04/typecheck-final.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [combined-python-final-02.log](evidence-L04/combined-python-final-02.log) / [receipt](evidence-L04/combined-python-final-02.receipt.json) | 0 | `env PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py tests/test_release_security.py -q` |
| [source-final-diff.log](evidence-L04/source-final-diff.log) / [receipt](evidence-L04/source-final-diff.receipt.json) | 0 | `git diff --check` |
| [source-staged-check.log](evidence-L04/source-staged-check.log) / [receipt](evidence-L04/source-staged-check.receipt.json) | 0 | `git diff --cached --check` |
| [clean-export.log](evidence-L04/clean-export.log) / [receipt](evidence-L04/clean-export.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l04-runtime-962e925-20261115` |
| [lab-import.log](evidence-L04/lab-import.log) / [receipt](evidence-L04/lab-import.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/import-runtime.mjs /tmp/l04-runtime-962e925-20261115` |
| [lab-sync.log](evidence-L04/lab-sync.log) / [receipt](evidence-L04/lab-sync.receipt.json) | 0 | `node scripts/sync-engineering-contracts.mjs` |
| [terminal-preflight.log](evidence-L04/terminal-preflight.log) / [receipt](evidence-L04/terminal-preflight.receipt.json) | 2 | `env MEKONIQ_SOURCE_COMMIT=962e925a9b5f1adadbc5c881be43f7f170034264 PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir SOURCE/.superpowers/sdd/03-r3-linux-readiness/evidence-L04/native-not-run/terminal` |
| [gui-preflight.log](evidence-L04/gui-preflight.log) / [receipt](evidence-L04/gui-preflight.receipt.json) | 2 | `env MEKONIQ_SOURCE_COMMIT=962e925a9b5f1adadbc5c881be43f7f170034264 PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir SOURCE/.superpowers/sdd/03-r3-linux-readiness/evidence-L04/native-not-run/gui --gui` |
| [lab-check-source.log](evidence-L04/lab-check-source.log) / [receipt](evidence-L04/lab-check-source.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| [lab-typecheck.log](evidence-L04/lab-typecheck.log) / [receipt](evidence-L04/lab-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [lab-staged-check.log](evidence-L04/lab-staged-check.log) / [receipt](evidence-L04/lab-staged-check.receipt.json) | 0 | `git diff --cached --check` |
| [identity-final.log](evidence-L04/identity-final.log) / [receipt](evidence-L04/identity-final.receipt.json) | 0 | `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L04/audit-final.py` |
| [red-pre-action-guard.log](evidence-L04/red-pre-action-guard.log) / [receipt](evidence-L04/red-pre-action-guard.receipt.json) | 1 | `env PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 120; exec @ARGV' python -m pytest tests/test_actual_trace.py -q -k epoch_guard` |
| [red-pre-action-wiring.log](evidence-L04/red-pre-action-wiring.log) / [receipt](evidence-L04/red-pre-action-wiring.receipt.json) | 1 | `env PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 120; exec @ARGV' python -m pytest tests/test_actual_trace.py -q -k native_main_wires` |
| [guard-python-final.log](evidence-L04/guard-python-final.log) / [receipt](evidence-L04/guard-python-final.receipt.json) | 0 | `env PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py tests/test_model_units.py tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_release_trust.py tests/test_release_security.py -q` |
| [guard-final-bytes.log](evidence-L04/guard-final-bytes.log) / [receipt](evidence-L04/guard-final-bytes.receipt.json) | 0 | `git diff --check` |
| [guard-clean-export.log](evidence-L04/guard-clean-export.log) / [receipt](evidence-L04/guard-clean-export.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l04-runtime-3edb432-20261115` |
| [guard-lab-import.log](evidence-L04/guard-lab-import.log) / [receipt](evidence-L04/guard-lab-import.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/import-runtime.mjs /tmp/l04-runtime-3edb432-20261115` |
| [guard-lab-sync.log](evidence-L04/guard-lab-sync.log) / [receipt](evidence-L04/guard-lab-sync.receipt.json) | 0 | `node scripts/sync-engineering-contracts.mjs` |
| [guard-terminal-preflight.log](evidence-L04/guard-terminal-preflight.log) / [receipt](evidence-L04/guard-terminal-preflight.receipt.json) | 2 | `env MEKONIQ_SOURCE_COMMIT=3edb4320d7146343a4b9df977c65d846472c473b PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir SOURCE/.superpowers/sdd/03-r3-linux-readiness/evidence-L04/native-not-run-final/terminal` |
| [guard-gui-preflight.log](evidence-L04/guard-gui-preflight.log) / [receipt](evidence-L04/guard-gui-preflight.receipt.json) | 2 | `env MEKONIQ_SOURCE_COMMIT=3edb4320d7146343a4b9df977c65d846472c473b PATH=SOURCE/.venv-irsim/bin:/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin perl -e 'alarm 170; exec @ARGV' bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir SOURCE/.superpowers/sdd/03-r3-linux-readiness/evidence-L04/native-not-run-final/gui --gui` |
| [guard-lab-check-source.log](evidence-L04/guard-lab-check-source.log) / [receipt](evidence-L04/guard-lab-check-source.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| [guard-lab-typecheck.log](evidence-L04/guard-lab-typecheck.log) / [receipt](evidence-L04/guard-lab-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [guard-lab-staged-check.log](evidence-L04/guard-lab-staged-check.log) / [receipt](evidence-L04/guard-lab-staged-check.receipt.json) | 0 | `git diff --cached --check` |
| [identity-final-v2.log](evidence-L04/identity-final-v2.log) / [receipt](evidence-L04/identity-final-v2.receipt.json) | 0 | `python3 .superpowers/sdd/03-r3-linux-readiness/evidence-L04/audit-final-v2.py` |

## Executed versus not_run

| Requirement | Actual scope |
| --- | --- |
| Trace admission/model/units/clock/epochs | Portable tests executed; independent recorded native input absent. |
| Numerical ALG04 consumption | Real RTB checker exercised against explicitly protocol-double raw joint inputs; native ALG04 not_run. |
| SIM-only config; arbitrary MDI/HAL/launch boundaries | Byte-exact staging and existing arbiter/security/tunnel tests executed; real native endpoint conformance not_run. |
| Debian version/package/source/ISA resolution | Not_run: no assigned host; candidate values remain unverified and resolvedHost/packages/source artifacts null. |
| Terminal start/home/run/pause/resume/stop/fault/no-auto-resume | Native not_run. Mac wrapper preflight only, two separate attempts per tuple, each exit2. |
| Controller restart/tunnel loss/deadline/arbiter | Portable protocol/security tests executed; native controller/tunnel behavior not_run. |
| Package install/verify/rollback and trust | Existing portable release trust/security tests executed; actual package install/rollback/trust on target not_run. |
| GUI/HMI acceptance | Not_run. --gui requests refused at Mac preflight; no GUI launch, screenshot-based pass or human checklist. |
| Commit → clean export → import/sync/check/type/pin | Executed successfully for both retained tuples; no allow-dirty export. |

The four actual preflight calls produced fresh directories `native-not-run/{terminal,gui}` for the first tuple and `native-not-run-final/{terminal,gui}` for the final tuple. Every `smoke-sim.json` says blocked_external/not_run, accepted:false; reasons are HOST_NOT_LINUX, LINUXCNC_MISSING and LINUXCNC_PYTHON_MODULE_MISSING. `actualJointTrace` is null and no `linuxcnc.log`, driver trace or native process was produced. Runtime inventory identifies Darwin/arm64 and Python3.11 honestly; it is not Debian/amd64 evidence. No Docker invocation occurred (R76 remains deferred to B10).

## Commits, export and identities

First tuple (preserved): Source `962e925a9b5f1adadbc5c881be43f7f170034264`, Lab `7564d489722d81e5ff5f31bea5d61439b91ea7cf`, export `/tmp/l04-runtime-962e925-20261115`, artifact `0abee6f3bb8e04535149a885bb69c2e4593bf93bd794fae455017614a733315f`. Its Source tree is 82cb9600bb4f70acb3419197848d13d28f5d16aa; nativeTools e16987678e2622ecb762baa1d1aabe4921f6bf136bbf0a07424ef8df8100d481. First identity record remains `evidence-L04/identities-final.json`; all first receipt/export/cache/preflight bytes remain unchanged.

Follow-up Source `3edb4320d7146343a4b9df977c65d846472c473b` contains the pre-action guard. Final pin and checked identities:

| Field | Final value |
| --- | --- |
| sourceCommit | `3edb4320d7146343a4b9df977c65d846472c473b` |
| sourceTree | `2285bf8bae3d249f19c505bfd10f0696d0710d29` |
| labCommit | `e8ed78b98399947a26e525b8f9902e3463aef36a` |
| labTree | `4b06deecc757d54e58891c5beee656d62c7364fb` |
| export | `/tmp/l04-runtime-3edb432-20261115` |
| artifactSha256 | `8303ab748c346c9fbe506b756c3d795f28ad3a5e309b36f6c0f766baeb5ced03` |
| manifestSha256 | `be6e6541c928b031cf678fbc22e29c8911625a82f9476bd409821b1f0de30d81` |
| cacheManifestSha256 | `d5410b4d19eb9510b8c04238b8480b1270cc49f959e64c32340f9f803094c4bf` |
| labPinSha256 | `3db3e32e9557c9f3ee09d76074f9e8662780ed85ddfbdfb8065d249d33938f55` |
| schemaHash | `9e869f41bd7dbbbae1f26f81b75449b727e7160fdfb1a3b32cf3b23a5cb034e4` |
| nativeToolsDigest | `f5be98c0bc4a37a72e3f68446c58e781854b6922449fc1bccc5df7bfce35de61` |
| nativeToolsFiles | `225` |
| portableToolsDigest | `1fb6f053d4903a109a41f862556a02c2fd71c60d5011d94d27463165ad697d82` |
| portableToolsFiles | `237` |

Source identity is the committed producer/tool checkout. Subject Source for each actual preflight is supplied explicitly and matches that tuple. There is no native subject execution or native trace producer identity to certify. Numerical checker integration tests ran against changed checkout bytes recorded by their receipts; they are protocol-fixture checks, not native candidate checker attestations. Lab commits are publication/pin identities and are never substituted for the subject or checker.

`identity-final-v2.log` and its own exit0 receipt verify 49 previous receipts, all 13 final changed Source file SHA256s against checked snapshots, both clean worktrees, runtime export/cache/pin equality, 225 native and 237 portable source/committed-byte closure members, first L04 tuple preservation and unchanged prior L03 final export/cache. The final audit itself adds the 50th check receipt. Its `identities-final-v2.json` contains every file's exact SHA and the final preflight-file hashes. Exported and cached manifest JSON objects are equal; importer formatting accounts for distinct byte SHA values. NativeTools changed intentionally; portable closure and schema digests are unchanged. This is local byte/receipt consistency, not effective Git-graph attestation or host authentication.

Historical evidence was not rewritten. The prior L03 final export manifest remains 3ae99664dfb2ce993a12f433ae9a7bda5361407fd06742c05566da554d71bc1e; its cached manifest remains a6942acac622d10808702b4a84f1097c2710ab37a0abb19f006fa0235de2be71 and its runtime retains 108e6233183a0646cc09ddb4e376a6a5fda3262cc964d7be242e991b3c08863a. No old artifacts were relabeled with a new checker/source identity. The whole task review range includes both Source commits and both Lab pins from the original bases.

## Self-review and handoff

Self-review covered actual-versus-commanded independence, exact native model and units, missing-data handling, epoch segmentation, no fabricated controller clock/heartbeat, no interpolation, fail-over-not_run, truthful producer/checker/subject roles, SIM closure and evidence immutability. It caught the erroneous checkerId, misleading initialization reason, test-only fallback, wrapper-interpreter ambiguity and late pre-action restart window; failed attempts and the first tuple are preserved. Existing bridge recovery/trust/native-handoff/tunnel tests pass in their stated portable scope. No implementation bridge change was needed.

The remaining concerns are required native work, not portable test failures: assign the actual Debian/ISA host, resolve and retain binary/source/trust provenance, validate installed LinuxCNC API/process identity and native endpoints, collect independent actual motion samples, establish documented controller timing/field synchrony or keep those gates incomplete, establish comparable Cartesian/DH/TCP endpoints, run actual restart/tunnel/security/package cases, complete the separate GUI checklist and obtain human acceptance. Dynamics remain not_calibrated. Full native qualification remains incomplete even though this preparation is ready for root's independent review.


# L04 fix round 1 — Important L04-R1

Status: **DONE_WITH_CONCERNS — L04-R1 corrected and ready for scoped root review; native qualification remains incomplete.** Fix bases: Source `3edb4320d7146343a4b9df977c65d846472c473b` / Lab `e8ed78b98399947a26e525b8f9902e3463aef36a`. The original task base range and report above remain unchanged. Minor L04-R2 is deferred in the central index as instructed and was not modified in this round.

## Finding disposition and implementation

L04-R1 was confirmed locally: validating six files and then copying the caller directory admitted a sibling `sim.var` that the canonical INI consumes. It also reread checked files while copying. This fix changes only three Source files:

- `integrations/arm-controller/scripts/prepare_smoke.py`: captures the requested INI once, parses those captured bytes and verifies them against canonical bytes; captures and verifies the other five allowlisted files; creates a new mode0700 directory; stages only captured snapshots with exclusive writes. The staged INI is serialized from that checked snapshot with the existing approved path/display substitutions. No caller-directory copy or second unbound caller-content read remains. An existing destination, including one containing prior parameters, is refused. GUI assets still come from the package HMI directory, with existing terminal/program/model/GUI paths preserved.
- `integrations/arm-controller/tests/test_actual_trace.py`: five additional test cases cover extra `sim.var`/other siblings in terminal and GUI staging, later mutation of checked HAL and INI inputs, and refusal to overwrite existing destination state. Caller files are left untouched by production staging. The deterministic mutation fixture changes only its temporary caller inputs after capture; it is not native evidence.
- `docs/operations/linuxcnc-native-sim-handoff.md`: states the allowlist/snapshot rule and absence of caller `sim.var` at startup. Any parameters LinuxCNC subsequently creates are per-run temporary state, not immutable source inputs or inputs reused for another run.

Canonical configuration/model bytes, bridge/controller logic, oracle admission, schemas and portable tooling remain unchanged. No HMI redesign, persistent-parameter import, native run or broad full-task redo occurred. This removes the identified caller-input gap; it does not certify controller startup on an unassigned host or make the trusted package immutable against an actor modifying the package itself.

## Behavioral RED, scoped GREEN and failures

`red-staging.log` / receipt recorded own exit1: **3 failed, 2 passed, 10 deselected**. Both terminal and GUI cases showed that caller work offsets were staged; the HAL mutation case showed staged bytes differed from the already-checked snapshot. The existing-destination refusal and supplementary INI snapshot case already passed before the correction; they are baseline guards, not falsely reported as new RED. Deselected cases were not_run in that targeted selection.

`green-staging.log` / receipt recorded own exit0: **34 passed, 3 subtests passed** across `tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py`. This covers the changed staging and launcher compatibility; no covering-suite repeat was performed merely to obtain a new timestamp. Python3.11 and its wrapper subprocess PATH are pinned through `fix1/check.py`, with PYTHONDONTWRITEBYTECODE=1 and PYTEST_ADDOPTS=-p no:cacheprovider. Node24.22.2/pnpm10.32.1 were used for export and Lab checks. One bare-python report-helper invocation failed with exit127 at pyenv before the helper started; no report/product bytes changed. Its observed argv/output are retained in `fix1/append-helper-failure.json` and `.log`; the helper was rerun through the receipt runner with Python3.11. No test dependency/import failure occurred in this fix round.

Own-exit receipts retain full cwd/argv, Source commit/tree/status, changed-file SHA256s and output byte count/SHA256. The exact commands below are linked to complete outputs; `SOURCE`/`LAB` abbreviate only path prefixes in this rendered table, not in the receipts.

| Log / receipt | Exit | argv |
| --- | --- | --- |
| [red-staging.log](evidence-L04/fix1/red-staging.log) / [receipt](evidence-L04/fix1/red-staging.receipt.json) | 1 | `perl -e 'alarm 120; exec @ARGV' python -m pytest tests/test_actual_trace.py -q -k stage_` |
| [green-staging.log](evidence-L04/fix1/green-staging.log) / [receipt](evidence-L04/fix1/green-staging.receipt.json) | 0 | `perl -e 'alarm 120; exec @ARGV' python -m pytest tests/test_actual_trace.py tests/test_smoke_launch.py tests/test_linuxcnc_sim.py -q` |
| [final-bytes.log](evidence-L04/fix1/final-bytes.log) / [receipt](evidence-L04/fix1/final-bytes.receipt.json) | 0 | `git diff --check` |
| [clean-export.log](evidence-L04/fix1/clean-export.log) / [receipt](evidence-L04/fix1/clean-export.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/l04-fix1-runtime-7d8bede-20261115` |
| [lab-import.log](evidence-L04/fix1/lab-import.log) / [receipt](evidence-L04/fix1/lab-import.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' node scripts/import-runtime.mjs /tmp/l04-fix1-runtime-7d8bede-20261115` |
| [lab-sync.log](evidence-L04/fix1/lab-sync.log) / [receipt](evidence-L04/fix1/lab-sync.receipt.json) | 0 | `node scripts/sync-engineering-contracts.mjs` |
| [lab-check-source.log](evidence-L04/fix1/lab-check-source.log) / [receipt](evidence-L04/fix1/lab-check-source.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm check:source` |
| [lab-typecheck.log](evidence-L04/fix1/lab-typecheck.log) / [receipt](evidence-L04/fix1/lab-typecheck.receipt.json) | 0 | `perl -e 'alarm 170; exec @ARGV' pnpm typecheck` |
| [lab-staged-check.log](evidence-L04/fix1/lab-staged-check.log) / [receipt](evidence-L04/fix1/lab-staged-check.receipt.json) | 0 | `git diff --cached --check` |
| [identity.log](evidence-L04/fix1/identity.log) / [receipt](evidence-L04/fix1/identity.receipt.json) | 0 | `python .superpowers/sdd/03-r3-linux-readiness/evidence-L04/fix1/audit.py` |

The scoped green was run on dirty FIX_BASE with the exact final three Source file byte identities. The audit compares those captured green bytes directly with the committed files; no product edit followed that check. Source TypeScript/typecheck/contracts/full CI were not rerun because this correction changes only Python staging, its Python tests and the runbook; the earlier full-task check results above keep their original attribution. Lab check:source/typecheck and clean export/import/sync were run for the new tuple as required.

## Clean tuple and byte attribution

Source commit `7d8bededd7b0ca57984d6f0d000eaa74ddea839d` fixes L04-R1. The Lab commit below pins that exact clean Source export; the two generated contract files change only their Source-commit header. No allow-dirty export was used.

| Identity | Value |
| --- | --- |
| sourceCommit | `7d8bededd7b0ca57984d6f0d000eaa74ddea839d` |
| sourceTree | `3e4ca16ff3243df5a98a629a64ca3d3894f6ac31` |
| labCommit | `2ccfbddb86282a9547368302f6121c7ee09acb71` |
| labTree | `62233dd67677af93f9dc19140ad2109ae27614de` |
| export | `/tmp/l04-fix1-runtime-7d8bede-20261115` |
| artifactSha256 | `a3a54f2664a60724344f7b05bf7265ed280fc036498a5e77e87b30102c138737` |
| manifestSha256 | `0336c1ff352f164b0f28fb63f17f97cd45c8df8d21c2564a631a5a54e5f2a659` |
| cacheManifestSha256 | `1c84f1d4d8d436ce367b228efc3127f82793161b217cc0e8712d23c782bf95f4` |
| labPinSha256 | `a91b9e6306a609f2009cf25b60f0de43df59de33303a83dd91f7dc31a48f1918` |
| schemaHash | `9e869f41bd7dbbbae1f26f81b75449b727e7160fdfb1a3b32cf3b23a5cb034e4` |
| nativeToolsDigest | `3d11e50dde374699a1f30c8de16821bfdc26fa077c080ecc825155a05aad6f8d` |
| nativeToolsFiles | `225` |
| portableToolsDigest | `1fb6f053d4903a109a41f862556a02c2fd71c60d5011d94d27463165ad697d82` |
| portableToolsFiles | `237` |

Final Source byte identities from the passing scoped check:

| Source path | SHA256 |
| --- | --- |
| `docs/operations/linuxcnc-native-sim-handoff.md` | `edac2adc1439d04ec6f809032785dcc52be139e1dbfc04495993400fd411460e` |
| `integrations/arm-controller/scripts/prepare_smoke.py` | `1b39e0e271ce697c7f5f2963c1c3c37deb3e33d485559586b2bebe9cd0bfbd78` |
| `integrations/arm-controller/tests/test_actual_trace.py` | `f12e11b4e8620f606511d31eec17dced25c11dbbf5f3e02db6af18d90afb3865` |

`fix1/identity.log` and its own exit0 receipt verified nine prior fix receipts, all three checked Source paths, both clean worktrees, export/cache/pin consistency, all 225 native closure members against working and committed bytes, unchanged schema/portable digests, both older L04 exports/caches, all 114 original evidence files and the original report prefix. `fix1/identities.json` contains the full identities. NativeTools retains the same 225 members and changes its digest because prepare_smoke.py changed; the portable closure remains 237 files. Manifest export/cache JSON objects are equal; their formatting gives different byte digests.

The original report remains the exact 32387-byte prefix SHA256 `642e137959397ea426347af99995df76657cd404269b53ce2c91dbd8815df199`, with root's saved copy untouched. All114 files in `root-L04-evidence-file-index.json`, both old L04 exports/cache manifests/runtime artifacts and all old preflight evidence remain byte-identical. New fix files live only under `evidence-L04/fix1`. No old commit, artifact or checker identity was relabeled. The append operation has its own `fix1/report-append.log` / `.receipt.json`. After this appendix, `fix1/post-report.log` / `.receipt.json` and `post-report-identities.json` record the same preservation audit including this appended report; these are separate files, not replacements for the pre-append audit.

## Scope limits and self-review

Self-review checked the extra-consumed-file case, same-snapshot parse/stage guarantee, fresh-directory refusal, exclusive writes, correct GUI and terminal paths, canonical-source preservation and no additional caller read during staging. Startup `sim.var` is excluded rather than silently imported. Generated parameter retention was not added; the existing per-run temporary staging lifecycle remains, and native startup compatibility still needs its assigned host.

No LinuxCNC/native/GUI process, real host package/trust resolution, hardware endpoint or new Mac preflight was run in this round. Existing native/GUI/package/timing/authenticity/atomic-fencing and human-acceptance gates remain not_run/incomplete. No existing preflight record is attributed to the new Source commit. Full CI remains unclaimed. R76 Docker restriction is unchanged. L04-R2 remains explicitly deferred. Root owns the new scoped fix review; this appendix does not grant whole-task or native approval.
