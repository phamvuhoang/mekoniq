"""X04 (R1.1): the arm branch of WorkerSession, against an engine double. The ACK, clock, priming and idempotency rules are the AMR ones."""
import copy
import hashlib
import json
import math
from pathlib import Path

import pytest
import rfc8785
from conftest import RUN, SCHEMAS, FakeEngine, req, step, validators

from webots_worker import engine as engine_module
from webots_worker.compile import engine_seed
from webots_worker.session import WorkerSession, scene_digest_of

ARM = Path(__file__).resolve().parents[1] / "fixtures" / "arm-ref-3d-v1"
HOME = [0, -0.6, 1.2, 0, 0.6, 0]
SEED = 7
TOKEN = {"armId": "arm-1", "sceneRef": "arm-scene.json"}


class FakeArmEngine:
    """Stands in for Webots: the arm tracks its target exactly; a test can override what the next step reports."""

    version, executable_sha256 = "R2025a", "a" * 64

    def __init__(self, world_text, config):
        self.world, self.config, self.time, self.targets, self.closed = world_text, config, 0.0, [], False
        self.next_positions = self.next_velocities = self.contacts = None
        self.last = list(HOME)

    def start(self):
        pass

    def step_arm(self, targets):
        self.time += 0.02
        self.targets.append(list(targets))
        positions = list(self.next_positions if self.next_positions is not None else targets)
        velocities = list(self.next_velocities if self.next_velocities is not None else [(a - b) / 0.02 for a, b in zip(positions, self.last)])
        self.last = positions
        return {"time": self.time, "arm": {"positions": positions, "velocities": velocities}, "armContacts": list(self.contacts or [])}

    def readback(self):
        return {"robots": [], "arm": {"links": [{"name": "link1", "massKg": 8.0}], "joints": [{"name": "J1", "axis": [0.0, 0.0, 1.0], "lower": -2.79, "upper": 2.79}]}}

    def close(self):
        self.closed = True


def make_bundle(root, scene_over=None, component_over=None):
    component = json.loads((ARM / "component.json").read_text())
    if component_over:
        component_over(component)
    (root / "arm-component.json").write_text(json.dumps(component))
    scene = {"schemaVersion": 1, "sceneDigest": "", "arm": {"armId": "arm-1", "modelId": "arm-ref-3d-v1", "modelRevision": hashlib.sha256(rfc8785.dumps(json.loads((ARM / "component.json").read_text()))).hexdigest(),
             "baseInMap": {"position": [2.0, 1.0, 0.75], "quaternionXyzw": [0.0, 0.0, 0.0, 1.0]}, "homeRad": HOME},
             "statics": [{"id": "table-1", "kind": "box", "min": [0.2, -0.3, -0.4], "max": [0.6, 0.3, -0.3]}],
             "world3d": {"floorFriction": 0.8, "provenance": "assumed"}, "engine": {"id": "webots_3d", "basicTimeStepMs": 20}, "engineSeed": SEED}
    if scene_over:
        scene_over(scene)
    scene["sceneDigest"] = scene_digest_of(scene)
    (root / "arm-scene.json").write_text(json.dumps(scene))
    return scene


def session(root, scene, engines):
    def factory(world_text, config):
        engines.append(FakeArmEngine(world_text, config))
        return engines[-1]

    return WorkerSession(run_id=RUN, bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], engine_factory=factory, webots_home="/nonexistent", host_info=lambda: ("R2025a", "a" * 64))


@pytest.fixture
def arm(tmp_path):
    engines = []
    scene = make_bundle(tmp_path)
    s = session(tmp_path, scene, engines)
    return s, engines, scene, tmp_path


def create(seed=SEED, arms=None, ref="arm-scene.json", **kw):
    return req("create", {"sceneRef": ref, "seed": seed, "arms": arms if arms is not None else [TOKEN]}, **kw)


