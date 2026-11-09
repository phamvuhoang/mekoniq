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


# ---- C02: scripted actors from the run's scenario-fixture file ----
def actor_session(tmp_path, scene, actors, sha=None, bind=True):
    import hashlib
    body = json.dumps({"schemaVersion": 1, "scenarioId": "IR-FD03", "fixtureHash": "0" * 64, "actors": actors}).encode()
    (tmp_path / "scenario-fixture.json").write_bytes(body)
    s = WorkerSession(run_id="run", bundle_root=tmp_path, lock_digest="1" * 64, expected_scene_digest=scene["sceneDigest"], expected_fixture_sha256=(sha or hashlib.sha256(body).hexdigest()) if bind else None)
    call = Call(s)
    r = call("create", {"sceneRef": "navigation-scene.json", "seed": 7})
    return call, r


def test_c02_actors_are_placed_each_step_seen_by_lidar_and_named_by_id_in_contacts(tmp_path, serve):
    scene = with_files(serve, tmp_path)
    call, r = actor_session(tmp_path, scene, [{"id": "person-1", "radiusM": 0.25, "initialPoseMap": [6.0, 1.5, 0.0]}])
    assert r["ok"], r
    assert call("start")["ok"]
    beams = lambda snap: snap["robots"][0]["scans"][0]
    near = lambda snap: min(v for v in beams(snap)["rangesM"] if v is not None)
    vel = [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}]
    far = call("step", {"targetTick": 1, "velocities": vel, "actorUpdates": [{"actorId": "person-1", "poseMap": [6.0, 1.5, 0.0]}]})["result"]
    close = call("step", {"targetTick": 2, "velocities": vel, "actorUpdates": [{"actorId": "person-1", "poseMap": [3.0, 1.5, 0.0]}]})["result"]
    # the robot (drive frame at 2, 1.5; LiDAR 0.22 m ahead) sees the person 1 m ahead now, not where it stood a step ago: placed before the step, exactly
    def ahead(snap):  # the beam pointing along the robot's heading (+x)
        sc = beams(snap)
        return sc["rangesM"][round(-sc["angleMinRad"] / sc["angleIncrementRad"]) % len(sc["rangesM"])]
    assert ahead(close) == pytest.approx(3.0 - 0.25 - 2.22, abs=0.02) and near(close) == pytest.approx(ahead(close), abs=0.01)
    assert ahead(far) == pytest.approx(6.0 - 0.25 - 2.22, abs=0.02)
    assert call.s.actor_objects["person-1"].state[:2, 0].tolist() == [3.0, 1.5]
    touch = call("step", {"targetTick": 3, "velocities": vel, "actorUpdates": [{"actorId": "person-1", "poseMap": [2.4, 1.5, 0.0]}]})["result"]
    assert touch["robots"][0]["collisionIds"] == ["person-1"]  # the actor's id, never an engine index
    assert call.s.actor_names == {"person-1": "a_" + __import__("hashlib").sha256(b"person-1").hexdigest()[:16]}


def test_c02_every_actor_every_tick_unknown_or_duplicate_refused_without_effect(tmp_path, serve):
    scene = with_files(serve, tmp_path)
    call, r = actor_session(tmp_path, scene, [{"id": "person-1", "radiusM": 0.25, "initialPoseMap": [6.0, 1.5, 0.0]}])
    assert r["ok"] and call("start")["ok"]
    vel = [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}]
    assert call("step", {"targetTick": 1, "velocities": vel, "actorUpdates": []})["error"]["code"] == "ACTOR_INCOMPLETE"
    assert call("step", {"targetTick": 1, "velocities": vel, "actorUpdates": [{"actorId": "ghost", "poseMap": [1, 1, 0]}]})["error"]["code"] == "ACTOR_UNKNOWN"
    two = [{"actorId": "person-1", "poseMap": [6, 1.5, 0]}, {"actorId": "person-1", "poseMap": [5, 1.5, 0]}]
    assert call("step", {"targetTick": 1, "velocities": vel, "actorUpdates": two})["error"]["code"] == "ACTOR_INCOMPLETE"
    assert call.s.tick == 0 and call.s.state == "running"


