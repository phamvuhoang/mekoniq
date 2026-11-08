"""Builders for small physical models and the URDF text the native compiler would emit for them (ids contain '/')."""
import copy
import hashlib
import json
import math

SRC = {"kind": "assumed", "documentId": "fixture", "revision": "1", "locator": "tests/helpers.py", "contentSha256": "0" * 64}
Q0 = [0.0, 0.0, 0.0, 1.0]


def pose(x=0.0, y=0.0, z=0.0, q=Q0):
    return {"xyzM": [x, y, z], "quaternionXyzw": list(q)}


def box_inertia(m, size):
    x, y, z = size
    return [m * (y * y + z * z) / 12, 0.0, 0.0, m * (x * x + z * z) / 12, 0.0, m * (x * x + y * y) / 12]


def link(lid, size=(0.5, 0.4, 0.15), mass=20.0, **over):
    shape = {"pose": pose(), "geometry": {"kind": "box", "sizeM": list(size)}, "source": SRC}
    out = {"id": lid, "visual": [copy.deepcopy(shape)], "collision": [copy.deepcopy(shape)], "massKg": {"value": mass, "unit": "kg", "source": SRC},
           "comM": [0.0, 0.0, 0.0], "inertiaKgM2": box_inertia(mass, size), "inertialSource": SRC}
    out.update(over)
    return out


def joint(jid, parent, child, kind="fixed", origin=None, axis=(0.0, 0.0, 1.0), limits=None):
    out = {"id": jid, "kind": kind, "parent": parent, "child": child, "origin": origin or pose(0, 0, 0.1), "axis": list(axis)}
    if kind != "fixed":
        out["limits"] = limits or {"velocity": {"value": 30.0, "unit": "rad/s", "source": SRC}, "effort": {"value": 8.0, "unit": "N*m", "source": SRC}}
    return out


def model(links=None, joints=None, sensors=None):
    links = links if links is not None else [link("chassis/base"), link("tray/plate", (0.4, 0.35, 0.01), 1.2)]
    joints = joints if joints is not None else [joint("mount:chassis/tray:tray/mount", "chassis/base", "tray/plate")]
    return {"schemaVersion": 1, "documentType": "robot-physical-model", "modelDigest": hashlib.sha256(b"m").hexdigest(), "inputs": {"assemblyDigest": "b" * 64}, "robotId": "amr-1",
            "baseFrameId": links[0]["id"], "links": links, "joints": joints, "drive": None, "sensors": sensors or [], "assumptions": []}


def g(v):
    text = repr(float(v) + 0.0)
    return text[:-2] if text.endswith(".0") else text


def rpy(q):
    x, y, z, w = q
    r = math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    p = math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x))))
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return r, p, yaw


def _origin(p):
    return f'<origin xyz="{" ".join(g(v) for v in p["xyzM"])}" rpy="{" ".join(g(v) for v in rpy(p["quaternionXyzw"]))}"/>'


def _geometry(geo):
    if geo["kind"] == "box":
        return f'<box size="{" ".join(g(v) for v in geo["sizeM"])}"/>'
    if geo["kind"] == "cylinder":
        return f'<cylinder radius="{g(geo["radiusM"])}" length="{g(geo["lengthM"])}"/>'
    if geo["kind"] == "sphere":
        return f'<sphere radius="{g(geo["radiusM"])}"/>'
    return f'<mesh filename="{geo["filename"]}" scale="1 1 1"/>'


def urdf(m, name="amr-1"):
    out = ['<?xml version="1.0"?>', f'<robot name="{name}">']
    for l in m["links"]:
        i = l["inertiaKgM2"]
        out.append(f'  <link name="{l["id"]}">')
        if i is not None:
            out.append(f'    <inertial><origin xyz="{" ".join(g(v) for v in l["comM"])}" rpy="0 0 0"/><mass value="{g(l["massKg"]["value"])}"/>'
                       f'<inertia ixx="{g(i[0])}" ixy="{g(i[1])}" ixz="{g(i[2])}" iyy="{g(i[3])}" iyz="{g(i[4])}" izz="{g(i[5])}"/></inertial>')
        for tag in ("visual", "collision"):
            for s in l[tag]:
                out.append(f'    <{tag}>{_origin(s["pose"])}<geometry>{_geometry(s["geometry"])}</geometry></{tag}>')
        out.append("  </link>")
    for j in m["joints"]:
        out.append(f'  <joint name="{j["id"]}" type="{j["kind"]}"><parent link="{j["parent"]}"/><child link="{j["child"]}"/>{_origin(j["origin"])}<axis xyz="{" ".join(g(v) for v in j["axis"])}"/>')
        if j["kind"] != "fixed":
            lim = j["limits"]
            out.append(f'    <limit effort="{g(lim["effort"]["value"])}" velocity="{g(lim["velocity"]["value"])}"/>')
        out.append("  </joint>")
    out.append("</robot>")
    return "\n".join(out)


def request(m, xml, root, lock="1" * 64, name="robot.urdf"):
    """Writes the URDF under `root` (a pathlib.Path) and returns the worker request."""
    (root / name).write_text(xml)
    return {"protocol": "mekoniq-linkforge/1", "model": m, "urdfPath": name, "urdfSha256": hashlib.sha256(xml.encode()).hexdigest(), "bundleRoot": str(root),
            "lockDigest": lock, "adapterVersion": "linkforge-adapter/1"}


def codes(result):
    return {i["code"] for i in result["report"]["issues"]}
