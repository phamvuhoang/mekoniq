"""Canonical mobile rigid bodies -> deterministic MJCF. No pose constraints or payload welds.

    Fixed canonical caster spheres remain fixed; explicit floor/caster contact pairs
    override MuJoCo's max-friction mixing. This sliding support approximation is not a
    new canonical caster joint. Body names are generated indices, never user IDs.
"""
import math
import xml.etree.ElementTree as ET

import numpy as np

from .compile import CompileError, _el, _vec, _wxyz, _rot

NUMERICS = {"gravityMps2": [0, 0, -9.81], "solver": "Newton", "condim": 6, "solref": [.02, 1], "solimp": [.9, .95, .001],
            "robotSelfContact": "masked-canonical-fixed-overlaps", "casterContactRule": "explicit-floor-pair",
            "casterPairFriction": "scene-casterFriction-tangent-zero-torsion-rolling", "floorWheelFrictionRule": "max-geom", "lidarSelfFilter": "exclude-robot-geom-group-1"}


def pose(p, q):
    if abs(sum(x*x for x in q) - 1) > 2e-6:
        raise CompileError("QUATERNION_NOT_NORMALIZED")
    out = np.eye(4)
    out[:3, :3], out[:3, 3] = _rot(q), p
    return out


def matrix_pose(t):
    # Matrix -> xyzw using a stable symmetric eigenproblem (also at pi).
    r = t[:3, :3]
    k = np.array([[r[0,0]-r[1,1]-r[2,2], r[0,1]+r[1,0], r[0,2]+r[2,0], r[2,1]-r[1,2]],
                  [r[0,1]+r[1,0], r[1,1]-r[0,0]-r[2,2], r[1,2]+r[2,1], r[0,2]-r[2,0]],
                  [r[0,2]+r[2,0], r[1,2]+r[2,1], r[2,2]-r[0,0]-r[1,1], r[1,0]-r[0,1]],
                  [r[2,1]-r[1,2], r[0,2]-r[2,0], r[1,0]-r[0,1], r.trace()]])
    q = np.linalg.eigh(k)[1][:, -1]
    if q[3] < 0:
        q = -q
    return {"positionM": t[:3, 3].tolist(), "quaternionXyzw": q.tolist()}


def _inertial(body, mass, com, inertia):
    xx, xy, xz, yy, yz, zz = inertia
    moments = np.linalg.eigvalsh([[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]])
    if mass <= 0 or not np.isfinite(moments).all() or moments[0] <= 0 or moments[-1] > sum(moments[:2]) + 1e-12:
        raise CompileError("LOAD_INERTIA_INVALID")
    _el(body, "inertial", mass=_vec([mass]), pos=_vec(com), fullinertia=_vec([xx, yy, zz, xy, xz, yz]))


def _geom(body, name, geometry, **attrs):
    kind = geometry["kind"]
    if kind == "box":
        size = [v / 2 for v in geometry["sizeM"]]
    elif kind == "cylinder":
        size = [geometry["radiusM"], geometry.get("lengthM", geometry.get("heightM")) / 2]
    elif kind == "sphere":
        size = [geometry["radiusM"]]
    else:
        raise CompileError("MODEL_UNSUPPORTED", f"collision primitive {kind}")
    return _el(body, "geom", name=name, type=kind, size=_vec(size), **attrs)


