# Task 5a qualification preparation

Source branch `r4/virtual-commissioning` started at `8815aa987ca1856b86b07b26995c155e5c969895`. Three clean commits were handed to the coordinator separately.

| Commit | Scope |
| --- | --- |
| `fb2b8db52b79836bad26d4376fe9d37de9860ec7` | CLD01 native Darwin and Docker/image guards, runtime identity against a new clean export, terminal statuses, measured metrics and a second running bench advancing a tick. |
| `6fdf1c51ab6b9d1a9a730ed9fe5d0c2001c886bd` | Branch-only production image workflow, historical reference capture, full worker suite and evidence collection. |
| `94729d61befeb8260740029f78feac6c724bde06` | Review round 1. Explicit Python qualification failures, optimized-worker refusal, verified local Docker socket binding and committed guard regressions. |

## CLD01

The test inspects the host OS and machine, daemon platform, OCI image OS, architecture, config ID and revision before starting the immutable image ID. A clean export provides the expected source SHA, schema hash and runtime artifact SHA. The running container must serve the same commit/schema and contain the same runtime bundle bytes. The test checks the cell's completed view, report and two deliveries. The first wheel bench must complete at tick 500 with completed report/tuning, valid trace, eight suggestions, and available finite RMS error, peak torque and saturation ratio with real sample counts. A second, distinct bench starts and advances while the first remains open.

