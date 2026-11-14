"""Real-engine mobile parity and finite-drive regressions (no planar plant double)."""
import copy
import hashlib
import gzip
import json
import math
import shutil
import subprocess
import sys
import os
from pathlib import Path

import mujoco
import numpy as np
import pytest

from mujoco_worker.drive import wheel_targets, torque_limits
from mujoco_worker.compile import CompileError
from mujoco_worker.compile_mobile import compile_mobile
from mujoco_worker.mobile_engine import MobileEngine
from mujoco_worker.session import WorkerSession, scene_digest_of
from mujoco_worker.protocol import load_validators, PROTOCOL, parse_line, WorkerError

SCHEMAS = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"

FX = Path(__file__).resolve().parents[1] / "fixtures" / "serve-payload-v1"


def inputs(load="cup-center"):
    read = lambda name: json.loads((FX / (name + ".json")).read_text())
    scene = read("navigation-scene")
    scene["engine"]["loadProfileRef"].update(id=load, path=load+".json", sha256=hashlib.sha256((FX/(load+".json")).read_bytes()).hexdigest())
    scene["sceneDigest"] = scene_digest_of(scene)
    return scene, {"amr-1": read("physical-model-amr-1")}, read(load), read("drive-contact-profile")


def test_positive_yaw_and_forward_wheel_signs():
    assert wheel_targets(0, 1, .09, .36) == pytest.approx((-2, 2))
    assert wheel_targets(.18, 0, .09, .36) == pytest.approx((2, 2))


def test_actual_speed_limits_motoring_but_high_speed_braking_is_available():
    physics = inputs()[3]
    assert torque_limits(25, 30, physics) == pytest.approx((-6, 0))
    assert torque_limits(-25, -30, physics) == pytest.approx((0, 6))
    assert torque_limits(15, 30, physics) == pytest.approx((-6, 3))


def test_compiled_canonical_geometry_inertia_and_axes_are_read_from_engine():
    args = inputs()
    xml, names = compile_mobile(*args)
    assert compile_mobile(*args)[0] == xml
    engine = MobileEngine(*args)
    model, data = engine.model, engine.data
    canonical = args[1]["amr-1"]
    assert model.neq == 0
    assert model.nv == 14  # chassis 6 + two wheel hinges + free cup 6
    for link in canonical["links"]:
        body = model.body(names["links"][link["id"]]).id
        assert model.body_mass[body] == pytest.approx(link["massKg"]["value"], abs=1e-9)
        assert model.body_ipos[body] == pytest.approx(link["comM"], abs=1e-9)
        rot = np.empty(9)
        mujoco.mju_quat2Mat(rot, model.body_iquat[body])
        tensor = rot.reshape(3, 3) @ np.diag(model.body_inertia[body]) @ rot.reshape(3, 3).T
        a, b, c, d, e, f = link["inertiaKgM2"]
        assert tensor == pytest.approx(np.array([[a, b, c], [b, d, e], [c, e, f]]), abs=1e-9)
        for i, shape in enumerate(link["collision"]):
            gid = model.geom(names["geoms"][(link["id"], i)]).id
            assert model.geom_pos[gid] == pytest.approx(shape["pose"]["xyzM"], abs=1e-9)
            q = shape["pose"]["quaternionXyzw"]
            assert abs(np.dot(model.geom_quat[gid], [q[3], *q[:3]])) == pytest.approx(1, abs=1e-9)
            g = shape["geometry"]
            expected = ([x / 2 for x in g["sizeM"]] if g["kind"] == "box" else
                        [g["radiusM"], g["lengthM"] / 2, 0] if g["kind"] == "cylinder" else [g["radiusM"], 0, 0])
            assert model.geom_size[gid] == pytest.approx(expected, abs=1e-9)
    for j in canonical["joints"]:
        bid = model.body(names["links"][j["child"]]).id
        assert model.body_pos[bid] == pytest.approx(j["origin"]["xyzM"], abs=1e-9)
        if j["kind"] == "continuous":
            assert model.joint(names["joints"][j["id"]]).axis == pytest.approx(j["axis"], abs=1e-9)
    assert data.xpos[engine.base][2] == pytest.approx(.09)
    assert model.opt.timestep == .002
    assert model.opt.iterations == 100
    assert model.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST


