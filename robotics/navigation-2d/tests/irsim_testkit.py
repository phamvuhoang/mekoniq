"""Shared helpers of the navigation-2d tests (a unique module name: robotics/simulation/tests has its own `tests` package and conftest)."""
import json
import pathlib

from irsim_worker.scene import write_scene

FIX = pathlib.Path(__file__).parents[1] / "fixtures" / "serve-demo-v1"
SCHEMAS = pathlib.Path(__file__).parents[3] / "packages" / "contracts" / "schemas"


def with_files(scene, tmp_path, patch_yaml=None):
    """Writes the scene's irsim files under tmp_path, lets a test edit the YAML text before hashing (acceleration limits), and returns the scene with matching file refs and digest."""
    import hashlib
    import rfc8785
    scene = json.loads(json.dumps(scene))
    refs = write_scene(scene, tmp_path)
    if patch_yaml:
        yaml_path = tmp_path / "irsim/world.yaml"
        yaml_path.write_text(patch_yaml(yaml_path.read_text()))
        refs = [{**r, "sha256": hashlib.sha256((tmp_path / r["path"]).read_bytes()).hexdigest(), "bytes": (tmp_path / r["path"]).stat().st_size} for r in refs]
    scene["files"] = refs
    scene["sceneDigest"] = hashlib.sha256(rfc8785.dumps({k: v for k, v in scene.items() if k != "sceneDigest"})).hexdigest()
    (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))
    return scene
