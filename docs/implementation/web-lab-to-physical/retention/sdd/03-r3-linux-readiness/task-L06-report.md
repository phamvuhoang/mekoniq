# L06 TOOLING handoff — DONE_WITH_CONCERNS

**TOOLING implementation, local verification, clean Source export and Lab re-pin are complete. Independent root review and final CI/candidate recording are still pending.** This does not complete parent L06/B10, native qualification, physical commissioning or release acceptance. No final prepared/native qualification candidate was recorded. No Docker probe, production `--plan`, native campaign, browser campaign, external host/provisioning, hardware action, push/merge/deploy, helper agent or delegated reviewer was used.

Work stayed in the paired isolated worktrees on `codex/web-lab-to-physical`. Historical recorder unit tests used only their existing hermetic owned fake Docker executable; they did not invoke installed Docker. All new evidence is under `03-r3-linux-readiness/evidence-L06/`; older reports, exports, caches, retained inputs and recordings were preserved.

## Exact handoff identities

| Role | Identity |
| --- | --- |
| Original Source task base | `ac9b44dc1bf01bce2406b6f91ac3e141c043c739` |
| Original Lab task base | `47343f930b712dd6ac64ed7cd874de3c0aca2188` |
| Final Source tooling commit | `6bf54aa5cab5bc63bc32c1fae471606d71061a78` — `feat: prepare profile-scoped R3 qualification and artifact readback` |
| Final Lab pin commit | `c41f715bca9c224328879b44e3cbf5a296b59e06` — `chore: pin source runtime 6bf54aa` |
| Runtime artifact SHA256 | `574ab85f8db59a87d0da22bc9706e07c13e92e70821d0187f6d6aa31b270ffd7` |
| Schema aggregate / count | `c2bdaca0b5ce9b03ee52a8c497719f4ea83b2cbb0e23c4e18365099fd163fa12` / 58 |
| Native closure / files | `35aebff4ba065eae48c088a91c94fd7a08af6fd723560e0fdb68cbdc112cce0b` / 226 |
| Portable closure / files | `778c336cd3bcffa975cbea2967915f27fd5f94124ec986e75f2dac031d55df93` / 238 |
| Final audited native checker graph | `8d569ad7b3a9bd39b7dd4f5d12f0f2a88a7b7572ff271a4fe7bd01f32e856e5c` at final Source |
| Export manifest raw SHA256 | `378ac6b6225d9552f7abaa13096df10aa686f8926bcfc2d819c60fa984912915` |
| Original-base Source patch SHA256 | `4ac415e85c23c580768752b0cbd1235f3c52cab34196c39708f7793736f0a04c` |
| Original-base Lab patch SHA256 | `beb0f7c6a3f877d42364f988d31792b85fb4ec1e3d1de2946ef9021bbcec40c3` |

Both trees are clean in `evidence-L06/final-byte-attribution.json`. Source has 11 changed paths; Lab has only the runtime pin and two generated Source-commit headers. The clean export is `evidence-L06/export-final/`; `dirty:false`, runtime bytes and schema bytes were verified against Source and the installed Lab cache. Native and portable closure objects are byte/structure unchanged from B10's final export. The importer preserved the previous cache and rollback pin. No older subject or execution was relabelled at this tuple.

## APIs, changes and scope