def test_missing_caster_and_clock_mismatch_refuse_before_engine():
    args = list(inputs())
    args[1]["amr-1"]["links"] = [l for l in args[1]["amr-1"]["links"] if l["id"] != "caster-rear/ball"]
    with pytest.raises(Exception, match="(CASTER|LINK|MODEL)"):
        compile_mobile(*args)
    args = list(inputs())
    args[0]["engine"]["substeps"] = 9
    with pytest.raises(Exception, match="PHYSICS_CLOCK_MISMATCH"):
        compile_mobile(*args)


def test_hold_contact_sign_samples_and_gravity_balance():
    engine = MobileEngine(*inputs())
    for _ in range(100):
        reading = engine.step(0, 0)
    assert reading["unstable"] is None
    contacts = reading["contacts"]
    assert contacts
    assert all(c["a"] < c["b"] and 1 <= c["samples"] <= 10 for c in contacts)
    cup = [c for c in contacts if c["b"] == "prop/cup-1"]
    assert sum(c["netImpulseMapNs"][2] for c in cup) == pytest.approx(.32 * 9.81 * .02, rel=.02)
    floor = [c for c in contacts if c["a"] == "floor" or c["b"] == "floor"]
    assert sum((1 if c["b"] == "floor" else -1) * c["netImpulseMapNs"][2] for c in floor) < 0
    assert reading["loads"][0]["poseInSupport"]["positionM"] == pytest.approx([0, 0, .05], abs=.002)


def test_motion_is_physics_driven_and_lidar_uses_engine_geometry():
    engine = MobileEngine(*inputs("empty"))
    for _ in range(100):
        reading = engine.step(.2, .4)
    assert reading["robot"]["poseDriveMap"][0] > 2.1
    assert reading["robot"]["poseDriveMap"][2] > .2
    assert max(abs(x) for x in reading["wheel"]["torqueNm"]) <= 6
    assert reading["wheel"]["targetRadS"] == pytest.approx(wheel_targets(.2, .4, .09, .36))
    # Change truth pose without touching wheel angles: odometry must not jump with it.
    before = reading["odometry"].copy()
    engine.data.qpos[0] += 1
    mujoco.mj_forward(engine.model, engine.data)
    assert engine.read()["odometry"] == before
    scan1 = engine.scan(100)
    # A real engine wall moved closer alters rays without any navigation geometry change.
    wall = engine.model.geom(engine.names["statics"]["boundary-south"]).id
    engine.model.geom_pos[wall][1] += .3
    mujoco.mj_forward(engine.model, engine.data)
    scan2 = engine.scan(100)
    assert scan1["rangesM"] != scan2["rangesM"]


def test_high_target_has_finite_torque_and_reports_saturation():
    engine = MobileEngine(*inputs("empty"))
    reading = engine.step(1.8, 0)
    assert reading["wheel"]["saturatedSubsteps"] > 0
    assert max(abs(x) for x in reading["wheel"]["torqueNm"]) <= 6


def test_profile_semantics_reject_outside_height_and_impossible_inertia():
    for mutate, code in [(lambda p: p["props"][0]["attachment"]["initialPoseInSupport"]["positionM"].__setitem__(1, .3), "LOAD_OUTSIDE_SUPPORT"),
                         (lambda p: p["props"][0]["attachment"]["initialPoseInSupport"]["positionM"].__setitem__(2, .07), "LOAD_SUPPORT_HEIGHT_INVALID"),
                         (lambda p: p["props"][0].__setitem__("inertiaKgM2", [1, 0, 0, 1, 0, 4]), "LOAD_INERTIA_INVALID")]:
        args = inputs()
        mutate(args[2])
        with pytest.raises(Exception, match=code):
            compile_mobile(*args)


def test_self_intersecting_support_and_floating_declared_support_are_refused():
    args = inputs()
    args[2]["supports"][0]["polygonM"] = [[math.cos(i*4*math.pi/5), math.sin(i*4*math.pi/5)] for i in range(5)]
    with pytest.raises(Exception, match="LOAD_SUPPORT_INVALID"):
        compile_mobile(*args)
    args = inputs()
    args[2]["supports"][0]["poseInBody"]["positionM"][2] += .1
    with pytest.raises(Exception, match="LOAD_SUPPORT_GEOMETRY_INVALID"):
        MobileEngine(*args)


