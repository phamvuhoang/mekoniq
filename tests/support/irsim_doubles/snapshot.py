"""Test double: answers the first request with a schema-valid snapshot that contradicts the envelope (DOUBLE_MODE: tick | run | boot | scene | ok)."""
import json
import sys
import time

mode = sys.argv[sys.argv.index("--mode") + 1]
scene = sys.argv[sys.argv.index("--scene-digest") + 1] if "--scene-digest" in sys.argv else "a" * 64
request = json.loads(sys.stdin.buffer.readline())
snap = {"schemaVersion": 1, "runId": request["runId"], "bootId": "b", "tick": 1, "simTimeNs": "20000000", "seq": "1", "sceneDigest": scene, "robots": []}
snap.update({"tick": {"tick": 0}, "run": {"runId": "other"}, "boot": {"bootId": "c"}, "scene": {"sceneDigest": "b" * 64}, "ok": {}}[mode])
print(json.dumps({"protocol": "mekoniq-irsim/1", "requestId": request["requestId"], "runId": request["runId"], "bootId": "b", "tick": 1, "ok": True, "result": snap}), flush=True)
time.sleep(60)
