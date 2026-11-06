"""SIM-05/06/07: the worker's scene loop is what makes a SIL run observable and scripted: every world tick it emits ground-truth telemetry per
robot, a contact-sensor liveness report plus any contact, footprint separation between robots, drives scripted actors/blockers, and fires the
worker-scoped faults of the scenario exactly once. Pure Python over fake ports: it proves the loop's bookkeeping, never Gazebo physics."""
import json
import time
from pathlib import Path

import pytest

from actors.scenario import load_scenario
from bridge.scene_loop import ORCHESTRATOR_FAULTS, WORKER_FAULTS, SceneLoop
from metrics.separation import corners, footprint_gap

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin" / "scenarios"
ROBOTS = [{"namespace": "robot_a", "entityId": "amr-a", "footprint": {"min": [-0.3, -0.275], "max": [0.3, 0.275]}},
          {"namespace": "robot_b", "entityId": "amr-b", "footprint": {"min": [-0.3, -0.275], "max": [0.3, 0.275]}}]
RUN = "3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c"


def gz_pose(x, y, yaw=0.0):
    import math
    return {"position": {"x": x, "y": y, "z": 0.0}, "orientation": {"x": 0.0, "y": 0.0, "z": math.sin(yaw / 2), "w": math.cos(yaw / 2)}}


def contact_msg(a, b):
    return {"contact": [{"collision1": {"name": f"{a}::base_link::base_link_collision"}, "collision2": {"name": f"{b}::body::collision"},
                         "position": [{"x": 1.0, "y": 2.0, "z": 0.1}], "normal": [{"x": 1.0, "y": 0.0, "z": 0.0}], "depth": [0.002]}]}


