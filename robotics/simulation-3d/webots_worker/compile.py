"""Deterministic Webots world text (.wbt) from a NavigationSceneV1 (engine webots_3d) and the RobotPhysicalModelV1 of each scene robot.

Pure: no Webots, no file access, no clock. The same inputs give the same bytes. Everything that reaches the text is a number formatted by repr() or an identifier
that matched SAFE_ID, so a scene or a model cannot add nodes to the world. Nothing here goes through URDF: links, joints, inertia and sensors map one to one.

Frames: the physical model's base link is the Robot node; every other link is a Solid nested in its parent (fixed joint) or the endPoint of a HingeJoint
(continuous joint). The scene gives the drive-frame pose of each robot in the map; the base link is placed so the wheels stand on the floor plane z = 0.
"""
import math
import re

TICK_MS = 20
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$")
IDENT = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
SUPPORT_TOL_M = 1e-3  # a support point may sit this far above the wheels' lowest point
SUPPORT_SPAN_M = 0.05  # and must be at least this far ahead of / behind the axle line


class CompileError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _num(x):
    f = float(x)
    if not math.isfinite(f):
        raise CompileError("MODEL_NOT_FINITE", repr(x))
    return repr(f + 0.0)  # + 0.0 turns -0.0 into 0.0


def _vec(v):
    return " ".join(_num(x) for x in v)


def _ident(value, what):
    if not isinstance(value, str) or not SAFE_ID.match(value):
        raise CompileError("ID_INVALID", f"{what}: {value!r}")
    return value


