"""M04: WorkerSession of the MuJoCo arm cell against an engine double (no MuJoCo). The ACK, clock, priming and idempotency rules are the Webots worker's."""
import json
import math
import shutil

import pytest
from scene_fixture import FX, SCHEMAS, cell_scene, load

from mujoco_worker.protocol import PROTOCOL, load_validators
from mujoco_worker.session import WorkerSession

RUN = "run-1"
COMPONENT, PHYSICS = load("component.json"), load("physics.json")
HOME = load("programs.json")["programs"]["waypoints"]["home"]
CHAIN = [j for j in COMPONENT["joints"] if j["id"] in ("J1", "J2", "J3", "J4", "J5", "J6")]
LIMITS = [(j["limits"]["lower"]["value"], j["limits"]["upper"]["value"]) for j in CHAIN]
OPEN = PHYSICS["gripper"]["openingMaxM"]
TOKEN = {"armId": "xarm-1", "sceneRef": "arm-cell-scene.json"}
STAND = [0.49, 0.0, 0.15]
UPRIGHT = [0.0, 0.0, 0.0, 1.0]


class FakeEngine:
    """Stands in for MuJoCo: the arm reaches its target, the gripper its opening, a placed cup sits where it was put. A test may override what the next step reports."""

    def __init__(self, scene, component, physics, blob_dir):
        self.scene, self.blob_dir, self.time, self.calls, self.closed = scene, blob_dir, 0.0, [], False
        self.arm_limits, self.opening_max_m = LIMITS, OPEN
        self.opening, self.cups, self.contacts, self.next_positions = OPEN, {}, [], None
        self.tick_contacts, self.unstable = None, None  # contacts seen during the tick (default: the end-of-tick ones); an engine warning

    def step(self, targets, opening, placements):
        self.time += 0.02
        self.calls.append((list(targets), opening, list(placements)))
        if opening is not None:
            self.opening = opening
        for pid, pose in placements:
            if pose is None:
                self.cups.pop(pid, None)
            else:
                self.cups[pid] = pose
        q = list(self.next_positions if self.next_positions is not None else targets)
        return {"time": self.time, "arm": {"positions": q, "velocities": [0.0] * len(q)}, "gripper": {"positions": [0.1], "velocities": [0.0], "openingM": self.opening},
                "props": {pid: {"position": list(p["position"]), "quaternionXyzw": list(p["quaternionXyzw"]), "speed": 0.0} for pid, p in self.cups.items()}, "contacts": list(self.contacts),
                "tickContacts": list(self.contacts if self.tick_contacts is None else self.tick_contacts), "unstable": self.unstable}

    def readback(self):
        return {"robots": [], "arm": {"links": [{"name": "link1", "massKg": 2.3814}], "joints": [{"name": "J1", "axis": [0.0, 0.0, 1.0], "lower": -6.28, "upper": 6.28, "forceN": 179.4445}]}}

    def close(self):
        self.closed = True


def make_bundle(root, props=("cup-1", "cup-2")):
    scene = cell_scene(props, engine_seed=7)
    (root / "arm-cell-scene.json").write_text(json.dumps(scene))
    for f in ("component.json", "physics.json"):
        shutil.copy(FX / f, root / f)
    (root / "blobs").mkdir()
    return scene


def new_session(root, scene, engines):
    def factory(*args):
        engines.append(FakeEngine(*args))
        return engines[-1]

    return WorkerSession(run_id=RUN, bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], engine_factory=factory, host_info=lambda: "3.17.0")


_n = 0


def req(op, payload=None, tick=0, request_id=None):
    global _n
    _n += 1
    return {"protocol": PROTOCOL, "requestId": request_id or f"r{_n}", "runId": RUN, "expectedTick": tick, "op": op, "payload": payload or {}}


def step(tick, q=HOME, opening=None, placements=None, **over):
    p = {"targetTick": tick + 1, "velocities": [], "actorUpdates": [], "jointTargets": [{"armId": "xarm-1", "positionsRad": list(q)}]}
    if opening is not None:
        p["gripperTargets"] = [{"armId": "xarm-1", "openingM": opening}]
    if placements is not None:
        p["propPlacements"] = [{"propId": pid, "pose": pose} for pid, pose in placements]
    p.update(over.pop("payload", {}))
    return req("step", p, tick=tick, **over)


