#!/usr/bin/env bash
# Save by configuration digest. The separate release artifact can be loaded without touching any existing image tag.
set -euo pipefail
native=${1:?native evidence directory} out=${2:?new image artifact directory} source_sha=${3:?source SHA}
[[ $source_sha =~ ^[a-f0-9]{40}$ && $(cat "$native/qualification-exit.txt") == 0 ]]
image_id=$(jq -er --arg sha "$source_sha" 'select(.revision==$sha and .Os=="linux" and .Architecture=="amd64") | .Id | select(test("^sha256:[0-9a-f]{64}$"))' "$native/image.json")
docker image inspect "$image_id" | jq -e --arg sha "$source_sha" --arg id "$image_id" '
  length==1 and (.[0] | .Id==$id and .Os=="linux" and .Architecture=="amd64" and .Config.Labels["org.opencontainers.image.revision"]==$sha)' >/dev/null
mkdir "$out"
docker image save "$image_id" > "$out/image.tar"
archive_sha=$(sha256sum "$out/image.tar" | cut -d' ' -f1)
native_sha=$(sha256sum "$native/image.json" | cut -d' ' -f1)
jq -n --arg sha "$source_sha" --arg id "$image_id" --arg archive "$archive_sha" --arg native "$native_sha" \
 '{schemaVersion:1,accepted:false,sourceCommit:$sha,imageId:$id,platform:"linux/amd64",archive:"image.tar",archiveSha256:$archive,nativeImageSha256:$native}' > "$out/handoff.json"
