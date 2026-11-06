import copy
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "engineering"


def load(name, key=None):
    data = json.loads((FIXTURES / name).read_text())
    return data[key] if key else data


def rehash(inp):
    """Re-seal an edited input the way the TS pipeline would, so a test can reach the semantic check it targets instead of the hash guard."""
    from compiler.manifest import canonical_hash
    inp["projectDigest"] = canonical_hash(inp["project"])
    body = {k: v for k, v in inp["resolved"].items() if k != "assemblyDigest"}
    inp["resolved"]["assemblyDigest"] = canonical_hash(body)
    return inp


def compile_to(inp, path):
    from compiler.engineering import compile_engineering
    return compile_engineering(inp, path)


def read(path, name):
    return (path / name).read_bytes()


def test_wheel_radius_has_one_source(tmp_path):
    result = compile_to(load("compile-radius-100.json"), tmp_path)
    scene = json.loads(read(tmp_path, "scene.json"))
    binding = {b["id"]: b for b in scene["wheelBindings"]}["amr-1/left"]
    assert binding["radiusM"] == 0.1 and binding["jointId"] == "wheel-left/axle"
    urdf = ET.parse(tmp_path / "robots/amr-1.urdf")
    cylinder = urdf.find(".//link[@name='wheel-left/rim']/collision/geometry/cylinder")
    assert cylinder is not None and float(cylinder.attrib["radius"]) == 0.1
    cfg = yaml.safe_load(read(tmp_path, "controllers/amr-1.yaml"))
    assert cfg["diff_drive_controller"]["ros__parameters"]["wheel_radius"] == 0.1
    old = compile_to(load("compile-radius-075.json"), tmp_path / "old")
    assert result["sceneDigest"] != old["sceneDigest"]
    assert yaml.safe_load(read(tmp_path / "old", "controllers/amr-1.yaml"))["diff_drive_controller"]["ros__parameters"]["wheel_radius"] == 0.075
    assert {b["id"]: b for b in json.loads(read(tmp_path / "old", "scene.json"))["wheelBindings"]}["amr-1/left"]["radiusM"] == 0.075


def test_output_is_deterministic_and_listed_with_hashes(tmp_path):
    import hashlib
    a = compile_to(load("compile-radius-100.json"), tmp_path / "a")
    b = compile_to(load("compile-radius-100.json"), tmp_path / "b")
    assert a == b
    paths = [f["path"] for f in a["files"]]
    assert paths == sorted(paths)
    assert {"scene.json", "world.sdf", "bindings.json", "map.pgm", "map.yaml", "map.identity.json", "robots/amr-1.urdf", "controllers/amr-1.yaml", "nav2/amr-1.yaml", "compiler-manifest.json"} <= set(paths)
    for f in a["files"]:
        assert hashlib.sha256((tmp_path / "a" / f["path"]).read_bytes()).hexdigest() == f["sha256"]
    assert a["sceneDigest"] == hashlib.sha256(read(tmp_path / "a", "scene.json")).hexdigest()


def test_urdf_keeps_explicit_inertials_joints_and_limits(tmp_path):
    compile_to(load("compile-radius-100.json"), tmp_path)
    urdf = ET.parse(tmp_path / "robots/amr-1.urdf").getroot()
    base = urdf.find("./link[@name='chassis/base']/inertial")
    assert float(base.find("mass").attrib["value"]) == 20
    assert float(base.find("inertia").attrib["ixx"]) == pytest.approx(20 / 12 * (0.4 ** 2 + 0.15 ** 2))
    axle = urdf.find("./joint[@name='wheel-left/axle']")
    assert axle.attrib["type"] == "continuous" and axle.find("limit").attrib["velocity"] == "30"
    mount = urdf.find("./joint[@name='mount:chassis/left-axle:wheel-left/mount']")
    assert mount.attrib["type"] == "fixed" and mount.find("origin").attrib["xyz"] == "0 0.225 0"


def test_fixed_joint_mapping_keeps_original_identity(tmp_path):
    compile_to(load("compile-radius-100.json"), tmp_path)
    mapping = json.loads(read(tmp_path, "scene.json"))["fixedJointMapping"]
    entry = next(m for m in mapping if m["jointId"] == "mount:chassis/battery-bay:battery/mount")
    assert (entry["linkId"], entry["mergedInto"]) == ("battery/pack", "chassis/base")
    assert all(m["jointId"] != "wheel-left/axle" for m in mapping)  # moving joints are never lumped


