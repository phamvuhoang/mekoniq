#!/usr/bin/env bash
# deploy/lab-runtime/cloud-run.sh [--execute]
# Deploys the Lab runtime image to Google Cloud Run (D60). Without --execute it only PRINTS the commands (a dry run: gcloud is not called, not even to read the configured project,
# and it need not be installed). With --execute it shows each command and then runs it. It first reads whether the service exists (a failed read means "does not exist"):
#   A. it exists: one deploy that carries the service's current host as LAB_PUBLIC_HOST (a re-run, e.g. a key rotation, never takes a working service down);
#   B. it does not: deploy with the placeholder host (the host is unknown before the first deploy), read the URL, set LAB_PUBLIC_HOST to that host. If that last step fails the script prints
#      the command to run by hand and exits 4; until it succeeds the service refuses every request (fail closed).
# Nothing is built or pushed here (see docs/operations/lab-runtime-cloud-run.md), and nothing is deployed unless the operator runs it with --execute.
# The access key is never read, printed or passed: the service takes it from the Secret Manager secret NAMED by ACCESS_KEY_SECRET (the operator creates the secret by hand).
# Required environment: GCP_PROJECT, LAB_ORIGIN (https://host[:port], exact), ACCESS_KEY_SECRET (a secret NAME), IMAGE. Optional: GCP_REGION (asia-southeast1), SERVICE (mekoniq-lab-runtime).
set -euo pipefail
export LC_ALL=C
unset MEKONIQ_LAB_ACCESS_KEY  # whatever the caller's shell holds must not reach gcloud
die(){ echo "$1" >&2; exit "${2:-2}"; }

execute=0 dry=0
for a in "$@"; do
  case "$a" in
    --execute) execute=1;; --dry-run) dry=1;;
    --help|-h) sed -n '2,/^set -euo/p' "$0" | sed '$d;s/^# \{0,1\}//'; exit 0;;
    *) die "UNKNOWN_ARGUMENT:$a";;
  esac
done
[ $((execute + dry)) -lt 2 ] || die "CONFLICTING_ARGUMENTS: --execute and --dry-run"

