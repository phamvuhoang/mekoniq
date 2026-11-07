"""Engineering assembly compiler: one EngineeringCompileInput -> a deterministic bundle (URDF, controller/Nav2 config, scene, SDF world, map, bindings).

The input is the full object A03 produces (project, resolved assembly, runtimeProjection, recipes), never a bare ResolvedAssembly. Wheel radius, separation and
every inertial come from that input exactly once; nothing is derived from a body's bounding box. No network, no clock, no randomness: equal input, equal bytes."""
import hashlib
import json
import math
import os
from pathlib import Path

import jsonschema
import yaml
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

from worlds.generate_restaurant import box_sdf

from .compile_world import DEFAULT_MAX_LINEAR_MPS, nav2_overlay
from .manifest import HASH_ALGORITHM, SAFE_NAME, canonical_hash
from .models import WALL_HEIGHT_M, CompileError, WorldModel, quat_to_rpy
from .occupancy import RESOLUTION_M, map_identity, map_yaml, occupancy_pgm

ENGINEERING_COMPILER = {"id": "lab-engineering-compiler", "version": "1"}
SCHEMA_DIR = Path(os.environ.get("MEKONIQ_SCHEMA_DIR") or Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas")
REQUIRED = ("project", "projectDigest", "resolved", "runtimeProjection", "recipes")


def g(value):
    """The exact double as its shortest round-trip decimal, so URDF and scene.json carry the same numbers; `+ 0.0` folds -0.0 into 0."""
    text = repr(float(value) + 0.0)
    return text[:-2] if text.endswith(".0") else text


def _validator():
    registry = Registry()
    for file in sorted(SCHEMA_DIR.glob("*.schema.json")):
        schema = json.loads(file.read_text())
        resource = Resource.from_contents(schema, default_specification=DRAFT7)
        registry = registry.with_resource(file.name, resource)
        if "$id" in schema:
            registry = registry.with_resource(schema["$id"], resource)
    return jsonschema.Draft7Validator({"$ref": "engineering-bundle.schema.json#/definitions/EngineeringCompileInput"}, registry=registry)


def _check_input(inp):
    if not isinstance(inp, dict) or any(k not in inp for k in REQUIRED):
        raise CompileError("COMPILE_INPUT_INCOMPLETE", "need project, projectDigest, resolved, runtimeProjection and recipes")
    errors = sorted(_validator().iter_errors(inp), key=lambda e: list(e.absolute_path))
    if errors:
        raise CompileError("INPUT_SCHEMA_INVALID", f"/{'/'.join(str(p) for p in errors[0].absolute_path)}: {errors[0].message}")
    if canonical_hash(inp["project"]) != inp["projectDigest"]:
        raise CompileError("INPUT_HASH_MISMATCH", "projectDigest does not match the canonical hash of project")
    resolved = inp["resolved"]
    if canonical_hash({k: v for k, v in resolved.items() if k != "assemblyDigest"}) != resolved["assemblyDigest"]:
        raise CompileError("INPUT_HASH_MISMATCH", "assemblyDigest does not match the resolved assembly")
    project, runtime, assets = inp["project"], inp["runtimeProjection"]["project"], inp["runtimeProjection"]["assets"]
    refs = {(a["id"], a["revision"], a["contentHash"]) for a in assets}
    for e in runtime["entities"]:
        ref = e["assetRef"]
        if (ref["id"], ref["revision"], ref["contentHash"]) not in refs:
            raise CompileError("ASSET_REF_UNRESOLVED", f"{e['id']} -> {ref['id']}@{ref['revision']}")
        for r in e.get("recipeRefs", []):
            recipe = next((x for x in inp["recipes"] if x["id"] == r["id"] and x["revision"] == r["revision"]), None)
            if recipe is None:
                raise CompileError("RECIPE_MISSING", r["id"])
            if recipe["hash"] != r["hash"]:
                raise CompileError("RECIPE_MISMATCH", r["id"])

    def semantic(p):  # everything but the regenerated asset refs must be exactly what the author wrote
        p = json.loads(json.dumps(p))
        for e in p["entities"]:
            e.pop("assetRef", None)
        return p

    if canonical_hash(semantic(project["runtimeProject"])) != canonical_hash(semantic(runtime)):
        raise CompileError("PROJECTION_MISMATCH", "runtimeProjection changed more than the asset references")
    bind = lambda b: sorted(({"entityId": x["entityId"], "instanceIds": list(x["instanceIds"])} for x in b), key=lambda x: x["entityId"])
    if bind(project["entityBindings"]) != bind(resolved["entityBindings"]):
        raise CompileError("BINDING_MISMATCH", "resolved assembly was built from different entity bindings")
    bound = [i for b in project["entityBindings"] for i in b["instanceIds"]]
    for inst in project["assembly"]["instances"]:
        if bound.count(inst["id"]) != 1:
            raise CompileError("INSTANCE_UNBOUND", inst["id"])


def _origin(pose):
    r, p, y = quat_to_rpy(pose["quaternionXyzw"])
    return f'<origin xyz="{" ".join(g(v) for v in pose["xyzM"])}" rpy="{g(r)} {g(p)} {g(y)}"/>'


def _geometry(geometry):
    kind = geometry["kind"]
    if kind == "box":
        return f'<box size="{" ".join(g(v) for v in geometry["sizeM"])}"/>'
    if kind == "cylinder":
        return f'<cylinder radius="{g(geometry["radiusM"])}" length="{g(geometry["lengthM"])}"/>'
    if kind == "sphere":
        return f'<sphere radius="{g(geometry["radiusM"])}"/>'
    return f'<mesh filename="../meshes/{geometry["blobSha256"]}" scale="{" ".join(g(v) for v in geometry["scale"])}"/>'


def _link_xml(link):
    ixx, ixy, ixz, iyy, iyz, izz = link["inertiaKgM2"]
    out = [f'  <link name="{link["id"]}">',
           f'    <inertial><origin xyz="{" ".join(g(v) for v in link["comM"])}" rpy="0 0 0"/><mass value="{g(link["massKg"]["value"])}"/>'
           f'<inertia ixx="{g(ixx)}" ixy="{g(ixy)}" ixz="{g(ixz)}" iyy="{g(iyy)}" iyz="{g(iyz)}" izz="{g(izz)}"/></inertial>']
    for tag in ("visual", "collision"):
        for shape in link[tag]:
            out.append(f'    <{tag}>{_origin(shape["pose"])}<geometry>{_geometry(shape["geometry"])}</geometry></{tag}>')
    out.append("  </link>")
    return "\n".join(out)


def _joint_xml(joint):
    out = [f'  <joint name="{joint["id"]}" type="{joint["kind"]}">', f'    <parent link="{joint["parent"]}"/><child link="{joint["child"]}"/>', f"    {_origin(joint['origin'])}",
           f'    <axis xyz="{" ".join(g(v) for v in joint["axis"])}"/>']
    if joint["kind"] != "fixed":
        lim = joint["limits"]
        bounds = f'lower="{g(lim["lower"]["value"])}" upper="{g(lim["upper"]["value"])}" ' if "lower" in lim else ""
        out.append(f'    <limit {bounds}effort="{g(lim["effort"]["value"])}" velocity="{g(lim["velocity"]["value"])}"/>')
    out.append("  </joint>")
    return "\n".join(out)


def _urdf(entity_id, links, joints):
    body = "\n".join([_link_xml(l) for l in links] + [_joint_xml(j) for j in joints])
    return f'<?xml version="1.0"?>\n<!-- GENERATED by lab-engineering-compiler for entity {entity_id}; SI units, explicit inertials from the resolved assembly. -->\n<robot name="{entity_id}">\n{body}\n</robot>\n'.encode()


def _world_sdf(model):
    w = model.world
    boxes = [box_sdf(f"wall_{i}", x + bw / 2, y + bh / 2, bw, bh, WALL_HEIGHT_M) for i, (x, y, bw, bh) in enumerate(model.walls)]
    boxes += [box_sdf(f"fixture_{o['id']}", o["x"] + o["width"] / 2, o["y"] + o["height"] / 2, o["width"], o["height"], model.fixture_height_m) for o in w["obstacles"]]
    body = "\n".join(boxes)
    return f"""<?xml version="1.0"?>
<!-- GENERATED by lab-engineering-compiler from world {w['id']} revision {w['revision']}: one physics world, robots are spawned from robots/*.urdf. -->
<sdf version="1.9">
  <world name="lab">
    <physics name="1ms" type="ignored"><max_step_size>0.001</max_step_size><real_time_factor>1.0</real_time_factor></physics>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors"><render_engine>ogre2</render_engine></plugin>
    <plugin filename="gz-sim-contact-system" name="gz::sim::systems::Contact"/>
    <scene><ambient>0.6 0.6 0.6 1</ambient></scene>
    <light type="directional" name="sun"><direction>-0.5 0.1 -0.9</direction><diffuse>0.8 0.8 0.8 1</diffuse></light>
    <model name="ground"><static>true</static><link name="link">
      <collision name="c"><geometry><plane><normal>0 0 1</normal><size>{w['width']} {w['height']}</size></plane></geometry></collision>
      <visual name="v"><pose>{w['width'] / 2} {w['height'] / 2} 0 0 0 0</pose><geometry><plane><normal>0 0 1</normal><size>{w['width']} {w['height']}</size></plane></geometry></visual></link></model>
{body}
  </world>
</sdf>
""".encode()


def _dump(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def _drive(resolved, entity_id):
    drive = resolved["models"].get("drive")
    params = ((drive or {}).get("model") or {}).get("parameters", {})
    block = params.get("drive") or {}
    if not drive or drive.get("entityId") != entity_id or "wheelRadiusM" not in block or "wheelSeparationM" not in block:
        raise CompileError("WHEEL_RADIUS_REQUIRED", f"{entity_id}: the drive model must declare wheelRadiusM and wheelSeparationM (never derived from the body)")
    return drive, block["wheelRadiusM"]["value"], block["wheelSeparationM"]["value"]


def _controller(entity_id, root, drive, radius, separation, speed):
    angular = 2 * speed / separation  # spin in place with both wheels at the linear limit
    return yaml.safe_dump({
        "controller_manager": {"ros__parameters": {"update_rate": 100, "use_sim_time": True, "diff_drive_controller": {"type": "diff_drive_controller/DiffDriveController"},
                                                   "joint_state_broadcaster": {"type": "joint_state_broadcaster/JointStateBroadcaster"}}},
        "diff_drive_controller": {"ros__parameters": {
            "left_wheel_names": [drive["leftJointId"]], "right_wheel_names": [drive["rightJointId"]], "wheel_separation": separation, "wheel_radius": radius,
            "base_frame_id": root, "odom_frame_id": f"{entity_id}/odom", "enable_odom_tf": True, "open_loop": False, "use_stamped_vel": False,
            "linear": {"x": {"max_velocity": speed, "min_velocity": -speed}}, "angular": {"z": {"max_velocity": angular, "min_velocity": -angular}}}},
    }, sort_keys=True).encode()


def compile_engineering(inp, out_dir):
    """Compile one EngineeringCompileInput into `out_dir`; returns {"sceneDigest", "files": [{"path","sha256"}...]} (sorted). Raises CompileError and writes nothing on refusal."""
    _check_input(inp)
    resolved, project = inp["resolved"], inp["project"]
    runtime, assets = inp["runtimeProjection"]["project"], inp["runtimeProjection"]["assets"]
    model = WorldModel.validate(runtime, assets)
    model.assert_target_clearance()
    w = model.world
    map_id, map_revision, world_hash = f"eng-{project['id']}", str(w["revision"]), canonical_hash(w)
    bindings = model.bindings()
    for b in bindings.values():
        b.update({"frame": "map", "mapId": map_id, "mapRevision": map_revision})
    pgm = occupancy_pgm(model.rects(), w["width"], w["height"])
    identity, identity_bytes = map_identity(map_id, map_revision, world_hash, pgm, w["width"], w["height"])
    files = {"world.sdf": _world_sdf(model), "map.pgm": pgm, "map.yaml": map_yaml().encode(), "map.identity.json": identity_bytes,
             "bindings.json": _dump({"frame": "map", "mapId": map_id, "mapRevision": map_revision, "bindings": bindings})}

    links = {l["id"]: l for l in resolved["links"]}
    joint_child = {j["child"]: j for j in resolved["joints"]}
    kinds = {e["id"]: e["kind"] for e in runtime["entities"]}
    robots = {r.entity_id: r for r in model.robots}
    entities, wheel_bindings, assumptions = [], [], list(model.assumptions) + [a["documentId"] + ": " + a["locator"] + " (assumed)" for a in resolved["assumptions"]]
    for binding in sorted(resolved["entityBindings"], key=lambda b: b["entityId"]):
        entity_id, instances = binding["entityId"], set(binding["instanceIds"])
        mine = [links[k] for k in sorted(links) if k.split("/")[0] in instances]
        mine_joints = [j for j in sorted(resolved["joints"], key=lambda j: j["id"]) if j["child"].split("/")[0] in instances]
        for j in mine_joints:
            if j["parent"].split("/")[0] not in instances:
                raise CompileError("ENTITY_CROSS_MOUNT", f"{j['id']} joins {entity_id} to another entity")
        roots = [l["id"] for l in mine if not (l["id"] in joint_child and joint_child[l["id"]]["parent"].split("/")[0] in instances)]
        if len(roots) != 1:
            raise CompileError("ENTITY_ROOT_AMBIGUOUS", f"{entity_id}: {roots}")
        safe = entity_id
        if not SAFE_NAME.match(safe) or safe in (".", ".."):
            raise CompileError("OUTPUT_NAME_INVALID", entity_id)
        files[f"robots/{safe}.urdf"] = _urdf(entity_id, mine, mine_joints)
        entities.append({"entityId": entity_id, "kind": kinds[entity_id], "rootLinkId": roots[0], "instanceIds": sorted(instances)})
        if kinds[entity_id] == "amr":
            drive, radius, separation = _drive(resolved, entity_id)
            robot = robots[entity_id]
            speed = robot.speed_limit_mps or DEFAULT_MAX_LINEAR_MPS
            files[f"controllers/{safe}.yaml"] = _controller(entity_id, roots[0], drive, radius, separation, speed)
            files[f"nav2/{safe}.yaml"] = nav2_overlay(model, robot, bindings, map_id, map_revision)
            wheel_bindings += [{"id": f"{entity_id}/left", "entityId": entity_id, "side": "left", "radiusM": radius, "jointId": drive["leftJointId"]},
                               {"id": f"{entity_id}/right", "entityId": entity_id, "side": "right", "radiusM": radius, "jointId": drive["rightJointId"]}]
    assumptions.append("actuators are ideal velocity controllers: only the velocity limit is enforced; torque, current and voltage limits are not modelled (B04)")
    scene = {"schemaVersion": 1, "links": [links[k] for k in sorted(links)], "joints": sorted(resolved["joints"], key=lambda j: j["id"]),
             "frames": [{"id": k, "parent": joint_child[k]["parent"] if k in joint_child else None, "pose": joint_child[k]["origin"] if k in joint_child else {"xyzM": [0, 0, 0], "quaternionXyzw": [0, 0, 0, 1]}} for k in sorted(links)],
             "geometryRefs": [{"linkId": k, "kind": kind, "index": i, "blobSha256": s["geometry"].get("blobSha256")} for k in sorted(links) for kind in ("visual", "collision") for i, s in enumerate(links[k][kind])],
             "fixedJointMapping": [{"jointId": j["id"], "linkId": j["child"], "mergedInto": j["parent"]} for j in sorted(resolved["joints"], key=lambda j: j["id"]) if j["kind"] == "fixed"],
             "wheelBindings": wheel_bindings, "entities": entities,
             "world": {"id": w["id"], "revision": w["revision"], "widthM": w["width"], "heightM": w["height"], "hash": world_hash,
                       "walls": [{"x": x, "y": y, "width": bw, "height": bh} for x, y, bw, bh in model.walls],
                       "fixtures": [{"obstacleId": o["id"], "x": o["x"], "y": o["y"], "width": o["width"], "height": o["height"], "heightM": model.fixture_height_m} for o in w["obstacles"]]}}
    files["scene.json"] = _dump(scene)
    outputs = [{"path": p, "sha256": hashlib.sha256(files[p]).hexdigest()} for p in sorted(files)]
    manifest = {"schemaVersion": 1, "compiler": ENGINEERING_COMPILER, "hashAlgorithm": HASH_ALGORITHM, "inputHash": canonical_hash(inp), "projectDigest": inp["projectDigest"], "assemblyDigest": resolved["assemblyDigest"],
                "world": {"id": w["id"], "revision": w["revision"], "hash": world_hash}, "map": {"mapId": map_id, "mapRevision": map_revision, "resolutionM": RESOLUTION_M, "inflation": "none", "pgmSha256": identity["pgmSha256"]},
                "recipes": sorted(r["id"] for r in inp["recipes"]), "assumptions": assumptions,
                "actuator": {"fidelity": "ideal", "enforces": ["velocity_limit"], "note": "stock diff_drive_controller; no torque/current/voltage model"}, "outputs": outputs}
    manifest["manifestHash"] = canonical_hash(manifest)
    files["compiler-manifest.json"] = _dump(manifest)
    out = Path(out_dir)
    for name in files:
        if not all(SAFE_NAME.match(part) and part not in (".", "..") for part in name.split("/")):
            raise CompileError("OUTPUT_NAME_INVALID", name)
    for name, data in files.items():  # only after every file rendered: a refusal never leaves a partial bundle
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    listed = [{"path": p, "sha256": hashlib.sha256(files[p]).hexdigest()} for p in sorted(files)]
    return {"sceneDigest": hashlib.sha256(files["scene.json"]).hexdigest(), "files": listed}
