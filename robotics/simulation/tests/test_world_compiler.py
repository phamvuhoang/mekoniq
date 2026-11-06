"""World compiler (SIM-03, SIM-05): one AssetRevision set -> SDF, occupancy, bindings, URDF/Nav2 config, scene index and a hashed manifest.
Pure Python, no ROS. The fixture hashes were produced by the TypeScript canonical hasher (tests/fixtures/digital-twin, sealed by lab-v2 hashJson),
so passing here is the TS/Python golden-vector parity check. Geometry is illustrative."""
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import rfc8785

from compiler.compile_world import CompileError, compile_world

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin"


@pytest.fixture
def restaurant_v2():
    fx = json.loads((FIXTURES / "restaurant-v2.json").read_text())
    assets = [json.loads((FIXTURES / f).read_text()) for f in fx["assetFiles"]]
    return SimpleNamespace(project=fx["project"], assets=assets, expected_input_hash=fx["expected"]["inputHash"],
                           expected_collision_bounds=fx["expected"]["collisionBounds"], table_center_x=fx["expected"]["tableCenterX"])


def read_binding(out, point_id):
    return json.loads((out / "bindings.json").read_text())["bindings"][point_id]


def test_visual_collision_and_map_share_revision(tmp_path, restaurant_v2):
    result = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path)
    assert result["inputHash"] == restaurant_v2.expected_input_hash
    assert {entry["path"] for entry in result["outputs"]} >= {"world.sdf", "map.pgm", "map.identity.json", "bindings.json"}
    assert result["units"] == "m"
    assert result["collisionAssetRevisionRefs"] == result["visualAssetRevisionRefs"]
    assert result["collisionBounds"] == restaurant_v2.expected_collision_bounds
    assert read_binding(tmp_path, "table-1")["x"] != restaurant_v2.table_center_x


def test_bundle_is_hashed_deterministic_and_timestamp_free(tmp_path, restaurant_v2):
    a = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path / "a")
    b = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path / "b")
    assert a == b and a["manifestHash"] == b["manifestHash"]
    for entry in a["outputs"]:
        assert hashlib.sha256((tmp_path / "a" / entry["path"]).read_bytes()).hexdigest() == entry["sha256"]
        assert (tmp_path / "a" / entry["path"]).read_bytes() == (tmp_path / "b" / entry["path"]).read_bytes()
    written = json.loads((tmp_path / "a" / "compiler-manifest.json").read_text())
    assert written == a and "generatedAt" not in json.dumps(a)
    assert a["inputHash"] == hashlib.sha256(rfc8785.dumps({"project": restaurant_v2.project, "assets": restaurant_v2.assets})).hexdigest()
    assert [e["path"] for e in a["outputs"]] == sorted(e["path"] for e in a["outputs"])


def test_bindings_are_outside_furniture_face_the_table_and_carry_yaw(tmp_path, restaurant_v2):
    result = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path)
    b = read_binding(tmp_path, "table-1")
    table = next(o for o in restaurant_v2.project["world"]["obstacles"] if o["id"] == "table-1-top")
    radius = result["robots"][0]["radiusM"]
    # the robot footprint circle sits clear of the table top (handoff pose is not the table centre)
    nx = min(max(b["x"], table["x"]), table["x"] + table["width"]); ny = min(max(b["y"], table["y"]), table["y"] + table["height"])
    assert ((b["x"] - nx) ** 2 + (b["y"] - ny) ** 2) ** 0.5 >= radius
    # yaw faces the table centre (radians, world frame)
    import math
    assert abs(math.atan2(7 - b["y"], 7 - b["x"]) - b["yaw"]) < 1e-9 or abs(math.atan2(2 - b["y"], 7 - b["x"]) - b["yaw"]) < 1e-9
    assert b["frame"] == "map" and b["mapId"] == result["map"]["mapId"] and b["mapRevision"] == result["map"]["mapRevision"]
    assert b["zone"]["radiusM"] == radius
    # kitchen/parking bindings keep their taught position
    assert read_binding(tmp_path, "kitchen")["x"] == 1.5 and read_binding(tmp_path, "parking")["y"] == 1


