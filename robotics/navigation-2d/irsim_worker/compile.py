"""Portable bundle files for the engineering-irsim-2d-v1 profile: per-entity URDF and the CompiledScene through the shared pure helpers (robotics/simulation/compiler/description.py,
no ROS, no Gazebo), then the IR-SIM world from the already validated navigation scene. Native Nav2/SDF/controller outputs are deliberately not produced.
    python -m irsim_worker.compile --input request.json --out DIR      request = {"compileInput": ..., "scene": ...}
Prints {"files": [{path, sha256, bytes}]} on stdout; raises (exit 1) and writes nothing on any refusal."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from compiler.description import dump, render_compiled_scene, render_urdf
from compiler.manifest import SAFE_NAME, canonical_hash
from compiler.models import DEFAULT_FIXTURE_HEIGHT_M, WALL_THICKNESS_M, CompileError

from .scene import write_scene


def description_files(inp):
    resolved, runtime = inp["resolved"], inp["runtimeProjection"]["project"]
    models = resolved["models"]
    links = {l["id"]: l for l in resolved["links"]}
    joint_child = {j["child"]: j for j in resolved["joints"]}
    kinds = {e["id"]: e["kind"] for e in runtime["entities"]}
    files, entities, wheels = {}, [], []
    for binding in sorted(resolved["entityBindings"], key=lambda b: b["entityId"]):
        entity_id, instances = binding["entityId"], set(binding["instanceIds"])
        if kinds[entity_id] != "amr":
            raise CompileError("ENTITY_KIND_UNSUPPORTED", f"{entity_id} is a {kinds[entity_id]}; the 2D profile runs AMRs only")
        if not SAFE_NAME.match(entity_id):
            raise CompileError("OUTPUT_NAME_INVALID", entity_id)
        mine = [links[k] for k in sorted(links) if k.split("/")[0] in instances]
        mine_joints = [j for j in sorted(resolved["joints"], key=lambda j: j["id"]) if j["child"].split("/")[0] in instances]
        for j in mine_joints:
            if j["parent"].split("/")[0] not in instances:
                raise CompileError("ENTITY_CROSS_MOUNT", f"{j['id']} joins {entity_id} to another entity")
        roots = [l["id"] for l in mine if not (l["id"] in joint_child and joint_child[l["id"]]["parent"].split("/")[0] in instances)]
        if len(roots) != 1:
            raise CompileError("ENTITY_ROOT_AMBIGUOUS", f"{entity_id}: {roots}")
        drive = (models.get("drivesByEntity") or {}).get(entity_id)
        if not drive:
            raise CompileError("DRIVE_BINDINGS_REQUIRED", f"{entity_id} has no per-entity drive binding")
        radius = drive["model"]["parameters"]["drive"]["wheelRadiusM"]["value"]
        files[f"robots/{entity_id}.urdf"] = render_urdf(entity_id, mine, mine_joints)
        entities.append({"entityId": entity_id, "kind": "amr", "rootLinkId": roots[0], "instanceIds": sorted(instances)})
        wheels += [{"id": f"{entity_id}/left", "entityId": entity_id, "side": "left", "radiusM": radius, "jointId": drive["leftJointId"]},
                   {"id": f"{entity_id}/right", "entityId": entity_id, "side": "right", "radiusM": radius, "jointId": drive["rightJointId"]}]
    w, t = runtime["world"], WALL_THICKNESS_M
    walls = [(0.0, 0.0, t, w["height"]), (w["width"] - t, 0.0, t, w["height"]), (0.0, 0.0, w["width"], t), (0.0, w["height"] - t, w["width"], t)]
    world = {"id": w["id"], "revision": w["revision"], "widthM": w["width"], "heightM": w["height"], "hash": canonical_hash(w),
             "walls": [{"x": x, "y": y, "width": bw, "height": bh} for x, y, bw, bh in walls],
             "fixtures": [{"obstacleId": o["id"], "x": o["x"], "y": o["y"], "width": o["width"], "height": o["height"], "heightM": DEFAULT_FIXTURE_HEIGHT_M} for o in w["obstacles"]]}
    files["scene.json"] = dump(render_compiled_scene(resolved, world, wheels, entities))
    return files


def compile_portable(request, out_dir):
    out = Path(out_dir)
    files = description_files(request["compileInput"])
    for name in files:
        if not all(SAFE_NAME.match(part) and part not in (".", "..") for part in name.split("/")):
            raise CompileError("OUTPUT_NAME_INVALID", name)
    for name, data in files.items():
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(data)
    listed = [{"path": p, "sha256": hashlib.sha256(d).hexdigest(), "bytes": len(d)} for p, d in sorted(files.items())]
    return listed + write_scene(request["scene"], out_dir)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    try:
        listed = compile_portable(json.loads(Path(args.input).read_text()), args.out)
    except (CompileError, ValueError, KeyError) as e:
        print(f"{getattr(e, 'code', type(e).__name__)}: {e}", file=sys.stderr)
        return 1
    print(json.dumps({"files": sorted(listed, key=lambda f: f["path"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
