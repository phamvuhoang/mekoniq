"""V03: what the virtual drive adds to one tick of the cell world, measured at the worker protocol (WorkerSession.handle, snapshot included), legacy and nine-axis drive alternating in one session.

Not the end-to-end tick-cost-probe: the TypeScript runtime has no drive path before V04/V05, so the runtime, the evidence recorder and fsync are not in this number. They are unchanged by this task.
  PYTHONDONTWRITEBYTECODE=1 .venv-mujoco/bin/python -I -B robotics/simulation-mujoco/probe_drive_cost.py --out docs/research/virtual-drive-spike/v03-cost.json
"""
import argparse
import hashlib
import json
import os
import platform
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE / "tests")]  # python -I drops the script directory

import rfc8785  # noqa: E402
from scene_fixture import BLOBS  # noqa: E402

from mujoco_worker.protocol import PROTOCOL  # noqa: E402
from mujoco_worker.session import WorkerSession, scene_digest_of  # noqa: E402

DRIVE = HERE / "fixtures" / "drive-v1"


def seal(d):
    d["digest"] = hashlib.sha256(rfc8785.dumps({k: v for k, v in d.items() if k != "digest"})).hexdigest()
    return d


def world_docs(variant):
    doc = lambda n: json.loads((DRIVE / n).read_text())
    am, ac, sm, sc = doc(f"xarm6-drive-{variant}-v1.json"), doc("xarm6-control-v1.json"), doc(f"serve-drive-{variant}-v1.json"), doc("serve-control-v1.json")
    ren = lambda axes: [{**a, "axisId": a["axisId"].replace("xarm-1/", "arm-1/")} for a in axes]
    model = seal({**am, "id": "world-drive-cost-v1", "axes": ren(am["axes"]) + sm["axes"]})
    control = seal({**ac, "id": "world-control-cost-v1", "plantModelDigest": "a" * 64, "driveModelDigests": [model["digest"]], "axes": ren(ac["axes"]) + sc["axes"], "controllers": ac["controllers"] + sc["controllers"]})
    return model, control


def session(directory, variant):
    for p in (HERE / "fixtures" / "coffee-delivery-world-v1").iterdir():
        if p.is_file():
            shutil.copy(p, directory / p.name)
    shutil.copytree(BLOBS, directory / "blobs")
    scene = json.loads((directory / "lab-world-scene.json").read_text())
    if variant:
        refs = {}
        for name, d, key in (("world-drive-cost-v1.json", world_docs(variant)[0], "driveModelRef"), ("world-control-cost-v1.json", world_docs(variant)[1], "controlProfileRef")):
            raw = (json.dumps(d, indent=2) + "\n").encode()
            (directory / name).write_bytes(raw)
            refs[key] = {"id": d["id"], "revision": 1, "path": name, "sha256": hashlib.sha256(raw).hexdigest()}
            scene["files"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        scene["engine"] = refs
        scene["sceneDigest"] = scene_digest_of(scene)
        (directory / "lab-world-scene.json").write_text(json.dumps(scene))
    return WorkerSession(run_id="cost", bundle_root=directory, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"]), scene


def run(variant, ticks):
    with tempfile.TemporaryDirectory() as tmp:
        s, scene = session(Path(tmp), variant)
        req = lambda op, payload, tick=0: {"protocol": PROTOCOL, "requestId": f"{op}-{tick}", "runId": "cost", "expectedTick": tick, "op": op, "payload": payload}
        assert s.handle(req("create", {"sceneRef": "lab-world-scene.json", "seed": 7}))["ok"]
        assert s.handle(req("start", {}))["ok"]
        home, ms = scene["armCell"]["arm"]["homeRad"], []
        e = s.engine
        lo, hi = e.arm.grip_range
        grip = lo + (hi - lo) * (1 - 0.0889 / e.opening_max_m)
        for k in range(ticks):
            if variant:
                cmds = [{"axisId": f"arm-1/J{i + 1}", "seq": k + 1, "mode": "csp", "target": q, "enable": True, "quickStop": False, "faultReset": False} for i, q in enumerate(home)]
                cmds += [{"axisId": "arm-1/gripper", "seq": k + 1, "mode": "csp", "target": grip, "enable": True, "quickStop": False, "faultReset": False}]
                cmds += [{"axisId": f"amr-1/wheel-{side}", "seq": k + 1, "mode": "csv", "target": 0.0, "enable": True, "quickStop": False, "faultReset": False} for side in ("left", "right")]
                payload = {"targetTick": k + 1, "velocities": [], "actorUpdates": [], "driveCommands": cmds}
            else:
                payload = {"targetTick": k + 1, "velocities": [{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}], "actorUpdates": [], "jointTargets": [{"armId": "arm-1", "positionsRad": home}], "gripperTargets": [{"armId": "arm-1", "openingM": 0.0889}]}
            if scene.get("controlContextVersion") == 1:
                payload["worldControl"] = {"version": 1, "program": None, "attachmentProxyPropId": None, "movementInterlocked": False, "stopLatched": False}
            t = time.perf_counter()
            r = s.handle(req("step", payload, k))
            ms.append((time.perf_counter() - t) * 1000)
            assert r["ok"], r
        s.end()
        return ms[20:]  # the first ticks of a nominal drive are its enable sequence


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ticks", type=int, default=600)
    ap.add_argument("--pairs", type=int, default=3)
    args = ap.parse_args()
    if args.out.exists():
        raise SystemExit("output exists; preserve earlier probe evidence")
    rows = []
    for pair in range(args.pairs):
        row = {"pair": pair + 1, "loadAverageBefore": os.getloadavg()[0]}
        for name, variant in (("legacy", None), ("driveNominal9Axes", "nominal")):
            ms = run(variant, args.ticks)
            row[name] = {"meanMs": round(statistics.fmean(ms), 4), "p50Ms": round(statistics.median(ms), 4), "p95Ms": round(sorted(ms)[int(0.95 * len(ms))], 4)}
            print(pair + 1, name, row[name], flush=True)
        row["deltaMeanMs"] = round(row["driveNominal9Axes"]["meanMs"] - row["legacy"]["meanMs"], 4)
        row["deltaP50Ms"] = round(row["driveNominal9Axes"]["p50Ms"] - row["legacy"]["p50Ms"], 4)
        rows.append(row)
    out = {"machine": platform.machine(), "python": platform.python_version(), "ticksPerRun": args.ticks, "scope": "WorkerSession.handle of the cell world; runtime, recorder and fsync are not in it", "pairs": rows,
           "deltaMeanMsAcrossPairs": round(statistics.fmean(r["deltaMeanMs"] for r in rows), 4), "accepted": False, "calibration": "not_calibrated"}
    args.out.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