- `scripts/sim-extension-r3.mjs` owns the closed `tableR3(profile,scope)` and strict `checkR3Structure`. Six target profile IDs are supported, with ISA and per-profile allowed scopes. Prepared requires DEP-PREP-01, while all profile native cases and PHYS-PREP-01 remain visible. Motion/contact and terminal/full have separate fixed requirements; table copies cannot reduce the authoritative registry. New records always require `accepted:false`, null reviewer fields, clean/stable identity and exact checker-to-recorder Source binding. Historical accepted compatibility stays confined to historical code.
- `scripts/sim-extension-qualification.mjs:checkQualification` now explicitly routes R3 and always returns `R3_ARTIFACT_READBACK_REQUIRED` for that synchronous path. It no longer falls through to R1. Historical core, R1/R1.1/R2a and B10 behavior are otherwise unchanged.
- `scripts/r3-readback.mjs` provides `verifyR3Directory(root)` (mandatory public readback), `assessR3Directory(root,m)` (construction assessment), `collectR3Artifacts(root,m)` and `verifyR3Sidecar(root,sidecar)`. It recomputes L00 static handoff validation, exact profile/ISA/ROS-or-CNC OS, subject/common tuple, full outer inventory and all derived cases/gates/capabilities/levels/issues. Inventory is checked before and after readback. A selected native closure must match; L00's optional subject `nativeClosureHash:null` is preserved separately from the observer checkout's recorded closure.
- Native `index.json` admits only the target's closed roles and an exact subject/profile/ISA. Each role uses a safe directory basename. Engineering has fixed seven slots (nominal seeds 7/42/99 plus obstacle/no-path/cancel/worker-loss at seed 7); xArm has fixed six X1/X2 nominal/cancel/reopen-probe slots. Missing slots are explicit not_run; corrupt/mismatched evidence is failed. Stored diagnostics replace only the candidate root with `<evidence>` so copied immutable candidates reproduce identically.
- MuJoCo native readback delegates to the existing audited public `invokeCheckedProbe('verify',...)` and `invokeCheckedProbe('verify-r2b',...)`. Historical/current subjects and checker identities remain distinct. Current subject must equal the new handoff; DEP-MJ-01 requires both public readers plus native-ready supplied inventory on amd64. Optional R2b qualification input delegates to B10's `verifyR2bDirectory`, preserving its browser/WEB05 artifact boundaries. No parallel weaker verifier was introduced. Old checker records fail the existing exact pin checks; the runbook explains isolated exact-checker reproduction and never retags old records.
- `scripts/r3-native-readback.mjs` supplies supported L02/L03/L04 observation adapters. Engineering verifies the canonical compiled model, artifact hashes, exact Source/profile, available native inventory, raw clock correlation, actual SQLite topic/time coverage and existing Source journal/fault predicates. Original DBs are never opened: a bounded byte copy is hashed then opened read-only; live WAL/SHM input is refused. Existing engineering coverage/fault assessors are reused. Topic/time counts do not prove TF payload or action UUID semantics.
- xArm uses the existing exact URDF/mapping checker, internal versioned model ID, mode-specific evidence kind, bag coverage, monotonic actual/commanded sample shape/epoch, and Source/native run/command identity. These are observation subsets only. X1 fake-system semantics remain distinct from X2; direct FJT, same-run reopen refusal and unobserved G2 contact do not qualify native motion/contact. LinuxCNC consumes the producer's actual `actual-joint-trace.json` through `validateLinuxcncTrace`; epoch segments stay separate, and summary numerical verdicts do not close ALG04. No RTB oracle is rerun during simple trace readback.
- `record-sim-extension.mjs --release r3` dispatches to `record-sim-extension-r3.mjs`. Required flags are `--handoff DIR --native-records DIR --profile PROFILE --scope SCOPE --out NEW_DIR`, with optional `--lab`/`--candidate-id`. It audits clean Source and matching clean Lab, refuses in-repository/existing output, copies bounded inputs, checks stable identities, recomputes and writes `accepted:false`. It does not execute native/browser/doctor/Docker work. R3 `--plan` is table-only and probe-free. Full real recorder execution remains deferred to final recording.
- `scripts/verify-r3.mjs DIR [--sidecar FILE]` provides offline verification. Sidecars stay outside the candidate and bind exact qualification bytes, candidate/profile/ISA/scope, reviewer/time and decision. This is binding verification, not signature/authorship authentication. A sidecar never changes candidate acceptance or promotes scope. The existing acceptance suite now routes R3 to the async directory reader and fixed required cases.
- `docs/operations/native-profile-case-matrix.md` contains the R3.0/R3.1/R3.2 table, six target profiles, allowed scopes, every required case's observations/readback gap/next action, exact input layout, profile producer commands, install/verify→doctor→case→verify→replay/export→review sequence, owned cleanup/rollback and checker/publication reproduction policy.

