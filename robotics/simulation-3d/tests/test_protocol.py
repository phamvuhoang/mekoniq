import json

import pytest
from conftest import R, RUN, SEP, FakeEngine, req, step, validators

from webots_worker.protocol import PROTOCOL, WorkerError, parse_line
from webots_worker.session import scene_digest_of
from webots_worker.snapshot import SnapshotError


def created(made):
    session, engines, scene, root = made
    out = session.handle(req("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert out["ok"], out
    return session, engines[0], out["result"]


def test_envelope_with_the_wrong_protocol_is_refused_as_a_protocol_mismatch():
    line = json.dumps({"protocol": "mekoniq-irsim/1", "requestId": "x", "runId": RUN, "expectedTick": 0, "op": "describe", "payload": {}}).encode()
    with pytest.raises(WorkerError) as e:
        parse_line(line, validators()[0])
    assert e.value.code == "PROTOCOL_MISMATCH" and e.value.fatal


def test_create_gives_tick_zero_with_a_primed_engine_and_the_3d_fields(made):
    session, engine, snap = created(made)
    assert snap["tick"] == 0 and snap["simTimeNs"] == "0" and snap["seq"] == "1"
    robot = snap["robots"][0]
    assert robot["pose3d"]["z"] == 0.09 and robot["wheels"] == {"leftRadS": 0.0, "rightRadS": 0.0}
    assert len(robot["scans"]) == 1 and robot["scans"][0]["tick"] == 0 and len(robot["scans"][0]["rangesM"]) == 360  # the priming step makes tick 0 measurable
    assert engine.steps == [{"amr-1": (0.0, 0.0)}] and engine.world.startswith("#VRML_SIM R2025a")
    assert session.state == "created"


def test_step_converts_body_velocity_to_wheel_speeds_and_advances_exactly_one_tick(made):
    session, engine, _ = created(made)
    assert session.handle(req("start"))["ok"]
    out = session.handle(step(0, v=0.5))
    assert out["ok"] and out["tick"] == 1 and out["result"]["simTimeNs"] == "20000000"
    assert engine.steps[-1] == {"amr-1": (pytest.approx(0.5 / R), pytest.approx(0.5 / R))}
    assert len(engine.steps) == 2  # priming + one


def test_scans_are_published_only_on_the_sensor_cadence(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    ticks = []
    for t in range(0, 11):
        out = session.handle(step(t))
        ticks.append((out["tick"], len(out["result"]["robots"][0]["scans"])))
    assert [n for t, n in ticks if t % 5 == 0] == [1, 1] and all(n == 0 for t, n in ticks if t % 5)  # publishEveryTicks 5 -> ticks 5 and 10


def test_step_with_the_wrong_expected_tick_is_refused_and_changes_nothing(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    before = len(engine.steps)
    out = session.handle(step(3))
    assert not out["ok"] and out["error"]["code"] == "TICK_MISMATCH" and session.tick == 0 and len(engine.steps) == before


def test_the_same_request_id_and_payload_returns_the_stored_receipt_without_stepping(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    first = session.handle(step(0, v=0.1, request_id="same"))
    n = len(engine.steps)
    assert session.handle(step(0, v=0.1, request_id="same")) == first and len(engine.steps) == n
    conflict = session.handle(step(0, v=0.2, request_id="same"))
    assert not conflict["ok"] and conflict["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_every_robot_needs_a_velocity_and_limits_are_enforced(made):
    session, engine, scene = created(made)[0], made[1][0], made[2]
    session.handle(req("start"))
    missing = session.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": []}, tick=0))
    assert missing["error"]["code"] == "VELOCITY_INCOMPLETE"
    too_fast = session.handle(step(0, v=5.0))
    assert too_fast["error"]["code"] == "VELOCITY_LIMIT"
    assert session.tick == 0


def test_actor_updates_are_refused_this_plant_has_no_scripted_actors(made):
    session = created(made)[0]
    session.handle(req("start"))
    out = session.handle(req("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}], "actorUpdates": [{"actorId": "a", "poseMap": [0, 0, 0]}]}, tick=0))
    assert out["error"]["code"] == "ACTOR_UNKNOWN"


def test_an_engine_clock_that_drifts_fails_the_run_closed(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    engine.drift = 0.005
    out = session.handle(step(0))
    assert not out["ok"] and out["error"]["code"] == "CLOCK_DRIFT" and session.state == "failed" and engine.closed


def test_a_lost_engine_ends_the_run_and_nothing_is_retried(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    engine.fail_next = WorkerError("ENGINE_LOST", "webots exited", fatal=True)
    out = session.handle(step(0))
    assert not out["ok"] and out["error"]["code"] == "ENGINE_LOST" and session.state == "failed" and engine.closed
    again = session.handle(step(0))
    assert again["error"]["code"] == "INVALID_STATE"


def test_non_finite_pose_is_plant_unstable_and_fatal(made):
    session, engine, _ = created(made)
    session.handle(req("start"))
    orig = engine.step

    def nan_step(commands, lidar):
        out = orig(commands, lidar)
        out["robots"]["amr-1"]["position"][0] = float("nan")
        return out

    engine.step = nan_step
    out = session.handle(step(0))
    assert out["error"]["code"] == "PLANT_UNSTABLE" and session.state == "failed"


def test_get_state_returns_the_last_snapshot_plus_the_model_read_back_without_stepping(made):
    session, engine, _ = created(made)
    n = len(engine.steps)
    out = session.handle(req("getState"))
    assert out["ok"] and out["result"]["tick"] == 0 and out["result"]["model"]["robots"][0]["wheelSeparationM"] == SEP and len(engine.steps) == n


def test_stop_ends_the_engine_once(made):
    session, engine, _ = created(made)
    assert session.handle(req("stop", {"reason": "done"}))["result"] == {"state": "stopped"}
    assert engine.closed
    assert session.handle(req("stop", {"reason": "again"}))["ok"]


def test_describe_reports_the_host_engine_without_starting_it(made):
    session = made[0]
    out = session.handle(req("describe"))
    assert out["ok"] and out["result"]["lockDigest"] == "b" * 64 and out["result"]["ops"] and out["result"]["packageVersion"]


def test_create_refuses_foreign_scenes_digests_files_and_fixtures(bundle):
    root, scene = bundle

    def attempt(**over):
        from conftest import FakeEngine as E
        from webots_worker.session import WorkerSession

        s = WorkerSession(run_id=RUN, bundle_root=root, lock_digest="b" * 64, expected_scene_digest=over.pop("bound", scene["sceneDigest"]), engine_factory=lambda w, c: E(w, c), webots_home="/x")
        return s.handle(req("create", {"sceneRef": over.pop("ref", "navigation-scene.json"), "seed": 1}))["error"]["code"]

    assert attempt(bound="c" * 64) == "SCENE_DIGEST_MISMATCH"
    assert attempt(ref="../x.json") == "SCENE_PATH_REJECTED"
    (root / "physical-model" / "amr-1.json").write_text("{}")
    assert attempt() == "SCENE_FILE_MISMATCH"
    (root / "physical-model" / "amr-1.json").write_bytes(b"")
    (root / "scenario-fixture.json").write_text("{}")
    assert attempt() in ("FIXTURE_UNSUPPORTED", "SCENE_FILE_MISMATCH")
    irsim = json.loads((root / "navigation-scene.json").read_text())
    irsim["engine"] = {"id": "irsim_2d", "version": "2.12.0", "collisionMode": "stop"}
    irsim.pop("world3d")
    irsim["sceneDigest"] = scene_digest_of(irsim)
    (root / "navigation-scene.json").write_text(json.dumps(irsim))
    assert attempt(bound=irsim["sceneDigest"]) == "SCENE_UNSUPPORTED"
