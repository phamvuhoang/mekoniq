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
