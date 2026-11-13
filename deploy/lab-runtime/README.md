# Lab runtime image (headless, mock + MuJoCo arm)

The Lab runtime as a container: Node 24.22.2, the bundled `runtime.mjs`, the schemas and the MuJoCo arm worker (`robotics/simulation-mujoco`) with its hash-locked Python 3.11 environment. Only the mock backends and `mujoco_arm` exist in it: no Webots, IR-SIM, LinkForge or algorithm tools. Nothing is deployed by this directory (D59, D60).

**A run inside this container is not evidence for G-MA1 or G-MA2 (D50).** It only proves that the image starts and completes `MJ-BV01` (G-RT2, RT05). Every plant parameter stays `not_calibrated`.

## Build

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev --platform linux/arm64          # this Mac
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev-amd64 --platform linux/amd64    # what Cloud Run runs
```

`build.sh` refuses a dirty source tree (any modified or untracked file), so the image is built from a clean working tree at HEAD and its `sourceCommit` (shown by `/lab/v2/health` and in the label `org.opencontainers.image.revision`) is a real commit. The runtime bundle is produced by `scripts/export-lab-runtime.mjs` from that tree, using the tree's installed `node_modules` (not a fresh frozen install); the MuJoCo tool root comes from `git archive HEAD` without its tests; the image is built from a temporary directory holding only those files, never from the repository. A from-scratch build from a fresh clone with a frozen install is the Cloud Build path of the deployment runbook, not this script. Rebuild after every source commit.

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
| `PORT` | Listening port; default 8080 (Cloud Run sets it). |
| `LAB_PUBLIC_HOST` | The `Host` the runtime must accept, as the proxy forwards it (for Cloud Run the service host without scheme, e.g. `svc-xyz.a.run.app`). Becomes `--public-host`; omitted when empty. |
| `LAB_ALLOW_ORIGIN` | The one browser origin allowed (e.g. `https://mekoniq-lab.vercel.app`). Becomes `--allow-origin`; omitted when empty. |

Fixed flags: `--bind 0.0.0.0 --data-dir /tmp/runs --mujoco-python /opt/venv-mujoco/bin/python --mujoco-worker /app/robotics/simulation-mujoco --mujoco-lock …/requirements.lock`, `MEKONIQ_LAB_MUJOCO=1`. Runs live in RAM and under `/tmp`; the rest of the file system can be read-only. The entrypoint `exec`s Node, so Node is PID 1 and a `SIGTERM` (`docker stop`, Cloud Run) closes the gateway and exits 0.

`/app` holds `runtime.mjs`, `schemas/`, `packages/contracts/schemas/` (a second copy: the worker derives this path from its root) and `robotics/simulation-mujoco/` (worker, fixture, lock, licenses).

## Test

```sh
LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:dev perl -e 'alarm 900; exec @ARGV' pnpm test:integration -- tests/integration/lab-runtime-container.test.ts
```

Skipped (never failed or passed) when `docker info` fails or `LAB_CONTAINER_IMAGE` is unset. It fails with `IMAGE_STALE` when the image's `sourceCommit` is not the repository HEAD. It publishes the port on `127.0.0.1` only, generates a random access key, runs with a read-only root and a tmpfs `/tmp`, pairs with the key, runs `MJ-BV01` through the public API, checks `served 2`, `not_calibrated`, an empty `docker diff`, a non-root user and a prompt clean stop, and leaves no container.

The runtime's own asset catalog resolves the project's robot asset by content hash, so a run created over the public API sweeps the arm against the docked robot; the test asserts `coverage.armSceneCollision`.

## Status and measurements (2026-11-13)

Base image: `node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9` (index; linux/arm64 and linux/amd64). Image size about 474 MB (arm64) and 457 MB (amd64) (the 178 MB venv holds the whole lock, including pytest). Builds take about 10-15 s with a warm layer cache, 40-60 s cold.

Each row names the commit its image was built from. Any later commit makes an earlier image stale (the test refuses it), so the rows are history, not a claim about HEAD: the gate run is repeated at the commit of a qualification record by the recorder, not by this README. Times are the wall time of the stepping loop divided by ticks, through the public HTTP API, in the container, seed 42, `armSceneCollision: true`, on this Mac (they vary by about 20 % from run to run with machine load).

| Built from | Architecture | Result | Wall time per tick |
|---|---|---|---|
| `939d8a2` | linux/arm64 (native, RT05) | passed: completed at tick 4800, served 2 | 1.77 ms (8.5 s) |
| `d6e7b8c`, `78f166c` | linux/arm64 | passed | 1.80-1.88 ms (this 1.88 ms run is not the final-HEAD run) |
| `69f1be5` (wheels only) | linux/arm64 | passed, `docker stop` 0.33 s | 2.15 ms (10.3 s, a busier machine) |
| `d6e7b8c`-`69f1be5` | linux/amd64 under emulation | not completed (see below), a partial failed run | 3.4-4.5 ms, over the 1600 ticks it ran |

The amd64 ms/tick covers only a partial, failed run (1600 of 4800 ticks, not the full scenario), so it is not comparable with the arm64 figures.

**The MuJoCo arm is unproven on Cloud Run until it has run on real amd64; the mock backends do not use the engine.**

## Real amd64 hardware has not been tested

Cloud Run runs linux/amd64; this Mac is arm64, so the amd64 image only ever ran under emulation here. The emulated run fails in the first cup pick, at tick 1585, with the engine reporting `BADQACC` (an invalid joint acceleration, i.e. a numerical blow-up) and resetting itself; the runtime stops the arm with `PLANT_UNSTABLE`. It failed identically in every emulated run, always at tick 1585 (the run stops at 1600). This matches the engine spike's observation (NaN in the contact grasp on MuJoCo 3.17.0 under emulation). The cause is unknown: it may be the emulation or the engine on x86-64, and it must be checked on real amd64 hardware before anyone relies on the Cloud Run image. In the amd64 image the tool root's 39 Python tests (`tests/` of `robotics/simulation-mujoco`, mounted read-only) all pass (2.2 s), as they do on arm64 (0.75 s), so the engine starts, compiles the cell and passes its unit tests under emulation; only the full-cell grasp fails.