def _check_load(profile):
    supports = {}
    for s in profile["supports"]:
        if s["supportId"] in supports:
            raise CompileError("LOAD_DUPLICATE_SUPPORT")
        pose(s["poseInBody"]["positionM"], s["poseInBody"]["quaternionXyzw"])
        poly = s["polygonM"]
        if not _convex_ccw(poly):
            raise CompileError("LOAD_SUPPORT_INVALID")
        supports[s["supportId"]] = s
    ids = set()
    for p in profile["props"]:
        if p["propId"] in ids:
            raise CompileError("LOAD_DUPLICATE_PROP")
        ids.add(p["propId"])
        a = p["attachment"]
        pp = a["initialPoseInSupport"] if a["kind"] == "free" else a["poseInLink"]
        t = pose(pp["positionM"], pp["quaternionXyzw"])
        if a["kind"] != "free":
            continue
        if a["supportId"] not in supports:
            raise CompileError("LOAD_SUPPORT_UNKNOWN")
        axis, center = t[:3, 2], t[:3, 3]
        com = t[:3, :3] @ p["comM"] + center
        r, half = p["geometry"]["radiusM"], p["geometry"]["heightM"] / 2
        poly = supports[a["supportId"]]["polygonM"]
        for i, v in enumerate(poly):
            edge = np.subtract(poly[(i+1)%len(poly)], v)
            normal = np.array([-edge[1], edge[0]]) / np.linalg.norm(edge)
            dot = float(normal @ axis[:2])
            extent = r * math.sqrt(max(0, 1-dot*dot)) + half*abs(dot)
            if normal @ (center[:2] - v) < extent-1e-9 or normal @ (com[:2]-v) < .005-1e-9:
                raise CompileError("LOAD_OUTSIDE_SUPPORT")
        height = r*math.sqrt(max(0, 1-axis[2]**2)) + half*abs(axis[2])
        if abs(center[2] - height) > 1e-6:
            raise CompileError("LOAD_SUPPORT_HEIGHT_INVALID")


def _convex_ccw(poly):
    if len(set(map(tuple, poly))) != len(poly):
        return False
    edges = [np.subtract(poly[(i+1)%len(poly)], p) for i,p in enumerate(poly)]
    area = sum(p[0]*poly[(i+1)%len(poly)][1] - p[1]*poly[(i+1)%len(poly)][0] for i,p in enumerate(poly))
    return area > 0 and all(np.linalg.norm(e) > 1e-12 and all(e[0]*(v[1]-p[1]) - e[1]*(v[0]-p[0]) >= -1e-12 for v in poly) for p,e in zip(poly,edges))