GCP_PROJECT=${GCP_PROJECT-} GCP_REGION=${GCP_REGION:-asia-southeast1} LAB_ORIGIN=${LAB_ORIGIN-} ACCESS_KEY_SECRET=${ACCESS_KEY_SECRET-} IMAGE=${IMAGE-} SERVICE=${SERVICE:-mekoniq-lab-runtime}
for v in GCP_PROJECT LAB_ORIGIN ACCESS_KEY_SECRET IMAGE; do [ -n "${!v}" ] || die "MISSING_ENV:$v"; done
# Values are checked, never evaluated; messages name the variable and never echo a value.
check(){ [[ ${!1} =~ $2 ]] || die "INVALID_ENV:$1: $3"; }
check GCP_PROJECT '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' 'not a project id'
check GCP_REGION '^[a-z]+-[a-z]+[0-9]+$' 'not a region such as asia-southeast1'
check SERVICE '^[a-z]([a-z0-9-]{0,48}[a-z0-9])?$' 'not a Cloud Run service name'
check ACCESS_KEY_SECRET '^[A-Za-z0-9_-]{1,255}$' 'must be a Secret Manager secret NAME (letters, digits, - and _), not the key and not name:version'
check IMAGE '^[A-Za-z0-9][A-Za-z0-9._/:@-]*$' 'not an image reference'
origin_re='^(https?)://(\[::1\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:([0-9]{1,5}))?$'
[[ $LAB_ORIGIN =~ $origin_re ]] || die "INVALID_ENV:LAB_ORIGIN: must be exactly scheme://host[:port], lower case, no path, query, user or wildcard"
scheme=${BASH_REMATCH[1]} ohost=${BASH_REMATCH[2]} oport=${BASH_REMATCH[7]}
if [ "$scheme" = http ]; then case "$ohost" in localhost|127.0.0.1|'[::1]') ;; *) die "INVALID_ENV:LAB_ORIGIN: http is allowed only for a loopback host";; esac; fi
if [ -n "$oport" ]; then
  { [ $((10#$oport)) -ge 1 ] && [ $((10#$oport)) -le 65535 ]; } || die "INVALID_ENV:LAB_ORIGIN: port out of range"
  { [ "$scheme:$((10#$oport))" != https:443 ] && [ "$scheme:$((10#$oport))" != http:80 ]; } || die "INVALID_ENV:LAB_ORIGIN: a browser omits the default port, write the origin without it"
fi

# a copy-pasteable line: shell-quoted only where quoting is needed
show(){ printf '+'; for a in "$@"; do if [[ $a =~ ^[A-Za-z0-9_@%+=:,./-]+$ ]]; then printf ' %s' "$a"; else printf ' %q' "$a"; fi; done; printf '\n'; }
common=("--project=$GCP_PROJECT" "--region=$GCP_REGION")
# The service host is unknown until the first deploy: a new service starts with a placeholder host (it refuses every request with HOST_FORBIDDEN until the update).
placeholder=pending.invalid
mkdeploy(){ deploy=(gcloud run deploy "$SERVICE" "${common[@]}" "--image=$IMAGE"
  --execution-environment=gen2 --max-instances=1 --min-instances=0 --concurrency=20 --timeout=3600 --cpu=1 --memory=2Gi --allow-unauthenticated
  "--set-secrets=MEKONIQ_LAB_ACCESS_KEY=$ACCESS_KEY_SECRET:latest" "--set-env-vars=LAB_ALLOW_ORIGIN=$LAB_ORIGIN,LAB_PUBLIC_HOST=$1"); }
describe=(gcloud run services describe "$SERVICE" "${common[@]}" '--format=value(status.url)')
host_of(){ [[ $1 =~ ^https://([a-z0-9]([a-z0-9.-]*[a-z0-9])?)/?$ ]] && host=${BASH_REMATCH[1]}; }

if [ "$execute" = 0 ]; then
  echo "# DRY RUN: nothing is run, gcloud is not called. Add --execute to run these commands."
  echo "# --execute first reads whether the service exists (a failed read means it does not), then follows case A or B."
  echo "# Case A: the service exists (a re-run): its live host is kept, there is no update step"
  show "${describe[@]}"; mkdeploy HOST_OF_THE_EXISTING_SERVICE_URL; show "${deploy[@]}"
  echo "# Case B: a new service: deploy with the placeholder host, read the URL, set LAB_PUBLIC_HOST to that host (https:// and any trailing / removed)"
  mkdeploy "$placeholder"; show "${deploy[@]}"; show "${describe[@]}"
  show gcloud run services update "$SERVICE" "${common[@]}" "--update-env-vars=LAB_PUBLIC_HOST=HOST_OF_THE_SERVICE_URL"
  exit 0
fi

command -v gcloud >/dev/null || die "GCLOUD_NOT_FOUND: install the Google Cloud CLI and sign in first" 3
echo "# does the service exist? (a failed read is taken to mean it does not)"
show "${describe[@]}"; url=$("${describe[@]}") || url=
if [ -n "$url" ]; then
  host=; host_of "$url" || die "SERVICE_URL_INVALID: gcloud did not return an https service URL for the existing service; nothing was deployed" 1
  echo "# Case A: the service exists, its host $host is kept"
  mkdeploy "$host"; show "${deploy[@]}"; "${deploy[@]}"
  echo "# done. Next: GET $url/lab/v2/health, then the MJ-BV01 smoke run (CL01) in docs/operations/lab-runtime-cloud-run.md. Until it passes, the cloud runtime is proven for the mock backends only."
  exit 0
fi
echo "# Case B: a new service. 1. deploy with the placeholder host"
mkdeploy "$placeholder"; show "${deploy[@]}"; "${deploy[@]}"
echo "# 2. read the service URL"; show "${describe[@]}"; url=$("${describe[@]}") || url= # a failed read is a missing URL: the message below names the command to run by hand
host=; host_of "$url" || die "SERVICE_URL_INVALID: gcloud did not return an https service URL; LAB_PUBLIC_HOST is still the placeholder, so the service refuses every request. Set it by hand: gcloud run services update $SERVICE ${common[*]} --update-env-vars=LAB_PUBLIC_HOST=<host of the service URL>" 1
echo "# 3. LAB_PUBLIC_HOST = $host"
cmd=(gcloud run services update "$SERVICE" "${common[@]}" "--update-env-vars=LAB_PUBLIC_HOST=$host"); show "${cmd[@]}"
if ! "${cmd[@]}"; then
  { echo "UPDATE_FAILED: the service is deployed but LAB_PUBLIC_HOST is still the placeholder, so it refuses every request. Run this by hand (re-running this script is also safe: it keeps a live host):"; show "${cmd[@]}"; } >&2
  exit 4
fi
echo "# done. Next: GET $url/lab/v2/health, then the MJ-BV01 smoke run (CL01) in docs/operations/lab-runtime-cloud-run.md. Until it passes, the cloud runtime is proven for the mock backends only."
