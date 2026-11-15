# L01 implementation report

Status: **DONE_WITH_CONCERNS — prepared tooling complete; native execution not_run / blocked_external.**

`accepted:false`; dynamics `not_calibrated`. Root owns independent review. No helper agents, Docker calls, cloud/provisioning/deployment, hardware routes or commissioning actions were used. Only the two authorized feature worktrees were edited. The original cached R2a runtime was read as data and copied after hash verification; nothing executed through or wrote to the original cache/main checkouts.

## Bases, commits and separate identities

| Identity | Value |
| --- | --- |
| Original Source base | `298db9bdbc207b14bdbef78ec8d70adf4e901c71` |
| Original Lab base | `7698aa628fc9a60598d1337b292bdcec2fe91fdc` |
| Final Source tooling commit | `2f4837d10d746a7c8c5e5ca5675ec57db4111c28` — `feat: prepare exact R2a MuJoCo native compatibility probe` |
| Final Lab pin commit | `69032d509cc94b178102c386ddf82280996cf74e` — `chore: pin source runtime 2f4837d` |
| Current clean runtime export | SHA256 `7941fee45b37560d2d38b22bc54f870ec47401c6203d2414ccbea36bea6ce54d` |
| Current schema | `07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068` |
| Current portable closure | `4ba424081c04ba0f532c069047bf244a99385edd09ca9df347cfb45fe6d22e6e` |
| Historical subject Source | `4f893ac6fb75dff414a3ee42a726defb7935c734` |
| Historical subject Lab | `a6ec316fb3ac2f71afff25e6fa77e931f4439e00` |
| Historical runtime | `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270` |
| Historical schema | `9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4` |
| Historical portable closure | `3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d` |
| Historical observer-authored profile SHA256 | `148afd50b392d9ab05845018a35cc5cc2c02e45d77e76bca0a64612670400263` |
| Independent L00 checker | Source `2f4837d…`; short tool SHA256 `c90b022a4b56d7b584d5aff3e3d705db85e47fe651f03662736048c799db437b` |

The full checker Git/byte binding is distinct from that short digest. The historical subject remains the old tuple even though the observer and newly pinned Lab build are current. The handoff image is **null**. The recorded registry digest `sha256:fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009` and historical local config ID `f650a257…` are not conflated; platform manifest/config bytes and installed engine artifact remain unresolved.

`evidence-L01/final-identities.json` is the machine-readable final identity record. Both worktrees were clean at final checks; the Lab pin equals final Source HEAD. Node `v24.22.2`, pnpm `10.32.1`; portable syntax validation used Python `3.11.15` with `-I -B` and no engine import.

## API and implementation

- `packages/lab-runtime/src/v2/sil/native-handoff-r2a.ts`: precise `mujoco_r2a_arm_v1` static adapter. Checks the exact historical tuple, original fixture/engine/ref hashes, frozen typed schemas, full ArmCellScene/project/component equality, SI/frame/joint mapping and manifest/blob refs. It neither borrows current B05/B06 data nor broadens existing kinds.
- `native-handoff-documents.ts`: routes that one additive kind. `scripts/native-handoff.mjs`: exports its existing full clean checker identity routine for reuse, guards CLI entry, and adds the new fixed reference files to its short checker digest. Existing OCI/native_apt, whole closure, typed current models, frame/unit/ref and checkout gates stay enforced.
- `scripts/native-sim/r2a-arm-baseline.json`: frozen Git-derived hashes/mapping/static scene and M00 extraction provenance. Before deriving the scene, I compared the current arm scene builder, model, frame and related scene source bytes against frozen Git; they were identical. The reference schema hashes are from frozen Git, not the new handoff schema set.
- `robotics/simulation-mujoco/profiles/linux-amd64.json`: new observer-authored SIM compatibility profile. Debian 12, amd64, exact MuJoCo 3.17.0; installed libmujoco digest intentionally null. `derived/observer/…` refs and preparation receipt distinguish authoring from historical subject binding.
- `prepare-mujoco-r2a.mjs --runtime-cache DIR --lab REPO --out NEW_DIR`: reads frozen Git objects and verified runtime bytes, independently checks every original portable closure entry, writes a new handoff, and assesses it. No old checkout rebuild/reset or execution.
- `mujoco-probe.mjs --handoff DIR --out NEW_DIR`: clean-checker, static-handoff and assigned-host orchestration. The Mac guard precedes every Docker command. On an assigned host it requires local Unix-socket Docker, exact installed image/config/revision/digest, native host provenance, measured engine artifact and image worker/schema/toolchain consistency. It pulls/builds nothing. Containers are nonroot/read-only/network-none/cap-drop with bounded resources and only task-owned input/output mounts. Cleanup checks this invocation's unique label.
- `mujoco-probe-container.mjs`: executes unchanged old runtime bytes through loopback HTTP; captures health/report/raw traces and post-close byte-verified copies of runtime files/journals. Fault and timeout artifacts remain. The original live journals are only inside the disposable container's private `/tmp`.
- `mujoco-probe-engine.py`: imports the verbatim frozen M00 recipe under the real pinned image engine, or the actual historical WorkerSession/engine for explicit qvel-NaN bad-state injection. Retains request/response bytes, MJCF, raw before/injected/after NPZ state, warnings and timings. It is observer instrumentation, not a historical image file.
- `mujoco-probe-observer.mjs`: R84 passive spawn/wire observation with exact forwarding of original spawn arguments/options/child object and write arguments/return value. It changes no command or ACK, records no environment/secrets, and never pauses subject streams. Bounded async trace plus exit seal; trace loss, missing lifecycle or invalid wire data refuses qualification. Archive closes the subject worker before final readback. Measurement overhead is explicit.
- `mujoco-probe-process.mjs`: finite owned process groups, incremental separate stdout/stderr, timeout/abort/nonzero receipts and retained incomplete output. No resend/resume path.
- `mujoco-probe-evidence.mjs` and `mujoco-probe.mjs --verify DIR`: require all named scopes, actual raw contact/pose data, genuine engine warning/failure observations, Source unknown/no-false-serve/no-respawn behavior and complete observed worker traffic. Verify artifact bytes, supplied handoff/provenance, measured image/engine, exact observer recipe/code, report Source/schema/trace bindings, copied journals and timing summaries. Unit logs cannot substitute for cases.
- `scripts/record-sim-extension.mjs --mujoco-probe DIR`: optional independently identified, copied/reverified supplement. No existing release or hardware gate table is upgraded by the attachment. Claimed passes that fail readback are rejected.
- `docs/operations/mujoco-native-probe.md`: full prepared-host/profile/identity/run/readback/failure runbook; `native-simulation-handoff.md` now points to the additive old-shape support.
- Lab changes: runtime lock and the two generated contract headers from the normal sync command. Contract content hashes did not change.

