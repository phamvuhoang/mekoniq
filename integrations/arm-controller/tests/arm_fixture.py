"""Shared builders for the bridge tests: the sim profile, envelopes and cell commands with correct hashes."""
import hashlib
import json
import tempfile
from pathlib import Path

from support import ROOT

try:
    import rfc8785
    canonical = rfc8785.dumps
except ImportError:  # the artifact host may lack rfc8785; profile/payload JSON here is plain ASCII with integers, so sorted compact JSON is JCS
    canonical = lambda v: json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
PROFILE_PATH = ROOT / "configs" / "sim" / "puma560" / "profile.json"
RUN_ID = "3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c"
sha = lambda b: hashlib.sha256(b).hexdigest()


def profile():
    return json.loads(PROFILE_PATH.read_text())


def profile_hash(p=None):
    return sha(canonical(p or profile()))


def cell_command(capability, payload, command_id="cmd-1", program=None, epoch=1, expires="2026-11-05T08:00:30.000Z", device="arm-1"):
    return {"commandId": command_id, "runId": RUN_ID, "deviceId": device, "controlEpoch": epoch, "expiresAt": expires, "recipeRevision": None,
            "programRef": program, "capability": capability, "payloadHash": sha(canonical(payload)), "payload": payload}


def envelope(command, token="tok", actor="lab_simulation", lease="lease-1", controller_epoch=1, p=None):
    p = p or profile()
    return {"schemaVersion": 1, "kind": "arm.command.v1", "machineId": p["machineId"], "controllerEpoch": controller_epoch, "owner": {"token": token, "actor": actor}, "leaseId": lease,
            "expected": {"profileHash": profile_hash(p), "modelManifestSha256": p["model"]["manifestSha256"]}, "command": command}


def demo_program_ref(p=None):
    p = p or profile(); return {"id": "demo-six-axis", "hash": p["programs"]["demo-six-axis"]["sha256"]}


def temp_dir():
    return Path(tempfile.mkdtemp(prefix="arm-bridge-"))


T0 = 1_793_865_600_000  # 2026-11-05T08:00:00Z in ms