# ---- small rigid-body algebra (quaternions are x y z w) ----
def _rot(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if not n or not math.isfinite(n):
        raise CompileError("MODEL_NOT_FINITE", "quaternion")
    x, y, z, w = x / n, y / n, z / n, w / n
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


def _mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def _apply(r, v):
    return tuple(sum(r[i][k] * v[k] for k in range(3)) for i in range(3))


def _compose(parent, pose):
    """parent = (R, p) in the base frame, pose = ((x,y,z),(qx,qy,qz,qw)) in the parent frame -> (R, p) of the child."""
    r, p = parent
    t, q = pose
    pt = _apply(r, t)
    return _mul(r, _rot(q)), (p[0] + pt[0], p[1] + pt[1], p[2] + pt[2])


def _axis_angle(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    x, y, z, w = x / n, y / n, z / n, w / n
    w = max(-1.0, min(1.0, w))
    s = math.sqrt(max(0.0, 1.0 - w * w))
    if s < 1e-12:
        return (0.0, 0.0, 1.0, 0.0)
    return (x / s, y / s, z / s, 2.0 * math.acos(w))


def _pose_of(shape_or_joint):
    p = shape_or_joint
    return tuple(p["xyzM"]), tuple(p["quaternionXyzw"])


def _is_identity(pose):
    t, q = pose
    return all(v == 0 for v in t) and q[0] == 0 and q[1] == 0 and q[2] == 0 and q[3] == 1


def _pose_fields(pose, indent):
    t, q = pose
    return f"{indent}translation {_vec(t)}\n{indent}rotation {_vec(_axis_angle(q))}\n"


# ---- validation ----
def _check_scene(scene):
    eng = scene.get("engine") or {}
    if eng.get("id") != "webots_3d":
        raise CompileError("ENGINE_MISMATCH", str(eng.get("id")))
    step = eng.get("basicTimeStepMs")
    if not isinstance(step, int) or isinstance(step, bool) or step <= 0 or TICK_MS % step:
        raise CompileError("TIMESTEP_NOT_DIVISOR", f"basicTimeStepMs {step!r} does not divide {TICK_MS} ms")
    w3 = scene.get("world3d")
    if not isinstance(w3, dict):
        raise CompileError("WORLD3D_MISSING", "a webots scene needs world3d")
    for k in ("obstacleHeightM", "wallHeightM", "floorFriction", "casterFriction"):
        v = w3.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or (k.endswith("HeightM") and v == 0):
            raise CompileError("WORLD3D_MISSING", f"world3d.{k} is {v!r}")
    for f in scene.get("files") or []:
        path = f.get("path") if isinstance(f, dict) else None
        if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path or ".." in path.split("/"):
            raise CompileError("ASSET_PATH_ESCAPE", repr(path))
    for o in scene["world"]["obstacles"] + scene["world"]["boundaries"]:
        _ident(o.get("id"), "world obstacle id")
    return step, w3


def _check_model(model):
    links = {}
    for l in model["links"]:
        _ident(l["id"].replace("/", "_"), "link id")
        mass = l["massKg"]["value"]
        if isinstance(mass, bool) or not isinstance(mass, (int, float)) or not math.isfinite(mass) or mass <= 0:
            raise CompileError("MODEL_MASS_INVALID", f"{l['id']}: {mass!r}")
        inertia = l.get("inertiaKgM2")
        if not isinstance(inertia, list) or len(inertia) != 6 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in inertia):
            raise CompileError("MODEL_INERTIA_MISSING", l["id"])
        if not l["collision"]:
            raise CompileError("MODEL_COLLISION_MISSING", l["id"])
        for c in l["collision"]:
            if c["geometry"]["kind"] not in ("box", "cylinder", "sphere"):
                raise CompileError("GEOMETRY_UNSUPPORTED", f"{l['id']}: {c['geometry']['kind']}")
        links[l["id"]] = l
    kids = {}
    for j in model["joints"]:
        if j["kind"] not in ("fixed", "continuous"):
            raise CompileError("JOINT_UNSUPPORTED", f"{j['id']}: {j['kind']}")
        if j["parent"] not in links or j["child"] not in links:
            raise CompileError("JOINT_UNSUPPORTED", f"{j['id']}: unknown link")
        kids.setdefault(j["parent"], []).append(j)
    root = model["baseFrameId"]
    if root not in links:
        raise CompileError("JOINT_UNSUPPORTED", "no base link")
    seen, stack = {root}, [root]
    while stack:
        for j in kids.get(stack.pop(), []):
            if j["child"] in seen:
                raise CompileError("JOINT_UNSUPPORTED", f"{j['id']}: link reached twice")
            seen.add(j["child"])
            stack.append(j["child"])
    if seen != set(links):
        raise CompileError("JOINT_UNSUPPORTED", "links not connected to the base: " + ", ".join(sorted(set(links) - seen)))
    return links, kids, root


def _link_poses(links, kids, root):
    poses = {root: ((((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))), (0.0, 0.0, 0.0))}
    stack = [root]
    while stack:
        cur = stack.pop()
        for j in kids.get(cur, []):
            poses[j["child"]] = _compose(poses[cur], _pose_of(j["origin"]))
            stack.append(j["child"])
    return poses


def _lowest(shape, link_pose):
    """(lowest z, x) of one collision shape in the base frame."""
    r, p = _compose(link_pose, _pose_of(shape["pose"]))
    g = shape["geometry"]
    if g["kind"] == "sphere":
        reach = g["radiusM"]
    elif g["kind"] == "box":
        reach = sum(abs(r[2][i]) * g["sizeM"][i] / 2 for i in range(3))
    else:  # cylinder along its local z
        c = abs(r[2][2])
        reach = c * g["lengthM"] / 2 + g["radiusM"] * math.sqrt(max(0.0, 1 - c * c))
    return p[2] - reach, p[0]


def _check_support(model, links, kids, root, poses):
    drive = model["drive"]
    wheels = {j["child"] for j in model["joints"] if j["kind"] == "continuous"}
    axle = [poses[w] for w in wheels]
    if not axle:
        raise CompileError("JOINT_UNSUPPORTED", "no continuous wheel joint")
    axle_z = sum(a[1][2] for a in axle) / len(axle)
    axle_x = sum(a[1][0] for a in axle) / len(axle)
    floor = axle_z - drive["wheelRadiusM"]["value"]
    ahead = behind = False
    for lid, l in links.items():
        if lid in wheels:
            continue
        for c in l["collision"]:
            low, x = _lowest(c, poses[lid])
            if low <= floor + SUPPORT_TOL_M:
                ahead |= x >= axle_x + SUPPORT_SPAN_M
                behind |= x <= axle_x - SUPPORT_SPAN_M
    if not (ahead and behind):
        raise CompileError("NO_THIRD_CONTACT", "a two-wheel base needs a support point on the floor ahead of and behind the axle line (a caster); it would tip in 3D")
    return axle_z


# ---- emission ----
def _shape(c, ind):
    g = c["geometry"]
    if g["kind"] == "box":
        body = f"Box {{ size {_vec(g['sizeM'])} }}"
    elif g["kind"] == "sphere":
        body = f"Sphere {{ radius {_num(g['radiusM'])} }}"
    else:
        body = f"Cylinder {{ height {_num(g['lengthM'])} radius {_num(g['radiusM'])} }}"
    pose = _pose_of(c["pose"])
    if _is_identity(pose):
        return f"{ind}{body}\n"
    return f"{ind}Pose {{\n{_pose_fields(pose, ind + '  ')}{ind}  children [ {body} ]\n{ind}}}\n"


def _bounding(link, ind):
    shapes = link["collision"]
    if len(shapes) == 1:
        return f"{ind}boundingObject {_shape(shapes[0], '').rstrip()}\n" if _is_identity(_pose_of(shapes[0]["pose"])) else f"{ind}boundingObject " + _shape(shapes[0], ind).lstrip()
    inner = "".join(_shape(c, ind + "    ") for c in shapes)
    return f"{ind}boundingObject Group {{\n{ind}  children [\n{inner}{ind}  ]\n{ind}}}\n"


def _physics(link, ind):
    i = link["inertiaKgM2"]  # xx xy xz yy yz zz -> Webots [xx yy zz xy xz yz]
    return (f"{ind}physics Physics {{\n{ind}  density -1\n{ind}  mass {_num(link['massKg']['value'])}\n{ind}  centerOfMass [ {_vec(link['comM'])} ]\n"
            f"{ind}  inertiaMatrix [ {_vec([i[0], i[3], i[5], i[1], i[2], i[4]])} ]\n{ind}}}\n")


def _contact(link, wheel):
    if wheel:
        return "wheel"
    return "caster" if any(c["geometry"]["kind"] == "sphere" for c in link["collision"]) else "default"


class _Robot:
    def __init__(self, model, links, kids):
        self.model, self.links, self.kids = model, links, kids
        d = model["drive"]
        self.sides = {d["leftJointId"]: "left", d["rightJointId"]: "right"}
        self.spare = 0

    def _children(self, lid, ind):
        out = ""
        for j in sorted(self.kids.get(lid, []), key=lambda j: j["id"]):
            out += self._joint(j, ind)
        return out

    def _solid(self, lid, pose, ind, wheel=False):
        l = self.links[lid]
        name = lid.replace("/", "_")
        kids = self._children(lid, ind + "    ")
        return (f"{ind}Solid {{\n{_pose_fields(pose, ind + '  ')}{ind}  name \"{name}\"\n{ind}  contactMaterial \"{_contact(l, wheel)}\"\n"
                f"{ind}  children [\n{kids}{ind}  ]\n{_bounding(l, ind + '  ')}{_physics(l, ind + '  ')}{ind}}}\n")

    def _joint(self, j, ind):
        pose = _pose_of(j["origin"])
        if j["kind"] == "fixed":
            return self._solid(j["child"], pose, ind)
        side = self.sides.get(j["id"])
        if side is None:
            self.spare += 1
            side = f"joint{self.spare}"
        lim = j.get("limits") or {}
        vel = (lim.get("velocity") or {}).get("value", self.model["drive"]["actuatorMaxSpeedRadps"]["value"])
        eff = (lim.get("effort") or {}).get("value")
        if eff is None:
            raise CompileError("MODEL_NOT_FINITE", f"{j['id']}: continuous joint without an effort limit")
        axis = _apply(_rot(pose[1]), j["axis"])  # the joint axis is given in the child frame; Webots wants it in the parent frame
        return (f"{ind}HingeJoint {{\n{ind}  jointParameters HingeJointParameters {{\n{ind}    axis {_vec(axis)}\n{ind}    anchor {_vec(pose[0])}\n{ind}  }}\n"
                f"{ind}  device [\n{ind}    RotationalMotor {{\n{ind}      name \"{side}_wheel_motor\"\n{ind}      maxVelocity {_num(vel)}\n{ind}      maxTorque {_num(eff)}\n{ind}    }}\n"
                f"{ind}    PositionSensor {{\n{ind}      name \"{side}_wheel_sensor\"\n{ind}    }}\n{ind}  ]\n{ind}  endPoint {self._solid(j['child'], pose, ind + '  ', wheel=True).lstrip()}"
                f"{ind}}}\n")


def _lidar(sensor_model, mount, ind):
    s = next(x for x in sensor_model["sensors"] if x["id"] == mount["sensorId"])
    if s["noise"]["distribution"] != "none":
        raise CompileError("SENSOR_NOISE_UNSUPPORTED", f"{s['id']}: the Webots Lidar here has no noise model")
    pose = _pose_of(mount["poseInBase"])
    return (f"{ind}Lidar {{\n{_pose_fields(pose, ind + '  ')}{ind}  name \"{_ident(s['id'], 'sensor id')}\"\n{ind}  horizontalResolution {int(s['beamCount'])}\n"
            f"{ind}  fieldOfView {_num(s['fieldOfViewRad'])}\n{ind}  numberOfLayers 1\n{ind}  minRange {_num(s['rangeMinM'])}\n{ind}  maxRange {_num(s['rangeMaxM'])}\n{ind}}}\n")


def _robot_node(entry, model):
    rid = _ident(entry["robotId"], "robot id")
    links, kids, root = _check_model(model)
    poses = _link_poses(links, kids, root)
    axle_z = _check_support(model, links, kids, root, poses)
    d_in_base = _pose_of(entry["model"]["driveFrameInBase"])
    yaw_b = entry["initialPoseMap"][2] - 2.0 * math.atan2(d_in_base[1][2], d_in_base[1][3])
    c, s = math.cos(yaw_b), math.sin(yaw_b)
    dx, dy = d_in_base[0][0], d_in_base[0][1]
    x = entry["initialPoseMap"][0] - (c * dx - s * dy)
    y = entry["initialPoseMap"][1] - (s * dx + c * dy)
    z = model["drive"]["wheelRadiusM"]["value"] - axle_z
    body = _Robot(model, links, kids)
    rl = links[root]
    kids_text = body._children(root, "    ") + "".join(_lidar(entry["model"], m, "    ") for m in model["sensors"])
    return (f"Robot {{\n  translation {_vec((x, y, z))}\n  rotation {_vec((0.0, 0.0, 1.0, yaw_b))}\n  name \"{rid}\"\n  controller \"<extern>\"\n  synchronization TRUE\n"
            f"  contactMaterial \"{_contact(rl, False)}\"\n  children [\n{kids_text}  ]\n{_bounding(rl, '  ')}{_physics(rl, '  ')}}}\n")


def _prism(poly, height):
    pts = [tuple(p) for p in poly]
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts.reverse()  # counter-clockwise, so every face looks outwards
    n = len(pts)
    coords = [(x, y, 0.0) for x, y in pts] + [(x, y, height) for x, y in pts]
    faces = [list(range(n, 2 * n)), list(range(n - 1, -1, -1))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    point = ",\n".join("        " + _vec(c) for c in coords)
    index = " ".join(" ".join(str(i) for i in f) + " -1" for f in faces)
    return point, index


def _static(obstacle, height, ind="  "):
    oid = obstacle["id"]
    point, index = _prism(obstacle["verticesM"], height)
    geom = f"IndexedFaceSet {{\n      coord Coordinate {{\n        point [\n{point}\n        ]\n      }}\n      coordIndex [ {index} ]\n    }}"
    return (f"DEF {oid} Solid {{\n  name \"{oid}\"\n  children [\n    Shape {{\n      appearance PBRAppearance {{ baseColor 0.6 0.5 0.4 roughness 1 metalness 0 }}\n      geometry {geom}\n    }}\n  ]\n"
            f"  boundingObject {geom}\n}}\n")


def compile_world(scene, models, seed):
    """The .wbt text of `scene`. `models` maps each scene robotId to its RobotPhysicalModelV1; `seed` becomes WorldInfo.randomSeed."""
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 0xFFFFFFFF:
        raise CompileError("SEED_INVALID", repr(seed))
    step, w3 = _check_scene(scene)
    world = scene["world"]
    robots = []
    for entry in sorted(scene["robots"], key=lambda r: r["robotId"]):
        model = models.get(entry["robotId"]) if isinstance(models, dict) else None
        if model is None:
            raise CompileError("MODEL_MISSING", entry["robotId"])
        robots.append(_robot_node(entry, model))
    w, h = world["widthM"], world["heightM"]
    head = ("#VRML_SIM R2025a utf8\n"
            f"WorldInfo {{\n  basicTimeStep {step}\n  optimalThreadCount 1\n  randomSeed {seed}\n  coordinateSystem \"ENU\"\n  contactProperties [\n"
            f"    ContactProperties {{\n      material1 \"wheel\"\n      material2 \"default\"\n      coulombFriction [ {_num(w3['floorFriction'])} ]\n    }}\n"
            f"    ContactProperties {{\n      material1 \"caster\"\n      material2 \"default\"\n      coulombFriction [ {_num(w3['casterFriction'])} ]\n    }}\n  ]\n}}\n"
            f"Viewpoint {{\n  orientation 0 1 0 1.5708\n  position {_vec((w / 2, h / 2, max(w, h)))}\n}}\n"
            f"Solid {{\n  name \"floor\"\n  translation {_vec((w / 2, h / 2, 0.0))}\n  children [\n    Shape {{\n      appearance PBRAppearance {{ baseColor 0.8 0.8 0.8 roughness 1 metalness 0 }}\n      geometry Plane {{ size {_vec((w, h))} }}\n    }}\n  ]\n"
            f"  boundingObject Plane {{ size {_vec((w, h))} }}\n}}\n")
    statics = "".join(_static(o, w3["obstacleHeightM"]) for o in sorted(world["obstacles"], key=lambda o: o["id"]))
    statics += "".join(_static(o, w3["wallHeightM"]) for o in sorted(world["boundaries"], key=lambda o: o["id"]))
    supervisor = "Robot {\n  name \"mekoniq_supervisor\"\n  supervisor TRUE\n  controller \"<extern>\"\n  synchronization TRUE\n}\n"
    return head + statics + supervisor + "".join(robots)