def test_map_identity_and_occupancy_are_raw_not_inflated(tmp_path, restaurant_v2):
    result = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path)
    ident = json.loads((tmp_path / "map.identity.json").read_text())
    pgm = (tmp_path / "map.pgm").read_bytes()
    assert ident["mapId"] == "lab-world" and ident["mapRevision"] == "1" and ident["frame"] == "map" and ident["resolution"] == 0.05
    assert ident["pgmSha256"] == hashlib.sha256(pgm).hexdigest() and ident["origin"] == [0, 0, 0]
    header, body = pgm.split(b"255\n", 1)
    assert b"240 160" in header
    cells = body
    nx = 240
    cell = lambda x, y: cells[(160 - 1 - int(y / 0.05)) * nx + int(x / 0.05)]
    assert cell(7.0, 2.0) == 0 and cell(4.0, 1.0) == 0        # table top and corridor wall are occupied
    assert cell(6.5, 2.0) == 254 and cell(4.0, 4.0) == 254    # 0.1 m beside the table is free: no inflation in the raw map
    assert (tmp_path / "map.yaml").read_text().startswith("image: map.pgm\n")
    assert result["map"]["inflation"] == "none"


def test_robot_bundle_has_namespace_urdf_nav2_overlay_and_scene_index(tmp_path, restaurant_v2):
    project = copy.deepcopy(restaurant_v2.project)
    project["entities"].append({**copy.deepcopy(project["entities"][0]), "id": "amr-2"})
    project["world"]["points"].append({"id": "bay-2", "name": "Bay 2", "kind": "parking", "x": 1.5, "y": 7})
    result = compile_world(project, restaurant_v2.assets, tmp_path)
    assert [r["namespace"] for r in result["robots"]] == ["robot_amr_1", "robot_amr_2"]
    for r in result["robots"]:
        urdf = (tmp_path / f"robot-{r['entityId']}.urdf").read_text()
        assert f"/{r['namespace']}/cmd_vel" in urdf and urdf.count("cmd_vel") == 1 and "gz-sim-diff-drive-system" in urdf
        assert '<mass value="20' in urdf
        overlay = (tmp_path / f"nav2-{r['entityId']}.yaml").read_text()
        assert f"namespace: {r['namespace']}" in overlay and "robot_radius:" in overlay and "use_sim_time: true" in overlay
    assert {r["mass"]["provenance"] for r in result["robots"]} == {"illustrative"}
    scene = json.loads((tmp_path / "scene-index.json").read_text())
    assert [e["entityId"] for e in scene["entities"]] == ["amr-1", "amr-2"]
    assert scene["entities"][0]["assetRef"]["contentHash"] == restaurant_v2.assets[0]["contentHash"]
    assert scene["entities"][0]["jointAuthority"] == [{"joint": "left_wheel_joint", "controller": "gz_diff_drive"}, {"joint": "right_wheel_joint", "controller": "gz_diff_drive"}]
    assert scene["entities"][0]["telemetry"]["pose"] == "/model/robot_amr_1/pose"
    assert "assumptions" in result and any("handoff" in a for a in result["assumptions"])


