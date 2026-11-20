# R4 V07 qualification inspection

Read-only inspection of source baseline `a93ae08d` and Lab baseline `e352c5d`, with a short two-image probe at historical source `2f49084`. Current credentials and live metadata were inspected without reading secret values, pairing or changing a service. No new qualification result was recorded.

## CLD01 and CLD02

Contracts §9 and plans README require a clean, same-commit arm64 runtime image for CLD01 and amd64 image Python tool-root tests for CLD02. The existing CLD01 test checks nominal `MJ-CELL-BV01` and a wheel step bench through real HTTP, then starts the second bench while the first remains open. The finished cell must archive first because it still owns the one MuJoCo slot. Future fault and belief cases belong to V09/V13.

Historical files `../evidence-archive/r4-2-bench-2f49084/cld01-container.log` and `cld02-amd64-pytest.log` are tied to `2f49084cb4511004e561ef29b16bfded791c5ed7`. CLD01 arm64 passed, cell tick 10900/served 2/14.552 ms per tick and bench tick 500/3.778 ms per tick. The amd64 image's host was arm64. V05 had 8 failures, 166 passes and one architecture-specific golden skip. V07 had the same eight failures, 227 passes and one skip, 48.92 seconds. Pre-R4 `c19785d` already showed the two mobile and one world failures under emulation. A later docs-only commit also requires a rebuild if testing its exact revision. The existing integration test compares health commit against checkout HEAD.

| Historical x86 image test | Failure evidence | Diagnostic interpretation |
|---|---|---|
| `test_drive_engine.py::test_an_ideal_drive_is_bit_identical_to_the_legacy_mobile_path` | Legacy path aborts before running ideal, BADQACC at DOF 3, 5.138 s | This failure alone says nothing about the drive layer |
| `test_drive_engine.py::test_an_ideal_drive_is_bit_identical_to_the_legacy_arm_path` | Same-image position arrays diverge; QPOS warnings at DOF 0 at 2.276 and 2.440 s, QACC at 0.036 s | State-reset divergence is plausible; isolate first differing substep if native repeats |
| `test_drive_engine.py::test_an_ideal_drive_is_bit_identical_to_the_legacy_world_path` | Legacy path aborts before running ideal, BADQACC at DOF 0, 8.192 s | Shared-world legacy plant instability precedes comparison |
| `test_drive_engine.py::test_a_wheel_with_ki_is_a_proportional_integral_velocity_loop_that_converges` | BADQACC at DOF 6, 5.006 s, accepted seq 251 | No convergence measurement after a fatal engine warning |
| `test_drive_engine.py::test_wheel_torque_never_exceeds_the_motoring_envelope_times_the_scale` | Nominal measured peak 0.2567050529 N m, expected above 5; failure is the nominal excitation check | Inspect target/actual/actuator force and saturation before changing the torque oracle |
| `test_mobile.py::test_motion_is_physics_driven_and_lidar_uses_engine_geometry` | X 2.0000115536 after 100 ticks, expected above 2.1 | Actual propulsion stalled; lidar checks were never reached |
| `test_mobile.py::test_registered_payload_impulse_is_integrated_once_without_pose_teleport` | Worker failed at request step-250, QACC DOF 3, 5.026 s | Legacy mobile engine aborts before the impulse observation can be completed |
| `test_world.py::test_one_priming_then_ten_native_substeps_per_logical_tick_and_actual_readings` | Measured Y 0.4859019315, expected above authored initial Y 0.4859136622 | Threshold should follow observed post-prime pose, but the simulator also moves the wrong way under emulation |

### Same-commit, same-versions short comparison

Both cached images have OCI revision `2f49084cb4511004e561ef29b16bfded791c5ed7`; arm64 ID `df52c05aaa7e`, amd64 ID `472aadfa1338`. Both use MuJoCo 3.17.0, NumPy 2.4.6 and pytest 9.2.0. On the Apple Silicon Mac's OrbStack daemon, the `tests/test_world.py` fixture gave these results at 110 substeps.

