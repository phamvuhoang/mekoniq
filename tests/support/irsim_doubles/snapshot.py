"""Test double: answers each request with a schema-valid reply that contradicts the envelope, the run or the protocol (--mode: tick | run | boot | scene | statecreate | simtime | seq | etick | ok)."""
import json
import sys
import time

mode = sys.argv[sys.argv.index("--mode") + 1]
scene = sys.argv[sys.argv.index("--scene-digest") + 1] if "--scene-digest" in sys.argv else "a" * 64
n = 0
while True:
    line = sys.stdin.buffer.readline()
    if not line:
        break
    request = json.loads(line)
    n += 1
    tick = 5 if mode == "etick" else 0
    snap = {"schemaVersion": 1, "runId": request["runId"], "bootId": "b", "tick": tick, "simTimeNs": str(tick * 20_000_000), "seq": "1", "sceneDigest": scene, "robots": []}
    result = snap
    if mode == "tick": snap["tick"] = 1
    elif mode == "run": snap["runId"] = "other"
    elif mode == "boot": snap["bootId"] = "c"
    elif mode == "scene": snap["sceneDigest"] = "b" * 64
    elif mode == "simtime": snap["simTimeNs"] = "999"
    elif mode == "seq": snap["seq"] = "5" if n == 1 else "3"
    elif mode == "statecreate": result = {"state": "created"}
    print(json.dumps({"protocol": "mekoniq-irsim/1", "requestId": request["requestId"], "runId": request["runId"], "bootId": "b", "tick": tick, "ok": True, "result": result}), flush=True)
time.sleep(60)