## Explicit inherited gaps and scope disposition

Root clarified R88 in the brief and messages while work continued. This task owns supported directory adapters, but does not add a new native collector/planning/restart/contact/security phase. The implementation makes the gaps explicit rather than marking them only blocked_external:

1. Engineering bag timestamps/topic counts do not deserialize TF or independently correlate action UUIDs to Source commands. Canonical/model, coverage and journal/fault observation checks are implemented; all DEP-NAV qualification cases remain not_run until missing semantics/ownership/replay observations and readers exist and actual assigned-host runs are supplied.
2. L03 lacks actual controller-restart, collision-planning and G2 contact qualification. X1/X2 raw/mapping observation subsets can be inspected, but DEP-XARM scopes remain incomplete. The restart slot is explicitly the existing same-run reopen-refusal probe, not controller restart.
3. L04 lacks controller clock/synchrony/Cartesian endpoints, continuous-motion/atomic-fencing qualification and full terminal/GUI/install/trust records. `native_capture` is a supplied label, not host authentication. Numeric parity cannot close ALG04 or DEP-CNC.
4. No complete per-profile DEP-SEC-01 host artifact producer/reader exists. The fixed case stays required and not_run with `COMPLETE_PROFILE_SECURITY_OBSERVATION_READER_NOT_IMPLEMENTED`; Docker flags/doctor/unit tests cannot close it. Consequently no native full scope can currently qualify from this tooling alone.
5. Current historical/current MuJoCo adapters are amd64 only. Arm64 has its own fixed profile and explicit adapter gap; an amd64 record never closes it.
6. R3.2/PHYS-PREP-01 is not requalified by this recorder. L05 prepared-code approval remains separate; dossier references are structural assertions, not authenticated measurements/signatures or live admission. The runbook identifies the actual L05 reproduction path and keeps this record's R3.2 not_run.

These are not claims that assigning a Linux host alone completes qualification. Root's specific scope instructions and the versioned matrix name the required next implementation/observation work. Neither branch is forced to wait for the other branch's future qualification.

## RED/GREEN and actual verification

Every persisted check uses `evidence-L06/check.mjs`: exact argv/cwd, relevant environment selectors, before/after repository commit/status/diff/changed-file hashes, the command's own exit/signal and exact concatenated stdout/stderr log hash. No trailing `cat`/diff/cleanup is counted as the check's success. There are 34 indexed receipts in `check-index.json`, plus the final audit's own receipt written after that index. Failed attempts and corrective runs have distinct files. Counts below are per invocation, not additive.

