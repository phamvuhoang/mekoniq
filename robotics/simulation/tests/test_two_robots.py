"""SIM-06 / FD07: two robots compile into ONE world with distinct namespaces, URDFs, telemetry channels and parking spawns, and exactly one
velocity input per robot. Static bundle checks only; the Gazebo run of fd07-corridor is a Linux SIL gate (blocked_external here)."""
import json
import re
from pathlib import Path

from actors.scenario import load_scenario
from bridge.launch_plan import launch_argv, plan_launch
from compiler.compile_world import compile_world

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin"


def compiled(tmp_path):
    scenario = load_scenario(FIXTURES / "scenarios" / "fd07-corridor.json")
    fx = json.loads((FIXTURES / scenario["projectFixture"]).read_text())
    assets = [json.loads((FIXTURES / f).read_text()) for f in fx["assetFiles"]]
    return compile_world(fx["project"], assets, tmp_path, scenario=scenario), scenario, fx


def test_two_robots_share_one_world_clock_with_separate_namespaces_and_inputs(tmp_path):
    manifest, scenario, fx = compiled(tmp_path)
    robots = manifest["robots"]
    assert [r["entityId"] for r in robots] == ["amr-a", "amr-b"] and len({r["namespace"] for r in robots}) == 2
    assert len({(r["spawn"]["x"], r["spawn"]["y"]) for r in robots}) == 2
    world = (tmp_path / "world.sdf").read_text()
    assert world.count("<world ") == 1 and world.count("<physics ") == 1
    for r in robots:
        urdf = (tmp_path / f"robot-{r['entityId']}.urdf").read_text()
        assert urdf.count("gz::sim::systems::DiffDrive") == 1
        assert re.findall(r"<topic>(/[a-z0-9_]+/cmd_vel)</topic>", urdf) == [f"/{r['namespace']}/cmd_vel"]
        assert "ros2_control" not in urdf  # one actuator authority per joint: the diff-drive plugin only
    index = json.loads((tmp_path / "scene-index.json").read_text())
    topics = [e["telemetry"]["pose"] for e in index["entities"]] + [e["telemetry"]["odom"] for e in index["entities"]]
    assert len(set(topics)) == len(topics)
    assert all(e["jointAuthority"] == [{"joint": "left_wheel_joint", "controller": "gz_diff_drive"}, {"joint": "right_wheel_joint", "controller": "gz_diff_drive"}] for e in index["entities"])
    assert index["zones"] == scenario["zones"]


def test_launch_plan_and_argv_for_two_robots(tmp_path):
    manifest, _, _ = compiled(tmp_path)
    namespaces = [r["namespace"] for r in manifest["robots"]]
    plan = plan_launch(tmp_path, namespaces)
    assert [r["namespace"] for r in plan["robots"]] == namespaces and plan["robots"][0]["spawn"] != plan["robots"][1]["spawn"]
    assert launch_argv(tmp_path, namespaces)[5] == f"robots:={','.join(namespaces)}"