Matrix: ten M00 seeds 1–10; full MJ-BV01 seeds 7/42/99; one instrumented historical WorkerSession real-engine bad-state case; one unchanged-subject-bytes full-runtime worker-loss case; one 180,000-tick / 1,800,000-substep engine long-run check. Sixteen qualification cases, plus image/engine inventory prerequisite. Tick, IPC and HTTP timing scopes are separate and retain raw samples with nearest-rank p50/p95/max. Python peak RSS and sampled process-namespace RSS are labeled separately in the runbook.

## R81–R84 boundary decisions

R81: exact historical arm-only static support belongs to this task, with actual cached runtime and frozen files. Completed without weakening L00's current adapters.

R82: bad-state is a separately identified original WorkerSession + real MuJoCo component subcase; it must produce a real warning/failure and no successful post-fault step. It makes no Source serving/custody claim. The separate full-runtime worker-loss case checks Source stop/unknown/zero served, no resend/overlap, no successful post-loss ACK and no respawn.

R83: executable **current R2b** payload/cell native adapter belongs to B10 tooling and is required there before final tooling review. L01 records it as `not_run/image_unbuilt` and does not substitute the historical R2a image.

R84: passive observer hash and timing cost remain separate from unchanged subject bytes. No uninstrumented-execution claim is made. Incomplete observation fails rather than inferring no resend from HTTP outcomes.

## RED/GREEN and checks

All listed logs are under `.superpowers/sdd/03-r3-linux-readiness/evidence-L01/`.

| Check / command | Actual result / retained output |
| --- | --- |
| `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts` — adapter first | RED 6/6 (`DOCUMENT_PROFILE_UNSUPPORTED`), then GREEN 6/6: `L01-red-adapter.log`, `L01-green-adapter.log` |
| Added bounded process/admission/matrix/bad-state tests | RED 5 new failures, GREEN 11 total: `red-probe.log`, `green-probe.log` |
| Wire overlap/resend/respawn and transparent observer tests | `red-wire.log`, `red-observer.log`, `green-observer.log` (13 total GREEN) |
| Orchestration/readback negatives | `red-orchestration.log`, `green-orchestration.log` (15 total GREEN) |
| Actual Node ESM preload byte-stream and recorder supplement | `red-supplement-preload.log`, `green-supplement-preload.log` (17 total GREEN) |
| Timing p50/p95/max, incomplete lifecycle, raw contact assertions | `red-timing.log`/`green-timing.log`, `red-observer-tail.log`/`green-observer-tail.log`, `red-grasp-raw.log`/`green-grasp-raw.log` (20 total GREEN) |
| Combined Vitest: L01, L00 unit, L00 security, clean checker security, existing sim-extension qualification | **153 passed, 0 skipped**, 5 files, ~20 s: `combined-tests.log` |
| Scoped ESLint, bounded 180 s, all changed TS/MJS/declarations/recorder/tests | pass: `lint.log` |
| `perl -e 'alarm 180; exec @ARGV' pnpm typecheck` | pass, route generation + tsc: `typecheck.log` |
| `perl -e 'alarm 180; exec @ARGV' pnpm contracts:check` | pass: `contracts-check.log` |
| Python 3.11 `ast.parse` under `PYTHONDONTWRITEBYTECODE=1`, `-I -B` | pass, **no MuJoCo import/execution**: `python-syntax.log` |
| `node --check` probe driver/orchestrator/recorder; `git diff --check` | pass, no output |
| Clean Source commit → `node scripts/export-lab-runtime.mjs NEW_DIR` under 180 s | pass, `dirty:false`: `clean-export.log` |
| Lab `import-runtime`, `sync-engineering-contracts`, `pnpm check:source`, `pnpm typecheck`, all bounded | pass: `lab-import.log`, `lab-sync-contracts.log`, `lab-check-source.log`, `lab-typecheck.log` |
| Post-Lab-commit source pin check | pass: `lab-final-check-source.log` |

Combined command:

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run \
  tests/unit/mujoco-native-probe.test.ts tests/unit/native-handoff.test.ts \
  tests/security/native-handoff.test.ts tests/security/native-handoff-checker.test.ts \
  tests/unit/sim-extension-qualification.test.ts