def compile_mobile(scene, physical_models, load_profile, physics):
    if len(scene["robots"]) != 1 or len(load_profile["props"]) > 8:
        raise CompileError("WORLD_CAPACITY_EXCEEDED")
    _check_load(load_profile)
    if (load_profile["id"], load_profile["revision"]) != (scene["engine"]["loadProfileRef"]["id"], scene["engine"]["loadProfileRef"]["revision"]) or (physics["id"], physics["revision"]) != (scene["engine"]["physicsProfileRef"]["id"], scene["engine"]["physicsProfileRef"]["revision"]):
        raise CompileError("PROFILE_ID_MISMATCH")
    if physics.get("numerics", NUMERICS) != NUMERICS:
        raise CompileError("PHYSICS_PROFILE_INVALID", "numerical assumptions do not match compiler v1")
    eng = scene["engine"]
    if (eng["id"], eng["version"]) != ("mujoco_3d", "3.17.0"):
        raise CompileError("ENGINE_VERSION_MISMATCH")
    if eng["timestepMs"] != 2 or eng["substeps"] != 10 or scene["clock"]["tickMs"] != 20 or any(physics[k] != v for k, v in (("timestepMs", 2), ("substeps", 10), ("tickMs", 20))):
        raise CompileError("PHYSICS_CLOCK_MISMATCH")
    entry = scene["robots"][0]
    rid = entry["robotId"]
    model = physical_models[rid]
    links = {l["id"]: l for l in model["links"]}
    joints = {j["child"]: j for j in model["joints"]}
    root = model["baseFrameId"]
    drive = model["drive"]
    wheel_ids = [drive[k] for k in ("leftJointId", "rightJointId")]
    continuous = [j for j in model["joints"] if j["kind"] != "fixed"]
    if len(links) != len(model["links"]) or len(joints) != len(model["joints"]) or len({j["id"] for j in model["joints"]}) != len(joints) or set(joints) != set(links) - {root} or any(j["parent"] not in links for j in joints.values()):
        raise CompileError("MODEL_LINK_INVALID")
    world_ids = [o["id"] for o in scene["world"]["obstacles"] + scene["world"]["boundaries"]]
    if len(set(world_ids)) != len(world_ids):
        raise CompileError("SCENE_ID_DUPLICATE")
    if set(j["id"] for j in continuous) != set(wheel_ids) or any(j["kind"] != "continuous" for j in continuous):
        raise CompileError("MODEL_UNSUPPORTED", "only differential wheel hinges admitted")
    casters = [l["id"] for l in links.values() if any(s["geometry"]["kind"] == "sphere" for s in l["collision"])]
    if len(casters) < 2 or any(joints[c]["kind"] != "fixed" for c in casters):
        raise CompileError("CASTER_SUPPORT_REQUIRED")
    transforms = {root: np.eye(4)}
    visiting = set()
    def transform(lid):
        if lid in visiting:
            raise CompileError("MODEL_LINK_CYCLE")
        if lid not in transforms:
            visiting.add(lid)
            j = joints[lid]
            transforms[lid] = transform(j["parent"]) @ pose(j["origin"]["xyzM"], j["origin"]["quaternionXyzw"])
            visiting.remove(lid)
        return transforms[lid]
    for lid in links:
        transform(lid)
    x, y, yaw = entry["initialPoseMap"]
    dpose = drive["driveFrameInBase"]
    if np.max(abs(pose(dpose["xyzM"], dpose["quaternionXyzw"])[2] - [0, 0, 1, 0])) > 1e-9:
        raise CompileError("MODEL_DRIVE_FRAME_UNSUPPORTED")
    base_map = pose([x, y, 0], [0, 0, math.sin(yaw/2), math.cos(yaw/2)]) @ np.linalg.inv(pose(dpose["xyzM"], dpose["quaternionXyzw"]))
    radius = drive["wheelRadiusM"]["value"]
    wheels = [next(j for j in continuous if j["id"] == jid) for jid in wheel_ids]
    nav = entry["model"]
    if nav["baseFrameId"] != root or nav["driveFrameInBase"] != dpose or nav["kinematics"]["wheelRadiusM"] != radius or nav["kinematics"]["wheelSeparationM"] != drive["wheelSeparationM"]["value"]:
        raise CompileError("MODEL_PROJECTION_MISMATCH")
    for j in wheels:
        if np.max(abs(transforms[j["child"]][:3,:3] @ j["axis"] - [0,1,0])) > 1e-9:
            raise CompileError("MODEL_WHEEL_AXIS_UNSUPPORTED")
        shapes = links[j["child"]]["collision"]
        if len(shapes) != 1 or shapes[0]["geometry"]["kind"] != "cylinder" or abs(shapes[0]["geometry"]["radiusM"] - radius) > 1e-9:
            raise CompileError("MODEL_WHEEL_GEOMETRY_UNSUPPORTED")
    if abs(np.linalg.norm(transforms[wheels[0]["child"]][:3,3] - transforms[wheels[1]["child"]][:3,3]) - drive["wheelSeparationM"]["value"]) > 1e-9:
        raise CompileError("MODEL_PROJECTION_MISMATCH")
    if physics["brakeTorqueNm"] > min(j["limits"]["effort"]["value"] for j in wheels) or max(p["torqueNm"] for p in physics["driveCurve"]) > min(j["limits"]["effort"]["value"] for j in wheels):
        raise CompileError("PHYSICS_PROFILE_INVALID", "torque exceeds canonical effort limit")
    if physics["driveCurve"][-1]["speedRadS"] > min(j["limits"]["velocity"]["value"] for j in wheels):
        raise CompileError("PHYSICS_PROFILE_INVALID", "drive curve exceeds canonical speed limit")
    if any(nav["kinematics"]["maxWheelRadps"][side] != j["limits"]["velocity"]["value"] for side,j in zip(("left", "right"), wheels)):
        raise CompileError("MODEL_PROJECTION_MISMATCH")
    if any(s["type"] != "lidar_2d" or s["noise"]["distribution"] != "none" for s in nav["sensors"]):
        raise CompileError("MODEL_UNSUPPORTED", "only noiseless engine LiDAR is admitted")
    heights = [radius - transforms[j["child"]][2, 3] for j in wheels]
    if abs(heights[0] - heights[1]) > 1e-9:
        raise CompileError("MODEL_WHEEL_HEIGHT_INVALID")
    base_map[2, 3] = heights[0]
    for c in casters:
        s = links[c]["collision"][0]
        at = transform(c) @ pose(s["pose"]["xyzM"], s["pose"]["quaternionXyzw"])
        if abs(heights[0] + at[2, 3] - s["geometry"]["radiusM"]) > 1e-6:
            raise CompileError("CASTER_SUPPORT_INVALID")
    doc = ET.Element("mujoco", model="mobile-v1")
    _el(doc, "compiler", angle="radian", inertiafromgeom="false", fusestatic="false")
    _el(doc, "option", timestep="0.002", gravity="0 0 -9.81", integrator=physics["integrator"], solver="Newton", iterations=str(physics["solver"]["iterations"]), tolerance=_vec([physics["solver"]["tolerance"]]))
    default = _el(doc, "default")
    _el(default, "geom", condim="6", solref="0.02 1", solimp="0.9 0.95 0.001", friction=_vec([physics["contact"][k] for k in ("sliding", "torsionalM", "rollingM")]))
    world, assets, contact = _el(doc, "worldbody"), _el(doc, "asset"), _el(doc, "contact")
    _el(world, "geom", name="FLOOR", type="plane", size="0 0 0.1", contype="2", conaffinity="5", friction=_vec([scene["world3d"]["floorFriction"], physics["contact"]["torsionalM"], physics["contact"]["rollingM"]]))
    names = {"links": {lid: f"BODY_{i}" for i, lid in enumerate(sorted(links))}, "joints": {}, "geoms": {}, "props": {}, "supports": {}, "statics": {}, "base": None, "wheelJoints": [], "actuators": [], "tags": {}, "expected": set()}
    names["base"] = names["links"][root]
    names["tags"]["FLOOR"] = "floor"
    bodies = {}
    def add_link(lid, parent):
        local = matrix_pose(base_map) if lid == root else {"positionM": joints[lid]["origin"]["xyzM"], "quaternionXyzw": joints[lid]["origin"]["quaternionXyzw"]}
        body = bodies[lid] = _el(parent, "body", name=names["links"][lid], pos=_vec(local["positionM"]), quat=_wxyz(local["quaternionXyzw"]))
        if lid == root:
            _el(body, "freejoint", name="BASE_FREE")
        elif joints[lid]["kind"] == "continuous":
            jname = f"WHEEL_{wheel_ids.index(joints[lid]['id'])}"
            names["joints"][joints[lid]["id"]] = jname
            _el(body, "joint", name=jname, type="hinge", axis=_vec(joints[lid]["axis"]), damping="0", armature="0", limited="false")
        l = links[lid]
        _inertial(body, l["massKg"]["value"], l["comM"], l["inertiaKgM2"])
        for i, s in enumerate(l["collision"]):
            pose(s["pose"]["xyzM"], s["pose"]["quaternionXyzw"])  # refuse normalization by the XML loader
            name = f"GEOM_{len(names['geoms'])}"
            names["geoms"][(lid, i)] = name
            names["tags"][name] = f"{rid}/{lid}/c{i}"
            _geom(body, name, s["geometry"], pos=_vec(s["pose"]["xyzM"]), quat=_wxyz(s["pose"]["quaternionXyzw"]), contype="1", conaffinity="6", group="1")
            if lid in casters:
                f = scene["world3d"]["casterFriction"]
                _el(contact, "pair", geom1="FLOOR", geom2=name, condim="6", friction=_vec([f, f, 0, 0, 0]), solref="0.02 1", solimp="0.9 0.95 0.001")
            if lid in casters or lid in [j["child"] for j in wheels]:
                names["expected"].add(tuple(sorted(("floor", names["tags"][name]))))
        for child in sorted(joints):
            if joints[child]["parent"] == lid:
                add_link(child, body)
    add_link(root, world)
    actuator = _el(doc, "actuator")
    for i, jid in enumerate(wheel_ids):
        jname, aname = names["joints"][jid], f"DRIVE_{i}"
        names["wheelJoints"].append(jname)
        names["actuators"].append(aname)
        limit = next(j for j in wheels if j["id"] == jid)["limits"]["velocity"]["value"]
        _el(actuator, "velocity", name=aname, joint=jname, kv=_vec([physics["velocityGainNmsPerRad"]]), ctrllimited="true", ctrlrange=_vec([-limit, limit]), forcelimited="true", forcerange=_vec([-physics["brakeTorqueNm"], physics["brakeTorqueNm"]]))
    for s in load_profile["supports"]:
        if s["parentBodyId"] not in links or s["supportId"] in names["supports"]:
            raise CompileError("LOAD_SUPPORT_UNKNOWN")
        names["supports"][s["supportId"]] = s
    for i, p in enumerate(load_profile["props"]):
        att, name = p["attachment"], f"PROP_{i}"
        if p["propId"] in names["props"] or p["propId"] == rid:
            raise CompileError("LOAD_DUPLICATE_PROP")
        if att["kind"] == "free":
            if att["supportId"] not in names["supports"]:
                raise CompileError("LOAD_SUPPORT_UNKNOWN")
            sup = names["supports"][att["supportId"]]
            sp, pp = sup["poseInBody"], att["initialPoseInSupport"]
            t = base_map @ transform(sup["parentBodyId"]) @ pose(sp["positionM"], sp["quaternionXyzw"]) @ pose(pp["positionM"], pp["quaternionXyzw"])
            parent = world
        else:
            if att["parentLinkId"] not in bodies:
                raise CompileError("MODEL_LINK_INVALID")
            pp = att["poseInLink"]
            t = pose(pp["positionM"], pp["quaternionXyzw"])
            parent = bodies[att["parentLinkId"]]
        at = matrix_pose(t)
        body = _el(parent, "body", name=name, pos=_vec(at["positionM"]), quat=_wxyz(at["quaternionXyzw"]))
        if att["kind"] == "free":
            _el(body, "freejoint", name=f"{name}_FREE")
        _inertial(body, p["massKg"], p["comM"], p["inertiaKgM2"])
        _geom(body, name + "_GEOM", p["geometry"], contype="4", conaffinity="7", friction=_vec([p["friction"][k] for k in ("sliding", "torsionalM", "rollingM")]))
        names["props"][p["propId"]] = name
        names["tags"][name + "_GEOM"] = f"prop/{p['propId']}"
        if att["kind"] == "free":
            for key, gname in names["geoms"].items():
                if key[0] == sup["parentBodyId"]:
                    names["expected"].add(tuple(sorted((names["tags"][gname], f"prop/{p['propId']}"))))
    for wall, obs in [(False, x) for x in scene["world"]["obstacles"]] + [(True, x) for x in scene["world"]["boundaries"]]:
        name = f"STATIC_{len(names['statics'])}"
        poly = obs["verticesM"]
        h = scene["world3d"]["wallHeightM" if wall else "obstacleHeightM"]
        # Convex prism collision proxy, not a bounding box that fills concavities.
        if not _convex_ccw(poly):
            raise CompileError("MODEL_UNSUPPORTED", "non-convex obstacle")
        _el(assets, "mesh", name=name + "_MESH", vertex=_vec([v for z in (0, h) for x, y in poly for v in (x, y, z)]))
        _el(world, "geom", name=name, type="mesh", mesh=name + "_MESH", contype="2", conaffinity="5")
        names["statics"][obs["id"]] = name
        names["tags"][name] = f"static/{obs['id']}"
    if scene["actors"]:
        raise CompileError("MODEL_UNSUPPORTED", "mobile actors require an explicit physical proxy")
    return ET.tostring(doc, encoding="unicode") + "\n", names
