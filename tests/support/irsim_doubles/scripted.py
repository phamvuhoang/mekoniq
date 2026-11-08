"""Test double: replies to the first request with a scripted misbehaviour chosen by DOUBLE_MODE (garbage | late | foreign | env | hang)."""
import json
import os
import sys
import time

mode = os.environ.get("DOUBLE_MODE", sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else "garbage")
line = sys.stdin.buffer.readline()
request = json.loads(line)
base = {"protocol": "mekoniq-irsim/1", "runId": request["runId"], "bootId": "b", "tick": 0}
if mode == "garbage":
    print("this is not json", flush=True)
elif mode == "late":
    print(json.dumps({**base, "requestId": "somebody-else", "ok": False, "error": {"code": "X", "detail": "y"}}), flush=True)
elif mode == "env":
    print(json.dumps({**base, "requestId": request["requestId"], "ok": False, "error": {"code": "ENV_PROBE", "detail": ",".join(sorted(os.environ))}}), flush=True)
elif mode == "boot":
    print(json.dumps({**base, "requestId": request["requestId"], "ok": False, "error": {"code": "FIRST", "detail": "boot b"}}), flush=True)
    line = sys.stdin.buffer.readline()
    request = json.loads(line)
    print(json.dumps({**base, "bootId": "c", "requestId": request["requestId"], "ok": False, "error": {"code": "SECOND", "detail": "boot c"}}), flush=True)
elif mode == "hang":
    time.sleep(60)
time.sleep(60)
