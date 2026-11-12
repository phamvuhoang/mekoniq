"""Review Focus #1: the worker never attaches to a Webots it did not start. It picks a port with no listener and no leftover Webots state, or it refuses."""
import socket

import pytest

from webots_worker import engine
from webots_worker.protocol import WorkerError


class Sequence:
    def __init__(self, ports):
        self.ports = list(ports)

    def randint(self, lo, hi):
        return self.ports.pop(0)


def test_a_port_with_leftover_webots_state_or_a_listener_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "_tmp_dir", lambda port: tmp_path / str(port))
    (tmp_path / "20001").mkdir()  # what a killed Webots leaves behind: a new controller could meet a dead world here
    busy = socket.socket()
    busy.bind(("127.0.0.1", 0))
    listening = busy.getsockname()[1]  # a foreign process holds this one
    monkeypatch.setattr(engine.random, "SystemRandom", lambda: Sequence([20001, listening, 20003]))
    try:
        assert engine.free_port() == 20003
    finally:
        busy.close()


def test_with_no_usable_port_the_worker_refuses_and_starts_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "_tmp_dir", lambda port: tmp_path)  # every port looks taken
    monkeypatch.setattr(engine.subprocess, "Popen", lambda *a, **k: pytest.fail("a process was started"))
    with pytest.raises(WorkerError) as e:
        engine.free_port()
    assert e.value.code == "WEBOTS_PORT_IN_USE" and e.value.fatal


def test_a_missing_webots_is_refused_by_name(tmp_path):
    with pytest.raises(WorkerError) as e:
        engine.host_engine(str(tmp_path / "Webots.app"))
    assert e.value.code == "WEBOTS_NOT_INSTALLED"


def test_a_webots_that_is_not_the_pinned_version_is_refused_before_it_starts(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "host_engine", lambda home: ("R2025b", "a" * 64))
    monkeypatch.setattr(engine, "webots_executable", lambda home: tmp_path / "webots")
    monkeypatch.setattr(engine.subprocess, "Popen", lambda *a, **k: pytest.fail("a process was started"))
    e = engine.WebotsEngine("world", {"webotsHome": str(tmp_path), "runDirectory": str(tmp_path / "run"), "robots": []})
    with pytest.raises(WorkerError) as err:
        e.start()
    assert err.value.code == "WEBOTS_VERSION_MISMATCH" and err.value.fatal


def test_watch_mode_renders_at_real_time_and_the_default_stays_headless_and_fast():
    default = engine.webots_argv("/w", 1, "/x.wbt")
    assert "--mode=fast" in default and "--minimize" in default and "--mode=realtime" not in default
    watch = engine.webots_argv("/w", 1, "/x.wbt", watch=True)
    assert "--mode=realtime" in watch and "--minimize" not in watch and "--mode=fast" not in watch and "--batch" in watch


def test_watch_mode_adds_the_light_the_compiled_world_lacks():
    assert "DirectionalLight" in engine.WATCH_LIGHTS and "Background" in engine.WATCH_LIGHTS


def test_watch_view_looks_down_at_the_arm_from_its_front_and_other_worlds_only_get_light():
    import math
    world = "WorldInfo {\n}\nViewpoint {\n  orientation 0 0 1 3.1416\n  position 5 1 2\n}\nDEF ARM_a Robot {\n  translation 2.0 1.0 1.2\n}\n"
    out = engine.watch_world(world)
    assert "fieldOfView" in out and out.endswith(engine.WATCH_LIGHTS) and out.count("Viewpoint") == 1
    v = out.split("Viewpoint {")[1].split("}")[0].split()
    ax, ay, az, ang = (float(v[v.index("orientation") + i]) for i in (1, 2, 3, 4))
    pos = [float(v[v.index("position") + i]) for i in (1, 2, 3)]
    d = (2 * (ax * 1) * ax - 1, 2 * (ax * 1) * ay, 2 * (ax * 1) * az)  # the camera's +x through a half turn: Rodrigues with angle pi
    assert abs(ang - math.pi) < 1e-9 and d[0] < 0 and d[2] < 0  # forward is -x and tilted down
    assert pos[0] > 2.0 and pos[2] > 1.2  # in front of and above the base
    assert engine.watch_world("WorldInfo {\n}\nViewpoint {\n  position 1 1 1\n}\n").startswith("WorldInfo")