| Receipt(s) | Actual result and honest meaning |
| --- | --- |
| `qualification-red` | 2 failed, 1 passed, 26 filtered. Demonstrated R3→R1 fallthrough (`issues=[]`) and unsupported `--profile` CLI before implementation. |
| `directory-creation-red` | 1 failed, 38 filtered: missing new module. Creation-stage evidence, not semantic bypass evidence. |
| `r3-green1` | 13 passed, 26 filtered on initial R3 bytes. |
| `native-readback-red` / `native-readback-green` | 1 failed/9 passed, then 10 passed. Complete synthetic observation baseline exposed unavailable inventory being admitted as a supported observation. Qualification still remained not_run. |
| `profile-green` | 17 passed, 26 filtered. Profile-specific preparation matrices, sidecars and guards. |
| `xarm-observation-red` | 5 failures/10 filtered from the fixture's upstream X1/X2 URDF mismatch. Invalid test setup, not guard evidence. Original log retained. |
| `xarm-observation-red2` / `xarm-observation-green` | Correct X2 fixture: 5 failures/10 filtered (missing recomputed observation fields plus 4 semantic negatives not refused), then all 15 native-readback tests passed. Both pre/post readers kept full native qualification not_run; this was observation-admission coverage, not a native qualification bypass. |
| `combined1` | All 6 requested files / 116 tests passed on earlier bytes. |
| `checker-binding-red` / `checker-cli-green` | Genuine forged checker-commit binding refusal was missing: 1 failed/43 filtered. After fix, 2 passed/43 filtered including offline CLI/sidecar behavior. |
| `copied-record-red` / `copied-record-green` | Original candidate verified, copied candidate failed `R3_DERIVED_MISMATCH:capabilities` due absolute missing-file paths; corrected check passed. Each invocation had 1 selected test/45 filtered. |
| `combined-final` | All 6 requested files / 119 tests passed, including historical qualification and retained R1/R1.1 readback, L00, R3 raw readers, engineering, xArm and B10 reader. This precedes the final optional-closure refinement below. |
| `optional-closure-red` / `optional-closure-green` | A valid portable-only L00 subject was incorrectly rejected when the recorder observer had its real native closure: 1 failed/46 filtered. Fix preserves optional subject scope; complete R3 selection then passed 21 tests/26 filtered on final bytes. |
| `clean-checker-readback` | At clean final Source, 1 passed/46 filtered. Fake-current-native refusal reached the audited B10 public reader instead of merely failing a dirty checker. Read-only malformed-artifact fixture; no Docker/native execution. |

`combined-final` exact suite argv: `pnpm exec vitest run tests/unit/sim-extension-qualification.test.ts tests/unit/r3-native-readback.test.ts tests/unit/native-handoff.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/xarm-native-contract.test.ts tests/unit/r2b-readback.test.ts`, wrapped by `perl -e 'alarm 240; exec @ARGV'`.

Source `contracts1`, `source-type1/2/final/closure`, `source-lint1/final/closure` and `diff-check` all exited 0. The last whole authored-tree lint was `pnpm exec eslint . --ignore-pattern '.superpowers/**'`; after the optional closure's small change, scoped final lint of the two affected files passed. `source-type-closure` is the final full typecheck. Unqualified `pnpm lint` was not run or claimed. No contracts/schema bytes changed.

All shell checks used Node 24.22.2/pnpm 10.32.1. Synthetic engineering fixtures use the existing `.venv-irsim/bin/python` for the portable canonical compiler with `PYTHONDONTWRITEBYTECODE=1`; no ROS engine is launched and no pytest/cache is created. The new unit fixtures create their own SQLite databases outside product roots. Original databases are never opened by these tests. A few exploratory `rg` paths/globs were absent; they are not check receipts or passing evidence.

Source was committed before ordinary clean export; no allow-dirty/checker bypass was used. `export-clean`, `lab-import`, `lab-sync`, `lab-check-source`, `lab-type`, both commit receipts, and `final-audit` all exited 0. Lab scripts were not changed, so no separate standalone-script typing gate was needed. Lab build/browser/runtime campaign tests and full Source build/test/service CI were not run here, per final-sequence ruling. Actual candidate acceptance was not run; public R3 directory/CLI behavior was exercised on explicit synthetic fixtures only.

## Original-base self-review, retention and final handoff

Self-review covered the complete original-base authored Source changes and all three Lab pin/header changes. It found/corrected the historical dispatcher fallthrough, unavailable-inventory interpretation, exact xArm version/mode and L04 trace filename integration, checker/recorder tuple omission, relocation-dependent diagnostics and the optional native-closure coupling. The shared historical qualification core and reviewed B10 readers were not edited. Changed acceptance routing was typechecked; its actual final-candidate execution remains pending.

