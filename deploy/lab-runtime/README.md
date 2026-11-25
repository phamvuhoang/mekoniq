# Lab runtime image (persistent simulation runtime)

Node 24.22.2, the bundled runtime and schema closure, hash-locked Python 3.11 MuJoCo worker, arm/mobile/cell fixtures and the portable Serve catalog. Actual available providers are mock AMR/arm/coffee and MuJoCo arm/mobile/single-world cell. Native engineering profiles are explicitly blocked; Webots/IR-SIM/ROS/hardware are not installed or advertised as executable. Every parameter remains `not_calibrated`.

Use [the persistent single-host profile](single-host/README.md) and [operations runbook](../../docs/operations/lab-runtime-single-host.md) for TLS, exact Host/Origin, one writer, lease, recovery, key rotation and export. These files do not deploy anything. Container execution is only evidence for the architecture actually run, not native hardware/amd64 qualification.

## Build

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev --platform linux/arm64          # this Mac
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev-amd64 --platform linux/amd64    # what Cloud Run runs
```

`build.sh` refuses a dirty source tree (any modified or untracked file outside `apps/lab`), so the image is built from a clean working tree at HEAD and its `sourceCommit` (the last commit touching a path outside `apps/lab`) (shown by `/lab/v2/health` and in the label `org.opencontainers.image.revision`) is a real commit. The runtime bundle is produced by `scripts/export-lab-runtime.mjs` from that tree, using the tree's installed `node_modules` (not a fresh frozen install); the MuJoCo tool root comes from `git archive HEAD` without its tests; the image is built from a temporary directory holding only those files, never from the repository. A from-scratch build from a fresh clone with a frozen install is the Cloud Build path of the deployment runbook, not this script. Rebuild after every source commit.

The Python environment `/opt/venv-mujoco` is installed from `requirements.lock` with `--require-hashes` at build time; nothing is installed at run time. The base is `node:24.22.2-bookworm-slim` (Debian 12, Python 3.11.2), pinned by tag and by index digest in the `Dockerfile`. The container runs as `node` (uid 1000), `PYTHONDONTWRITEBYTECODE=1`, no `__pycache__` in the tool root, no secret or `.env`, no git history.

## Run

```sh
docker run --rm --read-only --tmpfs /tmp -p 127.0.0.1:8080:8080 \
  -e MEKONIQ_LAB_ACCESS_KEY -e LAB_PUBLIC_HOST=127.0.0.1:8080 -e LAB_ALLOW_ORIGIN=http://127.0.0.1:4175 \
  mekoniq-lab-runtime:dev            # MEKONIQ_LAB_ACCESS_KEY: >= 32 characters, exported in the calling shell, never on the command line
```

| Variable | Meaning |
|---|---|
| `MEKONIQ_LAB_ACCESS_KEY` | Required (>= 32 characters). The only credential: pair with `POST /lab/v2/sessions {"token": key}`, then `Authorization: Bearer`. Read by the runtime itself. |
| `LAB_DATA_DIR` | Writable run directory; image default `/tmp/runs`, persistent profile `/data/runs`. Exclusive process lease acquired before providers start. |
| `PORT` | Listening port; default 8080 (Cloud Run sets it). |
| `LAB_PUBLIC_HOST` | The `Host` the runtime must accept, as the proxy forwards it (for Cloud Run the service host without scheme, e.g. `svc-xyz.a.run.app`). Becomes `--public-host`; omitted when empty. |
| `LAB_ALLOW_ORIGIN` | The one browser origin allowed (e.g. `https://mekoniq-lab.vercel.app`). Becomes `--allow-origin`; omitted when empty. |

Flags: `--bind 0.0.0.0 --data-dir "$LAB_DATA_DIR" --engineering-catalog /app/catalog --engineering-portable-only --mujoco-python /opt/venv-mujoco/bin/python --mujoco-worker /app/robotics/simulation-mujoco --mujoco-lock …/requirements.lock`, `MEKONIQ_LAB_MUJOCO=1`. The default remains ephemeral under `/tmp`; mount the persistent profile named volume to retain committed run data. The remaining filesystem is read-only. The entrypoint `exec`s Node, so Node is PID 1 and a `SIGTERM` (`docker stop`, Cloud Run) closes the gateway and exits 0.

