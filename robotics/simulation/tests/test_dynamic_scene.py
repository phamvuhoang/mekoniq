"""SIM-05 / FD03 / FD04: scripted pedestrians and blockers with seeds and provenance, contact and separation metrics on collision geometry, and the
scenario fixtures that drive them. Pure Python: actors are schedules (what Gazebo is told at each tick); metrics parse what Gazebo reports.
Nothing here is physics evidence."""
import copy
import json
from pathlib import Path

import pytest

from actors.blocker import BlockerSchedule
from actors.pedestrian import ActorSchedule, Trajectory, crossing, standing
from actors.scenario import SIL_FAULTS, actor_schedules, load_scenario
from compiler.compile_world import CompileError, compile_world
from metrics.contact import ContactLog, contacts_from_message
from metrics.separation import SeparationSample, corners, footprint_gap, min_separation, separation

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin"
SCENARIOS = sorted((FIXTURES / "scenarios").glob("*.json"))


def test_crossing_actor_moves_at_its_speed_only_after_its_start_tick_and_is_deterministic_per_seed():
    walk = crossing(lane_x=5.5, y_from=0.6, y_to=3.4, speed_mps=0.7, start_tick=400)
    a, b = ActorSchedule(seed=1, actor_id="person-1", trajectory=walk), ActorSchedule(seed=1, actor_id="person-1", trajectory=walk)
    assert a.pose_at(399) is None and a.pose_at(400) == (5.5, 0.6, pytest.approx(1.5708, abs=1e-3))
    x, y, _ = a.pose_at(450)
    assert (x, y) == (5.5, pytest.approx(0.6 + 50 * 0.02 * 0.7))
    assert a.pose_at(10_000)[1] == 3.4                      # arrived: stays at the far side (no loop)
    assert [a.pose_at(t) for t in range(400, 700, 7)] == [b.pose_at(t) for t in range(400, 700, 7)]
    cmd = a.command_at(450)
    assert cmd == {"model": "actor_person-1", "vx": 0.0, "vy": pytest.approx(0.7)}
    assert a.command_at(10_000) == {"model": "actor_person-1", "vx": 0.0, "vy": 0.0}
    assert a.provenance == {"heightM": "illustrative", "radiusM": "illustrative", "trajectory": "scripted"} and a.height_m == 1.7


def test_standing_actor_dwells_then_leaves_and_dwell_jitter_depends_on_the_seed():
    stand = standing(x=6.0, y=2.9, start_tick=900, dwell_ticks=300, leave_to=(6.0, 0.6), speed_mps=0.5)
    a = ActorSchedule(seed=1, actor_id="person-2", trajectory=stand)
    assert a.pose_at(900)[:2] == (6.0, 2.9) and a.pose_at(1199)[:2] == (6.0, 2.9)
    assert a.command_at(1000) == {"model": "actor_person-2", "vx": 0.0, "vy": 0.0}
    assert a.pose_at(1300)[1] < 2.9
    jitter_a = ActorSchedule(seed=1, actor_id="p", trajectory=stand, dwell_jitter_ticks=50)
    jitter_b = ActorSchedule(seed=2, actor_id="p", trajectory=stand, dwell_jitter_ticks=50)
    same = ActorSchedule(seed=1, actor_id="p", trajectory=stand, dwell_jitter_ticks=50)
    assert jitter_a.dwell_ticks == same.dwell_ticks and jitter_a.dwell_ticks != jitter_b.dwell_ticks
    assert 250 <= jitter_a.dwell_ticks <= 350
    with pytest.raises(ValueError, match="TRAJECTORY_INVALID"):
        ActorSchedule(seed=1, actor_id="p", trajectory=Trajectory(waypoints=((1, 1),), speed_mps=0.0, start_tick=0, dwell_ticks=0, loop=False))


def test_blocker_windows_place_once_and_park_once():
    s = BlockerSchedule([{"id": "chair", "x": 6.0, "y": 2.2, "width": 0.5, "height": 0.5, "heightM": 0.9, "atTick": 100, "untilTick": 300}])
    assert s.active(99) == [] and s.active(100) == ["chair"] and s.active(299) == ["chair"] and s.active(300) == []
    assert s.pose_commands(99) == []
    assert s.pose_commands(100) == [{"model": "blocker_chair", "x": 6.25, "y": 2.45, "z": 0.45}]
    assert s.pose_commands(150) == []                                     # already placed
    assert s.pose_commands(300) == [{"model": "blocker_chair", "x": -5.0, "y": -5.0, "z": 0.45}]  # parked outside the world
    assert s.pose_commands(301) == []
    with pytest.raises(ValueError, match="BLOCKER_INVALID"):
        BlockerSchedule([{"id": "x", "x": 1, "y": 1, "width": 0, "height": 1, "heightM": 1, "atTick": 0}])


