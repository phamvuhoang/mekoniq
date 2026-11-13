# Headless Lab runtime: mock backends + the MuJoCo arm (D59). Built only by build.sh, from a dedicated context assembled from a clean working tree at HEAD (build.sh refuses any modified or untracked file), never from the repository.
# Base: Node 24.22.2 on Debian 12 (bookworm), which provides Python 3.11.2. Tag and index digest (multi-arch) are both pinned.
ARG BASE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${BASE} AS venv
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY robotics/simulation-mujoco/requirements.lock /tmp/requirements.lock
# every package from the lock, by hash, at build time; nothing is installed when the container runs
RUN python3 -m venv /opt/venv-mujoco && /opt/venv-mujoco/bin/pip install --no-cache-dir --no-compile --only-binary=:all: --require-hashes --no-deps -r /tmp/requirements.lock

FROM ${BASE}
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.title="mekoniq-lab-runtime" org.opencontainers.image.revision="${SOURCE_COMMIT}"
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY --from=venv /opt/venv-mujoco /opt/venv-mujoco
COPY runtime.mjs /app/runtime.mjs
# the schemas twice: the exporter's layout (/app/schemas) and the one the worker derives from its root (<root>/../../packages/contracts/schemas)
COPY schemas /app/schemas
COPY schemas /app/packages/contracts/schemas
COPY robotics/simulation-mujoco /app/robotics/simulation-mujoco
ENV MEKONIQ_LAB_MUJOCO=1 PYTHONDONTWRITEBYTECODE=1 NODE_ENV=production
USER node
EXPOSE 8080
# PORT is read by the runtime (Cloud Run sets it; 8080 otherwise), the access key by the runtime from MEKONIQ_LAB_ACCESS_KEY. The one line of shell only adds a flag
# for a non-empty LAB_PUBLIC_HOST / LAB_ALLOW_ORIGIN (quoted, no eval) and execs node so that it is PID 1 and receives SIGTERM.
ENV PORT=8080
ENTRYPOINT ["/bin/sh","-c","exec node /app/runtime.mjs --bind 0.0.0.0 --data-dir /tmp/runs --mujoco-python /opt/venv-mujoco/bin/python --mujoco-worker /app/robotics/simulation-mujoco --mujoco-lock /app/robotics/simulation-mujoco/requirements.lock ${LAB_PUBLIC_HOST:+--public-host \"$LAB_PUBLIC_HOST\"} ${LAB_ALLOW_ORIGIN:+--allow-origin \"$LAB_ALLOW_ORIGIN\"}","lab-runtime"]
