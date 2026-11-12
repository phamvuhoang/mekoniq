"""M03: mujoco_worker.compile.compile_cell turns the xarm6-g2-v1 fixture plus an ArmCellSceneV1 into MJCF. Loaded on the pinned MuJoCo to check what the engine ends up with."""
import copy
import json
import math
import re
import shutil

import jsonschema
import mujoco
import numpy as np
import pytest
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

from mujoco_worker.compile import CompileError, compile_cell
from scene_fixture import BLOBS, SCHEMAS, cell_scene, load

COMPONENT, PHYSICS = load("component.json"), load("physics.json")
SAFE = re.compile(r"^[A-Za-z0-9_]+$")


def build(scene=None, component=None, physics=None, blob_dir=BLOBS):
    return compile_cell(scene or cell_scene(), component or copy.deepcopy(COMPONENT), physics or copy.deepcopy(PHYSICS), blob_dir)


def loaded(scene=None, **kw):
    mjcf, names = build(scene, **kw)
    return mujoco.MjModel.from_xml_string(mjcf), names


def code(**kw):
    with pytest.raises(CompileError) as e:
        build(**kw)
    return e.value.code


def joint(component, jid):
    return next(j for j in component["joints"] if j["id"] == jid)


def link(component, lid):
    return next(l for l in component["links"] if l["id"] == lid)


def test_scene_helper_matches_the_contract():
    registry = Registry()
    for f in sorted(SCHEMAS.glob("*.schema.json")):
        s = json.loads(f.read_text())
        r = Resource.from_contents(s, default_specification=DRAFT7)
        registry = registry.with_resource(f.name, r).with_resource(s["$id"], r)
    v = jsonschema.Draft7Validator({"$ref": "arm-cell-scene-v1.schema.json"}, registry=registry)
    for ids in (("cup-1",), ("cup-1", "cup-2", "cup-3")):
        assert list(v.iter_errors(cell_scene(ids))) == []


def test_cell_compiles():
    m, names = loaded()
    d = mujoco.MjData(m)
    mujoco.mj_forward(m, d)
    assert m.opt.timestep == 0.002 and m.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST and m.opt.cone == mujoco.mjtCone.mjCONE_ELLIPTIC
    assert m.opt.impratio == PHYSICS["contact"]["impratio"]
    assert all(w.number == 0 for w in d.warning)
    assert names["joints"] == [f"J{i}" for i in range(1, 7)]
    gains = {a["joint"]: a for a in PHYSICS["actuators"]}
    for i, jn in enumerate(names["joints"]):
        cj, mj = joint(COMPONENT, f"J{i + 1}"), m.joint(jn)
        assert mj.type[0] == mujoco.mjtJoint.mjJNT_HINGE and mj.limited[0] == 1
        assert list(mj.range) == [cj["limits"]["lower"]["value"], cj["limits"]["upper"]["value"]]
        assert m.dof_armature[mj.dofadr[0]] == PHYSICS["armatureKgM2"][i]
        assert m.dof_damping[mj.dofadr[0]] == PHYSICS["jointDynamics"]["damping"] and m.dof_frictionloss[mj.dofadr[0]] == PHYSICS["jointDynamics"]["frictionloss"]
        a = m.actuator(f"J{i + 1}_act")
        assert a.trnid[0] == mj.id and a.biastype[0] == mujoco.mjtBias.mjBIAS_AFFINE
        effort = cj["limits"]["effort"]["value"]
        assert list(a.forcerange) == [-effort, effort] and list(a.ctrlrange) == list(mj.range)
        assert a.gainprm[0] == gains[cj["id"]]["kp"] and a.biasprm[1] == -gains[cj["id"]]["kp"] and a.biasprm[2] == -gains[cj["id"]]["kv"]
    assert [m.actuator(i).name for i in range(m.nu)] == [f"J{i}_act" for i in range(1, 7)] + ["grip_act"]
    g, drive = PHYSICS["gripper"], joint(COMPONENT, PHYSICS["gripper"]["driveJoint"])
    ga = m.actuator("grip_act")
    assert names["gripper"] == "grip_act" and ga.gainprm[0] == g["kp"] and ga.biasprm[2] == -g["kv"] and list(ga.forcerange) == [-g["forceRangeNm"], g["forceRangeNm"]]
    assert list(ga.ctrlrange) == [drive["limits"]["lower"]["value"], drive["limits"]["upper"]["value"]]
    assert m.neq == len(g["mimic"]) and all(m.eq_solref[k].tolist() == g["mimicSolref"] for k in range(m.neq))
    for l in COMPONENT["links"]:
        assert m.body(names["links"][l["id"]]).mass[0] == l["massKg"]["value"], l["id"]
    assert [names["links"][f"link{i}"] for i in range(1, 7)] == [f"ARM_link{i}" for i in range(1, 7)] and names["links"]["base"] == "ARM_link0"
    # arm links collide through their meshes (convex hulls), adjacent links are excluded, gripper meshes are visual only (not compiled)
    meshes = [k for k in range(m.ngeom) if m.geom_type[k] == mujoco.mjtGeom.mjGEOM_MESH]
    assert sorted(m.body(m.geom_bodyid[k]).name for k in meshes) == [f"ARM_link{i}" for i in range(7)]
    assert all(m.geom_contype[k] and m.geom_conaffinity[k] for k in meshes)
    assert m.nexclude == 6
    # the default contact parameters of physics.json reach every geom
    assert all(m.geom_solref[k].tolist() == PHYSICS["contact"]["solref"] for k in range(m.ngeom))
    assert all(m.geom_solimp[k][:3].tolist() == PHYSICS["contact"]["solimp"] for k in range(m.ngeom))


