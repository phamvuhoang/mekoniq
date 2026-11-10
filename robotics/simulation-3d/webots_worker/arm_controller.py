"""Extern Webots controller of the ARM, run as its own process by the worker (never by Webots). NDJSON on stdin: {"cmd": "step", "targets": [q1..qn]} sets each joint's target position, steps the
engine by one 20 ms tick (the engine only advances when every synchronised controller has stepped) and answers the joint positions and velocities read from the position sensors.
Velocity is the difference of two consecutive sensor values over the tick; the first reply has none and reports zero. Everything else goes to stderr."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.environ["WEBOTS_HOME"], "Contents", "lib", "controller", "python"))  # -I ignores PYTHONPATH, so the path is explicit
from controller import Robot  # noqa: E402

TICK_MS = 20
cfg = json.loads(sys.argv[1])
robot = Robot()
motors = [robot.getDevice(f"J{i}_motor") for i in range(1, cfg["joints"] + 1)]
sensors = [robot.getDevice(f"J{i}_sensor") for i in range(1, cfg["joints"] + 1)]
for s in sensors:
    s.enable(TICK_MS)
sys.stdout.write(json.dumps({"ready": True}) + "\n")
sys.stdout.flush()
previous = None
for line in sys.stdin:
    cmd = json.loads(line)
    if cmd["cmd"] == "quit":
        break
    for m, q in zip(motors, cmd["targets"]):
        m.setPosition(float(q))
    if robot.step(TICK_MS) < 0:  # the engine is gone
        sys.exit(3)
    positions = [s.getValue() for s in sensors]
    velocities = [0.0] * len(positions) if previous is None else [(a - b) / (TICK_MS / 1000.0) for a, b in zip(positions, previous)]
    previous = positions
    sys.stdout.write(json.dumps({"time": robot.getTime(), "positions": positions, "velocities": velocities}) + "\n")  # NaN is written as NaN: both ends of this pipe are Python
    sys.stdout.flush()