`/app` holds `runtime.mjs`, `schemas/`, `packages/contracts/schemas/` (a second copy: the worker derives this path from its root) and `robotics/simulation-mujoco/` (worker, fixture, lock, licenses).

## Test

```sh
LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:dev perl -e 'alarm 900; exec @ARGV' pnpm test:integration -- tests/integration/lab-runtime-container.test.ts
```

Not run when `docker info` fails or `LAB_CONTAINER_IMAGE` is unset. WEB05 additionally exercises the compiled mobile profile, completed cell, competing container, persistent volume crash/reclaim and finished replay. It fails with `IMAGE_STALE` when the image's `sourceCommit` is not the repository HEAD. It publishes the port on `127.0.0.1` only, generates a random access key, runs with a read-only root and a tmpfs `/tmp`, pairs with the key, runs `MJ-BV01` through the public API, checks `served 2`, `not_calibrated`, an empty `docker diff`, a non-root user and a prompt clean stop, and leaves no container.

The runtime's own asset catalog resolves the project's robot asset by content hash, so a run created over the public API sweeps the arm against the docked robot; the test asserts `coverage.armSceneCollision`.

## Historical R2a measurements (2026-11-13; not B09 image evidence)

Base image: `node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9` (index; linux/arm64 and linux/amd64). Image size about 474 MB (arm64) and 457 MB (amd64) (the 178 MB venv holds the whole lock, including pytest). Builds take about 10-15 s with a warm layer cache, 40-60 s cold.

Each row names the commit its image was built from. Any later commit makes an earlier image stale (the test refuses it), so the rows are history, not a claim about HEAD. For a qualification record, the recorder (`scripts/record-sim-extension.mjs --release r2a`) builds the image for the recording machine's architecture from the recorded commit with `build.sh` and runs the container test against it (RT05); without Docker it records that suite as not run. None of the rows below is such a recorded run. Times are the wall time of the stepping loop divided by ticks, through the public HTTP API, in the container, seed 42, `armSceneCollision: true`, on this Mac (they vary by about 20 % from run to run with machine load).

| Built from | Architecture | Result | Wall time per tick |
|---|---|---|---|
| `939d8a2` | linux/arm64 (Mac Linux VM, RT05) | passed: completed at tick 4800, served 2 | 1.77 ms (8.5 s) |
| `d6e7b8c`, `78f166c` | linux/arm64 | passed | 1.80-1.88 ms (this 1.88 ms run is not the final-HEAD run) |
| `69f1be5` (wheels only) | linux/arm64 | passed, `docker stop` 0.33 s | 2.15 ms (10.3 s, a busier machine) |
| `d6e7b8c`-`69f1be5` | linux/amd64 under emulation | not completed (see below), a partial failed run | 3.4-4.5 ms, over the 1600 ticks it ran |

The amd64 ms/tick covers only a partial, failed run (1600 of 4800 ticks, not the full scenario), so it is not comparable with the arm64 figures.

**The MuJoCo arm is unproven on Cloud Run until it has run on real amd64; the mock backends do not use the engine.**

## Real amd64 hardware has not been tested

Cloud Run runs linux/amd64; this Mac is arm64, so the amd64 image only ever ran under emulation here. The emulated run fails in the first cup pick, at tick 1585, with the engine reporting `BADQACC` (an invalid joint acceleration, i.e. a numerical blow-up) and resetting itself; the runtime stops the arm with `PLANT_UNSTABLE`. It failed identically in every emulated run, always at tick 1585 (the run stops at 1600). This matches the engine spike's observation (NaN in the contact grasp on MuJoCo 3.17.0 under emulation). The cause is unknown: it may be the emulation or the engine on x86-64, and it must be checked on real amd64 hardware before anyone relies on the Cloud Run image. In the amd64 image the tool root's 39 Python tests (`tests/` of `robotics/simulation-mujoco`, mounted read-only) all pass (2.2 s), as they do on arm64 (0.75 s), so the engine starts, compiles the cell and passes its unit tests under emulation; only the full-cell grasp fails.