```

Tests use real local Node subprocesses for retention and preload forwarding, plus explicit synthetic protocol/inventory data for validator negatives. These tests are not native evidence. No worker-engine integration, Docker, native campaign or physical test was run. The scope of validation is portable implementation, static full-subject preparation and pin integrity; future assigned-host execution remains a material validation gap.

## Concrete prepared artifacts and actual execution

1. Clean tooling commit `2f4837d…` was made before preparation recording.
2. Actual handoff: `/tmp/mekoniq-L01-preparation-g53avI/handoff` (`/private/tmp/...` on macOS). **184 refs**, including the complete **179-entry** original portable closure. Runtime came from the exact archived `55dd3585…` cache; tracked closure/schema/Lab bytes came from frozen Git objects. `preparation.log` records exit 0.
3. Independent `native-handoff.mjs verify --input …/handoff`: exit 0, **prepared:true / nativeReady:false**. Exact remaining prerequisite codes: `PACKAGE_LOCK_UNRESOLVED`, `SUBJECT_IMAGE_UNRESOLVED`, `HOST_INVENTORY_MISSING`. See `handoff-independent-verify.json` and empty `.stderr`.
4. Prepared CLI exercise: `/tmp/mekoniq-L01-preparation-g53avI/native-not-run`. Static refs copied/verified, then native host guard stopped it before Docker. Exit 2, **16/16 cases not_run**, `DEP_MJ_01:not_run`, issue `NATIVE_AMD64_HOST_UNASSIGNED`. See `native-not-run-cli.json`/`.stderr` and its retained manifest.
5. Readback of that non-executed record: exit 1 / passed:false, correctly refuses qualification (`NATIVE_CAMPAIGN_NOT_PASSED`; absent observer execution directory). `native-not-run-readback.json`/`.stderr`. No incomplete record became a native pass.
6. Clean current export: `/tmp/mekoniq-L01-export-lpLtBF/runtime`. `dirty:false`, pinned in final Lab commit `69032d5…`. This current export is **not** the historical subject image/runtime.

Path pointers are also retained in `preparation-root.txt` and `export-root.txt`; the complete identity and artifact manifest hashes are in `final-identities.json`. Native image manifest/config, engine binary digest, assigned host provenance, native timings/contact results and all actual campaign outcomes remain uncollected. No native evidence directory was fabricated or historical evidence rewritten.

## Failed attempts and self-review

- Intentional RED runs are preserved as listed. Development adapter iterations exposed AJV schema-key registration, date-time format registration and the frozen arm-scene schema dependency; these were corrected without a schema bypass. Those transient diagnostics are in the tool transcript; the initial development `green-adapter` filename was reused before the dedicated evidence directory was created, so do not treat it as a complete raw log of those intermediate attempts.
- One admission test initially mutated a shared synthetic image object, changing its expected identity too; the test now clones the image before mutation. This was test setup, never a host record.
- The first actual preload test sent its payload via `stdin.end(chunk)` rather than the historical subject's `stdin.write`; it correctly lacked an observed request. The test now exercises the actual historical write API and explicitly verifies exact forwarding. Subject traffic uses `write`; unrecognized/missing observation still fails.
- Initial scoped lint found one unused import and a Python-file warning from a broad glob. The unused import was removed; final ESLint targets TS/MJS/declarations and Python is parsed separately with 3.11. `lint-first.log` retains that output.
- Self-review added rejection of missing worker exit/tail records, an exit completion seal, independent raw grasp/contact checks, separate measured engine/package/toolchain checks, and timing-summary recomputation. It also retained timeout/abort logs incrementally and made artifact-collection failure leave an incomplete manifest rather than claim success.
- Existing current shared-world/cell/PUMA/ROS mappings and OCI/native_apt admission retain their original behavior; the 153-test combined run covers those gates and old qualification readers. No runtime authority, one-ACK, lost-ACK unknown/no-resend or Lab hardware API was changed.
- Native readiness is deliberately blocked by exact unresolved prerequisites. The passive observer and full Docker/engine campaign have **not** been exercised on an assigned native host, and their native behavior is not inferred from portable tests. The record reader preserves this distinction.
- Host origin includes an operator attestation plus measured local checks; it is not cryptographic host authentication. A historical registry index, if discovered, needs explicit platform resolution support/review rather than relabeling a config/tag. Current R2b native adapter remains required B10 work under R83.

Final state: tooling/tests/runbook and clean Source→Lab pin complete; historical preparation independently verified; native qualification, native arm, hardware and acceptance remain open. `accepted:false`, `not_calibrated`.


## Fix round 1/5 — review 1 Important findings (2026-11-15)

Prepared-tooling fixes for **L01-R1-01 through L01-R1-04 are implemented and locally verified**, pending the controller's scoped independent re-review. Native qualification is still **not_run**; no native host, Docker, cloud, hardware or actual MuJoCo execution occurred. `accepted:false`, `not_calibrated`. L01-R1-05 (historical lift threshold 0.14 versus implemented 0.15 m) remains explicitly deferred by the controller to B10/final triage; this fix does not change that threshold.

Fix BASE: Source `2f4837d10d746a7c8c5e5ca5675ec57db4111c28`, Lab `69032d509cc94b178102c386ddf82280996cf74e`. Original full-task review BASE remains Source `298db9bdbc207b14bdbef78ec8d70adf4e901c71`, Lab `7698aa628fc9a60598d1337b292bdcec2fe91fdc`.

Final clean commits: Source **`bb62601ff706fa2460f8d586fc50591df6f99054`** (`fix: bind native probe checker and retained fault evidence`); Lab **`bbb899349e143dc53b38c591e91fe1c0f0f3ff80`** (`chore: pin source runtime bb62601`). Source commit preceded export/preparation and Lab import/pin. No push, merge, deployment, original cache mutation or historical evidence rewrite.

### Findings addressed

- **R1-01, import/check/use boundary:** `native-checker-bootstrap.mjs` contains the builtin-only full clean-Git/blob audit shared with L00. Public probe/preparer APIs launch a fresh fixed worker process after auditing, with inherited Node preload options removed. The worker audits before importing fixed core/reference modules and again after every operation; parent audits after completion. Cached assessment/JSON modules in a calling recorder cannot supply worker bytes. `run`, `verify`, `read`, `copy`, and `prepare` are allowlisted; caller checker values cannot override the audited tuple. Internal `*-core.mjs` files are not supported qualification entrypoints. The existing recorder's imported public supplement API now passes through this boundary. Actual temporary committed Git snapshots exercise dirty helpers, poisoned caller JSON cache followed by on-disk restoration, and mutations during all five public operations. Real worktrees are never dirtied for refusal tests.
- **R1-02, identity/admission symmetry:** recorded checker is the exact clean Source commit plus SHA256 of the full audited Git-tree listing, including orchestrator, reader, references and imported helper graph. Both qualification readback and supplement copying require the same tuple; no compatibility waiver. Execution and readback share exact historical registry-digest, single required MuJoCo lock, measured package and normalized forbidden-package checks. An old observer record is preserved but requires its old reader pin; current public supplement read correctly refuses the old checker tuple. Installed native image/engine records remain unresolved.
- **R1-03, raw fault evidence:** the reader parses original `wire.jsonl`, requires a final newline, exact seal `totalBytes`, no `.incomplete` marker, ordered task/run/pid scope and complete lifecycle; duplicate spawn, request after exit, resend/overlap and unmatched exit/ACK fail. Both derived wire arrays must equal the entire original stream. Injection, HTTP requests, actual trace/props and post-close `runtime/.../run.json` must match their summaries. The container now obtains its checkpoint summary from the post-close retained copy. Bad-state readback decodes bounded four-vector uncompressed float64 NPZ without pickle/object arrays/extraction, validates actual model dimensions 26/24/24/7, finite before-state and exactly one J1/index-0 qvel NaN, unchanged other pre/injected arrays, complete warning keys/deltas and before/after checkpoint values, all four requests/responses, and exact retained scene/component/physics/MJCF. The static expected XML (`2717a5375922b0e88735859550641e37f8ff664a0f57a10d15bf0f9f585499a8`) was generated with the verified frozen **stdlib-only** compiler over verified historical inputs/meshes, normalizing only meshdir to the fixed container path. Compiler source/hash/method and dimensions are recorded in baseline metadata. This generated XML is static preparation, not engine evidence or a historical runtime replacement.
- **R1-04, nominal failure retention:** separately hashed `mujoco-probe-retention.py` observes the unchanged frozen Sim constructor/tick. It preserves original parameters/MJCF, qpos/qvel/qacc/ctrl, warning counts and the last 128 commands/samples at initialization, every 100 completed ticks, warnings, exceptions and finalization. First warning/failure state is retained separately, with explicit nonfinite-value strings. Constructor failures explicitly report unavailable state. The original method arguments/return/engine state are forwarded unchanged. Copy/I/O cost is outside engine-step timer and inside wall time. Abrupt loss can discard work since the last periodic checkpoint; no claim of per-tick durable storage. Tests cover thrown instability, normally returned warnings, later analysis exceptions, bounded partial retention and actual harness installation/finalization for M00/long-run using injected fake modules, **never a real engine**.

### Changed files

Source fix diff has 25 files:

- `docs/operations/mujoco-native-probe.md`
- `robotics/simulation-mujoco/tests/test_native_probe_retention.py`
- `scripts/native-checker-bootstrap.mjs`
- `scripts/native-handoff.mjs`
- `scripts/native-sim/mujoco-probe-container.mjs`
- `scripts/native-sim/mujoco-probe-core.d.mts`
- `scripts/native-sim/mujoco-probe-core.mjs`
- `scripts/native-sim/mujoco-probe-engine.py`
- `scripts/native-sim/mujoco-probe-evidence.d.mts`
- `scripts/native-sim/mujoco-probe-evidence.mjs`
- `scripts/native-sim/mujoco-probe-npz.mjs`
- `scripts/native-sim/mujoco-probe-raw.d.mts`
- `scripts/native-sim/mujoco-probe-raw.mjs`
- `scripts/native-sim/mujoco-probe-retention.py`
- `scripts/native-sim/mujoco-probe.d.mts`
- `scripts/native-sim/mujoco-probe.mjs`
- `scripts/native-sim/prepare-mujoco-r2a-core.mjs`
- `scripts/native-sim/prepare-mujoco-r2a.mjs`
- `scripts/native-sim/probe-bootstrap.mjs`
- `scripts/native-sim/probe-worker.mjs`
- `scripts/native-sim/r2a-arm-baseline.json`
- `scripts/native-sim/r2a-arm-compiled.xml`
- `tests/fixtures/native-probe-state.ts`
- `tests/security/mujoco-native-probe-checker.test.ts`
- `tests/unit/mujoco-native-probe.test.ts`

Lab changes only `config/source-runtime.lock.json` and generated Source-commit headers in `src/shared/engineering.ts`, `src/shared/navigation2d.ts` (3 files; no UI behavior change).

### Verification and retained raw logs

All new logs are under `evidence-L01/fix1/`; preceding evidence was not overwritten. Node 24.22.2 / pnpm 10.32.1. Long commands use `perl -e 'alarm 180; exec @ARGV'` (focused runs bounded at 60/120 seconds).

| Check | Evidence and result |
| --- | --- |
| Actual public entrypoint dirty/cached-reference RED | `pnpm exec vitest run tests/security/mujoco-native-probe-checker.test.ts`: `security-red.log`, **4 failed** before bootstrap fix (dirty helper executed first); `security-green1.log`, **4 passed** afterward. Expanded post-audit cases: `security-green2.log`, **9 passed**. |
| Image/package admission regression | `pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts -t 'reader binds\|execution and reader'`: `identity-red.log`, missing shared validator failed; checker tuple test already passed after R1-01 integration (not claimed RED). Final suite covers exact digest, forbidden package normalization and extra required package. |
| Original wire/checkpoint substitutions | `-t 'binds business'`: `raw-red.log` retains an initial test syntax error; corrected `raw-red2.log` has **8 failed** against missing raw validator. `unit-green1.log` has all **30 passed**, including valid portable raw fixture and truncated/resend/byte-count/marker/checkpoint/injection/request substitutions. Files are freshly hashed so negatives reach raw semantics. |
| NPZ/scene/input substitutions | `-t 'binds bad-state'`: `bad-state-red.log`, **9 failed** before raw state reader. `unit-green2.log`, **39 passed**; dimension refinement adds a negative, `unit-green3.log`, **40 passed**. These call the production reader's raw-source subvalidators and are explicitly synthetic, not full native-positive qualification fixtures. |
| Python retention RED/GREEN | `PYTHONDONTWRITEBYTECODE=1 …/python -I -B -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests/test_native_probe_retention.py -q`: `retention-red.log`, **7 failed** before observer existed; `retention-green1.log`, **7 passed**. Actual harness tests then exposed an incomplete fake sample (`cup` missing) in `retention-green2.log` (**8 passed, 1 failed**); fixture corrected in `retention-green3.log` (**9 passed**). Final pinned Python 3.11 venv command below: `retention-venv311.log`, **9 passed**. |
| Combined covering suites | `combined1.log`, **181 passed** before model-size refinement. `combined-final.log`, **182 passed, 0 skipped, 6 files**, 54.33 s, exact command below. |
| Source type/contracts/lint | `typecheck-final.log` and final public-API declaration follow-up `typecheck-api-final.log`: pass. `contracts-final.log`: generated contracts match. `lint-final.log`: pass, all affected MJS/TS test files. `git diff --check`: pass. |
| Python syntax and NPZ format compatibility | `python311-syntax.log`: all three Python files parse on 3.11, no engine import. `numpy-npz-compatibility2.log`: actual installed NumPy 2.4.6 `savez` with ZIP64 local headers is decoded, including NaN; only synthetic vectors, no MuJoCo import. |
| Clean export and Lab pin | `clean-export.log`, `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`, `lab-final-check-source.log`: all pass, `dirty:false`. |
| Actual preparation and honest not-run/readback | `preparation.json`/`.stderr`, `handoff-independent-verify.json`/`.stderr`, `native-not-run-cli.json`/`.stderr`/`.exit`, `native-not-run-readback.json`/`.stderr`/`.exit`: results below. |
| Public supplemental copy / prior pin refusal | `supplement-copy.json`/`.stderr`: new record copies and verifies as `not_run`; old checker refused with `PROBE_SUPPLEMENT_INVALID:CHECKER_PIN`. |

Exact final covering commands:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run \
 tests/unit/mujoco-native-probe.test.ts tests/unit/native-handoff.test.ts \
 tests/security/native-handoff-checker.test.ts tests/security/native-handoff.test.ts \
 tests/security/mujoco-native-probe-checker.test.ts tests/unit/sim-extension-qualification.test.ts
PYTHONDONTWRITEBYTECODE=1 .venv-mujoco/bin/python -I -B -m pytest -p no:cacheprovider \
 robotics/simulation-mujoco/tests/test_native_probe_retention.py -q
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm exec eslint \
 scripts/native-handoff.mjs scripts/native-checker-bootstrap.mjs scripts/native-sim/*.mjs \
 tests/security/mujoco-native-probe-checker.test.ts tests/unit/mujoco-native-probe.test.ts \
 tests/fixtures/native-probe-state.ts
```

