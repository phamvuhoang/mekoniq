"""NavigationSceneV1 (validated by the TypeScript compiler) -> IR-SIM world YAML and the explicit name map. Pure computation: no engine import, no clock, no randomness."""
import hashlib
import json
import math
from pathlib import Path

import yaml


class SceneError(ValueError):
    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def engine_name(robot_id):
    """Stable and independent of fleet composition or ordering: the engine never sees an index that could shift."""
    return "r_" + hashlib.sha256(robot_id.encode("utf-8")).hexdigest()[:16]


def _finite(value, path="scene"):
    if isinstance(value, float) and not math.isfinite(value):
        raise SceneError("NON_FINITE", path)
    if isinstance(value, dict):
        for k, v in value.items():
            _finite(v, f"{path}/{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _finite(v, f"{path}/{i}")


def _rect_of(vertices):
    """(center_x, center_y, length_x, width_y) when the polygon is an axis-aligned rectangle, else None."""
    if len(vertices) != 4:
        return None
    xs, ys = sorted({round(v[0], 9) for v in vertices}), sorted({round(v[1], 9) for v in vertices})
    if len(xs) != 2 or len(ys) != 2:
        return None
    corners = {(round(v[0], 9), round(v[1], 9)) for v in vertices}
    if corners != {(x, y) for x in xs for y in ys}:
        return None
    xs0, xs1 = min(v[0] for v in vertices), max(v[0] for v in vertices)
    ys0, ys1 = min(v[1] for v in vertices), max(v[1] for v in vertices)
    return (xs0 + xs1) / 2, (ys0 + ys1) / 2, xs1 - xs0, ys1 - ys0


def _obstacle(o):
    rect = _rect_of(o["verticesM"])
    if rect:  # YAML rectangles are centred: corner + size/2 (never the corner itself)
        cx, cy, length, width = rect
        return {"shape": {"name": "rectangle", "length": length, "width": width}, "state": [cx, cy, 0.0], "static": True}
    # polygon vertices are relative to the state, which stays [0,0,0], so the translation is applied exactly once
    return {"shape": {"name": "polygon", "vertices": [list(v) for v in o["verticesM"]]}, "state": [0.0, 0.0, 0.0], "static": True}


def scene_to_world(scene):
    _finite(scene)
    if scene.get("documentType") != "navigation-scene" or scene["engine"]["id"] != "irsim_2d" or scene["clock"]["tickMs"] != 20:
        raise SceneError("SCENE_UNSUPPORTED", "only navigation-scene documents for irsim_2d at 20 ms are accepted")
    policy = scene["policy"]["parameters"]
    robots, names = [], {}
    for r in sorted(scene["robots"], key=lambda r: r["robotId"]):
        m = r["model"]
        name = engine_name(r["robotId"])
        if name in names.values():
            raise SceneError("NAME_COLLISION", r["robotId"])
        names[r["robotId"]] = name
        k = m["kinematics"]
        sensors = []
        for s in m["sensors"]:
            sensors.append({"name": "lidar2d", "number": s["beamCount"], "angle_range": s["fieldOfViewRad"], "range_min": s["rangeMinM"], "range_max": s["rangeMaxM"],
                            "offset": [s["poseInDrive"][0], s["poseInDrive"][1], s["poseInDrive"][2]],
                            "noise": s["noise"]["distribution"] == "gaussian", **({"std": s["noise"]["stddevM"]} if s["noise"]["distribution"] == "gaussian" else {})})
        entry = {"name": name, "kinematics": {"name": "diff"}, "shape": {"name": "polygon", "vertices": [list(v) for v in m["footprint"]["verticesM"]]},
                 "state": list(r["initialPoseMap"]), "vel_min": [-k["maxLinearMps"], -k["maxAngularRadps"]], "vel_max": [k["maxLinearMps"], k["maxAngularRadps"]],
                 "acce": [policy["maxAccelerationMps2"], policy["maxAngularAccelerationRadps2"]]}
        if sensors:
            entry["sensors"] = sensors
        robots.append(entry)  # no `goal` and no behavior: the source runner sends every velocity, an engine auto-dash would hide the controller
    world = scene["world"]
    solids = sorted([*world["obstacles"], *world["boundaries"]], key=lambda o: o["id"])
    return {"world": {"width": world["widthM"], "height": world["heightM"], "step_time": scene["clock"]["tickMs"] / 1000, "sample_time": 0.1, "control_mode": "auto", "collision_mode": scene["engine"]["collisionMode"]},
            "robot": robots, "obstacle": [_obstacle(o) for o in solids]}, {
        "schemaVersion": 1, "robots": names, "sensors": {r["robotId"]: [s["id"] for s in r["model"]["sensors"]] for r in scene["robots"]}, "solids": [o["id"] for o in solids]}


def write_scene(scene, out_dir):
    """Writes irsim/world.yaml and irsim/name-map.json under out_dir; returns their refs [{path, sha256, bytes}]."""
    world, names = scene_to_world(scene)
    files = {"irsim/world.yaml": yaml.safe_dump(world, sort_keys=True, default_flow_style=False, allow_unicode=False).encode(),
             "irsim/name-map.json": (json.dumps(names, sort_keys=True, separators=(",", ":")) + "\n").encode()}
    out = []
    for rel, data in sorted(files.items()):
        target = Path(out_dir) / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        out.append({"path": rel, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    return out
