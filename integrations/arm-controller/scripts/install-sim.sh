#!/usr/bin/env bash
# Install (or roll back) the arm controller SIM artifact on an IPC. Verify first (signature under the machine trust policy, per-file hashes,
# downgrade policy), then copy into a versioned release directory, keep the per-machine overlay (identity/calibration) apart, switch
# `current`, record last-known-good. Hardware stays disabled: no flag here enables it (provisioning does, outside this script).
#   install-sim.sh --prefix /opt/mekoniq-arm-sim --artifact DIR [--trust-policy FILE] [--enable-service]
#   install-sim.sh --prefix /opt/mekoniq-arm-sim --rollback
# Exit 0 ok · 1 tamper · 3 trust/policy · 4 rollback impossible (nothing to roll back to, calibration incompatible) · 2 usage.
set -euo pipefail
prefix="" artifact="" policy="" rollback=0 enable=0
while [ $# -gt 0 ]; do case "$1" in
  --prefix) prefix="${2:-}"; shift 2 ;; --artifact) artifact="${2:-}"; shift 2 ;; --trust-policy) policy="${2:-}"; shift 2 ;; --rollback) rollback=1; shift ;; --enable-service) enable=1; shift ;;
  *) echo "usage: install-sim.sh --prefix DIR (--artifact DIR [--trust-policy FILE] [--enable-service] | --rollback)" >&2; exit 2 ;; esac; done