| Image | Y after prime | Final Y with zero speed | Final Y with +0.1 m/s |
|---|---:|---:|---:|
| arm64 native | 0.4859218754835096 | 0.48592090968900553 | 0.5016785973504948 |
| amd64 emulated | 0.4859123124102784 | 0.485912115068057 | 0.4859019315256375 |

To reproduce, archive the `2f49084` MuJoCo tool root and schemas into a fresh temporary directory. Bind it read-only at `/repo` using the CLD02 command below. Run the world test on each cached image or set `PYTHONPATH=tests` and execute the following inline Python via `python -B -c`. Use host Docker architecture as well as the guest architecture.

```python
from test_world import inputs, load, WorldEngine
for speed in (0, .1):
    engine = WorldEngine(*inputs())
    home = load('programs.json')['programs']['waypoints']['home']
    primed = engine.step(home, .0889, [], 0, 0)
    for _ in range(10):
        final = engine.step(home, .0889, [], speed, 0)
    y = lambda result: result['world']['robots'][0]['poseDriveMap'][1]
    print(engine.total_substeps, speed, y(primed), y(final))
    engine.close()
```

The arm64 Linux control case passes with the same pinned dependency versions. The amd64 emulated failure is genuine plant divergence, beyond the fixed-origin assertion. This comparison identifies an architecture or execution-environment dependency. It takes a same-image native x86 comparison to attribute it to emulation. The three ideal-versus-legacy tests compare two paths on the **same** host and should retain bitwise equivalence. Only the fixed recorded arm64 golden in `test_drive_engine.py` is inherently architecture-scoped. The previous successful native Cloud Run R2a arm run and its failing Apple Silicon emulation support the environment hypothesis without qualifying R4.

### Final execution

On clean final source in the Mac shell, record identity and stdout/stderr to a fresh evidence directory outside both repositories. Validate open/terminal status explicitly and retain the arm64/native host annotation.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
image="mekoniq-lab-runtime:r4-$(git rev-parse --short=12 HEAD)-arm64"
test "$(docker info --format '{{.Architecture}}')" = aarch64
perl -e 'alarm 900; exec @ARGV' deploy/lab-runtime/build.sh "$image" --platform linux/arm64
LAB_CONTAINER_IMAGE="$image" perl -e 'alarm 1800; exec @ARGV'   pnpm test:integration -- tests/integration/lab-runtime-container-r4.test.ts
```

Version-neutral Mac Docker CPU names may be `arm64` or `aarch64` depending on the Docker verb. The locally observed `docker version --format '{{.Server.Arch}}'` reports `arm64`. Check the host explicitly rather than relying on the image tag or the guest `uname`.

Use a scoped push job on `r4/virtual-commissioning`, `runs-on: ubuntu-24.04`, with `contents: read`, checkout, existing pnpm/setup-node actions, and `pnpm install --frozen-lockfile`. The branch exists on Source origin, the repository is public, Actions is enabled with all actions permitted, the active gh CLI account has ADMIN and workflow scope, and there are zero registered self-hosted runners. The latest available branch run, [44464613407](https://github.com/phamvuhoang/mekoniq/actions/runs/44464613407), executed the two hosted jobs. Both failed within their test commands. Keep CLD02 independent of those jobs. A new `workflow_dispatch`-only workflow does not receive that event until it exists on the default branch. The relevant runner architecture is documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The workflow can use the following bash step, then upload `$RUNNER_TEMP/r4-cld02` with `if: always()`. Keep the existing checkout clean by writing build and test logs only outside it.

```bash
set -euo pipefail
evidence_dir="$RUNNER_TEMP/r4-cld02"
mkdir -p "$evidence_dir"
test -z "$(git status --porcelain --untracked-files=all)"
sha="$(git rev-parse HEAD)"
test "$sha" = "$GITHUB_SHA"
test "$(uname -m)" = x86_64
test "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" = linux/amd64
test "$RUNNER_ARCH" = X64
image="mekoniq-lab-runtime:cld02-$sha"
{
  printf 'source=%s runner_arch=%s run_id=%s run_attempt=%s\n' "$sha" "$RUNNER_ARCH" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
  uname -sm
  docker version --format '{{.Server.Os}}/{{.Server.Arch}} {{.Server.Version}}'
  node --version
  pnpm --version
  sha256sum robotics/simulation-mujoco/requirements.lock
} > "$evidence_dir/host.txt"
node scripts/export-lab-runtime.mjs "$RUNNER_TEMP/r4-export"
cp "$RUNNER_TEMP/r4-export/manifest.json" "$evidence_dir/runtime-manifest.json"
perl -e 'alarm 900; exec @ARGV' deploy/lab-runtime/build.sh "$image" --platform linux/amd64   2>&1 | tee "$evidence_dir/build.log"
docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image"   | tee "$evidence_dir/image.txt"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "linux/amd64 $sha"
set +e
perl -e 'alarm 900; exec @ARGV' docker run --rm --platform linux/amd64 --read-only --tmpfs /tmp \
  -v "$PWD":/repo:ro -w /repo/robotics/simulation-mujoco -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint /opt/venv-mujoco/bin/python "$image" \
  -B -m pytest -p no:cacheprovider -ra -q tests 2>&1 | tee "$evidence_dir/pytest.log"