`final-byte-attribution.json` verifies committed bytes, clean heads, pin/export/schema/runtime equality and exact Source/Lab original-base patches. `source-original-base.patch` and `lab-original-base.patch` are complete review inputs. It also hashes every original entry in root's preserved B10 indexes: **469 tooling files, 254 fix1 files and 83 historical smoke files all unchanged**. Hashing SQLite as bytes is not opening it as a database. No original archive/database was mutated. Other prior reports/evidence were never edited. Generated export, receipts, helper scripts and audit outputs live only in fresh `evidence-L06/`; they are not new product roots or a bypass around product lint.

The current source/checker tuple is preparation only and differs from every historical producer. Root must independently review this clean handoff, retain its report/review with the final project evidence, then sequence final clean-tuple CI/recording. Any later closure/code change requires a new export/pin and invalidates reuse as execution evidence at the newer tuple. Documentation publication must retain the built-from checker identity; invoke the exact old checker from an isolated checkout when reproducing old L01/native records. Do not rewrite them to make current HEAD pass.

**Remaining concerns:** supported artifact consistency does not authenticate host/build/execution; native collection and verifier gaps above remain; all actual native/browser/WEB05/physical work and final prepared/candidate recording are still pending. The TOOLING handoff is ready for independent review, not release acceptance.


## Fix round 1/5 handoff — I1–I3 corrected; scoped review pending

**DONE_WITH_CONCERNS — TOOLING ONLY.** The three Important supported-observation findings are corrected and locally verified. Fresh independent scoped review and all final execution/recording remain pending. Minor M1 is centrally deferred in `.superpowers/sdd/deferred-findings.md`; this fix does not change its per-case disposition. The original 17,523-byte report above is preserved verbatim; this appended section supplies the new tuple and supersedes its pending full-review status only for this correction handoff.

Only the existing isolated Source/Lab worktrees on `codex/web-lab-to-physical` were used. No helper/reviewer delegation, installed Docker probe/build/container, ROS/Gazebo/controller/native campaign, external/cloud/physical action, browser campaign, final candidate recording, push/merge/deploy or original-main mutation occurred. The historical recorder unit suite uses its existing owned fake Docker executable only. No producer protocol or collector was changed; no retained original SQLite database was opened. Tests created their own temporary synthetic bags; the reader opens only verified byte copies.

### Bases, final commits and complete scoped packages

Original task bases remain Source `ac9b44dc1bf01bce2406b6f91ac3e141c043c739` / Lab `47343f930b712dd6ac64ed7cd874de3c0aca2188`. The fresh scoped review begins at FIX_BASE Source `6bf54aa5cab5bc63bc32c1fae471606d71061a78` / Lab `c41f715bca9c224328879b44e3cbf5a296b59e06`.

- Final Source `6e5eee9d7d504b0365422eb0ef7096e74e72e210`, clean status. Full scoped package `evidence-L06/fix1/source-fix-base.patch`: 23,431 bytes, SHA256 `a58d9f8bcbe33f7844feccaa75ea4c7e61308da325fce3209d31cb54cf889c5a`.
- Final Lab `283696be56bdaea1d310a1e56182f49792cf3b2c`, clean status. Full scoped package `evidence-L06/fix1/lab-fix-base.patch`: 2,624 bytes, SHA256 `dd246e57e592e4d481161337db2c856cba245f65e3d814b2f62131aca6b253e4`.

Source changed only the reader, its regression fixtures/tests and directly related recipient instructions. Lab changed only its pin and two generated Source-commit headers. Committed final file attribution:

| Repo/path | Bytes | SHA256 |
| --- | ---: | --- |
| `source/docs/operations/native-profile-case-matrix.md` | 20212 | `40be5e94abd9c512ffbadb657a893f92d93b518e70cf7747436dc534f1986b12` |
| `source/scripts/r3-native-readback.mjs` | 13174 | `530db9125d9742aebf85d7097c140161122914c9589e5a2f1c3257ec2505ecd8` |
| `source/tests/unit/r3-native-readback.test.ts` | 19282 | `b6fc5731e2d43e1d52ff72a4188d60cfbe634d5a7ae6be8ed0e4d64302614335` |
| `lab/config/source-runtime.lock.json` | 534 | `29de837d96523b3bf8cb23a502320988dd77fc789f0e6e1faa2730f71a483a23` |
| `lab/src/shared/engineering.ts` | 46638 | `6164eb819c2377c26261bffda448b2dd0c8181c786f99c49d09f423d4edb01a1` |
| `lab/src/shared/navigation2d.ts` | 48892 | `5c015b9eaab3c5f1d33d87c8a278c39d444fce8c93d4c6034182b4b6469a0082` |

