import sys, json, shutil, hashlib, tempfile
from pathlib import Path
R = "/Users/hoangpham/source/prv/robot/source/robotics/simulation-mujoco"
sys.path.insert(0, R); sys.path.insert(0, R + "/tests")
import numpy as np
import probe_drive as P
import test_drive_engine as T
from mujoco_worker.world_engine import WorldEngine
from mujoco_worker.session import WorkerSession, scene_digest_of
from mujoco_worker.protocol import PROTOCOL

# (d) ideal vs legacy under the registered dock-drift disturbance
dist = {"presetId": "world-dock-drift-v1", "targetId": "amr-1"}
def run(drive):
    e = WorldEngine(*P.world_inputs(), **({"drive": drive} if drive else {}))
    qp = []; faults = []
    for k in range(80):
        q, opening, placements, v, w = P.world_cmd(k)
        d = dist if k == 40 else None
        if drive:
            r = e.step(None, None, placements, 0, 0, d, T.arm_commands("xarm-1", q, opening, e.arm.grip_range, e.opening_max_m, k + 1) + T.wheel_commands(e.mobile, "amr-1", v, w, k + 1))
            faults.append([x["fault"] for x in r["world"]["drives"]])
        else:
            r = e.step(q, opening, placements, v, w, d)
        qp.append(e.data.qpos.copy())
        if k in (40, 41): print("drive" if drive else "legacy", k, "wheel vel", r["world"]["physics"]["wheels"][0]["velocityRadS"])
    e.close()
    return np.array(qp), faults
a, _ = run(None)
b, faults = run(T.world_docs())
first = next((k for k in range(80) if not np.array_equal(a[k], b[k])), None)
print("first diverging tick ideal vs legacy under dock drift:", first, "faults at 40..42:", faults[40:43])

# (c) world session: missing gripper command / refusal burning state
tmp = Path(tempfile.mkdtemp(dir="/private/tmp/claude-502/-Users-hoangpham-source-prv-robot/5ef5f203-754a-4a95-b9ab-dfcc7a67ad45/scratchpad"))
world = Path(R) / "fixtures" / "coffee-delivery-world-v1"
for p in world.iterdir():
    if p.is_file(): shutil.copy(p, tmp / p.name)
shutil.copytree(T.BLOBS, tmp / "blobs")
scene = json.loads((tmp / "lab-world-scene.json").read_text())
model, control = T.world_docs("arm-1")
refs = {}
for name, d, key in (("world-drive-test-v1.json", model, "driveModelRef"), ("world-control-test-v1.json", control, "controlProfileRef")):
    raw = (json.dumps(d, indent=2) + "\n").encode(); (tmp / name).write_bytes(raw)
    refs[key] = {"id": d["id"], "revision": 1, "path": name, "sha256": hashlib.sha256(raw).hexdigest()}
    scene["files"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
scene["engine"] = refs; scene["sceneDigest"] = scene_digest_of(scene)
(tmp / "lab-world-scene.json").write_text(json.dumps(scene))
s = WorkerSession(run_id="w", bundle_root=tmp, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"])
req = lambda op, payload, tick=0, rid=None: {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "w", "expectedTick": tick, "op": op, "payload": payload}
assert s.handle(req("create", {"sceneRef": "lab-world-scene.json", "seed": 7}))["ok"]
assert s.handle(req("start", {}))["ok"]
home = scene["armCell"]["arm"]["homeRad"]
arm = T.arm_commands("arm-1", home, 0.0889, s.engine.arm.grip_range, s.engine.opening_max_m, 1)
wh = [T.cmd("amr-1/wheel-left", 1, "csv", 0.0), T.cmd("amr-1/wheel-right", 1, "csv", 0.0)]
ctl = {"worldControl": {"version": 1, "program": None, "attachmentProxyPropId": None, "movementInterlocked": False, "stopLatched": False}} if scene.get("controlContextVersion") == 1 else {}
r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": arm[:-1] + wh, **ctl}, rid="nogrip"))
print("missing gripper command ->", r["ok"], r.get("error"), "state:", s.state)
