"""X03 (R1.1): the arm world of webots_worker.compile. Pure text in, text out: no engine. The AMR worlds must not change a byte."""
import copy
import hashlib
import json
import math
import re
from pathlib import Path

import pytest

from webots_worker.compile import CompileError, compile_arm_world, compile_world

FX = Path(__file__).resolve().parents[1] / "fixtures"
ARM = FX / "arm-ref-3d-v1"
BASE = {"position": [2.0, 1.0, 0.75], "quaternionXyzw": [0.0, 0.0, math.sin(0.3), math.cos(0.3)]}  # yaw 0.6 rad
HOME = [0, -0.6, 1.2, 0, 0.6, 0]


def model():
    return json.loads((ARM / "component.json").read_text())


def scene(**over):
    s = {"schemaVersion": 1, "sceneDigest": "0" * 64,
         "arm": {"armId": "arm-1", "modelId": "arm-ref-3d-v1", "modelRevision": "a" * 64, "baseInMap": BASE, "homeRad": HOME},
         "statics": [{"id": "table-1", "kind": "box", "min": [0.2, -0.3, -0.4], "max": [0.6, 0.3, -0.3]}, {"id": "pillar", "kind": "sphere", "center": [0.0, 0.8, 0.0], "radiusM": 0.1}],
         "world3d": {"floorFriction": 0.8, "provenance": "assumed"}, "engine": {"id": "webots_3d", "basicTimeStepMs": 20}, "engineSeed": 7}
    s.update(over)
    return s


def code(sc, mo):
    with pytest.raises(CompileError) as e:
        compile_arm_world(sc, mo)
    return e.value.code


NUM = r"(-?[0-9.e+-]+)"
VEC3 = rf"{NUM} {NUM} {NUM}"
VEC4 = rf"{NUM} {NUM} {NUM} {NUM}"


# ---- minimal rigid algebra, independent of the compiler's (rows of a 3x3, translation) ----
def rot(axis, angle):
    x, y, z = axis
    n = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / n, y / n, z / n
    c, s, t = math.cos(angle), math.sin(angle), 1 - math.cos(angle)
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]]


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mv(a, v):
    return [sum(a[i][k] * v[k] for k in range(3)) for i in range(3)]


def vec(text):
    return [float(x) for x in text.split()]


def chain(text):
    """(base translation, base rotation, [(position, axis, anchor, translation, rotation)] per joint) read back from the world text."""
    arm = text[text.index("DEF ARM_"):]
    bt = re.search(rf"translation {VEC3}\n", arm)
    br = re.search(rf"rotation {VEC4}\n", arm)
    params = re.findall(rf"HingeJointParameters \{{\s*position {NUM}\s+axis {VEC3}\s+anchor {VEC3}\s*\}}", arm)
    ends = re.findall(rf"endPoint (?:DEF \S+ )?Solid \{{\s*translation {VEC3}\s+rotation {VEC4}", arm)
    assert len(params) == len(ends) > 0
    return ([float(v) for v in bt.groups()], [float(v) for v in br.groups()],
            [(float(p[0]), [float(v) for v in p[1:4]], [float(v) for v in p[4:7]], [float(v) for v in e[:3]], [float(v) for v in e[3:]]) for p, e in zip(params, ends)])


def flange(text, q):
    """FK of the chain written in the world text at joint values q: each endPoint pose holds at the joint's initial position; a joint at q turns it about the parent-frame axis through the anchor."""
    bt, br, joints = chain(text)
    R, t = rot(br[:3], br[3]), bt
    for (pos, axis, anchor, tr, rr), qi in zip(joints, q):
        d = rot(axis, qi - pos)
        child_r = mm(d, rot(rr[:3], rr[3]))
        off = mv(d, [tr[k] - anchor[k] for k in range(3)])
        child_t = [anchor[k] + off[k] for k in range(3)]
        t = [t[k] + v for k, v in enumerate(mv(R, child_t))]
        R = mm(R, child_r)
    return t