### Finding disposition and producer comparison

- **I1 corrected.** `native_xarm/ros.py` sets X1 `use_sim_time:false` and emits Python integer `stampNs`/`clockNs` as unquoted JSON tokens. The reader now uses Node 24 `JSON.parse` reviver source context to convert only canonical nonnegative integer tokens directly to BigInt. It never reconstructs nanoseconds from the rounded Number argument or changes retained bytes. Comparisons retain one-nanosecond differences near `1789999999123456789`; the existing finite sample/sequence/epoch validation stays in place. The portable X1 fixture derives the pinned X1 plugin/mesh form from the existing protocol URDF and passes the existing mapping validator. It is producer-shaped protocol evidence, not native expansion/execution. Adjacent increasing epoch samples pass; equal/decreasing stamps, decreasing clocks and clock-before-stamp samples fail at the proper sample boundary. The positive also verifies original observation bytes are unchanged.
- **I2 corrected.** `engineering_worker.py:ClockMapping` initializes from its first provider timestamp; `engineering_session.py:_health` emits a mapping on every health call, including duplicate timestamps during readiness. Source attaches after backend readiness and its separate `EngineeringClock` retains changed timestamps from its own first observation. Readback now validates raw worker origin/20 ms ticks, nondecreasing provider times and local monotonic receipts, allowing repeated health rows. The existing engineering assessor validates Source's independent origin/20 ms mapping and its own receipts. Correlation uses provider nanoseconds only, never equal relative ticks or cross-process receive times. Tests retain worker startup/duplicate rows before and after Source subscription, and refuse absent provider observations, incorrect worker/source ticks/origins, raw provider resets and independent receipt resets. TF payloads, action UUID correlation and complete replay/isolation semantics remain unverified and required cases remain not_run.
- **I3 corrected.** `native_xarm/worker.py` writes `native-inventory.json` from `inspect_profile(environment_profile)` before launch. The adapter now requires that artifact reference, checks its existing declared byte hash and uses the shared `validNativeProfileReport` with the manifest's selected engineering environment, plus explicit `available===true`. Existing manifest and mapping checks bind that environment to the requested architecture. The shared reader validates actual Linux/ISA/Ubuntu 24.04/Jazzy facts and supplied package/runtime/provenance structure. Coherently missing, unbound, unavailable, wrong-ISA, wrong-OS and wrong-environment inventories are refused after a valid X2 baseline; a mismatched artifact hash remains refused. Supplied reports/hashes do not authenticate the installed host, vendor source or execution. No new inventory collector was added.

The runbook now names the required xArm run inventory and explains exact nanosecond preservation, separate clock origins and the limits of supplied inventory consistency. Closed case matrices, caller-label refusal, `accepted:false`, `not_calibrated`, sidecar scope and native/physical boundaries remain unchanged.

### Genuine RED/GREEN and scoped validation

All logs/receipts are new under `evidence-L06/fix1/checks/`, using a copied immutable `fix1/check.mjs` own-exit wrapper. Each receipt records argv/cwd, relevant environment, start/end, own exit/signal, before/after commit/status/diff and changed-file hashes, plus log SHA256. Counts below are per invocation and overlap; they are not summed.