def test_contact_messages_become_entity_pair_samples_with_point_normal_and_tick():
    msg = {"contact": [{"collision1": {"name": "robot_amr_1::base_link::base_link_collision"}, "collision2": {"name": "actor_person-1::link::c"},
                        "position": [{"x": 5.5, "y": 2.0, "z": 0.1}], "normal": [{"x": 0, "y": -1, "z": 0}], "depth": [0.003]}]}
    samples = contacts_from_message(msg, tick=512, sim_time_ns=10_240_000_000)
    assert len(samples) == 1
    c = samples[0]
    assert c.pair == ("actor_person-1", "robot_amr_1") and c.point == (5.5, 2.0, 0.1) and c.normal == (0.0, -1.0, 0.0) and c.depth == 0.003
    assert c.tick == 512 and c.sim_time_ns == 10_240_000_000 and c.provenance == "physics_sim"
    log = ContactLog()
    log.add(samples)
    log.add(contacts_from_message(msg, tick=513, sim_time_ns=10_260_000_000))
    assert log.count == 2 and log.pairs() == {("actor_person-1", "robot_amr_1"): 2} and log.first(("actor_person-1", "robot_amr_1")).tick == 512
    assert contacts_from_message({"contact": []}, 1, 1) == []
    with pytest.raises(ValueError, match="CONTACT_INVALID"):
        contacts_from_message({"contact": [{"collision1": {"name": "a"}}]}, 1, 1)


def test_separation_is_measured_on_collision_footprints_not_centres():
    robot, person = (0.30, 0.275), (0.20, 0.20)
    assert footprint_gap(corners(0, 0, 0, robot), corners(0.5, 0, 0, person)) == 0.0            # centres 0.5 m apart: footprints touch
    s = separation(tick=7, a=("robot_amr_1", (0, 0, 0), robot), b=("actor_person-1", (0.75, 0, 0), person))
    assert s == SeparationSample(tick=7, a="actor_person-1", b="robot_amr_1", gap_m=pytest.approx(0.25), centre_m=0.75)
    assert min_separation([s, separation(8, ("robot_amr_1", (0, 0, 0), robot), ("actor_person-1", (0.5, 0.6, 0.7), person))]).gap_m < 0.25
    assert min_separation([]) is None


@pytest.mark.parametrize("path", SCENARIOS, ids=[p.stem for p in SCENARIOS])
def test_scenario_fixtures_are_declarative_and_bind_known_faults(path):
    s = load_scenario(path)
    assert s["scenarioId"] in ("FD03", "FD04", "FD07", "FD08") and s["revision"] >= 1 and isinstance(s["seed"], int)
    assert (FIXTURES / s["projectFixture"]).is_file()
    assert all(f["faultId"] in SIL_FAULTS for f in s["faults"]) and s["assertions"]
    for a in actor_schedules(s):
        assert a.pose_at(a.trajectory.start_tick) is not None and a.height_m > 0


def test_scenario_loader_refuses_unknown_faults_and_topic_or_shell_payloads(tmp_path):
    base = json.loads((FIXTURES / "scenarios" / "fd04-blocked.json").read_text())
    for change, code in [({"faults": [{"atTick": 1, "faultId": "teleport"}]}, "FAULT_UNKNOWN"),
                         ({"faults": [{"atTick": 1, "faultId": "blocker-on", "entityId": "chair", "topic": "/x"}]}, "FAULT_FIELD_FORBIDDEN"),
                         ({"faults": [{"atTick": 1, "faultId": "blocker-on", "entityId": "chair", "shell": "rm"}]}, "FAULT_FIELD_FORBIDDEN"),
                         ({"actors": [{"id": "p", "kind": "drone"}]}, "ACTOR_KIND_UNKNOWN"), ({"scenarioId": "FD99"}, "SCENARIO_UNKNOWN")]:
        bad = {**copy.deepcopy(base), **change}
        f = tmp_path / "bad.json"
        f.write_text(json.dumps(bad))
        with pytest.raises(ValueError, match=code):
            load_scenario(f)


def test_compiled_world_carries_actors_and_blockers_from_the_scenario(tmp_path):
    fx = json.loads((FIXTURES / "restaurant-v2.json").read_text())
    assets = [json.loads((FIXTURES / f).read_text()) for f in fx["assetFiles"]]
    scenario = load_scenario(FIXTURES / "scenarios" / "fd03-crossing.json")
    plain = compile_world(fx["project"], assets, tmp_path / "plain")
    with_actors = compile_world(fx["project"], assets, tmp_path / "scene", scenario=scenario)
    assert with_actors["inputHash"] != plain["inputHash"] and with_actors["scenario"] == {"id": scenario["id"], "revision": scenario["revision"], "scenarioId": "FD03"}
    sdf = (tmp_path / "scene" / "world.sdf").read_text()
    assert '<model name="actor_person-1">' in sdf and sdf.count("<physics ") == 1
    index = json.loads((tmp_path / "scene" / "scene-index.json").read_text())
    assert [a["id"] for a in index["actors"]] == [a["id"] for a in scenario["actors"]]
    assert index["actors"][0]["telemetry"]["pose"] == "/model/actor_person-1/pose" and index["actors"][0]["velocity"] == "/model/actor_person-1/cmd_vel"
    assert index["actors"][0]["provenance"]["heightM"] == "illustrative"
    with pytest.raises(CompileError) as e:
        compile_world(fx["project"], assets, tmp_path / "bad", scenario={**scenario, "actors": [{**scenario["actors"][0], "id": "table-1"}]})
    assert e.value.code == "ID_DUPLICATE"
