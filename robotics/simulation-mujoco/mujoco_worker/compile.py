"""Deterministic MuJoCo model (MJCF) of one arm cell: an ArmCellSceneV1, the xarm6-g2 engineering component, its physics.json and the blob directory of its meshes.

Pure apart from reading (and hashing) the mesh blobs it names: no MuJoCo import, no clock. The same inputs give the same bytes: the XML is built with ElementTree
(fixed element and attribute order, escaping by the library), every number is written as repr(float) (the shortest text that reads back to the same double, -0.0
written as 0.0), and the only absolute path is the `blob_dir` the caller passes (as `compiler/@meshdir`). No scene or component id ever becomes an MJCF name.

Frames: the world is the map frame. The arm base body sits at `arm.baseInMap`; statics are given in the arm base frame and are placed through baseInMap; supports
are given in the map frame (centre) with their size along the base axes, so their boxes take the base orientation. A plane at map z = 0 is the floor.

Names (returned in `names`, the only place later code learns them): arm joints `J<i>` along the chain from the base, their actuators `J<i>_act`, the gripper
actuator `grip_act`, arm bodies `ARM_link<i>` (the base is `ARM_link0`), every other link `ARM_part<k>` (joint `ARM_part<k>_joint`), cups `PROP_<n>`, statics
`STATIC_<n>`, supports `SUPPORT_<n>` (n by sorted id, from 1), pads `PAD_<k>`, palm `PALM`, floor `FLOOR`.

Contact bits (contype, conaffinity): arm link meshes and the palm (2, 2) touch each other, the world and cups but not the pads; pads (1, 1) touch cups, the world and
each other; floor, statics, supports and cups (1, 3) touch everything. Adjacent arm links are excluded. Cups start parked at (0, 0, -10 - n) with (0, 0): placing a
cup is the worker's job: it must restore `names["propContact"]` on the cup geom AND on its body (`body_contype`/`body_conaffinity`, which MuJoCo
precomputes for the broad phase; setting only the geom bits leaves the cup without contacts).
"""
import hashlib
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ARM_MAX_JOINTS = 8
ARM_BITS, PAD_BITS, WORLD_BITS = (2, 2), (1, 1), (1, 3)
PARK_Z = -10.0


class CompileError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _finite(v):
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def _num(x):
    if not _finite(x):
        raise CompileError("INPUT_INVALID", f"not a finite number: {x!r}")
    return repr(float(x) + 0.0)


def _vec(v):
    return " ".join(_num(x) for x in v)


def _get(doc, path):
    """doc[a][b]... for a dotted path; a missing key is INPUT_INVALID, never a default."""
    cur = doc
    for key in path.split("."):
        try:
            cur = cur[int(key)] if isinstance(cur, list) else cur[key]
        except (KeyError, IndexError, TypeError, ValueError):
            raise CompileError("INPUT_INVALID", path) from None
    return cur


def _nums(doc, path, n):
    v = _get(doc, path)
    if not isinstance(v, list) or len(v) != n or not all(_finite(x) for x in v):
        raise CompileError("INPUT_INVALID", path)
    return v


def _rot(q):
    """Rows of the rotation of a quaternion x y z w (normalised here)."""
    if len(q) != 4 or not all(_finite(v) for v in q) or not any(q):
        raise CompileError("INPUT_INVALID", "quaternion")
    n = math.sqrt(sum(v * v for v in q))
    x, y, z, w = (v / n for v in q)
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def _place(base, v):
    p, r = base
    return [p[i] + sum(r[i][k] * v[k] for k in range(3)) for i in range(3)]


def _wxyz(q):
    return _vec([q[3], q[0], q[1], q[2]])


def _el(parent, tag, **attrs):
    return ET.SubElement(parent, tag, attrs)