def request(op, payload=None, tick=0, rid=None):
    return {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "mobile-1", "expectedTick": tick, "op": op, "payload": payload or {}}


def bundle(tmp_path):
    shutil.copytree(FX, tmp_path, dirs_exist_ok=True)
    return WorkerSession(run_id="mobile-1", bundle_root=tmp_path, lock_digest="b" * 64)


def create_request():
    return request("create", {"sceneRef": "navigation-scene.json", "seed": 7})


def test_real_session_ack_clock_and_response_schema(tmp_path):
    session = bundle(tmp_path)
    created = session.handle(create_request())
    assert created["ok"], created
    assert created["result"]["physics"]["tick"] == 0
    assert session.engine.data.time == pytest.approx(.02)
    assert session.handle(request("start"))["ok"]
    req = request("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": .2, "omegaRadps": 0}], "actorUpdates": []})
    response = session.handle(req)
    assert response["ok"], response
    assert session.handle(req) == response
    assert session.engine.data.time == pytest.approx(.04)
    assert session.tick == 1
    _, validator = load_validators(SCHEMAS)
    validator.validate(response)
    validator.validate(session.handle(request("getState", tick=1)))
    assert response["result"]["sceneDigest"] == inputs()[0]["sceneDigest"]


@pytest.mark.parametrize("change", ["robot", "tick", "joints", "prop", "actor"])
def test_refused_mobile_command_cannot_advance_world(tmp_path, change):
    session = bundle(tmp_path)
    assert session.handle(create_request())["ok"]
    assert session.handle(request("start"))["ok"]
    payload = {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}], "actorUpdates": []}
    if change == "robot": payload["velocities"][0]["robotId"] = "other"
    if change == "tick": payload["targetTick"] = 2
    if change == "joints": payload["jointTargets"] = [{"armId": "other", "positionsRad": [0]}]
    if change == "prop": payload["propPlacements"] = [{"propId": "other", "pose": None}]
    if change == "actor": payload["actorUpdates"] = [{"actorId": "other", "poseMap": [0, 0, 0]}]
    before = session.engine.data.time
    response = session.handle(request("step", payload))
    assert not response["ok"], response
    assert session.tick == 0
    assert session.engine.data.time == before


def test_wire_schema_and_nonfinite_rejections_leave_engine_untouched(tmp_path):
    session = bundle(tmp_path)
    assert session.handle(create_request())["ok"]
    validator, _ = load_validators(SCHEMAS)
    before = session.engine.data.time
    for raw in (b'{"op":"unknown"}', b'{"protocol":"mekoniq-sim3d/1","x":NaN}'):
        with pytest.raises(WorkerError):
            parse_line(raw, validator)
    assert session.engine.data.time == before


