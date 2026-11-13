"""The real MuJoCo worker (protocol, session, receipts, refusals) over a fake cell engine, so no MuJoCo is imported. argv: fake_cell_plant.py MODE N [worker args...]
MODE ok: the arm reaches every target at once, the gripper its commanded opening, a placed cup stays where it was put, nothing touches anything. quit: the whole process exits
cleanly at engine step N. unstable: engine step N reports a bad state (the worker answers PLANT_UNSTABLE, fatal). crash: at engine step N the process writes a traceback line with an
absolute path to stderr and exits 1. boom: engine step N raises an exception whose message names a file (the worker answers WORKER_FAILED). badcreate: the engine refuses to compile (MESH_BLOB_MISSING). narrow: the engine's gripper range is 0.05 m, so every step carrying
the full opening is refused (GRIPPER_TARGET_OUT_OF_RANGE, non-fatal). Every engine step (the create's priming step is the first) appends
{n, targets, opening, placements} to steps.jsonl in the run directory."""
import json
import os
import sys
import types

mode, at = sys.argv[1], int(sys.argv[2])
sys.argv = [sys.argv[0], *sys.argv[3:]]

from mujoco_worker.compile import CompileError  # noqa: E402


class Fake:
    def __init__(self, scene, component, physics, blob_dir):
        if mode == "badcreate":
            raise CompileError("MESH_BLOB_MISSING", "fake engine")
        chain = [j for j in component["joints"] if j["id"] in ("J1", "J2", "J3", "J4", "J5", "J6")]
        self.arm_limits = [(j["limits"]["lower"]["value"], j["limits"]["upper"]["value"]) for j in chain]
        self.opening_max_m = 0.05 if mode == "narrow" else physics["gripper"]["openingMaxM"]
        self.opening, self.time, self.count, self.cups = self.opening_max_m, 0.0, 0, {}

    def step(self, targets, opening, placements):
        self.count += 1
        with open("steps.jsonl", "a") as f:
            f.write(json.dumps({"n": self.count, "targets": list(targets), "opening": opening, "placements": [[p, pose] for p, pose in placements]}) + "\n")
        if mode == "quit" and self.count == at:
            os._exit(0)
        if mode == "crash" and self.count == at:
            sys.stderr.write('Traceback (most recent call last):\n  File "/Users/someone/private/mujoco_worker/engine.py", line 1, in step\nRuntimeError: engine died\n')
            sys.stderr.flush()
            os._exit(1)
        if mode == "boom" and self.count == at:
            raise RuntimeError("could not read /Users/someone/private/cell/engine-state.bin")
        self.time += 0.02
        if opening is not None:
            self.opening = opening
        for pid, pose in placements:
            if pose is None:
                self.cups.pop(pid, None)
            else:
                self.cups[pid] = pose
        return {"time": self.time, "arm": {"positions": list(targets), "velocities": [0.0] * len(targets)}, "gripper": {"positions": [0.0], "velocities": [0.0], "openingM": self.opening},
                "props": {pid: {"position": list(p["position"]), "quaternionXyzw": list(p["quaternionXyzw"]), "speed": 0.0} for pid, p in self.cups.items()},
                "contacts": [], "tickContacts": [], "unstable": "fake" if mode == "unstable" and self.count == at else None}

    def readback(self):
        return None

    def close(self):
        pass


engine = types.ModuleType("mujoco_worker.engine")
engine.MujocoEngine, engine.engine_version = Fake, lambda: "3.17.0"
sys.modules["mujoco_worker.engine"] = engine
from mujoco_worker import __main__ as worker  # noqa: E402

raise SystemExit(worker.main())
