import json
import math

import pytest

from irsim_worker.scene import engine_name
from irsim_worker.session import WorkerSession
from irsim_testkit import with_files

HIGH_ACCE = lambda text: text.replace("- 0.5\n  - 1.5", "- 100.0\n  - 100.0")


def new_session(tmp_path, scene, **kw):
    s = WorkerSession(run_id="run", bundle_root=tmp_path, lock_digest="1" * 64, expected_scene_digest=scene["sceneDigest"] if kw.pop("bind", True) else None)
    return s


class Call:
    def __init__(self, session):
        self.s, self.n = session, 0

    def __call__(self, op, payload=None, tick=None, rid=None):
        self.n += 1
        return self.s.handle({"protocol": "mekoniq-irsim/1", "requestId": rid or f"q{self.n}", "runId": "run", "expectedTick": self.s.tick if tick is None else tick, "op": op, "payload": payload or {}})


def step(call, scene, v=(0.0, 0.0), single=False, robots=None, **kw):
    ids = robots or [r["robotId"] for r in scene["robots"]]
    vel = [{"robotId": r, "vMps": v[0] if i == 0 else 0.0, "omegaRadps": v[1]} for i, r in enumerate(ids)] if not isinstance(v, list) else v
    return call("step", {"targetTick": call.s.tick + 1, "velocities": vel, "actorUpdates": [], **({"singleStep": True} if single else {})}, **kw)


@pytest.fixture
def run(tmp_path, serve):
    scene = with_files(serve, tmp_path)
    call = Call(new_session(tmp_path, scene))
    assert call("describe")["ok"]
    r = call("create", {"sceneRef": "navigation-scene.json", "seed": 7})
    assert r["ok"], r
    assert call("start")["ok"]
    yield call, scene
    call("stop", {"reason": "test"})


def test_lifecycle_and_a_tick_zero_snapshot_with_scans(run):
    call, scene = run
    snap = call("getState")["result"]
    assert (snap["tick"], snap["simTimeNs"], snap["seq"], snap["sceneDigest"]) == (0, "0", "1", scene["sceneDigest"])
    assert len(snap["robots"][0]["scans"][0]["rangesM"]) == 360
    assert call.s.state == "running" and call.s.tick == 0  # start does not move the clock
    json.dumps(snap, allow_nan=False)


def test_step_advances_exactly_one_tick_with_the_engine_acceleration_limit_applied(run):
    call, scene = run
    x0 = scene["robots"][0]["initialPoseMap"][0]
    for k in range(10):
        r = step(call, scene, (0.2, 0.0))
        assert r["ok"] and r["tick"] == k + 1
    snap = r["result"]
    # from rest with a = 0.5 m/s^2 the speed after tick k is 0.01 k: displacement = 0.02 * 0.01 * (1 + ... + 10)
    assert snap["robots"][0]["poseDriveMap"][0] - x0 == pytest.approx(0.02 * 0.01 * 55, abs=1e-9)
    assert snap["simTimeNs"] == "200000000" and snap["tick"] == 10 and snap["seq"] == "11"
    assert snap["robots"][0]["bodyVelocity"][0] == pytest.approx(0.1, abs=1e-9)


def test_two_robots_with_different_ids_and_models_move_independently(tmp_path, two):
    scene = with_files(two, tmp_path, HIGH_ACCE)
    call = Call(new_session(tmp_path, scene))
    assert call("create", {"sceneRef": "navigation-scene.json", "seed": 3})["ok"] and call("start")["ok"]
    start = {r["robotId"]: r["poseDriveMap"][0] for r in call("getState")["result"]["robots"]}
    vel = [{"robotId": "amr-1", "vMps": 0.2, "omegaRadps": 0.0}, {"robotId": "amr-2", "vMps": 0.1, "omegaRadps": 0.0}]
    for _ in range(10):
        out = call("step", {"targetTick": call.s.tick + 1, "velocities": vel, "actorUpdates": []})
        assert out["ok"], out
    moved = {r["robotId"]: r["poseDriveMap"][0] - start[r["robotId"]] for r in out["result"]["robots"]}
    assert moved["amr-1"] == pytest.approx(0.04, abs=1e-9) and moved["amr-2"] == pytest.approx(0.02, abs=1e-9)  # not swapped, not shared
    assert call("stop")["ok"]


def test_ir09_get_state_does_not_advance_pause_blocks_steps_and_resume_continues(run):
    call, scene = run
    step(call, scene, (0.1, 0.0))
    before = call("getState")["result"]
    for _ in range(3):
        assert call("getState")["result"] == before
    assert call.s.tick == 1
    assert call("pause")["result"] == {"state": "paused"}
    refused = step(call, scene, (0.1, 0.0))
    assert not refused["ok"] and refused["error"]["code"] == "INVALID_STATE" and call.s.tick == 1
    single = step(call, scene, (0.1, 0.0), single=True)
    assert single["ok"] and call.s.state == "paused" and call.s.tick == 2  # one explicit tick, still paused
    assert call("resume")["result"] == {"state": "running"}
    assert step(call, scene, (0.1, 0.0))["tick"] == 3
    bad = step(call, scene, single=True)  # singleStep only while paused
    assert not bad["ok"] and bad["error"]["code"] == "INVALID_STATE"


