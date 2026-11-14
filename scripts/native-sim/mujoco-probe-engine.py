"""Observer-only harness, never a replacement subject worker. Runs only inside an admitted image.
M00 imports verbatim frozen recipe blocks. Bad-state uses the original WorkerSession and engine;
only one real qvel element is fault-injected. No Source custody assertion is made here.
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import resource
import sys
import time

MODE, OUT = sys.argv[1], Path(sys.argv[2])
OUT.mkdir(exist_ok=True, parents=True)

def save(name, value):
    (OUT / name).write_text(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")

try:
    import mujoco
    import numpy as np
    if mujoco.__version__ != "3.17.0":
        raise RuntimeError("ENGINE_VERSION_MISMATCH")
    if MODE == "inventory":
        artifacts = []
        root = Path(mujoco.__file__).parent
        for path in sorted(root.rglob("*")):
            if path.is_file() and ("libmujoco" in path.name or path.name == "__init__.py"):
                b = path.read_bytes()
                artifacts.append({"path": str(path), "bytes": len(b), "digest": "sha256:" + hashlib.sha256(b).hexdigest()})
        save("engine.json", {"version": mujoco.__version__, "python": sys.version, "artifacts": artifacts,
                             "packages": sorted({d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}.items())})
    elif MODE in ("m00", "long_run"):
        sys.path.insert(0, "/probe/m00")
        import run as recipe
        if MODE == "m00":
            seed = int(sys.argv[3])
            sys.argv = ["/probe/m00/run.py", "trials", json.dumps({"seeds": [seed], "dump": str(OUT / "trace")})]
            recipe.main()
        else:
            P, T = dict(recipe.scene.DEFAULTS), recipe.tunables({})
            m = mujoco.MjModel.from_xml_string(recipe.scene.build(P))
            W, _ = recipe.waypoints(m, P, T)
            sim, tick_ms, samples = recipe.Sim(P, W["home"]), [], []
            for tick in range(180000):
                sim.tick(W["home"], "hold")
                tick_ms.append(sim.log[-1]["ms"])
                if tick % 1000 == 0:
                    samples.append({"tick": tick + 1, "engineTimeS": float(sim.d.time), "q": sim.log[-1]["q"], "cup": sim.log[-1]["cup"]})
                # Clear the observer log only; the real engine state and clock are never reset.
                sim.log.clear()
            save("result.json", {"scope": "frozen_m00_recipe", "engineVersion": mujoco.__version__, "ticks": 180000,
                                 "substeps": 1800000, "driftS": float(sim.d.time) - 3600.0,
                                 "tickMs": tick_ms, "warnings": sim.warnings(), "lastPose": sim.d.qpos[:6].tolist(),
                                 "samples": samples, "maxRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    elif MODE == "bad_state":
        sys.path.insert(0, "/app/robotics/simulation-mujoco")
        from mujoco_worker.session import WorkerSession
        from mujoco_worker.engine import BAD_STATE
        from mujoco_worker.protocol import load_validators
        from mujoco_worker.compile import compile_cell
        bundle = Path("/probe/bad-state-bundle")
        scene = json.loads((bundle / "arm-cell-scene.json").read_text())
        component = json.loads((bundle / "component.json").read_text())
        physics = json.loads((bundle / "physics.json").read_text())
        (OUT / "compiled.xml").write_text(compile_cell(scene, component, physics, str(bundle / "blobs"))[0])
        session = WorkerSession(run_id="native-bad-state", bundle_root=str(bundle), lock_digest=hashlib.sha256(Path("/app/robotics/simulation-mujoco/requirements.lock").read_bytes()).hexdigest(), expected_scene_digest=scene["sceneDigest"])
        validator, _ = load_validators("/app/packages/contracts/schemas")
        requests, responses = [], []
        def call(op, payload=None):
            request = {"protocol": "mekoniq-sim3d/1", "requestId": "probe-" + str(len(requests)), "runId": "native-bad-state", "expectedTick": session.tick, "op": op, "payload": payload or {}}
            validator.validate(request)
            requests.append(request)
            response = session.handle(request)
            responses.append(response)
            save("requests.json", requests)
            save("responses.json", responses)
            return response
        created = call("create", {"sceneRef": "arm-cell-scene.json", "seed": 42, "arms": [{"armId": "arm-1", "sceneRef": "arm-cell-scene.json"}]})
        started = call("start")
        if not created["ok"] or not started["ok"]:
            raise RuntimeError("BAD_STATE_CREATE_FAILED")
        data = session.engine.data
        before = {"tick": session.tick, "state": session.state}
        old_warnings = {k: int(data.warning[w].number) for k, w in BAD_STATE.items()}
        np.savez(OUT / "before-state.npz", qpos=data.qpos.copy(), qvel=data.qvel.copy(), qacc=data.qacc.copy(), ctrl=data.ctrl.copy())
        data.qvel[session.engine.arm_qvel[0]] = float("nan")
        np.savez(OUT / "injected-state.npz", qpos=data.qpos.copy(), qvel=data.qvel.copy(), qacc=data.qacc.copy(), ctrl=data.ctrl.copy())
        payload = {"targetTick": 1, "velocities": [], "actorUpdates": [], "jointTargets": [{"armId": "arm-1", "positionsRad": scene["arm"]["homeRad"]}]}
        t0 = time.perf_counter()
        response = call("step", payload)
        elapsed = (time.perf_counter() - t0) * 1000
        after = {"tick": session.tick, "state": session.state}
        warnings = {k: int(data.warning[w].number) - old_warnings[k] for k, w in BAD_STATE.items()}
        np.savez(OUT / "after-state.npz", qpos=data.qpos.copy(), qvel=data.qvel.copy(), qacc=data.qacc.copy(), ctrl=data.ctrl.copy())
        post_fault = call("step", payload)
        save("result.json", {"scope": "instrumented_historical_worker", "engineVersion": mujoco.__version__, "injection": {"kind": "qvel_nan", "atTick": 1}, "before": before, "after": after,
                             "response": response, "postFault": post_fault, "warningDelta": warnings, "elapsedMs": elapsed})
        session.end()
    else:
        raise RuntimeError("UNKNOWN_PROBE_MODE")
finally:
    save("resource.json", {"maxRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
