#!/usr/bin/env bash
set -eu
# Docker gives an explicit context precedence over DOCKER_HOST.
if [[ -n ${DOCKER_CONTEXT:-} && -n ${DOCKER_HOST:-} ]]; then
  echo 'CONFLICTING_DOCKER_SELECTORS: select the local daemon with DOCKER_CONTEXT or DOCKER_HOST' >&2
  exit 1
fi
endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')}
[[ $endpoint == unix:///* ]] || { echo 'LOCAL_DOCKER_DAEMON_REQUIRED' >&2; exit 1; }
printf '%s\n' "$endpoint"