def _check_component(component, physics):
    """Links by id, child joints per link, the root link and the arm chain (revolute joints that are not the gripper's, base to tip)."""
    links = {}
    for l in _get(component, "links"):
        mass = (l.get("massKg") or {}).get("value")
        if not _finite(mass) or mass <= 0:
            raise CompileError("MASS_INVALID", f"{l.get('id')}: {mass!r}")
        inertia, com = l.get("inertiaKgM2"), l.get("comM")
        if not (isinstance(inertia, list) and len(inertia) == 6 and all(_finite(v) for v in inertia)) or not (isinstance(com, list) and len(com) == 3 and all(_finite(v) for v in com)):
            raise CompileError("INERTIA_MISSING", str(l.get("id")))
        links[l["id"]] = l
    grip = {_get(physics, "gripper.driveJoint")} | {_get(m, "joint") for m in _get(physics, "gripper.mimic")}
    kids, parent_of = {}, {}
    for j in _get(component, "joints"):
        if j.get("kind") not in ("revolute", "fixed"):
            raise CompileError("JOINT_UNSUPPORTED", f"{j.get('id')}: {j.get('kind')}")
        if j.get("parent") not in links or j.get("child") not in links or j["child"] in parent_of:
            raise CompileError("JOINT_UNSUPPORTED", f"{j.get('id')}: unknown link or a link with two parents")
        if j["kind"] == "revolute":
            lim, axis = j.get("limits") or {}, j.get("axis")
            lo, hi, eff = ((lim.get(k) or {}).get("value") for k in ("lower", "upper", "effort"))
            if not (isinstance(axis, list) and len(axis) == 3 and all(_finite(v) for v in axis) and any(axis)) or not all(_finite(v) for v in (lo, hi, eff)) or not lo < hi or eff <= 0:
                raise CompileError("JOINT_UNSUPPORTED", f"{j['id']}: axis or limits")
        kids.setdefault(j["parent"], []).append(j)
        parent_of[j["child"]] = j
    roots = set(links) - set(parent_of)
    if len(roots) != 1:
        raise CompileError("JOINT_UNSUPPORTED", "the component needs exactly one base link")
    joints = {j["id"]: j for js in kids.values() for j in js}
    if not grip <= {i for i, j in joints.items() if j["kind"] == "revolute"}:
        raise CompileError("JOINT_UNSUPPORTED", "gripper joints must be revolute joints of the component")

    def path(link_id):  # joints from the root down to link_id
        out = []
        while link_id in parent_of and len(out) <= len(joints):
            out.append(parent_of[link_id])
            link_id = parent_of[link_id]["parent"]
        if link_id not in roots:
            raise CompileError("JOINT_UNSUPPORTED", "joint cycle")
        return out[::-1]

    arm = [j for j in joints.values() if j["kind"] == "revolute" and j["id"] not in grip]
    if len(arm) > ARM_MAX_JOINTS:
        raise CompileError("ARM_TOO_MANY_JOINTS", f"{len(arm)} arm joints, at most {ARM_MAX_JOINTS}")
    chain = max(([p for p in path(j["child"]) if p in arm] for j in arm), key=len, default=[])
    if not chain or len(chain) != len(arm):
        raise CompileError("JOINT_UNSUPPORTED", "the arm joints do not form one chain from the base")
    return links, kids, roots.pop(), chain


def _blob(blob_dir, sha):
    if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise CompileError("INPUT_INVALID", f"blobSha256 {sha!r}")
    try:
        data = (Path(blob_dir) / f"{sha}.stl").read_bytes()
    except FileNotFoundError:
        raise CompileError("MESH_BLOB_MISSING", sha) from None
    if hashlib.sha256(data).hexdigest() != sha:
        raise CompileError("MESH_BLOB_MISMATCH", sha)


def _friction(sliding, physics, key):
    if not _finite(sliding) or sliding <= 0:
        raise CompileError("INPUT_INVALID", f"world3d friction {sliding!r}")
    return _vec([sliding, *_nums(physics, f"contact.{key}", 3)[1:]])


def _bits(bits):
    return {"contype": str(bits[0]), "conaffinity": str(bits[1])}