def test_idempotent_repeat_returns_the_same_receipt_and_does_not_step_twice(run):
    call, scene = run
    payload = {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.1, "omegaRadps": 0.0}], "actorUpdates": []}
    first = call("step", payload, rid="same", tick=0)
    again = call("step", payload, rid="same", tick=0)  # a retry carries exactly what it first sent
    assert first["ok"] and again == first and call.s.tick == 1
    conflict = call("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.2, "omegaRadps": 0.0}], "actorUpdates": []}, rid="same", tick=0)
    assert not conflict["ok"] and conflict["error"]["code"] == "IDEMPOTENCY_CONFLICT" and call.s.tick == 1
    # review2 #6: the refused request must not replace the evidence of the applied one
    assert call("step", payload, rid="same", tick=0) == first


def test_wrong_ticks_missing_robots_limits_and_actors_are_refused_without_effect(run):
    call, scene = run
    assert call("step", {"targetTick": 5, "velocities": [], "actorUpdates": []})["error"]["code"] == "TICK_MISMATCH"
    assert call("step", {"targetTick": 1, "velocities": [], "actorUpdates": []})["error"]["code"] == "VELOCITY_INCOMPLETE"
    over = call("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 3.0, "omegaRadps": 0.0}], "actorUpdates": []})
    assert over["error"]["code"] == "VELOCITY_LIMIT"
    assert call("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}], "actorUpdates": [{"actorId": "guest", "poseMap": [1, 1, 0]}]})["error"]["code"] == "ACTOR_UNKNOWN"
    assert call("getState", tick=9)["error"]["code"] == "TICK_MISMATCH"
    assert call.s.tick == 0 and call.s.state == "running"


def test_create_checks_the_scene_digest_files_and_paths(tmp_path, serve):
    scene = with_files(serve, tmp_path)
    for rel, code in (("../navigation-scene.json", "SCENE_PATH_REJECTED"), ("/etc/passwd", "SCENE_PATH_REJECTED"), ("missing.json", "SCENE_PATH_REJECTED")):
        s = Call(new_session(tmp_path, scene))
        assert s("create", {"sceneRef": rel, "seed": 1})["error"]["code"] == code
    wrong = WorkerSession(run_id="run", bundle_root=tmp_path, lock_digest="1" * 64, expected_scene_digest="f" * 64)
    assert Call(wrong)("create", {"sceneRef": "navigation-scene.json", "seed": 1})["error"]["code"] == "SCENE_DIGEST_MISMATCH"
    (tmp_path / "irsim/world.yaml").write_text("tampered: true\n")
    assert Call(new_session(tmp_path, scene))("create", {"sceneRef": "navigation-scene.json", "seed": 1})["error"]["code"] == "SCENE_FILE_MISMATCH"


def test_a_stopped_run_is_closed_and_a_foreign_run_id_is_fatal(run):
    call, scene = run
    assert call("stop", {"reason": "done"})["result"] == {"state": "stopped"}
    assert call("stop", {"reason": "again"})["result"] == {"state": "stopped"}
    assert call("getState")["ok"]
    assert call("start")["error"]["code"] == "INVALID_STATE"
    other = call.s.handle({"protocol": "mekoniq-irsim/1", "requestId": "x", "runId": "other", "expectedTick": 0, "op": "describe", "payload": {}})
    assert not other["ok"] and call.s.state == "failed"


def test_ir08_same_seed_and_inputs_repeat_exactly_and_a_noisy_sensor_depends_on_the_seed(tmp_path, serve):
    noisy = json.loads(json.dumps(serve))
    noisy["robots"][0]["model"]["sensors"][0]["noise"] = {"distribution": "gaussian", "stddevM": 0.01, "seed": 1}
    scene = with_files(noisy, tmp_path, HIGH_ACCE)

    def trace(seed):
        call = Call(new_session(tmp_path, scene))
        assert call("create", {"sceneRef": "navigation-scene.json", "seed": seed})["ok"] and call("start")["ok"]
        frames = []
        for _ in range(5):
            frames.append(step(call, scene, (0.3, 0.1))["result"])
        call("stop")
        return frames

    a, b, c = trace(11), trace(11), trace(12)
    for x, y in zip(a, b):
        assert x["robots"][0]["poseDriveMap"] == y["robots"][0]["poseDriveMap"]
        assert x["robots"][0]["scans"][0]["rangesM"] == y["robots"][0]["scans"][0]["rangesM"]
    assert a[-1]["robots"][0]["scans"][0]["rangesM"] != c[-1]["robots"][0]["scans"][0]["rangesM"]  # the seed reaches the sensor noise
    assert a[-1]["robots"][0]["poseDriveMap"] == c[-1]["robots"][0]["poseDriveMap"]  # and not the kinematics