class FakeScenePorts:
    """What a real RosPorts learns from ROS/Gazebo, scripted: a clock, model poses, contact-sensor messages; and what it tells Gazebo, recorded."""
    def __init__(self):
        self.clock = 0
        self.model_poses = {}
        self.contact_msgs = {}
        self.velocities, self.placed, self.faults = [], [], []

    def clock_ns(self):
        return self.clock

    def poses(self):
        return {k: {"value": v, "simTimeNs": self.clock, "receivedMonotonicNs": time.monotonic_ns(), "sequence": self.clock // 20_000_000 + 1} for k, v in self.model_poses.items()}

    def contacts(self):
        return {k: {"value": v, "simTimeNs": self.clock, "receivedMonotonicNs": time.monotonic_ns(), "sequence": self.clock // 20_000_000 + 1} if v is not None else None for k, v in self.contact_msgs.items()}

    def set_velocity(self, model, vx, vy):
        self.velocities.append((model, vx, vy))

    def set_pose(self, model, x, y, z):
        self.placed.append((model, x, y, z))

    def inject_fault(self, fault, namespace):
        self.faults.append((fault["faultId"], namespace))
        return True


def loop_for(fixture, ports, robots=ROBOTS):
    scenario = load_scenario(FIXTURES / fixture)
    events = []
    loop = SceneLoop(ports, scenario, robots, run_id=RUN, boot_id="worker-boot-1", emit=lambda kind, payload: events.append((kind, payload)))
    return loop, events, scenario


def by_kind(events, kind):
    return [p for k, p in events if k == kind]


def test_each_world_tick_emits_ground_truth_telemetry_liveness_contacts_and_separation():
    ports = FakeScenePorts()
    ports.model_poses = {"robot_a": gz_pose(1.0, 1.0), "robot_b": gz_pose(2.0, 1.0, 0.5)}
    ports.contact_msgs = {"robot_a": {"contact": []}, "robot_b": {"contact": []}}
    loop, events, _ = loop_for("fd07-corridor.json", ports)
    for ns in (0, 20_000_000, 40_000_000):
        ports.clock = ns
        if ns == 40_000_000:
            ports.contact_msgs["robot_a"] = contact_msg("robot_a", "wall-north")
        loop.step()
    telemetry = by_kind(events, "telemetry")
    a = [s for s in telemetry if s["entityId"] == "amr-a"]
    assert [s["seq"] for s in a] == ["1", "2", "3"] and [s["simTimeNs"] for s in a] == ["0", "20000000", "40000000"]
    assert a[0]["origin"] == "physics_sim" and a[0]["providerId"] == "gazebo_nav2" and a[0]["bootId"] == "worker-boot-1" and a[0]["runId"] == RUN
    assert a[0]["observed"] == {"xM": 1.0, "yM": 1.0, "yawRad": 0.0} and a[0]["quality"] == "valid" and a[0]["frameId"] == "map"
    assert {s["entityId"] for s in telemetry} == {"amr-a", "amr-b"}
    liveness = by_kind(events, "contact-sensor")
    assert len(liveness) == 6 and all(l["alive"] is True for l in liveness) and {l["robot"] for l in liveness} == {"amr-a", "amr-b"}
    assert [l["contacts"] for l in liveness if l["robot"] == "amr-a"] == [0, 0, 1]
    contact = by_kind(events, "contact")
    assert len(contact) == 1 and contact[0]["pair"] == ["robot_a", "wall-north"] and contact[0]["tick"] == 2 and contact[0]["simTimeNs"] == "40000000" and contact[0]["provenance"] == "physics_sim"
    sep = by_kind(events, "separation")
    assert len(sep) == 3 and sep[0]["a"] == "amr-a" and sep[0]["b"] == "amr-b" and sep[0]["gapM"] > 0
    half = (0.3, 0.275)
    assert sep[0]["gapM"] == pytest.approx(footprint_gap(corners(1.0, 1.0, 0.0, half), corners(2.0, 1.0, 0.5, half)))
    assert sep[0]["centreM"] == pytest.approx(1.0) and sep[0]["provenance"] == "physics_sim"


def test_a_paused_or_stalled_clock_produces_no_new_tick_and_a_missing_pose_is_unknown_not_zero():
    ports = FakeScenePorts()
    ports.model_poses = {"robot_a": gz_pose(1.0, 1.0)}
    ports.contact_msgs = {"robot_a": None}
    loop, events, _ = loop_for("fd07-corridor.json", ports)
    ports.clock = 20_000_000
    loop.step()
    loop.step()                                   # same /clock: the world is paused, nothing is sampled twice
    assert len(by_kind(events, "telemetry")) == 2
    b = [s for s in by_kind(events, "telemetry") if s["entityId"] == "amr-b"][0]
    assert b["quality"] == "unknown" and b["reasonCodes"] == ["POSE_MISSING"] and b["observed"] is None
    silent = [l for l in by_kind(events, "contact-sensor") if l["robot"] == "amr-a"][0]
    assert silent["alive"] is False and silent["contacts"] == 0
    assert by_kind(events, "separation") == []       # one pose missing: no separation is claimed
    ports.clock = None
    loop.step()
    assert len(by_kind(events, "telemetry")) == 2 and by_kind(events, "clock")[-1] == {"status": "missing"}


def test_actors_blockers_and_worker_faults_are_driven_from_the_scenario_exactly_once():
    ports = FakeScenePorts()
    ports.model_poses = {"robot_amr_1": gz_pose(1.5, 1.0)}
    ports.contact_msgs = {"robot_amr_1": {"contact": []}}
    one = [{"namespace": "robot_amr_1", "entityId": "amr-1", "footprint": {"min": [-0.3, -0.275], "max": [0.3, 0.275]}}]
    loop, events, scenario = loop_for("fd03-crossing.json", ports, one)
    start = scenario["actors"][0]["trajectory"]["startTick"]
    ports.clock = (start - 1) * 20_000_000
    loop.step()
    assert ports.velocities == [(a["id"] and f"actor_{a['id']}", 0.0, 0.0) for a in scenario["actors"]]   # before start: told to stand still
    ports.clock = (start + 1) * 20_000_000
    loop.step()
    moving = [v for v in ports.velocities if v[0] == "actor_person-1" and v[2] > 0]
    assert len(moving) == 1
    # blockers (FD04): placed once when their window opens, parked once when it closes; the blocker-on/off faults are the schedule, not a second placement
    ports2 = FakeScenePorts()
    ports2.model_poses = {"robot_amr_1": gz_pose(1.5, 1.0)}
    ports2.contact_msgs = {"robot_amr_1": {"contact": []}}
    loop2, events2, s2 = loop_for("fd04-blocked.json", ports2, one)
    for tick in (0, 1, 399, 400, 401, 1399, 1400, 1401):
        ports2.clock = tick * 20_000_000
        loop2.step()
    models = [p[0] for p in ports2.placed]
    assert models.count("blocker_chair") == 1 and models.count("blocker_lane-closed") == 2
    fired = by_kind(events2, "fault")
    assert [(f["faultId"], f["tick"], f["applied"]) for f in fired] == [("blocker-on", 0, "schedule"), ("blocker-on", 400, "schedule"), ("blocker-off", 1400, "schedule")]
    assert ports2.faults == []
    # faults (FD08): the worker applies its own scope once; an orchestrator fault is announced, never applied here
    ports3 = FakeScenePorts()
    ports3.model_poses = {"robot_amr_1": gz_pose(1.5, 1.0)}
    ports3.contact_msgs = {"robot_amr_1": {"contact": []}}
    loop3, events3, _ = loop_for("fd08-localization.json", ports3, one)
    for tick in (299, 300, 301, 900, 901, 902):
        ports3.clock = tick * 20_000_000
        loop3.step()
    assert ports3.faults == [("localization-lost", "robot_amr_1")]
    assert [(f["faultId"], f["tick"], f["applied"], f["scope"]) for f in by_kind(events3, "fault")] == [("localization-lost", 300, True, "worker"), ("map-changed", 900, False, "orchestrator")]
    assert set(WORKER_FAULTS) | set(ORCHESTRATOR_FAULTS) == set(__import__("actors.scenario", fromlist=["SIL_FAULTS"]).SIL_FAULTS) and not set(WORKER_FAULTS) & set(ORCHESTRATOR_FAULTS)


def test_loop_tick_is_the_world_clock_not_wall_time_and_late_ticks_catch_up_once():
    ports = FakeScenePorts()
    ports.model_poses = {"robot_amr_1": gz_pose(1.5, 1.0)}
    ports.contact_msgs = {"robot_amr_1": {"contact": []}}
    one = [{"namespace": "robot_amr_1", "entityId": "amr-1", "footprint": {"min": [-0.3, -0.275], "max": [0.3, 0.275]}}]
    loop, events, _ = loop_for("fd08-localization.json", ports, one)
    ports.clock = 950 * 20_000_000                 # the loop was starved: both due faults fire now, each once
    loop.step()
    assert [(f["faultId"], f["tick"]) for f in by_kind(events, "fault")] == [("localization-lost", 950), ("map-changed", 950)]
    assert by_kind(events, "telemetry")[0]["simTimeNs"] == str(950 * 20_000_000)
    assert json.dumps(events[0][1])              # every payload is JSON (no dataclass leaks)


def test_sensor_silence_does_not_become_fresh_measurements_when_only_clock_advances(monkeypatch):
    from types import SimpleNamespace as S
    from bridge.nav2_session import _SceneNode
    now = [0]
    monkeypatch.setattr('bridge.nav2_session.time.monotonic_ns', lambda: now[0])
    node = _SceneNode.__new__(_SceneNode)
    node.clock, node.pose, node.contact = 0, {}, {}
    transform = S(translation=S(x=1.0, y=1.0, z=0.0), rotation=S(x=0.0, y=0.0, z=0.0, w=1.0))
    for ns in ('robot_a', 'robot_b'):
        node._on_pose(ns, S(transforms=[S(transform=transform)]))
        node._on_contacts(ns, S(contacts=[]))
    ports = FakeScenePorts()
    ports.poses = lambda: dict(node.pose)
    ports.contacts = lambda: dict(node.contact)
    loop, events, _ = loop_for('fd07-corridor.json', ports)
    loop.step()
    assert all(s['quality'] == 'valid' for s in by_kind(events, 'telemetry'))
    assert all(s['alive'] for s in by_kind(events, 'contact-sensor'))
    events.clear()
    now[0] = 60_000_000_000
    ports.clock = now[0]
    loop.step()
    assert len(by_kind(events, 'telemetry')) == 2
    assert len(by_kind(events, 'contact-sensor')) == 2
    assert all(s['quality'] == 'stale' for s in by_kind(events, 'telemetry'))
    assert all(s['simTimeNs'] == '0' for s in by_kind(events, 'telemetry'))
    assert len(by_kind(events, 'pose-sensor')) == 2
    assert all(s['sourceReceivedMonotonicNs'] == '0' for s in by_kind(events, 'pose-sensor'))
    assert all(s['sensorSequence'] == '1' for s in by_kind(events, 'pose-sensor'))
    assert not any(s['alive'] for s in by_kind(events, 'contact-sensor'))
    assert by_kind(events, 'separation') == []
    assert by_kind(events, 'contact') == []


def test_contact_cache_sequence_gap_is_missing_coverage_not_a_live_empty_sensor():
    ports = FakeScenePorts()
    receipt = {'value': {'contact': []}, 'simTimeNs': 0, 'receivedMonotonicNs': time.monotonic_ns(), 'sequence': 1}
    ports.contacts = lambda: {'robot_a': receipt}
    loop, events, _ = loop_for('fd07-corridor.json', ports)
    loop.step()
    assert by_kind(events, 'contact-sensor')[0]['alive']
    events.clear()
    # Two callback values were overwritten before collection; the missing one could contain a contact.
    ports.clock = 20_000_000
    receipt = {**receipt, 'sequence': 3, 'simTimeNs': ports.clock, 'receivedMonotonicNs': time.monotonic_ns()}
    loop.step()
    report = by_kind(events, 'contact-sensor')[0]
    assert report['alive'] is False
    assert report['reasonCodes'] == ['CONTACT_SEQUENCE_GAP']