def test_mobile_clock_drift_and_engine_reset_are_fatal(tmp_path, monkeypatch):
    session = bundle(tmp_path)
    assert session.handle(create_request())["ok"]
    assert session.handle(request("start"))["ok"]
    engine = session.engine
    engine.data.time += .002
    response = session.handle(request("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}], "actorUpdates": []}))
    assert response["error"]["code"] == "CLOCK_DRIFT"
    assert session.state == "failed"
    monkeypatch.chdir(tmp_path)  # MuJoCo's intentional warning log belongs to this test.
    engine = MobileEngine(*inputs())
    engine.data.qvel[0] = 1e20
    with pytest.raises(WorkerError, match="PLANT_UNSTABLE"):
        engine.step(0, 0)


def test_explicit_caster_pair_beats_high_floor_friction():
    engine = MobileEngine(*inputs("empty"))
    for _ in range(25): engine.step(.2, .4)
    frictions = []
    for c in engine.data.contact[:engine.data.ncon]:
        tags = {engine.tags[int(c.geom1)], engine.tags[int(c.geom2)]}
        if "floor" in tags and any("caster-" in t for t in tags): frictions.append(float(c.friction[0]))
    assert frictions and frictions == pytest.approx([.02] * len(frictions))


def test_projection_mismatch_and_drive_axis_refused():
    args = inputs()
    args[0]["robots"][0]["model"]["kinematics"]["wheelRadiusM"] = .1
    with pytest.raises(Exception, match="MODEL_PROJECTION_MISMATCH"):
        compile_mobile(*args)
    args = inputs()
    args[1]["amr-1"]["joints"][-1]["axis"] = [0, -1, 0]
    with pytest.raises(Exception, match="MODEL_WHEEL_AXIS_UNSUPPORTED"):
        compile_mobile(*args)


def test_canonical_wheel_speed_limits_are_not_unbounded_servo_targets():
    engine = MobileEngine(*inputs("empty"))
    before = engine.data.time
    with pytest.raises(WorkerError, match="VELOCITY_TARGET_OUT_OF_RANGE"):
        engine.step(2, 0)
    assert engine.data.time == before
    args = inputs()
    args[3]["driveCurve"][-1]["speedRadS"] = 100
    with pytest.raises(Exception, match="PHYSICS_PROFILE_INVALID"):
        compile_mobile(*args)


def test_direct_compiler_refuses_a_different_load_than_the_scene_names():
    args = inputs()
    args[2]["id"] = "cup-offset"
    with pytest.raises(Exception, match="PROFILE_ID_MISMATCH"):
        compile_mobile(*args)


def test_body_joint_and_world_namespaces_are_unique():
    args = inputs()
    args[1]["amr-1"]["joints"][-1]["id"] = args[1]["amr-1"]["joints"][-2]["id"]
    with pytest.raises(Exception, match="MODEL_LINK_INVALID"):
        compile_mobile(*args)
    args = inputs()
    args[0]["world"]["obstacles"][1]["id"] = args[0]["world"]["obstacles"][0]["id"]
    with pytest.raises(Exception, match="SCENE_ID_DUPLICATE"):
        compile_mobile(*args)


def test_geometry_quaternion_is_refused_instead_of_normalized_by_engine():
    args = inputs()
    next(l for l in args[1]["amr-1"]["links"] if l["id"] == "chassis/base")["collision"][0]["pose"]["quaternionXyzw"] = [0,0,0,2]
    with pytest.raises(Exception, match="QUATERNION_NOT_NORMALIZED"):
        compile_mobile(*args)


@pytest.mark.parametrize("change,code", [("missing", "SENSOR_REFERENCE_UNKNOWN"), ("ambiguous", "SENSOR_REFERENCE_AMBIGUOUS")])
def test_direct_compiler_resolves_lidar_before_engine_model_creation(change, code):
    args = inputs()
    if change == "missing":
        args[0]["robots"][0]["model"]["sensors"][0]["id"] = "unknown-lidar"
    else:
        args[1]["amr-1"]["sensors"].append(copy.deepcopy(args[1]["amr-1"]["sensors"][0]))
    with pytest.raises(CompileError, match=code) as error:
        compile_mobile(*args)
    assert error.value.code == code


@pytest.mark.parametrize("change,code", [("missing", "SENSOR_REFERENCE_UNKNOWN"), ("ambiguous", "SENSOR_REFERENCE_AMBIGUOUS")])
def test_invalid_lidar_reference_never_reaches_factory_or_priming(tmp_path, change, code):
    import rfc8785

    session = bundle(tmp_path)
    scene = json.loads((tmp_path/"navigation-scene.json").read_text())
    if change == "missing":
        scene["robots"][0]["model"]["sensors"][0]["id"] = "unknown-lidar"
    else:
        path = tmp_path / "physical-model-amr-1.json"
        model = json.loads(path.read_text())
        model["sensors"].append(copy.deepcopy(model["sensors"][0]))
        model["modelDigest"] = hashlib.sha256(rfc8785.dumps({k:v for k,v in model.items() if k != "modelDigest"})).hexdigest()
        path.write_text(json.dumps(model))
        scene["robots"][0]["model"]["physicalModelDigest"] = model["modelDigest"]
        # Reseal load modelRef and both byte identities so semantic admission is tested.
        load_path = tmp_path / "cup-center.json"
        load = json.loads(load_path.read_text())
        load["modelRef"]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        load["digest"] = hashlib.sha256(rfc8785.dumps({k:v for k,v in load.items() if k != "digest"})).hexdigest()
        load_path.write_text(json.dumps(load))
        scene["engine"]["loadProfileRef"]["sha256"] = hashlib.sha256(load_path.read_bytes()).hexdigest()
        for ref in scene["files"]:
            if ref["path"] in (path.name, load_path.name):
                raw = (tmp_path/ref["path"]).read_bytes()
                ref.update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
    nav = scene["robots"][0]["model"]
    nav["modelDigest"] = hashlib.sha256(rfc8785.dumps({k:v for k,v in nav.items() if k != "modelDigest"})).hexdigest()
    scene["sceneDigest"] = scene_digest_of(scene)
    session._validate_document(scene, "navigation-scene-v1.schema.json")
    (tmp_path/"navigation-scene.json").write_text(json.dumps(scene))
    calls = []
    session._factory = lambda *args: calls.append(args)
    response = session.handle(create_request())
    assert response.get("error", {}).get("code") == code, response
    assert calls == []  # neither engine construction nor its priming step is reached
    assert (session.state, session.tick, session.seq, session.substeps) == ("new", 0, 0, 0)
    assert session.engine is session.scene is session.snapshot is None


def test_resting_on_measures_contact_and_relative_velocity():
    engine = MobileEngine(*inputs())
    for _ in range(100): reading = engine.step(.15, 0)
    assert reading["resting"]["cup-1"] == "amr-1/tray-1"
    bid = engine.prop["cup-1"]
    qa = engine.model.jnt_qposadr[engine.model.body_jntadr[bid]]
    engine.data.qpos[qa + 2] += .1
    mujoco.mj_forward(engine.model, engine.data)
    assert engine.read()["resting"]["cup-1"] is None


def test_non_diagonal_inertia_and_xyzw_round_trip():
    args = inputs()
    args[2]["props"][0]["attachment"]["initialPoseInSupport"]["quaternionXyzw"] = [0, 0, math.sin(.4), math.cos(.4)]
    args[2]["props"][0]["inertiaKgM2"] = [.0004, .00002, .00001, .00038, -.00001, .00026]
    engine = MobileEngine(*args)
    p = engine.read()["loads"][0]["poseInSupport"]
    assert abs(np.dot(p["quaternionXyzw"], args[2]["props"][0]["attachment"]["initialPoseInSupport"]["quaternionXyzw"])) == pytest.approx(1)
    bid = engine.prop["cup-1"]
    rot = np.empty(9)
    mujoco.mju_quat2Mat(rot, engine.model.body_iquat[bid])
    tensor = rot.reshape(3,3) @ np.diag(engine.model.body_inertia[bid]) @ rot.reshape(3,3).T
    assert tensor == pytest.approx(np.array([[.0004,.00002,.00001],[.00002,.00038,-.00001],[.00001,-.00001,.00026]]), abs=1e-9)


def test_measured_profile_locks_every_numerical_assumption():
    args = inputs()
    p = args[3]
    assert p["requiresB02MeasurementLock"] is False
    assert p["measurementLock"]["status"] == "locked_not_calibrated"
    engine = MobileEngine(*args)
    n = p["numerics"]
    assert engine.model.opt.solver == mujoco.mjtSolver.mjSOL_NEWTON
    assert engine.model.opt.gravity == pytest.approx(n["gravityMps2"])
    assert engine.model.geom_solref[0] == pytest.approx(n["solref"])
    assert engine.model.geom_solimp[0][:3] == pytest.approx(n["solimp"])
    assert engine.model.pair_friction[0] == pytest.approx([.02,.02,0,0,0])
    assert engine.model.actuator_gainprm[engine.acts[0]][0] == p["velocityGainNmsPerRad"]


def test_measurement_raw_hashes_cover_every_tick_and_locked_values():
    root = Path(__file__).resolve().parents[3]
    physics = inputs()[3]
    summary_path = root / "docs/research/mujoco-mobility-spike/b02a-locked/summary.json"
    summary = json.loads(summary_path.read_text())
    assert len(summary["runs"]) == 36
    assert summary["measurementChecks"] == {"allFinite": True, "repeatWithinTolerance": True}
    for run in summary["runs"]:
        path = summary_path.parent / run["raw"]["path"]
        assert path.stat().st_size == run["raw"]["bytes"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == run["raw"]["sha256"]
        with gzip.open(path, "rt") as f:
            identity = json.loads(next(f))
            assert identity["physicsProfile"] == physics
            scene = identity["navigationScene"]
            assert scene_digest_of(scene) == identity["compiledSceneDigest"] == scene["sceneDigest"]
            ref = scene["engine"]["loadProfileRef"]
            assert ref["id"] == run["load"] and ref["sha256"] == identity["inputs"][run["load"]+".json"]
            for k in ("velocityGainNmsPerRad", "brakeTorqueNm", "driveCurve", "solver", "contact", "timestepMs", "substeps", "integrator"):
                assert identity["physicsProfile"][k] == physics[k]
            records = [json.loads(line) for line in f]
        assert [r["tick"] for r in records] == list(range(500))
        assert all(r["time"] == pytest.approx((r["tick"] + 1) * .02, abs=1e-8) for r in records)


def test_contact_capacity_is_fatal_instead_of_truncating():
    engine = MobileEngine(*inputs("empty"))
    engine._sample_contacts = lambda: {(f"a{i}", f"b{i}"): (1, np.ones(3), np.zeros(3), 1) for i in range(257)}
    with pytest.raises(WorkerError, match="CONTACT_CAPACITY_EXCEEDED"):
        engine.step(0, 0)


def test_real_worker_ndjson_routes_mobile_without_stdout_noise(tmp_path):
    bundle(tmp_path / "bundle")
    commands = [create_request(), request("start"), request("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": .2, "omegaRadps": .4}], "actorUpdates": []}), request("getState", tick=1), request("stop", {"reason": "test done"}, tick=1)]
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(FX.parents[1])}
    result = subprocess.run([sys.executable, "-m", "mujoco_worker", "--run-id", "mobile-1", "--bundle-root", str(tmp_path / "bundle"), "--schema-dir", str(SCHEMAS), "--lock-digest", "b"*64],
                            input="".join(json.dumps(r)+"\n" for r in commands), cwd=tmp_path, env=env, text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr
    responses = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(responses) == 5 and all(r["ok"] for r in responses), responses
    assert responses[2]["result"]["physics"]["wheels"][0]["targetRadS"] == pytest.approx(wheel_targets(.2,.4,.09,.36))
    assert responses[3]["result"]["model"]["robots"][0]["robotId"] == "amr-1"


@pytest.mark.parametrize("field", ["numerics", "solver", "sources", "driveCurve", "measurementLock"])
def test_unknown_physics_fields_refuse_before_engine_factory(tmp_path, field):
    session = bundle(tmp_path)
    scene = json.loads((tmp_path/"navigation-scene.json").read_text())
    path = tmp_path / "drive-contact-profile.json"
    p = json.loads(path.read_text())
    if field == "driveCurve": p[field][0]["unknown"] = 1
    else: p.setdefault(field, {})["unknown"] = 1
    p["digest"] = hashlib.sha256(__import__("rfc8785").dumps({k:v for k,v in p.items() if k != "digest"})).hexdigest()
    path.write_text(json.dumps(p))
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    scene["engine"]["physicsProfileRef"]["sha256"] = sha
    for f in scene["files"]:
        if f["path"] == path.name: f.update(sha256=sha, bytes=path.stat().st_size)
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path/"navigation-scene.json").write_text(json.dumps(scene))
    called = []
    session._factory = lambda *a: called.append(a)
    response = session.handle(create_request())
    assert not response["ok"] and not called


