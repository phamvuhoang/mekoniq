"""Extern Webots controller of ONE robot, run as its own process by the worker (never by Webots). Commands arrive as NDJSON on stdin, one reply per command on stdout.
It sets the two wheel velocities, steps the engine by one 20 ms tick (the engine only advances when every synchronised controller has stepped) and reports the wheel
position sensors and, when asked, the LiDAR range images. Everything else goes to stderr."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.environ["WEBOTS_HOME"], "Contents", "lib", "controller", "python"))  # -I ignores PYTHONPATH, so the path is explicit
from controller import Robot  # noqa: E402

TICK_MS = 20
cfg = json.loads(sys.argv[1])
robot = Robot()
motors = [robot.getDevice("left_wheel_motor"), robot.getDevice("right_wheel_motor")]
for m in motors:
    m.setPosition(float("inf"))
    m.setVelocity(0.0)
sensors = [robot.getDevice("left_wheel_sensor"), robot.getDevice("right_wheel_sensor")]
lidars = {name: robot.getDevice(name) for name in cfg["lidars"]}
for d in [*sensors, *lidars.values()]:
    d.enable(TICK_MS)
sys.stdout.write(json.dumps({"ready": True}) + "\n")
sys.stdout.flush()
for line in sys.stdin:
    cmd = json.loads(line)
    if cmd["cmd"] == "quit":
        break
    motors[0].setVelocity(float(cmd["left"]))
    motors[1].setVelocity(float(cmd["right"]))
    if robot.step(TICK_MS) < 0:  # the engine is gone
        sys.exit(3)
    out = {"time": robot.getTime(), "wheelPositions": [s.getValue() for s in sensors], "lidar": {n: d.getRangeImage() for n, d in lidars.items()} if cmd["lidar"] else None}
    sys.stdout.write(json.dumps(out) + "\n")  # inf in a range image is written as Infinity: both ends of this pipe are Python
    sys.stdout.flush()
