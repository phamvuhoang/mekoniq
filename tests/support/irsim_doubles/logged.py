"""Test double: the real worker that appends every request and its response (without LiDAR ranges) to worker-log.ndjson in its working directory,
and dies right after applying a step (before the ACK) once a file named crash-next-step exists there. A file named foreign-scan-next-step makes the next
step's LiDAR scans claim the previous tick (one step only): a snapshot the evidence store must refuse."""
import json
import os

from irsim_worker import __main__ as worker
from irsim_worker import session

original = session.WorkerSession.handle


def handle(self, request):
    response = original(self, request)
    result = response.get("result")
    robots = [{k: v for k, v in r.items() if k != "scans"} for r in result.get("robots", [])] if isinstance(result, dict) else []
    with open("worker-log.ndjson", "a") as f:
        f.write(json.dumps({"op": request["op"], "requestId": request["requestId"], "payload": request["payload"], "ok": response["ok"], "tick": response["tick"], "robots": robots}) + "\n")
    if request["op"] == "step" and os.path.exists("crash-next-step"):
        os._exit(9)  # applied, never acknowledged
    if request["op"] == "step" and os.path.exists("foreign-scan-next-step") and response["ok"]:
        os.remove("foreign-scan-next-step")
        for r in result["robots"]:
            for scan in r["scans"]:
                scan["tick"] = max(0, scan["tick"] - 1)
    return response


session.WorkerSession.handle = handle
raise SystemExit(worker.main())
