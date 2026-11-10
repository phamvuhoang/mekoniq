import copy
import json
import re
from pathlib import Path

import pytest

from webots_worker.compile import CompileError, compile_world

FX = Path(__file__).resolve().parents[1] / "fixtures" / "serve-3d-v1"


def load(name):
    return json.loads((FX / name).read_text())


def single():
    return load("navigation-scene.json"), {"amr-1": load("physical-model-amr-1.json")}


def fleet():
    return load("navigation-scene-two-robot.json"), {r: load(f"physical-model-{r}.json") for r in ("robot01", "robot02")}


def code(scene, models, seed=7):
    with pytest.raises(CompileError) as e:
        compile_world(scene, models, seed)
    return e.value.code


def test_deterministic():
    scene, models = single()
    assert compile_world(scene, models, 7) == compile_world(copy.deepcopy(scene), copy.deepcopy(models), 7)
    assert compile_world(scene, models, 7) != compile_world(scene, models, 8)


def test_contains_one_extern_robot_per_scene_robot_and_one_supervisor():
    text = compile_world(*fleet(), 7)
    assert text.startswith("#VRML_SIM R2025a utf8")
    assert text.count('controller "<extern>"') == 3
    for name in ("robot01", "robot02", "mekoniq_supervisor"):
        assert len(re.findall(rf'^\s*name "{name}"$', text, re.M)) == 1
    assert text.count("supervisor TRUE") == 1
    assert text.count("synchronization TRUE") == 3


def test_obstacle_defs_match_scene_ids():
    scene, models = single()
    text = compile_world(scene, models, 7)
    ids = [o["id"] for o in scene["world"]["obstacles"] + scene["world"]["boundaries"]]
    assert ids
    for i in ids:
        assert len(re.findall(rf"DEF {re.escape(i)} Solid", text)) == 1, i


def test_world_settings_come_from_the_scene_and_the_seed():
    text = compile_world(*single(), 7)
    assert "basicTimeStep 20" in text and "optimalThreadCount 1" in text and "randomSeed 7" in text and 'coordinateSystem "ENU"' in text
    # wheel/floor and caster/floor friction are the world3d values
    assert re.search(r'material1 "wheel"\s+material2 "default"\s+coulombFriction \[ 0\.8 \]', text)
    assert re.search(r'material1 "caster"\s+material2 "default"\s+coulombFriction \[ 0\.02 \]', text)


def test_robot_is_placed_so_its_wheels_stand_on_the_floor():
    text = compile_world(*single(), 7)
    assert re.search(r"translation 2\.0 1\.5 0\.09\b", text)  # drive pose (2, 1.5, 0), axle at the wheel radius


def test_wheels_are_velocity_motors_named_by_side_with_the_fixture_limits():
    text = compile_world(*single(), 7)
    for side in ("left", "right"):
        assert f'name "{side}_wheel_motor"' in text and f'name "{side}_wheel_sensor"' in text
    assert text.count("RotationalMotor {") == 2 and text.count("maxVelocity 20.0") == 2
    assert text.count("HingeJoint {") == 2


def test_inertia_is_written_in_webots_order():
    scene, models = single()
    text = compile_world(scene, models, 7)
    # chassis/base inertiaKgM2 = [xx xy xz yy yz zz]; Webots wants [xx yy zz xy xz yz]
    assert "inertiaMatrix [ 0.3630666666666667 0.4428666666666667 0.7601999999999999 0.0 0.0 0.0 ]" in text


def test_lidar_follows_the_sensor_model():
    text = compile_world(*single(), 7)
    assert 'name "lidar-2d"' in text and "horizontalResolution 360" in text and "numberOfLayers 1" in text and "maxRange 10.0" in text and "minRange 0.05" in text


def test_casters_use_the_caster_contact_material():
    assert compile_world(*single(), 7).count('contactMaterial "caster"') == 2


def test_timestep_must_divide_20ms():
    scene, models = single()
    scene["engine"]["basicTimeStepMs"] = 7
    assert code(scene, models) == "TIMESTEP_NOT_DIVISOR"


def test_world3d_and_engine_are_required():
    scene, models = single()
    del scene["world3d"]
    assert code(scene, models) == "WORLD3D_MISSING"
    scene, models = single()
    scene["engine"] = {"id": "irsim_2d", "version": "2.12.0", "collisionMode": "stop"}
    assert code(scene, models) == "ENGINE_MISMATCH"


def test_zero_mass_rejected():
    scene, models = single()
    models["amr-1"]["links"][0]["massKg"]["value"] = 0
    assert code(scene, models) == "MODEL_MASS_INVALID"


def test_missing_inertia_rejected():
    scene, models = single()
    models["amr-1"]["links"][1]["inertiaKgM2"] = None
    assert code(scene, models) == "MODEL_INERTIA_MISSING"


def test_prismatic_joint_rejected():
    scene, models = single()
    next(j for j in models["amr-1"]["joints"] if j["kind"] == "fixed")["kind"] = "prismatic"
    assert code(scene, models) == "JOINT_UNSUPPORTED"


def test_two_wheel_model_without_caster_rejected():
    scene, models = single()
    m = models["amr-1"]
    m["links"] = [l for l in m["links"] if not l["id"].endswith("/ball")]
    m["joints"] = [j for j in m["joints"] if not j["child"].endswith("/ball")]
    assert code(scene, models) == "NO_THIRD_CONTACT"


def test_asset_paths_outside_the_bundle_rejected():
    for bad in ("../../etc/passwd", "/etc/passwd", "a/../../b", "a\\b"):
        scene, models = single()
        scene["files"] = [{"path": bad, "sha256": "a" * 64, "bytes": 1}]
        assert code(scene, models) == "ASSET_PATH_ESCAPE", bad


def test_mesh_geometry_is_not_exported_in_this_release():
    scene, models = single()
    models["amr-1"]["links"][0]["collision"][0]["geometry"] = {"kind": "mesh", "blobSha256": "a" * 64, "scale": [1, 1, 1]}
    assert code(scene, models) == "GEOMETRY_UNSUPPORTED"


def test_identifiers_cannot_inject_world_text():
    scene, models = single()
    scene["world"]["obstacles"][0]["id"] = 'x" Solid { controller "evil" }'
    assert code(scene, models) == "ID_INVALID"


def test_a_scene_robot_without_a_model_is_refused():
    scene, models = single()
    assert code(scene, {}) == "MODEL_MISSING"
