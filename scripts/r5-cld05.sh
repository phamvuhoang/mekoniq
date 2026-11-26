#!/usr/bin/env bash
# CLD05 (R5) on native Linux x86-64: build the linux/amd64 Lab runtime image from the clean source commit, check its interpreter against the MuJoCo lock, run the MuJoCo
# tool-root pytest suite inside it and the R5 container test (three options compile to the host's full digests; the S1 emergency stop at its tick) against it.
# Run from a full-history checkout (the source commit is path-based) whose HEAD is that source commit. Output: $RUNNER_TEMP/r5-cld05 (SHA256SUMS last).
# Import on the Mac: node scripts/record-r5-container.mjs --out <fresh dir> --cld05-dir <downloaded artifact>
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${RUNNER_TEMP:?set RUNNER_TEMP to an empty directory outside Source}"
out="$RUNNER_TEMP/r5-cld05"
mkdir -p "$out"
scratch=$(mktemp -d "$RUNNER_TEMP/r5-work.XXXXXXXX")
export TMPDIR="$scratch"
die() { echo "$*" | tee "$out/refusal.txt" >&2; exit 1; }
finish() {
  code=$?
  printf '%s\n' "$code" > "$out/qualification-exit.txt"
  (cd "$out" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
}
trap finish EXIT
# Keep the producer's own exit beside its log, also when tee succeeds.
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
head=$(git rev-parse HEAD)
sha=$(git log -1 --format=%H -- . ':(exclude)apps/lab')
run_url=local
if [[ ${GITHUB_ACTIONS:-} == true ]]; then
  run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT"
fi
{
  printf 'source=%s\nhead=%s\nrunner=%s\nrunner_arch=%s\nrunner_image=%s %s\n' "$sha" "$head" "${RUNNER_NAME:-local}" "${RUNNER_ARCH:-local}" "${ImageOS:-local}" "${ImageVersion:-local}"
  printf 'event=%s\nref=%s\nrun=%s\nrun_attempt=%s\n' "${GITHUB_EVENT_NAME:-local}" "${GITHUB_REF:-local}" "$run_url" "${GITHUB_RUN_ATTEMPT:-local}"
  uname -a
} | tee "$out/host.txt"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'NATIVE_ARCH_REQUIRED: expected Linux x86_64'
[[ $head == "$sha" ]] || die 'HEAD_IS_NOT_THE_SOURCE_COMMIT: push the branch at the source commit, not at a Lab pin commit'
if [[ ${GITHUB_ACTIONS:-} == true ]]; then
  [[ $RUNNER_ARCH == X64 && $GITHUB_SHA == "$head" ]] || die 'HOST_OR_SOURCE_MISMATCH'
fi
[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'DIRTY_SOURCE_TREE'
endpoint=$(bash scripts/r4-cld02-docker-host.sh) || die 'LOCAL_DOCKER_DAEMON_REQUIRED'
unset DOCKER_CONTEXT
export DOCKER_HOST="$endpoint"
daemon=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
{
  printf 'docker_endpoint=%s\ndaemon=%s\n' "$endpoint" "$daemon"
  docker version --format 'docker_server={{.Server.Version}} docker_client={{.Client.Version}}'
  node --version
  pnpm --version
} | tee -a "$out/host.txt"
[[ $daemon == linux/amd64 ]] || die 'NATIVE_ARCH_REQUIRED: expected linux/amd64 daemon'
[[ $(node -p 'process.versions.node') == "$(cat .node-version)" ]] || die 'NODE_VERSION_MISMATCH'
[[ pnpm@$(pnpm --version) == "$(node -p "require('./package.json').packageManager")" ]] || die 'PNPM_VERSION_MISMATCH'

record install perl -e 'alarm 600; exec @ARGV' pnpm install --frozen-lockfile
record export bash -c 'node scripts/export-lab-runtime.mjs "$1" >/dev/null' _ "$scratch/export"
cp "$scratch/export/manifest.json" "$out/runtime-manifest.json"
jq -e --arg sha "$sha" '.sourceCommit == $sha and .dirty == false' "$out/runtime-manifest.json" >/dev/null || die 'EXPORT_SOURCE_MISMATCH'
tag="mekoniq-lab-runtime:r5-cld05-$sha"
record build perl -e 'alarm 900; exec @ARGV' deploy/lab-runtime/build.sh "$tag" --platform linux/amd64
docker image inspect "$tag" | jq -e '.[0] | {Id,Os,Architecture,revision:.Config.Labels["org.opencontainers.image.revision"]}' > "$out/image.json"
jq -e --arg sha "$sha" '.Os == "linux" and .Architecture == "amd64" and .revision == $sha and (.Id | test("^sha256:[0-9a-f]{64}$"))' "$out/image.json" >/dev/null || die 'IMAGE_STALE_OR_WRONG_ARCH'
image=$(jq -r .Id "$out/image.json")
tool=robotics/simulation-mujoco
guest=(docker run --rm --pull=never --platform linux/amd64 --network none --read-only --tmpfs /tmp -e PYTHONDONTWRITEBYTECODE=1)
python=/opt/venv-mujoco/bin/python
# the interpreter of the image: Linux x86_64, CPython 3.11, every locked version installed (the R4 guest check, unchanged)
record guest "${guest[@]}" -i --entrypoint "$python" "$image" -B - guest < scripts/check-r4-cld02.py
# the tool root's tests are not in the image; they are mounted read-only and run against the installed /app tool root
mkdir "$out/pytest"
current=("${guest[@]}" --user "$(id -u):$(id -g)" -w "/app/$tool" -v "$root/$tool/tests:/app/$tool/tests:ro"
  -v "$root/scripts/native-sim:/app/scripts/native-sim:ro" -v "$root/robotics/algorithm:/app/robotics/algorithm:ro"
  -v "$root/docs/research:/app/docs/research:ro" -v "$out/pytest:/results:rw" -e PYTHONPATH=/app/scripts/native-sim
  -e R4_CLD02_SOURCE="$sha" -e R4_CLD02_IMAGE="$image" -e R4_CLD02_COLLECTION=/results/collection.json
  --entrypoint "$python" "$image" -B -m pytest -p r4_cld02_roster -p no:cacheprovider -q -ra)
pytest_status=0
record pytest perl -e 'alarm 900; exec @ARGV' "${current[@]}" --junitxml=/results/full.xml tests || pytest_status=$?
# the R5 container test against the same image, on this x86-64 host
mkdir "$out/container"
container_status=0
record container perl -e 'alarm 1800; exec @ARGV' env LAB_CONTAINER_IMAGE="$tag" LAB_CLD04_OUT="$out/container/cld05.json" \
  node node_modules/vitest/vitest.mjs run tests/integration/r5-container.test.ts --reporter=default --reporter=json --outputFile="$out/container/test.json" || container_status=$?
[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'CHECKOUT_CHANGED'
if (( pytest_status )); then exit "$pytest_status"; fi
if (( container_status )); then exit "$container_status"; fi
record receipt python3 -B scripts/check-r5-cld05.py receipt "$out/pytest" "$sha" "$image"
