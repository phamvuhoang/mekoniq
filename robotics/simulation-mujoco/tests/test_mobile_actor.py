"""V10: a scripted person is a kinematic box (actor-proxy-v1) that the LiDAR sees and that a robot contact reports as an unexpected collision. Actors come only from a
scenario-fixture.json the parent bound by digest; an actor the fixture did not declare is refused before anything changes."""
import hashlib
import json
import math
import itertools
import shutil
from pathlib import Path

import pytest

from mujoco_worker.compile import CompileError
from mujoco_worker.compile_mobile import compile_mobile
from mujoco_worker.protocol import PROTOCOL
from mujoco_worker.session import WorkerSession

FX = Path(__file__).resolve().parents[1] / "fixtures" / "serve-payload-v1"
RADIUS = 0.25


COUNT = itertools.count()


def request(op, payload=None, tick=0):
    return {"protocol": PROTOCOL, "requestId": f"{op}-{tick}-{next(COUNT)}", "runId": "actor-1", "expectedTick": tick, "op": op, "payload": payload or {}}


def start_pose(tmp_path):
    return json.loads((tmp_path / "navigation-scene.json").read_text())["robots"][0]["initialPoseMap"]


def session(tmp_path, actors=None, bind=True, sha=None):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    expected = None
    if actors is not None:
        raw = json.dumps({"schemaVersion": 1, "scenarioId": "t", "fixtureHash": "0" * 64, "actors": actors}).encode()
        (tmp_path / "scenario-fixture.json").write_bytes(raw)
        expected = sha or (hashlib.sha256(raw).hexdigest() if bind else None)
    return WorkerSession(run_id="actor-1", bundle_root=tmp_path, lock_digest="b" * 64, expected_fixture_sha256=expected)


def ahead(tmp_path, distance):
    x, y, yaw = start_pose(tmp_path)
    return [x + distance * math.cos(yaw), y + distance * math.sin(yaw), 0]


def drive(s, tick, v, actor_pose=None, actor="person-1"):
    updates = [{"actorId": actor, "poseMap": actor_pose}] if actor_pose else []
    return s.handle(request("step", {"targetTick": tick + 1, "velocities": [{"robotId": "amr-1", "vMps": v, "omegaRadps": 0}], "actorUpdates": updates}, tick))


def started(s):
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]


def centre_range(response):
    scans = response["result"]["robots"][0].get("scans")
    if not scans:
        return None
    sc = scans[0]
    i = min(range(len(sc["rangesM"])), key=lambda k: abs(sc["angleMinRad"] + k * sc["angleIncrementRad"]))
    return sc["rangesM"][i]


def test_a_declared_actor_is_seen_by_the_lidar_straight_ahead(tmp_path):
    base = tmp_path / "base"
    s0 = session(base)
    started(s0)
    clear = None
    for t in range(0, 60):
        r = drive(s0, t, 0.0)
        clear = centre_range(r) if centre_range(r) is not None or clear is None else clear
    with_actor = tmp_path / "with"
    shutil.copytree(FX, with_actor, dirs_exist_ok=True)
    pose = ahead(with_actor, 1.5)
    s1 = session(with_actor, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": pose}])
    started(s1)
    seen = None
    for t in range(0, 60):
        r = drive(s1, t, 0.0, pose)
        assert r["ok"], r
        seen = centre_range(r) if centre_range(r) is not None or seen is None else seen
    assert seen is not None and 1.0 < seen < 1.6, seen      # the near face of the box: about 1.5 - 0.25 from the sensor
    assert clear is None or clear > seen + 0.3               # without the actor the beam goes on to something farther or returns nothing


def test_robot_proxy_contact_is_reported_as_an_unexpected_collision(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    pose = ahead(tmp_path, 0.7)
    s = session(tmp_path, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": pose}])
    started(s)
    hit = None
    for t in range(0, 150):
        r = drive(s, t, 0.3, pose)
        assert r["ok"], r
        if "person-1" in r["result"]["robots"][0]["collisionIds"]:
            hit = r
            break
    assert hit is not None
    pair = [c for c in hit["result"]["physics"]["contacts"] if "actor/person-1" in (c["a"], c["b"])]
    assert pair and not any(c["expected"] for c in pair)


def test_actor_follows_its_update_each_tick(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    pose = ahead(tmp_path, 3)
    s = session(tmp_path, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": pose}])
    started(s)
    moved = [pose[0] + 0.5, pose[1] + 0.5, 0]
    assert drive(s, 0, 0.0, moved)["ok"]
    body = s.engine.model.body(s.engine.names["actors"]["person-1"]).id
    mid = int(s.engine.model.body_mocapid[body])
    assert list(s.engine.data.mocap_pos[mid][:2]) == pytest.approx(moved[:2])


def test_an_update_for_an_undeclared_actor_is_refused_before_anything_changes(tmp_path):
    s = session(tmp_path)
    started(s)
    before = (s.tick, s.engine.data.time)
    r = drive(s, 0, 0.0, [1.0, 1.0, 0], actor="ghost")
    assert not r["ok"] and r["error"]["code"] == "ACTOR_UPDATE_MISMATCH"
    assert (s.tick, s.engine.data.time) == before
    assert drive(s, 0, 0.0)["ok"]   # the same tick, correctly asked, still goes


def test_a_declared_actor_must_be_updated_every_tick_and_only_declared_ones(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    pose = ahead(tmp_path, 3)
    s = session(tmp_path, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": pose}])
    started(s)
    before = (s.tick, s.engine.data.time)
    assert drive(s, 0, 0.0)["error"]["code"] == "ACTOR_UPDATE_MISMATCH"                      # no update for the declared actor
    assert drive(s, 0, 0.0, [1, 1, 0], actor="ghost")["error"]["code"] == "ACTOR_UPDATE_MISMATCH"
    assert drive(s, 0, 0.0, [1e9, 1, 0])["error"]["code"] == "ACTOR_UPDATE_MISMATCH"
    assert (s.tick, s.engine.data.time) == before
    assert drive(s, 0, 0.0, pose)["ok"]


def test_a_fixture_in_the_bundle_that_the_parent_did_not_bind_is_never_read(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    s = session(tmp_path, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": ahead(tmp_path, 3)}], bind=False)
    r = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert not r["ok"] and r["error"]["code"] == "FIXTURE_UNBOUND"


def test_a_fixture_that_does_not_match_the_bound_digest_is_refused(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    s = session(tmp_path, [{"id": "person-1", "radiusM": RADIUS, "initialPoseMap": ahead(tmp_path, 3)}], sha="1" * 64)
    r = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert not r["ok"] and r["error"]["code"] == "FIXTURE_MISMATCH"


def test_an_actor_whose_id_is_a_robot_or_a_solid_is_refused(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    s = session(tmp_path, [{"id": "amr-1", "radiusM": RADIUS, "initialPoseMap": ahead(tmp_path, 3)}])
    r = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert not r["ok"] and r["error"]["code"] == "FIXTURE_INVALID"


def test_the_scene_itself_still_may_not_declare_actors():
    args = [json.loads((FX / f"{n}.json").read_text()) for n in ("navigation-scene",)]
    scene = args[0]
    scene["actors"] = [{"id": "p", "radiusM": .2, "initialPoseMap": [1, 1, 0]}] if scene["actors"] == [] else scene["actors"]
    with pytest.raises(CompileError, match="MODEL_UNSUPPORTED"):
        compile_mobile(scene, {"amr-1": json.loads((FX / "physical-model-amr-1.json").read_text())}, json.loads((FX / "cup-center.json").read_text()), json.loads((FX / "drive-contact-profile.json").read_text()))