Other retained development diagnostics: `lint1.log` records two unused imports/two missing `globalThis` prefixes, corrected in `lint2.log` and final check. Bare Homebrew Python 3.11 lacked pytest (`retention-python311.log`); the existing project `.venv-mujoco` supplied it without installing anything. Initial NumPy compatibility attempt used the unrelated Python 3.12 environment, which lacked NumPy; its error is in the tool transcript and its stdout-only `numpy-npz-compatibility.log` is empty. The successful corrected venv run has both streams retained in `numpy-npz-compatibility2.log`. No missing original diagnostics were recreated or relabeled.

### New preparation/export identities and preserved originals

- New historical handoff: **`/tmp/mekoniq-L01-fix1-preparation-CRyEAA/handoff`**, manifest SHA256 **`482d8f694b479f235af53fee3572abda6a0fb7c8e07065c2ab1ff97c89dc708a`**. Independently audited **184 refs / 9,648,529 bytes / all 179 historical portable entries**. Subject remains Source `4f893ac…`, Lab `a6ec316…`, runtime `55dd3585…`, original schema/closure/profile, image null. Independent L00 verification exits 0 with `prepared:true`, `nativeReady:false` and exact prerequisites `PACKAGE_LOCK_UNRESOLVED`, `SUBJECT_IMAGE_UNRESOLVED`, `HOST_INVENTORY_MISSING`.
- Preparer/probe full-graph checker: Source `bb62601ff706fa2460f8d586fc50591df6f99054`, tool SHA256 **`abb467b33ad9011efbf3867e3ce6fd91aa080f8763e7be03736749a540f6a378`**. Independent L00 short tool digest **`1ffa5a770189a26128cf8a1e6bbb546b946dd73fe9d20750af58bc256eff5ff3`** retains its separate scope.
- New retained **`/tmp/mekoniq-L01-fix1-preparation-CRyEAA/native-not-run`**, manifest SHA256 **`e5a298fc8b4d17264ab36c3e2ed7569c80eda627087da36ed9d28acb17e17741`**. Actual public CLI exits **2**, `NATIVE_AMD64_HOST_UNASSIGNED`, all **16 cases not_run**; no Docker command reached. Actual readback exits **1**, `passed:false` / `not_qualified`, with `NATIVE_CAMPAIGN_NOT_PASSED` and missing observer execution directory. Supplemental copy remains `not_run` at the sibling `supplement-copy` directory.
- Clean current export **`/tmp/mekoniq-L01-fix1-export-kGDGfR/runtime`**, runtime SHA256 **`e0a5e5666dfed2fa40ed7290137a31802d12a651a9cb0745a57d986487288b49`**, schema **`07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068`**, portable closure **`4ba424081c04ba0f532c069047bf244a99385edd09ca9df347cfb45fe6d22e6e`**. This current export is not the historical subject image.
- Original `/tmp/mekoniq-L01-preparation-g53avI/handoff` remains SHA256 **`76f3a4fda8ef1b7c21695d1f261ce6a9d08758e401d0beb5be21883783547e30`**, and all its refs were rehashed read-only. Its sibling original not-run manifest remains SHA256 **`be5a3ed01296bcafdf1f98137e202b9d476c609b8726abf6468acc95e582ed7a`**, with every listed artifact rehashed read-only. Neither original directory nor its checker fields changed.
- Original report prefix is exactly **16463 bytes**, SHA256 **`bee7eda7120cebc3afea510c2947dccedc8a56ac7ea9e0f1a9c1652a6de82912`**; this section is appended after that unchanged prefix. `pre-review-fix1-report.md` and its identity JSON remain untouched.
- `fix1/final-identities.json` records full tuples, checksums, old/new case statuses and clean checkouts. Pointer files are `fix1/preparation-root.txt`, `fix1/export-root.txt`. `fix1/evidence-manifest.json` hashes the retained fix logs.

