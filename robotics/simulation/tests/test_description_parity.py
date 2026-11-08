"""B01: the pure description helpers extracted from compiler/engineering.py keep the native bytes. The frozen hashes were taken before the extraction."""
import json
import pathlib
import tempfile

import pytest

from compiler.engineering import compile_engineering

HERE = pathlib.Path(__file__).parent
FROZEN = json.loads((HERE / "vectors" / "native-description-frozen.json").read_text())["cases"]
FIXTURES = HERE.parents[2] / "tests" / "fixtures" / "engineering"


def load(case):
    if "/" in case:
        name, key = case.split("/")
        return json.loads((FIXTURES / f"{name}.json").read_text())[key]
    return json.loads((FIXTURES / f"{case}.json").read_text())


@pytest.mark.parametrize("case", sorted(FROZEN))
def test_native_urdf_and_scene_bytes_are_unchanged(case):
    frozen = FROZEN[case]
    if "refused" in frozen:
        with pytest.raises(Exception):
            compile_engineering(load(case), tempfile.mkdtemp())
        return
    out = pathlib.Path(tempfile.mkdtemp())
    files = {f["path"]: f["sha256"] for f in compile_engineering(load(case), out)["files"]}
    assert {k: v for k, v in files.items() if k.startswith("robots/")} == frozen["urdf"]
    assert files["scene.json"] == frozen["scene.json"]


def test_helpers_reproduce_the_native_files_without_any_native_state():
    from compiler import description
    inp = load("compile-radius-100")
    out = pathlib.Path(tempfile.mkdtemp())
    compile_engineering(inp, out)
    resolved = inp["resolved"]
    links = {l["id"]: l for l in resolved["links"]}
    mine = [links[k] for k in sorted(links)]
    joints = sorted(resolved["joints"], key=lambda j: j["id"])
    assert description.render_urdf("amr-1", mine, joints) == (out / "robots" / "amr-1.urdf").read_bytes()
    scene = json.loads((out / "scene.json").read_bytes())
    again = description.render_compiled_scene(resolved, scene["world"], scene["wheelBindings"], scene["entities"])
    assert description.dump(again) == (out / "scene.json").read_bytes()


def test_the_helper_module_imports_neither_ros_nor_the_workers():
    import sys
    import compiler.description  # noqa: F401
    src = (pathlib.Path(compiler.description.__file__)).read_text()
    assert not any(bad in src for bad in ("import rclpy", "import irsim", "subprocess", "linkforge"))
    assert "rclpy" not in sys.modules
