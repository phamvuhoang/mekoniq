"""The real Webots worker (protocol, session, receipts) over a fake ARM engine that can misbehave on request. argv: fake_arm_plant.py MODE N [worker args...]
MODE ok: the arm reaches every target at once. lag: it is one tick behind (and J1 sits 0.005 rad off). stuck: it never moves. quit: the whole process exits cleanly at engine step N (an operator who
quits Webots). nan: from engine step N the arm reports NaN. floor: from engine step N a link reports a contact on the floor plane. Every step appends its targets to steps.jsonl in the run directory."""
import json
import math
import os
import sys

mode, at = sys.argv[1], int(sys.argv[2])
sys.argv = [sys.argv[0], *sys.argv[3:]]

from webots_worker import __main__ as worker  # noqa: E402
from webots_worker import engine  # noqa: E402


class Fake:
    version, executable_sha256 = "R2025a", "a" * 64

    def __init__(self, world, config):
        self.config, self.time, self.count, self.q, self.last = config, 0.0, 0, None, None

    def start(self):
        pass

    def step_arm(self, targets):
        self.count += 1
        with open("steps.jsonl", "a") as f:
            f.write(json.dumps({"n": self.count, "targets": targets}) + "\n")
        if mode == "quit" and self.count == at:
            os._exit(0)
        self.time += 0.02
        if self.q is None:
            self.q = list(targets)
        if mode == "stuck":
            pass
        elif mode == "lag":
            prev = self.last if self.last is not None else list(targets)
            self.q = [targets[0] + 0.005 if i == 0 else prev[i] for i in range(len(targets))]
            self.last = list(targets)
        else:
            self.q = list(targets)
        q = [math.nan] * len(targets) if mode == "nan" and self.count >= at else list(self.q)
        contacts = [{"solid": "link3", "point": [2.0, 1.0, 0.0]}] if mode == "floor" and self.count >= at else []
        return {"time": self.time, "arm": {"positions": q, "velocities": [0.0] * len(q)}, "armContacts": contacts}

    def readback(self):
        return {"robots": []}

    def close(self):
        pass


engine.WebotsEngine = Fake
raise SystemExit(worker.main())