| Receipt | Result and demonstrated scope |
| --- | --- |
| `producer-red` | 37 tests: 18 failed / 19 passed on the original reader. All 16 previous native-reader tests passed. The valid epoch X1 fixture reached `R3_XARM_SAMPLE_INVALID`; the independent-origin engineering positive reached `R3_RAW_CLOCK_MAPPING_MISSING`. Six coherently resealed xArm inventory negatives resolved with supported observation fields while qualification stayed not_run. Three I1 ordering negatives and seven I2 mapping negatives failed expected-boundary assertions because the old blanket rejection fired earlier; those are not demonstrated admission bypasses. The clock-before-stamp, missing-provider and wrong-inventory-hash negatives already rejected. |
| `producer-green` | All 37 native-readback tests passed on the fixed reader/test bytes. |
| `combined` | Six files / 141 tests passed on final committed code/test bytes, covering the public R3 directory/CLI/sidecar path, historical qualification compatibility, native handoff, native adapters and affected engineering/xArm/B10 boundaries. |

Combined exact argv: `perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/unit/sim-extension-qualification.test.ts tests/unit/r3-native-readback.test.ts tests/unit/native-handoff.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/xarm-native-contract.test.ts tests/unit/r2b-readback.test.ts`.

`source-type` ran full Source `pnpm typecheck`; `contracts` ran `pnpm contracts:check`; `source-lint` ran exactly `pnpm exec eslint scripts/r3-native-readback.mjs tests/unit/r3-native-readback.test.ts`; `diff-check` ran `git diff --check`. All exited 0. This is scoped authored-code lint, not a claim of unqualified whole-tree lint or full CI. Source code/tests were not changed after these checks. Node 24.22.2 / pnpm 10.32.1 and the existing portable Python 3.11 environment were used, with `PYTHONDONTWRITEBYTECODE=1` and `PYTEST_ADDOPTS=-p no:cacheprovider`. The combined invocation records both retained-input selectors. The fixture compiler is portable; ROS was never loaded/executed.

Source was committed before fresh ordinary clean export; no dirty or checker bypass was used. Lab import/sync, `pnpm check:source` and `pnpm typecheck` passed before its pin commit. No Lab standalone script changed, so no standalone script typing gate was needed. Full build/test/browser/final recording remains deferred.