def test_incomplete_or_inconsistent_inputs_are_rejected_not_defaulted(tmp_path):
    from compiler.models import CompileError
    base = load("compile-radius-100.json")
    with pytest.raises(CompileError) as e:
        compile_to(base["resolved"], tmp_path / "bare")  # a bare ResolvedAssembly is not an input
    assert e.value.code == "COMPILE_INPUT_INCOMPLETE"
    tampered = copy.deepcopy(base)
    tampered["project"]["revision"] += 1
    with pytest.raises(CompileError) as e:
        compile_to(tampered, tmp_path / "t")
    assert e.value.code == "INPUT_HASH_MISMATCH"
    no_drive = copy.deepcopy(base)
    no_drive["resolved"]["models"]["drive"] = None
    with pytest.raises(CompileError) as e:
        compile_to(rehash(no_drive), tmp_path / "d")
    assert e.value.code == "WHEEL_RADIUS_REQUIRED"
    no_radius = copy.deepcopy(base)
    del no_radius["resolved"]["models"]["drive"]["model"]["parameters"]["drive"]["wheelRadiusM"]
    with pytest.raises(CompileError) as e:
        compile_to(rehash(no_radius), tmp_path / "r")
    assert e.value.code in ("WHEEL_RADIUS_REQUIRED", "COMPILE_INPUT_INCOMPLETE")
    lost_asset = copy.deepcopy(base)
    lost_asset["runtimeProjection"]["assets"] = []
    with pytest.raises(CompileError) as e:
        compile_to(rehash(lost_asset), tmp_path / "a")
    assert e.value.code == "ASSET_REF_UNRESOLVED"
    assert not (tmp_path / "bare").exists() and not (tmp_path / "t").exists()  # no partial bundle


def variants():
    return load("compile-world-variants.json")


def test_v17_obstacle_changes_map_scene_and_bundle_identity(tmp_path):
    base, obstacle = variants()["base"], variants()["obstacle"]
    a, b = compile_to(base, tmp_path / "a"), compile_to(obstacle, tmp_path / "b")
    assert read(tmp_path / "a", "map.pgm") != read(tmp_path / "b", "map.pgm")
    assert json.loads(read(tmp_path / "a", "map.identity.json"))["pgmSha256"] != json.loads(read(tmp_path / "b", "map.identity.json"))["pgmSha256"]
    fixtures = json.loads(read(tmp_path / "b", "scene.json"))["world"]["fixtures"]
    assert [f for f in fixtures if f["obstacleId"] == "shelf"] == [{"obstacleId": "shelf", "x": 2.5, "y": 1, "width": 0.5, "height": 0.5, "heightM": 0.75}]
    assert not json.loads(read(tmp_path / "a", "scene.json"))["world"]["fixtures"]
    assert a["sceneDigest"] != b["sceneDigest"]
    assert json.loads(read(tmp_path / "a", "compiler-manifest.json"))["manifestHash"] != json.loads(read(tmp_path / "b", "compiler-manifest.json"))["manifestHash"]


def test_v17_world_bounds_change_the_raster(tmp_path):
    compile_to(variants()["base"], tmp_path / "a")
    compile_to(variants()["bigger"], tmp_path / "b")
    ia, ib = (json.loads(read(tmp_path / n, "map.identity.json")) for n in "ab")
    assert (ia["widthCells"], ib["widthCells"]) == (120, 140)
    assert ia["worldHash"] != ib["worldHash"] and ia["mapRevision"] != ib["mapRevision"]


def test_v17_handoff_yaw_changes_goal_not_necessarily_the_raster(tmp_path):
    compile_to(variants()["base"], tmp_path / "a")
    compile_to(variants()["handoff"], tmp_path / "b")
    yaw = lambda p: json.loads(read(p, "bindings.json"))["bindings"]["t1"]["yaw"]
    assert yaw(tmp_path / "b") == 1.25 and yaw(tmp_path / "a") != 1.25
    assert read(tmp_path / "a", "map.pgm") == read(tmp_path / "b", "map.pgm")
    assert json.loads(read(tmp_path / "b", "bindings.json"))["bindings"]["t1"]["x"] == 4.0  # custom id and coordinates survive exactly


def test_v17_speed_limit_reaches_controller_and_nav2(tmp_path):
    compile_to(variants()["base"], tmp_path / "a")
    compile_to(variants()["speed"], tmp_path / "b")
    limit = lambda p: yaml.safe_load(read(p, "controllers/amr-1.yaml"))["diff_drive_controller"]["ros__parameters"]["linear"]["x"]["max_velocity"]
    assert limit(tmp_path / "b") == 0.2 and limit(tmp_path / "a") != 0.2
    assert "max_linear_mps: 0.2" in read(tmp_path / "b", "nav2/amr-1.yaml").decode()


def test_actuator_fidelity_is_declared_ideal(tmp_path):
    compile_to(load("compile-radius-100.json"), tmp_path)
    manifest = json.loads(read(tmp_path, "compiler-manifest.json"))
    assert manifest["actuator"] == {"fidelity": "ideal", "enforces": ["velocity_limit"], "note": manifest["actuator"]["note"]}
    assert any("ideal" in a for a in manifest["assumptions"])