# ---- tests ----
def test_arm_world_has_six_hinges():
    text, mo = compile_arm_world(scene(), model()), model()
    assert text.startswith("#VRML_SIM R2025a utf8")
    assert text.count("HingeJoint {") == 6 and text.count("RotationalMotor {") == 6 and text.count("PositionSensor {") == 6
    assert text.count('controller "<extern>"') == 2 and text.count("supervisor TRUE") == 1
    assert "basicTimeStep 20" in text and "randomSeed 7" in text and "DEF ARM_arm_1 Robot {" in text
    motors = re.findall(rf'RotationalMotor \{{\s*name "(J\d_motor)"\s+maxVelocity {NUM}\s+maxTorque {NUM}\s+minPosition {NUM}\s+maxPosition {NUM}', text)
    assert [m[0] for m in motors] == [f"J{i}_motor" for i in range(1, 7)]
    assert re.findall(r'PositionSensor \{\s*name "(J\d_sensor)"', text) == [f"J{i}_sensor" for i in range(1, 7)]
    for m, j in zip(motors, mo["joints"]):
        lim = j["limits"]
        assert [float(v) for v in m[1:]] == pytest.approx([lim["velocity"]["value"], lim["effort"]["value"], lim["lower"]["value"], lim["upper"]["value"]], abs=0, rel=1e-12)
    assert [p[0] for p in chain(text)[2]] == HOME


def test_arm_world_chain_matches_fixture():
    text = compile_arm_world(scene(), model())
    golden = json.loads((ARM / "fk-golden.json").read_text())["poses"]
    assert len(golden) == 5
    bt, br = BASE["position"], BASE["quaternionXyzw"]
    base_r = rot((br[0], br[1], br[2]), 2 * math.atan2(math.hypot(br[0], br[1], br[2]), br[3]))
    for g in golden:
        want = [bt[k] + v for k, v in enumerate(mv(base_r, g["flangeM"]))]
        got = flange(text, g["q"])
        assert math.dist(got, want) <= 1e-9, g["q"]


def test_arm_world_is_deterministic():
    a = compile_arm_world(scene(), model())
    assert a == compile_arm_world(copy.deepcopy(scene()), copy.deepcopy(model()))
    assert a != compile_arm_world(scene(engineSeed=8), model())


def test_arm_world_has_no_amr_cup_or_machine():
    text = compile_arm_world(scene(), model())
    assert "wheel" not in text and "Lidar" not in text and text.count("Robot {") == 2


def test_arm_rejects():
    mo = model()
    for kind in ("prismatic", "continuous", "fixed"):
        bad = copy.deepcopy(mo)
        bad["joints"][2]["kind"] = kind
        assert code(scene(), bad) == "JOINT_UNSUPPORTED", kind
    many = copy.deepcopy(mo)
    for n in range(7, 10):
        many["links"].append({**copy.deepcopy(many["links"][-1]), "id": f"link{n}"})
        many["joints"].append({**copy.deepcopy(many["joints"][-1]), "id": f"J{n}", "parent": f"link{n - 1}", "child": f"link{n}"})
    assert code(scene(), many) == "ARM_TOO_MANY_JOINTS"
    for mass in (0, -1, float("nan")):
        bad = copy.deepcopy(mo)
        bad["links"][3]["massKg"]["value"] = mass
        assert code(scene(), bad) == "MASS_INVALID", mass
    for inertia in (None, [1, 0, 0, 1, 0]):
        bad = copy.deepcopy(mo)
        bad["links"][3]["inertiaKgM2"] = inertia
        assert code(scene(), bad) == "INERTIA_MISSING", inertia
    bad = copy.deepcopy(mo)
    bad["links"][2]["collision"][0]["geometry"] = {"kind": "mesh", "blobSha256": "b" * 64, "scale": [1, 1, 1]}
    assert code(scene(), bad) == "MESH_UNSUPPORTED"
    bad = copy.deepcopy(mo)
    bad["links"][2]["visual"][0]["geometry"] = {"kind": "mesh", "blobSha256": "b" * 64, "scale": [1, 1, 1]}
    assert code(scene(), bad) == "MESH_UNSUPPORTED"
    up = copy.deepcopy(scene())
    up["arm"]["homeRad"][1] = 1.0  # J2 upper limit is 0.785
    assert code(up, mo) == "ARM_HOME_OUT_OF_RANGE"
    short = copy.deepcopy(scene())
    short["arm"]["homeRad"] = HOME[:5]
    assert code(short, mo) == "ARM_HOME_OUT_OF_RANGE"
    assert code(scene(engineSeed=2 ** 31), mo) == "SEED_INVALID"
    assert code(scene(engineSeed=-1), mo) == "SEED_INVALID"
    assert code(scene(engine={"id": "mujoco", "basicTimeStepMs": 20}), mo) == "ENGINE_MISMATCH"
    assert code(scene(engine={"id": "webots_3d", "basicTimeStepMs": 7}), mo) == "TIMESTEP_NOT_DIVISOR"


