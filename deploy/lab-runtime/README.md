# Lab runtime image (headless, mock + MuJoCo arm)

The Lab runtime as a container: Node 24.22.2, the bundled `runtime.mjs`, the schemas and the MuJoCo arm worker (`robotics/simulation-mujoco`) with its hash-locked Python 3.11 environment. Only the mock backends and `mujoco_arm` exist in it: no Webots, IR-SIM, LinkForge or algorithm tools. Nothing is deployed by this directory (D59, D60).

**A run inside this container is not evidence for G-MA1 or G-MA2 (D50).** It only proves that the image starts and completes `MJ-BV01` (G-RT2, RT05). Every plant parameter stays `not_calibrated`.

## Build

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev --platform linux/arm64          # this Mac
deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev-amd64 --platform linux/amd64    # what Cloud Run runs
```

`build.sh` refuses a dirty source tree (the image's `sourceCommit`, shown by `/lab/v2/health` and in the label `org.opencontainers.image.revision`, is a real commit), exports the committed HEAD with `scripts/export-lab-runtime.mjs --clean-checkout`, adds the tool root from `git archive HEAD` without its tests, and builds from that temporary directory only. The repository is never the build context. Rebuild after every source commit.

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

The robot asset `service-robot-asset@1` cannot be supplied through the public API (the gateway resolves assets only for engineering bundles), so ARM03 in a container run has no docked robot, as noted in M07.
