#!/usr/bin/env bash
# Re-verify an installed SIM release: the trust policy still accepts the current release's signature, every file still matches its hash,
# nothing foreign was added, the machine overlay keeps hardware disabled. Exit 0 verified · 1 tamper · 3 trust · 2 usage.
set -euo pipefail
prefix=""
while [ $# -gt 0 ]; do case "$1" in --prefix) prefix="${2:-}"; shift 2 ;; *) echo "usage: verify-install.sh --prefix DIR" >&2; exit 2 ;; esac; done
[ -n "$prefix" ] && [ -L "$prefix/current" ] || { echo "usage: --prefix with an installed release required" >&2; exit 2; }
py="${MEKONIQ_PYTHON:-python3}"; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; verifier="$here/verify-signature.py"   # the verifier shipped beside this script, never one taken from the artifact under test
cur="$(readlink "$prefix/current")"; dir="$prefix/$cur"
set +e
result="$("$py" "$verifier" --artifact "$dir" --trust-policy "$prefix/trust/trust-policy.json" --runtime-root "$prefix/current" --json)"; rc=$?
set -e
if [ "$rc" -ne 0 ]; then echo "NOT_VERIFIED: $result"; exit "$rc"; fi
hw="$("$py" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("hardwareEnabled"))' "$prefix/machine/overlay.json")"
[ "$hw" = "False" ] || { echo "HARDWARE_ENABLED_IN_OVERLAY: not a SIM install"; exit 3; }
echo "verified $(basename "$cur") at $prefix/current; mode: simulation; hardware: disabled; $result"
