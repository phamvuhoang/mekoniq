"""Test double for the Webots worker wire (mekoniq-sim3d/1): answers describe and create the way the mode says, never starts Webots.
argv: wire.py MODE [worker args...]. Modes: ok, r2025b (wrong engine version), lock (wrong lock digest), portbusy (create refused: no free port), nogui (create: no window server)."""
import json
import sys

mode, args = sys.argv[1], sys.argv[2:]
lock = args[args.index("--lock-digest") + 1]
boot = "d" * 8
for line in sys.stdin:
    r = json.loads(line)
    base = {"protocol": "mekoniq-sim3d/1", "requestId": r["requestId"], "runId": r["runId"], "bootId": boot, "tick": 0}
    if r["op"] == "describe":
        version = "R2025b" if mode == "r2025b" else "R2025a"
        res = {"packageVersion": version, "pythonVersion": "3.11.15", "lockDigest": "f" * 64 if mode == "lock" else lock, "ops": ["describe", "create", "stop"], "engineVersion": version, "executableSha256": "a" * 64}
        out = {**base, "ok": True, "result": res}
    elif r["op"] == "create" and mode in ("portbusy", "nogui"):
        err = {"code": "WEBOTS_PORT_IN_USE", "detail": "no free port"} if mode == "portbusy" else {"code": "WEBOTS_START_FAILED", "detail": "webots exited (1): could not connect to the display"}
        out = {**base, "ok": False, "error": err}
    elif r["op"] == "stop":
        out = {**base, "ok": True, "result": {"state": "stopped"}}
    else:
        out = {**base, "ok": False, "error": {"code": "UNSUPPORTED_OP", "detail": r["op"]}}
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
