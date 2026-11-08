"""Normalised robot descriptions and their comparison. The same dict shape is produced from the physical model, from URDF XML (ElementTree, independent of
LinkForge) and from LinkForge's parsed Robot, so parity is a plain diff and does not depend on counts alone."""
import math
import os
import xml.etree.ElementTree as ET

# scope -> (code for a missing element, code for a changed or unexpected one)
CODES = {"LF": ("LF_IMPORT_LOSS", "LF_IMPORT_MUTATION"), "URDF_MODEL": ("URDF_MODEL_MISSING", "URDF_MODEL_MISMATCH"), "EXPORT": ("LF_EXPORT_LOSS", "LF_EXPORT_MISMATCH")}
# kind -> (absolute, relative); import parity is strict, the reference re-export has its own declared precision (spec §1 step 7)
_STRICT = {k: (1e-12, 1e-9) for k in ("pose", "mass", "inertia", "other")}
TOL = {"LF": _STRICT, "URDF_MODEL": _STRICT, "EXPORT": {"pose": (1e-6, 0.0), "mass": (1e-6, 0.0), "inertia": (1e-9, 1e-5), "other": (1e-6, 0.0)}}


def rot_from_rpy(r, p, y):
    cr, sr, cp, sp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, -sp, cp * sr, cp * cr]


def rot_from_quat(q):
    x, y, z, w = q
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]


def _vec(text, default):
    return [float(v) for v in text.split()] if text else list(default)


def _shape_model(s, mapper=None):
    g = s["geometry"]
    kind = g["kind"]
    size = {"box": g.get("sizeM"), "cylinder": [g.get("radiusM"), g.get("lengthM")], "sphere": [g.get("radiusM")], "mesh": list(g.get("scale", [1.0, 1.0, 1.0]))}[kind]
    out = {"kind": kind, "size": [float(v) for v in size], "xyz": [float(v) for v in s["pose"]["xyzM"]], "rot": rot_from_quat(s["pose"]["quaternionXyzw"])}
    if kind == "mesh":
        out["file"] = os.path.basename(g.get("filename") or g["blobSha256"])
    return out


def _limits(j):
    if j["kind"] == "fixed" or not j.get("limits"):
        return {}
    return {k: float(v["value"]) for k, v in j["limits"].items()}


def from_model(m, ids=None):
    """Description of a physical model. `ids` ({'link': {src: mapped}, 'joint': {...}}) renames keys and references into the mapped namespace."""
    ln = (ids or {}).get("link", {})
    jn = (ids or {}).get("joint", {})
    links, joints = {}, {}
    for l in m["links"]:
        inertia = l.get("inertiaKgM2")
        links[ln.get(l["id"], l["id"])] = {"mass": float(l["massKg"]["value"]), "com": [float(v) for v in l["comM"]], "inertia": None if inertia is None else [float(v) for v in inertia], "irot": rot_from_rpy(0, 0, 0),  # the model carries no inertial-frame rotation: its tensor is in the link frame
                                           "visual": [_shape_model(s) for s in l["visual"]], "collision": [_shape_model(s) for s in l["collision"]]}
    for j in m["joints"]:
        fixed = j["kind"] == "fixed"
        joints[jn.get(j["id"], j["id"])] = {"type": j["kind"], "parent": ln.get(j["parent"], j["parent"]), "child": ln.get(j["child"], j["child"]), "xyz": [float(v) for v in j["origin"]["xyzM"]],
                                            "rot": rot_from_quat(j["origin"]["quaternionXyzw"]), "axis": None if fixed else [float(v) for v in j["axis"]], "limits": _limits(j),
                                            "mimic": None}  # the model has no mimic joints
    return {"links": links, "joints": joints}


def _origin_xml(el):
    o = el.find("origin") if el is not None else None
    xyz = _vec(o.get("xyz") if o is not None else None, (0, 0, 0))
    rpy = _vec(o.get("rpy") if o is not None else None, (0, 0, 0))
    return xyz, rot_from_rpy(*rpy)


def _shape_xml(el):
    xyz, rot = _origin_xml(el)
    geo = el.find("geometry")[0]
    t = geo.tag
    if t == "box":
        size = _vec(geo.get("size"), ())
    elif t == "cylinder":
        size = [float(geo.get("radius")), float(geo.get("length"))]
    elif t == "sphere":
        size = [float(geo.get("radius"))]
    else:
        size = _vec(geo.get("scale"), (1, 1, 1))
    out = {"kind": t, "size": size, "xyz": xyz, "rot": rot}
    if t == "mesh":
        out["file"] = os.path.basename(geo.get("filename", ""))
    return out