def targets(tick, q, arm_id="arm-1", **kw):
    return req("step", {"targetTick": tick + 1, "velocities": [], "actorUpdates": [], "jointTargets": [{"armId": arm_id, "positionsRad": list(q)}]}, tick=tick, **kw)


def started(arm):
    s, engines, scene, _ = arm
    r = s.handle(create())
    assert r["ok"], r
    assert s.handle(req("start"))["ok"]
    return s, engines[0], r["result"]


def check_schema(response):
    errs = list(validators()[1].iter_errors(response))
    assert not errs, errs[0].message


def test_create_builds_the_arm_world_and_primes_to_tick_zero_at_home(arm):
    s, engines, scene, _ = arm
    r = s.handle(create())
    assert r["ok"] and r["tick"] == 0
    check_schema(r)
    snap = r["result"]
    assert snap["robots"] == [] and snap["tick"] == 0 and snap["simTimeNs"] == "0" and snap["sceneDigest"] == scene["sceneDigest"]
    assert snap["arms"] == [{"armId": "arm-1", "positionsRad": HOME, "velocitiesRadS": [0.0] * 6, "collisionIds": []}]
    e = engines[0]
    assert e.targets == [HOME]  # the priming step holds home
    assert 'DEF ARM_arm_1 Robot {' in e.world and "randomSeed 7" in e.world and "navigation-scene" not in e.world
    assert e.config["arm"]["name"] == "arm-1" and e.config["arm"]["joints"] == 6 and e.config["robots"] == []


def test_step_passes_the_six_targets_and_reports_what_the_engine_returned(arm):
    s, e, _ = started(arm)
    q = [0.1, -0.5, 1.1, 0.0, 0.7, 0.2]
    r = s.handle(targets(0, q))
    assert r["ok"] and r["tick"] == 1
    check_schema(r)
    assert e.targets[-1] == q and len(e.targets) == 2
    assert r["result"]["arms"][0]["positionsRad"] == q and r["result"]["simTimeNs"] == "20000000"
    assert r["result"]["arms"][0]["velocitiesRadS"][0] == pytest.approx(0.1 / 0.02)
    assert abs(e.time - 2 * 0.02) < 1e-12  # engine time = (tick + 1) x 20 ms


def test_the_engine_may_lag_its_target_and_the_snapshot_says_what_it_reached(arm):
    s, e, _ = started(arm)
    e.next_positions = [0.0, -0.6, 1.19, 0.0, 0.6, 0.0]
    r = s.handle(targets(0, [0.0, -0.6, 1.2, 0.0, 0.6, 0.0]))
    assert r["result"]["arms"][0]["positionsRad"] == e.next_positions


def test_a_target_beyond_a_limit_is_refused_without_a_tick_or_an_engine_call(arm):
    s, e, _ = started(arm)
    upper = json.loads((ARM / "component.json").read_text())["joints"][0]["limits"]["upper"]["value"]
    r = s.handle(targets(0, [upper + 1e-6, -0.6, 1.2, 0, 0.6, 0]))
    assert not r["ok"] and r["error"]["code"] == "JOINT_TARGET_OUT_OF_RANGE" and r["tick"] == 0
    assert len(e.targets) == 1 and s.state == "running"
    ok = s.handle(targets(0, [upper, -0.6, 1.2, 0, 0.6, 0]))  # exactly at the limit is allowed, and the run carries on
    assert ok["ok"] and ok["tick"] == 1


def test_a_target_with_the_wrong_shape_is_refused(arm):
    s, e, _ = started(arm)
    for q, arm_id in (([0, -0.6, 1.2, 0, 0.6], "arm-1"), ([0, -0.6, 1.2, 0, 0.6, 0, 0], "arm-1"), (HOME, "arm-2")):
        r = s.handle(targets(0, q, arm_id=arm_id))
        assert not r["ok"] and r["error"]["code"] == "JOINT_TARGET_SHAPE" and r["tick"] == 0, (q, arm_id)
    r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": []}, tick=0))  # an arm run needs its target every tick
    assert not r["ok"] and r["error"]["code"] == "JOINT_TARGET_SHAPE"
    assert len(e.targets) == 1


