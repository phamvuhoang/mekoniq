"""Gazebo Harmonic + Nav2 restaurant scenarios through the real stack: Executor -> Nav2Navigation -> RclpyActionClient -> Nav2 -> Gazebo.

navigate, load, obstacle, replan, handoff, return; blocked timeout, localization lost, map change. SIMULATION evidence only (illustrative world and
geometry): it proves nothing about a real robot, payload, safety rating or VDA compatibility, and the unit fakes in robotics/agent/tests do NOT
satisfy this gate. Needs ROS 2 Jazzy + Gazebo Harmonic on Linux; the whole module is SKIPPED, with the reason, when rclpy / gz / the workspace are
missing (e.g. macOS). `MEKONIQ_SIM_EXTERNAL=1` reuses an already running `restaurant_sim.launch.py` instead of launching one.

ORDER DEPENDENCE: the nine scenarios share one simulation and run in file order 01..09; the robot pose left by a scenario is the next one's start
(01 kitchen -> table-1, 02 -> table-2, 03 -> table-3, 04 -> table-2, ...). `ensure_at` re-positions where a scenario needs a specific start. Run the whole
file on a fresh simulation, not single tests against a used one."""
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
from footprint import corners, footprint_gap  # noqa: E402

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


# Footprints (half extents, metres) of what the scenarios measure: robot chassis (geometry_sim.yaml) and the SDF movers (generate_restaurant.py).
HALF = {"robot": (0.30, 0.225), "walker": (0.20, 0.20), "blocker": (0.40, 0.40)}
CLEARANCE_MARGIN_M = 0.02  # footprint gap must stay above this: > 0 means no contact; sampled at ~60 Hz ground truth


class Watch:
    """Ground truth from Gazebo (bridged PosePublisher /model/<name>/pose, not AMCL): footprint gap and centre distance to a named obstacle, plus odometry speed and
    travelled path length."""
    def __init__(self, client, obstacle=None):
        from nav_msgs.msg import Odometry
        from tf2_msgs.msg import TFMessage
        self.obstacle, self.min_gap, self.min_dist, self.max_speed, self.path_m = obstacle, math.inf, math.inf, 0.0, 0.0
        self._last, self._truth, self._lock = None, {}, threading.Lock()
        self.subs = [client.node.create_subscription(Odometry, f"/{NS}/odom", self._odom, 10),
                     *[client.node.create_subscription(TFMessage, f"/model/{m}/pose", self._truth_msg, 10) for m in ("robot", obstacle) if m]]
        self.client = client

    def _odom(self, m):
        self.max_speed = max(self.max_speed, abs(m.twist.twist.linear.x))
        p = (m.pose.pose.position.x, m.pose.pose.position.y)
        if self._last is not None:
            self.path_m += math.dist(p, self._last)
        self._last = p

    def _truth_msg(self, msg):
        if not self.obstacle:
            return
        for t in msg.transforms:
            if t.child_frame_id in ("robot", self.obstacle):
                q = t.transform.rotation
                self._truth[t.child_frame_id] = (t.transform.translation.x, t.transform.translation.y, 2 * math.atan2(q.z, q.w))
        if len(self._truth) == 2:
            r, o = self._truth["robot"], self._truth[self.obstacle]
            self.min_dist = min(self.min_dist, math.dist(r[:2], o[:2]))
            self.min_gap = min(self.min_gap, footprint_gap(corners(*r, HALF["robot"]), corners(*o, HALF[self.obstacle])))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        for sub in self.subs:
            self.client.node.destroy_subscription(sub)


class Sweeper:
    """Walks the 'walker' obstacle back and forth across the dining-room lane (x = 8.5 m, y 2.4 to 5.6 m) so it keeps crossing the robot's route."""
    def __init__(self, x=8.5, lo=2.4, hi=5.6, speed=0.4):
        self.x, self.lo, self.hi, self.speed, self._stop = x, lo, hi, speed, threading.Event()

    def _run(self):
        v = -self.speed
        while not self._stop.is_set():
            walker(v)
            if self._stop.wait((self.hi - self.lo) / self.speed):
                return
            v = -v

    def __enter__(self):
        place("walker", self.x, self.hi)
        threading.Thread(target=self._run, daemon=True).start()
        return self

    def __exit__(self, *_):
        self._stop.set()
        walker(0.0)
        place("walker", 8.5, 7.0)


