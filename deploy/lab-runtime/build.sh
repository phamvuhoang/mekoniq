#!/bin/sh
# deploy/lab-runtime/build.sh <tag> [--platform linux/amd64|linux/arm64] [--oci-out FRESH_DIR]
# Builds the headless Lab runtime image in a dedicated context. Refuses a dirty tree (no modified or untracked file), so the tracked content of the working tree equals HEAD.
# runtime.mjs is bundled by scripts/export-lab-runtime.mjs from that clean tree, with the tree's installed node_modules (not a fresh frozen install); the MuJoCo tool root
# comes from `git archive HEAD`. A from-scratch build from a fresh clone with a frozen install is the Cloud Build path of the deployment runbook. Pushes nothing.
# Run with Node 24 first on PATH (the exporter bundles with the repository's esbuild).
set -eu
tag=${1:?usage: build.sh <tag> [--platform linux/amd64|linux/arm64] [--oci-out FRESH_DIR]}; shift
platform=
oci_out=
if [ "${1:-}" = --platform ]; then platform=${2:?--platform needs a value}; shift 2; fi
if [ "${1:-}" = --oci-out ]; then oci_out=${2:?--oci-out needs a fresh directory}; shift 2; fi
[ $# -eq 0 ] || { echo "UNKNOWN_ARGUMENT:$1" >&2; exit 2; }
case "$platform" in ''|linux/amd64|linux/arm64) ;; *) echo "UNSUPPORTED_PLATFORM:$platform" >&2; exit 2;; esac
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
[ -z "$(git -C "$root" status --porcelain --untracked-files=all -- . ':(exclude)apps/lab')" ] || { echo "DIRTY_SOURCE_TREE: commit first, the image's sourceCommit must be a real commit" >&2; exit 1; }
commit=$(git -C "$root" log -1 --format=%H -- . ':(exclude)apps/lab')
ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
node "$root/scripts/export-lab-runtime.mjs" "$ctx/export" >/dev/null
node "$root/scripts/build-r2b-campaign.mjs" "$ctx" "$ctx/export"
mkdir "$ctx/robotics"
cp "$ctx/export/runtime.mjs" "$ctx/runtime.mjs"; cp -R "$ctx/export/schemas" "$ctx/schemas"; rm -rf "$ctx/export"
# only the MuJoCo tool root, as committed, without its tests
git -C "$root" archive HEAD robotics/simulation-mujoco | tar -x -C "$ctx" --exclude 'robotics/simulation-mujoco/tests'
# the electrical catalog (device profiles, electrical fixtures, parts) as committed; manufacturer documents are not part of the image
git -C "$root" archive HEAD robotics/catalog | tar -x -C "$ctx" --exclude robotics/catalog/documents
node "$here/prepare-catalog.mjs" "$ctx/robotics/simulation-mujoco/fixtures/serve-payload-v1/serve-3d-components.json" "$ctx/catalog" "$ctx/robotics/catalog"
rm -rf "$ctx/robotics/catalog"
cp "$here/Dockerfile" "$ctx/Dockerfile"
printf '%s\n' '**/__pycache__' '**/*.pyc' '**/tests' '**/.git' '**/.env*' > "$ctx/.dockerignore"
package_sha=$(shasum -a 256 "$ctx/r2b-campaign-package.json" | cut -d " " -f 1)
bundle_sha=$(shasum -a 256 "$ctx/r2b-campaign.mjs" | cut -d " " -f 1)
if [ -n "$oci_out" ]; then
  node "$root/scripts/native-sim/build-r2b-local-oci.mjs" "$ctx" "$tag" "$platform" "$oci_out"
else
docker build ${platform:+--platform "$platform"} --build-arg "SOURCE_COMMIT=$commit" --build-arg "R2B_CAMPAIGN_PACKAGE_SHA256=$package_sha" --build-arg "R2B_CAMPAIGN_BUNDLE_SHA256=$bundle_sha" -t "$tag" "$ctx"
fi
echo "built $tag from $commit"