def test_cell_is_deterministic():
    scene = cell_scene(("cup-1", "cup-2"), statics=[{"id": "wall", "kind": "box", "min": [-0.5, 0.6, 0], "max": [0.5, 0.7, 0.5]}])
    a, na = build(scene)
    b, nb = build(copy.deepcopy(scene))
    assert a == b and na == nb
    assert a.count(str(BLOBS)) == 1  # the one absolute path is the caller's blob directory


def test_props_and_supports():
    scene = cell_scene(("cup-1", "cup-2"))
    m, names = loaded(scene)
    d = mujoco.MjData(m)
    mujoco.mj_resetDataKeyframe(m, d, m.key("home").id)
    mujoco.mj_forward(m, d)
    w = scene["world3d"]
    for n, p in enumerate(scene["props"], 1):
        body = m.body(names["props"][p["propId"]])
        assert body.name == f"PROP_{n}" and m.jnt_type[body.jntadr[0]] == mujoco.mjtJoint.mjJNT_FREE and body.mass[0] == pytest.approx(p["massKg"], abs=1e-12)
        gid = body.geomadr[0]
        assert m.geom_type[gid] == mujoco.mjtGeom.mjGEOM_CYLINDER and m.geom_size[gid][:2].tolist() == [p["radiusM"], p["heightM"] / 2]
        assert (m.geom_contype[gid], m.geom_conaffinity[gid]) == (0, 0) and m.geom_condim[gid] == PHYSICS["contact"]["condim"]
        assert m.geom_friction[gid].tolist() == [w["propFriction"], *PHYSICS["contact"]["propFriction"][1:]]
        assert d.xpos[body.id].tolist() == [0, 0, -10 - n]
    assert names["propContact"] == {"contype": 1, "conaffinity": 3}
    assert d.ncon == 0
    for s in scene["supports"]:
        gid = m.geom(names["supports"][s["id"]]).id
        assert m.geom_bodyid[gid] == 0 and m.geom_type[gid] == mujoco.mjtGeom.mjGEOM_BOX
        assert m.geom_size[gid].tolist() == [v / 2 for v in s["sizeM"]] and d.geom_xpos[gid].tolist() == s["centerM"]
        assert m.geom_friction[gid].tolist() == [w["supportFriction"], *PHYSICS["contact"]["propFriction"][1:]]
    assert set(names["supports"]) == {"nozzle-stand", "tray"}
    assert len(names["pads"]) == 2
    for gname, pad in zip(names["pads"], PHYSICS["pads"]):
        gid = m.geom(gname).id
        assert m.body(m.geom_bodyid[gid]).name == names["links"][pad["link"]]
        assert m.geom_type[gid] == mujoco.mjtGeom.mjGEOM_BOX and m.geom_condim[gid] == 4 and m.geom_priority[gid] == 1
        assert m.geom_size[gid].tolist() == [v / 2 for v in pad["sizeM"]] and m.geom_pos[gid].tolist() == pad["centerM"]
        assert m.geom_friction[gid].tolist() == [w["padFriction"], *PHYSICS["contact"]["padFriction"][1:]]
    palm = m.geom(names["palm"]).id
    assert m.geom_size[palm].tolist() == [v / 2 for v in PHYSICS["palm"]["sizeM"]]


def test_world3d_frictions_come_from_the_scene():
    scene = cell_scene()
    scene["world3d"].update(padFriction=0.1, propFriction=0.7, supportFriction=0.9)
    m, names = loaded(scene)
    assert {m.geom_friction[m.geom(g).id][0] for g in names["pads"]} == {0.1}
    assert m.geom_friction[m.body(names["props"]["cup-1"]).geomadr[0]][0] == 0.7
    assert {m.geom_friction[m.geom(g).id][0] for g in names["supports"].values()} == {0.9}


