#!/bin/sh
# deploy/lab-runtime/build.sh <tag> [--platform linux/amd64|linux/arm64]
# Builds the headless Lab runtime image from a clean export of the committed HEAD in a dedicated context. Refuses a dirty source tree. Pushes nothing.
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
node "$root/scripts/export-lab-runtime.mjs" "$ctx/export" --clean-checkout >/dev/null
mkdir "$ctx/robotics"
cp "$ctx/export/runtime.mjs" "$ctx/runtime.mjs"; cp -R "$ctx/export/schemas" "$ctx/schemas"; rm -rf "$ctx/export"
# only the MuJoCo tool root, as committed, without its tests
git -C "$root" archive HEAD robotics/simulation-mujoco | tar -x -C "$ctx" --exclude 'robotics/simulation-mujoco/tests'
cp "$here/Dockerfile" "$ctx/Dockerfile"
printf '%s\n' '**/__pycache__' '**/*.pyc' '**/tests' '**/.git' '**/.env*' > "$ctx/.dockerignore"
docker build ${platform:+--platform "$platform"} --build-arg "SOURCE_COMMIT=$commit" -t "$tag" "$ctx"
echo "built $tag from $commit"
