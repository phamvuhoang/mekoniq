#!/usr/bin/env bash
# Terminal smoke of the LinuxCNC simulation package (A02). Needs a Linux host with linuxcnc(1) and the python3 `linuxcnc` module; the pinned
# profile is copied to a temporary directory with [DISPLAY] replaced by scripts/smoke_driver.py, which runs start/home/run/pause/resume/stop and a
# controller fault on the virtual HAL. Without the prerequisites the script writes a blocked_external record and exits 2: never a pass by skip.
#   bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir DIR [--gui] [--dependencies-lock JSON]
# Exit codes: 0 sequence recorded pass, 1 sequence failed, 2 prerequisite/usage missing (not_run).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="" evidence="" gui=0 lock="$here/packaging/dependencies.lock.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --evidence-dir) evidence="${2:-}"; shift 2 ;;
    --gui) gui=1; shift ;;
    --dependencies-lock) lock="${2:-}"; shift 2 ;;
    *) echo "usage: smoke-sim.sh --profile INI --evidence-dir DIR [--gui] [--dependencies-lock JSON]" >&2; exit 2 ;;
  esac
done
if [ -z "$profile" ] || [ -z "$evidence" ] || [ ! -f "$profile" ] || [ ! -f "$lock" ]; then echo "usage: smoke-sim.sh --profile INI --evidence-dir DIR [--gui] [--dependencies-lock JSON]" >&2; exit 2; fi
mkdir -p "$evidence"
if [ -e "$evidence/smoke-sim.json" ] || [ -e "$evidence/smoke-driver.json" ]; then echo "EVIDENCE_OUTPUT_EXISTS: use a fresh evidence directory" >&2; exit 2; fi
sha() { python3 - "$1" <<'PY'
import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())
PY
}
model="$here/models/puma560-reference/manifest.json"
python3 "$here/scripts/runtime-inventory.py" > "$evidence/runtime-inventory.json"
reasons=()
if [ "$(uname -s)" = "Linux" ]; then
  if ! python3 - "$lock" <<'PYLOCK'
import json, platform, sys
expected = json.load(open(sys.argv[1]))['host']['architecture']
actual = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine(), platform.machine())
sys.exit(0 if expected == actual else 1)
PYLOCK
  then reasons+=("DEPENDENCY_ARCHITECTURE_MISMATCH"); fi
fi
[ "$(uname -s)" = "Linux" ] || reasons+=("HOST_NOT_LINUX")
command -v linuxcnc >/dev/null 2>&1 || reasons+=("LINUXCNC_MISSING")
python3 -c 'import linuxcnc' >/dev/null 2>&1 || reasons+=("LINUXCNC_PYTHON_MODULE_MISSING")
[ -n "${MEKONIQ_SMOKE_FORCE_MISSING:-}" ] && reasons+=("LINUXCNC_MISSING")
record() { # $1 status $2 result $3 reasons-json $4 extra-json
  python3 - "$evidence/smoke-sim.json" "$1" "$2" "$3" "$4" "$profile" "$(sha "$profile")" "$model" "$(sha "$model")" "$lock" "$(sha "$lock")" <<'PY'
import json, platform, sys, datetime
out, status, result, reasons, extra, profile, psha, model, msha, lock, lsha = sys.argv[1:]
rec = {"schemaVersion": 1, "backend": "linuxcnc_sim", "status": status, "result": result, "reasons": json.loads(reasons),
       "host": {"platform": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": platform.python_version()},
       "profile": {"path": profile, "sha256": psha}, "modelManifest": {"path": model, "sha256": msha}, "dependenciesLock": {"path": lock, "sha256": lsha},
       "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "runtimeInventory": json.load(open(__import__("pathlib").Path(out).parent / "runtime-inventory.json")), "claims": "software sequence on a virtual HAL at most; no drive, timing, load or safety evidence", **json.loads(extra)}
json.dump(rec, open(out, "w"), indent=1)
PY
}
if [ ${#reasons[@]} -gt 0 ]; then
  record blocked_external not_run "$(printf '%s\n' "${reasons[@]}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))')" '{}'
  echo "NOT_RUN: ${reasons[*]} (see $evidence/smoke-sim.json)" >&2; exit 2
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
gui_args=(); [ "$gui" -eq 0 ] || gui_args+=(--gui)
set +e
ini="$(python3 "$here/scripts/prepare_smoke.py" --root "$here" --profile "$profile" --out "$tmp/config" "${gui_args[@]}" 2>"$evidence/profile-staging.log")"
prepare_rc=$?
set -e
if [ "$prepare_rc" -ne 0 ]; then
  record not_run not_run '["PROFILE_STAGING_FAILED"]' '{"log":"profile-staging.log"}'
  echo "NOT_RUN: PROFILE_STAGING_FAILED (see $evidence/profile-staging.log)" >&2; exit 2
fi
cp "$ini" "$evidence/prepared.ini"
version="$(python3 -c 'import linuxcnc; print(getattr(linuxcnc, "version", "unknown"))' 2>/dev/null || echo unknown)"
set +e
MEKONIQ_SMOKE_EVIDENCE="$evidence" linuxcnc "$ini" >"$evidence/linuxcnc.log" 2>&1
rc=$?
set -e
drv="$evidence/smoke-driver.json"
if [ "$gui" -eq 1 ] && [ "$rc" -eq 0 ]; then
  record manual_verification_required not_run '["GUI_CHECKLIST_NOT_RECORDED"]' '{"gui":true,"linuxcncExit":0,"log":"linuxcnc.log","preparedProfile":"prepared.ini"}'
  echo "NOT_RUN: GUI closed; record the independent HMI acceptance checklist" >&2; exit 2
fi
status="fail"; [ -f "$drv" ] && status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status","fail"))' "$drv")"
[ "$rc" -eq 0 ] || status="fail"
record "$status" "$([ "$status" = pass ] && echo pass || echo fail)" '[]' "{\"linuxcncVersion\": \"$version\", \"linuxcncExit\": $rc, \"driverRecord\": \"smoke-driver.json\", \"log\": \"linuxcnc.log\", \"gui\": $gui}"
echo "smoke status: $status (linuxcnc exit $rc, see $evidence/smoke-sim.json)"
[ "$status" = pass ] && exit 0 || exit 1