def test_a_repeated_request_id_gets_the_stored_answer_and_one_engine_step(arm):
    s, e, _ = started(arm)
    first = s.handle(targets(0, HOME, request_id="same"))
    again = s.handle(targets(0, HOME, request_id="same"))
    assert first == again and len(e.targets) == 2
    clash = s.handle(targets(0, [0.1, -0.6, 1.2, 0, 0.6, 0], request_id="same"))
    assert not clash["ok"] and clash["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_a_plant_that_returns_nan_or_leaves_its_limits_is_unstable_and_ends_the_run(arm):
    for bad in ([float("nan"), -0.6, 1.2, 0, 0.6, 0], [3.5, -0.6, 1.2, 0, 0.6, 0]):  # NaN, and J1 beyond its upper limit by more than 0.05 rad
        engines = []
        scene = make_bundle(arm[3])
        s = session(arm[3], scene, engines)
        assert s.handle(create())["ok"] and s.handle(req("start"))["ok"]
        engines[0].next_positions = bad
        r = s.handle(targets(0, HOME))
        assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE", bad
        assert s.state == "failed" and engines[0].closed


def test_a_non_finite_velocity_is_unstable(arm):
    s, e, _ = started(arm)
    e.next_velocities = [0, 0, float("inf"), 0, 0, 0]
    r = s.handle(targets(0, HOME))
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and s.state == "failed"


def test_velocities_do_not_belong_to_an_arm_run_and_joint_targets_do_not_belong_to_an_amr_run(arm, bundle):
    s, e, _ = started(arm)
    r = s.handle(req("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}], "actorUpdates": [], "jointTargets": [{"armId": "arm-1", "positionsRad": HOME}]}, tick=0))
    assert not r["ok"] and r["error"]["code"] == "INVALID_REQUEST" and r["tick"] == 0 and len(e.targets) == 1
    root, scene = bundle
    amr_engines = []
    amr = WorkerSession(run_id=RUN, bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], engine_factory=lambda w, c: amr_engines.append(FakeEngine(w, c)) or amr_engines[-1],
                        webots_home="/nonexistent", host_info=lambda: ("R2025a", "a" * 64))
    assert amr.handle(req("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"] and amr.handle(req("start"))["ok"]
    r = amr.handle(req("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}], "actorUpdates": [], "jointTargets": [{"armId": "arm-1", "positionsRad": HOME}]}, tick=0))
    assert not r["ok"] and r["error"]["code"] == "INVALID_REQUEST" and len(amr_engines[0].steps) == 1
    assert amr.handle(step(0))["ok"]  # the AMR run is untouched


def test_contacts_are_named_by_where_they_are(arm):
    s, e, _ = started(arm)
    # arm base at (2, 1, 0.75) with no rotation; table-1 spans x 0.2..0.6, y -0.3..0.3, z -0.4..-0.3 in the arm frame = world z 0.35..0.45
    e.contacts = [{"solid": "link2", "point": [2.4, 1.0, 0.4]}, {"solid": "link3", "point": [2.4, 1.0, 0.44]}, {"solid": "link3", "point": [2.0, 1.0, 0.0]},
                  {"solid": "link4", "point": [2.0, 1.0, 1.5]}]
    r = s.handle(targets(0, HOME))
    assert r["result"]["arms"][0]["collisionIds"] == ["engine:unattributed", "floor", "table-1"]
    e.contacts = []
    assert s.handle(targets(1, HOME))["result"]["arms"][0]["collisionIds"] == []


def test_get_state_carries_the_arm_as_loaded_and_does_not_step(arm):
    s, e, _ = started(arm)
    r = s.handle(req("getState"))
    assert r["ok"] and r["result"]["model"]["arm"]["joints"][0]["name"] == "J1" and len(e.targets) == 1 and r["tick"] == 0
    check_schema(r)


def test_create_refuses_what_it_cannot_trust(tmp_path):
    def fresh():
        for f in tmp_path.iterdir():
            f.unlink()
        return make_bundle(tmp_path)

    def missing_component():
        scene = fresh()
        (tmp_path / "arm-component.json").unlink()
        return scene

    def other_component():  # not the component the scene's modelRevision names
        scene = fresh()
        component = json.loads((tmp_path / "arm-component.json").read_text())
        component["links"][1]["massKg"]["value"] = 9.0
        (tmp_path / "arm-component.json").write_text(json.dumps(component))
        return scene

    def lying_digest():  # the scene file declares a digest it does not hash to
        scene = fresh()
        declared = json.loads((tmp_path / "arm-scene.json").read_text())
        (tmp_path / "arm-scene.json").write_text(json.dumps({**declared, "sceneDigest": "c" * 64}))
        return scene

    for code, build in (("SCENE_PATH_REJECTED", missing_component), ("SCENE_FILE_MISMATCH", other_component), ("SCENE_DIGEST_MISMATCH", lying_digest)):
        scene = build()
        r = session(tmp_path, scene, []).handle(create())
        assert not r["ok"] and r["error"]["code"] == code, (code, r)
    scene = fresh()
    for kw, code in (({"seed": SEED + 1}, "SEED_MISMATCH"), ({"arms": [{"armId": "arm-2", "sceneRef": "arm-scene.json"}]}, "INVALID_REQUEST"), ({"ref": "navigation-scene.json"}, "INVALID_REQUEST")):
        r = session(tmp_path, scene, []).handle(create(**kw))
        assert not r["ok"] and r["error"]["code"] == code, (kw, r)


def test_the_arm_world_goes_through_the_compiler_errors(tmp_path):
    scene = make_bundle(tmp_path, scene_over=lambda s: s["arm"].update(homeRad=[0, 1.0, 1.2, 0, 0.6, 0]))  # J2 upper limit is 0.785
    r = session(tmp_path, scene, []).handle(create())
    assert not r["ok"] and r["error"]["code"] == "ARM_HOME_OUT_OF_RANGE"


# ---- D31: the two Minors left from R1 ----
def test_engine_seed_stays_in_the_webots_int32_range_and_is_deterministic():
    assert engine_seed(2 ** 32 - 1) == engine_seed(2 ** 32 - 1) and 0 <= engine_seed(2 ** 32 - 1) <= 2 ** 31 - 1
    assert 0 <= engine_seed(2 ** 31) <= 2 ** 31 - 1 and engine_seed(2 ** 31) != engine_seed(2 ** 31 + 1)
    assert [engine_seed(n) for n in (0, 7, 2 ** 31 - 1)] == [0, 7, 2 ** 31 - 1]  # in-range seeds keep their world bytes


def test_the_amr_world_takes_the_reduced_seed_for_a_uint32_run_seed():
    from webots_worker.compile import compile_world

    fx = Path(__file__).resolve().parents[1] / "fixtures" / "serve-3d-v1"
    scene = json.loads((fx / "navigation-scene.json").read_text())
    models = {"amr-1": json.loads((fx / "physical-model-amr-1.json").read_text())}
    assert f"randomSeed {engine_seed(2 ** 32 - 1)}\n" in compile_world(scene, models, 2 ** 32 - 1)


def test_the_probed_tmp_dir_is_the_one_webots_makes_without_a_user_variable(monkeypatch):
    for env in ({}, {"USER": "somebody"}):
        monkeypatch.delenv("USER", raising=False)
        monkeypatch.delenv("USERNAME", raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        assert engine_module._tmp_dir(24055) == Path("/tmp/webots/default/24055")  # Webots and its controllers run in an environment that has no USER
    assert "USER" not in engine_module.engine_env()