def compile_cell(scene, component, physics, blob_dir):
    """(mjcf, names) of one arm cell; raises CompileError(code) on a missing or malformed input, never falls back."""
    links, kids, root, chain = _check_component(component, physics)
    arm, w3 = _get(scene, "arm"), _get(scene, "world3d")
    home = _get(arm, "homeRad")
    if not isinstance(home, list) or len(home) != len(chain):
        raise CompileError("ARM_HOME_OUT_OF_RANGE", f"homeRad has {len(home) if isinstance(home, list) else home!r} values for {len(chain)} joints")
    for h, j in zip(home, chain):
        if not _finite(h) or not j["limits"]["lower"]["value"] <= h <= j["limits"]["upper"]["value"]:
            raise CompileError("ARM_HOME_OUT_OF_RANGE", f"{j['id']}: {h!r}")
    base_q = _nums(arm, "baseInMap.quaternionXyzw", 4)
    base = (_nums(arm, "baseInMap.position", 3), _rot(base_q))
    gains = {_get(a, "joint"): a for a in _get(physics, "actuators")}
    armature = _nums(physics, "armatureKgM2", len(chain))
    damping, frictionloss = _get(physics, "jointDynamics.damping"), _get(physics, "jointDynamics.frictionloss")
    g = _get(physics, "gripper")
    pad_friction, prop_friction, support_friction = (_friction(_get(w3, k), physics, f) for k, f in (("padFriction", "padFriction"), ("propFriction", "propFriction"), ("supportFriction", "propFriction")))
    condim = str(_get(physics, "contact.condim"))

    root_el = ET.Element("mujoco", model="arm_cell")
    _el(root_el, "compiler", angle="radian", autolimits="true", meshdir=str(blob_dir))
    _el(root_el, "option", timestep=_num(_get(scene, "engine.timestepMs") / 1000), integrator="implicitfast", cone="elliptic", impratio=_num(_get(physics, "contact.impratio")))
    _el(_el(root_el, "default"), "geom", solref=_vec(_nums(physics, "contact.solref", 2)), solimp=_vec(_nums(physics, "contact.solimp", 3)))
    asset, world = _el(root_el, "asset"), _el(root_el, "worldbody")
    _el(world, "geom", name="FLOOR", type="plane", size="0 0 1", friction=support_friction, **_bits(WORLD_BITS))

    names = {"props": {}, "statics": {}, "supports": {}, "joints": [], "actuators": [], "gripper": "grip_act", "pads": [], "palm": "PALM", "links": {}, "jointIds": {}, "floor": "FLOOR",
             "propContact": {"contype": WORLD_BITS[0], "conaffinity": WORLD_BITS[1]}}
    for n, o in enumerate(sorted(_get(scene, "statics"), key=lambda o: str(o.get("id"))), 1):
        if o.get("id") in names["statics"]:
            raise CompileError("INPUT_INVALID", f"two statics have the id {o.get('id')!r}")
        name = names["statics"][o["id"]] = f"STATIC_{n}"
        if o.get("kind") == "sphere":
            r = _get(o, "radiusM")
            if not _finite(r) or r <= 0:
                raise CompileError("INPUT_INVALID", f"static {n}: radiusM")
            _el(world, "geom", name=name, type="sphere", size=_num(r), pos=_vec(_place(base, _nums(o, "center", 3))), friction=support_friction, **_bits(WORLD_BITS))
        elif o.get("kind") == "box":
            lo, hi = _nums(o, "min", 3), _nums(o, "max", 3)
            if any(a >= b for a, b in zip(lo, hi)):
                raise CompileError("INPUT_INVALID", f"static {n}: min must be below max")
            _el(world, "geom", name=name, type="box", size=_vec([(b - a) / 2 for a, b in zip(lo, hi)]), pos=_vec(_place(base, [(a + b) / 2 for a, b in zip(lo, hi)])), quat=_wxyz(base_q),
                friction=support_friction, **_bits(WORLD_BITS))
        else:
            raise CompileError("INPUT_INVALID", f"static {n}: kind {o.get('kind')!r}")
    for n, s in enumerate(sorted(_get(scene, "supports"), key=lambda s: str(s.get("id"))), 1):
        size = _nums(s, "sizeM", 3)
        if s.get("id") in names["supports"] or not all(v > 0 for v in size):
            raise CompileError("INPUT_INVALID", f"support {s.get('id')!r}")
        name = names["supports"][s["id"]] = f"SUPPORT_{n}"
        _el(world, "geom", name=name, type="box", size=_vec([v / 2 for v in size]), pos=_vec(_nums(s, "centerM", 3)), quat=_wxyz(base_q), friction=support_friction, **_bits(WORLD_BITS))

    meshes, qpos, excludes = {}, [], []
    chain_index = {j["id"]: i for i, j in enumerate(chain)}
    pads = _get(physics, "pads")
    parts = iter(range(1, len(links) + 1))

    def shape(body, c):
        geo, pose = _get(c, "geometry"), _get(c, "pose")
        attrs = {"pos": _vec(_nums(pose, "xyzM", 3)), "quat": _wxyz(_nums(pose, "quaternionXyzw", 4))}
        kind = geo.get("kind")
        if kind == "mesh":
            sha, scale = geo.get("blobSha256"), _nums(geo, "scale", 3)
            if (sha, tuple(scale)) not in meshes:
                _blob(blob_dir, sha)
                meshes[(sha, tuple(scale))] = f"MESH_{len(meshes) + 1}"
                _el(asset, "mesh", name=meshes[(sha, tuple(scale))], file=f"{sha}.stl", scale=_vec(scale))
            typed = {"type": "mesh", "mesh": meshes[(sha, tuple(scale))]}
        elif kind == "box":
            typed = {"type": "box", "size": _vec([v / 2 for v in _nums(geo, "sizeM", 3)])}
        elif kind == "sphere":
            typed = {"type": "sphere", "size": _num(_get(geo, "radiusM"))}
        elif kind == "cylinder":
            typed = {"type": "cylinder", "size": _vec([_get(geo, "radiusM"), _get(geo, "lengthM") / 2])}
        else:
            raise CompileError("INPUT_INVALID", f"geometry kind {kind!r}")
        _el(body, "geom", **typed, **attrs, group="3", **_bits(ARM_BITS))

    def link_body(parent_el, link_id, via):
        if via is None:
            name, pos, quat = "ARM_link0", base[0], base_q
        else:
            name = f"ARM_link{chain_index[via['id']] + 1}" if via["id"] in chain_index else f"ARM_part{next(parts)}"
            pos, quat = _nums(via, "origin.xyzM", 3), _nums(via, "origin.quaternionXyzw", 4)
        names["links"][link_id] = name
        body = _el(parent_el, "body", name=name, pos=_vec(pos), quat=_wxyz(quat))
        l, i = links[link_id], links[link_id]["inertiaKgM2"]  # xx xy xz yy yz zz -> MuJoCo fullinertia xx yy zz xy xz yz
        _el(body, "inertial", pos=_vec(l["comM"]), mass=_num(l["massKg"]["value"]), fullinertia=_vec([i[0], i[3], i[5], i[1], i[2], i[4]]))
        if via is not None and via["kind"] == "revolute":
            lim = via["limits"]
            if via["id"] in chain_index:
                k = chain_index[via["id"]]
                jname = f"J{k + 1}"
                extra = {"armature": _num(armature[k]), "damping": _num(damping), "frictionloss": _num(frictionloss)}
                names["joints"].append(jname)
                qpos.append(home[k])
            else:
                jname = f"{name}_joint"
                extra = {"armature": _num(_get(g, "armatureKgM2"))}
                qpos.append(0.0)
            names["jointIds"][via["id"]] = jname
            _el(body, "joint", name=jname, axis=_vec(via["axis"]), range=_vec([lim["lower"]["value"], lim["upper"]["value"]]), **extra)
        for c in l.get("collision") or []:
            shape(body, c)
        if _get(physics, "palm.link") == link_id:
            _el(body, "geom", name="PALM", type="box", size=_vec([v / 2 for v in _nums(physics, "palm.sizeM", 3)]), pos=_vec(_nums(physics, "palm.centerM", 3)), group="3", **_bits(ARM_BITS))
        for k, pad in enumerate(pads, 1):
            if _get(pad, "link") == link_id:
                names["pads"].append(f"PAD_{k}")
                _el(body, "geom", name=f"PAD_{k}", type="box", size=_vec([v / 2 for v in _nums(pad, "sizeM", 3)]), pos=_vec(_nums(pad, "centerM", 3)), condim=condim, priority="1",
                    friction=pad_friction, group="3", **_bits(PAD_BITS))
        for j in kids.get(link_id, []):
            child = link_body(body, j["child"], j)
            if j["id"] in chain_index:
                excludes.append((name, child))
        return name

    link_body(world, root, None)
    if len(names["links"]) != len(links):
        raise CompileError("JOINT_UNSUPPORTED", "links not connected to the base: " + ", ".join(sorted(set(links) - set(names["links"]))))
    for pad in pads:
        if _get(pad, "link") not in links:
            raise CompileError("INPUT_INVALID", f"pad on unknown link {pad.get('link')!r}")
    if _get(physics, "palm.link") not in links:
        raise CompileError("INPUT_INVALID", "palm.link")

    props = sorted(_get(scene, "props"), key=lambda p: str(p.get("propId")))
    for n, p in enumerate(props, 1):
        pid, r, h, m = p.get("propId"), p.get("radiusM"), p.get("heightM"), p.get("massKg")
        if p.get("kind") != "cup" or not isinstance(pid, str) or not pid or pid in names["props"] or not all(_finite(v) and v > 0 for v in (r, h, m)):
            raise CompileError("PROP_INVALID", repr(pid))
        name = names["props"][pid] = f"PROP_{n}"
        body = _el(world, "body", name=name, pos=_vec([0, 0, PARK_Z - n]))
        _el(body, "freejoint", name=f"{name}_free")
        _el(body, "geom", name=name, type="cylinder", size=_vec([r, h / 2]), mass=_num(m), friction=prop_friction, condim=condim, contype="0", conaffinity="0")
        qpos.extend([0, 0, PARK_Z - n, 1, 0, 0, 0])

    contact = _el(root_el, "contact")
    for a, b in excludes:
        _el(contact, "exclude", body1=a, body2=b)
    drive = names["jointIds"].get(_get(g, "driveJoint"))
    equality = _el(root_el, "equality")
    for mm in _get(g, "mimic"):
        _el(equality, "joint", joint1=names["jointIds"][mm["joint"]], joint2=drive, polycoef=_vec([0, _get(mm, "multiplier"), 0, 0, 0]), solref=_vec(_nums(g, "mimicSolref", 2)))
    actuator = _el(root_el, "actuator")
    for k, j in enumerate(chain):
        a, eff, lim = gains.get(j["id"]), j["limits"]["effort"]["value"], j["limits"]
        if a is None:
            raise CompileError("INPUT_INVALID", f"physics.actuators has no entry for {j['id']}")
        names["actuators"].append(f"J{k + 1}_act")
        _el(actuator, "position", name=f"J{k + 1}_act", joint=f"J{k + 1}", kp=_num(_get(a, "kp")), kv=_num(_get(a, "kv")), forcerange=_vec([-eff, eff]), ctrlrange=_vec([lim["lower"]["value"], lim["upper"]["value"]]))
    dl = next(j for js in kids.values() for j in js if j["id"] == g["driveJoint"])["limits"]
    force = _get(g, "forceRangeNm")
    _el(actuator, "position", name="grip_act", joint=drive, kp=_num(_get(g, "kp")), kv=_num(_get(g, "kv")), forcerange=_vec([-force, force]), ctrlrange=_vec([dl["lower"]["value"], dl["upper"]["value"]]))
    _el(_el(root_el, "keyframe"), "key", name="home", qpos=_vec(qpos), ctrl=_vec([*home, 0.0]))
    ET.indent(root_el, space=" ")
    return ET.tostring(root_el, encoding="unicode") + "\n", names