@pytest.fixture(scope="module")
def sim():
    proc, log, client = None, None, None
    try:
        if os.environ.get("MEKONIQ_SIM_EXTERNAL") != "1":
            log = open(SIM_LOG, "w")  # Nav2/Gazebo log: read it when a scenario fails
            proc = subprocess.Popen(["ros2", "launch", "mekoniq_simulation", "restaurant_sim.launch.py", "headless:=true", f"namespace:={NS}"],
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
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
    finally:
        if client:
            client.close()
        if proc:
            os.killpg(proc.pid, signal.SIGINT)
            proc.wait(60)
        if log:
            log.close()


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
    return math.dist(poses()["robot"][:2], WP[waypoint][:2]) <= tol


def ensure_at(agent, waypoint, epoch=3):
    """Scenarios share one running simulation and depend on the robot pose left by the previous one (run order 01..09). This re-positions the
    robot if an earlier scenario left it elsewhere, so a failure is reported where it happens and not as a knock-on."""
    if not at(waypoint, 0.6):
        cid = f"pre-{waypoint}-{time.time_ns()}"
        accept(agent, command(cid, waypoint, epoch=epoch))
        assert settle(agent, cid)["completed"] is True, f"could not reposition to {waypoint}"


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


def finish(agent, cid, timeout=150):
    """Settle a goal; if Nav2 is still working at the timeout, cancel it and wait for Nav2 to confirm (a terminal state, never a bare request)."""
    state = settle(agent, cid, timeout)
    if state["status"] not in ("terminal", "unknown"):
        assert agent.cancel(cid)["acknowledged"] is True
        state = settle(agent, cid, 30)
    return state


def test_03_moving_obstacle_is_never_hit(agent, sim):
    ensure_at(agent, "table-2")
    with Sweeper(), Watch(sim, "walker") as w:  # the walker keeps crossing the lane between table-2 and table-3
        accept(agent, command("obs-1", "table-3"))
        state = finish(agent, "obs-1")
    print(f"EVIDENCE obstacle min_gap_m={w.min_gap:.2f} min_centre_m={w.min_dist:.2f} status={state['status']} outcome={state['evidence']['outcome']} completed={state['completed']}")
    assert math.isfinite(w.min_gap), "ground truth never parsed the walker"
    assert w.min_dist < 1.2, f"the walker never came near the robot (closest {w.min_dist:.2f} m): no interaction was exercised"
    assert w.min_gap > CLEARANCE_MARGIN_M, w.min_gap  # footprint clearance, not centre distance
    assert state["status"] == "terminal", state  # completed after the walker passed, or Nav2 aborted/cancel confirmed: never left running or unknown


def test_04_blocked_path_replans_around_the_obstacle(agent, sim):
    ensure_at(agent, "table-3")
    straight = math.dist(WP["table-3"][:2], WP["table-2"][:2])
    with Watch(sim, "blocker") as w:
        accept(agent, command("replan-1", "table-2"))
        end = time.time() + 60
        while w.path_m < 0.2 and time.time() < end:  # the blocker appears on the straight line only after the robot is under way, still ~1.5 m ahead
            agent.tick()
            time.sleep(0.2)
        place("blocker", 8.5, 4.0)  # midpoint of table-3 -> table-2
        state = finish(agent, "replan-1")
    place("blocker", 9.0, 0.6)
    print(f"EVIDENCE replan straight_m={straight:.2f} path_m={w.path_m:.2f} min_gap_m={w.min_gap:.2f} outcome={state['evidence']['outcome']}")
    assert state["completed"] is True, state
    assert math.isfinite(w.min_gap) and w.min_gap > CLEARANCE_MARGIN_M, w.min_gap
    assert w.path_m > straight + 0.25, f"no detour: travelled {w.path_m:.2f} m for a {straight:.2f} m straight line"


def test_05_control_handoff_waits_for_previous_goal_and_epoch(agent, sim):
    accept(agent, command("hand-1", "table-1"))
    refused = agent.submit(command("hand-2", "table-2", epoch=4))
    assert refused["accepted"] is False and refused["reason"] == "PREVIOUS_GOAL_ACTIVE"  # authority never transfers while a goal is live
    assert agent.cancel("hand-1")["acknowledged"] is True
    state = settle(agent, "hand-1", 30)
    # cancel confirmed by Nav2's own CANCELED status, not by the request
    assert state["status"] == "terminal" and state["completed"] is False and state["evidence"]["outcome"] == "canceled", state
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
            state = finish(agent, "blk-1", 60)
        print(f"EVIDENCE blocked status={state['status']} outcome={state['evidence']['outcome']} reason={state['evidence']['reason']} min_gap_m={w.min_gap:.2f}")
        assert state["completed"] is False and state["evidence"]["outcome"] in ("canceled", "aborted"), state
        assert math.isfinite(w.min_gap) and w.min_gap > CLEARANCE_MARGIN_M, w.min_gap
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
