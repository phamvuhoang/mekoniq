"""B01: the compiled scene -> IR-SIM YAML -> the real engine. Inputs are the scenes the TypeScript compiler exported, never hand-written YAML."""
import json
import math
import pathlib

import irsim
import pytest

from irsim_worker.scene import SceneError, engine_name, scene_to_world, write_scene

FIX = pathlib.Path(__file__).parents[1] / "fixtures" / "serve-demo-v1"
SERVE = json.loads((FIX / "navigation-scene.json").read_text())
TWO = json.loads((FIX / "navigation-scene-two-robot.json").read_text())


def load(scene, tmp_path, seed=3):
    refs = write_scene(scene, tmp_path)
    env = irsim.make(str(tmp_path / "irsim" / "world.yaml"), display=False, seed=seed)
    return env, refs


def world_vertices(obj):
    return sorted((round(float(x), 6), round(float(y), 6)) for x, y in zip(obj.vertices[0], obj.vertices[1]))


def placed(footprint, x, y, yaw):
    return sorted((round(x + a * math.cos(yaw) - b * math.sin(yaw), 6), round(y + a * math.sin(yaw) + b * math.cos(yaw), 6)) for a, b in footprint)


def test_the_engine_loads_the_scene_and_sees_the_robot_where_the_compiler_put_it(tmp_path):
    env, refs = load(SERVE, tmp_path)
    try:
        assert [r["path"] for r in refs] == ["irsim/name-map.json", "irsim/world.yaml"]
        assert all(len(r["sha256"]) == 64 and r["bytes"] > 0 for r in refs)
        robot = env.robot_list[0]
        r = SERVE["robots"][0]
        assert robot.name == engine_name("amr-1") == json.loads((tmp_path / "irsim/name-map.json").read_text())["robots"]["amr-1"]
        assert [round(float(v), 9) for v in robot.state[:3, 0]] == pytest.approx(r["initialPoseMap"], abs=1e-9)
        # the footprint is the physical hull in the drive frame: the engine's polygon must be that hull placed at the pose, overhang and all
        assert world_vertices(robot) == placed(r["model"]["footprint"]["verticesM"], *r["initialPoseMap"])
        assert min(v[0] for v in world_vertices(robot)) < r["initialPoseMap"][0] - 0.30  # rear overhang survived
    finally:
        env.end()


def test_rectangles_are_centred_on_corner_plus_half_size_and_nothing_is_dropped(tmp_path):
    env, _ = load(SERVE, tmp_path)
    try:
        solids = SERVE["world"]["obstacles"] + SERVE["world"]["boundaries"]
        assert len(env.obstacle_list) == len(solids) == 10 + 1 + 4
        engine = sorted(tuple(world_vertices(o)) for o in env.obstacle_list)
        expected = sorted(tuple(sorted((round(x, 6), round(y, 6)) for x, y in o["verticesM"])) for o in solids)
        assert engine == expected  # same polygons: no translation applied twice
        table = next(o for o in env.obstacle_list if world_vertices(o) == sorted((round(x, 6), round(y, 6)) for x, y in next(s for s in solids if s["id"] == "table-05")["verticesM"]))
        assert (round(float(table.state[0, 0]), 6), round(float(table.state[1, 0]), 6)) == (10.0, 3.0)  # centre of the corner-based rectangle
    finally:
        env.end()


def test_lidar_and_velocity_limits_come_from_the_model_not_engine_defaults(tmp_path):
    env, _ = load(SERVE, tmp_path)
    try:
        robot, model = env.robot_list[0], SERVE["robots"][0]["model"]
        lidar = robot.lidar if hasattr(robot, "lidar") else robot.sensors[0]
        s = model["sensors"][0]
        assert (lidar.number, lidar.range_min, lidar.range_max) == (s["beamCount"], s["rangeMinM"], s["rangeMaxM"])
        assert [float(v) for v in lidar.offset[:, 0]] == pytest.approx(s["poseInDrive"], abs=1e-12)
        assert not lidar.noise
        assert [float(v) for v in robot.vel_max[:, 0]] == pytest.approx([model["kinematics"]["maxLinearMps"], model["kinematics"]["maxAngularRadps"]])
        env.step({engine_name("amr-1"): [0.0, 0.0]})
        assert float(robot.state[0, 0]) == pytest.approx(SERVE["robots"][0]["initialPoseMap"][0], abs=1e-12)  # no auto-dash toward a goal
    finally:
        env.end()


def test_two_robots_keep_independent_polygons_and_names(tmp_path):
    env, _ = load(TWO, tmp_path)
    try:
        by_name = {r.name: r for r in env.robot_list}
        assert set(by_name) == {engine_name("amr-1"), engine_name("amr-2")}
        for r in TWO["robots"]:
            assert world_vertices(by_name[engine_name(r["robotId"])]) == placed(r["model"]["footprint"]["verticesM"], *r["initialPoseMap"])
        assert world_vertices(by_name[engine_name("amr-1")]) != world_vertices(by_name[engine_name("amr-2")])
    finally:
        env.end()


def test_the_yaml_is_deterministic_and_has_no_goal_or_behavior(tmp_path):
    a, b = write_scene(SERVE, tmp_path / "a"), write_scene(SERVE, tmp_path / "b")
    assert a == b
    doc, names = scene_to_world(SERVE)
    assert all("goal" not in r and "behavior" not in r for r in doc["robot"])
    assert doc["world"]["step_time"] == 0.02 and doc["world"]["collision_mode"] == "stop"
    assert names["solids"] == sorted(names["solids"])


def test_a_polygon_obstacle_is_written_relative_to_a_zero_state():
    scene = json.loads(json.dumps(SERVE))
    scene["world"]["obstacles"][0]["verticesM"] = [[5, 5], [6, 5], [6, 6], [5.5, 6.5], [5, 6]]
    doc, _ = scene_to_world(scene)
    poly = next(o for o in doc["obstacle"] if o["shape"]["name"] == "polygon")
    assert poly["state"] == [0.0, 0.0, 0.0] and poly["shape"]["vertices"][0] == [5, 5]


def test_unsupported_or_non_finite_scenes_are_refused_not_repaired():
    for bad in ({"engine": {"id": "gazebo_nav2", "version": "x", "collisionMode": "stop"}}, {"clock": {"tickMs": 50}}, {"documentType": "navigation-model-2d"}):
        with pytest.raises(SceneError) as e:
            scene_to_world({**SERVE, **bad})
        assert e.value.code == "SCENE_UNSUPPORTED"
    nan = json.loads(json.dumps(SERVE))
    nan["robots"][0]["initialPoseMap"][0] = float("nan")
    with pytest.raises(SceneError) as e:
        scene_to_world(nan)
    assert e.value.code == "NON_FINITE"