def pose(position, q=UPRIGHT):
    return {"position": list(position), "quaternionXyzw": list(q)}


VALIDATORS = load_validators(SCHEMAS)


def check_schema(response):
    errs = list(VALIDATORS[1].iter_errors(response))
    assert not errs, errs[0].message


@pytest.fixture
def run(tmp_path):
    engines = []
    scene = make_bundle(tmp_path)
    s = new_session(tmp_path, scene, engines)
    r = s.handle(req("create", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [TOKEN]}))
    assert r["ok"], r
    check_schema(r)
    assert s.handle(req("start"))["ok"]
    return s, engines[0], r["result"]


def test_create_primes_one_step_at_home_with_the_gripper_open_and_reports_tick_zero(run):
    s, e, snap = run
    assert snap["tick"] == 0 and snap["simTimeNs"] == "0" and snap["robots"] == [] and snap["props"] == []
    assert e.calls == [(HOME, OPEN, [])]
    arm = snap["arms"][0]
    assert arm["armId"] == "xarm-1" and arm["positionsRad"] == HOME and arm["gripper"] == {"openingM": OPEN, "heldPropIds": []} and arm["collisionIds"] == []


def test_a_step_hands_the_double_six_positions_the_opening_and_the_placements_and_reports_what_it_returned(run):
    s, e, _ = run
    q = [0.1, -1.0, -0.3, -3.14, 0.1, 0.0]
    r = s.handle(step(0, q, opening=0.05, placements=[("cup-1", pose(STAND))]))
    assert r["ok"] and r["tick"] == 1, r
    check_schema(r)
    assert e.calls[-1] == (q, 0.05, [("cup-1", pose(STAND))]) and len(e.calls) == 2
    snap = r["result"]
    assert snap["tick"] == 1 and snap["simTimeNs"] == "20000000"
    assert snap["arms"][0]["positionsRad"] == q and snap["arms"][0]["gripper"]["openingM"] == 0.05
    assert snap["props"] == [{"propId": "cup-1", "position": STAND, "quaternionXyzw": UPRIGHT, "restingOn": None}]
    e.contacts = [(("prop", "cup-1"), ("support", "nozzle-stand"))]
    snap = s.handle(step(1, q))["result"]
    assert snap["props"][0]["restingOn"] == "nozzle-stand"
    assert e.calls[-1][1] is None  # no gripperTargets: the gripper keeps the opening it was last given


@pytest.mark.parametrize("bad, code", [
    ({"q": [LIMITS[0][1] + 1e-6, *HOME[1:]]}, "JOINT_TARGET_OUT_OF_RANGE"),
    ({"opening": OPEN + 1e-6}, "GRIPPER_TARGET_OUT_OF_RANGE"),
    ({"q": HOME[:5]}, "JOINT_TARGET_SHAPE"),
    ({"placements": [("cup-9", pose(STAND))]}, "PROP_UNKNOWN"),
])
def test_a_refused_step_keeps_the_tick_and_never_reaches_the_engine(run, bad, code):
    s, e, _ = run
    r = s.handle(step(0, **bad))
    assert not r["ok"] and r["error"]["code"] == code and r["tick"] == 0, r
    check_schema(r)
    assert len(e.calls) == 1 and s.state == "running" and s.tick == 0
    assert s.handle(step(0))["ok"]  # the run carries on


def test_targets_exactly_at_the_limits_are_accepted(run):
    s, e, _ = run
    assert s.handle(step(0, [LIMITS[0][1], *HOME[1:]], opening=OPEN))["ok"]
    assert s.handle(step(1, [LIMITS[0][0], *HOME[1:]], opening=0.0))["ok"]


def test_a_repeated_request_id_gets_the_stored_answer_and_one_engine_call(run):
    s, e, _ = run
    first = s.handle(step(0, request_id="same"))
    again = s.handle(step(0, request_id="same"))
    assert first == again and first["ok"] and len(e.calls) == 2
    clash = s.handle(step(0, opening=0.01, request_id="same"))
    assert not clash["ok"] and clash["error"]["code"] == "IDEMPOTENCY_CONFLICT" and len(e.calls) == 2


