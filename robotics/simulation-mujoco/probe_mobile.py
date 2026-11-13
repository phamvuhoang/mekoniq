"""Bounded real-engine measurement probe; no campaign/qualification verdict.

Run with the pinned Python and PYTHONDONTWRITEBYTECODE=1. Raw gzip NDJSON holds
every tick's command, engine pose/twist, wheels, independent odometry, contacts
and payloads. It deliberately excludes the bulky LiDAR arrays (tested separately).
"""
import argparse
import gzip
import hashlib
import json
import math
import platform
import time
from pathlib import Path

import mujoco
import numpy as np

from mujoco_worker.mobile_engine import MobileEngine
from mujoco_worker.session import scene_digest_of

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "serve-payload-v1"
LOADS = ("empty", "cup-center", "cup-offset")
CASES = ("hold", "straight", "circle", "stop")


def targets(case, tick):
    if case == "hold" or tick < 100 or tick >= (300 if case == "stop" else 400):
        return 0.0, 0.0
    ramp = min(1.0, (tick - 99) / 50)
    return ((.5 if case == "stop" else .2) * ramp, .4 * ramp if case == "circle" else 0.0)


def run_case(case, load, repeat, out):
    read = lambda name: json.loads((FIXTURE / (name + ".json")).read_text())
    scene, model, profile, physics = read("navigation-scene"), read("physical-model-amr-1"), read(load), read("drive-contact-profile")
    scene["engine"]["loadProfileRef"].update(id=profile["id"], revision=profile["revision"], path=load+".json", sha256=hashlib.sha256((FIXTURE/(load+".json")).read_bytes()).hexdigest())
    scene["sceneDigest"] = scene_digest_of(scene)
    engine = MobileEngine(scene, {"amr-1": model}, profile, physics)
    filename = f"{load}-{case}-r{repeat}.ndjson.gz"
    elapsed, poses, load_poses, residuals, slips, tilts, speeds = [], [], [], [], [], [], []
    saturation, peak, stop_length, last, stopped_ticks, stopped_at = 0, 0.0, 0.0, None, 0, None
    stop_tick = 300 if case == "stop" else 400
    baseline_load = engine.read()["loads"]
    base_load = np.array(baseline_load[0]["poseInSupport"]["positionM"]) if baseline_load else None
    with (out / filename).open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as raw:
        identity = {"record": "identity", "case": case, "load": load, "repeat": repeat, "engineVersion": mujoco.__version__, "seed": 7,
                    "inputs": {name: hashlib.sha256((FIXTURE/name).read_bytes()).hexdigest() for name in ("navigation-scene.json", "physical-model-amr-1.json", load+".json", "drive-contact-profile.json")},
                    "physicsProfile": physics, "navigationScene": scene, "compiledSceneDigest": scene["sceneDigest"], "modelReadback": engine.readback(), "initialLoads": baseline_load, "initialBase": engine.read()["base"], "engineClock": "(tick+1)*0.02", "logicalTickMs": 20,
                    "limits": {"repeatPositionM": 1e-6, "repeatAngleRad": 1e-6}, "limitations": ["not_calibrated", "fixed sphere casters with explicit sliding contact pairs", "LiDAR raw arrays excluded; covered by focused independent-raycast test"]}
        raw.write((json.dumps(identity, separators=(",", ":"), allow_nan=False) + "\n").encode())
        for tick in range(500):
            command = targets(case, tick)
            start = time.perf_counter()
            reading = engine.step(*command)
            elapsed.append((time.perf_counter() - start) * 1000)
            reading["robot"] = {k: v for k, v in reading["robot"].items() if k != "scans"}
            raw.write((json.dumps({"record": "tick", "tick": tick, "simTimeNs": str(tick*20_000_000), "command": list(command), **reading}, separators=(",", ":"), allow_nan=False) + "\n").encode())
            p = reading["robot"]["poseDriveMap"]
            poses.append([*reading["base"]["poseMap"]["positionM"], *reading["base"]["poseMap"]["quaternionXyzw"]])
            load_poses.append([[*l["poseMap"]["positionM"], *l["poseMap"]["quaternionXyzw"]] for l in reading["loads"]])
            odom = reading["odometry"]
            residuals.append([math.hypot(p[0]-odom[0], p[1]-odom[1]), abs(math.atan2(math.sin(p[2]-odom[2]), math.cos(p[2]-odom[2])))])
            tilts.append(max(abs(reading["base"]["rollRad"]), abs(reading["base"]["pitchRad"])))
            slips.append(float(np.linalg.norm(np.array(reading["loads"][0]["poseInSupport"]["positionM"])[:2]-base_load[:2])) if base_load is not None else 0.0)
            saturation += reading["wheel"]["saturatedSubsteps"]
            peak = max(peak, max((c["peakNormalN"] for c in reading["contacts"]), default=0))
            v, w = reading["robot"]["bodyVelocity"]
            speeds.append([abs(v), abs(w)])
            if case != "hold" and tick >= stop_tick:
                if last is not None and stopped_at is None:
                    stop_length += math.hypot(p[0]-last[0], p[1]-last[1])
                stopped_ticks = stopped_ticks + 1 if abs(v) < .01 and abs(w) < .02 else 0
                if stopped_ticks >= 5 and stopped_at is None:
                    stopped_at = tick
            last = p
    metrics = {"case": case, "load": load, "repeat": repeat, "ticks": 500, "finite": True, "maxTiltRad": max(tilts), "maxLoadDisplacementM": max(slips) if base_load is not None else None,
               "maxOdomResidualM": max(x[0] for x in residuals), "maxOdomResidualRad": max(x[1] for x in residuals), "saturatedSubsteps": saturation, "peakPairNormalN": peak,
               "stepP95Ms": float(np.percentile(elapsed, 95)), "finalPoseDriveMap": last, "finalBodySpeed": speeds[-1], "stopDistanceM": stop_length if stopped_at is not None else None,
               "stoppedAtTick": stopped_at, "raw": {"path": filename, "sha256": hashlib.sha256((out/filename).read_bytes()).hexdigest(), "bytes": (out/filename).stat().st_size}}
    engine.close()
    return metrics, np.array(poses), np.array(load_poses)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit("output exists; preserve earlier probe evidence")
    args.out.mkdir(parents=True)
    runs, repeats = [], []
    for load in LOADS:
        for case in CASES:
            first_base = first_load = None
            for repeat in range(1, 4):
                metrics, base, payload = run_case(case, load, repeat, args.out)
                if first_base is None:
                    first_base, first_load = base, payload
                position = float(np.max(abs(base[:,:3]-first_base[:,:3])))
                # Quaternion relative angle, sign-independent. Clamp numerical dot.
                angle = float(np.max(2*np.arccos(np.clip(np.abs(np.sum(base[:,3:]*first_base[:,3:], axis=1)),0,1))))
                if payload.size:
                    position = max(position, float(np.max(abs(payload[:,:,:3]-first_load[:,:,:3]))))
                    angle = max(angle, float(np.max(2*np.arccos(np.clip(np.abs(np.sum(payload[:,:,3:]*first_load[:,:,3:], axis=2)),0,1)))))
                repeats.append({"load": load, "case": case, "repeat": repeat, "maxPositionDifferenceM": position, "maxAngleDifferenceRad": angle, "pass": position <= 1e-6 and angle <= 1e-6})
                runs.append(metrics)
                print(json.dumps(metrics, separators=(",", ":")), flush=True)
    summary = {"schemaVersion": 1, "accepted": False, "calibration": "not_calibrated", "engineVersion": mujoco.__version__, "pythonVersion": platform.python_version(), "machine": platform.machine(),
               "platform": platform.platform(), "repeats": repeats, "runs": runs, "measurementChecks": {"allFinite": all(r["finite"] for r in runs), "repeatWithinTolerance": all(r["pass"] for r in repeats)},
               "limitations": ["measurement probe only; no campaign, hardware, native, payload safety or human acceptance", "hold case runs 10 seconds; each maneuver includes 2s hold, bounded ramp and stop", "timings are host observations, not realtime guarantees"]}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
