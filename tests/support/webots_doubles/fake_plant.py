"""The real Webots worker (protocol, session, receipts) over a fake engine that can misbehave on request. argv: fake_plant.py MODE N [worker args...]
MODE unstable: from engine step N the base pitches 1.2 rad. lag: engine step N takes 1 s. quit: the whole process exits cleanly (code 0) at engine step N (an operator who quits Webots).
MODE ok: never misbehaves. The robot stands at its spawn; nothing else of the physics is simulated."""
import math
import os
import sys
import time

mode, at = sys.argv[1], int(sys.argv[2])
sys.argv = [sys.argv[0], *sys.argv[3:]]

from webots_worker import __main__ as worker  # noqa: E402
from webots_worker import engine  # noqa: E402


class Fake:
    version, executable_sha256 = "R2025a", "a" * 64

    def __init__(self, world, config):
        self.config, self.time, self.count = config, 0.0, 0

    def start(self):
        pass

    def step(self, commands, lidar):
        self.count += 1
        if mode == "quit" and self.count == at:
            os._exit(0)
        if mode == "lag" and self.count == at:
            time.sleep(1.0)
        pitch = 1.2 if mode == "unstable" and self.count >= at else 0.0
        c, s = math.cos(pitch), math.sin(pitch)
        self.time += 0.02
        robots = {}
        for r in self.config["robots"]:
            robots[r["id"]] = {"position": [2.0, 1.5, 0.09], "orientation": [c, 0, s, 0, 1, 0, -s, 0, c], "velocity": [0.0] * 6, "wheelPositions": [0.0, 0.0],
                               "lidar": {l["name"]: [3.0] * l["beams"] for l in r["lidars"]} if lidar else None}
        return {"time": self.time, "robots": robots, "contacts": []}

    def readback(self):
        return {"robots": []}

    def close(self):
        pass


engine.WebotsEngine = Fake
raise SystemExit(worker.main())