### Remaining limitations / review handoff

There is still no assigned native Linux amd64 host or exact verified installed historical image, so a complete native-positive execution/readback fixture is unavailable. Tests do not bypass these admission rules; they exercise actual audited entrypoints on synthetic temporary Git snapshots and the production raw subvalidators on explicitly portable data. No unit/protocol/static XML output is represented as native evidence. Real MuJoCo warning behavior, native timing overhead and full container/runtime outcomes still require the authorized future assigned-host campaign. R82's component bad-state remains separate from Source custody/served; R84's unchanged subject bytes plus passive instrumentation distinction is preserved. R83's current R2b executable adapter remains required B10 tooling work, with no R2a substitution. Both worktrees are clean and ready for one scoped re-review of this fix diff.


## Fix1 pre-review follow-up — recorder unit-test isolation and activity correction

**Correction to the earlier broad no-Docker statements:** the inherited recorder unit test invoked the production `record-sim-extension.mjs --plan` path, which calls `spawnSync('docker', ['info'], {stdio:'ignore', timeout:30_000})` for its prerequisite check. `fix1/combined-final.log` records that test at **30,292 ms** (`combined1.log`: **30,280 ms**). Those prior combined runs therefore did invoke the inherited read-only Docker prerequisite probe; broad claims that all verification involved no Docker calls/activity are withdrawn. The exact real Docker child status/output was not retained, so this report does **not** infer an exit code, timeout result, daemon readiness, image operation, or container run from the test duration. This does not change the narrower retained evidence that the **new native probe CLI itself** stopped at the host guard before its Docker path. No native qualification follows from the inherited prerequisite probe.