@pytest.mark.parametrize("change", ["bytes", "scene-schema", "profile-schema", "profile-digest", "path", "capacity"])
def test_mobile_admission_refuses_before_engine_factory(tmp_path, change):
    session = bundle(tmp_path)
    scene_path = tmp_path / "navigation-scene.json"
    scene = json.loads(scene_path.read_text())
    if change == "bytes": (tmp_path / "physical-model-amr-1.json").write_text("{}")
    if change == "scene-schema": scene["unexpected"] = True
    if change in ("profile-schema", "profile-digest"):
        path = tmp_path / "cup-center.json"
        p = json.loads(path.read_text())
        p["unexpected" if change == "profile-schema" else "digest"] = True if change == "profile-schema" else "a" * 64
        path.write_text(json.dumps(p))
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        scene["engine"]["loadProfileRef"]["sha256"] = sha
        for f in scene["files"]:
            if f["path"] == path.name: f.update(sha256=sha, bytes=path.stat().st_size)
    if change == "path": scene["engine"]["loadProfileRef"]["path"] = "../cup-center.json"
    if change == "capacity": scene["robots"].append(copy.deepcopy(scene["robots"][0]))
    scene["sceneDigest"] = scene_digest_of(scene)
    scene_path.write_text(json.dumps(scene))
    called = []
    session._factory = lambda *a: called.append(a)
    response = session.handle(create_request())
    assert not response["ok"], response
    assert called == []
    assert session.engine is None

