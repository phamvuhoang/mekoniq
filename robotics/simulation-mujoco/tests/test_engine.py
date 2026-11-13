"""M04: the worker on the real MuJoCo 3.17.0 (the pinned .venv-mujoco): hold, rest, occupancy, parking, clock and bit-for-bit repeatability."""
import json
import shutil

import numpy as np
import pytest
from scene_fixture import BLOBS, FX, cell_scene, load
from test_session import HOME, OPEN, RUN, TOKEN, pose, req, step

from mujoco_worker.engine import MujocoEngine
from mujoco_worker.session import WorkerSession

REACH_TOL = json.loads((FX.parents[3] / "robotics" / "algorithm" / "oracle-profile-v1.json").read_text())["mujocoArm"]["reachTolRad"]
LAYOUT = load("cell-layout.json")
STAND = LAYOUT["nozzleStand"]
ON_STAND = [STAND["centerM"][0], STAND["centerM"][1], STAND["centerM"][2] + STAND["sizeM"][2] / 2 + LAYOUT["cup"]["heightM"] / 2 + 0.001]  # 1 mm above the top


def engine(props=("cup-1", "cup-2"), seed=7):
    return MujocoEngine(cell_scene(props, engine_seed=seed), load("component.json"), load("physics.json"), str(BLOBS))


@pytest.fixture
def run(tmp_path):
    scene = cell_scene(("cup-1", "cup-2"), engine_seed=7)
    (tmp_path / "arm-cell-scene.json").write_text(json.dumps(scene))
    for f in ("component.json", "physics.json"):
        shutil.copy(FX / f, tmp_path / f)
    shutil.copytree(BLOBS, tmp_path / "blobs")
    s = WorkerSession(run_id=RUN, bundle_root=tmp_path, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"])
    r = s.handle(req("create", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [TOKEN]}))
    assert r["ok"], r
    assert s.handle(req("start"))["ok"]
    yield s
    s.end()


def test_500_ticks_holding_home_stay_within_reach_tolerance(run):
    for k in range(500):
        r = run.handle(step(k))
        assert r["ok"], r
    arm = r["result"]["arms"][0]
    assert max(abs(q - h) for q, h in zip(arm["positionsRad"], HOME)) <= REACH_TOL
    assert arm["collisionIds"] == [] and arm["gripper"]["heldPropIds"] == [] and arm["gripper"]["openingM"] == pytest.approx(OPEN, abs=1e-3)


def test_a_cup_placed_on_the_stand_rests_on_it_and_a_second_cup_cannot_take_its_place(run):
    r = run.handle(step(0, placements=[("cup-1", pose(ON_STAND))]))
    assert r["ok"] and r["result"]["props"][0]["propId"] == "cup-1" and len(r["result"]["props"]) == 1
    for k in range(1, 51):
        r = run.handle(step(k))
    cup = r["result"]["props"][0]
    assert cup["restingOn"] == "nozzle-stand" and cup["position"][2] == pytest.approx(ON_STAND[2], abs=0.003)
    bad = run.handle(step(51, placements=[("cup-2", pose(ON_STAND))]))
    assert not bad["ok"] and bad["error"]["code"] == "PROP_PLACEMENT_OCCUPIED" and bad["tick"] == 51


def test_a_parked_cup_has_no_contact_and_is_not_in_the_snapshot(run):
    run.handle(step(0, placements=[("cup-1", pose(ON_STAND))]))
    for k in range(1, 20):
        run.handle(step(k))
    r = run.handle(step(20, placements=[("cup-1", None)]))
    assert r["ok"] and r["result"]["props"] == []
    e = run.engine
    for k in range(21, 60):  # parked cups are re-pinned every tick: they neither fall nor touch anything
        assert run.handle(step(k))["ok"]
    bid = e.model.body(e.names["props"]["cup-1"]).id
    touching = {int(g) for c in range(e.data.ncon) for g in e.data.contact.geom[c]}
    assert not touching & {i for i in range(e.model.ngeom) if e.model.geom_bodyid[i] == bid}
    assert e.model.body_contype[bid] == 0 and e.model.body_conaffinity[bid] == 0
    assert e.data.qpos[e.prop["cup-1"]["qpos"] + 2] > -12  # pinned near its park pose (-11), not falling for 40 ticks


def test_a_contact_that_ends_inside_one_tick_is_still_a_collision(run):
    # a cup placed 1 mm into the arm base is pushed out within the tick: in contact for substeps 1-8, free after the 10th (measured on MuJoCo 3.17.0)
    r = run.handle(step(0, placements=[("cup-1", pose([0.102, 0.0, 0.051]))]))
    assert r["ok"], r
    e = run.engine
    ended = {(e.tags[int(a)][0], e.tags[int(b)][0]) for a, b in e.data.contact.geom[:e.data.ncon]}
    assert ("link", "prop") not in ended and ("prop", "link") not in ended  # last-substep sampling would report nothing
    assert r["result"]["arms"][0]["collisionIds"] == ["cup-1"]


def test_an_engine_that_resets_itself_on_a_bad_state_is_plant_unstable(run, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # MuJoCo appends its warning to MUJOCO_LOG.TXT in the working directory (the worker's is its private run directory)
    run.engine.data.qvel[:] = 1e20  # MuJoCo warns (mjWARN_BADQVEL) and silently resets the state to finite values
    r = run.handle(step(0))
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and run.state == "failed", r


def test_engine_time_after_n_steps_is_n_times_20_ms():
    e = engine()
    for n in range(1, 101):
        e.step(HOME, OPEN, [])
        assert abs(e.data.time - n * 0.02) < 1e-12, n


def test_a_hold_at_home_through_the_worker_passes_tick_18096_without_clock_drift(run):
    # MuJoCo adds the 2 ms timestep once per substep: its accumulated rounding first exceeds 1e-9 s at tick 18,096 (the old check failed there)
    for k in range(18_200):
        r = run.handle(step(k))
        assert r["ok"], (k, r["error"])
    assert r["result"]["tick"] == 18_200


def test_two_engines_with_the_same_seed_and_commands_give_the_same_qpos_bit_for_bit():
    a, b = engine(), engine()
    for k in range(200):
        q = [h + 0.002 * k * (i % 2) for i, h in enumerate(HOME)]
        opening = OPEN if k < 100 else 0.03
        placements = [("cup-1", pose(ON_STAND))] if k == 10 else []
        a.step(q, opening, placements)
        b.step(q, opening, placements)
    assert a.data.qpos.tobytes() == b.data.qpos.tobytes() and a.data.qvel.tobytes() == b.data.qvel.tobytes()
    assert np.isfinite(a.data.qpos).all()


def test_the_readback_is_the_compiled_model_and_matches_the_fixture():
    e, component, physics = engine(), load("component.json"), load("physics.json")
    rb = e.readback()["arm"]
    links = {l["id"]: l["massKg"]["value"] for l in component["links"]}
    joints = {j["id"]: j for j in component["joints"]}
    assert [j["name"] for j in rb["joints"]] == ["J1", "J2", "J3", "J4", "J5", "J6"]
    for l in rb["links"]:
        assert l["massKg"] == pytest.approx(links[l["name"]], abs=1e-12)
    for j in rb["joints"]:
        f = joints[j["name"]]["limits"]
        assert (j["lower"], j["upper"], j["forceN"]) == pytest.approx((f["lower"]["value"], f["upper"]["value"], f["effort"]["value"]), abs=1e-12)
        assert np.linalg.norm(j["axis"]) == pytest.approx(1.0)
    assert e.opening_max_m == physics["gripper"]["openingMaxM"]
