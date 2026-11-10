"""One request in, one JSON line out. Stdout carries only that line; everything else goes to stderr."""
import contextlib
import importlib
import json
import sys

from .errors import InputInvalid

PROTOCOL = "mekoniq-algorithm/1"
MAX_REQUEST_BYTES = 1 << 20
MODULES = {"rtb_fk": "kinematics", "rtb_jacobian": "kinematics", "rtb_ik": "kinematics", "pid_response": "pid"}


def _fail(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def _no_constant(name):
    raise ValueError(f"non-finite JSON constant {name}")


def _tool_versions():
    from importlib.metadata import version

    return {n: version(n) for n in ("roboticstoolbox-python", "numpy", "scipy", "spatialmath-python")}


def handle(raw: str) -> dict:
    if len(raw.encode("utf-8", "replace")) > MAX_REQUEST_BYTES:
        return _fail("INPUT_TOO_LARGE", f"request exceeds {MAX_REQUEST_BYTES} bytes")
    try:
        req = json.loads(raw, parse_constant=_no_constant)
    except ValueError as e:
        return _fail("INPUT_INVALID", f"not valid JSON: {e}")
    if not isinstance(req, dict) or set(req) != {"protocol", "op", "payload"}:
        return _fail("INPUT_INVALID", "request must have exactly protocol, op, payload")
    if req["protocol"] != PROTOCOL:
        return _fail("PROTOCOL_MISMATCH", f"expected {PROTOCOL}")
    if not isinstance(req["payload"], dict):
        return _fail("INPUT_INVALID", "payload must be an object")
    module = MODULES.get(req["op"]) if isinstance(req["op"], str) else None
    if module is None:
        return _fail("OP_UNKNOWN", f"unknown op {req['op']!r}")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            # imported on demand: a PID request never pays for (or depends on) Robotics Toolbox
            fn = getattr(importlib.import_module(f".{module}", __name__), "OPS")[req["op"]]
            result = fn(req["payload"])
    except InputInvalid as e:
        return _fail("INPUT_INVALID", str(e))
    except Exception as e:  # noqa: BLE001 — any solver failure is reported, never a pass
        return _fail("CHECK_FAILED", f"{type(e).__name__}: {e}")
    return {"ok": True, "result": result, "toolVersions": _tool_versions()}


def main():
    line = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1).decode("utf-8", "replace")
    sys.stdout.write(json.dumps(handle(line), allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