def test_statics_use_safe_def_names():
    sc = scene(statics=[{"id": "3.table", "kind": "box", "min": [0, 0, 0], "max": [1, 1, 1]}, {"id": "a:b", "kind": "sphere", "center": [0, 0, 0], "radiusM": 0.1}])
    text = compile_arm_world(sc, model())
    assert re.findall(r"^DEF (STATIC_\d+) Solid \{", text, re.M) == ["STATIC_1", "STATIC_2"]
    assert 'name "3.table"' in text and 'name "a_b"' in text and "3.table Solid" not in text and "DEF 3." not in text
    for bad in ('x"y', "x y", "", "../x"):
        assert code(scene(statics=[{"id": bad, "kind": "sphere", "center": [0, 0, 0], "radiusM": 0.1}]), model()) == "ID_INVALID", bad
    clash = scene(statics=[{"id": "a:b", "kind": "sphere", "center": [0, 0, 0], "radiusM": 0.1}, {"id": "a_b", "kind": "sphere", "center": [1, 0, 0], "radiusM": 0.1}])
    assert code(clash, model()) == "ID_INVALID"
    assert code(scene(arm={**scene()["arm"], "armId": 'a"b'}), model()) == "ID_INVALID"


def test_statics_are_placed_from_the_arm_base_frame_into_the_world():
    # sorted by id: pillar is STATIC_1, table-1 is STATIC_2
    text = compile_arm_world(scene(), model())
    sphere = re.search(rf"DEF STATIC_1 Solid \{{\s*translation {VEC3}", text)
    c, s = math.cos(0.6), math.sin(0.6)
    assert [float(v) for v in sphere.groups()] == pytest.approx([2.0 + c * 0.0 - s * 0.8, 1.0 + s * 0.0 + c * 0.8, 0.75 + 0.0], abs=1e-9)
    box = re.search(rf"DEF STATIC_2 Solid \{{\s*translation {VEC3}\s+rotation {VEC4}[\s\S]*?size {VEC3}", text)
    local = [0.4, 0.0, -0.35]  # box centre in the arm base frame
    assert [float(v) for v in box.groups()[:3]] == pytest.approx([2.0 + c * local[0] - s * local[1], 1.0 + s * local[0] + c * local[1], 0.75 + local[2]], abs=1e-9)
    assert [float(v) for v in box.groups()[7:10]] == pytest.approx([0.4, 0.6, 0.1], abs=1e-9)


def test_amr_world_unchanged():
    def load(n):
        return json.loads((FX / "serve-3d-v1" / n).read_text())
    single = compile_world(load("navigation-scene.json"), {"amr-1": load("physical-model-amr-1.json")}, 7)
    fleet = compile_world(load("navigation-scene-two-robot.json"), {r: load(f"physical-model-{r}.json") for r in ("robot01", "robot02")}, 7)
    assert hashlib.sha256(single.encode()).hexdigest() == "7a841131a01e14a6a07e6505396b6b6b6169d9fe26823a79387068e091b8bf9f"
    assert hashlib.sha256(fleet.encode()).hexdigest() == "2d7321fa1b70de613b3151b8b04070041d288d2eb713fe92b951c5052e70d654"


def test_visual_mode_only_adds_shapes_to_the_links_and_never_changes_the_default_world():
    plain, seen = compile_arm_world(scene(), model()), compile_arm_world(scene(), model(), visual=True)
    assert plain == compile_arm_world(scene(), model(), visual=False)
    assert "Shape {" not in plain.split("DEF ARM_")[1]  # the recorded world has no visible arm
    arm = seen.split("DEF ARM_")[1]
    assert arm.count("Pose {") >= 4 and arm.count("Shape {") >= 9  # a rod per link with a length, a ball per joint
    assert seen.count("boundingObject") == plain.count("boundingObject") and seen.count("physics Physics") == plain.count("physics Physics")  # nothing collidable or heavy was added