def mutate(fx, what):
    project, assets = copy.deepcopy(fx.project), copy.deepcopy(fx.assets)
    if what == "negative_scale":
        project["world"]["obstacles"][0]["width"] = -1
    elif what == "asset_hash_mismatch":
        assets[0]["geometry"][0]["sizeM"] = [0.6, 0.55, 0.16]  # content changed, contentHash not re-sealed
    elif what == "collision_missing":
        assets[0]["geometry"] = []
        assets[0]["contentHash"] = seal(assets[0]); project["entities"][0]["assetRef"]["contentHash"] = assets[0]["contentHash"]
    elif what == "frame_unknown":
        assets[0]["geometry"][0]["frameId"] = "nope"
        assets[0]["contentHash"] = seal(assets[0]); project["entities"][0]["assetRef"]["contentHash"] = assets[0]["contentHash"]
    elif what == "bad_quaternion":
        assets[0]["frames"][1]["quaternionXyzw"] = [0, 0, 0, 0.5]
        assets[0]["contentHash"] = seal(assets[0]); project["entities"][0]["assetRef"]["contentHash"] = assets[0]["contentHash"]
    elif what == "near_boundary":
        project["world"]["points"][1]["x"] = 0.3; project["world"]["points"][1]["y"] = 0.3
    elif what == "duplicate_id":
        project["entities"][0]["id"] = "table-1"
    elif what == "mass_missing":
        del assets[0]["inertial"]
        assets[0]["contentHash"] = seal(assets[0]); project["entities"][0]["assetRef"]["contentHash"] = assets[0]["contentHash"]
    elif what == "asset_missing":
        project["entities"][0]["assetRef"]["id"] = "other"
    elif what == "unsafe_id":
        project["entities"][0]["id"] = "../amr"
    return project, assets


def seal(asset):
    return hashlib.sha256(rfc8785.dumps({k: v for k, v in asset.items() if k != "contentHash"})).hexdigest()


@pytest.mark.parametrize("what,code", [("negative_scale", "GEOMETRY_NOT_POSITIVE"), ("asset_hash_mismatch", "ASSET_HASH_MISMATCH"), ("collision_missing", "COLLISION_MISSING"),
                                       ("frame_unknown", "FRAME_UNKNOWN"), ("bad_quaternion", "QUATERNION_NOT_NORMALIZED"), ("near_boundary", "TARGET_CLEARANCE"),
                                       ("duplicate_id", "ID_DUPLICATE"), ("mass_missing", "MASS_MISSING"), ("asset_missing", "ASSET_MISSING"), ("unsafe_id", "ID_INVALID")])
def test_invalid_input_names_its_code_and_writes_no_partial_bundle(tmp_path, restaurant_v2, what, code):
    project, assets = mutate(restaurant_v2, what)
    with pytest.raises(CompileError) as e:
        compile_world(project, assets, tmp_path)
    assert e.value.code == code
    assert not list(tmp_path.iterdir())


def test_output_directory_must_stay_inside_the_run_root(tmp_path, restaurant_v2):
    with pytest.raises(CompileError) as e:
        compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path / "run" / ".." / ".." / "escape", run_root=tmp_path / "run")
    assert e.value.code == "OUTPUT_OUTSIDE_RUN_ROOT"
    assert not (tmp_path / "escape").exists()


def test_committed_golden_manifest_matches_a_fresh_compile(tmp_path, restaurant_v2):
    """tests/fixtures/digital-twin/bundle/compiler-manifest.json is what the TypeScript side reads back; it must never drift from the compiler."""
    fresh = compile_world(restaurant_v2.project, restaurant_v2.assets, tmp_path)
    golden = json.loads((FIXTURES / "bundle" / "compiler-manifest.json").read_text())
    assert golden == fresh, "re-generate the golden manifest after a deliberate compiler change"


def test_compiler_cli_writes_a_bundle_from_fixture_files_and_exits_nonzero_on_invalid_input(tmp_path):
    import subprocess
    import sys
    root = Path(__file__).resolve().parents[1]
    fx = FIXTURES / "restaurant-v2.json"
    done = subprocess.run([sys.executable, "-m", "compiler", "--fixture", str(fx), "--out", str(tmp_path / "b"), "--scenario", str(FIXTURES / "scenarios" / "fd04-blocked.json")],
                          cwd=root, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    summary = json.loads(done.stdout)
    assert summary["inputHash"] and summary["outputDirectory"] == str(tmp_path / "b") and (tmp_path / "b" / "compiler-manifest.json").is_file()
    assert summary["scenario"]["scenarioId"] == "FD04"
    bad = subprocess.run([sys.executable, "-m", "compiler", "--fixture", str(tmp_path / "missing.json"), "--out", str(tmp_path / "c")], cwd=root, capture_output=True, text=True)
    assert bad.returncode == 2 and "FIXTURE_MISSING" in bad.stderr and not (tmp_path / "c").exists()
