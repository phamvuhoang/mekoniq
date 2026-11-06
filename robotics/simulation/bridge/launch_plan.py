"""What the ROS launch file needs from a compiled bundle, as plain data (no ROS imports): world, map, per-robot URDF/spawn/params. Pure, testable."""
import json
from pathlib import Path

from .protocol import NAMESPACE, ProtocolError

LAUNCH_FILE = "lab_world.launch.py"


def _flat_yaml(text):
    """The compiler's nav2-<id>.yaml overlay: one `key: value` per line; quoted strings keep their text, plain numbers become floats."""
    out = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            out[key.strip()] = value[1:-1]
        else:
            try:
                out[key.strip()] = float(value)
            except ValueError:
                out[key.strip()] = value
    return out


def check_namespaces(robots):
    for ns in robots:
        if not isinstance(ns, str) or not NAMESPACE.match(ns):
            raise ProtocolError("NAMESPACE_INVALID", str(ns))
    if len(set(robots)) != len(robots):
        raise ProtocolError("NAMESPACE_DUPLICATE")
    return list(robots)


def plan_launch(bundle_dir, robots):
    bundle = Path(bundle_dir)
    manifest_file = bundle / "compiler-manifest.json"
    if not manifest_file.is_file():
        raise ProtocolError("BUNDLE_MISSING", str(bundle))
    manifest = json.loads(manifest_file.read_text())
    by_ns = {r["namespace"]: r for r in manifest.get("robots", [])}
    scene = json.loads((bundle / "scene-index.json").read_text()) if (bundle / "scene-index.json").is_file() else {}
    plan = {"world": str(bundle / "world.sdf"), "map": str(bundle / "map.yaml"), "mapId": manifest["map"]["mapId"], "mapRevision": manifest["map"]["mapRevision"],
            "inputHash": manifest["inputHash"], "manifestHash": manifest["manifestHash"], "robots": [],
            "cups": [c["gazeboModel"] for c in scene.get("beverage", {}).get("cups", [])],
            "actors": [a["gazeboModel"] for a in scene.get("actors", [])], "blockers": [b["gazeboModel"] for b in scene.get("blockers", [])]}
    for ns in check_namespaces(robots):
        r = by_ns.get(ns)
        if r is None:
            raise ProtocolError("ROBOT_UNKNOWN", ns)
        entity = r["entityId"]
        plan["robots"].append({"namespace": ns, "entityId": entity, "urdf": str(bundle / f"robot-{entity}.urdf"), "spawn": dict(r["spawn"]),
                               "params": _flat_yaml((bundle / f"nav2-{entity}.yaml").read_text())})
    return plan


def nav2_params_overlay(default_params, overlay):
    """Apply the compiler's per-robot overlay (initial pose, footprint/radius, speed) onto a full Nav2 params document (parsed YAML, mutated and returned)."""
    def node(name):
        return default_params.setdefault(name, {}).setdefault("ros__parameters", {})

    amcl = node("amcl")
    amcl["set_initial_pose"] = True
    amcl["initial_pose"] = {"x": float(overlay["initial_pose_x"]), "y": float(overlay["initial_pose_y"]), "z": 0.0, "yaw": float(overlay["initial_pose_yaw"])}
    for cm in ("local_costmap", "global_costmap"):
        params = default_params.setdefault(cm, {}).setdefault(cm, {}).setdefault("ros__parameters", {})
        params["robot_radius"] = float(overlay["robot_radius"])
        params["footprint"] = str(overlay["footprint"])
    vs = node("velocity_smoother")
    mv = list(vs.get("max_velocity") or [0.0, 0.0, 1.0])
    mv[0] = float(overlay["max_linear_mps"])
    vs["max_velocity"] = mv
    return default_params


def nav2_params_file(bundle_dir, robot, default_params_path):
    """Write <bundle>/nav2-<entity>.params.yaml = the navigation package defaults + this robot's compiled overlay; returns the path for `params_file`."""
    import yaml
    merged = nav2_params_overlay(yaml.safe_load(Path(default_params_path).read_text()) or {}, robot["params"])
    out = Path(bundle_dir) / f"nav2-{robot['entityId']}.params.yaml"
    out.write_text(yaml.safe_dump(merged, sort_keys=False))
    return str(out)


def launch_argv(bundle_dir, robots, headless=True):
    """Fixed argv for `ros2 launch` (never a shell string): the bundle path and the namespace list are the only variable parts."""
    bundle = Path(bundle_dir)
    if not (bundle / "compiler-manifest.json").is_file():
        raise ProtocolError("BUNDLE_MISSING", str(bundle))
    return ["ros2", "launch", "mekoniq_simulation", LAUNCH_FILE, f"bundle:={bundle}", f"robots:={','.join(check_namespaces(robots))}", f"headless:={'true' if headless else 'false'}"]