def from_urdf_xml(text):
    root = ET.fromstring(text)
    links, joints = {}, {}
    for l in root.findall("link"):
        inertial = l.find("inertial")
        mass = inertia = None
        com = [0.0, 0.0, 0.0]
        irot = rot_from_rpy(0, 0, 0)
        if inertial is not None:
            com, irot = _origin_xml(inertial)
            mass = float(inertial.find("mass").get("value"))
            i = inertial.find("inertia")
            inertia = [float(i.get(k, 0)) for k in ("ixx", "ixy", "ixz", "iyy", "iyz", "izz")] if i is not None else None
        links[l.get("name")] = {"mass": mass, "com": com, "inertia": inertia, "irot": irot, "visual": [_shape_xml(v) for v in l.findall("visual")], "collision": [_shape_xml(c) for c in l.findall("collision")]}
    for j in root.findall("joint"):
        xyz, rot = _origin_xml(j)
        kind = j.get("type")
        lim = j.find("limit")
        limits = {} if lim is None or kind == "fixed" else {k: float(lim.get(k)) for k in ("lower", "upper", "effort", "velocity") if lim.get(k) is not None}
        axis = j.find("axis")
        mim = j.find("mimic")
        mimic = None if mim is None else {"joint": mim.get("joint"), "multiplier": float(mim.get("multiplier", 1)), "offset": float(mim.get("offset", 0))}
        joints[j.get("name")] = {"type": kind, "parent": j.find("parent").get("link"), "child": j.find("child").get("link"), "xyz": xyz, "rot": rot,
                                 "axis": None if kind == "fixed" else _vec(axis.get("xyz") if axis is not None else None, (1, 0, 0)), "limits": limits, "mimic": mimic}
    return {"links": links, "joints": joints}


def _geometry_lf(geo):
    name = type(geo).__name__.lower()
    if name == "box":
        return "box", [geo.size.x, geo.size.y, geo.size.z], None
    if name == "cylinder":
        return "cylinder", [geo.radius, geo.length], None
    if name == "sphere":
        return "sphere", [geo.radius], None
    res = getattr(geo, "resource", None)
    ref = getattr(res, "path", None) or getattr(res, "filename", None) or str(res)
    return "mesh", [geo.scale.x, geo.scale.y, geo.scale.z] if hasattr(geo.scale, "x") else list(geo.scale), os.path.basename(str(ref))


def _shape_lf(s):
    kind, size, file = _geometry_lf(s.geometry)
    o = s.origin
    out = {"kind": kind, "size": [float(v) for v in size], "xyz": [o.xyz.x, o.xyz.y, o.xyz.z], "rot": rot_from_rpy(o.rpy.x, o.rpy.y, o.rpy.z)}
    if file is not None:
        out["file"] = file
    return out


def from_lf(robot):
    """Description of a robot as LinkForge parsed it (read straight from the model objects, not from a re-export)."""
    links, joints = {}, {}
    for l in robot.links:
        mass = inertia = None
        com = [0.0, 0.0, 0.0]
        irot = rot_from_rpy(0, 0, 0)
        if l.inertial is not None:
            i = l.inertial.inertia
            mass, com = l.inertial.mass, [l.inertial.origin.xyz.x, l.inertial.origin.xyz.y, l.inertial.origin.xyz.z]
            irot = rot_from_rpy(l.inertial.origin.rpy.x, l.inertial.origin.rpy.y, l.inertial.origin.rpy.z)
            inertia = [i.ixx, i.ixy, i.ixz, i.iyy, i.iyz, i.izz]
        links[l.name] = {"mass": mass, "com": com, "inertia": inertia, "irot": irot, "visual": [_shape_lf(v) for v in l.visuals], "collision": [_shape_lf(c) for c in l.collisions]}
    for j in robot.joints:
        kind = getattr(j.type, "value", j.type)
        lim = j.limits
        limits = {} if lim is None or kind == "fixed" else {k: float(getattr(lim, k)) for k in ("lower", "upper", "effort", "velocity") if getattr(lim, k, None) is not None}
        a = j.axis
        mim = getattr(j, "mimic", None)
        mimic = None if mim is None else {"joint": mim.joint, "multiplier": float(mim.multiplier), "offset": float(mim.offset)}
        joints[j.name] = {"type": kind, "parent": j.parent, "child": j.child, "xyz": [j.origin.xyz.x, j.origin.xyz.y, j.origin.xyz.z], "rot": rot_from_rpy(j.origin.rpy.x, j.origin.rpy.y, j.origin.rpy.z),
                          "axis": None if kind == "fixed" or a is None else [a.x, a.y, a.z], "limits": limits, "mimic": mimic}
    return {"links": links, "joints": joints}