[ -n "$prefix" ] || { echo "usage: --prefix required" >&2; exit 2; }
py="${MEKONIQ_PYTHON:-python3}"; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; verifier="$here/verify-signature.py"   # the verifier shipped beside this script, never one taken from the artifact under test
# an installer that lives inside the artifact it would verify proves nothing: run the installed release's installer (updates) or the provisioning package's (first install)
if [ -n "$artifact" ] && [ -d "$artifact" ]; then art_abs="$(cd "$artifact" && pwd -P)"; case "$(cd "$here" && pwd -P)/" in "$art_abs"/*) echo "INSTALLER_FROM_ARTIFACT: $here is inside $art_abs; use \$prefix/current/scripts/install-sim.sh or the provisioning package" >&2; exit 3 ;; esac; fi
mkdir -p "$prefix/machine" "$prefix/trust"                     # releases/ appears only after a verified artifact
[ -f "$prefix/machine/overlay.json" ] || printf '%s\n' '{"schemaVersion": 1, "identity": null, "calibration": null, "hardwareEnabled": false, "note": "per-machine identity and calibration are provisioned here, never shipped in the artifact"}' > "$prefix/machine/overlay.json"
# Serialize policy revision acceptance and release activation for this prefix.
lock="$prefix/.install-lock"
mkdir "$lock" 2>/dev/null || { echo "INSTALL_IN_PROGRESS: $lock" >&2; exit 3; }
trap 'rm -rf "$lock"' EXIT
state="$prefix/state.json"; [ -f "$state" ] || printf '%s\n' '{"current": null, "lastKnownGood": null, "rolledBackFrom": null}' > "$state"
jget() { "$py" -c 'import json,sys; v=json.load(open(sys.argv[1]));
for k in sys.argv[2].split("."):
    v=v.get(k) if isinstance(v,dict) else None
print("" if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))' "$1" "$2"; }
calib_ok() { # $1 release dir: the machine overlay's calibration schema must be one the release declares compatible (null calibration is compatible)
  "$py" - "$1/manifest.json" "$prefix/machine/overlay.json" <<'PY'
import json,sys
m,o=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
c=o.get("calibration"); sys.exit(0 if c is None or c.get("schemaVersion") in m.get("compatibleCalibrationSchemas",[]) else 1)
PY
}
activate() { # $1 version
  ln -sfn "releases/$1" "$prefix/current.tmp" && mv -Tf "$prefix/current.tmp" "$prefix/current" 2>/dev/null || { rm -f "$prefix/current"; ln -s "releases/$1" "$prefix/current"; }
}
if [ "$rollback" -eq 1 ]; then
  cur="$(jget "$state" current)"; lkg="$(jget "$state" lastKnownGood)"
  [ -n "$lkg" ] && [ -d "$prefix/releases/$lkg" ] || { echo "ROLLBACK_IMPOSSIBLE: no last-known-good release" >&2; exit 4; }
  calib_ok "$prefix/releases/$lkg" || { echo "CALIBRATION_INCOMPATIBLE: machine calibration schema is not compatible with $lkg" >&2; exit 4; }
  "$py" "$verifier" --artifact "$prefix/releases/$lkg" --trust-policy "$prefix/trust/trust-policy.json" --runtime-root "$prefix/current" --json >/dev/null || { echo "LAST_KNOWN_GOOD_NOT_VERIFIED" >&2; exit 3; }
  activate "$lkg"
  "$py" - "$state" "$lkg" "$cur" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); s.update(current=sys.argv[2], lastKnownGood=None, rolledBackFrom=sys.argv[3]); json.dump(s, open(sys.argv[1],"w"), indent=1)
PY
  echo "rolled back to $lkg (from $cur); mode: simulation"; exit 0
fi
[ -n "$artifact" ] && [ -d "$artifact" ] || { echo "usage: --artifact DIR required" >&2; exit 2; }
# trust policy: the machine's installed copy, or the one given at first install (never the artifact's own copy). An installed policy is
# replaced only by a policy signed (trust-policy.sig.json beside it) under a key the installed policy still trusts.
active_policy="$prefix/trust/trust-policy.json"
verify_policy="$active_policy"
policy_changed=0
if [ -n "$policy" ]; then
  [ -f "$policy" ] || { echo "TRUST_POLICY_MISSING: $policy" >&2; exit 3; }
  # Verify and eventually publish this same private snapshot, never re-read a mutable candidate.
  cp "$policy" "$lock/trust-policy.json"
  verify_policy="$lock/trust-policy.json"
  if [ -f "$active_policy" ] && ! cmp -s "$verify_policy" "$active_policy"; then
    [ -f "$(dirname "$policy")/trust-policy.sig.json" ] || { echo "TRUST_POLICY_UPDATE_UNSIGNED" >&2; exit 3; }
    cp "$(dirname "$policy")/trust-policy.sig.json" "$lock/trust-policy.sig.json"
    set +e; upd="$("$py" "$verifier" --policy-update "$verify_policy" --installed-policy "$active_policy" --json)"; urc=$?; set -e
    [ "$urc" -eq 0 ] || { echo "REFUSED: $upd" >&2; exit 3; }
    policy_changed=1
  elif [ ! -f "$active_policy" ]; then
    policy_changed=1
  fi
fi
[ -f "$verify_policy" ] || { echo "TRUST_POLICY_MISSING: no policy installed under $prefix/trust and none given" >&2; exit 3; }
installed=""; cur="$(jget "$state" current)"; [ -n "$cur" ] && [ -f "$prefix/releases/$cur/manifest.json" ] && installed="$prefix/releases/$cur/manifest.json"
set +e
result="$("$py" "$verifier" --artifact "$artifact" --trust-policy "$verify_policy" --json ${installed:+--installed "$installed"})"; rc=$?
set -e
if [ "$rc" -ne 0 ]; then echo "REFUSED: $result" >&2; exit "$rc"; fi
version="$(jget "$artifact/manifest.json" version)"
[ "$(jget "$artifact/manifest.json" hardwareEnabled)" = "False" ] || [ "$(jget "$artifact/manifest.json" hardwareEnabled)" = "false" ] || { echo "HARDWARE_FLAG_IN_ARTIFACT" >&2; exit 3; }
dest="$prefix/releases/$version"
mkdir -p "$prefix/releases"; rm -rf "$dest.partial"
# Copy exactly the authenticated allowlist. Re-verifying the private stage catches changes during copying.
"$py" - "$artifact" "$dest.partial" <<'PYCODE'
import json, pathlib, shutil, sys
source, dest = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((source / "manifest.json").read_text())
dest.mkdir()
for rel in [f["path"] for f in manifest["files"]] + ["manifest.json", "manifest.sig.json"]:
    path = pathlib.Path(rel)
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit("FILE_PATH_INVALID")
    target = dest / path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / path, target, follow_symlinks=False)
PYCODE
"$py" "$verifier" --artifact "$dest.partial" --trust-policy "$verify_policy" --json ${installed:+--installed "$installed"} >/dev/null
# The active policy is the durable revision high-water mark; rollback never restores old trust metadata.
if [ "$policy_changed" -eq 1 ]; then
  if [ -f "$lock/trust-policy.sig.json" ]; then cp "$lock/trust-policy.sig.json" "$prefix/trust/trust-policy.sig.json"; fi
  mv "$lock/trust-policy.json" "$active_policy"
fi
rm -rf "$dest"; mv "$dest.partial" "$dest"
activate "$version"
"$py" - "$state" "$version" "$cur" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); s.update(current=sys.argv[2], lastKnownGood=(sys.argv[3] or None) if sys.argv[3] != sys.argv[2] else s.get("lastKnownGood"), rolledBackFrom=None); json.dump(s, open(sys.argv[1],"w"), indent=1)
PY
if [ "$enable" -eq 1 ]; then
  if command -v systemctl >/dev/null 2>&1; then cp "$dest/packaging/systemd/mekoniq-arm-bridge.service" /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now mekoniq-arm-bridge.service || { echo "SERVICE_ENABLE_FAILED" >&2; exit 1; }
  else echo "SERVICE_NOT_ENABLED: systemctl not available (recorded, not a pass)"; fi
fi
echo "installed $version at $prefix/current; mode: simulation; hardware: disabled (provisioning-controlled); last-known-good: $(jget "$state" lastKnownGood)"