RED used the existing embedded-commit-only behavior behind a testable boundary. Eight negative cases failed because the prior guard accepted five platform mismatches, a stale OCI revision, wrong embedded schema and wrong runtime bundle bytes. Two cases already passed. GREEN passed all 10 unit cases. Source typecheck and focused ESLint exited zero.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/r4-container-identity.test.ts
perl -e 'alarm 160; exec @ARGV' pnpm typecheck
perl -e 'alarm 90; exec @ARGV' pnpm exec eslint tests/support/r4-container-identity.ts tests/unit/r4-container-identity.test.ts tests/integration/lab-runtime-container-r4.test.ts
```

Final-tuple CLD01 remains `not_run` in Task 5a. On the Mac the coordinator can use:

```sh
image="mekoniq-lab-runtime:r4-$(git rev-parse --short=12 HEAD)-arm64"
perl -e 'alarm 900; exec @ARGV' deploy/lab-runtime/build.sh "$image" --platform linux/arm64
LAB_CONTAINER_IMAGE="$image" perl -e 'alarm 1800; exec @ARGV' pnpm test:integration -- tests/integration/lab-runtime-container-r4.test.ts
```

## CLD02

Workflow `.github/workflows/r4-cld02.yml` triggers only on a push to `r4/virtual-commissioning` and uses hosted `ubuntu-24.04` with contents read permission. It checks the actual Linux/x86_64 kernel, X64 runner, local Docker endpoint, linux/amd64 daemon, checked-out event SHA, clean source, image linux/amd64 platform and OCI revision. The job captures the exported manifest, builds with `deploy/lab-runtime/build.sh`, then verifies the runtime bundle and requirements bytes inside that config ID. The guest must be Linux/x86_64 and CPython 3.11. All installed versions from the image lock are checked and recorded. Qualification uses the image interpreter, read-only root, read-only source test inputs, tmpfs and bytecode suppression. Current worker and schemas come from the image itself.

The shallow checkout fetches two immutable commits by full SHA if needed. The current qualification driver calls historical functions directly from a read-only archive. Worker, probe, fixtures and schemas come from `a93ae08d95e07e4d0e633cb01aaf848603a0fc51`. Original protocol harness, requests and bundles come from `edb11dd990958fbea5250d1d8e6b932b5a39bf5c`. The six observations are three 43-response NDJSON streams (create, start, 40 steps, getState), and the pos/vel trace and digest for mobile (300 ticks), arm (300) and world (500). The original protocol helper normalizes only bootId. The current suite receives those results read-only. The original fixed literal digests remain checked on arm64. A native x86 result would qualify the same-host legacy comparison only. Darwin's specific original literals are architecture scoped.

The script attempts the complete worker suite even if individual captures fail, records the capture/pytest exit codes, and fails closed on either. A green pytest exit also needs the three protocol nodes and the legacy node present in XML with zero skipped tests across the full suite.

### Local validation

The deliberately wrong digest file was initially ignored by the original Darwin test (exit 0). With the override installed, replacing the mobile digest with 64 zeroes produces a failed equality assertion (exit 1). A null override was also observed to pass in the first implementation, then rejected after correction. An authentic capture produced 4/4 passing comparisons and the complete Darwin suite passed 266 tests with zero skips in 27.42 s. All three Darwin capture files were byte-equal to the original committed golden streams.

From Source, with the pinned Node on PATH:

```sh
export PYTHONDONTWRITEBYTECODE=1
work=$(mktemp -d)
mkdir "$work/pre" "$work/out"
tool=robotics/simulation-mujoco
git archive a93ae08d95e07e4d0e633cb01aaf848603a0fc51 "$tool" packages/contracts/schemas | tar -xf - -C "$work/pre"
git archive edb11dd990958fbea5250d1d8e6b932b5a39bf5c "$tool/tests/test_worker_protocol_regression.py" "$tool/tests/data/worker-protocol-darwin-arm64" | tar -xf - -C "$work/pre"
perl -e 'alarm 120; exec @ARGV' .venv-mujoco/bin/python -B scripts/capture-r4-cld02-baselines.py "$work/pre/$tool" "$work/out"
export MUJOCO_PROTOCOL_RESPONSE_DIR="$work/out" MUJOCO_LEGACY_DIGEST_FILE="$work/out/legacy-digests.json"
perl -e 'alarm 120; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider -q -ra "$tool/tests/test_worker_protocol_regression.py" "$tool/tests/test_drive_engine.py::test_the_legacy_path_gives_the_three_recorded_digests"
perl -e 'alarm 240; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider -q -ra --junitxml="$work/full.xml" "$tool/tests"
for name in arm-no-drive mobile-cil mobile-no-drive; do cmp "$work/out/$name.ndjson" "$tool/tests/data/worker-protocol-darwin-arm64/$name.ndjson"; done
```

`bash -n scripts/r4-cld02.sh`, Ruby Psych YAML parse, actionlint v1.7.7 on the workflow, and `git diff --check` all passed. Actionlint was built in a temporary GOBIN. The job's actual receipt check accepted the 266-case XML and rejected independently mutated XML containing a skip or missing the mobile CIL node. An actual subprocess exiting 37 through the log pipeline returned 37 and wrote 37 in its exit receipt. Running the wrapper on the real Darwin arm64 host refused before Docker/build, recorded exit 1 and produced a valid checksum inventory. No native x86 execution or final image run was performed in Task 5a.

### Native reproduction and artifacts

Use a clean source checkout with the repository Node/pnpm versions and a native Linux x86-64 host with local amd64 Docker, Git, Perl, jq, GNU coreutils and Python 3. The job installs frozen Node dependencies and fetches the historical objects if unavailable.

```sh
export RUNNER_TEMP="$(mktemp -d)"
scripts/r4-cld02.sh
(cd "$RUNNER_TEMP/r4-cld02" && sha256sum -c SHA256SUMS)
```

Hosted artifact `r4-cld02-<sha>-<run_id>-<attempt>` uploads on success or failure from `$RUNNER_TEMP/r4-cld02/`. It includes `run.txt`, `host.txt`, `baseline-trees.txt`, `runtime-manifest.json`, `image.json`, `image-file-hashes.txt`, `job.log`, per-stage logs/exit files, `baseline/*.ndjson`, `baseline/legacy-*.npz`, `baseline/legacy-digests.json`, `pytest/full.xml`, `qualification-exit.txt` and `SHA256SUMS` as the stages produce them. Original Git archives and full runtime export remain in the runner scratch directory. On setup failure the artifact retains the available identity and hashes. Review the job URL, exit receipts, XML, runtime manifest, image config and SHA256SUMS before using results for a qualification record. Local Darwin scratch for this check was `/tmp/r4-5a-baseline-8IwUhi`.

The commits change tests, test documentation and CI tooling. They leave the exported runtime implementation, schemas, portable files and platform workflow untouched. Root owns the reviewed branch push, native artifact readback and final qualified tuple.

## Review round 1

The optimized receipt reader previously accepted both a missing native comparison and a skipped test with exit 0. The same optimization stripped the guest architecture/version assertions, allowing the Darwin local interpreter to proceed all the way to the image-only requirements file. A local DOCKER_HOST could hide a remote DOCKER_CONTEXT and the prior selector accepted a relative Unix endpoint. The committed focused tests initially produced 5 failures and 6 passes.

The receipt now reports the names of missing or skipped cases through explicit nonzero exits. The separate image checks also use explicit exits for guest architecture, implementation, interpreter version and each installed locked package version. The guest refuses an optimized interpreter so the immutable historical worker's protocol assertions and the current suite execute as authored. The local reader may run under optimization. Its actual output and status now land in `receipt.log` and `receipt-exit.txt`. Conflicting Docker selectors are refused. A context or direct host must resolve to an absolute Unix endpoint, after which the parent clears DOCKER_CONTEXT and exports the verified DOCKER_HOST for every Docker client, including the image build.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/r4-cld02-guards.test.ts tests/unit/r4-container-identity.test.ts
perl -e 'alarm 90; exec @ARGV' pnpm exec eslint tests/unit/r4-cld02-guards.test.ts
perl -e 'alarm 160; exec @ARGV' pnpm typecheck
bash -n scripts/r4-cld02.sh
bash -n scripts/r4-cld02-docker-host.sh
actionlint .github/workflows/r4-cld02.yml
PYTHONDONTWRITEBYTECODE=1 PYTHONOPTIMIZE=1 python3 -B scripts/check-r4-cld02.py receipt /tmp/r4-5a-baseline-8IwUhi/full.xml
```

The final focused run passed all 11 CLD02 tests and all 10 CLD01 identity tests. The Docker selection regressions use an isolated read-only context metadata double and no daemon. ESLint, typecheck, Bash syntax, actionlint v1.7.7 and the real 266-case receipt check passed. The round only changes admission tooling and its tests. The native workflow and final-image CLD01 remain pending.

### CLD01 bundle identity across the container boundary

On the native Mac build path, `deploy/lab-runtime/build.sh:19` runs the clean-tree exporter using the host Node and installed dependencies. Line 22 copies that export's exact runtime.mjs to the build context and `deploy/lab-runtime/Dockerfile:19` copies it into `/app/runtime.mjs`. The integration test runs that same exporter on the same host, then checks `sha256sum /app/runtime.mjs` inside the running Linux arm64 container. Linux does not compile the bundle. An amd64 runner independently uses its own host export/production image pair.

Two fresh Darwin arm64 exports from clean `94729d61befeb8260740029f78feac6c724bde06` with Node v24.22.2 produced byte-identical `runtime.mjs` and `manifest.json` at independent output paths. Both runtime SHA-256 values and the recorded artifact hash were `e3f9c161d33d0d7dfe846e55e30a3691d580695625dd845f659454a6e6ee9b81`. The schema hash was `8a1f111d006484d099f4c96d8c7d9386143998dab11ee20b83c5ba730cd2bbfd` and both manifests recorded `dirty:false`. The exact production image copy and health are checked when the coordinator executes CLD01 on the final source revision. Cross-host bundle reproducibility was outside this check.

```sh
export_check=$(mktemp -d)
perl -e 'alarm 150; exec @ARGV' node scripts/export-lab-runtime.mjs "$export_check/build/export" > "$export_check/build.json"
perl -e 'alarm 150; exec @ARGV' node scripts/export-lab-runtime.mjs "$export_check/cld01-check" > "$export_check/check.json"
cmp "$export_check/build/export/runtime.mjs" "$export_check/cld01-check/runtime.mjs"
cmp "$export_check/build/export/manifest.json" "$export_check/cld01-check/manifest.json"
shasum -a 256 "$export_check/build/export/runtime.mjs" "$export_check/cld01-check/runtime.mjs"
```
