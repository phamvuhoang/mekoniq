#!/usr/bin/env bash
# Run from a clean Source checkout on native Linux x86_64. Use an empty RUNNER_TEMP for a local run.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${RUNNER_TEMP:?set RUNNER_TEMP to an empty directory outside Source}"
scratch=$(mktemp -d "$RUNNER_TEMP/r4-work.XXXXXXXX")
export TMPDIR="$scratch"
out="$RUNNER_TEMP/r4-cld02"
mkdir -p "$out"
mkdir "$out/baseline"
tool=robotics/simulation-mujoco
worker=a93ae08d95e07e4d0e633cb01aaf848603a0fc51
corpus=edb11dd990958fbea5250d1d8e6b932b5a39bf5c
sha=$(git rev-parse HEAD)
die() { echo "$*" | tee "$out/refusal.txt" >&2; exit 1; }
finish() {
  code=$?
  printf '%s\n' "$code" > "$out/qualification-exit.txt"
  (cd "$out" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
}
trap finish EXIT
# Keep the producer's exit separately, including on failure through tee.
record() {
  local name=$1 results
  shift
  set +e
  "$@" 2>&1 | tee "$out/$name.log"
  results=("${PIPESTATUS[@]}")
  set -e
  printf '%s\n' "${results[0]}" > "$out/$name-exit.txt"
  if [[ ${results[0]} != 0 ]]; then return "${results[0]}"; fi
  return "${results[1]}"
}
run_url=local
if [[ ${GITHUB_ACTIONS:-} == true ]]; then
  run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT"
fi
{
  printf 'source=%s\nworker=%s\ncorpus=%s\nrunner=%s\nrunner_arch=%s\nrunner_image=%s %s\n' \
    "$sha" "$worker" "$corpus" "${RUNNER_NAME:-local}" "${RUNNER_ARCH:-local}" "${ImageOS:-local}" "${ImageVersion:-local}"
  printf 'event=%s\nref=%s\nrun=%s\nrun_attempt=%s\n' "${GITHUB_EVENT_NAME:-local}" "${GITHUB_REF:-local}" \
    "$run_url" "${GITHUB_RUN_ATTEMPT:-local}"
  uname -a
} | tee "$out/host.txt"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die "NATIVE_ARCH_REQUIRED: expected Linux x86_64"
if [[ ${GITHUB_ACTIONS:-} == true ]]; then
  [[ $RUNNER_ARCH == X64 && $GITHUB_SHA == "$sha" ]] || die 'HOST_OR_SOURCE_MISMATCH'
fi
[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'DIRTY_SOURCE_TREE'
endpoint=$(bash scripts/r4-cld02-docker-host.sh) || die 'LOCAL_DOCKER_DAEMON_REQUIRED'
# Bind every client, including the child build script, to the socket recorded in host.txt.
unset DOCKER_CONTEXT
export DOCKER_HOST="$endpoint"
daemon=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
{
  printf 'docker_endpoint=%s\ndaemon=%s\n' "$endpoint" "$daemon"
  docker version --format 'docker_server={{.Server.Version}} docker_client={{.Client.Version}}'
  lscpu
  node --version
  pnpm --version
} | tee -a "$out/host.txt"
[[ $daemon == linux/amd64 ]] || die 'NATIVE_ARCH_REQUIRED: expected linux/amd64 daemon'
[[ $(node -p 'process.versions.node') == "$(cat .node-version)" ]] || die 'NODE_VERSION_MISMATCH'
[[ pnpm@$(pnpm --version) == "$(node -p "require('./package.json').packageManager")" ]] || die 'PNPM_VERSION_MISMATCH'
for ref in "$worker" "$corpus"; do
  if ! git cat-file -e "$ref^{commit}" 2>/dev/null; then git fetch --no-tags --depth=1 origin "$ref"; fi
done
mkdir "$scratch/historical"
git archive "$worker" "$tool" packages/contracts/schemas | tar -xf - -C "$scratch/historical"
git archive "$corpus" "$tool/tests/test_worker_protocol_regression.py" "$tool/tests/data/worker-protocol-darwin-arm64" | tar -xf - -C "$scratch/historical"
git ls-tree "$worker" "$tool" packages/contracts/schemas > "$out/baseline-trees.txt"
git ls-tree "$corpus" "$tool/tests/test_worker_protocol_regression.py" "$tool/tests/data/worker-protocol-darwin-arm64" >> "$out/baseline-trees.txt"

record install perl -e 'alarm 600; exec @ARGV' pnpm install --frozen-lockfile
# The exporter prints its entire manifest, whose authoritative bytes are saved separately.
record export bash -c 'node scripts/export-lab-runtime.mjs "$1" >/dev/null' _ "$scratch/export"
cp "$scratch/export/manifest.json" "$out/runtime-manifest.json"
jq -e --arg sha "$sha" '.sourceCommit == $sha and .dirty == false' "$out/runtime-manifest.json" >/dev/null || die 'EXPORT_SOURCE_MISMATCH'
tag="mekoniq-lab-runtime:cld02-$sha"
record build perl -e 'alarm 900; exec @ARGV' deploy/lab-runtime/build.sh "$tag" --platform linux/amd64
docker image inspect "$tag" | jq -e '.[0] | {Id,Os,Architecture,revision:.Config.Labels["org.opencontainers.image.revision"]}' > "$out/image.json"
jq -e --arg sha "$sha" '.Os == "linux" and .Architecture == "amd64" and .revision == $sha and (.Id | test("^sha256:[0-9a-f]{64}$"))' "$out/image.json" >/dev/null || die 'IMAGE_STALE_OR_WRONG_ARCH'
image=$(jq -r .Id "$out/image.json")
guest=(docker run --rm --pull=never --platform linux/amd64 --network none --read-only --tmpfs /tmp -e PYTHONDONTWRITEBYTECODE=1)
python=/opt/venv-mujoco/bin/python
record guest "${guest[@]}" -i --entrypoint "$python" "$image" -B - guest < scripts/check-r4-cld02.py
"${guest[@]}" --entrypoint sha256sum "$image" /app/runtime.mjs "/app/$tool/requirements.lock" > "$out/image-file-hashes.txt"
runtime_hash=$(jq -r .artifactSha256 "$out/runtime-manifest.json")
lock_hash=$(sha256sum "$tool/requirements.lock" | cut -d' ' -f1)
printf '%s  /app/runtime.mjs\n%s  /app/%s/requirements.lock\n' "$runtime_hash" "$lock_hash" "$tool" | diff -u - "$out/image-file-hashes.txt"
cmp "$tool/requirements.lock" "$scratch/historical/$tool/requirements.lock"
# Only this subprocess can write baseline bytes. Its worker, probe, requests, fixtures and schemas are the archived sources.
capture_status=0
record capture perl -e 'alarm 180; exec @ARGV' "${guest[@]}" --user "$(id -u):$(id -g)" \
  -v "$scratch/historical:/historical:ro" -v "$root/scripts/capture-r4-cld02-baselines.py:/capture.py:ro" -v "$out/baseline:/captured:rw" \
  --entrypoint "$python" "$image" -B /capture.py "/historical/$tool" /captured || capture_status=$?

# Run the installed /app tool root with only the omitted test sources and auxiliary test inputs supplied by read-only Source mounts.
# Pytest writes its XML to stdout-independent files inside a dedicated mount. The tested process gets no writable baseline.
mkdir "$out/pytest"
current=("${guest[@]}" --user "$(id -u):$(id -g)" -w "/app/$tool" -v "$root/$tool/tests:/app/$tool/tests:ro"
  -v "$root/scripts/native-sim:/app/scripts/native-sim:ro" -v "$root/robotics/algorithm:/app/robotics/algorithm:ro"
  -v "$root/docs/research:/app/docs/research:ro" -v "$out/baseline:/baseline:ro" -v "$out/pytest:/results:rw"
  -e MUJOCO_PROTOCOL_RESPONSE_DIR=/baseline -e MUJOCO_LEGACY_DIGEST_FILE=/baseline/legacy-digests.json
  --entrypoint "$python" "$image" -B -m pytest -p no:cacheprovider -q -ra)
pytest_status=0
record pytest perl -e 'alarm 900; exec @ARGV' "${current[@]}" --junitxml=/results/full.xml tests || pytest_status=$?
[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'CHECKOUT_CHANGED'
if (( capture_status )); then exit "$capture_status"; fi
if (( pytest_status )); then exit "$pytest_status"; fi
# A skipped comparison or empty suite cannot close the native gate.
record receipt python3 -B scripts/check-r4-cld02.py receipt "$out/pytest/full.xml"