This is a controller-requested pre-scoped-review follow-up **within fix round1**, not a new review round. Original fix BASE remains Source `2f4837d10d746a7c8c5e5ca5675ec57db4111c28` / Lab `69032d509cc94b178102c386ddf82280996cf74e`. No additional production fix or native/Docker retry was performed. R76 remains in force until final B10.

### Test-only change and verification

Source commit **`eeea18db88485e113aafe1cc15edd7f75ced2b66`** (`test: isolate recorder plan Docker prerequisite probe`) changes only `tests/unit/sim-extension-qualification.test.ts`. The test creates an owned executable stub and gives recorder subprocesses an **exclusive PATH containing only that directory**, so there is no fallback to host Docker. The stub records its executable path and exact argv, returns the deliberately unavailable fixture status for `info`, and rejects any other argv. The test asserts the recorder called that stub exactly once with `['info']`, asserts the plan reports `DOCKER_UNAVAILABLE`, and explicitly exercises the stub-only refusal of `['unexpected-unit-argument']` (exit 97). The retained receipts name the owned executable. Stub fixture statuses are not native Docker observations. Temporary fixture cleanup is confined to its owned directory. Production `--plan`, native/identity admission and all production tooling are unchanged.

New evidence is under **`evidence-L01/fix1/plan-test-isolation/`**. No earlier logs were overwritten.

| Before/after check | Retained result |
| --- | --- |
| Prior inherited recorder test | `../combined-final.log`: passed in 30,292 ms as part of the 182-test fix1 run; real read-only Docker prerequisite path was not isolated. No retained exact child exit status. |
| Safe focused RED | `focused-red.log`: **1 failed / 24 unselected**, 238 ms test; used an empty owned exclusive PATH, so no real Docker executable could resolve. Failed for missing required stub receipt, before wiring the fixture directory into PATH. |
| Focused GREEN before commit | `focused-green.log`: **1 passed / 24 unselected**, 850 ms test, exact owned stub executable/argv receipts emitted. |
| Focused GREEN at actual committed HEAD | `focused-check-source.txt` records **`eeea18db88485e113aafe1cc15edd7f75ced2b66`**; `focused-committed-green.log`: **1 passed / 24 unselected**, 763 ms test (955 ms total), exit 0. Receipts show only the stub `info` and deliberate stub-only invalid argument. |
| Relevant checks | `typecheck.log`: Source route typegen/tsc pass; `lint.log`: changed test ESLint pass; `git diff --check`: pass. These checked the final test bytes subsequently committed as `eeea18d`. |
| New clean export and Lab pin | `clean-export.log`, `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`, `lab-final-check-source.log`: all pass; export `dirty:false`. |

Exact focused command (bounded; no broad suite rerun):

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run \
 tests/unit/sim-extension-qualification.test.ts -t 'r2a recorder refuses'
