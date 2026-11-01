"""Gazebo Harmonic + Nav2 restaurant scenarios through the real stack: Executor -> Nav2Navigation -> RclpyActionClient -> Nav2 -> Gazebo.

navigate, load, obstacle, replan, handoff, return; blocked timeout, localization lost, map change. SIMULATION evidence only (illustrative world and
geometry): it proves nothing about a real robot, payload, safety rating or VDA compatibility, and the unit fakes in robotics/agent/tests do NOT
satisfy this gate. Needs ROS 2 Jazzy + Gazebo Harmonic on Linux; the whole module is SKIPPED, with the reason, when rclpy / gz / the workspace are
missing (e.g. macOS). `MEKONIQ_SIM_EXTERNAL=1` reuses an already running `restaurant_sim.launch.py` instead of launching one."""
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

rclpy = pytest.importorskip("rclpy", reason="SKIPPED: rclpy (ROS 2 Jazzy) is not importable; Gazebo/Nav2 scenarios need Linux with ROS 2 Jazzy + Gazebo Harmonic")
AGENT = Path(__file__).resolve().parents[2] / "agent"
sys.path.insert(0, str(AGENT))
from mekoniq_agent.executor import Executor  # noqa: E402
from mekoniq_agent.nav2_adapter import Nav2Config, Nav2Navigation  # noqa: E402
from mekoniq_agent.nav2_rclpy import RclpyActionClient  # noqa: E402
from tests.support.executor_fixtures import command_fixture, profile_fixture  # noqa: E402

GZ = shutil.which("gz") or next(iter(sorted(Path("/opt/ros").glob("*/opt/gz_tools_vendor/bin/gz"))), None)
if not GZ:
    pytest.skip("SKIPPED: Gazebo Harmonic `gz` CLI not found; scenarios need Gazebo Harmonic", allow_module_level=True)
NS = "robot_1"
SIM_LOG = os.environ.get("MEKONIQ_SIM_LOG", "/tmp/restaurant_sim.log")
IDENTITY = json.loads((Path(__file__).resolve().parents[2] / "navigation" / "maps" / "restaurant_sim.identity.json").read_text())
WP = IDENTITY["waypoints"]
PROFILE = profile_fixture(robot_id="robot-1", map_id=IDENTITY["mapId"], map_revision=IDENTITY["mapRevision"])
CONFIG = Nav2Config.for_profile(PROFILE, namespace=NS)


def ros2(*args):
    return subprocess.run(["ros2", *args], capture_output=True, text=True, timeout=60).returncode == 0


def bring_up():
    """Nav2's documented lifecycle STARTUP command: retries a bring-up that lost a startup race on a busy host (harmless when already active)."""
    for manager in ("lifecycle_manager_localization", "lifecycle_manager_navigation"):
        ros2("service", "call", f"/{NS}/{manager}/manage_nodes", "nav2_msgs/srv/ManageLifecycleNodes", "{command: 0}")


def gz(*args, timeout=20):
    return subprocess.run([GZ, *args], capture_output=True, text=True, timeout=timeout).stdout


def poses():
    out = gz("topic", "-e", "-n", "1", "-t", "/world/restaurant/dynamic_pose/info")
    found = {}
    for m in re.finditer(r'pose \{\s+name: "([^"]+)"\s+id: \d+\s+position \{(.*?)\}', out, re.S):
        xy = dict(re.findall(r"([xy]): ([-\d.e+]+)", m.group(2)))
        found[m.group(1)] = (float(xy.get("x", 0)), float(xy.get("y", 0)))
    return found


def place(name, x, y):
    gz("service", "-s", "/world/restaurant/set_pose", "--reqtype", "gz.msgs.Pose", "--reptype", "gz.msgs.Boolean", "--timeout", "3000",
       "--req", f'name: "{name}", position: {{x: {x}, y: {y}, z: 0.52}}')


def walker(vy):
    gz("topic", "-t", "/model/walker/cmd_vel", "-m", "gz.msgs.Twist", "-p", f"linear: {{y: {vy}}}")