def test_c02_fixture_file_is_sha_bound_and_cannot_shadow_a_robot_or_solid(tmp_path, serve):
    scene = with_files(serve, tmp_path)
    _, r = actor_session(tmp_path, scene, [{"id": "person-1", "radiusM": 0.25, "initialPoseMap": [6.0, 1.5, 0.0]}], sha="f" * 64)
    assert r["error"]["code"] == "FIXTURE_MISMATCH"
    _, r = actor_session(tmp_path, scene, [{"id": "person-1", "radiusM": 0.25, "initialPoseMap": [6.0, 1.5, 0.0]}], bind=False)
    assert r["error"]["code"] == "FIXTURE_UNBOUND"  # a file nobody bound is never read
    for bad in ([{"id": "amr-1", "radiusM": 0.25, "initialPoseMap": [6, 1.5, 0]}], [{"id": "table-01", "radiusM": 0.25, "initialPoseMap": [6, 1.5, 0]}],
                [{"id": "p", "radiusM": 0, "initialPoseMap": [6, 1.5, 0]}], [{"id": "p", "radiusM": 0.2, "initialPoseMap": [6, 1.5]}], [{"id": "p", "radiusM": 0.2, "initialPoseMap": [6, 1.5, 0], "behavior": "dash"}]):
        sub = tmp_path / bad[0]["id"] / str(len(bad[0]))
        sub.mkdir(parents=True, exist_ok=True)
        s2 = with_files(serve, sub)
        _, r = actor_session(sub, s2, bad)
        assert r["error"]["code"] == "FIXTURE_INVALID", bad


def test_c02_robot_contacts_name_the_other_robot_and_solids_must_match_the_name_map(tmp_path, two):
    scene = json.loads(json.dumps(two))
    a, b = scene["robots"]
    b["initialPoseMap"] = [a["initialPoseMap"][0] + 0.7, a["initialPoseMap"][1], math.pi]  # face to face, 0.7 m apart
    scene = with_files(scene, tmp_path)
    call = Call(new_session(tmp_path, scene))
    assert call("create", {"sceneRef": "navigation-scene.json", "seed": 1})["ok"] and call("start")["ok"]
    vel = lambda v: [{"robotId": a["robotId"], "vMps": v, "omegaRadps": 0.0}, {"robotId": b["robotId"], "vMps": v, "omegaRadps": 0.0}]
    for k in range(1, 120):
        snap = call("step", {"targetTick": k, "velocities": vel(0.3), "actorUpdates": []})["result"]
        if any(r["collisionIds"] for r in snap["robots"]):
            break
    assert {r["robotId"]: r["collisionIds"] for r in snap["robots"]} == {a["robotId"]: [b["robotId"]], b["robotId"]: [a["robotId"]]}
    # a name map listing more solids than the world has is a broken bundle: refused (fatal), never zipped short
    names = json.loads((tmp_path / "irsim/name-map.json").read_text())
    names["solids"].append("phantom")
    (tmp_path / "irsim/name-map.json").write_text(json.dumps(names, sort_keys=True, separators=(",", ":")) + "\n")
    import hashlib
    import rfc8785
    s3 = json.loads(json.dumps(scene))
    s3["files"] = [{**f, "sha256": hashlib.sha256((tmp_path / f["path"]).read_bytes()).hexdigest(), "bytes": (tmp_path / f["path"]).stat().st_size} for f in s3["files"]]
    s3["sceneDigest"] = hashlib.sha256(rfc8785.dumps({k: v for k, v in s3.items() if k != "sceneDigest"})).hexdigest()
    (tmp_path / "navigation-scene.json").write_text(json.dumps(s3))
    c3 = Call(new_session(tmp_path, s3))
    assert c3("create", {"sceneRef": "navigation-scene.json", "seed": 1})["error"]["code"] == "SCENE_ENGINE_MISMATCH"
