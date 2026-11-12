"""The real MuJoCo worker (protocol, session, receipts, refusals) over a fake cell engine, so no MuJoCo is imported. argv: fake_cell_plant.py MODE N [worker args...]
MODE ok: the arm reaches every target at once, the gripper its commanded opening, a placed cup stays where it was put, nothing touches anything. quit: the whole process exits
cleanly at engine step N. badcreate: the engine refuses to compile (MESH_BLOB_MISSING). Every engine step (the create's priming step is the first) appends
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
        self.opening_max_m = physics["gripper"]["openingMaxM"]
        self.opening, self.time, self.count, self.cups = self.opening_max_m, 0.0, 0, {}

    def step(self, targets, opening, placements):
        self.count += 1
        with open("steps.jsonl", "a") as f:
            f.write(json.dumps({"n": self.count, "targets": list(targets), "opening": opening, "placements": [[p, pose] for p, pose in placements]}) + "\n")
        if mode == "quit" and self.count == at:
            os._exit(0)
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
                "contacts": [], "tickContacts": [], "unstable": None}

    def readback(self):
        return None

    def close(self):
        pass


engine = types.ModuleType("mujoco_worker.engine")
engine.MujocoEngine, engine.engine_version = Fake, lambda: "3.17.0"
sys.modules["mujoco_worker.engine"] = engine
from mujoco_worker import __main__ as worker  # noqa: E402

raise SystemExit(worker.main())