perl -e 'alarm 60; exec @ARGV' pnpm exec eslint tests/unit/sim-extension-qualification.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
```

**Counts stay separate:** the **182 Vitest / 9 portable Python** successes belong to the preceding precommit fix1 working tree based on `2f4837d`, handed off as Source `bb62601ff706fa2460f8d586fc50591df6f99054`. They were **not rerun** on the new HEAD. The new committed HEAD has the **one corrected focused test passed**, with 24 unselected tests explicitly `not_run` in that invocation. No old suite count is represented as newly executed, and no unit result is native evidence.

### Updated clean identities and new prepared artifacts

- Source **`eeea18db88485e113aafe1cc15edd7f75ced2b66`**; Lab **`e8577a5b7f4f6b615aa333b3f86126d06e1f0c05`** (`chore: pin source runtime eeea18d`), both clean. Lab changes only the runtime lock and two generated Source-commit headers. Previous `bb62601` / `bbb8993` commits and their artifacts are preserved.
- New current export: **`/tmp/mekoniq-L01-fix1-isolated-export-C5cJ3g/runtime`**, runtime SHA256 **`a0389ddd56cc96c3c3116a00e2f1b7e433b6ae06b90627d4578754ae6bb0dded`**, schema **`07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068`**, portable closure **`4ba424081c04ba0f532c069047bf244a99385edd09ca9df347cfb45fe6d22e6e`**, `dirty:false`. The new runtime hash reflects the updated embedded Source identity; it is not the historical MuJoCo subject.
- New historical preparation: **`/tmp/mekoniq-L01-fix1-isolated-preparation-1sLaHG/handoff`**, manifest SHA256 **`f8e4755506ffb36bc2cd93dddbbe2ff96eb81e0e1d3aed8e681cf042c1a53dac`**. Its **184 refs / 9,648,529 bytes** rehash correctly; subject remains exact Source `4f893ac…` / Lab `a6ec316…` / runtime `55dd3585…` with original schema/closure/profile and `image:null`. Independent `native-handoff.mjs verify` exits 0: `prepared:true`, `nativeReady:false`; remaining prerequisites are `PACKAGE_LOCK_UNRESOLVED`, `SUBJECT_IMAGE_UNRESOLVED`, `HOST_INVENTORY_MISSING`. See `preparation.json` and `handoff-independent-verify.json` with stderr files.
- New native-probe record: **`/tmp/mekoniq-L01-fix1-isolated-preparation-1sLaHG/native-not-run`**, manifest SHA256 **`deb9af0d37d89dc283b0cb37efa3d838ee55dd61a2291e0ee1ef644c7f98a38d`**. Public CLI exits **2**, `NATIVE_AMD64_HOST_UNASSIGNED`, all **16 cases not_run**, with no native-probe Docker command reached. Public readback exits **1**, `passed:false` / `not_qualified`. See `native-not-run-cli.*`, `native-not-run-readback.*`.
- Full-graph observer/preparer tuple now uses Source **`eeea18db88485e113aafe1cc15edd7f75ced2b66`** plus tool SHA256 **`abb467b33ad9011efbf3867e3ce6fd91aa080f8763e7be03736749a540f6a378`**. The tool digest is unchanged because this follow-up changes a unit test outside that imported/reference corpus; the strict checker **commit** identity changes. L00's separate short tool digest remains `1ffa5a770189a26128cf8a1e6bbb546b946dd73fe9d20750af58bc256eff5ff3` with the new Source commit.
- `final-identities.json` records the new heads, focused-test commit, prior counts, preserved old/new artifacts and clean state. Every listed ref/artifact in the original `2f4837d` and `bb62601` handoff/not-run packages was rehashed read-only and matches its prior manifest. Both prior exports' runtime files match their manifests. All **51 files** in the prior fix1 evidence manifest still match their recorded hashes.
- The entire preceding report is preserved as **31958 bytes**, SHA256 **`5275ed03e2d4b984810cd8eff263a1c0cbb6a222e0299d04e3c9758ab0637008`**, with an immutable snapshot at `plan-test-isolation/pre-correction-report.md`. The original 16,463-byte prefix remains `bee7eda7120cebc3afea510c2947dccedc8a56ac7ea9e0f1a9c1652a6de82912`. This correction is appended, not rewritten into the historical record. New evidence hashes are in `plan-test-isolation/evidence-manifest.json`.

Native matrix/DEP-MJ-01 still **not_run**, `accepted:false`, dynamics `not_calibrated`. No container build/run, actual engine campaign, cloud or hardware execution was undertaken in this follow-up. All four Important fixes remain as previously implemented; R1-05 stays deferred. Updated heads are ready for the same scoped fix1 review against the original fix BASE.


## Fix round2/5 — L01-R2-01 HTTP action writer/readback compatibility

**L01-R2-01 is implemented and locally verified**, pending independent review of this fix diff. Fix BASE is Source **`eeea18db88485e113aafe1cc15edd7f75ced2b66`** / Lab **`e8577a5b7f4f6b615aa333b3f86126d06e1f0c05`**. Original task BASE remains `298db9b` / `7698aa6`. Review2 closed R1-01–04; this fix does not reopen them or change deferred Minor R1-05. R81–R84 remain unchanged.

Final clean Source **`874d05aedfbf573496994fd73016f19ef19e6932`** (`fix: persist completed native probe action receipts`), Lab **`4a207b43c613cf0c1226a9ff3c1990a96ec5ac08`** (`chore: pin source runtime 874d05a`). No helpers, real Docker commands, native engine, cloud, hardware, provisioning, push or deployment were used in this fix round. Production recorder `--plan` was not invoked; its previously isolated unit test was not rerun. The previous report's inherited Docker-probe disclosure remains intact.

### Change and test seam

The existing business action writer saved `received:false` before HTTP dispatch but changed only the in-memory flag after the response. Its final action therefore deterministically disagreed with `requests.json`. The strict reader remains **unchanged**.

The action lifecycle was extracted, without initially fixing that behavior, into `createActionRecorder` in a small observer helper. The container calls that same helper. The regression drives its real `save()` calls into an owned temporary filesystem while substituting only the HTTP/memory boundary, then supplies the resulting requests and retained file to production `verifyBusinessRaw`. It does not hand-write a matching completed request file. This produced the exact **`HTTP_REQUEST_BYTES`** failure for the final successful action before the fix.

The writer now awaits a second `requests.json` save after the successful response and before returning or memory sampling. Pre-dispatch persistence remains, so failed and in-flight requests retain `received:false`. Action IDs, request payload/path/method, revision tracking, response forwarding and serial caller flow retain their existing behavior. HTTP timing is sampled immediately after the response as before; the new completion write is outside that sample and inside overall wall time. The helper is included in the staged observer-file set and independent observer pin comparison. No admission, native identity, subject, reader equality or qualification policy was loosened.

Source changes (5 files):

- `scripts/native-sim/mujoco-probe-actions.mjs`: extracted action writer and completed-state persistence.
- `scripts/native-sim/mujoco-probe-actions.d.mts`: typed portable test seam.
- `scripts/native-sim/mujoco-probe-container.mjs`: delegates the existing action lifecycle to the shared writer.
- `scripts/native-sim/mujoco-probe-core.mjs`: stages and pins the new observer helper.
- `tests/unit/mujoco-native-probe.test.ts`: three actual writer-to-reader lifecycle regressions integrated into the existing raw-source fixture.

Lab changes only its runtime lock and two generated Source-commit headers. No schema, runtime authority, model physics, native baseline, R2b adapter or production recorder behavior changes.

### RED/GREEN and covering checks

Logs are retained under **`evidence-L01/fix2/`**. All test data is portable and synthetic; no test output is native campaign evidence.

| Check | Actual result / output |
| --- | --- |
| Focused RED, unfixed extracted writer | `writer-red.log`: **1 failed, 2 passed, 40 unselected**, exit 1. Final successful action yielded exactly `['HTTP_REQUEST_BYTES']` from the strict reader; failed/in-flight cases already preserved attempted state. |
| Focused GREEN | `writer-green.log`: **3 passed, 40 unselected**, exit 0 after the completion save. Checks pre-dispatch `received:false`, final successful readback equality, response forwarding, failed/in-flight retained false and no completed timing sample for failed calls. |
| Covering unit + checker suites | `covering.log`: **52 passed, 0 skipped, 2 files**, exit 0, 10.03 s. Includes all 43 L01 unit cases plus 9 public checker security cases. Final assertion also confirms incomplete requests fail the serial/received condition. |
| Source typecheck / lint | `typecheck.log`: route generation and tsc pass. `lint.log`: scoped ESLint pass. `git diff --check`: pass. |
| Clean export / Lab | `clean-export.log`, `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`, `lab-final-check-source.log`: pass; export `dirty:false`. |
| New preparation / not-run / refusal | `preparation.json`, `handoff-independent-verify.json`, `native-not-run-cli.*`, `native-not-run-readback.*`: outcomes and identities below. stderr files retained. |

Exact commands (Node 24.22.2 / pnpm 10.32.1):

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
# RED, then GREEN after the completion save:
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run \
 tests/unit/mujoco-native-probe.test.ts -t 'writer-'
# Final covering run:
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run \
 tests/unit/mujoco-native-probe.test.ts tests/security/mujoco-native-probe-checker.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 60; exec @ARGV' pnpm exec eslint \
 scripts/native-sim/mujoco-probe-actions.mjs scripts/native-sim/mujoco-probe-actions.d.mts \
 scripts/native-sim/mujoco-probe-container.mjs scripts/native-sim/mujoco-probe-core.mjs \
 tests/unit/mujoco-native-probe.test.ts
```