def _close(a, b, tol):
    d = abs(a - b)
    return d <= tol[0] or d <= tol[1] * max(abs(a), abs(b))


def _same_numbers(a, b, tol):
    return len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b))


def compare(a, b, scope):
    """Findings where description `b` loses or changes anything in `a`. IDs, parent-child pairs and element sets must match exactly; numbers within the scope's tolerance."""
    loss, mut = CODES[scope]
    tol = TOL[scope]
    out = []

    def add(code, path, entity, detail, **ids):
        out.append({"code": code, "severity": "error", "path": path, "entityId": entity, "source": "parity", "detail": detail, **ids})

    def nums(path, entity, name, x, y, kind, **ids):
        x, y = ([v] if isinstance(v, (int, float)) else v for v in (x, y))
        if x is None or y is None:
            if x is not y:
                add(mut, path, entity, f"{name}: {x} became {y}", **ids)
        elif not _same_numbers(x, y, tol[kind]):
            add(mut, path, entity, f"{name}: {x} became {y}", numeric=True, **ids)  # `numeric` is internal: lets the caller tell precision loss from structural change

    def shapes(path, entity, key, xs, ys, **ids):
        if len(ys) < len(xs):
            add(loss, f"{path}/{key}", entity, f"{key}: {len(xs)} shape(s) became {len(ys)}", **ids)
        elif len(ys) > len(xs):
            add(mut, f"{path}/{key}", entity, f"{key}: {len(xs)} shape(s) became {len(ys)}", **ids)
        for n, (x, y) in enumerate(zip(xs, ys)):
            p = f"{path}/{key}/{n}"
            if x["kind"] != y["kind"] or x.get("file") != y.get("file"):
                add(mut, p, entity, f"{key}[{n}]: {x['kind']} became {y['kind']}", **ids)
                continue
            for field, k in (("size", "other"), ("xyz", "pose"), ("rot", "pose")):
                nums(f"{p}/{field}", entity, f"{key}[{n}].{field}", x[field], y[field], k, **ids)

    for kind, key in (("links", "linkId"), ("joints", "jointId")):
        for name in sorted(set(a[kind]) | set(b[kind])):
            path = f"/{kind}/{name}"
            if name not in b[kind]:
                add(loss, path, name, f"{kind[:-1]} is missing after import", **{key: name})
                continue
            if name not in a[kind]:
                add(mut, path, name, f"{kind[:-1]} was not in the input", **{key: name})
                continue
            x, y, ids = a[kind][name], b[kind][name], {key: name}
            if kind == "links":
                nums(f"{path}/mass", name, "mass", x["mass"], y["mass"], "mass", **ids)
                nums(f"{path}/com", name, "com", x["com"], y["com"], "pose", **ids)
                nums(f"{path}/inertia", name, "inertia", x["inertia"], y["inertia"], "inertia", **ids)
                nums(f"{path}/inertialRotation", name, "inertial frame rotation", x["irot"], y["irot"], "pose", **ids)
                shapes(path, name, "visual", x["visual"], y["visual"], **ids)
                shapes(path, name, "collision", x["collision"], y["collision"], **ids)
            else:
                for f in ("type", "parent", "child"):
                    if x[f] != y[f]:
                        add(mut, f"{path}/{f}", name, f"{f}: {x[f]} became {y[f]}", **ids)
                nums(f"{path}/xyz", name, "origin", x["xyz"], y["xyz"], "pose", **ids)
                nums(f"{path}/rot", name, "origin rotation", x["rot"], y["rot"], "pose", **ids)
                nums(f"{path}/axis", name, "axis", x["axis"], y["axis"], "other", **ids)
                if (x["mimic"] is None) != (y["mimic"] is None) or (x["mimic"] and x["mimic"]["joint"] != y["mimic"]["joint"]):
                    add(mut, f"{path}/mimic", name, f"mimic: {x['mimic']} became {y['mimic']}", **ids)
                elif x["mimic"]:
                    nums(f"{path}/mimic", name, "mimic", [x["mimic"]["multiplier"], x["mimic"]["offset"]], [y["mimic"]["multiplier"], y["mimic"]["offset"]], "other", **ids)
                if set(x["limits"]) != set(y["limits"]):
                    add(mut, f"{path}/limits", name, f"limits: {sorted(x['limits'])} became {sorted(y['limits'])}", **ids)
                else:
                    for k in sorted(x["limits"]):
                        nums(f"{path}/limits/{k}", name, f"limit {k}", [x["limits"][k]], [y["limits"][k]], "other", **ids)
    return out


def compare_model(raw_description, parsed_model):
    """Parity of the input description with what LinkForge parsed from it (workers-runtime §1 step 5)."""
    return compare(raw_description, from_lf(parsed_model), "LF")
