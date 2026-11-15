#!/bin/sh
# deploy/lab-runtime/build.sh <tag> [--platform linux/amd64|linux/arm64]
# Builds the headless Lab runtime image in a dedicated context. Refuses a dirty tree (no modified or untracked file), so the tracked content of the working tree equals HEAD.
# runtime.mjs is bundled by scripts/export-lab-runtime.mjs from that clean tree, with the tree's installed node_modules (not a fresh frozen install); the MuJoCo tool root
# comes from `git archive HEAD`. A from-scratch build from a fresh clone with a frozen install is the Cloud Build path of the deployment runbook. Pushes nothing.
# Run with Node 24 first on PATH (the exporter bundles with the repository's esbuild).
set -eu
tag=${1:?usage: build.sh <tag> [--platform linux/amd64|linux/arm64]}; shift
platform=
if [ "${1:-}" = --platform ]; then platform=${2:?--platform needs a value}; shift 2; fi
[ $# -eq 0 ] || { echo "UNKNOWN_ARGUMENT:$1" >&2; exit 2; }
case "$platform" in ''|linux/amd64|linux/arm64) ;; *) echo "UNSUPPORTED_PLATFORM:$platform" >&2; exit 2;; esac
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
[ -z "$(git -C "$root" status --porcelain --untracked-files=all)" ] || { echo "DIRTY_SOURCE_TREE: commit first, the image's sourceCommit must be a real commit" >&2; exit 1; }
commit=$(git -C "$root" rev-parse HEAD)
ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
node "$root/scripts/export-lab-runtime.mjs" "$ctx/export" >/dev/null
node "$root/scripts/build-r2b-campaign.mjs" "$ctx" "$ctx/export"
mkdir "$ctx/robotics"
cp "$ctx/export/runtime.mjs" "$ctx/runtime.mjs"; cp -R "$ctx/export/schemas" "$ctx/schemas"; rm -rf "$ctx/export"
# only the MuJoCo tool root, as committed, without its tests
git -C "$root" archive HEAD robotics/simulation-mujoco | tar -x -C "$ctx" --exclude 'robotics/simulation-mujoco/tests'
node "$here/prepare-catalog.mjs" "$ctx/robotics/simulation-mujoco/fixtures/serve-payload-v1/serve-3d-components.json" "$ctx/catalog"
cp "$here/Dockerfile" "$ctx/Dockerfile"
printf '%s\n' '**/__pycache__' '**/*.pyc' '**/tests' '**/.git' '**/.env*' > "$ctx/.dockerignore"
package_sha=$(shasum -a 256 "$ctx/r2b-campaign-package.json" | cut -d " " -f 1)
bundle_sha=$(shasum -a 256 "$ctx/r2b-campaign.mjs" | cut -d " " -f 1)
docker build ${platform:+--platform "$platform"} --build-arg "SOURCE_COMMIT=$commit" --build-arg "R2B_CAMPAIGN_PACKAGE_SHA256=$package_sha" --build-arg "R2B_CAMPAIGN_BUNDLE_SHA256=$bundle_sha" -t "$tag" "$ctx"
echo "built $tag from $commit"