@pytest.mark.parametrize("bad", [[math.nan, *HOME[1:]], [HOME[0], LIMITS[1][1] + 0.06, *HOME[2:]]])
def test_a_plant_that_returns_nan_or_leaves_its_limits_is_unstable_and_ends_the_run(run, bad):
    s, e, _ = run
    e.next_positions = bad
    r = s.handle(step(0))
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and s.state == "failed" and e.closed


def test_a_cup_that_is_not_finite_is_unstable_but_a_parked_one_is_never_looked_at(run):
    s, e, _ = run
    assert s.handle(step(0, placements=[("cup-1", pose(STAND))]))["ok"]
    e.cups["cup-1"] = pose([math.nan, 0, 0.15])
    r = s.handle(step(1))
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and s.state == "failed"


@pytest.mark.parametrize("payload", [{"velocities": [{"robotId": "amr-1", "vMps": 0.0, "omegaRadps": 0.0}]}, {"actorUpdates": [{"actorId": "p-1", "poseMap": [0, 0, 0]}]}])
def test_velocities_or_actor_updates_do_not_belong_to_an_arm_cell(run, payload):
    s, e, _ = run
    r = s.handle(step(0, payload=payload))
    assert not r["ok"] and r["error"]["code"] == "INVALID_REQUEST" and r["tick"] == 0 and len(e.calls) == 1


def test_a_held_cup_cannot_be_placed_or_parked_and_a_cup_cannot_be_placed_into_another(run):
    s, e, _ = run
    assert s.handle(step(0, placements=[("cup-1", pose(STAND))]))["ok"]
    r = s.handle(step(1, placements=[("cup-2", pose([STAND[0] + 0.05, 0.0, STAND[2] + 0.02]))]))  # 5 cm apart, radii 4 cm each
    assert not r["ok"] and r["error"]["code"] == "PROP_PLACEMENT_OCCUPIED" and r["tick"] == 1 and len(e.calls) == 2
    assert s.handle(step(1, placements=[("cup-2", pose([STAND[0] + 0.09, 0.0, STAND[2]]))]))["ok"]  # side by side is fine
    e.contacts = [(("pad", 0), ("prop", "cup-1")), (("pad", 1), ("prop", "cup-1"))]
    snap = s.handle(step(2))["result"]
    assert snap["arms"][0]["gripper"]["heldPropIds"] == ["cup-1"]
    for placement in (("cup-1", None), ("cup-1", pose([0.35, 0.35, 0.11]))):
        r = s.handle(step(3, placements=[placement]))
        assert not r["ok"] and r["error"]["code"] == "PROP_HELD" and r["tick"] == 3
    assert len(e.calls) == 4


def test_a_gripper_part_on_an_arm_link_is_a_self_collision(run):
    s, e, _ = run
    for pair in ((("pad", 1), ("link", "link3")), (("gripper",), ("link", "link2")), (("link", "link4"), ("palm",))):
        e.contacts = [pair]
        r = s.handle(step(s.tick))
        assert r["result"]["arms"][0]["collisionIds"] == ["self"], pair


def test_collisions_are_what_happened_during_the_tick_and_holding_is_read_at_its_end(run):
    s, e, _ = run
    assert s.handle(step(0, placements=[("cup-1", pose(STAND))]))["ok"]
    e.contacts = [(("prop", "cup-1"), ("support", "nozzle-stand"))]  # the end of the tick
    e.tick_contacts = [(("link", "link3"), ("static", "wall-1")), (("pad", 0), ("prop", "cup-1")), (("pad", 1), ("prop", "cup-1")), *e.contacts]
    snap = s.handle(step(1))["result"]
    assert snap["arms"][0]["collisionIds"] == ["wall-1"] and snap["arms"][0]["gripper"]["heldPropIds"] == [] and snap["props"][0]["restingOn"] == "nozzle-stand"