Complete receipt inventory (15; `check-index.json` includes the first 14 and the final audit's own receipt follows that index):

- `combined`: own exit `0`, signal `None`, log SHA256 `dcadcf2f759826958fceda415e7eaf640a34c3f0723a37ec0772acf8d5b07f94`.
- `contracts`: own exit `0`, signal `None`, log SHA256 `b01efc8275af27aef1593ccbccacf369a068c21bf75222530690ef4d51d5633c`.
- `diff-check`: own exit `0`, signal `None`, log SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `export-clean`: own exit `0`, signal `None`, log SHA256 `82ae6455c0858365879b46556491dc282e8c5699b0d1267cf494c3b48cd0697f`.
- `final-audit`: own exit `0`, signal `None`, log SHA256 `dedd60de3ad093f7e80162edeb8a458bc00c98d62308ca45c9b893657ebf8ea0`.
- `lab-check-source`: own exit `0`, signal `None`, log SHA256 `e38442b95a5839b75cd31fdea4613afc65bcbc5b1f12802503a84a94c26f29a2`.
- `lab-commit`: own exit `0`, signal `None`, log SHA256 `5de614377385fde161b3686239c3d43e9ff9cbb13f067d46ba781e0934ea739a`.
- `lab-import`: own exit `0`, signal `None`, log SHA256 `abd1e7fd69a001513f0e9b5faa2a1c76e662efce7948b0070e6bf4a86b1c4183`.
- `lab-sync`: own exit `0`, signal `None`, log SHA256 `84731b62ae9a5141c2b86ed05a6c5786c87be631f44b35181ea6b2e089481837`.
- `lab-type`: own exit `0`, signal `None`, log SHA256 `b78fdb43e4fadead7db30a196fdaa214d80de2ea9a3bf53245a231b6ba98d881`.
- `producer-green`: own exit `0`, signal `None`, log SHA256 `0a137bb7eb85cdf3daf51db77626ab2ede9cc003139a420b7ebfbbcd96c7fe16`.
- `producer-red`: own exit `1`, signal `None`, log SHA256 `9dbce721a5f36291df5bc9657b728ce0c92c9397b6d0ca85a189200e87d1bdb5`.
- `source-commit`: own exit `0`, signal `None`, log SHA256 `36b83f1f635d156abb0290a2bfbd09d505920b9781ccb1f7fbc9216d20b84b52`.
- `source-lint`: own exit `0`, signal `None`, log SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `source-type`: own exit `0`, signal `None`, log SHA256 `a38cf93675b24c7612ead396f6cdc68f544441355db12bccc212ffe3f6e07db5`.

### Export, checker and retention identity

Fresh export `evidence-L06/fix1/export-final/` is clean and matches the installed Lab manifest/runtime and new pin. The previous cache/rollback tuple and every old export were retained. Exact identities:

| Identity | Value |
| --- | --- |
| Runtime artifact SHA256 | `17bbdc1a92569f8fcb2de02b25e55ba3c774a515ca4f70ae917bd6e97964e3af` |
| Export manifest raw SHA256 | `82aa925b02054298610b1ab13eacea9a1ef816e063f7f223feee0fa053658010` |
| Schema hash / count | `c2bdaca0b5ce9b03ee52a8c497719f4ea83b2cbb0e23c4e18365099fd163fa12 / 58` |
| Native closure / count | `35aebff4ba065eae48c088a91c94fd7a08af6fd723560e0fdb68cbdc112cce0b / 226` |
| Portable closure / count | `778c336cd3bcffa975cbea2967915f27fd5f94124ec986e75f2dac031d55df93 / 238` |
| Audited checker graph at final Source | `2c65f80647bc1bca34be17954c67e2a6c180b830360ee7b6a90808036547246c` |

`final-byte-attribution.json` verifies both clean committed heads, full scoped patch/file hashes, export/install/pin/runtime/schema equality, and every native/portable closure source byte. Native/portable closure objects remain unchanged from B10; 58 schema bytes remain unchanged. The checker graph belongs only to the new clean Source commit; old producer/checker identities and strict historical reproduction requirements are unchanged.

The same audit verified all **136 original L06 evidence files** and **469 B10 tooling + 254 B10 fix1 + 83 historical smoke files** against their retained root indexes, plus the original report's exact 17,523-byte prefix (SHA256 `ed6d841eb0fddf80ba9010d7e59e82c02bcc2d9f9b33f15bbaeea0da94598165`). New fix evidence has a complete `fix1/retention-index.json` (excluding that self-referential index only), with the final appended report recorded separately. No prior index/log/receipt/export/package was overwritten. Hashing retained SQLite bytes is not opening a database.

Self-review covered both complete scoped diffs and the named actual producer/shared-reader boundaries. One exploratory ignored-file `rg` returned no paths, then the explicit hidden/no-ignore search found the existing indexes; it is not check evidence. The test-edit helper emitted a Python escape warning while successfully writing the intended TypeScript regex; the passing mapped X1 fixture, typecheck and lint cover the resulting file. No failed check was erased or relabelled.

**Remaining limitations:** no actual Linux host/image/install/native run, browser/WEB05 run, physical action or final prepared/native candidate has been observed here. TF deserialization/UUID/replay, xArm controller-restart/collision-planning/G2/action-payload, LinuxCNC timing/synchrony/Cartesian/fencing/terminal/install/trust, complete DEP-SEC-01 and arm64 MuJoCo collector/reader gaps remain. Assigning a host alone does not close them. M1 remains centrally deferred. PHYS-PREP-01/R3.2 and L05's separate reviewed preparation tuple are unchanged. This correction is ready for fresh scoped review; parent L06/B10 and release acceptance are not complete.