def test_home_pose():
    scene = cell_scene()
    m, names = loaded(scene)
    d = mujoco.MjData(m)
    mujoco.mj_resetDataKeyframe(m, d, m.key("home").id)
    mujoco.mj_forward(m, d)
    home = scene["arm"]["homeRad"]
    assert d.qpos[:6].tolist() == home and d.ctrl[:6].tolist() == home and d.ctrl[6] == 0.0
    assert all(w.number == 0 for w in d.warning) and np.isfinite(d.qacc).all()


def test_statics_are_placed_through_base_in_map():
    yaw = math.pi / 2
    scene = cell_scene(statics=[{"id": "box-a", "kind": "box", "min": [0.6, -0.1, 0.0], "max": [0.8, 0.1, 0.2]}, {"id": "ball", "kind": "sphere", "center": [0.0, 0.7, 0.3], "radiusM": 0.05}])
    scene["arm"]["baseInMap"] = {"position": [2.0, 1.0, 0.5], "quaternionXyzw": [0, 0, math.sin(yaw / 2), math.cos(yaw / 2)]}
    m, names = loaded(scene)
    d = mujoco.MjData(m)
    mujoco.mj_forward(m, d)
    assert d.xpos[m.body("ARM_link0").id] == pytest.approx([2.0, 1.0, 0.5])
    assert d.geom_xpos[m.geom(names["statics"]["box-a"]).id] == pytest.approx([2.0, 1.7, 0.6])
    assert d.geom_xpos[m.geom(names["statics"]["ball"]).id] == pytest.approx([1.3, 1.0, 0.8])


def test_rejects(tmp_path):
    def comp(fn):
        c = copy.deepcopy(COMPONENT)
        fn(c)
        return c

    def prismatic(c):
        joint(c, "J3")["kind"] = "prismatic"

    def nine(c):  # three more revolute joints between link6 and the gripper
        fix = next(j for j in c["joints"] if j["kind"] == "fixed")
        for k in (7, 8, 9):
            c["links"].append({**copy.deepcopy(link(c, "link6")), "id": f"link{k}"})
            c["joints"].append({**copy.deepcopy(joint(c, "J6")), "id": f"J{k}", "parent": f"link{k - 1}", "child": f"link{k}"})
        fix["parent"] = "link9"

    assert code(component=comp(prismatic)) == "JOINT_UNSUPPORTED"
    assert code(component=comp(nine)) == "ARM_TOO_MANY_JOINTS"
    assert code(component=comp(lambda c: link(c, "link3")["massKg"].update(value=0))) == "MASS_INVALID"
    assert code(component=comp(lambda c: link(c, "left_finger")["massKg"].update(value=-1))) == "MASS_INVALID"
    assert code(component=comp(lambda c: link(c, "link2").update(inertiaKgM2=None))) == "INERTIA_MISSING"
    for f in BLOBS.iterdir():
        shutil.copyfile(f, tmp_path / f.name)
    sha = link(COMPONENT, "link4")["collision"][0]["geometry"]["blobSha256"]
    (tmp_path / f"{sha}.stl").write_bytes(b"solid not the vendor mesh\n")
    assert code(blob_dir=tmp_path) == "MESH_BLOB_MISMATCH"
    (tmp_path / f"{sha}.stl").unlink()
    assert code(blob_dir=tmp_path) == "MESH_BLOB_MISSING"
    for bad in ([0.0] * 5, [0.0, 0.0, 0.0, 0.0, 3.2, 0.0], [0.0, 2.1, 0.0, 0.0, 0.0, 0.0], [math.nan] * 6):
        s = cell_scene()
        s["arm"]["homeRad"] = bad
        assert code(scene=s) == "ARM_HOME_OUT_OF_RANGE", bad
    for change in ({"radiusM": 0}, {"heightM": -0.1}, {"massKg": math.inf}, {"kind": "mug"}):
        s = cell_scene()
        s["props"][0].update(change)
        assert code(scene=s) == "PROP_INVALID", change
    s = cell_scene(("cup-1", "cup-1"))
    assert code(scene=s) == "PROP_INVALID"
    p = copy.deepcopy(PHYSICS)
    del p["gripper"]["kp"]
    assert code(physics=p) == "INPUT_INVALID"


def test_safe_names():
    scene = cell_scene(("cup 1",), statics=[{"id": "3.table", "kind": "box", "min": [-0.4, 0.5, 0.0], "max": [0.4, 0.9, 0.3]}])
    mjcf, names = build(scene)
    m = mujoco.MjModel.from_xml_string(mjcf)
    assert names["props"] == {"cup 1": "PROP_1"} and names["statics"] == {"3.table": "STATIC_1"}
    assert m.body("PROP_1").id > 0 and m.geom("STATIC_1").id >= 0
    flat = [names["gripper"], names["palm"], *names["joints"], *names["actuators"], *names["pads"], *names["props"].values(), *names["statics"].values(), *names["supports"].values(), *names["links"].values()]
    assert all(SAFE.match(n) for n in flat)
    assert "cup 1" not in mjcf and "3.table" not in mjcf
