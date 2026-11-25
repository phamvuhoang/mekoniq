#!/usr/bin/env bash
# Write the two verified catalog settings to stdout in GitHub environment-file format.
set -euo pipefail
umask 077
source_dir=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$source_dir"
ancestor=ca550d05ed2bfc7700796cef038169189d6465d8
raw=docs/implementation/evidence/web-lab-to-physical/final-recording/raw
name=historical-retained-inputs
archive_sha=819cac824411b70eee35d59e34ff39e28e0f7db6cbbab2b535caa8faae3e7637
index_sha=63587a9497002fd278d7f45c520e71499f37f135711343f3d3eaacfc9c56f7ac
catalog_sha=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mekoniq-ci-corpus.XXXXXXXX")
if [[ "$work" != /* || "$work" = *$'\n'* || "$work" = *$'\r'* ]]; then
  echo 'Expected an absolute runner temp path without line breaks.' >&2
  exit 1
fi
if ! git cat-file -e "$ancestor^{commit}" 2>/dev/null; then
  git fetch --no-tags --depth=1 origin "$ancestor" >&2
fi
cd "$work"
git -C "$source_dir" show "$ancestor:$raw/$name.tar.gz" > archive.tar.gz
git -C "$source_dir" show "$ancestor:$raw/$name.members.json" > members.json
printf '%s  %s\n' "$archive_sha" archive.tar.gz "$index_sha" members.json | shasum -a 256 -c - >&2
python3 -I -B "$source_dir/docs/implementation/web-lab-to-physical/retention/tools/record-archive.py" extract \
  archive.tar.gz members.json extracted extraction-receipt.json > extraction.log
node "$source_dir/scripts/prepare-retained-inputs.mjs" extracted/inputs.json "$catalog_sha" prepared >&2
printf '%s  %s\n' "$catalog_sha" prepared/inputs.json | shasum -a 256 -c - >&2
printf 'MEKONIQ_RETAINED_INPUTS=%s/prepared/inputs.json\nMEKONIQ_RETAINED_INPUTS_SHA256=%s\n' "$work" "$catalog_sha"