pytest_status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$pytest_status" > "$evidence_dir/pytest-exit.txt"
(cd "$evidence_dir" && sha256sum build.log host.txt image.txt pytest.log pytest-exit.txt runtime-manifest.json > SHA256SUMS)
exit "$pytest_status"
```

The test mount is necessary because the production image deliberately omits tests and some fixture inputs live elsewhere in Source. Keep the image entrypoint Python, read-only checkout and root, and tmpfs. Optionally log guest `platform.machine()` and dependency versions. Compare `sourceCommit`, `schemaHash` and `portableSimulationTools` manifest digests to the final Lab lock. Download the per-run artifact and verify `SHA256SUMS`; preserve the job URL. Historical CLD01/02 log sizes were 1,739 and 17,666 bytes. A build/test/provenance-only CI artifact should be roughly tens of KiB, likely under 100 KiB excluding optional verbose diagnostics. Cached images were approximately 478/461 MB uncompressed, so image upload is unnecessary. Historical bench and CIL campaign trees occupy 84 MiB and 382 MiB respectively; size and checksum the actual new archive separately for off-machine retention. Source is public, so inspect any artifact that leaves the machine for secrets, runtime custody material and private fixtures.

If all native physics tests pass, record each architecture-scoped fixed golden separately with its precise skip reason. The new Task 1 protocol corpus is scoped to macOS arm64, and the old `ARM64_ONLY` golden gate is literally `platform.machine() == 'arm64'` (Linux arm64 usually reports `aarch64`). Keep all same-host amd64 compatibility comparisons running. A future native byte corpus needs a trusted capture of the pre-fix revision on that host class. If any historical failure repeats, rerun its node with `-vv -s` and compare exact completed source with the same pinned image build at historical `2f49084`; capture first discrepant tick and warning/inputs. No numeric tolerances or oracles need preemptive changes.

## CLD03

The existing service is `mekoniq-lab-runtime`, project `mekoniq`, region `asia-southeast1`, Ready revision `mekoniq-lab-runtime-00003-q7v` (100% traffic). It runs Gen2 with concurrency 20, timeout 3600, max instances 1, 1 CPU/2 GiB and immutable image digest `sha256:70783b9e52fd58dac918df1d1c882c0202fa99bff42baee4c367d0b08c69a35e`. Public health confirmed source `3d8c2a8daa025cab6373fd86b0cec7f40864fdb0` and schema `8ffe1fe9039cfe44094ab0e47b6b038a70c4811ebe7ad292092108963123a95b`. The default local gcloud project differs, so every command specifies project and region. Reproduce metadata reads using `gcloud run services describe mekoniq-lab-runtime --project=mekoniq --region=asia-southeast1 --format='value(status.latestReadyRevisionName,status.url)'` and `GET /lab/v2/health`.

CLD03 remains `not_run`, `deploy_order_pending`. On a user-ordered deploy, use the final clean amd64 image by immutable Artifact Registry digest, exact Lab allowed origin and service URL host, and existing Secret Manager reference through `deploy/lab-runtime/cloud-run.sh`. Reuse neither public health from R2b nor older CL01 as R4 evidence. At V16 produce a checksum-bound supplementary record for the exact R4 qualification bytes, matching health commit and schema to Lab pin, real x86 cell serving 2, completed bench, and comparable ms/tick and real-time factor. The current `scripts/cloud-run-qualification.mjs` only accepts R2a, so its R4 guard extension and negative tests remain explicit V16 work.

## V06/V07 deferred ledger against the base branches

| Ledger items | Status and evidence |
|---|---|
| V06pre vectors assert admitted only; mismatched Python plant tests | Open narrow coverage. `tests/contracts/control-profile-admission.test.ts` and `test_drive_model.py` read shared vectors only for admission. Existing `test_bench_documents_are_bound_to_the_bench_plant` does assert an exact code on the bench path, but check the separate older cell/worker mismatch test. Add reason parity where the vector encodes it. |
| V06pre per-mode envelope fields and Python booleans | Open. `validateTuningEnvelope` validates bounds and duplicate axes but does not relate allowed fields to mode. `actuator_spec` accepts Python bool via `isinstance(bool,(int,float))` even though JSON schema rejects bool upstream. Task 1 is the natural place for direct-call numeric assertion, Task 2 for envelope consistency. |
| V06a missing plant limits, hold-501 reason, atTick max and noisy shape errors | Fixed. `bench-signals.ts` requires finite limits on CSP. Discriminated union in `bench-request-v1` bounds `atTick` to 499 and hold to 500. `tests/security/lab-bench.test.ts` checks exact `TICK_OUT_OF_RANGE`. Missing `kind` still yields general `INVALID_FIELD` at V07pre. |
| V06a duplicate `done`, invalid zero-distance sampler, in-memory NaN, triangle precision, gripper units | Open duplication and defensive finite checks in Task 2. Server rejects zero distance and output invalidity still deserves a direct test. Exact discrete-integral regressions cover the triangle test debt. Gripper units confirmed as drive-joint radians in `benchPlant`. |
| V06b worker tests and fixture | Task 1 covers inaccurate instability text, hardcoded J3 index, observational getState, disabled/quick-stop trace, arm drive conflict, perturbation-scope refusal and byte corpus. Existing tests cover normal world refusal and wheel conflict only. `test_bench.py::axis_joint` using implementation lookup for the inertia reference remains an independent-test gap. Previous `world_engine.py` edits were explicitly justified. |
| V06c engine ID, trace closure label, trapezoid motion window, SSE, refusal shape, hostArch, ref revision, invalid seed | Fixed in ranges through `ffe869c`, `9c9175d` and `5101341`. Keep saved test evidence rather than repeating these as deferred. |
| V06c trace shape/gaps, duplicated metric units/unavailable, optional anchor, priming instability | Open at base and explicitly assigned Task 2. Late step windows should expose unavailable results when observations are insufficient. The public trace has no standalone digest by design. Server shared-reader verification and report identity are the essential integrity checks. |
| V06c duplicate envelope inputs and wheel readiness disagreement | Open. `navigation2d/readiness.ts` checks arm/mobile/world agreement for the cell, while bench picks `mr ?? mobile` for both. Bench catalog and runtime health can obtain envelope data from differing roots. Exercise mismatched providers and report accurate readiness instead of claiming model/clock/fixture/profile invariance. |
| V06c noisy dumps, `TuningResultV11` alias, no historical RED | Logging is gated in normal bench runs by `MEKONIQ_BENCH_LOG` where needed for TUNE05. Current runtime exports `TuningResultV1`; generated `navigation2d.ts` still aliases it to `TuningResultV11` (generated top-level and branch names). Repair the generator/schema naming where practical instead of hand-editing the generated file. Historical process cannot be amended. Record RED/GREEN for current reader/runner changes. |
| V06 final collision, direction and close/phase | Direction restriction, catalog forward-only flag, report statuses and trace route exist. Collision uses protocol double only (Task 2 asks a deterministic real case where possible). `BenchRun.view()` reports generic completed for a non-completed tuning outcome by existing convention; Lab shows specific `tuning.status`. Preserve or explicitly revise/document the division when adding idle terminal state. The UI already says stopping; the serialized server queue still makes pause/cancel wait for the current step batch. |
| V06 final gain/slot/inertia/disk/readiness | 0.2-rad OVERSPEED is honestly explained in Lab, bench set filtered, trace cap and gateway's 20-open-run limit exist, normal path archives, and Task 2 adds live lease. Total retained disk and cold bench review after restart remain open operational design issues. `RECOVERY_CHECKPOINT_MISSING` is intentional and durable trace/bundle remain. Gripper inertia is explicitly assumed; actual coupled inertia calibration belongs to gated R4.5. Busy preflight checks slot before validating a draft because readiness lacks draft input; actual admission validates before acquiring the engine. |
| V07pre tuned scenario/drive/axis provenance | Fixed in source `77b38f7`, tested in `lab-bench.test.ts`. Remaining general `INVALID_FIELD`, literal catalog mode/unit, stderr-only build failure, unconstrained `Number(component.revision)` and open-ended `Record<string>` are deferred source hygiene, not Task 2 bullets today. |
| V07a/last review render and controls | Lab `e352c5d` gives hidden panel stub, non-bench live tab fallback, control-mode disabling twin keyboard actions and run bar, working one-click close without restream, engineHolder excluding finished mobile, crypto fallback, recent comparable result, validated export, explicit status fallback and preserving accel limit during suggestion apply. Base e2e records real refusal, trapezoid, applied suggestion, and viewport/axe. Sticky head, no sticky Run row, descriptive SVG title and 390 px focus existed. Shortcut **dialog** still advertises disabled keys. Nested malformed catalog and general malformed tuning/trace remain Task 4. Paced twin should rerun due to liveRender re-entrancy change. |
| V07a recovery/history/layout | Task 4 covers target/session race, cross-tab writes, unread and open visibility, read-result Close preserving export, old result selection, pin mismatch close, unpaired orphan suppression, error visibility and wheel layout. At base `keep()` already retains `unread||open`, but lacks a beyond-eight regression and global pruning/selection still needs correction. Duplicate `control-unread` selector remains a small omission. `MUJOCO_CAPACITY` already explains the twin-finished-run close and provides one-click action. |
| V07a draft and duplicate revisions | Draft lineage after edits is assigned Task 4. M8 still open and omitted: `benchDraft` always emits `base.revision+1`, so independent exports can share ID/revision while digest differs. Existing note only covers profile-wide attribution replacement. State digest distinction in all translations or establish a separate explicit revision rule; never silently broaden provenance to other axes. |
| V07b image status, SHA sums, guards | Current CLD01 asserts cell report status and bench tuning status, prints but does not explicitly assert corresponding run-view status, and has no negative IMAGE_STALE guard test. New Task 5 evidence checksums cover the old log inventory omission without rewriting historical logs. CLD01 should assert arm64 image and native host independently, exact health/source pin identity, and metrics availability where claimed. |
| V07 final TUNE artifacts and same origin | Bench campaign 16/16 and bearer TUNE04 existed at prior tuple; new tuple requires fresh bench evidence, TUNE04 same-origin allow-origin plus public-host, and TUNE05. Base runner overrides e2e ports, but launcher test suites still expect defaults. Current plan explicitly owns those. WEB09/REG05 remain V16, with no change to the declared hardware or human gates. |

### Items to route explicitly in the closeout plan and handover

- Assign residual items that lack a concrete Task 1/2/4 checklist line to those tasks or a named later boundary, particularly Python boolean/per-mode validation, wheel versus arm runtime identity, independent inertia mapping, stable missing-kind reason, inaccurate readiness, duplicate revision/UI test ID, and IMAGE_STALE negative case.
- Keep cold bench read-only recovery distinct from the required live orphan lease. Any cold continuity claim needs durable read access and provenance, not simulated command replay. If retaining legacy semantics, describe preserved bundle/trace and explicit cold refusal. Also distinguish archived open-run metrics from total retained-disk policy.
- Bring the historical review's optional real-engine collision reproduction into Task 2 if stable. Keep the used fixture and observed tick in the evidence. V08 owns fault features; V16 owns full V08–V13 cloud/WEB/record aggregation.
- V16 needs a guard for bench/fault-record presence, digest and exact tuple, plus real Cloud Run supplemental binding, with parsed artifacts driving results. Task 6 mentions the first piece; add the R4-specific CLD03 verifier and old-R2a compatibility to the handover explicitly.
- Pin the verified runtime commit after source behavioral changes. If a tracked evidence summary must be a later docs-only commit, record its SHA separately from the image/export/run SHA so final identity claims remain reproducible. Prefer an immutable source revision and external evidence archive when the summary itself would otherwise change the commit being reported.

## Existing platform workflow after the first R4 backup

Compared hosted Source [44744496813 at f4bd7734](https://github.com/phamvuhoang/mekoniq/actions/runs/44744496813) with [44464613407 at 818df49a](https://github.com/phamvuhoang/mekoniq/actions/runs/44464613407). Normalized the ANSI/CI prefixes of both `gh run view … --log-failed` logs and compared the failed test and file identities. The sets are identical. The new verify job reached its unit suite after contracts:check, typecheck, lint and build. Unit then stopped the chained command, so the contracts, adapters and integration suites did not run there. Vitest reported 47 failed, 1114 passed and 48 skipped (131 files), versus 47 failed, 1014 passed and 48 skipped (119 files) for the prior run. Both reports include two separate suite-load errors. Python reported 1 failed, 393 passed and one skipped in each run and stopped before the arm-controller suite. The Lab R4 backup ref is `bc12f1afa44714a73264873c33d9cc3807ce4806`; Lab has no Actions workflow/run for that ref.

| Failures in both existing runs | Evidence and action |
|---|---|
| 39 `tests/unit/r3-native-readback.test.ts` plus load failure in `semantic-study.test.ts` | The hosted workflow creates `.venv` on Python 3.12. The R3 `engineering()` fixture (also called by the xArm cases) spawns hardcoded `.venv-irsim/bin/python`. The missing executable returns null status instead of zero at line 18. Semantic study shows that exact spawn `ENOENT`. Use the checked-in portable bootstrap with CPython 3.11. No ROS, Gazebo, LinuxCNC or native package installations are needed for these fixtures. |
| `mujoco-arm-ports.test.ts` shared-slot release test | Timeout 45,000 ms. The test uses `.venv-mujoco/bin/python` outside its sibling skip guard. Missing interpreter plus the intercepted `close()` can deadlock open cleanup before the test releases the close barrier. Provision the portable venv so this V07-relevant test executes. If it still hangs, the test should race the close barrier against a rejected open/close and always release the spy in teardown. |
| Three `owned-ci-ports.test.ts` cases | `valid nonconflicting structured inventory reaches only the owned start failure boundary` sees Linux EADDRINUSE on 127.0.0.1:57421 instead of `OWNED_SUPABASE_NOT_RUN`; `host bind refusal retains cleanup after a valid empty Docker inventory` hits the same occupied port; `status JSON is parsed from stdout even when the CLI warns on stderr` exits 1 instead of 0. Run these before Supabase. Integration now needs the owned-service receipt checked in `tests/support/wave02-db.ts`; mere `pnpm supabase:start` supplies no receipt. |
| `cell-campaign-actual-reader.test.ts` historical B06 dirty identity, `web-replay-capture.test.ts` suite load | `RETAINED_INPUTS_NOT_CONFIGURED`. These need the authentic retained qualification corpus and pinned catalog SHA as specified in `docs/operations/r2b-qualification.md`. Do not republish corpus bytes or substitute fixture identities merely to green this pipeline. |
| `r2b-suite-coverage.test.ts` closed selectors | `R2B_SELECTOR_MISSING:web-ui:tests/unit/world-view.test.ts`. The test requires a sibling `../lab` checkout. Lab is public and the first R4 backup includes the expected file. A pinned read-only sibling checkout can supply it. If using two `actions/checkout` steps, use paths `source` and `lab` with working directory/cache paths adjusted accordingly. |
| `cloud-run-script.test.ts` `--execute without gcloud on PATH stops with GCLOUD_NOT_FOUND` | Exits 1 instead of 3. The explicit `/usr/bin:/bin` assumes no gcloud and the script reaches the real-command branch when gcloud is present. Make that test pass an empty owned temporary directory as PATH. It already spawns absolute `/bin/bash`, and the missing-tool path needs only shell builtins. This preserves scope and avoids real Cloud Run attempts from a unit test. |
| `xarm6-fixture.test.ts` generator byte-reproduction | First mismatching file is `manifest.json`; the log does not show a byte diff. This generator is Node-only. Reproduce in a disposable Linux checkout with Node 24.22.2 and compare generated manifest and output-file hashes. The workflow's portable Python setup cannot fix it. |
| Python `test_frozen_native_manifest_matches_current_compiler` | Pytest reports `robotics/agent/test_engineering_native_parity.py`; the stack resolves to `robotics/simulation/tests/test_engineering_native_parity.py:152`. Input hash is unchanged. The output entry for `robots/amr-1.urdf` changes from recorded `48049a8170dc…` to generated `69a350c3f5d9…`, which changes the compiled manifest hash from `541648e62c68…` to `955763399546…`. Diagnose actual URDF bytes separately. A native solver or hardware installation has no bearing on this pure compiler test. |

Suggested CI environment repair for the existing workflow: install Python 3.11 before its existing Python 3.12 setup, then run `node scripts/bootstrap-portable-simulation.mjs irsim mujoco` using the checked-in wheel hashes. Leave the 3.12 `.venv` for the existing platform jobs. Run unit, contracts and adapters without Supabase, and replace direct Supabase startup/stop with `node scripts/owned-source-ci.mjs -- pnpm test:integration` for integration. Those adjustments address up to 44 of 49 Vitest failure entries on the evidence above. Installing both locked venvs requires about 446 MiB expanded on the developer host. The remaining five Vitest entries and one pytest failure need the specific fixtures or fixes above. R4 closeout should independently execute the shared-slot test and final focused V07 verification, report the pre-existing platform failures, and track legacy/corpus tasks for a full green pipeline. These workflow runs do not exercise the dedicated CLD02 test.

### Reproduced fixture differences and retained-input recovery

The two hosted fixture failures predate the V07 changes. The reproductions below generated fresh temporary outputs against the checked-in inputs and used read-only Source mounts.

- **Node xArm fixture.** `scripts/generate-xarm6-fixture.mjs` emitted byte-exact fixtures under Node 24.22.2 on Darwin arm64 and Linux arm64. Linux amd64 under OrbStack changed only `programs.json` and its `manifest.json` entry. `programs.json` shifted from 3,914 bytes / SHA `af99b362b9d22ca2bbb327deef6ab820ae6de9dc181643e6ffd61b85e1ce0e48` to 3,915 bytes / SHA `e275350cebd36a7bbf0b72c04e421f74df50a4aaaa705683ddb8eede6ebf218d`. The file's table digest also changed. Examples include pick J1 `-3.61465593187e-16` → `-4.89738798942e-16`, placeApproach J6 `3.46799277949e-9` → `3.46799309903e-9`, and pick position-error diagnostics `5.13971720445e-11` → `5.13973519187e-11`. Relative 12-significant-digit formatting preserves the differing near-zero bits, and `hashJson(table)` hashes the unnormalized rows before serialization. To reproduce on each host, run `pnpm exec tsx scripts/generate-xarm6-fixture.mjs --out "$fresh_tmp/arm"`, then compare generated `programs.json` and `manifest.json` to `robotics/simulation-mujoco/fixtures/xarm6-g2-v1/`. The cached-image probe bundled the generator with esbuild on the Mac and executed the same bundle and inputs on both Linux images. Hosted native x86 independently failed at the manifest byte assertion, but its generated bytes were unavailable in the job log. Follow-up fix: version the generator's numerical serialization, canonicalize solved rows on a fixed absolute grid after checking the existing IK tolerances, and hash/emit the same canonical rows. Regenerate the current fixture in the versioned follow-up with golden and capture compatibility checks.
- **Python native AMR compiler.** `compiler/models.py:quat_to_rpy` uses host `math.asin`, and `compiler/description.py:g` emits shortest exact round-trip doubles. Five joint-origin pitch fields differ by one floating-point step, ±`0.12000000000000001` versus ±`0.12`. The affected child links are `support-left/rod`, `support-right/rod` and `tray-{1,2,3}/plate`. No other URDF bytes differ. Darwin arm64 Python 3.11.15 and 3.13.3 emit the frozen `48049a8170dc1f516a201fa515d1cbe5f71943527afcfedb4519d53bd6dc36b8`. Linux arm64 and amd64 Python 3.11.2 both emit `69a350c3f5d9b1ab23ea8613294cc1d550f9fd3e073375c5b3e98d7f0de01400`, the exact hash in hosted native x86 Python 3.12. To reproduce from Source, run `PYTHONPATH=robotics/simulation PYTHONDONTWRITEBYTECODE=1 .venv-irsim/bin/python -B -m compiler.engineering_native --project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --out "$fresh_tmp/native"`, then compare `robots/amr-1.urdf` and `compiler-manifest.json` from two hosts. Follow-up fix: define deterministic RPY serialization confined to the native compiler output, bump its compiler format/version and regenerate current native fixture/digests. Preserve existing exact portable compiler output and historical records.

The local prepared regression catalog is `../evidence-archive/retained-corpus-copy/inputs.json` (about 39 MiB including files). The official reader verified all three entries with catalog SHA `30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f`. The tracked upstream catalog under `docs/implementation/web-lab-to-physical/retention/` has SHA `86f905eee94c022acaafa0c8800c57eb290e4b64628a024b300669ca215c7a15`. Local suite selectors from Source:

```sh
export MEKONIQ_RETAINED_INPUTS="$PWD/../evidence-archive/retained-corpus-copy/inputs.json"
export MEKONIQ_RETAINED_INPUTS_SHA256=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
```

The existing archive is a 15,106,869-byte previously published Git blob, accessible at ancestor `ca550d05ed2bfc7700796cef038169189d6465d8`. These commands reproduce the verified extraction using the historical archive/member index and the repository's safe extractor. This restoration was tested in a temporary directory from the existing blobs. A shallow CI checkout would first need the pinned ancestor available.

```sh
set -eu
corpus_dir="$(mktemp -d)"
ancestor=ca550d05ed2bfc7700796cef038169189d6465d8
raw=docs/implementation/evidence/web-lab-to-physical/final-recording/raw
name=historical-retained-inputs
git show "$ancestor:$raw/$name.tar.gz" > "$corpus_dir/$name.tar.gz"
git show "$ancestor:$raw/$name.members.json" > "$corpus_dir/$name.members.json"
test "$(shasum -a 256 "$corpus_dir/$name.tar.gz" | cut -d ' ' -f 1)" = 819cac824411b70eee35d59e34ff39e28e0f7db6cbbab2b535caa8faae3e7637
test "$(shasum -a 256 "$corpus_dir/$name.members.json" | cut -d ' ' -f 1)" = 63587a9497002fd278d7f45c520e71499f37f135711343f3d3eaacfc9c56f7ac
PYTHONDONTWRITEBYTECODE=1 python3 -B docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract \
  "$corpus_dir/$name.tar.gz" "$corpus_dir/$name.members.json" \
  "$corpus_dir/extracted" "$corpus_dir/extraction-receipt.json"
catalog_sha=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
node scripts/prepare-retained-inputs.mjs "$corpus_dir/extracted/inputs.json" "$catalog_sha" "$corpus_dir/prepared"
export MEKONIQ_RETAINED_INPUTS="$corpus_dir/prepared/inputs.json"
export MEKONIQ_RETAINED_INPUTS_SHA256="$catalog_sha"
```

For V07, use this authentic corpus in local full-source checks and keep the native CLD02 job focused on its image/tool-root gate. Track the two reproducibility fixes separately from the current R4 qualification and report the existing platform pipeline explicitly.

## Final exact runtime observation

Source34cf316b full local unit1250/1250 andcontracts/type/lint/build pass. DedicatednativeCLD02run44774073866 passes266/266,0skip onXeonPlatinum8573C/Microsoftvirtualization/nativeamd64. Genericplatformrun44774074167 retains exactly49failureentries vs93551be8,noneintroduced/removed;logs andcomparison in platform-34cf316b/. This does not convert genericCI or the DB-blockedsecuritysuite to a pass. Final tool-only3411b832 tests7/7; qualifiedruntime remains34.