class Watch:
    """Samples ground-truth distances between the robot and a named obstacle (Gazebo pose, not AMCL) and the odometry speed."""
    def __init__(self, client, obstacle=None):
        from nav_msgs.msg import Odometry
        self.obstacle, self.min_dist, self.max_speed, self._stop = obstacle, math.inf, 0.0, threading.Event()
        self.sub = client.node.create_subscription(Odometry, f"/{NS}/odom", self._odom, 10)
        self.thread = threading.Thread(target=self._poll, daemon=True)

    def _odom(self, m):
        self.max_speed = max(self.max_speed, abs(m.twist.twist.linear.x))

    def _poll(self):
        while not self._stop.is_set():
            p = poses()
            if self.obstacle and "robot" in p and self.obstacle in p:
                self.min_dist = min(self.min_dist, math.dist(p["robot"], p[self.obstacle]))

    def __enter__(self):
        if self.obstacle:
            self.thread.start()
        return self

    def __exit__(self, *_):
        self._stop.set()


@pytest.fixture(scope="module")
def sim():
    proc = None
    if os.environ.get("MEKONIQ_SIM_EXTERNAL") != "1":
        proc = subprocess.Popen(["ros2", "launch", "mekoniq_simulation", "restaurant_sim.launch.py", "headless:=true", f"namespace:={NS}"],
                                stdout=open(SIM_LOG, "w"), stderr=subprocess.STDOUT, start_new_session=True)  # Nav2/Gazebo log: read it when a scenario fails
    client = RclpyActionClient(CONFIG)
    adapter = Nav2Navigation(client, CONFIG)
    start = time.time()
    deadline, why, retried = start + 300, "not started", start
    while time.time() < deadline:
        try:
            why = adapter.not_ready_reason()
        except Exception as e:
            why = f"probe: {e}"
        if why is None:
            break
        if time.time() - retried > 45:
            retried = time.time()
            bring_up()
        time.sleep(2)
    else:
        pytest.fail(f"Nav2 never became ready: {why}")
    yield client
    client.close()
    if proc:
        os.killpg(proc.pid, signal.SIGINT)
        proc.wait(60)


@pytest.fixture
def agent(sim, tmp_path):
    ex = Executor(tmp_path / "agent.db", Nav2Navigation(sim, CONFIG), PROFILE)
    yield ex
    ex.close()


def command(cid, waypoint, epoch=3, speed=None):
    x, y, yaw = WP[waypoint]
    limits = {"trays": 1, "maxLoadMinor": "5000", **({"speedLimitMps": speed} if speed else {})}
    return command_fixture(command_id=cid, control_epoch=epoch, limits=limits, ttl_ms=120000,
                           target={"waypointId": waypoint, "mapId": PROFILE.map_id, "mapRevision": PROFILE.map_revision, "frame": "map", "x": x, "y": y, "yaw": yaw})


def accept(agent, cmd):
    result = agent.submit(cmd)
    assert result["accepted"] is True, result  # the refusal reason is the failure message
    return result


def settle(agent, cid, timeout=150):
    end = time.time() + timeout
    while time.time() < end:
        state = agent.tick().get(cid) or agent.state(cid)
        if state["status"] in ("terminal", "unknown"):
            return state
        time.sleep(1)
    return agent.state(cid)


def at(waypoint, tol=0.45):
    return math.dist(poses()["robot"], WP[waypoint][:2]) <= tol


def test_01_navigate_kitchen_to_table(agent):
    accept(agent, command("nav-1", "table-1"))
    state = settle(agent, "nav-1")
    assert state["completed"] is True, state
    assert state["evidence"]["native"]["errorCode"] == 0
    assert at("table-1")  # ground truth from Gazebo, not AMCL


def test_02_load_speed_limit_is_honoured(agent, sim):
    with Watch(sim) as w:
        accept(agent, command("load-1", "table-2", speed=0.25))
        state = settle(agent, "load-1")
    print(f"EVIDENCE load max_speed_mps={w.max_speed:.3f} limit=0.25")
    assert state["completed"] is True and 0.0 < w.max_speed <= 0.25 * 1.3, (w.max_speed, state)


def test_03_moving_obstacle_is_never_hit(agent, sim):
    walker(-0.4)
    try:
        with Watch(sim, "walker") as w:
            accept(agent, command("obs-1", "table-3"))
            state = settle(agent, "obs-1")
    finally:
        walker(0.0)
    print(f"EVIDENCE obstacle min_robot_walker_m={w.min_dist:.2f} status={state['status']} completed={state['completed']}")
    assert w.min_dist > 0.35, w.min_dist
    assert state["status"] in ("terminal", "unknown")  # completed after the walker passed, or a safe non-completion; never a collision