Attribution: focused RED/GREEN were development iterations based on `eeea18d`. The final covering run, typecheck and lint checked the final precommit working tree. Its recorded index tree **`6a59ef54f7861d12b1901d88da63394df6b5a830`** (`checked-source-tree.txt`) exactly equals the tree of final Source **`874d05aedfbf573496994fd73016f19ef19e6932`**. The covering run includes the final extra assertion that failed/in-flight requests remain ineligible. No broad 182-test suite, Python engine/retention suite, recorder `--plan`, or unrelated campaign was rerun. Prior success counts remain attached to their previously reported trees; the current count is **52 portable tests**.

### Current identities and immutable preparation

- New current export: **`/tmp/mekoniq-L01-fix2-export-a4Clal/runtime`**; Source `874d05aedfbf573496994fd73016f19ef19e6932`, runtime SHA256 **`7230dcac101d3010a9580b22f9c5d1ded01b79c917a6e7dff9182a9f262f7013`**, schema **`07e01e8efb146fb50b8c68eebfa27d989ee07d4e80bcdb796639e3c2aaa42068`**, portable closure **`4ba424081c04ba0f532c069047bf244a99385edd09ca9df347cfb45fe6d22e6e`**. `dirty:false`, pinned in Lab `4a207b43c613cf0c1226a9ff3c1990a96ec5ac08`. This current export remains distinct from the historical MuJoCo subject.
- New historical handoff: **`/tmp/mekoniq-L01-fix2-preparation-sQ7TjS/handoff`**, manifest SHA256 **`d0016f8d04d9a2d6446d4e94722ace768957e64f8ea5c4f0b478a3783afa406c`**. Read-only audit confirms **184 refs / 9,648,529 bytes**, preserving the historical Source `4f893ac…`, Lab `a6ec316…`, runtime `55dd3585…`, schema/closure/profile tuple and image null. Independent L00 verification exits 0 with **prepared:true / nativeReady:false**; exact remaining prerequisites: `PACKAGE_LOCK_UNRESOLVED`, `SUBJECT_IMAGE_UNRESOLVED`, `HOST_INVENTORY_MISSING`.
- Full observer/preparer checker: Source **`874d05aedfbf573496994fd73016f19ef19e6932`**, tool SHA256 **`f0052cf8449b7c978d432ead1c65a9ebfda784db166933ada3e9c6bba9f0557f`**. Independent L00 short tool digest **`1ffa5a770189a26128cf8a1e6bbb546b946dd73fe9d20750af58bc256eff5ff3`** retains its separate scope, with the same current Source commit.
- New probe record: **`/tmp/mekoniq-L01-fix2-preparation-sQ7TjS/native-not-run`**, manifest SHA256 **`2fc0b0d0958a2e37eee60bd8b1bf957779c2df3aedb8da478e000a4710c94e5f`**. Public CLI exits **2**, issue `NATIVE_AMD64_HOST_UNASSIGNED`, **16/16 cases not_run**, stopping before its Docker path. Public readback exits **1**, `passed:false` / `not_qualified`, with `NATIVE_CAMPAIGN_NOT_PASSED` and missing observer execution directory. No absent execution becomes a pass.
- Prior latest handoff `/tmp/mekoniq-L01-fix1-isolated-preparation-1sLaHG/handoff` remains **`f8e4755506ffb36bc2cd93dddbbe2ff96eb81e0e1d3aed8e681cf042c1a53dac`**; sibling prior not-run remains **`deb9af0d37d89dc283b0cb37efa3d838ee55dd61a2291e0ee1ef644c7f98a38d`**. All refs/artifacts in these and the four earlier handoff/probe packages were rehashed read-only and match prior records. All three previous exported runtimes match their manifests. No historical SQLite was opened as a database.
- Both preceding fix1 evidence manifests still validate all their **51 + 27 files**. The entire prior report is preserved byte-for-byte: **40356 bytes**, SHA256 **`b1f75fc143850247ef313541b352f9909c71a12adcc9c95f71c5de8fdf64a878`**, matching controller snapshot `fix2/pre-fix2-report.md` and identity JSON. This section is appended only.
- `fix2/final-identities.json` records all old/new tuples and preservation checks; `fix2/evidence-manifest.json` hashes the new retained evidence. Directory pointers are `fix2/export-root.txt` and `fix2/preparation-root.txt`.

### Remaining limits / handoff

This fixes the deterministic writer/reader mismatch using the actual shared writer and real retained files, with substituted portable HTTP responses. It does not establish a full native-positive campaign: assigned host, exact installed historical image and measured engine data remain unavailable. R82 component bad-state and full-runtime worker-loss scopes remain separate; R83 current R2b adapter remains B10 work; R84 observation and strict complete-trace policy remain intact. Native matrix and DEP-MJ-01 stay **not_run**, `accepted:false`, dynamics `not_calibrated`. No new architecture conflict or other requested defect remains in this round. Both worktrees are clean and ready for scoped review of the fix2 diff only.