@pytest.mark.parametrize('name', ['drive-contact-low-v1', 'drive-contact-high-v1'])
def test_registered_friction_profiles_have_their_own_lock_and_reject_numerical_relabel(tmp_path, name):
    session = bundle(tmp_path)
    path = FX / (name + '.json')
    assert path.exists(), 'registered numerical variant missing'
    p = json.loads(path.read_text())
    assert p['measurementLock']['probeId'] == 'b04a-' + name
    session._check_physics_profile(p)
    p['contact']['sliding'] += .01
    keys = ('tickMs','timestepMs','substeps','integrator','solver','velocityGainNmsPerRad','brakeTorqueNm','driveCurve','contact','numerics')
    canonical = __import__('rfc8785').dumps
    p['measurementLock']['numericalInputSha256'] = hashlib.sha256(canonical({k:p[k] for k in keys})).hexdigest()
    p['digest'] = hashlib.sha256(canonical({k:v for k,v in p.items() if k != 'digest'})).hexdigest()
    with pytest.raises(WorkerError):
        session._check_physics_profile(p)


def test_registered_payload_impulse_is_integrated_once_without_pose_teleport(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    bundle(tmp_path / 'bundle')
    session = WorkerSession(run_id='mobile-1', bundle_root=tmp_path / 'bundle', lock_digest='b'*64,
                            payload_perturbation='payload-cup-forward-impulse-v1')
    assert session.handle(create_request())['ok']
    assert session.handle(request('start'))['ok']
    rows = []
    try:
        for tick in range(1, 551):
            r = session.handle(request('step', {'targetTick':tick,'velocities':[{'robotId':'amr-1','vMps':0,'omegaRadps':0}],'actorUpdates':[]}, tick=tick-1))
            assert r['ok'], r
            rows.append(r['result'])
            if tick == 501:
                assert session.handle(request('step', {'targetTick':tick,'velocities':[{'robotId':'amr-1','vMps':0,'omegaRadps':0}],'actorUpdates':[]}, tick=tick-1)) == r
        receipt = json.loads((tmp_path/'payload-perturbation.json').read_text())
        assert receipt['runId'] == 'mobile-1' and receipt['tick'] == 501
        assert receipt['forceN'] == [30,0,0] and receipt['durationS'] == .02
        before, after = rows[499]['physics']['loads'][0], rows[500]['physics']['loads'][0]
        delta = np.linalg.norm(np.array(after['poseMap']['positionM'])-before['poseMap']['positionM'])
        assert 0 < delta < .05
        assert rows[-1]['physics']['loads'][0]['poseInSupport']['positionM'][2] < -.1
        assert np.max(np.abs(session.engine.data.xfrc_applied)) == 0
    finally:
        session.end()


def test_payload_perturbation_refuses_arm_and_unknown_selector_before_mutation(tmp_path):
    with pytest.raises(WorkerError, match='PERTURBATION_UNREGISTERED'):
        WorkerSession(run_id='mobile-1',bundle_root=tmp_path,lock_digest='b'*64,payload_perturbation='custom-force')
    s = WorkerSession(run_id='mobile-1',bundle_root=tmp_path,lock_digest='b'*64,payload_perturbation='payload-cup-forward-impulse-v1')
    response = s.handle(request('create', {'sceneRef':'scene.json','seed':7,'arms':[]}))
    assert not response['ok'] and response['error']['code'] == 'PERTURBATION_SCOPE_INVALID'
    assert s.engine is None and s.tick == 0


def test_variant_probe_scene_declares_the_actual_profile_bytes(tmp_path):
    from probe_mobile import run_case
    name = 'drive-contact-low-v1'
    metrics, _, _ = run_case('hold','empty',1,tmp_path,name)
    with gzip.open(tmp_path/metrics['raw']['path'],'rt') as raw:
        identity = json.loads(next(raw))
    ref = identity['navigationScene']['engine']['physicsProfileRef']
    assert ref['path'] == name+'.json'
    files = identity['navigationScene']['files']
    assert any(x['path'] == ref['path'] and x['sha256'] == ref['sha256'] and x['bytes'] == (FX/ref['path']).stat().st_size for x in files)