def test_an_engine_instability_warning_is_plant_unstable_before_any_clock_check(run):
    s, e, _ = run
    e.unstable, e.time = "BADQVEL", 0.0  # MuJoCo resets the state (and its time) when it warns
    r = s.handle(step(0))
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and "BADQVEL" in r["error"]["detail"] and s.state == "failed"


def test_collisions_name_what_the_arm_touched_and_leave_out_grasping_and_resting(run):
    s, e, _ = run
    assert s.handle(step(0, placements=[("cup-1", pose(STAND)), ("cup-2", pose([0.35, 0.35, 0.11]))]))["ok"]
    e.contacts = [(("link", "link3"), ("static", "wall-1")), (("floor",), ("link", "base")), (("link", "link2"), ("link", "link5")), (("palm",), ("support", "tray")),
                  (("pad", 0), ("prop", "cup-1")), (("pad", 1), ("prop", "cup-1")), (("prop", "cup-1"), ("support", "nozzle-stand")), (("prop", "cup-2"), ("floor",)),
                  (("pad", 0), ("support", "nozzle-stand")), (("link", "link6"), ("prop", "cup-2")), (("pad", 0), ("pad", 1))]
    arm = s.handle(step(1))["result"]["arms"][0]
    assert arm["collisionIds"] == ["cup-2", "floor", "self", "wall-1"] and arm["gripper"]["heldPropIds"] == ["cup-1"]
    e.contacts = [(("prop", "cup-1"), ("support", "tray")), (("pad", 0), ("prop", "cup-1")), (("pad", 1), ("prop", "cup-1")), (("link", "link4"), ("support", "tray"))]
    assert s.handle(step(2))["result"]["arms"][0]["collisionIds"] == ["tray"]  # held cup on an allowed support: no; an arm link on it: yes


def test_get_state_carries_the_readback_and_does_not_step(run):
    s, e, _ = run
    r = s.handle(req("getState"))
    assert r["ok"] and r["tick"] == 0 and len(e.calls) == 1 and r["result"]["model"]["arm"]["joints"][0]["forceN"] == 179.4445
    check_schema(r)


def test_describe_names_the_engine_and_the_lock(tmp_path):
    scene = make_bundle(tmp_path)
    r = new_session(tmp_path, scene, []).handle(req("describe"))
    assert r["ok"] and r["result"]["engineVersion"] == "3.17.0" and r["result"]["lockDigest"] == "b" * 64 and "step" in r["result"]["ops"]
    check_schema(r)


def test_create_refuses_what_it_cannot_trust(tmp_path):
    scene = make_bundle(tmp_path)
    for payload, code in (({"seed": 8}, "SEED_MISMATCH"), ({"arms": [{"armId": "arm-2", "sceneRef": "arm-cell-scene.json"}]}, "INVALID_REQUEST"),
                          ({"sceneRef": "arm-scene.json", "arms": [{"armId": "xarm-1", "sceneRef": "arm-scene.json"}]}, "INVALID_REQUEST")):
        engines = []
        r = new_session(tmp_path, scene, engines).handle(req("create", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [TOKEN], **payload}))
        assert not r["ok"] and r["error"]["code"] == code and engines == [], (payload, r)
    declared = json.loads((tmp_path / "arm-cell-scene.json").read_text())
    (tmp_path / "arm-cell-scene.json").write_text(json.dumps({**declared, "engineSeed": 9}))
    r = new_session(tmp_path, scene, []).handle(req("create", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [TOKEN]}))
    assert r["error"]["code"] == "SCENE_DIGEST_MISMATCH"


def test_the_clock_moves_only_on_a_step_and_expected_tick_must_match(run):
    s, e, _ = run
    assert s.handle(req("pause"))["ok"] and s.handle(req("resume"))["ok"] and s.tick == 0 and len(e.calls) == 1
    r = s.handle(step(0, payload={"targetTick": 2}))
    assert r["error"]["code"] == "TICK_MISMATCH"
    r = s.handle(req("getState", tick=3))
    assert r["error"]["code"] == "TICK_MISMATCH"
    assert s.handle(req("stop"))["result"] == {"state": "stopped"} and e.closed
