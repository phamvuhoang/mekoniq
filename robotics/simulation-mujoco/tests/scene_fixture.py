"""Test helper (M03, reused by M04): an ArmCellSceneV1 built from the xarm6-g2-v1 fixture with the arm base at the map origin (identity baseInMap), so map frame = base frame.

The TypeScript scene builder (M06) is the real producer; this helper only mirrors its rules for the cell: supports and grasp frames from cell-layout.json, cups of
cell-layout.cup (massKg = empty + drink), homeRad = programs.json `home`, four allowed contacts, frictions from physics.json. `supportFriction` 1.0 is the value the
spike's stand and tray had in effect (MuJoCo's default sliding friction, docs/research/2026-11-mujoco-arm-spike.md, "Ma sát cốc"); it is test data here, not a decision."""
import hashlib
import json
from pathlib import Path

import rfc8785

FX = Path(__file__).resolve().parents[1] / "fixtures" / "xarm6-g2-v1"
BLOBS = FX / "blobs"
SCHEMAS = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"
SUPPORT_FRICTION = 1.0


def load(name):
    return json.loads((FX / name).read_text())


def scene_digest_of(scene):
    return hashlib.sha256(rfc8785.dumps({k: v for k, v in scene.items() if k != "sceneDigest"})).hexdigest()


def cell_scene(prop_ids=("cup-1",), statics=(), engine_seed=0):
    """A valid ArmCellSceneV1 dict for the given cup ids (arm base at the map origin)."""
    layout, physics, programs, manifest = load("cell-layout.json"), load("physics.json"), load("programs.json"), load("manifest.json")
    cup, grasp = layout["cup"], layout["grasp"]
    scene = {
        "schemaVersion": 1,
        "sceneDigest": "0" * 64,
        "arm": {"armId": "xarm-1", "modelId": "xarm6-g2-v1", "modelRevision": manifest["modelRevision"],
                "baseInMap": {"position": [0, 0, 0], "quaternionXyzw": [0, 0, 0, 1]}, "homeRad": programs["programs"]["waypoints"]["home"]},
        "statics": [dict(s) for s in statics],
        "supports": [{"id": "nozzle-stand", **layout["nozzleStand"]}, {"id": "tray", **layout["tray"]}],
        "props": [{"propId": p, "kind": "cup", "radiusM": cup["radiusM"], "heightM": cup["heightM"], "massKg": cup["emptyMassKg"] + cup["drinkMassKg"], "provenance": "assumed"} for p in prop_ids],
        "graspFrames": {"pick": grasp["pick"], "place": grasp["place"]},
        "allowedContacts": [{"a": a, "b": b} for a in ("gripper", "held_prop") for b in ("nozzle-stand", "tray")],
        "world3d": {"padFriction": physics["contact"]["padFriction"][0], "propFriction": physics["contact"]["propFriction"][0], "supportFriction": SUPPORT_FRICTION, "provenance": "assumed"},
        "engine": {"id": "mujoco_3d", "timestepMs": 2, "substeps": 10},
        "engineSeed": engine_seed,
    }
    scene["sceneDigest"] = scene_digest_of(scene)
    return scene
