"""The session on the real Webots R2025a (skipped, with the reason, where it is not installed at /Applications/Webots.app)."""
import math
import subprocess
from pathlib import Path

import pytest
from conftest import R, SEP, bundle, req, step  # noqa: F401  (bundle is a fixture)

from webots_worker.session import WorkerSession

HOME = "/Applications/Webots.app"
pytestmark = pytest.mark.skipif(not (Path(HOME) / "Contents/MacOS/webots").exists(), reason="Webots R2025a is not installed")


def running_processes():
    out = subprocess.run(["pgrep", "-f", r"^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller)\.py"], capture_output=True, text=True).stdout
    return [p for p in out.split() if p]


@pytest.fixture
def live(bundle, tmp_path, monkeypatch):
    root, scene = bundle
    run_dir = tmp_path / "run"
    session = WorkerSession(run_id="run-1", bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], webots_home=HOME, run_directory=str(run_dir))
    assert not running_processes(), "another Webots is running; the test refuses to share the machine with it"
    yield session
    session.end()
    assert running_processes() == []


def test_the_real_engine_runs_the_protocol_end_to_end(live):
    out = live.handle(req("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert out["ok"], out
    snap = out["result"]
    r0 = snap["robots"][0]
    assert snap["tick"] == 0 and r0["scans"][0]["tick"] == 0 and len(r0["scans"][0]["rangesM"]) == 360
    assert abs(r0["pose3d"]["roll"]) <= 0.02 and abs(r0["pose3d"]["pitch"]) <= 0.02  # it stands on its two wheels and two casters
    live.handle(req("start"))
    last = None
    for t in range(100):
        out = live.handle(step(t, v=0.3))
        assert out["ok"], out
        last = out["result"]
        assert last["tick"] == t + 1 and last["simTimeNs"] == str((t + 1) * 20_000_000)
    r = last["robots"][0]
    assert r["poseDriveMap"][0] - r0["poseDriveMap"][0] == pytest.approx(0.6, abs=0.05)  # 0.3 m/s for 2 s
    assert abs(r["poseDriveMap"][1] - r0["poseDriveMap"][1]) <= 0.02
    assert r["wheels"]["leftRadS"] == pytest.approx(0.3 / R, rel=0.15) and r["collisionIds"] == []
    assert abs(r["pose3d"]["pitch"]) <= 0.1
    state = live.handle(req("getState", tick=100))
    assert state["ok"]
    model = state["result"]["model"]["robots"][0]
    assert model["wheelSeparationM"] == pytest.approx(SEP, abs=1e-4) and model["wheelRadiusM"] == pytest.approx(R, abs=1e-4)
    assert len(model["wheelAxes"]) == 2 and all(a == pytest.approx([0, 1, 0]) for a in model["wheelAxes"])
    assert live.handle(req("stop", {"reason": "done"}, tick=100))["ok"]