def test_04_blocked_path_replans(agent, sim):
    place("blocker", 8.5, 4.0)
    with Watch(sim, "blocker") as w:
        accept(agent, command("replan-1", "table-4"))
        state = settle(agent, "replan-1")
    place("blocker", 9.0, 0.6)
    print(f"EVIDENCE replan min_robot_blocker_m={w.min_dist:.2f}")
    assert state["completed"] is True, state
    assert w.min_dist > 0.35, w.min_dist


def test_05_control_handoff_waits_for_previous_goal_and_epoch(agent, sim):
    accept(agent, command("hand-1", "table-1"))
    refused = agent.submit(command("hand-2", "table-2", epoch=4))
    assert refused["accepted"] is False and refused["reason"] == "PREVIOUS_GOAL_ACTIVE"  # authority never transfers while a goal is live
    assert agent.cancel("hand-1")["acknowledged"] is True
    state = settle(agent, "hand-1", 30)
    assert state["status"] == "terminal" and state["completed"] is False  # cancel confirmed by Nav2's own status, not by the request
    accept(agent, command("hand-2", "table-2", epoch=4))
    state = settle(agent, "hand-2")
    assert state["completed"] is True, state


def test_06_return_to_kitchen_through_the_corridor(agent):
    accept(agent, command("ret-1", "kitchen-pickup", epoch=4))
    state = settle(agent, "ret-1", 240)
    assert state["completed"] is True, state
    assert at("kitchen-pickup")


def test_07_blocked_corridor_never_completes_and_cancel_is_confirmed(agent, sim):
    place("blocker", 4.0, 4.0)  # the only route from the kitchen
    try:
        with Watch(sim, "blocker") as w:
            accept(agent, command("blk-1", "table-1", epoch=4))
            state = settle(agent, "blk-1", 60)
            assert state["completed"] is False
            if state["status"] not in ("terminal", "unknown"):
                assert agent.cancel("blk-1")["acknowledged"] is True
                state = settle(agent, "blk-1", 30)
        print(f"EVIDENCE blocked status={state['status']} outcome={state['evidence']['outcome']} reason={state['evidence']['reason']} min_robot_blocker_m={w.min_dist:.2f}")
        assert state["completed"] is False and w.min_dist > 0.35
    finally:
        place("blocker", 9.0, 0.6)


def test_08_localization_lost_refuses_new_goals(agent, sim):
    adapter = Nav2Navigation(sim, CONFIG)
    assert adapter.not_ready_reason() is None
    try:
        assert any(ros2("lifecycle", "set", f"/{NS}/amcl", "deactivate") or time.sleep(2) for _ in range(5)) or adapter.not_ready_reason(), "could not take AMCL down"
        reason = adapter.not_ready_reason()  # the manager may take map_server down too when AMCL's bond breaks
        assert reason and reason.startswith("LIFECYCLE_NOT_ACTIVE:")
        result = agent.submit(command("loc-1", "table-1", epoch=4))
        assert result["accepted"] is False and result["reason"].startswith("LIFECYCLE_NOT_ACTIVE:")
    finally:  # the lifecycle manager may heal AMCL itself; otherwise restart the localization group
        for _ in range(30):
            if adapter.not_ready_reason() is None:
                break
            ros2("lifecycle", "set", f"/{NS}/amcl", "activate")
            bring_up()
            time.sleep(2)
        assert adapter.not_ready_reason() is None, "localization did not recover"


def test_09_map_change_is_refused(sim, tmp_path):
    other = Nav2Config.for_profile(profile_fixture(map_id=IDENTITY["mapId"], map_revision="r2"), namespace=NS)  # the venue re-mapped; this robot still runs r1
    ex = Executor(tmp_path / "agent.db", Nav2Navigation(sim, other), profile_fixture(map_id=IDENTITY["mapId"], map_revision="r2"))
    cmd = command("map-1", "table-1", epoch=4)
    cmd["target"]["mapRevision"] = "r2"
    result = ex.submit(cmd)
    assert result["accepted"] is False and result["reason"] == "MAP_MISMATCH"
    ex.close()
